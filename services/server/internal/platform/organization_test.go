package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"testing"
	"time"
)

// Decode the public contract independently of the server's aggregation types.
type organizationResponse struct {
	GeneratedAt time.Time `json:"generatedAt"`
	Totals      struct {
		ProjectCount      int   `json:"projectCount"`
		ActiveMemberCount int   `json:"activeMemberCount"`
		TotalTasks        int   `json:"totalTasks"`
		DoneTasks         int   `json:"doneTasks"`
		ReviewTasks       int   `json:"reviewTasks"`
		BlockedTasks      int   `json:"blockedTasks"`
		OpenIssues        int   `json:"openIssues"`
		PendingHandovers  int   `json:"pendingHandovers"`
		InputTokens       int64 `json:"inputTokens"`
		OutputTokens      int64 `json:"outputTokens"`
		CacheReadTokens   int64 `json:"cacheReadTokens"`
		RequestCount      int   `json:"requestCount"`
	} `json:"totals"`
	Costs    []organizationCost            `json:"costs"`
	Projects []organizationProjectResponse `json:"projects"`
}
type organizationCost struct {
	Currency string  `json:"currency"`
	Source   string  `json:"source"`
	Amount   float64 `json:"amount"`
}
type organizationProjectResponse struct {
	Project             Project  `json:"project"`
	NodeOwners          []Member `json:"nodeOwners"`
	UnassignedNodeCount int      `json:"unassignedNodeCount"`
	Tasks               struct {
		Total      int `json:"total"`
		Todo       int `json:"todo"`
		InProgress int `json:"inProgress"`
		Review     int `json:"review"`
		Done       int `json:"done"`
		Blocked    int `json:"blocked"`
		Unassigned int `json:"unassigned"`
	} `json:"tasks"`
	OpenIssues        int       `json:"openIssues"`
	PendingHandovers  int       `json:"pendingHandovers"`
	PublishedMemories int       `json:"publishedMemories"`
	DraftMemories     int       `json:"draftMemories"`
	LastActivityAt    time.Time `json:"lastActivityAt"`
	Usage             struct {
		Requests        int   `json:"requests"`
		InputTokens     int64 `json:"inputTokens"`
		OutputTokens    int64 `json:"outputTokens"`
		CacheReadTokens int64 `json:"cacheReadTokens"`
	} `json:"usage"`
	Costs []organizationCost `json:"costs"`
}

func TestOrganizationOverviewEmptyAndAuthorization(t *testing.T) {
	a := newTestAPI(t)
	var result organizationResponse
	a.must(adminToken, "GET", "/api/organization/overview", nil, &result)
	if result.GeneratedAt.IsZero() || result.Totals.ProjectCount != 0 || result.Totals.ActiveMemberCount != 1 || result.Totals.TotalTasks != 0 || result.Totals.RequestCount != 0 {
		t.Fatalf("unexpected empty organization totals: %+v", result)
	}
	if result.Projects == nil || result.Costs == nil || len(result.Projects) != 0 || len(result.Costs) != 0 {
		t.Fatal("empty lists must be JSON arrays, not null")
	}
	member, token := a.member("普通项目成员")
	p, snapshot := a.project("普通成员参与的项目")
	a.assign(p, snapshot.Nodes[0], []string{member.ID}, []string{member.ID})
	status, body := a.call(token, "GET", "/api/organization/overview", nil)
	expectStatus(t, 403, status, body)
	if bytes.Contains(body, []byte(p.Name)) {
		t.Fatal("forbidden response leaked organization projects")
	}
	status, body = a.call("", "GET", "/api/organization/overview", nil)
	expectStatus(t, 401, status, body)
	if _, err := a.store.Pool.Exec(context.Background(), `UPDATE io_members SET active=false WHERE id=$1`, member.ID); err != nil {
		t.Fatal(err)
	}
	status, body = a.call(token, "GET", "/api/organization/overview", nil)
	expectStatus(t, 401, status, body)
}

