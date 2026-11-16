package platform

import (
	"net/http"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
)

// OrganizationOverview deliberately contains summaries, never conversation content.
type OrganizationOverview struct {
	GeneratedAt time.Time             `json:"generatedAt"`
	Totals      OrganizationTotals    `json:"totals"`
	Costs       []CostTotal           `json:"costs"`
	Projects    []OrganizationProject `json:"projects"`
}
type OrganizationTotals struct {
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
	RequestCount      int64 `json:"requestCount"`
}
type OrganizationProject struct {
	Project             Project                `json:"project"`
	NodeOwners          []Member               `json:"nodeOwners"`
	UnassignedNodeCount int                    `json:"unassignedNodeCount"`
	Tasks               OrganizationTaskCounts `json:"tasks"`
	OpenIssues          int                    `json:"openIssues"`
	PendingHandovers    int                    `json:"pendingHandovers"`
	PublishedMemories   int                    `json:"publishedMemories"`
	DraftMemories       int                    `json:"draftMemories"`
	LastActivityAt      time.Time              `json:"lastActivityAt"`
	Usage               OrganizationUsage      `json:"usage"`
	Costs               []CostTotal            `json:"costs"`
}
type OrganizationTaskCounts struct {
	Total      int `json:"total"`
	Todo       int `json:"todo"`
	InProgress int `json:"inProgress"`
	Review     int `json:"review"`
	Done       int `json:"done"`
	Blocked    int `json:"blocked"`
	Unassigned int `json:"unassigned"`
}
type OrganizationUsage struct {
	Requests        int64 `json:"requests"`
	InputTokens     int64 `json:"inputTokens"`
	OutputTokens    int64 `json:"outputTokens"`
	CacheReadTokens int64 `json:"cacheReadTokens"`
}
type CostTotal struct {
	Currency string  `json:"currency"`
	Source   string  `json:"source"`
	Amount   float64 `json:"amount"`
}
type costKey struct{ currency, source string }

