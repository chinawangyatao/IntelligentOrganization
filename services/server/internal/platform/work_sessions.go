package platform

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type WorkSession struct {
	ID                string    `json:"id"`
	ServiceInstanceID string    `json:"serviceInstanceId"`
	MemberID          string    `json:"memberId"`
	ProjectID         string    `json:"projectId"`
	TaskID            string    `json:"taskId"`
	NodeID            string    `json:"nodeId"`
	Host              string    `json:"host"`
	NativeSessionID   string    `json:"nativeSessionId,omitempty"`
	Status            string    `json:"status"`
	CreatedAt         time.Time `json:"createdAt"`
	ExpiresAt         time.Time `json:"expiresAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type grantScope struct {
	Session        WorkSession
	AssignmentHash string
	ThreadID       string
}
type grantKey struct{}

var nativeSessionPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$`)

func workScope(ctx context.Context) *grantScope {
	scope, _ := ctx.Value(grantKey{}).(*grantScope)
	return scope
}

const workSessionColumns = `id,service_instance_id,member_id,project_id,task_id,node_id,host,coalesce(native_session_id,''),status,created_at,expires_at,updated_at,assignment_hash`

func scanWorkSession(row pgx.Row) (grantScope, error) {
	var scope grantScope
	s := &scope.Session
	err := row.Scan(&s.ID, &s.ServiceInstanceID, &s.MemberID, &s.ProjectID, &s.TaskID, &s.NodeID, &s.Host, &s.NativeSessionID, &s.Status, &s.CreatedAt, &s.ExpiresAt, &s.UpdatedAt, &scope.AssignmentHash)
	// pgx may scan timestamptz in the local zone. Keep API timestamps identical
	// to the UTC values returned when a session was created or updated.
	s.CreatedAt = s.CreatedAt.UTC()
	s.ExpiresAt = s.ExpiresAt.UTC()
	s.UpdatedAt = s.UpdatedAt.UTC()
	return scope, err
}
func effectiveSession(s WorkSession) WorkSession {
	if s.Status != "revoked" && !time.Now().Before(s.ExpiresAt) {
		s.Status = "expired"
	}
	return s
}
func assignmentHash(t Task, n Node) string {
	collaborators := append([]string{}, t.CollaboratorIDs...)
	owners := append([]string{}, n.OwnerIDs...)
	sort.Strings(collaborators)
	sort.Strings(owners)
	data, _ := json.Marshal([]any{t.OwnerID, collaborators, n.ID, owners})
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
func (s *Store) sessionByID(ctx context.Context, tx pgx.Tx, id, lock string) (grantScope, error) {
	value, err := scanWorkSession(tx.QueryRow(ctx, "SELECT "+workSessionColumns+" FROM io_work_sessions WHERE id=$1"+lock, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return value, missing("工作会话不存在")
	}
	return value, err
}
func validateWorkSession(ctx context.Context, tx pgx.Tx, scope grantScope, write bool) (Member, error) {
	session := scope.Session
	if session.Status == "revoked" {
		return Member{}, &apiError{403, "此 AI 工作会话已撤销，请从 App 重新开始任务", "session_revoked"}
	}
	if !time.Now().Before(session.ExpiresAt) || session.Status == "expired" {
		return Member{}, &apiError{403, "AI 工作会话已到期，请从 App 重新开始任务", "session_expired"}
	}
	if !enum(session.Status, "prepared", "active") {
		return Member{}, forbidden("工作会话状态无效")
	}
	if write && session.Status != "active" {
		return Member{}, &apiError{409, "AI 宿主尚未完成会话绑定，不能写入任务", "session_not_active"}
	}
	if scope.ThreadID != "" && (session.NativeSessionID == "" || session.NativeSessionID != scope.ThreadID) {
		return Member{}, &apiError{403, "AI 线程与当前任务绑定不匹配，请为新线程创建独立会话", "session_thread_mismatch"}
	}
	m, err := memberByID(ctx, tx, session.MemberID)
	if err != nil {
		return m, err
	}
	if !m.Active {
		return m, forbidden("成员已停用")
	}
	if !isAdmin(m) {
		var allowed bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM io_nodes WHERE project_id=$1 AND ((data->'memberIds') ? $2 OR (data->'ownerIds') ? $2))`, session.ProjectID, m.ID).Scan(&allowed); err != nil {
			return m, err
		}
		if !allowed {
			return m, forbidden("你已没有该项目的访问权限")
		}
	}
	t, err := getJSON[Task](ctx, tx, "io_tasks", session.TaskID, session.ProjectID)
	if err != nil {
		return m, err
	}
	n, err := getJSON[Node](ctx, tx, "io_nodes", t.NodeID, session.ProjectID)
	if err != nil {
		return m, err
	}
	if t.NodeID != session.NodeID || !canWork(m, n, t) || assignmentHash(t, n) != scope.AssignmentHash {
		return m, &apiError{403, "任务职责已变更，请在 App 确认分工后创建新的 AI 工作会话", "session_responsibility_changed"}
	}
	return m, nil
}
func (s *Store) authenticateWorkSession(ctx context.Context, token, threadID string) (Member, *grantScope, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Member{}, nil, err
	}
	defer tx.Rollback(ctx)
	scope, err := scanWorkSession(tx.QueryRow(ctx, "SELECT "+workSessionColumns+" FROM io_work_sessions WHERE token_hash=$1", hashToken(token)))
	if err != nil {
		return Member{}, nil, err
	}
	scope.ThreadID = threadID
	m, err := validateWorkSession(ctx, tx, scope, false)
	if err != nil {
		return Member{}, nil, err
	}
	return m, &scope, nil
}
func (s *Store) recheckWorkScope(ctx context.Context, tx pgx.Tx, pid string, write bool) error {
	scope := workScope(ctx)
	if scope == nil {
		return nil
	}
	if scope.Session.ProjectID != pid {
		return forbidden("工作会话不能访问其他项目")
	}
	lock := ""
	if write {
		lock = " FOR SHARE"
	}
	current, err := s.sessionByID(ctx, tx, scope.Session.ID, lock)
	if err != nil {
		return err
	}
	if current.Session.MemberID != scope.Session.MemberID || current.Session.ProjectID != scope.Session.ProjectID || current.Session.TaskID != scope.Session.TaskID || current.Session.Host != scope.Session.Host {
		return forbidden("工作会话绑定发生异常变化")
	}
	current.ThreadID = scope.ThreadID
	_, err = validateWorkSession(ctx, tx, current, write)
	return err
}
func authorizeGrantRoute(r *http.Request, scope *grantScope) error {
	if scope == nil {
		return nil
	}
	p := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(p) == 2 && p[0] == "api" && r.Method == "GET" && enum(p[1], "me", "projects") {
		return nil
	}
	if len(p) == 3 && p[0] == "api" && p[1] == "agent" && r.Method == "GET" && enum(p[2], "context", "session") {
		return nil
	}
	if len(p) < 4 || p[0] != "api" || p[1] != "projects" || p[2] != scope.Session.ProjectID {
		return forbidden("此 AI 凭证仅能访问绑定任务，不具有组织管理或会话聊天权限")
	}
	if len(p) == 4 && p[3] == "snapshot" && r.Method == "GET" {
		return nil
	}
	if len(p) == 4 && enum(p[3], "memories", "issues", "usage") && r.Method == "POST" {
		return nil
	}
	if len(p) >= 5 && p[3] == "tasks" && p[4] == scope.Session.TaskID {
		if len(p) == 5 && r.Method == "PATCH" {
			return nil
		}
		if len(p) == 6 && ((p[5] == "context" && r.Method == "GET") || (enum(p[5], "sync", "submit") && r.Method == "POST")) {
			return nil
		}
	}
	if len(p) == 5 && p[3] == "memories" && r.Method == "PATCH" {
		return nil
	}
	if len(p) == 6 && p[3] == "memories" && p[5] == "history" && r.Method == "GET" {
		return nil
	}
	return forbidden("此 AI 凭证不允许执行该操作")
}
func (s *Store) createWorkSession(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		Host string `json:"host"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if !enum(in.Host, "codex", "deepseek-harness") {
		return nil, invalid("AI 宿主无效")
	}
	a := actor(r)
	ctx := r.Context()
	var session WorkSession
	token := "io_grant_" + strings.TrimPrefix(newToken(), "io_")
	err := s.projectTx(ctx, a, r.PathValue("pid"), true, func(tx pgx.Tx, p Project) error {
		t, err := getJSON[Task](ctx, tx, "io_tasks", r.PathValue("id"), p.ID)
		if err != nil {
			return err
		}
		n, err := getJSON[Node](ctx, tx, "io_nodes", t.NodeID, p.ID)
		if err != nil {
			return err
		}
		if !canWork(a, n, t) {
			return forbidden("你没有该任务的执行权限")
		}
		if t.Status == "done" {
			return conflict("任务已经验收，请为后续工作创建新任务", "completed_task")
		}
		var instanceID string
		if err = tx.QueryRow(ctx, `SELECT value FROM io_workspace_metadata WHERE key='instance_id'`).Scan(&instanceID); err != nil {
			return err
		}
		now := time.Now().UTC().Truncate(time.Microsecond)
		session = WorkSession{ID: newID("session"), ServiceInstanceID: instanceID, MemberID: a.ID, ProjectID: p.ID, TaskID: t.ID, NodeID: n.ID, Host: in.Host, Status: "prepared", CreatedAt: now, ExpiresAt: now.Add(24 * time.Hour), UpdatedAt: now}
		_, err = tx.Exec(ctx, `INSERT INTO io_work_sessions(id,service_instance_id,member_id,project_id,task_id,node_id,host,status,created_at,expires_at,updated_at,token_hash,assignment_hash)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, session.ID, instanceID, a.ID, p.ID, t.ID, n.ID, in.Host, session.Status, now, session.ExpiresAt, now, hashToken(token), assignmentHash(t, n))
		if err != nil {
			return err
		}
		return addEvent(ctx, tx, p.ID, a.ID, "work_session.prepared", "为任务「"+t.Title+"」准备 "+in.Host+" AI 工作会话")
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"session": session, "token": token}, nil
}
func (s *Store) listWorkSessions(w http.ResponseWriter, r *http.Request) (any, error) {
	a := actor(r)
	ctx := r.Context()
	out := []WorkSession{}
	err := s.projectTx(ctx, a, r.PathValue("pid"), false, func(tx pgx.Tx, p Project) error {
		if _, err := getJSON[Task](ctx, tx, "io_tasks", r.PathValue("id"), p.ID); err != nil {
			return err
		}
		query := "SELECT " + workSessionColumns + " FROM io_work_sessions WHERE project_id=$1 AND task_id=$2"
		args := []any{p.ID, r.PathValue("id")}
		if !isAdmin(a) {
			query += " AND member_id=$3"
			args = append(args, a.ID)
		}
		query += " ORDER BY created_at DESC,id"
		rows, err := tx.Query(ctx, query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			v, e := scanWorkSession(rows)
			if e != nil {
				return e
			}
			out = append(out, effectiveSession(v.Session))
		}
		return rows.Err()
	})
	return out, err
}
func (s *Store) attachWorkSession(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		NativeSessionID string `json:"nativeSessionId"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	in.NativeSessionID = strings.TrimSpace(in.NativeSessionID)
	if !nativeSessionPattern.MatchString(in.NativeSessionID) {
		return nil, invalid("宿主会话ID格式无效")
	}
	a := actor(r)
	ctx := r.Context()
	var initial grantScope
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	initial, err = s.sessionByID(ctx, tx, r.PathValue("id"), "")
	_ = tx.Rollback(ctx)
	if err != nil {
		return nil, err
	}
	if initial.Session.MemberID != a.ID && !isAdmin(a) {
		return nil, forbidden("仅会话所有者或管理员可以连接宿主会话")
	}
	var out WorkSession
	err = s.projectTx(ctx, a, initial.Session.ProjectID, true, func(tx pgx.Tx, p Project) error {
		current, err := s.sessionByID(ctx, tx, initial.Session.ID, " FOR UPDATE")
		if err != nil {
			return err
		}
		if _, err = validateWorkSession(ctx, tx, current, false); err != nil {
			return err
		}
		if current.Session.NativeSessionID != "" {
			if current.Session.NativeSessionID != in.NativeSessionID {
				return conflict("AI 工作会话已绑定其他宿主线程，不能改绑", "session_already_attached")
			}
			out = current.Session
			return nil
		}
		now := time.Now().UTC().Truncate(time.Microsecond)
		_, err = tx.Exec(ctx, `UPDATE io_work_sessions SET native_session_id=$2,status='active',updated_at=$3 WHERE id=$1`, current.Session.ID, in.NativeSessionID, now)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return conflict("该宿主线程已用于其他任务，请创建新线程", "native_session_in_use")
			}
			return err
		}
		out = current.Session
		out.NativeSessionID = in.NativeSessionID
		out.Status = "active"
		out.UpdatedAt = now
		return addEvent(ctx, tx, p.ID, a.ID, "work_session.attached", "AI 工作会话已连接宿主线程")
	})
	return out, err
}
func (s *Store) revokeWorkSession(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	a := actor(r)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	// Revoke uses its own transaction, so repeat the actor activity check here
	// instead of relying on the earlier HTTP authentication snapshot.
	var active bool
	if err = tx.QueryRow(ctx, `SELECT active FROM io_members WHERE id=$1 FOR SHARE`, a.ID).Scan(&active); err != nil {
		return nil, err
	}
	if !active {
		return nil, forbidden("成员已停用")
	}
	current, err := s.sessionByID(ctx, tx, r.PathValue("id"), " FOR UPDATE")
	if err != nil {
		return nil, err
	}
	if current.Session.MemberID != a.ID && !isAdmin(a) {
		return nil, forbidden("仅会话所有者或管理员可以撤销会话")
	}
	if current.Session.Status != "revoked" {
		current.Session.Status = "revoked"
		current.Session.UpdatedAt = time.Now().UTC().Truncate(time.Microsecond)
		if _, err = tx.Exec(ctx, `UPDATE io_work_sessions SET status='revoked',updated_at=$2 WHERE id=$1`, current.Session.ID, current.Session.UpdatedAt); err != nil {
			return nil, err
		}
	}
	return current.Session, tx.Commit(ctx)
}
func (s *Store) agentSession(w http.ResponseWriter, r *http.Request) (any, error) {
	scope := workScope(r.Context())
	if scope == nil {
		return nil, forbidden("此接口需要绑定任务的 AI 会话凭证")
	}
	return effectiveSession(scope.Session), nil
}
func (s *Store) agentContext(w http.ResponseWriter, r *http.Request) (any, error) {
	scope := workScope(r.Context())
	if scope == nil {
		return nil, forbidden("此接口需要绑定任务的 AI 会话凭证")
	}
	var context TaskContext
	err := s.projectTx(r.Context(), actor(r), scope.Session.ProjectID, false, func(tx pgx.Tx, p Project) error {
		t, err := getJSON[Task](r.Context(), tx, "io_tasks", scope.Session.TaskID, p.ID)
		if err != nil {
			return err
		}
		memories, err := listJSON[Memory](r.Context(), tx, "io_memories", p.ID)
		if err != nil {
			return err
		}
		issues, err := listJSON[Issue](r.Context(), tx, "io_issues", p.ID)
		if err != nil {
			return err
		}
		relevant := []Issue{}
		for _, issue := range issues {
			if issue.TaskID == t.ID || issue.NodeID == t.NodeID {
				relevant = append(relevant, issue)
			}
		}
		changes := changedMemory(memories, t)
		context = TaskContext{Project: p, Task: t, Memories: eligibleMemory(memories, t), Issues: relevant, Stale: len(changes) > 0, Changes: changes}
		return nil
	})
	return map[string]any{"session": scope.Session, "context": context}, err
}
