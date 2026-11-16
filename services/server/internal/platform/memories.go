package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func canPublish(ctx context.Context, tx pgx.Tx, a Member, pid, nid string) error {
	if isAdmin(a) {
		return nil
	}
	if nid == "" {
		return forbidden("项目级正式记忆需由管理员确认")
	}
	n, err := getJSON[Node](ctx, tx, "io_nodes", nid, pid)
	if err != nil {
		return err
	}
	if !has(n.OwnerIDs, a.ID) {
		return forbidden("仅节点负责人可以发布该节点正式记忆")
	}
	return nil
}
func validateMemory(m Memory) error {
	if err := validText(m.Title, "记忆标题", 300); err != nil {
		return err
	}
	if err := validText(m.Content, "记忆内容", 100000); err != nil {
		return err
	}
	if !enum(m.Kind, "requirement", "contract", "decision", "lesson") {
		return invalid("记忆类别无效")
	}
	if !enum(m.Status, "draft", "published", "superseded") {
		return invalid("记忆状态无效")
	}
	return nil
}
func saveMemory(ctx context.Context, tx pgx.Tx, m Memory) error {
	if err := putJSON(ctx, tx, "io_memories", m.ID, m.ProjectID, m); err != nil {
		return err
	}
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO io_memory_versions(memory_id,version,data) VALUES($1,$2,$3)`, m.ID, m.Version, b)
	return err
}
func (s *Store) createMemory(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		NodeID  string `json:"nodeId"`
		Title   string `json:"title"`
		Content string `json:"content"`
		Kind    string `json:"kind"`
		Status  string `json:"status"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if in.Status == "" {
		in.Status = "draft"
	}
	a := actor(r)
	ctx := r.Context()
	var m Memory
	err := s.projectTx(ctx, a, r.PathValue("pid"), true, func(tx pgx.Tx, p Project) error {
		if in.NodeID != "" {
			if _, err := getJSON[Node](ctx, tx, "io_nodes", in.NodeID, p.ID); err != nil {
				return err
			}
		}
		m = Memory{ID: newID("memory"), ProjectID: p.ID, NodeID: in.NodeID, Title: strings.TrimSpace(in.Title), Content: in.Content, Kind: in.Kind, Status: in.Status, Version: 1, UpdatedBy: a.ID, UpdatedAt: time.Now().UTC()}
		if err := validateMemory(m); err != nil {
			return err
		}
		if m.Status != "draft" {
			if err := canPublish(ctx, tx, a, p.ID, m.NodeID); err != nil {
				return err
			}
		}
		if err := saveMemory(ctx, tx, m); err != nil {
			return err
		}
		if err := notifyMemoryChange(ctx, tx, a.ID, m, false); err != nil {
			return err
		}
		return addEvent(ctx, tx, p.ID, a.ID, "memory.created", "新增"+m.Status+"记忆「"+m.Title+"」 v1")
	})
	return m, err
}
func (s *Store) patchMemory(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		Version int     `json:"version"`
		Title   *string `json:"title"`
		Content *string `json:"content"`
		Status  *string `json:"status"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	a := actor(r)
	ctx := r.Context()
	var m Memory
	err := s.projectTx(ctx, a, r.PathValue("pid"), true, func(tx pgx.Tx, p Project) error {
		var err error
		m, err = getJSON[Memory](ctx, tx, "io_memories", r.PathValue("id"), p.ID)
		if err != nil {
			return err
		}
		wasPublished := m.Status == "published"
		if err = checkVersion(in.Version, m.Version); err != nil {
			return err
		}
		if m.Status != "draft" || in.Status != nil && *in.Status != "draft" {
			if err = canPublish(ctx, tx, a, p.ID, m.NodeID); err != nil {
				return err
			}
		} else if m.UpdatedBy != a.ID && !isAdmin(a) {
			if err = canPublish(ctx, tx, a, p.ID, m.NodeID); err != nil {
				return err
			}
		}
		if in.Title != nil {
			m.Title = strings.TrimSpace(*in.Title)
		}
		if in.Content != nil {
			m.Content = *in.Content
		}
		if in.Status != nil {
			m.Status = *in.Status
		}
		if err = validateMemory(m); err != nil {
			return err
		}
		m.Version++
		m.UpdatedBy = a.ID
		m.UpdatedAt = time.Now().UTC()
		if err = saveMemory(ctx, tx, m); err != nil {
			return err
		}
		if err = notifyMemoryChange(ctx, tx, a.ID, m, wasPublished); err != nil {
			return err
		}
		return addEvent(ctx, tx, p.ID, a.ID, "memory.updated", "更新记忆「"+m.Title+"」；依赖旧版本的任务需确认变更")
	})
	return m, err
}
func (s *Store) memoryHistory(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	out := []Memory{}
	err := s.projectTx(ctx, actor(r), r.PathValue("pid"), false, func(tx pgx.Tx, p Project) error {
		m, err := getJSON[Memory](ctx, tx, "io_memories", r.PathValue("id"), p.ID)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT data FROM io_memory_versions WHERE memory_id=$1 ORDER BY version DESC`, m.ID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var b []byte
			var v Memory
			if err = rows.Scan(&b); err != nil {
				return err
			}
			if err = json.Unmarshal(b, &v); err != nil {
				return err
			}
			out = append(out, v)
		}
		return rows.Err()
	})
	return out, err
}
