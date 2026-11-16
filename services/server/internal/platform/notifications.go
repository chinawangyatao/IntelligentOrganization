package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

// Notifications live in the same transaction as the state change they describe.
// Reading a notice is deliberately separate from accepting work or handovers.
func notify(ctx context.Context, tx pgx.Tx, actorID string, n Notification) error {
	if n.MemberID == "" || n.MemberID == actorID {
		return nil
	}
	n.ID = newID("notification")
	n.CreatedAt = time.Now().UTC()
	b, err := json.Marshal(n)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO io_notifications(id,project_id,member_id,data) VALUES($1,$2,$3,$4)`, n.ID, n.ProjectID, n.MemberID, b)
	return err
}
func notifyTaskAssignment(ctx context.Context, tx pgx.Tx, actorID string, t Task) error {
	return notify(ctx, tx, actorID, Notification{MemberID: t.OwnerID, ProjectID: t.ProjectID, Kind: "task.assigned", Title: "有任务分配给你", Body: "请查看任务「" + t.Title + "」的要求、验收条件和共享记忆。", TaskID: t.ID})
}
func notifyMemoryChange(ctx context.Context, tx pgx.Tx, actorID string, m Memory, wasPublished bool) error {
	if m.Status != "published" && !wasPublished {
		return nil
	}
	tasks, err := listJSON[Task](ctx, tx, "io_tasks", m.ProjectID)
	if err != nil {
		return err
	}
	for _, t := range tasks {
		if t.Status == "done" {
			continue
		}
		_, depended := t.MemoryRefs[m.ID]
		eligible := m.Status == "published" && (m.NodeID == "" || m.NodeID == t.NodeID)
		if !depended && !eligible {
			continue
		}
		if err = notify(ctx, tx, actorID, Notification{MemberID: t.OwnerID, ProjectID: m.ProjectID, Kind: "memory.changed", Title: "任务依据已变更", Body: fmt.Sprintf("「%s」更新至 v%d（%s），请核对任务「%s」的影响并同步基线。", m.Title, m.Version, m.Status, t.Title), TaskID: t.ID}); err != nil {
			return err
		}
	}
	return nil
}
func (s *Store) listNotifications(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	a := actor(r)
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	// Apply project access in SQL before limiting, so hidden notices cannot starve
	// the visible page. Admin access is still scoped to their own recipient ID.
	rows, err := tx.Query(ctx, `SELECT n.data FROM io_notifications n WHERE n.member_id=$1 AND ($2 OR EXISTS(SELECT 1 FROM io_nodes v WHERE v.project_id=n.project_id AND ((v.data->'memberIds') ? $1 OR (v.data->'ownerIds') ? $1))) ORDER BY n.data->>'createdAt' DESC,n.id DESC LIMIT 200`, a.ID, isAdmin(a))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Notification{}
	for rows.Next() {
		var b []byte
		var n Notification
		if err = rows.Scan(&b); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(b, &n); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}
func (s *Store) readNotification(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	a := actor(r)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var b []byte
	err = tx.QueryRow(ctx, `SELECT data FROM io_notifications WHERE id=$1 AND member_id=$2 FOR UPDATE`, r.PathValue("id"), a.ID).Scan(&b)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, missing("通知不存在")
	}
	if err != nil {
		return nil, err
	}
	var n Notification
	if err = json.Unmarshal(b, &n); err != nil {
		return nil, err
	}
	if err = projectAccess(ctx, tx, a, n.ProjectID); err != nil {
		return nil, err
	}
	if n.ReadAt == nil {
		now := time.Now().UTC()
		n.ReadAt = &now
		b, err = json.Marshal(n)
		if err != nil {
			return nil, err
		}
		if _, err = tx.Exec(ctx, `UPDATE io_notifications SET data=$2 WHERE id=$1`, n.ID, b); err != nil {
			return nil, err
		}
	}
	return map[string]bool{"ok": true}, tx.Commit(ctx)
}
