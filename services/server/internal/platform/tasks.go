package platform

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func taskAssignments(ctx context.Context, tx pgx.Tx, n Node, t Task) error {
	ids := append([]string{t.OwnerID, t.ReviewerID}, t.CollaboratorIDs...)
	if err := validateActive(ctx, tx, ids); err != nil {
		return err
	}
	for _, id := range append([]string{t.OwnerID}, t.CollaboratorIDs...) {
		if id != "" && !has(n.MemberIDs, id) && !has(n.OwnerIDs, id) {
			m, err := memberByID(ctx, tx, id)
			if err != nil {
				return err
			}
			if !isAdmin(m) {
				return invalid("任务执行人必须属于该节点")
			}
		}
	}
	return checkProjectMember(ctx, tx, t.ProjectID, t.ReviewerID)
}
func (s *Store) createTask(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		NodeID             string   `json:"nodeId"`
		Title              string   `json:"title"`
		Description        string   `json:"description"`
		OwnerID            string   `json:"ownerId"`
		CollaboratorIDs    []string `json:"collaboratorIds"`
		ReviewerID         string   `json:"reviewerId"`
		AcceptanceCriteria string   `json:"acceptanceCriteria"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	in.Title = strings.TrimSpace(in.Title)
	if err := validText(in.Title, "任务标题", 300); err != nil {
		return nil, err
	}
	a := actor(r)
	ctx := r.Context()
	var t Task
	err := s.projectTx(ctx, a, r.PathValue("pid"), true, func(tx pgx.Tx, p Project) error {
		n, err := getJSON[Node](ctx, tx, "io_nodes", in.NodeID, p.ID)
		if err != nil {
			return err
		}
		if !isAdmin(a) && !has(n.MemberIDs, a.ID) && !has(n.OwnerIDs, a.ID) {
			return forbidden("你不是该节点成员")
		}
		now := time.Now().UTC()
		t = Task{ID: newID("task"), ProjectID: p.ID, NodeID: n.ID, Title: in.Title, Description: in.Description, OwnerID: in.OwnerID, CollaboratorIDs: unique(in.CollaboratorIDs), ReviewerID: in.ReviewerID, Status: "todo", AcceptanceCriteria: in.AcceptanceCriteria, Version: 1, MemoryRefs: map[string]int{}, CreatedAt: now, UpdatedAt: now}
		if !isAdmin(a) && !has(n.OwnerIDs, a.ID) {
			if t.OwnerID != "" && t.OwnerID != a.ID {
				return forbidden("仅节点负责人可以为其他成员分派任务")
			}
			t.OwnerID = a.ID
		}
		if err = taskAssignments(ctx, tx, n, t); err != nil {
			return err
		}
		ms, err := listJSON[Memory](ctx, tx, "io_memories", p.ID)
		if err != nil {
			return err
		}
		t.MemoryRefs = refs(eligibleMemory(ms, t))
		if err = putJSON(ctx, tx, "io_tasks", t.ID, p.ID, t); err != nil {
			return err
		}
		if err = notifyTaskAssignment(ctx, tx, a.ID, t); err != nil {
			return err
		}
		return addEvent(ctx, tx, p.ID, a.ID, "task.created", "创建任务「"+t.Title+"」")
	})
	return t, err
}
func (s *Store) patchTask(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		Version            int       `json:"version"`
		Title              *string   `json:"title"`
		Description        *string   `json:"description"`
		Status             *string   `json:"status"`
		OwnerID            *string   `json:"ownerId"`
		CollaboratorIDs    *[]string `json:"collaboratorIds"`
		ReviewerID         *string   `json:"reviewerId"`
		AcceptanceCriteria *string   `json:"acceptanceCriteria"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if workScope(r.Context()) != nil {
		if in.OwnerID != nil || in.CollaboratorIDs != nil || in.ReviewerID != nil || (in.Status != nil && !enum(*in.Status, "todo", "in_progress", "blocked")) {
			return nil, forbidden("AI 工作会话不能更改分工、提交人工验收状态或代替负责人验收")
		}
	}
	ctx := r.Context()
	a := actor(r)
	var t Task
	err := s.projectTx(ctx, a, r.PathValue("pid"), true, func(tx pgx.Tx, p Project) error {
		var err error
		t, err = getJSON[Task](ctx, tx, "io_tasks", r.PathValue("id"), p.ID)
		if err != nil {
			return err
		}
		if err = checkVersion(in.Version, t.Version); err != nil {
			return err
		}
		n, err := getJSON[Node](ctx, tx, "io_nodes", t.NodeID, p.ID)
		if err != nil {
			return err
		}
		oldOwnerID := t.OwnerID
		accepting := in.Status != nil && *in.Status == "done"
		returning := t.Status == "review" && in.Status != nil && *in.Status == "in_progress" && (isAdmin(a) || t.ReviewerID == a.ID)
		if returning {
			if in.Title != nil || in.Description != nil || in.OwnerID != nil || in.CollaboratorIDs != nil || in.ReviewerID != nil || in.AcceptanceCriteria != nil {
				return invalid("退回成果不能同时修改任务内容或分工")
			}
		}
		if accepting {
			if !isAdmin(a) && t.ReviewerID != a.ID {
				return forbidden("仅指定验收人或管理员可以验收")
			}
			if t.Status != "review" {
				return conflict("任务尚未提交验收", "invalid_transition")
			}
			if in.Title != nil || in.Description != nil || in.OwnerID != nil || in.CollaboratorIDs != nil || in.ReviewerID != nil || in.AcceptanceCriteria != nil {
				return invalid("验收不能同时修改任务内容或分工")
			}
			if err = ensureBaseline(ctx, tx, t); err != nil {
				return err
			}
		} else if !returning {
			if !canWork(a, n, t) {
				return forbidden("你没有该任务的修改权限")
			}
			if t.Status == "done" {
				return conflict("已验收成果保留原记录，请创建后续工作项", "completed_task")
			}
		}
		if t.Status == "review" && !accepting && (in.Title != nil || in.Description != nil || in.AcceptanceCriteria != nil || in.OwnerID != nil || in.CollaboratorIDs != nil || in.ReviewerID != nil) {
			t.Status = "in_progress"
		}
		if in.Status != nil {
			v := *in.Status
			if v == "review" {
				return invalid("请通过提交成果接口进入验收")
			}
			if !enum(v, "todo", "in_progress", "done", "blocked") {
				return invalid("任务状态无效")
			}
			t.Status = v
		}
		if in.Title != nil {
			v := strings.TrimSpace(*in.Title)
			if err = validText(v, "任务标题", 300); err != nil {
				return err
			}
			t.Title = v
		}
		if in.Description != nil {
			t.Description = *in.Description
		}
		if in.AcceptanceCriteria != nil {
			t.AcceptanceCriteria = *in.AcceptanceCriteria
		}
		if in.OwnerID != nil || in.CollaboratorIDs != nil || in.ReviewerID != nil {
			if !isAdmin(a) && !has(n.OwnerIDs, a.ID) {
				return forbidden("仅节点负责人可以修改分工")
			}
			if in.OwnerID != nil {
				t.OwnerID = *in.OwnerID
			}
			if in.CollaboratorIDs != nil {
				t.CollaboratorIDs = unique(*in.CollaboratorIDs)
			}
			if in.ReviewerID != nil {
				t.ReviewerID = *in.ReviewerID
			}
			if err = taskAssignments(ctx, tx, n, t); err != nil {
				return err
			}
		}
		t.Version++
		t.UpdatedAt = time.Now().UTC()
		if err = putJSON(ctx, tx, "io_tasks", t.ID, p.ID, t); err != nil {
			return err
		}
		kind := "task.updated"
		msg := "更新任务「" + t.Title + "」"
		if accepting {
			kind = "task.accepted"
			msg = "验收通过「" + t.Title + "」"
		} else if returning {
			kind = "task.returned"
			msg = "验收退回「" + t.Title + "」，请调整后重新提交"
		}

		if oldOwnerID != t.OwnerID {
			if err = notifyTaskAssignment(ctx, tx, a.ID, t); err != nil {
				return err
			}
		}
		if returning {
			if err = notify(ctx, tx, a.ID, Notification{MemberID: t.OwnerID, ProjectID: p.ID, Kind: "task.returned", Title: "成果已退回调整", Body: "任务「" + t.Title + "」需要调整后重新提交，请与验收人对齐修改要求。", TaskID: t.ID}); err != nil {
				return err
			}
		}
		return addEvent(ctx, tx, p.ID, a.ID, kind, msg)
	})
	return t, err
}
func (s *Store) taskContext(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	var v TaskContext
	err := s.projectTx(ctx, actor(r), r.PathValue("pid"), false, func(tx pgx.Tx, p Project) error {
		t, err := getJSON[Task](ctx, tx, "io_tasks", r.PathValue("id"), p.ID)
		if err != nil {
			return err
		}
		all, err := listJSON[Memory](ctx, tx, "io_memories", p.ID)
		if err != nil {
			return err
		}
		issues, err := listJSON[Issue](ctx, tx, "io_issues", p.ID)
		if err != nil {
			return err
		}
		selected := []Issue{}
		for _, i := range issues {
			if i.Status != "resolved" && (i.TaskID == t.ID || (i.TaskID == "" && i.NodeID == t.NodeID)) {
				selected = append(selected, i)
			}
		}
		changes := changedMemory(all, t)
		v = TaskContext{p, t, eligibleMemory(all, t), selected, len(changes) > 0, changes}
		return nil
	})
	return v, err
}
func (s *Store) syncTask(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		Version int `json:"version"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	return s.changeTaskBaseline(r, in.Version, "", false)
}
func (s *Store) submitTask(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		Version     int    `json:"version"`
		Deliverable string `json:"deliverable"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if err := validText(in.Deliverable, "成果说明", 100000); err != nil {
		return nil, err
	}
	return s.changeTaskBaseline(r, in.Version, in.Deliverable, true)
}
func (s *Store) changeTaskBaseline(r *http.Request, version int, deliverable string, submit bool) (any, error) {
	ctx := r.Context()
	a := actor(r)
	var t Task
	err := s.projectTx(ctx, a, r.PathValue("pid"), true, func(tx pgx.Tx, p Project) error {
		var err error
		t, err = getJSON[Task](ctx, tx, "io_tasks", r.PathValue("id"), p.ID)
		if err != nil {
			return err
		}
		if err = checkVersion(version, t.Version); err != nil {
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
			return conflict("已验收成果不可更改", "completed_task")
		}
		kind := "task.baseline_synced"
		msg := "同步任务「" + t.Title + "」的共享记忆基线"
		if submit {
			if err = ensureBaseline(ctx, tx, t); err != nil {
				return err
			}
			t.Deliverable = deliverable
			t.Status = "review"
			kind = "task.submitted"
			msg = "提交成果「" + t.Title + "」"
		} else {
			ms, e := listJSON[Memory](ctx, tx, "io_memories", p.ID)
			if e != nil {
				return e
			}
			t.MemoryRefs = refs(eligibleMemory(ms, t))
			if t.Status == "review" {
				t.Status = "in_progress"
			}
		}
		t.Version++
		t.UpdatedAt = time.Now().UTC()
		if err = putJSON(ctx, tx, "io_tasks", t.ID, p.ID, t); err != nil {
			return err
		}
		if submit {
			if err = notify(ctx, tx, a.ID, Notification{MemberID: t.ReviewerID, ProjectID: p.ID, Kind: "task.review_requested", Title: "有成果等待你验收", Body: "任务「" + t.Title + "」已提交成果，请核对交付物和验收条件。", TaskID: t.ID}); err != nil {
				return err
			}
		}
		return addEvent(ctx, tx, p.ID, a.ID, kind, msg)
	})
	return t, err
}
