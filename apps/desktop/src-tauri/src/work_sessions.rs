use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    id: String,
    service_instance_id: String,
    member_id: String,
    project_id: String,
    task_id: String,
    node_id: String,
    host: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    native_session_id: Option<String>,
    status: String,
    created_at: String,
    expires_at: String,
    updated_at: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    version: u8,
    base_url: String,
    token: String,
    session: Session,
    workspace_path: String,
    member_credential_hash: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadIndex {
    binding_id: String,
    host: String,
    native_session_id: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    revoked: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStatus {
    available: bool,
    workspace_path: Option<String>,
    session: Option<Session>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    native_session_id: String,
    deep_link: String,
    #[serde(default)]
    warnings: Vec<String>,
}

fn valid_id(id: &str) -> bool {
    id.as_bytes()
        .first()
        .is_some_and(|c| c.is_ascii_alphanumeric())
        && id.len() <= 200
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
fn validate_session(s: &Session) -> Result<(), String> {
    if ![
        &s.id,
        &s.service_instance_id,
        &s.member_id,
        &s.project_id,
        &s.task_id,
        &s.node_id,
    ]
    .iter()
    .all(|id| valid_id(id))
        || !matches!(s.host.as_str(), "codex" | "deepseek-harness")
        || s.native_session_id
            .as_deref()
            .is_some_and(|id| !valid_id(id))
    {
        return Err("工作会话标识无效".into());
    }
    Ok(())
}
fn private_dir(path: &Path) -> Result<(), String> {
    if path.exists() {
        let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err("工作会话目录不能使用符号链接".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if meta.uid() != unsafe { libc::geteuid() } {
                return Err("工作会话目录属于其他用户".into());
            }
        }
    } else {
        fs::create_dir(path).map_err(|e| e.to_string())?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let root = dir.join("work-sessions");
    private_dir(&root)?;
    Ok(root)
}
fn profile_path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("工作会话标识无效".into());
    }
    let dir = root(app)?.join(id);
    private_dir(&dir)?;
    Ok(dir.join("profile.json"))
}
fn read_private_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path)
        .map_err(|_| "本机没有该会话的授权，请新建 AI 工作会话".to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 65536 {
        return Err("工作会话凭证文件无效".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.uid() != unsafe { libc::geteuid() } || meta.mode() & 0o077 != 0 {
            return Err("工作会话凭证文件须仅当前用户可读写".into());
        }
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(path).map_err(|_| "无法安全读取会话文件")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let after = file.metadata().map_err(|e| e.to_string())?;
        if after.ino() != meta.ino()
            || after.dev() != meta.dev()
            || after.uid() != meta.uid()
            || after.mode() != meta.mode()
        {
            return Err("读取时会话文件发生变化，请重试".into());
        }
    }
    let mut bytes = Vec::new();
    file.take(65537)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 65536 {
        return Err("会话文件过大".into());
    }
    Ok(bytes)
}
fn read_profile(path: &Path) -> Result<Profile, String> {
    let p: Profile = serde_json::from_slice(&read_private_bytes(path)?)
        .map_err(|_| "工作会话凭证格式无效".to_string())?;
    validate_session(&p.session)?;
    if p.version != 1 {
        return Err("不支持的工作会话版本".into());
    }
    Ok(p)
}
fn write_private(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temporary = path.with_extension(format!("{suffix}.tmp"));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(value).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
fn same_binding(a: &Session, b: &Session) -> bool {
    a.id == b.id
        && a.service_instance_id == b.service_instance_id
        && a.member_id == b.member_id
        && a.project_id == b.project_id
        && a.task_id == b.task_id
        && a.node_id == b.node_id
        && a.host == b.host
        && a.created_at == b.created_at
}
fn current_credential_hash(app: &tauri::AppHandle, base_url: &str) -> Result<String, String> {
    let connection = super::connection_load(app.clone())?.ok_or("请先连接协同服务")?;
    if connection.base_url != base_url || connection.token.is_empty() {
        return Err("当前成员或协同服务已变更，请从当前任务新建会话".into());
    }
    Ok(format!(
        "{:x}",
        Sha256::digest(format!("{}\0{}", base_url, connection.token).as_bytes())
    ))
}
fn validate_current_profile(
    app: &tauri::AppHandle,
    p: &Profile,
    expected: &Session,
) -> Result<(), String> {
    validate_session(expected)?;
    if !same_binding(&p.session, expected)
        || current_credential_hash(app, &p.base_url)? != p.member_credential_hash
    {
        return Err("会话不属于当前连接、成员或任务，请从当前任务重新进入".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn work_session_pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let result = app
        .dialog()
        .file()
        .set_title("选择该任务的工作目录")
        .blocking_pick_folder();
    result
        .map(|p| {
            p.into_path()
                .map(|p| p.to_string_lossy().into_owned())
                .map_err(|e| e.to_string())
        })
        .transpose()
}
#[tauri::command]
pub fn work_session_prepare(
    app: tauri::AppHandle,
    base_url: String,
    session: Session,
    token: String,
    workspace_path: String,
) -> Result<(), String> {
    validate_session(&session)?;
    if session.status != "prepared"
        || session.native_session_id.is_some()
        || !token.starts_with("io_grant_")
        || token.len() > 4096
    {
        return Err("工作会话尚未准备好".into());
    }
    let workspace = PathBuf::from(workspace_path);
    if !workspace.is_absolute() || !workspace.is_dir() {
        return Err("请选择存在的绝对路径工作目录".into());
    }
    let workspace = workspace.canonicalize().map_err(|e| e.to_string())?;
    let config = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("connection.json");
    let endpoint: super::Endpoint =
        serde_json::from_slice(&fs::read(config).map_err(|_| "请先连接协同服务".to_string())?)
            .map_err(|e| e.to_string())?;
    let base_url = super::validate_endpoint(&base_url)?;
    if base_url != super::validate_endpoint(&endpoint.base_url)? {
        return Err("协同服务连接已变更，请重新进入任务后启动".into());
    }
    let path = profile_path(&app, &session.id)?;
    if path.exists() {
        return Err("此工作会话已在本机保存，请恢复会话或重新创建".into());
    }
    let member_credential_hash = current_credential_hash(&app, &base_url)?;
    write_private(
        &path,
        &Profile {
            version: 1,
            base_url,
            token,
            session,
            workspace_path: workspace.to_string_lossy().into_owned(),
            member_credential_hash,
        },
    )
}
#[tauri::command]
pub fn work_session_local_status(
    app: tauri::AppHandle,
    binding_id: String,
) -> Result<LocalStatus, String> {
    let path = profile_path(&app, &binding_id)?;
    if !path.exists() {
        return Ok(LocalStatus {
            available: false,
            workspace_path: None,
            session: None,
        });
    }
    let p = read_profile(&path)?;
    Ok(LocalStatus {
        available: true,
        workspace_path: Some(p.workspace_path),
        session: Some(p.session),
    })
}
fn executable(name: &str, sibling: Option<&Path>) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    if let Some(dir) = sibling {
        dirs.insert(0, dir.to_owned());
    }
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    if let Some(home) = std::env::var_os("HOME") {
        let versions = PathBuf::from(&home).join(".nvm/versions/node");
        if let Ok(entries) = fs::read_dir(versions) {
            let mut entries: Vec<_> = entries.flatten().map(|e| e.path().join("bin")).collect();
            entries.sort();
            entries.reverse();
            dirs.extend(entries);
        }
        dirs.push(PathBuf::from(home).join(".local/bin"));
    }
    dirs.into_iter()
        .map(|dir| {
            dir.join(if cfg!(windows) {
                format!("{name}.exe")
            } else {
                name.to_string()
            })
        })
        .find(|path| {
            if !path.is_file() {
                return false;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                return fs::metadata(path).is_ok_and(|m| m.permissions().mode() & 0o111 != 0);
            }
            #[cfg(not(unix))]
            {
                true
            }
        })
}
fn launcher_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("integrations/codex/launcher.cjs");
    if resource.is_file() {
        return Ok(resource);
    }
    #[cfg(debug_assertions)]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../plugins/codex/runtime/launcher.cjs");
        if dev.is_file() {
            return dev.canonicalize().map_err(|e| e.to_string());
        }
    }
    Err("未找到 AI 会话运行组件，请重新构建或安装桌面 App".into())
}
#[tauri::command]
pub async fn work_session_launch(
    app: tauri::AppHandle,
    binding_id: String,
    expected_session: Session,
) -> Result<LaunchResult, String> {
    tauri::async_runtime::spawn_blocking(move || launch(&app, &binding_id, &expected_session))
        .await
        .map_err(|_| "会话启动任务中断".to_string())?
}
static LAUNCHES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
struct LaunchGuard(String);
impl LaunchGuard {
    fn acquire(id: &str) -> Result<Self, String> {
        let mut launches = LAUNCHES
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
            .map_err(|_| "无法检查启动状态")?;
        if !launches.insert(id.to_owned()) {
            return Err("这个工作会话正在启动，请等待后恢复原会话".into());
        }
        Ok(Self(id.to_owned()))
    }
}
impl Drop for LaunchGuard {
    fn drop(&mut self) {
        if let Ok(mut launches) = LAUNCHES.get_or_init(|| Mutex::new(HashSet::new())).lock() {
            launches.remove(&self.0);
        }
    }
}
fn launch(app: &tauri::AppHandle, id: &str, expected: &Session) -> Result<LaunchResult, String> {
    let _guard = LaunchGuard::acquire(id)?;
    let path = profile_path(app, id)?;
    let profile = read_profile(&path)?;
    validate_current_profile(app, &profile, expected)?;
    if profile.session.host != "codex" {
        return Err("当前 DeepSeek Harness 尚不支持从 App 创建绑定会话，请使用 Codex".into());
    }
    let cached = path.with_file_name("launch.json");
    if cached.exists() && profile.session.native_session_id.is_none() {
        let result: LaunchResult = serde_json::from_slice(&read_private_bytes(&cached)?)
            .map_err(|_| "之前的启动结果无效")?;
        if !valid_id(&result.native_session_id)
            || result.deep_link != format!("codex://threads/{}", result.native_session_id)
        {
            return Err("之前的线程标识无效".into());
        }
        return Ok(result);
    }
    let node = executable("node", None).ok_or("未找到 Node.js，请安装 Node.js 22 或更新版本")?;
    let codex = executable("codex", node.parent()).ok_or("未找到 Codex CLI，请安装后重试")?;
    let mut command = Command::new(&node);
    command
        .arg(launcher_path(app)?)
        .current_dir(&profile.workspace_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for key in [
        "IO_ADMIN_TOKEN",
        "IO_DATABASE_URL",
        "IO_MEMBER_TOKEN",
        "IO_BINDING_FILE",
        "PGPASSWORD",
    ] {
        command.env_remove(key);
    }
    if let Some(parent) = node.parent() {
        let mut paths = vec![parent.to_path_buf()];
        paths.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        command.env(
            "PATH",
            std::env::join_paths(paths).map_err(|e| e.to_string())?,
        );
    }
    let mut child = command
        .spawn()
        .map_err(|_| "无法启动 AI 会话运行组件".to_string())?;
    let input = serde_json::json!({"profilePath": path, "workspacePath": profile.workspace_path, "codexPath": codex});
    let written = child
        .stdin
        .take()
        .ok_or("无法写入启动参数")
        .and_then(|mut stdin| {
            stdin
                .write_all(format!("{input}\n").as_bytes())
                .map_err(|_| "无法写入启动参数")
        });
    if written.is_err() {
        let _ = child.kill();
        let _ = child.wait();
        return Err("无法启动工作会话".into());
    }
    let stdout = child.stdout.take().ok_or("无法读取启动结果")?;
    let reader = std::thread::spawn(move || {
        let mut output = Vec::new();
        let result = stdout.take(65537).read_to_end(&mut output);
        (result, output)
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait().map_err(|_| "无法读取启动状态")? {
            Some(status) => break status,
            None => {}
        }
        if started.elapsed() > Duration::from_secs(125) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("AI 会话启动超时，请重试".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let (read, output) = reader.join().map_err(|_| "无法读取启动结果")?;
    read.map_err(|_| "无法读取启动结果")?;
    if output.len() > 65536 {
        return Err("AI 会话返回内容过长".into());
    }
    let value: serde_json::Value =
        serde_json::from_slice(&output).map_err(|_| "AI 会话返回了无效结果")?;
    if !status.success() {
        return Err(value
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("AI 会话启动失败")
            .to_string());
    }
    let result: LaunchResult =
        serde_json::from_value(value).map_err(|_| "AI 会话未返回真实线程标识")?;
    if !valid_id(&result.native_session_id)
        || result.deep_link != format!("codex://threads/{}", result.native_session_id)
    {
        return Err("AI 会话线程标识无效".into());
    }
    // Save the real ID before HTTP attach, so a transient network failure can retry the same thread.
    write_private(&path.with_file_name("launch.json"), &result)?;
    Ok(result)
}
#[tauri::command]
pub fn work_session_activate(app: tauri::AppHandle, session: Session) -> Result<(), String> {
    validate_session(&session)?;
    let path = profile_path(&app, &session.id)?;
    let mut profile = read_profile(&path)?;
    validate_current_profile(&app, &profile, &session)?;
    if session.status != "active" {
        return Err("会话绑定与本机记录不一致".into());
    }
    let native = session
        .native_session_id
        .as_deref()
        .ok_or("会话尚未绑定 AI 线程")?;
    if profile
        .session
        .native_session_id
        .as_deref()
        .is_some_and(|id| id != native)
    {
        return Err("工作会话不能更换 AI 线程".into());
    }
    let threads = root(&app)?.join("threads");
    private_dir(&threads)?;
    let host_dir = threads.join(&session.host);
    private_dir(&host_dir)?;
    let index_path = host_dir.join(format!("{native}.json"));
    if index_path.exists() {
        let index: ThreadIndex = serde_json::from_slice(&read_private_bytes(&index_path)?)
            .map_err(|_| "线程索引无效")?;
        if index.binding_id != session.id
            || index.host != session.host
            || index.native_session_id != native
        {
            return Err("该 AI 线程已属于另一项任务".into());
        }
    } else {
        write_private(
            &index_path,
            &ThreadIndex {
                binding_id: session.id.clone(),
                host: session.host.clone(),
                native_session_id: native.to_owned(),
                revoked: false,
            },
        )?;
    }
    profile.session = session;
    write_private(&path, &profile)
}
#[tauri::command]
pub fn work_session_open(
    app: tauri::AppHandle,
    binding_id: String,
    expected_session: Session,
) -> Result<(), String> {
    let profile = read_profile(&profile_path(&app, &binding_id)?)?;
    validate_current_profile(&app, &profile, &expected_session)?;
    if profile.session.status != "active" || profile.session.host != "codex" {
        return Err("工作会话尚未激活".into());
    }
    let native = profile
        .session
        .native_session_id
        .as_deref()
        .ok_or("缺少 AI 线程绑定")?;
    let link = format!("codex://threads/{native}");
    #[cfg(target_os = "macos")]
    let result = Command::new("/usr/bin/open").arg(&link).status();
    #[cfg(target_os = "windows")]
    let result = Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &link])
        .status();
    #[cfg(target_os = "linux")]
    let result = Command::new("xdg-open").arg(&link).status();
    if result
        .map_err(|_| "无法打开 Codex，请确认已安装桌面客户端")?
        .success()
    {
        Ok(())
    } else {
        Err("系统未能打开 Codex，请确认已安装桌面客户端".into())
    }
}
#[tauri::command]
pub fn work_session_forget(app: tauri::AppHandle, binding_id: String) -> Result<(), String> {
    let path = profile_path(&app, &binding_id)?;
    if !path.exists() {
        return Ok(());
    }
    let profile = read_profile(&path)?;
    if let Some(native) = profile.session.native_session_id {
        let index_path = root(&app)?
            .join("threads")
            .join(&profile.session.host)
            .join(format!("{native}.json"));
        if index_path.exists() {
            let index: ThreadIndex = serde_json::from_slice(&read_private_bytes(&index_path)?)
                .map_err(|_| "线程索引无效")?;
            if index.binding_id == binding_id {
                write_private(
                    &index_path,
                    &ThreadIndex {
                        revoked: true,
                        ..index
                    },
                )?;
            }
        }
    }
    fs::remove_file(path).map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duplicate_launch_does_not_create_second_thread() {
        let first = LaunchGuard::acquire("fixture-concurrent").unwrap();
        assert!(LaunchGuard::acquire("fixture-concurrent").is_err());
        assert!(LaunchGuard::acquire("fixture-independent").is_ok());
        drop(first);
        assert!(LaunchGuard::acquire("fixture-concurrent").is_ok());
    }
    #[test]
    fn ids_reject_path_traversal() {
        for id in ["", "../test", "/tmp/x", "a/b", "x.json", "a b"] {
            assert!(!valid_id(id));
        }
        assert!(valid_id("019aaa-1234_test"));
    }
    #[test]
    fn private_profile_roundtrip() {
        let dir = std::env::temp_dir().join(format!(
            "io-session-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        private_dir(&dir).unwrap();
        let path = dir.join("fixture.json");
        write_private(&path, &serde_json::json!({"safe":"fixture"})).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            assert_eq!(fs::metadata(&path).unwrap().mode() & 0o777, 0o600);
            assert_eq!(fs::metadata(&dir).unwrap().mode() & 0o777, 0o700);
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
