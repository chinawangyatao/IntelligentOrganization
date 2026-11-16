package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type preparedWork struct {
	Session WorkSession `json:"session"`
	Token   string      `json:"token"`
}

func prepareWork(a *testAPI, token string, p Project, t Task, host string) preparedWork {
	a.t.Helper()
	var out preparedWork
	a.must(token, "POST", "/api/projects/"+p.ID+"/tasks/"+t.ID+"/work-sessions", map[string]string{"host": host}, &out)
	return out
}
func activateWork(a *testAPI, token string, s WorkSession, native string) WorkSession {
	a.t.Helper()
	var out WorkSession
	a.must(token, "POST", "/api/work-sessions/"+s.ID+"/attach", map[string]string{"nativeSessionId": native}, &out)
	return out
}
func adminTask(a *testAPI, p Project, n Node, title string) Task {
	a.t.Helper()
	var out Task
	a.must(adminToken, "POST", "/api/projects/"+p.ID+"/tasks", map[string]string{"nodeId": n.ID, "title": title, "ownerId": "admin", "reviewerId": "admin"}, &out)
	return out
}

func TestWorkSessionTimestampsSurviveDatabaseRoundTrip(t *testing.T) {
	a := newTestAPI(t)
	p, snap := a.project("时间精度回归")
	task := adminTask(a, p, snap.Nodes[3], "会话绑定")
	g := prepareWork(a, adminToken, p, task, "codex")
	assertTimes := func(phase string, response, persisted WorkSession) {
		t.Helper()
		for field, pair := range map[string][2]time.Time{
			"createdAt": {response.CreatedAt, persisted.CreatedAt},
			"expiresAt": {response.ExpiresAt, persisted.ExpiresAt},
			"updatedAt": {response.UpdatedAt, persisted.UpdatedAt},
		} {
			immediate, reread := pair[0].Format(time.RFC3339Nano), pair[1].Format(time.RFC3339Nano)
			if immediate != reread {
				t.Errorf("%s %s changed after persistence: response=%s database=%s", phase, field, immediate, reread)
			}
		}
	}
	var reread WorkSession
	a.must(g.Token, "GET", "/api/agent/session", nil, &reread)
	assertTimes("create", g.Session, reread)
	active := activateWork(a, adminToken, g.Session, "timestamp-regression-thread")
	a.must(g.Token, "GET", "/api/agent/session", nil, &reread)
	assertTimes("attach", active, reread)
	if g.Session.CreatedAt.Format(time.RFC3339Nano) != active.CreatedAt.Format(time.RFC3339Nano) {
		t.Error("create and attach must serialize the same immutable createdAt")
	}
	var revoked WorkSession
	a.must(adminToken, "POST", "/api/work-sessions/"+g.Session.ID+"/revoke", nil, &revoked)
	var listed []WorkSession
	a.must(adminToken, "GET", "/api/projects/"+p.ID+"/tasks/"+task.ID+"/work-sessions", nil, &listed)
	if len(listed) != 1 {
		t.Fatalf("expected one session, got %d", len(listed))
	}
	assertTimes("revoke", revoked, listed[0])
}