func TestOrganizationOverviewCrossProjectAccountingAndPrivacy(t *testing.T) {
	a := newTestAPI(t)
	one, _ := a.member("负责人甲")
	two, _ := a.member("负责人乙")
	inactive, _ := a.member("已停用成员")
	ctx := context.Background()
	if _, err := a.store.Pool.Exec(ctx, `UPDATE io_members SET active=false WHERE id=$1`, inactive.ID); err != nil {
		t.Fatal(err)
	}
	pa, sa := a.project("项目甲")
	pb, sb := a.project("项目乙")
	pc, sc := a.project("空项目")
	a.assign(pa, sa.Nodes[0], []string{one.ID}, []string{one.ID})
	a.assign(pa, sa.Nodes[1], []string{one.ID, two.ID}, []string{one.ID, two.ID})
	a.assign(pb, sb.Nodes[0], []string{two.ID}, []string{two.ID})

	tx, err := a.store.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	put := func(table, id, pid string, value any) {
		t.Helper()
		if err := putJSON(ctx, tx, table, id, pid, value); err != nil {
			t.Fatal(err)
		}
	}
	for i, status := range []string{"todo", "in_progress", "review", "done", "blocked", "todo"} {
		owner := one.ID
		if i == 2 {
			owner = two.ID
		}
		if i >= 3 {
			owner = ""
		}
		v := Task{ID: newID("task"), ProjectID: pa.ID, NodeID: sa.Nodes[0].ID, Title: "甲任务", Status: status, OwnerID: owner, Version: 1, CreatedAt: pa.CreatedAt, UpdatedAt: pa.CreatedAt}
		put("io_tasks", v.ID, pa.ID, v)
	}
	for _, status := range []string{"done", "review"} {
		owner := two.ID
		if status == "review" {
			owner = ""
		}
		v := Task{ID: newID("task"), ProjectID: pb.ID, NodeID: sb.Nodes[0].ID, Title: "乙任务", Status: status, OwnerID: owner, Version: 1, CreatedAt: pb.CreatedAt, UpdatedAt: pb.CreatedAt}
		put("io_tasks", v.ID, pb.ID, v)
	}
	for _, fixture := range []struct {
		project  Project
		statuses []string
	}{{pa, []string{"published", "published", "draft", "superseded"}}, {pb, []string{"published", "draft", "draft"}}} {
		for _, status := range fixture.statuses {
			v := Memory{ID: newID("memory"), ProjectID: fixture.project.ID, Title: "项目规则", Content: "不必出现在组织总览的正文", Kind: "requirement", Status: status, Version: 1, UpdatedBy: "admin", UpdatedAt: fixture.project.CreatedAt}
			put("io_memories", v.ID, fixture.project.ID, v)
		}
	}
	for _, fixture := range []struct {
		project  Project
		statuses []string
	}{{pa, []string{"open", "acknowledged", "resolved"}}, {pb, []string{"resolved"}}} {
		for _, status := range fixture.statuses {
			v := Issue{ID: newID("issue"), ProjectID: fixture.project.ID, Title: "项目问题", Status: status, CreatedAt: fixture.project.CreatedAt, UpdatedAt: fixture.project.CreatedAt}
			put("io_issues", v.ID, fixture.project.ID, v)
		}
	}
	for _, fixture := range []struct {
		project  Project
		statuses []string
	}{{pa, []string{"pending", "accepted"}}, {pb, []string{"pending"}}} {
		for _, status := range fixture.statuses {
			v := Handover{ID: newID("handover"), ProjectID: fixture.project.ID, FromMemberID: one.ID, ToMemberID: two.ID, Status: status, CreatedAt: fixture.project.CreatedAt}
			put("io_handovers", v.ID, fixture.project.ID, v)
		}
	}
	activityA := pa.CreatedAt.Truncate(time.Microsecond).Add(2 * time.Hour)
	activityB := pb.CreatedAt.Truncate(time.Microsecond).Add(3 * time.Hour)
	for _, event := range []Event{{ID: newID("event"), ProjectID: pa.ID, ActorID: "admin", Kind: "test", Message: "项目甲公开操作", CreatedAt: activityA}, {ID: newID("event"), ProjectID: pb.ID, ActorID: "admin", Kind: "test", Message: "项目乙公开操作", CreatedAt: pb.CreatedAt.Add(time.Hour)}} {
		put("io_events", event.ID, event.ProjectID, event)
	}
	amount := func(n float64) *float64 { return &n }
	for _, usage := range []Usage{
		{ID: newID("usage"), RequestID: "a1", ProjectID: pa.ID, MemberID: one.ID, Host: "fixture", Provider: "fixture", Model: "fixture", InputTokens: 100, OutputTokens: 20, CacheReadTokens: 40, Cost: amount(1), Currency: "CNY", CostSource: "reported", CreatedAt: pa.CreatedAt.Add(time.Hour)},
		{ID: newID("usage"), RequestID: "a2", ProjectID: pa.ID, MemberID: one.ID, Host: "fixture", Provider: "fixture", Model: "fixture", InputTokens: 50, OutputTokens: 10, CacheReadTokens: 10, Cost: amount(.5), Currency: "CNY", CostSource: "estimated", CreatedAt: pa.CreatedAt.Add(time.Hour)},
		{ID: newID("usage"), RequestID: "a3", ProjectID: pa.ID, MemberID: one.ID, Host: "fixture", Provider: "fixture", Model: "fixture", InputTokens: 30, OutputTokens: 5, CostSource: "unknown", CreatedAt: pa.CreatedAt.Add(time.Hour)},
		{ID: newID("usage"), RequestID: "b1", ProjectID: pb.ID, MemberID: two.ID, Host: "fixture", Provider: "fixture", Model: "fixture", InputTokens: 200, OutputTokens: 40, CacheReadTokens: 100, Cost: amount(2), Currency: "USD", CostSource: "reported", CreatedAt: activityB},
		{ID: newID("usage"), RequestID: "b2", ProjectID: pb.ID, MemberID: two.ID, Host: "fixture", Provider: "fixture", Model: "fixture", InputTokens: 20, OutputTokens: 4, CacheReadTokens: 5, Cost: amount(3), Currency: "CNY", CostSource: "reported", CreatedAt: pb.CreatedAt.Add(time.Hour)},
	} {
		data, err := json.Marshal(usage)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(ctx, `INSERT INTO io_usage(id,project_id,member_id,host,request_id,data) VALUES($1,$2,$3,$4,$5,$6)`, usage.ID, usage.ProjectID, usage.MemberID, usage.Host, usage.RequestID, data); err != nil {
			t.Fatal(err)
		}
	}
	conversation := Conversation{ID: newID("conversation"), Kind: "direct", Name: "私聊名称不应泄漏", ParticipantIDs: []string{one.ID, two.ID}, CreatedBy: one.ID, CreatedAt: activityA.Add(10 * time.Hour)}
	privateData, err := json.Marshal(conversation)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO io_conversations(id,data) VALUES($1,$2)`, conversation.ID, privateData); err != nil {
		t.Fatal(err)
	}
	message := Message{ID: newID("message"), ConversationID: conversation.ID, SenderID: one.ID, Body: "organization-overview-private-marker", CreatedAt: conversation.CreatedAt}
	privateData, err = json.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO io_messages(id,conversation_id,data) VALUES($1,$2,$3)`, message.ID, conversation.ID, privateData); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	var eventsBefore int
	if err = a.store.Pool.QueryRow(ctx, `SELECT count(*) FROM io_events`).Scan(&eventsBefore); err != nil {
		t.Fatal(err)
	}
	status, body := a.call(adminToken, "GET", "/api/organization/overview", nil)
	expectStatus(t, 200, status, body)
	for _, secret := range []string{message.Body, conversation.Name, "participantIds", "tokenHash", "不必出现在组织总览的正文"} {
		if bytes.Contains(body, []byte(secret)) {
			t.Fatalf("organization response leaked unrelated content %q", secret)
		}
	}
	var result organizationResponse
	if err = json.Unmarshal(body, &result); err != nil {
		t.Fatal(err)
	}
	if result.Totals.ProjectCount != 3 || result.Totals.ActiveMemberCount != 3 || result.Totals.TotalTasks != 8 || result.Totals.DoneTasks != 2 || result.Totals.ReviewTasks != 2 || result.Totals.BlockedTasks != 1 || result.Totals.OpenIssues != 2 || result.Totals.PendingHandovers != 2 {
		t.Fatalf("unexpected cross-project totals: %+v", result.Totals)
	}
	if result.Totals.RequestCount != 5 || result.Totals.InputTokens != 400 || result.Totals.OutputTokens != 79 || result.Totals.CacheReadTokens != 155 {
		t.Fatalf("token accounting must not add cache twice: %+v", result.Totals)
	}
	assertOrganizationCosts(t, result.Costs, map[string]float64{"CNY/reported": 4, "CNY/estimated": .5, "USD/reported": 2})
	projects := map[string]organizationProjectResponse{}
	for _, project := range result.Projects {
		projects[project.Project.ID] = project
	}
	first, second, empty := projects[pa.ID], projects[pb.ID], projects[pc.ID]
	emptyActivity := pc.CreatedAt
	for _, event := range sc.Events {
		at := event.CreatedAt.Truncate(time.Microsecond)
		if at.After(emptyActivity) {
			emptyActivity = at
		}
	}
	if len(first.NodeOwners) != 2 || first.NodeOwners[0].ID == first.NodeOwners[1].ID || first.UnassignedNodeCount != 6 {
		t.Fatalf("owners should be deduplicated across nodes: %+v", first)
	}
	if first.Tasks.Total != 6 || first.Tasks.Todo != 2 || first.Tasks.InProgress != 1 || first.Tasks.Review != 1 || first.Tasks.Done != 1 || first.Tasks.Blocked != 1 || first.Tasks.Unassigned != 2 || first.OpenIssues != 2 || first.PendingHandovers != 1 || first.PublishedMemories != 2 || first.DraftMemories != 1 {
		t.Fatalf("unexpected first project: %+v", first)
	}
	if first.Usage.Requests != 3 || first.Usage.InputTokens != 180 || first.Usage.OutputTokens != 35 || first.Usage.CacheReadTokens != 50 {
		t.Fatalf("incorrect first usage: %+v", first.Usage)
	}
	assertOrganizationCosts(t, first.Costs, map[string]float64{"CNY/reported": 1, "CNY/estimated": .5})
	if !first.LastActivityAt.Equal(activityA) {
		t.Fatalf("project activity should use project events, not private chat: %s != %s", first.LastActivityAt, activityA)
	}
	if len(second.NodeOwners) != 1 || second.NodeOwners[0].ID != two.ID || second.UnassignedNodeCount != 7 || second.Tasks.Total != 2 || second.Tasks.Done != 1 || second.Tasks.Review != 1 || second.Tasks.Unassigned != 1 || second.PendingHandovers != 1 || second.PublishedMemories != 1 || second.DraftMemories != 2 {
		t.Fatalf("unexpected second project: %+v", second)
	}
	if !second.LastActivityAt.Equal(activityB) {
		t.Fatalf("project usage should advance activity timestamp: %s != %s", second.LastActivityAt, activityB)
	}
	if empty.Project.ID != pc.ID || empty.Tasks.Total != 0 || empty.UnassignedNodeCount != 8 || empty.NodeOwners == nil || empty.Costs == nil || !empty.LastActivityAt.Equal(emptyActivity) {
		t.Fatalf("unexpected empty project: %+v", empty)
	}
	var eventsAfter int
	if err = a.store.Pool.QueryRow(ctx, `SELECT count(*) FROM io_events`).Scan(&eventsAfter); err != nil {
		t.Fatal(err)
	}
	if eventsAfter != eventsBefore {
		t.Fatal("read-only overview created project events")
	}
}

func assertOrganizationCosts(t *testing.T, actual []organizationCost, expected map[string]float64) {
	t.Helper()
	if len(actual) != len(expected) {
		t.Fatalf("cost currencies and sources were combined: got %+v, expected %+v", actual, expected)
	}
	for _, cost := range actual {
		key := cost.Currency + "/" + cost.Source
		amount, ok := expected[key]
		if !ok || math.Abs(cost.Amount-amount) > 1e-9 {
			t.Fatalf("unexpected cost %s=%v", key, cost.Amount)
		}
	}
}
