#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;

const SERVICE: &str = "com.weimeng.intelligent-organization";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Connection { base_url: String, token: String }
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Endpoint { base_url: String }

fn validate_endpoint(value: &str) -> Result<String, String> {
    let parsed = url::Url::parse(value).map_err(|_| "服务地址不是有效 URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none()
        || !parsed.username().is_empty() || parsed.password().is_some()
        || parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("服务地址须为 HTTP/HTTPS 地址，不能含凭证、查询或片段".into());
    }
    Ok(parsed.as_str().trim_end_matches('/').to_owned())
}
fn entry(base_url: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, base_url).map_err(|e| format!("无法访问系统凭证库：{e}"))
}
#[tauri::command]
fn connection_load(app: tauri::AppHandle) -> Result<Option<Connection>, String> {
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("connection.json");
    if !path.exists() { return Ok(None); }
    let endpoint: Endpoint = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let base_url = validate_endpoint(&endpoint.base_url)?;
    let token = match entry(&base_url)?.get_password() {
        Ok(token) => token,
        Err(keyring::Error::NoEntry) => String::new(),
        Err(e) => return Err(format!("无法读取系统凭证：{e}")),
    };
    Ok(Some(Connection { base_url, token }))
}
#[tauri::command]
fn connection_save(app: tauri::AppHandle, connection: Connection) -> Result<(), String> {
    let base_url = validate_endpoint(&connection.base_url)?;
    let token = connection.token.trim();
    if token.is_empty() { return Err("成员访问令牌不能为空".into()); }
    entry(&base_url)?.set_password(token).map_err(|e| format!("无法保存系统凭证：{e}"))?;
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("connection.json");
    let temporary = dir.join("connection.json.tmp");
    fs::write(&temporary, serde_json::to_vec(&Endpoint { base_url }).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    fs::rename(temporary, path).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn connection_clear(app: tauri::AppHandle) -> Result<(), String> {
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("connection.json");
    if path.exists() {
        let endpoint: Endpoint = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        match entry(&endpoint.base_url)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {},
            Err(e) => return Err(format!("无法移除系统凭证：{e}")),
        }
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![connection_load, connection_save, connection_clear])
        .run(tauri::generate_context!())
        .expect("无法启动智能组织桌面应用");
}

#[cfg(test)]
mod tests {
    use super::validate_endpoint;
    #[test]
    #[ignore = "requires an interactive OS credential store; uses an isolated test entry"]
    fn system_keyring_roundtrip() {
        let suffix = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let credential = keyring::Entry::new("com.weimeng.intelligent-organization.tests", &format!("test-{suffix}")).unwrap();
        credential.set_password("test-fixture-not-a-real-credential").unwrap();
        let result = credential.get_password();
        credential.delete_credential().unwrap();
        assert_eq!(result.unwrap(), "test-fixture-not-a-real-credential");
    }
    #[test]
    fn endpoint_validation() {
        assert_eq!(validate_endpoint("http://127.0.0.1:17890/").unwrap(), "http://127.0.0.1:17890");
        assert!(validate_endpoint("https://user:secret@example.org").is_err());
        assert!(validate_endpoint("file:///etc/passwd").is_err());
        assert!(validate_endpoint("https://example.org?token=x").is_err());
    }
}