func TestWorkSessionImmutableScopeAndHostThreads(t *testing.T) {
	a := newTestAPI(t)
	pa, sa := a.project("同名项目")
	pb, sb := a.project("同名项目")
	ta := adminTask(a, pa, sa.Nodes[3], "同名任务")
	tb := adminTask(a, pb, sb.Nodes[3], "同名任务")
	ga := prepareWork(a, adminToken, pa, ta, "codex")
	gb := prepareWork(a, adminToken, pb, tb, "codex")
	if ga.Session.ProjectID != pa.ID || ga.Session.TaskID != ta.ID || ga.Session.MemberID != "admin" || ga.Session.NodeID != ta.NodeID || ga.Session.Status != "prepared" || ga.Session.ServiceInstanceID == "" || ga.Session.ServiceInstanceID != gb.Session.ServiceInstanceID {
		t.Fatalf("incorrect immutable session metadata: %+v", ga.Session)
	}
	if ttl := ga.Session.ExpiresAt.Sub(ga.Session.CreatedAt); ttl != 24*time.Hour {
		t.Fatalf("unexpected grant TTL: %s", ttl)
	}
	var hash string
	if err := a.store.Pool.QueryRow(context.Background(), `SELECT token_hash FROM io_work_sessions WHERE id=$1`, ga.Session.ID).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if hash == ga.Token || hash != hashToken(ga.Token) {
		t.Fatal("grant must be stored only as a hash")
	}
	var preparedContext struct {
		Session WorkSession `json:"session"`
		Context TaskContext `json:"context"`
	}
	a.must(ga.Token, "GET", "/api/agent/context", nil, &preparedContext)
	if preparedContext.Session.Status != "prepared" || preparedContext.Context.Task.ID != ta.ID {
		t.Fatal("prepared scope read failed")
	}
	status, b := a.call(ga.Token, "POST", "/api/projects/"+pa.ID+"/tasks/"+ta.ID+"/sync", map[string]int{"version": ta.Version})
	expectStatus(t, 409, status, b)
	for _, native := range []string{"../other", "thread/other", "bad thread", "_leading", strings.Repeat("a", 201), "线程"} {
		status, b = a.call(adminToken, "POST", "/api/work-sessions/"+ga.Session.ID+"/attach", map[string]string{"nativeSessionId": native})
		expectStatus(t, 422, status, b)
	}
	active := activateWork(a, adminToken, ga.Session, "native-thread-a")
	again := activateWork(a, adminToken, ga.Session, "native-thread-a")
	if again.NativeSessionID != active.NativeSessionID || again.Status != "active" {
		t.Fatal("same-thread attach not idempotent")
	}
	status, b = a.call(adminToken, "POST", "/api/work-sessions/"+ga.Session.ID+"/attach", map[string]string{"nativeSessionId": "native-thread-changed"})
	expectStatus(t, 409, status, b)
	status, b = a.call(adminToken, "POST", "/api/work-sessions/"+gb.Session.ID+"/attach", map[string]string{"nativeSessionId": "native-thread-a"})
	expectStatus(t, 409, status, b)
	activateWork(a, adminToken, gb.Session, "native-thread-b")
	var projects []Project
	a.must(ga.Token, "GET", "/api/projects", nil, &projects)
	if len(projects) != 1 || projects[0].ID != pa.ID {
		t.Fatalf("scope leaked other projects: %+v", projects)
	}
	var full []Project
	a.must(adminToken, "GET", "/api/projects", nil, &full)
	if len(full) != 2 {
		t.Fatal("normal member/admin auth changed")
	}
	a.must(gb.Token, "GET", "/api/agent/context", nil, nil)
	status, b = a.call(ga.Token, "GET", "/api/projects/"+pb.ID+"/snapshot", nil)
	expectStatus(t, 403, status, b)
	status, b = a.call(ga.Token, "GET", "/api/projects/"+pa.ID+"/tasks/"+tb.ID+"/context", nil)
	expectStatus(t, 403, status, b)
	status, b = a.call(adminToken, "GET", "/api/agent/context", nil)
	expectStatus(t, 403, status, b)
	for _, thread := range []string{"native-thread-b", "fork-of-thread-a"} {
		req := httptest.NewRequest("GET", "/api/agent/context", nil)
		req.Header.Set("Authorization", "Bearer "+ga.Token)
		req.Header.Set("X-IO-Thread-ID", thread)
		res := httptest.NewRecorder()
		a.handler.ServeHTTP(res, req)
		expectStatus(t, 403, res.Code, res.Body.Bytes())
	}
	req := httptest.NewRequest("GET", "/api/agent/context", nil)
	req.Header.Set("Authorization", "Bearer "+ga.Token)
	req.Header.Set("X-IO-Thread-ID", "native-thread-a")
	res := httptest.NewRecorder()
	a.handler.ServeHTTP(res, req)
	expectStatus(t, 200, res.Code, res.Body.Bytes())
	var listed []WorkSession
	a.must(adminToken, "GET", "/api/projects/"+pa.ID+"/tasks/"+ta.ID+"/work-sessions", nil, &listed)
	if len(listed) != 1 || listed[0].ID != ga.Session.ID {
		t.Fatal("session metadata list wrong")
	}
	raw, _ := json.Marshal(listed)
	if bytes.Contains(raw, []byte(ga.Token)) || bytes.Contains(raw, []byte(hash)) {
		t.Fatal("session metadata exposed grant material")
	}
}
func TestWorkSessionGrantDoesNotInheritAdminPowers(t *testing.T) {
	a := newTestAPI(t)
	p, snap := a.project("受限管理员AI")
	task := adminTask(a, p, snap.Nodes[3], "绑定任务")
	g := prepareWork(a, adminToken, p, task, "codex")
	activateWork(a, adminToken, g.Session, "scoped-admin-thread")
	base := "/api/projects/" + p.ID
	denied := []struct {
		method, path string
		body         any
	}{
		{"GET", "/api/members", nil}, {"GET", "/api/organization/overview", nil}, {"GET", "/api/conversations", nil}, {"GET", "/api/notifications", nil},
		{"POST", "/api/projects", map[string]string{"name": "越权项目"}}, {"POST", "/api/members", map[string]string{"name": "越权成员"}},
		{"PATCH", base + "/nodes/" + task.NodeID, map[string]any{"ownerIds": []string{"admin"}}}, {"POST", base + "/tasks", map[string]string{"nodeId": task.NodeID, "title": "越权新任务"}},
		{"POST", base + "/reuse", map[string]any{"name": "越权复用", "memoryIds": []string{}}}, {"POST", base + "/handovers", map[string]any{}},
		{"GET", base + "/tasks/" + task.ID + "/work-sessions", nil}, {"POST", base + "/tasks/" + task.ID + "/work-sessions", map[string]string{"host": "codex"}},
		{"POST", "/api/work-sessions/" + g.Session.ID + "/revoke", map[string]any{}}, {"POST", "/api/work-sessions/" + g.Session.ID + "/attach", map[string]string{"nativeSessionId": "fake"}},
		{"PATCH", base + "/tasks/" + task.ID, map[string]any{"version": task.Version, "status": "done"}}, {"PATCH", base + "/tasks/" + task.ID, map[string]any{"version": task.Version, "ownerId": "admin"}},
	}
	for _, test := range denied {
		status, b := a.call(g.Token, test.method, test.path, test.body)
		if status != 403 {
			t.Fatalf("grant escaped admin restriction on %s %s: %d %s", test.method, test.path, status, b)
		}
	}
	var updated Task
	a.must(g.Token, "PATCH", base+"/tasks/"+task.ID, map[string]any{"version": task.Version, "status": "in_progress"}, &updated)
	var draft Memory
	a.must(g.Token, "POST", base+"/memories", map[string]any{"nodeId": task.NodeID, "title": "AI建议", "content": "尚未确认", "kind": "decision"}, &draft)
	status, b := a.call(g.Token, "PATCH", base+"/memories/"+draft.ID, map[string]any{"version": draft.Version, "status": "published"})
	expectStatus(t, 403, status, b)
	status, b = a.call(g.Token, "POST", base+"/memories", map[string]any{"title": "直接发布", "content": "无人工确认", "kind": "decision", "status": "published"})
	expectStatus(t, 403, status, b)
	a.must(g.Token, "PATCH", base+"/memories/"+draft.ID, map[string]any{"version": draft.Version, "content": "已补证据"}, &draft)
	a.must(g.Token, "GET", base+"/memories/"+draft.ID+"/history", nil, nil)
	other, otherToken := a.member("另一成员")
	a.assign(p, snap.Nodes[2], []string{}, []string{other.ID})
	var otherDraft Memory
	a.must(otherToken, "POST", base+"/memories", map[string]any{"title": "他人草稿", "content": "未确认", "kind": "decision"}, &otherDraft)
	status, b = a.call(g.Token, "PATCH", base+"/memories/"+otherDraft.ID, map[string]any{"version": otherDraft.Version, "content": "admin grant不能改"})
	expectStatus(t, 403, status, b)
	a.must(adminToken, "PATCH", base+"/memories/"+otherDraft.ID, map[string]any{"version": otherDraft.Version, "content": "管理员补充草稿"}, &otherDraft)
	status, b = a.call(g.Token, "PATCH", base+"/memories/"+otherDraft.ID, map[string]any{"version": otherDraft.Version, "content": "不能用最后编辑人伪装创建人"})
	expectStatus(t, 403, status, b)
	var otherTask Task
	a.must(adminToken, "POST", base+"/tasks", map[string]any{"nodeId": snap.Nodes[2].ID, "title": "草稿作者任务", "ownerId": other.ID}, &otherTask)
	otherGrant := prepareWork(a, otherToken, p, otherTask, "codex")
	activateWork(a, otherToken, otherGrant.Session, "draft-author-thread")
	a.must(otherGrant.Token, "PATCH", base+"/memories/"+otherDraft.ID, map[string]any{"version": otherDraft.Version, "content": "原作者继续完善草稿"}, &otherDraft)
	var ineligible Memory
	a.must(adminToken, "POST", base+"/memories", map[string]any{"nodeId": snap.Nodes[2].ID, "title": "其他节点", "content": "仅其他阶段适用", "kind": "contract"}, &ineligible)
	status, b = a.call(g.Token, "GET", base+"/memories/"+ineligible.ID+"/history", nil)
	expectStatus(t, 403, status, b)
	status, b = a.call(g.Token, "POST", base+"/issues", map[string]any{"nodeId": task.NodeID, "title": "错误范围", "assigneeId": "admin"})
	expectStatus(t, 403, status, b)
	a.must(g.Token, "POST", base+"/issues", map[string]any{"nodeId": task.NodeID, "taskId": task.ID, "title": "绑定任务问题", "assigneeId": "admin"}, nil)
	usage := map[string]any{"requestId": "actual-host-request-1", "taskId": task.ID, "host": "codex", "provider": "fixture", "model": "test", "inputTokens": 100, "outputTokens": 5, "cacheReadTokens": 40}
	for key, value := range map[string]any{"memberId": other.ID, "host": "deepseek-harness", "taskId": "different-task", "nodeId": snap.Nodes[2].ID} {
		body := map[string]any{}
		for k, v := range usage {
			body[k] = v
		}
		body[key] = value
		status, b = a.call(g.Token, "POST", base+"/usage", body)
		expectStatus(t, 403, status, b)
	}
	var actual Usage
	a.must(g.Token, "POST", base+"/usage", usage, &actual)
	if actual.MemberID != "admin" || actual.TaskID != task.ID || actual.NodeID != task.NodeID || actual.Host != "codex" {
		t.Fatal("bound usage attribution changed")
	}
	a.must(adminToken, "PATCH", base+"/memories/"+draft.ID, map[string]any{"version": draft.Version, "status": "published"}, &draft)
	status, b = a.call(g.Token, "PATCH", base+"/memories/"+draft.ID, map[string]any{"version": draft.Version, "content": "尝试降级正式依据"})
	expectStatus(t, 403, status, b)
	status, b = a.call(g.Token, "POST", base+"/tasks/"+task.ID+"/submit", map[string]any{"version": updated.Version, "deliverable": "旧基线成果"})
	expectStatus(t, 409, status, b)
	a.must(g.Token, "POST", base+"/tasks/"+task.ID+"/sync", map[string]int{"version": updated.Version}, &updated)
	a.must(g.Token, "POST", base+"/tasks/"+task.ID+"/submit", map[string]any{"version": updated.Version, "deliverable": "已依据新版本验证成果"}, &updated)
	if updated.Status != "review" {
		t.Fatal("scoped submit should await human review")
	}
}
func TestWorkSessionExpiryRevocationAndTransferredResponsibilities(t *testing.T) {
	a := newTestAPI(t)
	old, oldToken := a.member("旧执行人")
	next, nextToken := a.member("接手人")
	p, snap := a.project("职责变更")
	n := snap.Nodes[3]
	a.assign(p, n, []string{old.ID}, []string{old.ID, next.ID})
	base := "/api/projects/" + p.ID
	var task Task
	a.must(oldToken, "POST", base+"/tasks", map[string]any{"nodeId": n.ID, "title": "移交中的任务", "ownerId": old.ID, "reviewerId": "admin"}, &task)
	expired := prepareWork(a, oldToken, p, task, "codex")
	activateWork(a, oldToken, expired.Session, "expires-thread")
	if _, err := a.store.Pool.Exec(context.Background(), `UPDATE io_work_sessions SET expires_at=now()-interval '1 second' WHERE id=$1`, expired.Session.ID); err != nil {
		t.Fatal(err)
	}
	status, b := a.call(expired.Token, "GET", "/api/agent/context", nil)
	expectStatus(t, 403, status, b)
	if !bytes.Contains(b, []byte("session_expired")) {
		t.Fatal(string(b))
	}
	var metadata []WorkSession
	a.must(oldToken, "GET", base+"/tasks/"+task.ID+"/work-sessions", nil, &metadata)
	if metadata[0].Status != "expired" {
		t.Fatal("expired metadata not surfaced")
	}
	revoked := prepareWork(a, oldToken, p, task, "codex")
	activateWork(a, oldToken, revoked.Session, "revoke-thread")
	status, b = a.call(nextToken, "POST", "/api/work-sessions/"+revoked.Session.ID+"/revoke", nil)
	expectStatus(t, 403, status, b)
	a.must(oldToken, "POST", "/api/work-sessions/"+revoked.Session.ID+"/revoke", nil, nil)
	a.must(oldToken, "POST", "/api/work-sessions/"+revoked.Session.ID+"/revoke", nil, nil)
	status, b = a.call(revoked.Token, "GET", "/api/agent/context", nil)
	expectStatus(t, 403, status, b)
	transferred := prepareWork(a, oldToken, p, task, "codex")
	activateWork(a, oldToken, transferred.Session, "old-owner-thread")
	adminGrant := prepareWork(a, adminToken, p, task, "codex")
	activateWork(a, adminToken, adminGrant.Session, "admin-old-responsibility-thread")
	a.must(adminToken, "POST", base+"/handovers", map[string]any{"fromMemberId": old.ID, "toMemberId": next.ID, "nodeIds": []string{n.ID}, "reason": "人员更替"}, nil)
	for _, token := range []string{transferred.Token, adminGrant.Token} {
		status, b = a.call(token, "GET", "/api/agent/context", nil)
		expectStatus(t, 403, status, b)
	}
	replacement := prepareWork(a, nextToken, p, task, "codex")
	activateWork(a, nextToken, replacement.Session, "new-owner-thread")
	a.must(replacement.Token, "GET", "/api/agent/context", nil, nil)
	if _, err := a.store.Pool.Exec(context.Background(), `UPDATE io_members SET active=false WHERE id=$1`, next.ID); err != nil {
		t.Fatal(err)
	}
	status, b = a.call(replacement.Token, "GET", "/api/agent/context", nil)
	expectStatus(t, 403, status, b)
}
func TestWorkSessionRechecksStaleAuthenticatedScopeInsideTransaction(t *testing.T) {
	a := newTestAPI(t)
	p, snap := a.project("事务复核")
	task := adminTask(a, p, snap.Nodes[3], "任务")
	g := prepareWork(a, adminToken, p, task, "codex")
	activateWork(a, adminToken, g.Session, "tx-thread")
	member, scope, err := a.store.authenticateWorkSession(context.Background(), g.Token, "")
	if err != nil {
		t.Fatal(err)
	}
	a.must(adminToken, "POST", "/api/work-sessions/"+g.Session.ID+"/revoke", nil, nil)
	body := bytes.NewBufferString(`{"version":1,"status":"in_progress"}`)
	req := httptest.NewRequest("PATCH", "/api/projects/"+p.ID+"/tasks/"+task.ID, body)
	req.SetPathValue("pid", p.ID)
	req.SetPathValue("id", task.ID)
	ctx := context.WithValue(req.Context(), actorKey{}, member)
	ctx = context.WithValue(ctx, grantKey{}, scope)
	req = req.WithContext(ctx)
	_, err = a.store.patchTask(httptest.NewRecorder(), req)
	if err == nil || !strings.Contains(err.Error(), "撤销") {
		t.Fatalf("stale authenticated grant bypassed transaction recheck: %v", err)
	}
	var latest Snapshot
	a.must(adminToken, "GET", "/api/projects/"+p.ID+"/snapshot", nil, &latest)
	if latest.Tasks[0].Status != "todo" || latest.Tasks[0].Version != 1 {
		t.Fatal("revoked request mutated task")
	}
}

