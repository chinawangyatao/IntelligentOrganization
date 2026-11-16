package platform

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Store) reportUsage(w http.ResponseWriter, r *http.Request) (any, error) {
	var in struct {
		RequestID       string   `json:"requestId"`
		NodeID          string   `json:"nodeId"`
		TaskID          string   `json:"taskId"`
		MemberID        string   `json:"memberId"`
		Host            string   `json:"host"`
		Provider        string   `json:"provider"`
		Model           string   `json:"model"`
		InputTokens     int64    `json:"inputTokens"`
		OutputTokens    int64    `json:"outputTokens"`
		CacheReadTokens int64    `json:"cacheReadTokens"`
		Cost            *float64 `json:"cost"`
		Currency        string   `json:"currency"`
		CostSource      string   `json:"costSource"`
	}
	if err := decode(r, &in); err != nil {
		return nil, err
	}
	for _, v := range []struct{ s, label string }{{in.RequestID, "请求ID"}, {in.Host, "宿主"}, {in.Provider, "供应商"}, {in.Model, "模型"}} {
		if err := validText(v.s, v.label, 300); err != nil {
			return nil, err
		}
	}
	if in.InputTokens < 0 || in.OutputTokens < 0 || in.CacheReadTokens < 0 || in.CacheReadTokens > in.InputTokens {
		return nil, invalid("用量必须非负，缓存命中不能超过输入token")
	}
	if in.CostSource == "" {
		in.CostSource = "unknown"
	}
	if !enum(in.CostSource, "reported", "estimated", "unknown") {
		return nil, invalid("费用来源无效")
	}
	if in.Cost != nil {
		if math.IsNaN(*in.Cost) || math.IsInf(*in.Cost, 0) || *in.Cost < 0 {
			return nil, invalid("费用必须是非负有限数")
		}
		if in.CostSource == "unknown" || strings.TrimSpace(in.Currency) == "" {
			return nil, invalid("提供费用时需要币种与费用来源")
		}
	} else if in.CostSource != "unknown" {
		return nil, invalid("已报告或估算费用需要金额")
	}
	a := actor(r)
	if in.MemberID == "" {
		in.MemberID = a.ID
	}
	if in.MemberID != a.ID && !isAdmin(a) {
		return nil, forbidden("不能代其他成员上报用量")
	}
	ctx := r.Context()
	var u Usage
	err := s.projectTx(ctx, a, r.PathValue("pid"), true, func(tx pgx.Tx, p Project) error {
		if err := checkProjectMember(ctx, tx, p.ID, in.MemberID); err != nil {
			return err
		}
		if in.TaskID != "" {
			t, err := getJSON[Task](ctx, tx, "io_tasks", in.TaskID, p.ID)
			if err != nil {
				return err
			}
			if in.NodeID == "" {
				in.NodeID = t.NodeID
			}
			if in.NodeID != t.NodeID {
				return invalid("用量任务与节点不匹配")
			}
		}
		if in.NodeID != "" {
			if _, err := getJSON[Node](ctx, tx, "io_nodes", in.NodeID, p.ID); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, in.MemberID+":"+in.Host+":"+in.RequestID); err != nil {
			return err
		}
		var b []byte
		err := tx.QueryRow(ctx, `SELECT data FROM io_usage WHERE member_id=$1 AND host=$2 AND request_id=$3`, in.MemberID, in.Host, in.RequestID).Scan(&b)
		if err == nil {
			if err = json.Unmarshal(b, &u); err != nil {
				return err
			}
			if u.ProjectID != p.ID {
				return conflict("该请求ID已关联其他项目", "duplicate_request")
			}
			if u.NodeID != in.NodeID || u.TaskID != in.TaskID || u.Provider != in.Provider || u.Model != in.Model || u.InputTokens != in.InputTokens || u.OutputTokens != in.OutputTokens || u.CacheReadTokens != in.CacheReadTokens || u.Currency != in.Currency || u.CostSource != in.CostSource || !sameCost(u.Cost, in.Cost) {
				return conflict("同一请求ID不能上报不同用量", "duplicate_request")
			}
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		u = Usage{newID("usage"), in.RequestID, p.ID, in.NodeID, in.TaskID, in.MemberID, in.Host, in.Provider, in.Model, in.InputTokens, in.OutputTokens, in.CacheReadTokens, in.Cost, in.Currency, in.CostSource, time.Now().UTC()}
		b, err = json.Marshal(u)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO io_usage(id,project_id,member_id,host,request_id,data) VALUES($1,$2,$3,$4,$5,$6)`, u.ID, p.ID, u.MemberID, u.Host, u.RequestID, b)
		return err
	})
	return u, err
}
func sameCost(a, b *float64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
