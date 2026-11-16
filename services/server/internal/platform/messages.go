package platform

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Store) listMessages(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	a := actor(r)
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	c, err := getConversation(ctx, tx, a, r.PathValue("cid"), false)
	if err != nil {
		return nil, err
	}
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		v, e := strconv.Atoi(raw)
		if e != nil || v < 1 || v > 100 {
			return nil, invalid("分页数量应为1到100")
		}
		limit = v
	}
	before := int64(9223372036854775807)
	if id := r.URL.Query().Get("before"); id != "" {
		if err = tx.QueryRow(ctx, `SELECT seq FROM io_messages WHERE id=$1 AND conversation_id=$2`, id, c.ID).Scan(&before); errors.Is(err, pgx.ErrNoRows) {
			return nil, invalid("消息游标不属于该会话")
		}
		if err != nil {
			return nil, err
		}
	}
	rows, err := tx.Query(ctx, `SELECT data FROM io_messages WHERE conversation_id=$1 AND seq<$2 ORDER BY seq DESC LIMIT $3`, c.ID, before, limit+1)
	if err != nil {
		return nil, err
	}
	messages := []Message{}
	for rows.Next() {
		var b []byte
		var m Message
		if err = rows.Scan(&b); err != nil {
			rows.Close()
			return nil, err
		}
		if err = json.Unmarshal(b, &m); err != nil {
			rows.Close()
			return nil, err
		}
		messages = append(messages, m)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	more := len(messages) > limit
	if more {
		messages = messages[:limit]
	}
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}
	receipts := []Receipt{}
	rows, err = tx.Query(ctx, `SELECT member_id,message_id,read_at FROM io_receipts WHERE conversation_id=$1 ORDER BY member_id`, c.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var v Receipt
		if err = rows.Scan(&v.MemberID, &v.MessageID, &v.ReadAt); err != nil {
			return nil, err
		}
		receipts = append(receipts, v)
	}
	return map[string]any{"messages": messages, "hasMore": more, "receipts": receipts}, rows.Err()
}
func (s *Store) postMessage(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		Body       string   `json:"body"`
		MentionIDs []string `json:"mentionIds"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	in.Body = strings.TrimSpace(in.Body)
	if err := validText(in.Body, "消息", 12000); err != nil {
		return nil, err
	}
	a := actor(r)
	ctx := r.Context()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	c, err := getConversation(ctx, tx, a, r.PathValue("cid"), true)
	if err != nil {
		return nil, err
	}
	in.MentionIDs = unique(in.MentionIDs)
	if err = validateActive(ctx, tx, in.MentionIDs); err != nil {
		return nil, err
	}
	for _, id := range in.MentionIDs {
		if c.Kind == "direct" || c.Kind == "group" {
			if !has(c.ParticipantIDs, id) {
				return nil, invalid("不能提及会话外的成员")
			}
		} else if err = checkProjectMember(ctx, tx, c.ProjectID, id); err != nil {
			return nil, err
		}
	}
	m := Message{ID: newID("message"), ConversationID: c.ID, SenderID: a.ID, Body: in.Body, MentionIDs: in.MentionIDs, CreatedAt: time.Now().UTC()}
	b, err := json.Marshal(m)
	if err != nil {
		return nil, err
	}
	var seq int64
	if err = tx.QueryRow(ctx, `INSERT INTO io_messages(id,conversation_id,data) VALUES($1,$2,$3) RETURNING seq`, m.ID, c.ID, b).Scan(&seq); err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO io_receipts(conversation_id,member_id,message_id,seq,read_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(conversation_id,member_id) DO UPDATE SET message_id=EXCLUDED.message_id,seq=EXCLUDED.seq,read_at=EXCLUDED.read_at WHERE io_receipts.seq<EXCLUDED.seq`, c.ID, a.ID, m.ID, seq, time.Now().UTC()); err != nil {
		return nil, err
	}
	return m, tx.Commit(ctx)
}
func (s *Store) readConversation(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		MessageID string `json:"messageId"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	ctx := r.Context()
	a := actor(r)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	c, err := getConversation(ctx, tx, a, r.PathValue("cid"), false)
	if err != nil {
		return nil, err
	}
	var seq int64
	if err = tx.QueryRow(ctx, `SELECT seq FROM io_messages WHERE id=$1 AND conversation_id=$2`, in.MessageID, c.ID).Scan(&seq); errors.Is(err, pgx.ErrNoRows) {
		return nil, invalid("已读消息不属于该会话")
	}
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO io_receipts(conversation_id,member_id,message_id,seq,read_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(conversation_id,member_id) DO UPDATE SET message_id=EXCLUDED.message_id,seq=EXCLUDED.seq,read_at=EXCLUDED.read_at WHERE io_receipts.seq<EXCLUDED.seq`, c.ID, a.ID, in.MessageID, seq, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	return map[string]bool{"ok": true}, tx.Commit(ctx)
}
func (s *Store) promoteMessage(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		ProjectID string `json:"projectId"`
		NodeID    string `json:"nodeId"`
		Title     string `json:"title"`
		Kind      string `json:"kind"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	if in.Kind == "" {
		in.Kind = "decision"
	}
	if err := validText(in.Title, "草稿标题", 300); err != nil {
		return nil, err
	}
	ctx := r.Context()
	a := actor(r)
	var result Memory
	err := s.projectTx(ctx, a, in.ProjectID, true, func(tx pgx.Tx, p Project) error {
		c, e := getConversation(ctx, tx, a, r.PathValue("cid"), true)
		if e != nil {
			return e
		}
		var b []byte
		if e = tx.QueryRow(ctx, `SELECT data FROM io_messages WHERE id=$1 AND conversation_id=$2 FOR UPDATE`, r.PathValue("mid"), c.ID).Scan(&b); errors.Is(e, pgx.ErrNoRows) {
			return missing("消息不存在")
		}
		if e != nil {
			return e
		}
		var m Message
		if e = json.Unmarshal(b, &m); e != nil {
			return e
		}
		if enum(c.Kind, "direct", "group") && m.SenderID != a.ID {
			return forbidden("私聊消息仅作者可以主动提炼到项目")
		}
		if c.ProjectID != "" && c.ProjectID != p.ID {
			return invalid("项目频道消息只能提炼到所属项目")
		}
		if in.NodeID != "" {
			if _, e = getJSON[Node](ctx, tx, "io_nodes", in.NodeID, p.ID); e != nil {
				return e
			}
		}
		if m.PromotedMemoryID != "" {
			existing, e := getJSON[Memory](ctx, tx, "io_memories", m.PromotedMemoryID, p.ID)
			if e == nil {
				result = existing
				return nil
			}
			return conflict("消息已提炼到其他范围，请查看原草稿", "already_promoted")
		}
		result = Memory{ID: newID("memory"), ProjectID: p.ID, NodeID: in.NodeID, Title: strings.TrimSpace(in.Title), Content: m.Body + "\n\n来源：会话 " + c.ID + " / 消息 " + m.ID + "；发送人 " + m.SenderID + "；" + m.CreatedAt.Format(time.RFC3339) + "。此内容尚待负责人确认。", Kind: in.Kind, Status: "draft", Version: 1, UpdatedBy: a.ID, UpdatedAt: time.Now().UTC()}
		if e = validateMemory(result); e != nil {
			return e
		}
		if e = saveMemory(ctx, tx, result); e != nil {
			return e
		}
		m.PromotedMemoryID = result.ID
		b, e = json.Marshal(m)
		if e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `UPDATE io_messages SET data=$2 WHERE id=$1`, m.ID, b); e != nil {
			return e
		}
		return addEvent(ctx, tx, p.ID, a.ID, "memory.promoted", "从消息提炼草稿「"+result.Title+"」，尚未成为正式决策")
	})
	return result, err
}
