package platform

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Entity payloads are separately persisted, not one shared application snapshot.
// A project row lock is the transaction boundary for its cross-entity invariants.
const migration = `
CREATE TABLE IF NOT EXISTS io_members (
 id text PRIMARY KEY, name text NOT NULL, role text NOT NULL CHECK (role IN ('admin','member')),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL,
 token_hash text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS io_projects (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS io_nodes (id text PRIMARY KEY, project_id text NOT NULL REFERENCES io_projects(id), data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS io_tasks (id text PRIMARY KEY, project_id text NOT NULL REFERENCES io_projects(id), data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS io_memories (id text PRIMARY KEY, project_id text NOT NULL REFERENCES io_projects(id), data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS io_memory_versions (memory_id text NOT NULL REFERENCES io_memories(id), version integer NOT NULL, data jsonb NOT NULL, PRIMARY KEY(memory_id,version));
CREATE TABLE IF NOT EXISTS io_issues (id text PRIMARY KEY, project_id text NOT NULL REFERENCES io_projects(id), data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS io_events (id text PRIMARY KEY, project_id text NOT NULL REFERENCES io_projects(id), data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS io_handovers (id text PRIMARY KEY, project_id text NOT NULL REFERENCES io_projects(id), data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS io_usage (id text PRIMARY KEY, project_id text NOT NULL REFERENCES io_projects(id), member_id text NOT NULL REFERENCES io_members(id), host text NOT NULL, request_id text NOT NULL, data jsonb NOT NULL, UNIQUE(member_id,host,request_id));
CREATE INDEX IF NOT EXISTS io_nodes_project_idx ON io_nodes(project_id);
CREATE INDEX IF NOT EXISTS io_tasks_project_idx ON io_tasks(project_id);
CREATE INDEX IF NOT EXISTS io_memories_project_idx ON io_memories(project_id);
CREATE INDEX IF NOT EXISTS io_issues_project_idx ON io_issues(project_id);
CREATE INDEX IF NOT EXISTS io_events_project_idx ON io_events(project_id);
CREATE INDEX IF NOT EXISTS io_handovers_project_idx ON io_handovers(project_id);
CREATE INDEX IF NOT EXISTS io_usage_project_idx ON io_usage(project_id);
CREATE TABLE IF NOT EXISTS io_conversations(id text PRIMARY KEY, scope_key text UNIQUE, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS io_messages(seq bigserial UNIQUE NOT NULL, id text PRIMARY KEY, conversation_id text NOT NULL REFERENCES io_conversations(id), data jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS io_messages_conversation_idx ON io_messages(conversation_id,seq);
CREATE TABLE IF NOT EXISTS io_receipts(conversation_id text NOT NULL REFERENCES io_conversations(id),member_id text NOT NULL REFERENCES io_members(id),message_id text NOT NULL REFERENCES io_messages(id),seq bigint NOT NULL,read_at timestamptz NOT NULL,PRIMARY KEY(conversation_id,member_id));
CREATE TABLE IF NOT EXISTS io_notifications(id text PRIMARY KEY,project_id text NOT NULL REFERENCES io_projects(id),member_id text NOT NULL REFERENCES io_members(id),data jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS io_notifications_member_idx ON io_notifications(member_id);


`

type Store struct{ Pool *pgxpool.Pool }