func TestWorkSessionRevokeRechecksActorInsideTransaction(t *testing.T) {
	a := newTestAPI(t)
	p, snap := a.project("撤销身份复核")
	m, token := a.member("即将停用")
	n := snap.Nodes[3]
	a.assign(p, n, []string{m.ID}, []string{m.ID})
	var task Task
	a.must(adminToken, "POST", "/api/projects/"+p.ID+"/tasks", map[string]string{"nodeId": n.ID, "title": "任务", "ownerId": m.ID}, &task)
	g := prepareWork(a, token, p, task, "codex")
	if _, err := a.store.Pool.Exec(context.Background(), `UPDATE io_members SET active=false WHERE id=$1`, m.ID); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "/api/work-sessions/"+g.Session.ID+"/revoke", nil)
	req.SetPathValue("id", g.Session.ID)
	req = req.WithContext(context.WithValue(req.Context(), actorKey{}, m))
	_, err := a.store.revokeWorkSession(httptest.NewRecorder(), req)
	if err == nil || !strings.Contains(err.Error(), "停用") {
		t.Fatalf("stale authenticated actor revoked a session: %v", err)
	}
	var state string
	if err = a.store.Pool.QueryRow(context.Background(), `SELECT status FROM io_work_sessions WHERE id=$1`, g.Session.ID).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "prepared" {
		t.Fatalf("disabled actor changed session to %s", state)
	}
}
