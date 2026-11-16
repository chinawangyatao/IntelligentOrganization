package platform

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Store) createIssue(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		NodeID      string `json:"nodeId"`
		TaskID      string `json:"taskId"`
		Title       string `json:"title"`
		Description string `json:"description"`
		AssigneeID  string `json:"assigneeId"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if scope := workScope(r.Context()); scope != nil && (in.TaskID != scope.Session.TaskID || in.NodeID != scope.Session.NodeID) {
		return nil, forbidden("问题必须关联绑定的任务与节点")
	}
	if err := validText(in.Title, "问题标题", 300); err != nil {
		return nil, err
	}
	if in.AssigneeID == "" {
		return nil, invalid("问题需要指定接单人")
	}
	a := actor(r)
	ctx := r.Context()
	var v Issue
	err := s.projectTx(ctx, a, r.PathValue("pid"), true, func(tx pgx.Tx, p Project) error {
		if _, err := getJSON[Node](ctx, tx, "io_nodes", in.NodeID, p.ID); err != nil {
			return err
		}
		if in.TaskID != "" {
			t, err := getJSON[Task](ctx, tx, "io_tasks", in.TaskID, p.ID)
			if err != nil {
				return err
			}
			if t.NodeID != in.NodeID {
				return invalid("任务与节点不匹配")
			}
		}
		if err := checkProjectMember(ctx, tx, p.ID, in.AssigneeID); err != nil {
			return err
		}
		now := time.Now().UTC()
		v = Issue{newID("issue"), p.ID, in.NodeID, in.TaskID, strings.TrimSpace(in.Title), in.Description, in.AssigneeID, "open", now, now}
		if err := putJSON(ctx, tx, "io_issues", v.ID, p.ID, v); err != nil {
			return err
		}
		if err := notify(ctx, tx, a.ID, Notification{MemberID: v.AssigneeID, ProjectID: p.ID, Kind: "issue.assigned", Title: "有问题需要你接单", Body: "请查看问题「" + v.Title + "」并确认处理。", IssueID: v.ID, TaskID: v.TaskID}); err != nil {
			return err
		}
		return addEvent(ctx, tx, p.ID, a.ID, "issue.created", "提出问题「"+v.Title+"」并指派处理人")
	})
	return v, err
}
func (s *Store) patchIssue(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		Status string `json:"status"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if !enum(in.Status, "open", "acknowledged", "resolved") {
		return nil, invalid("问题状态无效")
	}
	ctx := r.Context()
	a := actor(r)
	var v Issue
	err := s.projectTx(ctx, a, r.PathValue("pid"), true, func(tx pgx.Tx, p Project) error {
		var err error
		v, err = getJSON[Issue](ctx, tx, "io_issues", r.PathValue("id"), p.ID)
		if err != nil {
			return err
		}
		if !isAdmin(a) && v.AssigneeID != a.ID {
			return forbidden("仅问题接单人可以更新处理状态")
		}
		v.Status = in.Status
		v.UpdatedAt = time.Now().UTC()
		if err = putJSON(ctx, tx, "io_issues", v.ID, p.ID, v); err != nil {
			return err
		}
		return addEvent(ctx, tx, p.ID, a.ID, "issue.updated", "问题「"+v.Title+"」状态更新为 "+v.Status)
	})
	return v, err
}
func (s *Store) createHandover(w http.ResponseWriter, r *http.Request) (any, error) {
	a := actor(r)
	if err := requireAdmin(a); err != nil {
		return nil, err
	}
	var in struct {
		From    string   `json:"fromMemberId"`
		To      string   `json:"toMemberId"`
		NodeIDs []string `json:"nodeIds"`
		Reason  string   `json:"reason"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	in.NodeIDs = unique(in.NodeIDs)
	if in.From == in.To || in.From == "" || in.To == "" || len(in.NodeIDs) == 0 {
		return nil, invalid("请选择不同的交出人、接手人和至少一个节点")
	}
	if err := validText(in.Reason, "移交原因", 2000); err != nil {
		return nil, err
	}
	ctx := r.Context()
	var h Handover
	err := s.projectTx(ctx, a, r.PathValue("pid"), true, func(tx pgx.Tx, p Project) error {
		from, err := memberByID(ctx, tx, in.From)
		if err != nil {
			return err
		}
		to, err := memberByID(ctx, tx, in.To)
		if err != nil {
			return err
		}
		if !to.Active {
			return invalid("接手人已停用")
		}
		snap, err := snapshot(ctx, tx, p)
		if err != nil {
			return err
		}
		lines := []string{fmt.Sprintf("项目：%s [%s]", p.Name, p.ID), fmt.Sprintf("责任移交：%s → %s；原因：%s", from.Name, to.Name, in.Reason), "责任立即生效，接手确认另行记录。历史作者、已验收成果及用量归属保留。"}
		found := false
		for _, nid := range in.NodeIDs {
			n, err := getJSON[Node](ctx, tx, "io_nodes", nid, p.ID)
			if err != nil {
				return err
			}
			if !has(n.MemberIDs, in.From) && !has(n.OwnerIDs, in.From) {
				return invalid("交出人不属于所选节点")
			}
			found = true
			n.OwnerIDs = replace(n.OwnerIDs, in.From, in.To)
			n.MemberIDs = replace(n.MemberIDs, in.From, in.To)
			if err = validateActive(ctx, tx, []string{in.To}); err != nil {
				return err
			}
			if err = putJSON(ctx, tx, "io_nodes", n.ID, p.ID, n); err != nil {
				return err
			}
			lines = append(lines, fmt.Sprintf("节点：%s [%s]", n.Name, n.ID))
		}
		if !found {
			return invalid("没有可移交节点")
		}
		for _, t := range snap.Tasks {
			if t.Status == "done" || !has(in.NodeIDs, t.NodeID) {
				continue
			}
			changed := false
			if t.OwnerID == in.From {
				t.OwnerID = in.To
				changed = true
			}
			if t.ReviewerID == in.From {
				t.ReviewerID = in.To
				changed = true
			}
			if has(t.CollaboratorIDs, in.From) {
				t.CollaboratorIDs = replace(t.CollaboratorIDs, in.From, in.To)
				changed = true
			}
			if changed {
				t.Version++
				t.UpdatedAt = time.Now().UTC()
				if err = putJSON(ctx, tx, "io_tasks", t.ID, p.ID, t); err != nil {
					return err
				}
			}
			lines = append(lines, fmt.Sprintf("待办：%s [%s]；状态 %s；成果 %s；验收标准 %s", t.Title, t.ID, t.Status, t.Deliverable, t.AcceptanceCriteria))
		}
		for _, i := range snap.Issues {
			if i.Status == "resolved" || !has(in.NodeIDs, i.NodeID) {
				continue
			}
			if i.AssigneeID == in.From {
				i.AssigneeID = in.To
				i.UpdatedAt = time.Now().UTC()
				if err = putJSON(ctx, tx, "io_issues", i.ID, p.ID, i); err != nil {
					return err
				}
			}
			lines = append(lines, fmt.Sprintf("未决问题：%s [%s]；%s", i.Title, i.ID, i.Description))
		}
		for _, m := range snap.Memories {
			if m.Status == "published" && (m.NodeID == "" || has(in.NodeIDs, m.NodeID)) {
				lines = append(lines, fmt.Sprintf("共同依据：%s [%s] v%d；%s", m.Title, m.ID, m.Version, m.Content))
			}
		}
		lines = append(lines, "交接资料来自上述已保存记录；未记录的环境入口、未提交代码及口头决定需人工核实补充。")
		h = Handover{ID: newID("handover"), ProjectID: p.ID, FromMemberID: in.From, ToMemberID: in.To, NodeIDs: in.NodeIDs, Reason: in.Reason, Status: "pending", Summary: strings.Join(lines, "\n"), CreatedAt: time.Now().UTC()}
		if err = putJSON(ctx, tx, "io_handovers", h.ID, p.ID, h); err != nil {
			return err
		}
		if err = notify(ctx, tx, a.ID, Notification{MemberID: h.ToMemberID, ProjectID: p.ID, Kind: "handover.assigned", Title: "有责任移交等待你确认", Body: "请阅读「" + p.Name + "」的交接包，核对范围和资料缺项。", HandoverID: h.ID}); err != nil {
			return err
		}
		return addEvent(ctx, tx, p.ID, a.ID, "handover.created", from.Name+" 的当前责任已移交给 "+to.Name+"，待接手确认")
	})
	return h, err
}
func (s *Store) acceptHandover(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	a := actor(r)
	var h Handover
	err := s.projectTx(ctx, a, r.PathValue("pid"), true, func(tx pgx.Tx, p Project) error {
		var err error
		h, err = getJSON[Handover](ctx, tx, "io_handovers", r.PathValue("id"), p.ID)
		if err != nil {
			return err
		}
		if h.ToMemberID != a.ID {
			return forbidden("仅接手人本人可以确认交接")
		}
		if h.Status == "accepted" {
			return nil
		}
		now := time.Now().UTC()
		h.Status = "accepted"
		h.AcceptedAt = &now
		if err = putJSON(ctx, tx, "io_handovers", h.ID, p.ID, h); err != nil {
			return err
		}
		return addEvent(ctx, tx, p.ID, a.ID, "handover.accepted", "接手人已确认交接范围")
	})
	return h, err
}
func (s *Store) reuseProject(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	a := actor(r)
	if err := requireAdmin(a); err != nil {
		return nil, err
	}
	var in struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		MemoryIDs   []string `json:"memoryIds"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if err := validText(in.Name, "新项目名称", 200); err != nil {
		return nil, err
	}
	var next Project
	err := s.projectTx(ctx, a, r.PathValue("pid"), true, func(tx pgx.Tx, p Project) error {
		snap, err := snapshot(ctx, tx, p)
		if err != nil {
			return err
		}
		next = Project{ID: newID("project"), Name: strings.TrimSpace(in.Name), Description: in.Description, Status: "active", SourceProjectID: p.ID, CreatedAt: time.Now().UTC()}
		if err = putJSON(ctx, tx, "io_projects", next.ID, "", next); err != nil {
			return err
		}
		nodes := map[string]string{}
		for _, n := range snap.Nodes {
			old := n.ID
			n.ID = newID("node")
			n.ProjectID = next.ID
			n.OwnerIDs = []string{}
			n.MemberIDs = []string{}
			nodes[old] = n.ID
			if err = putJSON(ctx, tx, "io_nodes", n.ID, next.ID, n); err != nil {
				return err
			}
		}
		selected := map[string]Memory{}
		for _, m := range snap.Memories {
			selected[m.ID] = m
		}
		for _, id := range unique(in.MemoryIDs) {
			m, ok := selected[id]
			if !ok {
				return invalid("所选记忆不属于原项目")
			}
			sourceID, sourceVersion := m.ID, m.Version
			m.ID = newID("memory")
			m.ProjectID = next.ID
			if m.NodeID != "" {
				m.NodeID = nodes[m.NodeID]
			}
			m.SourceMemoryID = sourceID
			m.SourceVersion = sourceVersion
			m.Status = "draft"
			m.Version = 1
			m.UpdatedBy = a.ID
			m.UpdatedAt = time.Now().UTC()
			if err = saveMemory(ctx, tx, m); err != nil {
				return err
			}
		}
		for _, t := range snap.Tasks {
			t.ID = newID("task")
			t.ProjectID = next.ID
			t.NodeID = nodes[t.NodeID]
			t.Description = "" // Only task titles and acceptance templates are reused.
			t.OwnerID = ""
			t.CollaboratorIDs = []string{}
			t.ReviewerID = ""
			t.Status = "todo"
			t.Deliverable = ""
			t.Version = 1
			t.MemoryRefs = map[string]int{}
			t.CreatedAt = time.Now().UTC()
			t.UpdatedAt = t.CreatedAt
			if err = putJSON(ctx, tx, "io_tasks", t.ID, next.ID, t); err != nil {
				return err
			}
		}
		if err = ensureProjectConversation(ctx, tx, next, a.ID); err != nil {
			return err
		}
		return addEvent(ctx, tx, next.ID, a.ID, "project.reused", "从「"+p.Name+"」复用流程与所选草稿；需求差异和适用性尚待负责人确认")
	})
	return next, err
}