func Open(ctx context.Context, databaseURL, adminToken string) (*Store, error) {
	if len(adminToken) < 16 {
		return nil, errors.New("IO_ADMIN_TOKEN must contain at least 16 characters")
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	s := &Store{pool}
	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		pool.Close()
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(740019231)"); err == nil {
		_, err = tx.Exec(ctx, migration)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO io_members(id,name,role,active,created_at,token_hash) VALUES('admin','管理员','admin',true,$1,$2) ON CONFLICT(id) DO UPDATE SET token_hash=EXCLUDED.token_hash, active=true, role='admin'`, time.Now().UTC(), hashToken(adminToken))
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		pool.Close()
		return nil, err
	}
	return s, nil
}
func hashToken(s string) string { v := sha256.Sum256([]byte(s)); return hex.EncodeToString(v[:]) }
func newID(prefix string) string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return prefix + "_" + hex.EncodeToString(b[:])
}
func newToken() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return "io_" + hex.EncodeToString(b[:])
}
func memberScan(row pgx.Row) (Member, error) {
	var m Member
	err := row.Scan(&m.ID, &m.Name, &m.Role, &m.Active, &m.CreatedAt)
	return m, err
}
func (s *Store) Authenticate(ctx context.Context, token string) (Member, error) {
	return memberScan(s.Pool.QueryRow(ctx, `SELECT id,name,role,active,created_at FROM io_members WHERE token_hash=$1 AND active=true`, hashToken(token)))
}
func members(ctx context.Context, tx pgx.Tx) ([]Member, error) {
	rows, err := tx.Query(ctx, `SELECT id,name,role,active,created_at FROM io_members ORDER BY created_at,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Member{}
	for rows.Next() {
		m, err := memberScan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
func memberByID(ctx context.Context, tx pgx.Tx, id string) (Member, error) {
	m, err := memberScan(tx.QueryRow(ctx, `SELECT id,name,role,active,created_at FROM io_members WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return m, invalid("成员不存在")
	}
	return m, err
}
func getJSON[T any](ctx context.Context, tx pgx.Tx, table, id, pid string) (T, error) {
	var v T
	var b []byte
	sql := "SELECT data FROM " + table + " WHERE id=$1"
	args := []any{id}
	if pid != "" {
		sql += " AND project_id=$2"
		args = append(args, pid)
	}
	err := tx.QueryRow(ctx, sql, args...).Scan(&b)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, missing("记录不存在")
	}
	if err != nil {
		return v, err
	}
	err = json.Unmarshal(b, &v)
	return v, err
}
func listJSON[T any](ctx context.Context, tx pgx.Tx, table, pid string) ([]T, error) {
	sql := "SELECT data FROM " + table
	args := []any{}
	if pid != "" {
		sql += " WHERE project_id=$1"
		args = append(args, pid)
	}
	sql += " ORDER BY id"
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []T{}
	for rows.Next() {
		var b []byte
		var v T
		if err = rows.Scan(&b); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(b, &v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func putJSON(ctx context.Context, tx pgx.Tx, table, id, pid string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if table == "io_projects" {
		_, err = tx.Exec(ctx, `INSERT INTO io_projects(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data`, id, b)
	} else {
		_, err = tx.Exec(ctx, "INSERT INTO "+table+"(id,project_id,data) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data", id, pid, b)
	}
	return err
}
func addEvent(ctx context.Context, tx pgx.Tx, pid, actor, kind, message string) error {
	v := Event{newID("evt"), pid, actor, kind, message, time.Now().UTC()}
	return putJSON(ctx, tx, "io_events", v.ID, pid, v)
}
func isAdmin(m Member) bool { return m.Role == "admin" }
func has(xs []string, id string) bool {
	for _, x := range xs {
		if x == id {
			return true
		}
	}
	return false
}
func unique(xs []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, x := range xs {
		if x != "" && !seen[x] {
			out = append(out, x)
			seen[x] = true
		}
	}
	return out
}
func replace(xs []string, from, to string) []string {
	out := []string{}
	for _, x := range xs {
		if x == from {
			x = to
		}
		out = append(out, x)
	}
	return unique(out)
}
func (s *Store) projectTx(ctx context.Context, m Member, pid string, write bool, fn func(pgx.Tx, Project) error) error {
	opts := pgx.TxOptions{}
	if !write {
		opts.IsoLevel = pgx.RepeatableRead
		opts.AccessMode = pgx.ReadOnly
	}
	tx, err := s.Pool.BeginTx(ctx, opts)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Auth is repeated in the transaction to prevent using a revoked identity.
	var active bool
	authQuery := `SELECT active FROM io_members WHERE id=$1`
	if write {
		authQuery += " FOR SHARE"
	}
	if err = tx.QueryRow(ctx, authQuery, m.ID).Scan(&active); err != nil {
		return err
	}
	if !active {
		return forbidden("成员已停用")
	}
	q := `SELECT data FROM io_projects WHERE id=$1`
	if write {
		q += " FOR UPDATE"
	}
	var b []byte
	if err = tx.QueryRow(ctx, q, pid).Scan(&b); errors.Is(err, pgx.ErrNoRows) {
		return missing("项目不存在")
	}
	if err != nil {
		return err
	}
	var p Project
	if err = json.Unmarshal(b, &p); err != nil {
		return err
	}
	if !isAdmin(m) {
		var allowed bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM io_nodes WHERE project_id=$1 AND ((data->'memberIds') ? $2 OR (data->'ownerIds') ? $2))`, pid, m.ID).Scan(&allowed)
		if err != nil {
			return err
		}
		if !allowed {
			return forbidden("你没有该项目的访问权限")
		}
	}
	if err = fn(tx, p); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func snapshot(ctx context.Context, tx pgx.Tx, p Project) (Snapshot, error) {
	s := Snapshot{Project: p}
	var err error
	if s.Nodes, err = listJSON[Node](ctx, tx, "io_nodes", p.ID); err != nil {
		return s, err
	}
	sort.Slice(s.Nodes, func(i, j int) bool { return s.Nodes[i].Position < s.Nodes[j].Position })
	if s.Tasks, err = listJSON[Task](ctx, tx, "io_tasks", p.ID); err != nil {
		return s, err
	}
	if s.Memories, err = listJSON[Memory](ctx, tx, "io_memories", p.ID); err != nil {
		return s, err
	}
	if s.Issues, err = listJSON[Issue](ctx, tx, "io_issues", p.ID); err != nil {
		return s, err
	}
	if s.Events, err = listJSON[Event](ctx, tx, "io_events", p.ID); err != nil {
		return s, err
	}
	sort.Slice(s.Events, func(i, j int) bool { return s.Events[i].CreatedAt.After(s.Events[j].CreatedAt) })
	if s.Usage, err = listJSON[Usage](ctx, tx, "io_usage", p.ID); err != nil {
		return s, err
	}
	if s.Handovers, err = listJSON[Handover](ctx, tx, "io_handovers", p.ID); err != nil {
		return s, err
	}
	all, err := members(ctx, tx)
	if err != nil {
		return s, err
	}
	ids := map[string]bool{"admin": true}
	for _, n := range s.Nodes {
		for _, id := range append(append([]string{}, n.OwnerIDs...), n.MemberIDs...) {
			ids[id] = true
		}
	}
	for _, t := range s.Tasks {
		ids[t.OwnerID] = true
		ids[t.ReviewerID] = true
		for _, id := range t.CollaboratorIDs {
			ids[id] = true
		}
	}
	for _, e := range s.Events {
		ids[e.ActorID] = true
	}
	for _, h := range s.Handovers {
		ids[h.FromMemberID] = true
		ids[h.ToMemberID] = true
	}
	for _, u := range s.Usage {
		ids[u.MemberID] = true
	}
	s.Members = []Member{}
	for _, m := range all {
		if ids[m.ID] {
			s.Members = append(s.Members, m)
		}
	}
	return s, nil
}
func defaultNodes(ctx context.Context, tx pgx.Tx, pid string) error {
	for i, name := range []string{"售前", "产品经理", "UI与UE", "前端开发", "后端开发", "部署", "测试", "交付"} {
		n := Node{newID("node"), pid, name, i, []string{}, []string{}}
		if err := putJSON(ctx, tx, "io_nodes", n.ID, pid, n); err != nil {
			return err
		}
	}
	return nil
}
func validateActive(ctx context.Context, tx pgx.Tx, ids []string) error {
	ids = unique(ids)
	sort.Strings(ids)
	for _, id := range ids {
		var active bool
		err := tx.QueryRow(ctx, `SELECT active FROM io_members WHERE id=$1 FOR SHARE`, id).Scan(&active)
		if errors.Is(err, pgx.ErrNoRows) {
			return invalid("成员不存在")
		}
		if err != nil {
			return err
		}
		if !active {
			return invalid("不能分配给已停用成员")
		}
	}
	return nil
}
func eligibleMemory(ms []Memory, t Task) []Memory {
	out := []Memory{}
	for _, m := range ms {
		if m.Status == "published" && (m.NodeID == "" || m.NodeID == t.NodeID) {
			out = append(out, m)
		}
	}
	return out
}
func refs(ms []Memory) map[string]int {
	out := map[string]int{}
	for _, m := range ms {
		out[m.ID] = m.Version
	}
	return out
}
func changedMemory(all []Memory, t Task) []Memory {
	out := []Memory{}
	for _, m := range all {
		current := m.Status == "published" && (m.NodeID == "" || m.NodeID == t.NodeID)
		v, old := t.MemoryRefs[m.ID]
		if (current && (!old || v != m.Version)) || (old && !current) {
			out = append(out, m)
		}
	}
	return out
}
func ensureBaseline(ctx context.Context, tx pgx.Tx, t Task) error {
	ms, err := listJSON[Memory](ctx, tx, "io_memories", t.ProjectID)
	if err != nil {
		return err
	}
	if len(changedMemory(ms, t)) > 0 {
		return conflict("共享记忆已变更，请读取任务上下文并同步基线后再提交或验收", "stale_memory")
	}
	return nil
}
func canWork(m Member, n Node, t Task) bool {
	return isAdmin(m) || has(n.OwnerIDs, m.ID) || t.OwnerID == m.ID || has(t.CollaboratorIDs, m.ID)
}
func checkVersion(expected, actual int) error {
	if expected != actual {
		return conflict(fmt.Sprintf("版本冲突：当前版本为 %d，请刷新后重试", actual), "version_conflict")
	}
	return nil
}
