package platform

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func projectAccess(ctx context.Context, tx pgx.Tx, a Member, pid string) error {
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM io_projects WHERE id=$1)`, pid).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return missing("项目不存在")
	}
	if isAdmin(a) {
		return nil
	}
	var ok bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM io_nodes WHERE project_id=$1 AND ((data->'memberIds') ? $2 OR (data->'ownerIds') ? $2))`, pid, a.ID).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return forbidden("你没有该项目的访问权限")
	}
	return nil
}
func conversationAccess(ctx context.Context, tx pgx.Tx, a Member, c Conversation) error {
	if c.Kind == "direct" || c.Kind == "group" {
		if !has(c.ParticipantIDs, a.ID) {
			return forbidden("私聊仅限参与人访问")
		}
		return nil
	}
	return projectAccess(ctx, tx, a, c.ProjectID)
}
func getConversation(ctx context.Context, tx pgx.Tx, a Member, id string, lock bool) (Conversation, error) {
	var c Conversation
	var b []byte
	q := `SELECT data FROM io_conversations WHERE id=$1`
	if lock {
		q += " FOR UPDATE"
	}
	err := tx.QueryRow(ctx, q, id).Scan(&b)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, missing("会话不存在")
	}
	if err != nil {
		return c, err
	}
	if err = json.Unmarshal(b, &c); err != nil {
		return c, err
	}
	return c, conversationAccess(ctx, tx, a, c)
}
func insertConversation(ctx context.Context, tx pgx.Tx, c Conversation, key string) (Conversation, error) {
	b, err := json.Marshal(c)
	if err != nil {
		return c, err
	}
	var raw []byte
	if key == "" {
		err = tx.QueryRow(ctx, `INSERT INTO io_conversations(id,data) VALUES($1,$2) RETURNING data`, c.ID, b).Scan(&raw)
	} else {
		err = tx.QueryRow(ctx, `INSERT INTO io_conversations(id,scope_key,data) VALUES($1,$2,$3) ON CONFLICT(scope_key) DO UPDATE SET scope_key=EXCLUDED.scope_key RETURNING data`, c.ID, key, b).Scan(&raw)
	}
	if err != nil {
		return c, err
	}
	err = json.Unmarshal(raw, &c)
	return c, err
}
func ensureProjectConversation(ctx context.Context, tx pgx.Tx, p Project, creator string) error {
	_, err := insertConversation(ctx, tx, Conversation{ID: newID("conversation"), ProjectID: p.ID, Kind: "project", Name: p.Name + " · 项目频道", ParticipantIDs: []string{}, CreatedBy: creator, CreatedAt: time.Now().UTC()}, "project:"+p.ID)
	return err
}
func (s *Store) createConversation(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		Kind           string   `json:"kind"`
		Name           string   `json:"name"`
		ProjectID      string   `json:"projectId"`
		NodeID         string   `json:"nodeId"`
		TaskID         string   `json:"taskId"`
		IssueID        string   `json:"issueId"`
		ParticipantIDs []string `json:"participantIds"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if !enum(in.Kind, "project", "node", "task", "issue", "direct", "group") {
		return nil, invalid("会话类别无效")
	}
	ctx := r.Context()
	a := actor(r)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	c := Conversation{ID: newID("conversation"), Kind: in.Kind, Name: strings.TrimSpace(in.Name), ParticipantIDs: []string{}, CreatedBy: a.ID, CreatedAt: time.Now().UTC()}
	key := ""
	if enum(in.Kind, "direct", "group") {
		if in.ProjectID != "" || in.NodeID != "" || in.TaskID != "" || in.IssueID != "" {
			return nil, invalid("私聊不能包含项目范围")
		}
		c.ParticipantIDs = unique(append(in.ParticipantIDs, a.ID))
		if err = validateActive(ctx, tx, c.ParticipantIDs); err != nil {
			return nil, err
		}
		if in.Kind == "direct" {
			if len(c.ParticipantIDs) != 2 {
				return nil, invalid("私聊需要两名不同成员")
			}
			sort.Strings(c.ParticipantIDs)
			key = "direct:" + strings.Join(c.ParticipantIDs, ":")
			if c.Name == "" {
				names := []string{}
				for _, id := range c.ParticipantIDs {
					m, e := memberByID(ctx, tx, id)
					if e != nil {
						return nil, e
					}
					names = append(names, m.Name)
				}
				c.Name = strings.Join(names, "、")
			}
		} else {
			if len(c.ParticipantIDs) < 2 {
				return nil, invalid("群聊至少需要两名成员")
			}
			if err = validText(c.Name, "群聊名称", 200); err != nil {
				return nil, err
			}
		}
	} else {
		if len(in.ParticipantIDs) > 0 {
			return nil, invalid("项目频道参与范围由项目权限决定")
		}
		if err = projectAccess(ctx, tx, a, in.ProjectID); err != nil {
			return nil, err
		}
		c.ProjectID = in.ProjectID
		switch in.Kind {
		case "project":
			if in.NodeID != "" || in.TaskID != "" || in.IssueID != "" {
				return nil, invalid("项目频道范围无效")
			}
			p, e := getJSON[Project](ctx, tx, "io_projects", in.ProjectID, "")
			if e != nil {
				return nil, e
			}
			key = "project:" + p.ID
			if c.Name == "" {
				c.Name = p.Name + " · 项目频道"
			}
		case "node":
			if in.TaskID != "" || in.IssueID != "" {
				return nil, invalid("节点频道范围无效")
			}
			n, e := getJSON[Node](ctx, tx, "io_nodes", in.NodeID, in.ProjectID)
			if e != nil {
				return nil, e
			}
			c.NodeID = n.ID
			key = "node:" + n.ID
			if c.Name == "" {
				c.Name = n.Name
			}
		case "task":
			if in.IssueID != "" {
				return nil, invalid("任务频道范围无效")
			}
			t, e := getJSON[Task](ctx, tx, "io_tasks", in.TaskID, in.ProjectID)
			if e != nil {
				return nil, e
			}
			if in.NodeID != "" && in.NodeID != t.NodeID {
				return nil, invalid("任务不属于该节点")
			}
			c.TaskID = t.ID
			c.NodeID = t.NodeID
			key = "task:" + t.ID
			if c.Name == "" {
				c.Name = t.Title
			}
		case "issue":
			i, e := getJSON[Issue](ctx, tx, "io_issues", in.IssueID, in.ProjectID)
			if e != nil {
				return nil, e
			}
			if in.NodeID != "" && in.NodeID != i.NodeID || in.TaskID != "" && in.TaskID != i.TaskID {
				return nil, invalid("问题范围不匹配")
			}
			c.IssueID = i.ID
			c.TaskID = i.TaskID
			c.NodeID = i.NodeID
			key = "issue:" + i.ID
			if c.Name == "" {
				c.Name = i.Title
			}
		}
	}
	if err = validText(c.Name, "会话名称", 300); err != nil {
		return nil, err
	}
	c, err = insertConversation(ctx, tx, c, key)
	if err != nil {
		return nil, err
	}
	return c, tx.Commit(ctx)
}
func (s *Store) listConversations(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	a := actor(r)
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	all, err := listJSON[Conversation](ctx, tx, "io_conversations", "")
	if err != nil {
		return nil, err
	}
	out := []Conversation{}
	for _, c := range all {
		if e := conversationAccess(ctx, tx, a, c); e != nil {
			var ae *apiError
			if errors.As(e, &ae) && ae.Status == 403 {
				continue
			}
			return nil, e
		}
		var b []byte
		e := tx.QueryRow(ctx, `SELECT data FROM io_messages WHERE conversation_id=$1 ORDER BY seq DESC LIMIT 1`, c.ID).Scan(&b)
		if e == nil {
			var m Message
			if e = json.Unmarshal(b, &m); e != nil {
				return nil, e
			}
			c.LastMessage = &m
		} else if !errors.Is(e, pgx.ErrNoRows) {
			return nil, e
		}
		if err = tx.QueryRow(ctx, `SELECT count(*) FROM io_messages WHERE conversation_id=$1 AND seq>COALESCE((SELECT seq FROM io_receipts WHERE conversation_id=$1 AND member_id=$2),0) AND data->>'senderId'<>$2`, c.ID, a.ID).Scan(&c.UnreadCount); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool {
		x, y := out[i].CreatedAt, out[j].CreatedAt
		if out[i].LastMessage != nil {
			x = out[i].LastMessage.CreatedAt
		}
		if out[j].LastMessage != nil {
			y = out[j].LastMessage.CreatedAt
		}
		return x.After(y)
	})
	return out, nil
}
