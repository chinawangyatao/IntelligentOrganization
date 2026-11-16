package platform

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Store) listMembers(w http.ResponseWriter, r *http.Request) (any, error) {
	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(r.Context())
	return members(r.Context(), tx)
}
func (s *Store) createMember(w http.ResponseWriter, r *http.Request) (any, error) {
	m := actor(r)
	if err := requireAdmin(m); err != nil {
		return nil, err
	}
	var in struct {
		Name string `json:"name"`
		Role string `json:"role"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	in.Name = strings.TrimSpace(in.Name)
	if err := validText(in.Name, "姓名", 120); err != nil {
		return nil, err
	}
	if in.Role == "" {
		in.Role = "member"
	}
	if !enum(in.Role, "member", "admin") {
		return nil, invalid("角色无效")
	}
	v := Member{newID("member"), in.Name, in.Role, true, time.Now().UTC()}
	token := newToken()
	_, err := s.Pool.Exec(r.Context(), `INSERT INTO io_members(id,name,role,active,created_at,token_hash) VALUES($1,$2,$3,true,$4,$5)`, v.ID, v.Name, v.Role, v.CreatedAt, hashToken(token))
	return map[string]any{"member": v, "token": token}, err
}
func (s *Store) deactivateMember(w http.ResponseWriter, r *http.Request) (any, error) {
	a := actor(r)
	if err := requireAdmin(a); err != nil {
		return nil, err
	}
	id := r.PathValue("id")
	if id == a.ID || id == "admin" {
		return nil, invalid("不能停用当前管理员或引导管理员")
	}
	ctx := r.Context()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	// Lock member before checking assignments; assignment mutations take the same lock.
	m, err := memberScan(tx.QueryRow(ctx, `SELECT id,name,role,active,created_at FROM io_members WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		return nil, missing("成员不存在")
	}
	var busy bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM io_nodes WHERE (data->'ownerIds') ? $1) OR EXISTS(SELECT 1 FROM io_tasks WHERE data->>'status'<>'done' AND (data->>'ownerId'=$1 OR data->>'reviewerId'=$1 OR (data->'collaboratorIds') ? $1)) OR EXISTS(SELECT 1 FROM io_issues WHERE data->>'status'<>'resolved' AND data->>'assigneeId'=$1)`, id).Scan(&busy)
	if err != nil {
		return nil, err
	}
	if busy {
		return nil, conflict("该成员仍有负责节点、未完成任务或问题，请先完成责任移交", "pending_responsibilities")
	}
	if _, err = tx.Exec(ctx, `UPDATE io_members SET active=false WHERE id=$1`, id); err != nil {
		return nil, err
	}
	m.Active = false
	return m, tx.Commit(ctx)
}
func (s *Store) listProjects(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	m := actor(r)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	all, err := listJSON[Project](ctx, tx, "io_projects", "")
	if err != nil {
		return nil, err
	}
	out := []Project{}
	for _, p := range all {
		if isAdmin(m) {
			out = append(out, p)
			continue
		}
		var ok bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM io_nodes WHERE project_id=$1 AND ((data->'memberIds') ? $2 OR (data->'ownerIds') ? $2))`, p.ID, m.ID).Scan(&ok); err != nil {
			return nil, err
		}
		if ok {
			out = append(out, p)
		}
	}
	return out, nil
}
func (s *Store) createProject(w http.ResponseWriter, r *http.Request) (any, error) {
	a := actor(r)
	if err := requireAdmin(a); err != nil {
		return nil, err
	}
	var in struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	in.Name = strings.TrimSpace(in.Name)
	if err := validText(in.Name, "项目名称", 200); err != nil {
		return nil, err
	}
	if len(in.Description) > 100000 {
		return nil, invalid("项目说明过长")
	}
	p := Project{ID: newID("project"), Name: in.Name, Description: in.Description, Status: "active", CreatedAt: time.Now().UTC()}
	ctx := r.Context()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err = putJSON(ctx, tx, "io_projects", p.ID, "", p); err != nil {
		return nil, err
	}
	if err = defaultNodes(ctx, tx, p.ID); err != nil {
		return nil, err
	}
	if err = ensureProjectConversation(ctx, tx, p, a.ID); err != nil {
		return nil, err
	}
	if err = addEvent(ctx, tx, p.ID, a.ID, "project.created", "创建项目「"+p.Name+"」"); err != nil {
		return nil, err
	}
	return p, tx.Commit(ctx)
}
func (s *Store) getSnapshot(w http.ResponseWriter, r *http.Request) (any, error) {
	var v Snapshot
	err := s.projectTx(r.Context(), actor(r), r.PathValue("pid"), false, func(tx pgx.Tx, p Project) error { var e error; v, e = snapshot(r.Context(), tx, p); return e })
	return v, err
}
func (s *Store) patchNode(w http.ResponseWriter, r *http.Request) (any, error) {
	a := actor(r)
	if err := requireAdmin(a); err != nil {
		return nil, err
	}
	var in struct {
		OwnerIDs  []string `json:"ownerIds"`
		MemberIDs []string `json:"memberIds"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	var n Node
	ctx := r.Context()
	err := s.projectTx(ctx, a, r.PathValue("pid"), true, func(tx pgx.Tx, p Project) error {
		var err error
		n, err = getJSON[Node](ctx, tx, "io_nodes", r.PathValue("id"), p.ID)
		if err != nil {
			return err
		}
		in.OwnerIDs = unique(in.OwnerIDs)
		in.MemberIDs = unique(append(in.MemberIDs, in.OwnerIDs...))
		if err = validateActive(ctx, tx, in.MemberIDs); err != nil {
			return err
		}
		for _, old := range n.MemberIDs {
			if !has(in.MemberIDs, old) {
				tasks, e := listJSON[Task](ctx, tx, "io_tasks", p.ID)
				if e != nil {
					return e
				}
				for _, t := range tasks {
					if t.NodeID == n.ID && t.Status != "done" && (t.OwnerID == old || t.ReviewerID == old || has(t.CollaboratorIDs, old)) {
						return conflict("移除的成员仍有本节点未完成职责，请使用责任移交", "pending_responsibilities")
					}
				}
			}
		}
		issues, e := listJSON[Issue](ctx, tx, "io_issues", p.ID)
		if e != nil {
			return e
		}
		for _, issue := range issues {
			if issue.NodeID == n.ID && issue.Status != "resolved" && has(n.MemberIDs, issue.AssigneeID) && !has(in.MemberIDs, issue.AssigneeID) {
				return conflict("移除的成员仍有待处理问题，请先完成责任移交", "pending_responsibilities")
			}
		}
		n.OwnerIDs = in.OwnerIDs
		n.MemberIDs = in.MemberIDs
		if err = putJSON(ctx, tx, "io_nodes", n.ID, p.ID, n); err != nil {
			return err
		}
		return addEvent(ctx, tx, p.ID, a.ID, "node.members_changed", "调整「"+n.Name+"」的负责人和成员")
	})
	return n, err
}
func checkProjectMember(ctx context.Context, tx pgx.Tx, pid, id string) error {
	if id == "" {
		return nil
	}
	if err := validateActive(ctx, tx, []string{id}); err != nil {
		return err
	}
	var ok bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM io_nodes WHERE project_id=$1 AND ((data->'memberIds') ? $2 OR (data->'ownerIds') ? $2)) OR EXISTS(SELECT 1 FROM io_members WHERE id=$2 AND role='admin' AND active=true)`, pid, id).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return invalid("指定成员不在该项目中")
	}
	return nil
}
