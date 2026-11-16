package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

const adminToken = "integration-admin-token-0123456789"

type testAPI struct {
	t       *testing.T
	store   *Store
	handler http.Handler
}

func newTestAPI(t *testing.T) *testAPI {
	t.Helper()
	url := os.Getenv("IO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set IO_TEST_DATABASE_URL for PostgreSQL integration tests")
	}
	ctx := context.Background()
	base, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	schema := newID("iotest")
	if _, err = base.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatal(err)
	}
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	s := &Store{Pool: pool}
	if _, err = pool.Exec(ctx, migration); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO io_members(id,name,role,active,created_at,token_hash) VALUES('admin','管理员','admin',true,now(),$1)`, hashToken(adminToken)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, e := base.Exec(ctx, `DROP SCHEMA `+schema+` CASCADE`)
		base.Close()
		if e != nil {
			t.Error(e)
		}
	})
	return &testAPI{t, s, s.Handler()}
}
func (a *testAPI) call(token, method, path string, body any) (int, []byte) {
	var b bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&b).Encode(body)
	}
	req := httptest.NewRequest(method, path, &b)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	a.handler.ServeHTTP(res, req)
	return res.Code, res.Body.Bytes()
}
func (a *testAPI) must(token, method, path string, body, out any) {
	a.t.Helper()
	status, b := a.call(token, method, path, body)
	if status != 200 {
		a.t.Fatalf("%s %s => %d %s", method, path, status, b)
	}
	if out != nil {
		if err := json.Unmarshal(b, out); err != nil {
			a.t.Fatal(err)
		}
	}
}
func (a *testAPI) member(name string) (Member, string) {
	var v struct {
		Member Member `json:"member"`
		Token  string `json:"token"`
	}
	a.must(adminToken, "POST", "/api/members", map[string]any{"name": name, "role": "member"}, &v)
	return v.Member, v.Token
}
func (a *testAPI) project(name string) (Project, Snapshot) {
	var p Project
	a.must(adminToken, "POST", "/api/projects", map[string]string{"name": name, "description": "业务需求"}, &p)
	var snap Snapshot
	a.must(adminToken, "GET", "/api/projects/"+p.ID+"/snapshot", nil, &snap)
	return p, snap
}
func (a *testAPI) assign(p Project, n Node, owners, ids []string) {
	a.must(adminToken, "PATCH", "/api/projects/"+p.ID+"/nodes/"+n.ID, map[string]any{"ownerIds": owners, "memberIds": ids}, nil)
}
func expectStatus(t *testing.T, want, got int, b []byte) {
	t.Helper()
	if got != want {
		t.Fatalf("status wanted %d got %d: %s", want, got, b)
	}
}
func TestMemoryBaselineAndTaskAcceptance(t *testing.T) {
	a := newTestAPI(t)
	owner, ot := a.member("开发")
	reviewer, rt := a.member("验收")
	outsider, xt := a.member("外部成员")
	_ = outsider
	p, snap := a.project("订单")
	n := snap.Nodes[3]
	a.assign(p, n, []string{owner.ID}, []string{owner.ID, reviewer.ID})
	base := "/api/projects/" + p.ID
	var mem Memory
	a.must(adminToken, "POST", base+"/memories", map[string]any{"title": "取消规则", "content": "付款前可以取消", "kind": "requirement", "status": "published"}, &mem)
	var task Task
	a.must(ot, "POST", base+"/tasks", map[string]any{"nodeId": n.ID, "title": "取消接口", "ownerId": owner.ID, "reviewerId": reviewer.ID, "acceptanceCriteria": "已付款不能取消"}, &task)
	status, b := a.call(ot, "PATCH", base+"/tasks/"+task.ID, map[string]any{"version": task.Version, "status": "done"})
	expectStatus(t, 403, status, b)
	status, b = a.call(rt, "PATCH", base+"/tasks/"+task.ID, map[string]any{"version": task.Version, "status": "done"})
	expectStatus(t, 409, status, b)
	status, b = a.call(xt, "GET", base+"/tasks/"+task.ID+"/context", nil)
	expectStatus(t, 403, status, b)
	a.must(adminToken, "PATCH", base+"/memories/"+mem.ID, map[string]any{"version": mem.Version, "content": "付款前且未锁定库存可以取消"}, &mem)
	status, b = a.call(ot, "POST", base+"/tasks/"+task.ID+"/submit", map[string]any{"version": task.Version, "deliverable": "commit abc"})
	expectStatus(t, 409, status, b)
	if !bytes.Contains(b, []byte("stale_memory")) {
		t.Fatal(string(b))
	}
	var context TaskContext
	a.must(ot, "GET", base+"/tasks/"+task.ID+"/context", nil, &context)
	if !context.Stale || len(context.Changes) != 1 {
		t.Fatal("stale memory not exposed")
	}
	a.must(ot, "POST", base+"/tasks/"+task.ID+"/sync", map[string]any{"version": task.Version}, &task)
	old := task.Version
	a.must(ot, "POST", base+"/tasks/"+task.ID+"/submit", map[string]any{"version": task.Version, "deliverable": "commit abc; tests passed"}, &task)
	status, b = a.call(ot, "PATCH", base+"/tasks/"+task.ID, map[string]any{"version": old, "title": "覆盖"})
	expectStatus(t, 409, status, b)
	a.must(rt, "PATCH", base+"/tasks/"+task.ID, map[string]any{"version": task.Version, "status": "done"}, &task)
	if task.Status != "done" {
		t.Fatal("acceptance failed")
	}
	var history []Memory
	a.must(ot, "GET", base+"/memories/"+mem.ID+"/history", nil, &history)
	if len(history) != 2 || history[1].Content != "付款前可以取消" {
		t.Fatal("memory history overwritten")
	}
}
func TestHandoverReuseAndUsage(t *testing.T) {
	a := newTestAPI(t)
	old, oldToken := a.member("旧负责人")
	next, nextToken := a.member("新负责人")
	p, snap := a.project("来源A")
	n := snap.Nodes[1]
	a.assign(p, n, []string{old.ID}, []string{old.ID})
	base := "/api/projects/" + p.ID
	var mem Memory
	a.must(oldToken, "POST", base+"/memories", map[string]any{"nodeId": n.ID, "title": "产品决策", "content": "订单需要审核", "kind": "decision", "status": "published"}, &mem)
	var task Task
	a.must(oldToken, "POST", base+"/tasks", map[string]any{"nodeId": n.ID, "title": "设计审核", "ownerId": old.ID, "reviewerId": old.ID}, &task)
	var done Task
	a.must(oldToken, "POST", base+"/tasks", map[string]any{"nodeId": n.ID, "title": "已完成", "ownerId": old.ID, "reviewerId": old.ID}, &done)
	a.must(oldToken, "POST", base+"/tasks/"+done.ID+"/submit", map[string]any{"version": done.Version, "deliverable": "已提交"}, &done)
	a.must(oldToken, "PATCH", base+"/tasks/"+done.ID, map[string]any{"version": done.Version, "status": "done"}, &done)
	usage := map[string]any{"requestId": "request-1", "nodeId": n.ID, "taskId": task.ID, "host": "codex", "provider": "openai", "model": "gpt", "inputTokens": 100, "outputTokens": 20, "cacheReadTokens": 40, "costSource": "unknown"}
	var u1, u2 Usage
	a.must(oldToken, "POST", base+"/usage", usage, &u1)
	a.must(oldToken, "POST", base+"/usage", usage, &u2)
	if u1.ID != u2.ID {
		t.Fatal("duplicate usage counted")
	}
	usage["inputTokens"] = 101
	status, b := a.call(oldToken, "POST", base+"/usage", usage)
	expectStatus(t, 409, status, b)
	status, b = a.call(adminToken, "POST", "/api/members/"+old.ID+"/deactivate", map[string]any{})
	expectStatus(t, 409, status, b)
	var handover Handover
	a.must(adminToken, "POST", base+"/handovers", map[string]any{"fromMemberId": old.ID, "toMemberId": next.ID, "nodeIds": []string{n.ID}, "reason": "岗位变更"}, &handover)
	if !strings.Contains(handover.Summary, task.ID) || !strings.Contains(handover.Summary, mem.ID) {
		t.Fatal("handover missing source references")
	}
	status, b = a.call(adminToken, "POST", base+"/handovers/"+handover.ID+"/accept", map[string]any{})
	expectStatus(t, 403, status, b)
	a.must(nextToken, "POST", base+"/handovers/"+handover.ID+"/accept", map[string]any{}, &handover)
	a.must(adminToken, "GET", base+"/snapshot", nil, &snap)
	for _, v := range snap.Tasks {
		if v.ID == task.ID && v.OwnerID != next.ID {
			t.Fatal("unfinished task not transferred")
		}
		if v.ID == done.ID && v.OwnerID != old.ID {
			t.Fatal("historical task ownership changed")
		}
	}
	if snap.Usage[0].MemberID != old.ID {
		t.Fatal("historical usage reassigned")
	}
	a.must(adminToken, "POST", "/api/members/"+old.ID+"/deactivate", map[string]any{}, nil)
	status, b = a.call(oldToken, "GET", "/api/me", nil)
	expectStatus(t, 401, status, b)
	var reused Project
	a.must(adminToken, "POST", base+"/reuse", map[string]any{"name": "新项目B", "description": "需要二级审核", "memoryIds": []string{mem.ID}}, &reused)
	a.must(adminToken, "GET", "/api/projects/"+reused.ID+"/snapshot", nil, &snap)
	if len(snap.Usage) != 0 || len(snap.Handovers) != 0 || len(snap.Issues) != 0 {
		t.Fatal("private operational data copied")
	}
	for _, n := range snap.Nodes {
		if len(n.OwnerIDs) != 0 || len(n.MemberIDs) != 0 {
			t.Fatal("people copied")
		}
	}
	for _, v := range snap.Tasks {
		if v.Status != "todo" || v.OwnerID != "" || v.Deliverable != "" {
			t.Fatal("task state copied")
		}
	}
	if len(snap.Memories) != 1 || snap.Memories[0].Status != "draft" || snap.Memories[0].SourceMemoryID != mem.ID {
		t.Fatal("reuse not draft with provenance")
	}
}
func TestConversationPrivacyPaginationReceiptsAndPromotion(t *testing.T) {
	a := newTestAPI(t)
	alice, at := a.member("甲")
	bob, bt := a.member("乙")
	_, ct := a.member("丙")
	var c Conversation
	a.must(at, "POST", "/api/conversations", map[string]any{"kind": "direct", "participantIds": []string{bob.ID}}, &c)
	var same Conversation
	a.must(bt, "POST", "/api/conversations", map[string]any{"kind": "direct", "participantIds": []string{alice.ID}}, &same)
	if c.ID != same.ID {
		t.Fatal("direct pair duplicated")
	}
	path := "/api/conversations/" + c.ID
	ids := []string{}
	for i := 0; i < 5; i++ {
		var m Message
		a.must(at, "POST", path+"/messages", map[string]any{"body": fmt.Sprintf("消息%d", i)}, &m)
		ids = append(ids, m.ID)
	}
	for _, tok := range []string{adminToken, ct} {
		status, b := a.call(tok, "GET", path+"/messages", nil)
		expectStatus(t, 403, status, b)
	}
	var convs []Conversation
	a.must(adminToken, "GET", "/api/conversations", nil, &convs)
	for _, v := range convs {
		if v.ID == c.ID {
			t.Fatal("admin listed private conversation")
		}
	}
	a.must(bt, "GET", "/api/conversations", nil, &convs)
	if len(convs) != 1 || convs[0].UnreadCount != 5 {
		t.Fatal("unread count invalid")
	}
	var page struct {
		Messages []Message `json:"messages"`
		HasMore  bool      `json:"hasMore"`
		Receipts []Receipt `json:"receipts"`
	}
	a.must(bt, "GET", path+"/messages?limit=2", nil, &page)
	if len(page.Messages) != 2 || page.Messages[0].ID != ids[3] || !page.HasMore {
		t.Fatal("latest chronological page invalid")
	}
	a.must(bt, "GET", path+"/messages?limit=2&before="+ids[3], nil, &page)
	if page.Messages[0].ID != ids[1] || page.Messages[1].ID != ids[2] {
		t.Fatal("older cursor page invalid")
	}
	a.must(bt, "POST", path+"/read", map[string]any{"messageId": ids[4]}, nil)
	a.must(bt, "POST", path+"/read", map[string]any{"messageId": ids[0]}, nil)
	a.must(bt, "GET", "/api/conversations", nil, &convs)
	if convs[0].UnreadCount != 0 {
		t.Fatal("read cursor regressed")
	}
	p, snap := a.project("提炼目标")
	a.assign(p, snap.Nodes[0], []string{alice.ID}, []string{alice.ID, bob.ID})
	status, b := a.call(bt, "POST", path+"/messages/"+ids[0]+"/promote", map[string]any{"projectId": p.ID, "title": "私聊决策"})
	expectStatus(t, 403, status, b)
	var memory Memory
	a.must(at, "POST", path+"/messages/"+ids[0]+"/promote", map[string]any{"projectId": p.ID, "title": "待确认意见"}, &memory)
	if memory.Status != "draft" || !strings.Contains(memory.Content, ids[0]) {
		t.Fatal("promotion not cited draft")
	}
	a.must(at, "GET", "/api/projects/"+p.ID+"/snapshot", nil, &snap)
	if len(snap.Memories) != 1 {
		t.Fatal("promotion missing")
	}
	status, b = a.call(at, "POST", "/api/conversations", map[string]any{"kind": "task", "projectId": p.ID, "taskId": "not-found"})
	expectStatus(t, 404, status, b)
}

func TestConcurrentMemoryCAS(t *testing.T) {
	a := newTestAPI(t)
	p, _ := a.project("并发")
	base := "/api/projects/" + p.ID
	var m Memory
	a.must(adminToken, "POST", base+"/memories", map[string]any{"title": "接口", "content": "v1", "kind": "contract", "status": "published"}, &m)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c, _ := a.call(adminToken, "PATCH", base+"/memories/"+m.ID, map[string]any{"version": 1, "content": fmt.Sprintf("proposal%d", i)})
			codes <- c
		}(i)
	}
	wg.Wait()
	close(codes)
	seen := map[int]int{}
	for c := range codes {
		seen[c]++
	}
	if seen[200] != 1 || seen[409] != 1 {
		t.Fatalf("CAS results: %v", seen)
	}
}

func TestReviewChangesRequireResubmissionAndCurrentMemory(t *testing.T) {
	a := newTestAPI(t)
	p, snap := a.project("验收变更")
	n := snap.Nodes[0]
	base := "/api/projects/" + p.ID
	var m Memory
	a.must(adminToken, "POST", base+"/memories", map[string]any{"title": "要求", "content": "一版", "kind": "requirement", "status": "published"}, &m)
	var task Task
	a.must(adminToken, "POST", base+"/tasks", map[string]any{"nodeId": n.ID, "title": "成果", "acceptanceCriteria": "检查一版"}, &task)
	a.must(adminToken, "POST", base+"/tasks/"+task.ID+"/submit", map[string]any{"version": task.Version, "deliverable": "成果v1"}, &task)
	a.must(adminToken, "PATCH", base+"/memories/"+m.ID, map[string]any{"version": m.Version, "content": "二版"}, &m)
	status, b := a.call(adminToken, "PATCH", base+"/tasks/"+task.ID, map[string]any{"version": task.Version, "status": "done"})
	expectStatus(t, 409, status, b)
	a.must(adminToken, "POST", base+"/tasks/"+task.ID+"/sync", map[string]any{"version": task.Version}, &task)
	if task.Status != "in_progress" {
		t.Fatal("sync did not invalidate review")
	}
	a.must(adminToken, "POST", base+"/tasks/"+task.ID+"/submit", map[string]any{"version": task.Version, "deliverable": "成果v2"}, &task)
	a.must(adminToken, "PATCH", base+"/tasks/"+task.ID, map[string]any{"version": task.Version, "acceptanceCriteria": "新条件"}, &task)
	if task.Status != "in_progress" {
		t.Fatal("review edited without resubmission")
	}
	status, b = a.call(adminToken, "PATCH", base+"/tasks/"+task.ID, map[string]any{"version": task.Version, "status": "done"})
	expectStatus(t, 409, status, b)
	a.must(adminToken, "POST", base+"/tasks/"+task.ID+"/submit", map[string]any{"version": task.Version, "deliverable": "成果v3"}, &task)
	a.must(adminToken, "PATCH", base+"/tasks/"+task.ID, map[string]any{"version": task.Version, "status": "done"}, &task)
}
func TestConcurrentUsageAcrossProjectsAndScopeValidation(t *testing.T) {
	a := newTestAPI(t)
	p1, s1 := a.project("用量A")
	p2, s2 := a.project("用量B")
	input := map[string]any{"requestId": "same-upstream-request", "host": "codex", "provider": "openai", "model": "gpt", "inputTokens": 100, "outputTokens": 10, "cacheReadTokens": 25, "costSource": "unknown"}
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for _, pid := range []string{p1.ID, p2.ID} {
		wg.Add(1)
		go func(pid string) {
			defer wg.Done()
			status, _ := a.call(adminToken, "POST", "/api/projects/"+pid+"/usage", input)
			codes <- status
		}(pid)
	}
	wg.Wait()
	close(codes)
	counts := map[int]int{}
	for code := range codes {
		counts[code]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatalf("duplicate global usage result %v", counts)
	}
	var task Task
	a.must(adminToken, "POST", "/api/projects/"+p1.ID+"/tasks", map[string]any{"title": "A任务", "nodeId": s1.Nodes[0].ID}, &task)
	bad := map[string]any{"requestId": "scope-bad", "host": "dsh", "provider": "deepseek", "model": "deepseek", "inputTokens": 1, "outputTokens": 1, "cacheReadTokens": 0, "costSource": "unknown", "nodeId": s2.Nodes[0].ID, "taskId": task.ID}
	status, b := a.call(adminToken, "POST", "/api/projects/"+p1.ID+"/usage", bad)
	expectStatus(t, 422, status, b)
	status, b = a.call(adminToken, "POST", "/api/projects/"+p2.ID+"/usage", bad)
	expectStatus(t, 404, status, b)
	input["cacheReadTokens"] = 101
	status, b = a.call(adminToken, "POST", "/api/projects/"+p1.ID+"/usage", input)
	expectStatus(t, 422, status, b)
}
func TestCommunicationScopeAndMentionValidation(t *testing.T) {
	a := newTestAPI(t)
	alice, at := a.member("甲")
	bob, bt := a.member("乙")
	outsider, _ := a.member("丙")
	p, snap := a.project("频道权限")
	p2, snap2 := a.project("另一个项目")
	a.assign(p, snap.Nodes[0], []string{alice.ID}, []string{alice.ID, bob.ID})
	var c Conversation
	a.must(at, "POST", "/api/conversations", map[string]any{"kind": "node", "projectId": p.ID, "nodeId": snap.Nodes[0].ID}, &c)
	status, b := a.call(at, "POST", "/api/conversations/"+c.ID+"/messages", map[string]any{"body": "无权限提及", "mentionIds": []string{outsider.ID}})
	expectStatus(t, 422, status, b)
	var msg Message
	a.must(bt, "POST", "/api/conversations/"+c.ID+"/messages", map[string]any{"body": "频道讨论", "mentionIds": []string{alice.ID}}, &msg)
	status, b = a.call(at, "POST", "/api/conversations", map[string]any{"kind": "node", "projectId": p.ID, "nodeId": snap2.Nodes[0].ID})
	expectStatus(t, 404, status, b)
	var direct Conversation
	a.must(at, "POST", "/api/conversations", map[string]any{"kind": "direct", "participantIds": []string{bob.ID}}, &direct)
	status, b = a.call(at, "GET", "/api/conversations/"+direct.ID+"/messages?before="+msg.ID, nil)
	expectStatus(t, 422, status, b)
	status, b = a.call(at, "POST", "/api/conversations/"+direct.ID+"/read", map[string]any{"messageId": msg.ID})
	expectStatus(t, 422, status, b)
	status, b = a.call(adminToken, "POST", "/api/conversations/"+c.ID+"/messages/"+msg.ID+"/promote", map[string]any{"projectId": p2.ID, "title": "越界"})
	expectStatus(t, 422, status, b)
	a.assign(p, snap.Nodes[0], []string{alice.ID}, []string{alice.ID})
	status, b = a.call(bt, "GET", "/api/conversations/"+c.ID+"/messages", nil)
	expectStatus(t, 403, status, b)
	status, b = a.call(bt, "GET", "/api/conversations/"+direct.ID+"/messages", nil)
	expectStatus(t, 200, status, b)
}

func TestReviewerCanReturnOnlySubmittedWorkWithoutEditing(t *testing.T) {
	a := newTestAPI(t)
	owner, ot := a.member("执行人")
	reviewer, rt := a.member("独立验收人")
	_, xt := a.member("其他成员")
	p, snap := a.project("验收退回")
	n := snap.Nodes[3]
	a.assign(p, n, []string{owner.ID}, []string{owner.ID, reviewer.ID})
	base := "/api/projects/" + p.ID
	var task Task
	a.must(ot, "POST", base+"/tasks", map[string]any{"nodeId": n.ID, "title": "接口实现", "description": "原正文", "ownerId": owner.ID, "reviewerId": reviewer.ID}, &task)
	path := base + "/tasks/" + task.ID
	status, b := a.call(rt, "PATCH", path, map[string]any{"version": task.Version, "status": "in_progress"})
	expectStatus(t, 403, status, b)
	a.must(ot, "POST", path+"/submit", map[string]any{"version": task.Version, "deliverable": "提交记录"}, &task)
	for _, change := range []map[string]any{{"ownerId": reviewer.ID}, {"description": "未经执行人确认的新正文"}, {"title": "改名"}, {"reviewerId": owner.ID}, {"collaboratorIds": []string{reviewer.ID}}, {"acceptanceCriteria": "降低标准"}} {
		change["version"] = task.Version
		change["status"] = "in_progress"
		status, b = a.call(rt, "PATCH", path, change)
		expectStatus(t, 422, status, b)
	}
	status, b = a.call(xt, "PATCH", path, map[string]any{"version": task.Version, "status": "in_progress"})
	expectStatus(t, 403, status, b)
	a.must(rt, "PATCH", path, map[string]any{"version": task.Version, "status": "in_progress"}, &task)
	if task.Status != "in_progress" || task.OwnerID != owner.ID || task.Description != "原正文" || task.Deliverable != "提交记录" {
		t.Fatal("return changed task contents or omitted prior deliverable")
	}
	status, b = a.call(rt, "PATCH", path, map[string]any{"version": task.Version, "status": "in_progress"})
	expectStatus(t, 403, status, b)
	status, b = a.call(rt, "PATCH", path, map[string]any{"version": task.Version, "description": "借用退回权限"})
	expectStatus(t, 403, status, b)
	a.must(ot, "POST", path+"/submit", map[string]any{"version": task.Version, "deliverable": "修订成果"}, &task)
	a.must(adminToken, "PATCH", path, map[string]any{"version": task.Version, "status": "in_progress"}, &task)
	var state Snapshot
	a.must(adminToken, "GET", base+"/snapshot", nil, &state)
	returned := 0
	for _, e := range state.Events {
		if e.Kind == "task.returned" {
			returned++
		}
	}
	if returned != 2 {
		t.Fatal("missing explicit return audit events")
	}
}

func TestActionableNotificationsAreTransactionalAndRecipientScoped(t *testing.T) {
	a := newTestAPI(t)
	owner, ot := a.member("执行甲")
	reviewer, rt := a.member("验收乙")
	next, nt := a.member("接手丙")
	p, snap := a.project("通知流程")
	n := snap.Nodes[3]
	a.assign(p, n, []string{owner.ID}, []string{owner.ID, reviewer.ID, next.ID})
	base := "/api/projects/" + p.ID
	list := func(token string) []Notification {
		var xs []Notification
		a.must(token, "GET", "/api/notifications", nil, &xs)
		return xs
	}
	find := func(xs []Notification, kind, taskID string) Notification {
		t.Helper()
		for _, v := range xs {
			if v.Kind == kind && (taskID == "" || v.TaskID == taskID) {
				return v
			}
		}
		t.Fatalf("notification missing %s %s in %v", kind, taskID, xs)
		return Notification{}
	}
	var task Task
	a.must(adminToken, "POST", base+"/tasks", map[string]any{"nodeId": n.ID, "title": "待执行任务", "ownerId": owner.ID, "reviewerId": reviewer.ID}, &task)
	assigned := find(list(ot), "task.assigned", task.ID)
	if assigned.MemberID != owner.ID || assigned.ProjectID != p.ID || assigned.ReadAt != nil {
		t.Fatal("invalid assignment notice")
	}
	if len(list(adminToken)) != 0 || len(list(rt)) != 0 {
		t.Fatal("notices leaked to nonrecipient")
	}
	status, b := a.call(adminToken, "POST", "/api/notifications/"+assigned.ID+"/read", map[string]any{})
	expectStatus(t, 404, status, b)
	a.must(ot, "POST", "/api/notifications/"+assigned.ID+"/read", map[string]any{}, nil)
	a.must(ot, "POST", "/api/notifications/"+assigned.ID+"/read", map[string]any{}, nil)
	assigned = find(list(ot), "task.assigned", task.ID)
	if assigned.ReadAt == nil {
		t.Fatal("read not persisted")
	}
	a.must(adminToken, "GET", base+"/snapshot", nil, &snap)
	if snap.Tasks[0].Status != "todo" {
		t.Fatal("reading notice accepted work")
	}
	a.must(ot, "POST", base+"/tasks/"+task.ID+"/submit", map[string]any{"version": task.Version, "deliverable": "待验收成果"}, &task)
	find(list(rt), "task.review_requested", task.ID)
	a.must(rt, "PATCH", base+"/tasks/"+task.ID, map[string]any{"version": task.Version, "status": "in_progress"}, &task)
	find(list(ot), "task.returned", task.ID)
	var memory Memory
	a.must(adminToken, "POST", base+"/memories", map[string]any{"title": "新规则草稿", "content": "付款前可取消", "kind": "requirement", "status": "draft"}, &memory)
	for _, v := range list(ot) {
		if v.Kind == "memory.changed" {
			t.Fatal("draft publication notified as formal change")
		}
	}
	a.must(adminToken, "PATCH", base+"/memories/"+memory.ID, map[string]any{"version": memory.Version, "status": "published"}, &memory)
	find(list(ot), "memory.changed", task.ID)
	before := len(list(ot))
	status, b = a.call(adminToken, "PATCH", base+"/memories/"+memory.ID, map[string]any{"version": 1, "content": "冲突写入"})
	expectStatus(t, 409, status, b)
	if len(list(ot)) != before {
		t.Fatal("failed CAS created notification")
	}
	a.must(adminToken, "PATCH", base+"/tasks/"+task.ID, map[string]any{"version": task.Version, "ownerId": next.ID}, &task)
	find(list(nt), "task.assigned", task.ID)
	var issue Issue
	a.must(ot, "POST", base+"/issues", map[string]any{"nodeId": n.ID, "taskId": task.ID, "title": "请确认规则", "assigneeId": next.ID}, &issue)
	issueNotice := find(list(nt), "issue.assigned", task.ID)
	if issueNotice.IssueID != issue.ID {
		t.Fatal("missing issue link")
	}
	a.must(nt, "POST", "/api/notifications/"+issueNotice.ID+"/read", map[string]any{}, nil)
	a.must(adminToken, "GET", base+"/snapshot", nil, &snap)
	if snap.Issues[0].Status != "open" {
		t.Fatal("reading notice accepted issue")
	}
	// Actions by the recipient do not generate self-notifications.
	before = len(list(ot))
	a.must(ot, "POST", base+"/tasks", map[string]any{"nodeId": n.ID, "title": "自己创建并执行", "ownerId": owner.ID}, nil)
	if len(list(ot)) != before {
		t.Fatal("actor received self notification")
	}
	var h Handover
	a.must(adminToken, "POST", base+"/handovers", map[string]any{"fromMemberId": next.ID, "toMemberId": reviewer.ID, "nodeIds": []string{n.ID}, "reason": "岗位交接"}, &h)
	hn := find(list(rt), "handover.assigned", "")
	if hn.HandoverID != h.ID {
		t.Fatal("missing handover link")
	}
	a.must(rt, "POST", "/api/notifications/"+hn.ID+"/read", map[string]any{}, nil)
	a.must(adminToken, "GET", base+"/snapshot", nil, &snap)
	if snap.Handovers[0].Status != "pending" {
		t.Fatal("reading notice accepted handover")
	}
	// The former member lost project access, so old notices cannot disclose project data.
	if len(list(nt)) != 0 {
		t.Fatal("inaccessible project notifications listed")
	}
	status, b = a.call(nt, "POST", "/api/notifications/"+issueNotice.ID+"/read", map[string]any{})
	expectStatus(t, 403, status, b)
}
func TestPublishedMemoryNotifiesOnlyImpactedUnfinishedTaskOwners(t *testing.T) {
	a := newTestAPI(t)
	dev, dt := a.member("开发")
	tester, tt := a.member("测试")
	p, snap := a.project("变更通知范围")
	devNode, testNode := snap.Nodes[3], snap.Nodes[6]
	a.assign(p, devNode, []string{dev.ID}, []string{dev.ID})
	a.assign(p, testNode, []string{tester.ID}, []string{tester.ID})
	base := "/api/projects/" + p.ID
	var active, done, testTask Task
	a.must(dt, "POST", base+"/tasks", map[string]any{"nodeId": devNode.ID, "title": "开发进行中", "ownerId": dev.ID}, &active)
	a.must(dt, "POST", base+"/tasks", map[string]any{"nodeId": devNode.ID, "title": "开发已完成", "ownerId": dev.ID}, &done)
	a.must(dt, "POST", base+"/tasks/"+done.ID+"/submit", map[string]any{"version": done.Version, "deliverable": "完成"}, &done)
	a.must(adminToken, "PATCH", base+"/tasks/"+done.ID, map[string]any{"version": done.Version, "status": "done"}, &done)
	a.must(tt, "POST", base+"/tasks", map[string]any{"nodeId": testNode.ID, "title": "测试进行中", "ownerId": tester.ID}, &testTask)
	var m Memory
	a.must(adminToken, "POST", base+"/memories", map[string]any{"nodeId": devNode.ID, "title": "开发接口约定", "content": "状态码定义", "kind": "contract", "status": "published"}, &m)
	var devNotices, testNotices []Notification
	a.must(dt, "GET", "/api/notifications", nil, &devNotices)
	a.must(tt, "GET", "/api/notifications", nil, &testNotices)
	if len(devNotices) != 1 || devNotices[0].Kind != "memory.changed" || devNotices[0].TaskID != active.ID {
		t.Fatal("published memory notified completed or wrong tasks")
	}
	if len(testNotices) != 0 {
		t.Fatal("node memory notified unrelated node")
	}
	a.must(adminToken, "PATCH", base+"/memories/"+m.ID, map[string]any{"version": m.Version, "status": "superseded"}, &m)
	// Newly created memory was not in the task baseline; sync first, then publish another update.
	a.must(dt, "POST", base+"/tasks/"+active.ID+"/sync", map[string]any{"version": active.Version}, &active)
	a.must(adminToken, "PATCH", base+"/memories/"+m.ID, map[string]any{"version": m.Version, "status": "published"}, &m)
	a.must(dt, "POST", base+"/tasks/"+active.ID+"/sync", map[string]any{"version": active.Version}, &active)
	a.must(adminToken, "PATCH", base+"/memories/"+m.ID, map[string]any{"version": m.Version, "status": "superseded"}, &m)
	a.must(dt, "GET", "/api/notifications", nil, &devNotices)
	if len(devNotices) != 3 {
		t.Fatalf("superseded baseline notification missing: %d", len(devNotices))
	}
}