func (s *Store) organizationOverview(w http.ResponseWriter, r *http.Request) (any, error) {
	if err := requireAdmin(actor(r)); err != nil {
		return nil, err
	}
	ctx := r.Context()
	// Every aggregate sees the same committed state, without locking project writes.
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	out := OrganizationOverview{GeneratedAt: time.Now().UTC(), Costs: []CostTotal{}, Projects: []OrganizationProject{}}
	projects, err := listJSON[Project](ctx, tx, "io_projects", "")
	if err != nil {
		return nil, err
	}
	directory, err := members(ctx, tx)
	if err != nil {
		return nil, err
	}
	memberByID := make(map[string]Member, len(directory))
	for _, member := range directory {
		memberByID[member.ID] = member
		if member.Active {
			out.Totals.ActiveMemberCount++
		}
	}
	out.Totals.ProjectCount = len(projects)
	byProject := make(map[string]*OrganizationProject, len(projects))
	for _, project := range projects {
		out.Projects = append(out.Projects, OrganizationProject{Project: project, NodeOwners: []Member{}, Costs: []CostTotal{}, LastActivityAt: project.CreatedAt})
	}
	for i := range out.Projects {
		byProject[out.Projects[i].Project.ID] = &out.Projects[i]
	}
	nodes, err := listJSON[Node](ctx, tx, "io_nodes", "")
	if err != nil {
		return nil, err
	}
	ownerIDs := map[string]map[string]bool{}
	for _, node := range nodes {
		project := byProject[node.ProjectID]
		if project == nil {
			continue
		}
		if len(node.OwnerIDs) == 0 {
			project.UnassignedNodeCount++
		}
		if ownerIDs[node.ProjectID] == nil {
			ownerIDs[node.ProjectID] = map[string]bool{}
		}
		for _, id := range node.OwnerIDs {
			if member, exists := memberByID[id]; exists && !ownerIDs[node.ProjectID][id] {
				project.NodeOwners = append(project.NodeOwners, member)
				ownerIDs[node.ProjectID][id] = true
			}
		}
	}

	// Project-wide grouped projections avoid reading task descriptions or memory bodies.
	rows, err := tx.Query(ctx, `SELECT project_id, count(*)::int,
	 count(*) FILTER(WHERE data->>'status'='todo')::int,
	 count(*) FILTER(WHERE data->>'status'='in_progress')::int,
	 count(*) FILTER(WHERE data->>'status'='review')::int,
	 count(*) FILTER(WHERE data->>'status'='done')::int,
	 count(*) FILTER(WHERE data->>'status'='blocked')::int,
	 count(*) FILTER(WHERE data->>'status'<>'done' AND coalesce(data->>'ownerId','')='')::int
	 FROM io_tasks GROUP BY project_id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var counts OrganizationTaskCounts
		if err = rows.Scan(&id, &counts.Total, &counts.Todo, &counts.InProgress, &counts.Review, &counts.Done, &counts.Blocked, &counts.Unassigned); err != nil {
			rows.Close()
			return nil, err
		}
		if project := byProject[id]; project != nil {
			project.Tasks = counts
			out.Totals.TotalTasks += counts.Total
			out.Totals.DoneTasks += counts.Done
			out.Totals.ReviewTasks += counts.Review
			out.Totals.BlockedTasks += counts.Blocked
		}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	rows, err = tx.Query(ctx, `SELECT project_id, count(*)::int FROM io_issues WHERE data->>'status'<>'resolved' GROUP BY project_id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var count int
		if err = rows.Scan(&id, &count); err != nil {
			rows.Close()
			return nil, err
		}
		if project := byProject[id]; project != nil {
			project.OpenIssues = count
			out.Totals.OpenIssues += count
		}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	rows, err = tx.Query(ctx, `SELECT project_id, count(*)::int FROM io_handovers WHERE data->>'status'='pending' GROUP BY project_id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var count int
		if err = rows.Scan(&id, &count); err != nil {
			rows.Close()
			return nil, err
		}
		if project := byProject[id]; project != nil {
			project.PendingHandovers = count
			out.Totals.PendingHandovers += count
		}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	rows, err = tx.Query(ctx, `SELECT project_id,
	 count(*) FILTER(WHERE data->>'status'='published')::int,
	 count(*) FILTER(WHERE data->>'status'='draft')::int FROM io_memories GROUP BY project_id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var published, draft int
		if err = rows.Scan(&id, &published, &draft); err != nil {
			rows.Close()
			return nil, err
		}
		if project := byProject[id]; project != nil {
			project.PublishedMemories, project.DraftMemories = published, draft
		}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	rows, err = tx.Query(ctx, `SELECT project_id, max((data->>'createdAt')::timestamptz) FROM io_events GROUP BY project_id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var latest time.Time
		if err = rows.Scan(&id, &latest); err != nil {
			rows.Close()
			return nil, err
		}
		if project := byProject[id]; project != nil && latest.After(project.LastActivityAt) {
			project.LastActivityAt = latest
		}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	allCosts := map[costKey]float64{}
	projectCosts := map[string]map[costKey]float64{}
	rows, err = tx.Query(ctx, `SELECT project_id, coalesce(data->>'currency',''), coalesce(data->>'costSource','unknown'), count(*)::bigint,
	 coalesce(sum((data->>'inputTokens')::bigint),0)::bigint,
	 coalesce(sum((data->>'outputTokens')::bigint),0)::bigint,
	 coalesce(sum((data->>'cacheReadTokens')::bigint),0)::bigint,
	 count(data->>'cost')::bigint, coalesce(sum((data->>'cost')::double precision),0),
	 max((data->>'createdAt')::timestamptz) FROM io_usage GROUP BY project_id, data->>'currency',data->>'costSource'`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, currency, source string
		var usage OrganizationUsage
		var priced int64
		var amount float64
		var latest time.Time
		if err = rows.Scan(&id, &currency, &source, &usage.Requests, &usage.InputTokens, &usage.OutputTokens, &usage.CacheReadTokens, &priced, &amount, &latest); err != nil {
			rows.Close()
			return nil, err
		}
		if project := byProject[id]; project != nil {
			project.Usage.Requests += usage.Requests
			project.Usage.InputTokens += usage.InputTokens
			project.Usage.OutputTokens += usage.OutputTokens
			project.Usage.CacheReadTokens += usage.CacheReadTokens
			out.Totals.RequestCount += usage.Requests
			out.Totals.InputTokens += usage.InputTokens
			out.Totals.OutputTokens += usage.OutputTokens
			out.Totals.CacheReadTokens += usage.CacheReadTokens
			if latest.After(project.LastActivityAt) {
				project.LastActivityAt = latest
			}
			if priced > 0 && currency != "" {
				key := costKey{currency, source}
				allCosts[key] += amount
				if projectCosts[id] == nil {
					projectCosts[id] = map[costKey]float64{}
				}
				projectCosts[id][key] += amount
			}
		}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	out.Costs = sortedCosts(allCosts)
	for i := range out.Projects {
		project := &out.Projects[i]
		project.Costs = sortedCosts(projectCosts[project.Project.ID])
		sort.Slice(project.NodeOwners, func(i, j int) bool {
			if project.NodeOwners[i].Name == project.NodeOwners[j].Name {
				return project.NodeOwners[i].ID < project.NodeOwners[j].ID
			}
			return project.NodeOwners[i].Name < project.NodeOwners[j].Name
		})
	}
	sort.Slice(out.Projects, func(i, j int) bool {
		if out.Projects[i].LastActivityAt.Equal(out.Projects[j].LastActivityAt) {
			return out.Projects[i].Project.ID < out.Projects[j].Project.ID
		}
		return out.Projects[i].LastActivityAt.After(out.Projects[j].LastActivityAt)
	})
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}

func sortedCosts(costs map[costKey]float64) []CostTotal {
	out := make([]CostTotal, 0, len(costs))
	for key, amount := range costs {
		out = append(out, CostTotal{key.currency, key.source, amount})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Currency == out[j].Currency {
			return out[i].Source < out[j].Source
		}
		return out[i].Currency < out[j].Currency
	})
	return out
}
