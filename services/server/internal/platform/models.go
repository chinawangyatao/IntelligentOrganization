package platform

import "time"

type Member struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"createdAt"`
}
type Project struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Description     string    `json:"description"`
	Status          string    `json:"status"`
	SourceProjectID string    `json:"sourceProjectId,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
}
type Node struct {
	ID        string   `json:"id"`
	ProjectID string   `json:"projectId"`
	Name      string   `json:"name"`
	Position  int      `json:"position"`
	OwnerIDs  []string `json:"ownerIds"`
	MemberIDs []string `json:"memberIds"`
}
type Task struct {
	ID                 string         `json:"id"`
	ProjectID          string         `json:"projectId"`
	NodeID             string         `json:"nodeId"`
	Title              string         `json:"title"`
	Description        string         `json:"description"`
	OwnerID            string         `json:"ownerId"`
	CollaboratorIDs    []string       `json:"collaboratorIds"`
	ReviewerID         string         `json:"reviewerId"`
	Status             string         `json:"status"`
	AcceptanceCriteria string         `json:"acceptanceCriteria"`
	Deliverable        string         `json:"deliverable"`
	Version            int            `json:"version"`
	MemoryRefs         map[string]int `json:"memoryRefs"`
	CreatedAt          time.Time      `json:"createdAt"`
	UpdatedAt          time.Time      `json:"updatedAt"`
}
type Memory struct {
	ID             string    `json:"id"`
	ProjectID      string    `json:"projectId"`
	NodeID         string    `json:"nodeId,omitempty"`
	Title          string    `json:"title"`
	Content        string    `json:"content"`
	Kind           string    `json:"kind"`
	Status         string    `json:"status"`
	Version        int       `json:"version"`
	SourceMemoryID string    `json:"sourceMemoryId,omitempty"`
	SourceVersion  int       `json:"sourceVersion,omitempty"`
	UpdatedBy      string    `json:"updatedBy"`
	UpdatedAt      time.Time `json:"updatedAt"`
}
type Issue struct {
	ID          string    `json:"id"`
	ProjectID   string    `json:"projectId"`
	NodeID      string    `json:"nodeId"`
	TaskID      string    `json:"taskId,omitempty"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	AssigneeID  string    `json:"assigneeId"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
type Event struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"projectId"`
	ActorID   string    `json:"actorId"`
	Kind      string    `json:"kind"`
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"createdAt"`
}
type Usage struct {
	ID              string    `json:"id"`
	RequestID       string    `json:"requestId"`
	ProjectID       string    `json:"projectId"`
	NodeID          string    `json:"nodeId,omitempty"`
	TaskID          string    `json:"taskId,omitempty"`
	MemberID        string    `json:"memberId"`
	Host            string    `json:"host"`
	Provider        string    `json:"provider"`
	Model           string    `json:"model"`
	InputTokens     int64     `json:"inputTokens"`
	OutputTokens    int64     `json:"outputTokens"`
	CacheReadTokens int64     `json:"cacheReadTokens"`
	Cost            *float64  `json:"cost,omitempty"`
	Currency        string    `json:"currency,omitempty"`
	CostSource      string    `json:"costSource"`
	CreatedAt       time.Time `json:"createdAt"`
}
type Handover struct {
	ID           string     `json:"id"`
	ProjectID    string     `json:"projectId"`
	FromMemberID string     `json:"fromMemberId"`
	ToMemberID   string     `json:"toMemberId"`
	NodeIDs      []string   `json:"nodeIds"`
	Reason       string     `json:"reason"`
	Status       string     `json:"status"`
	Summary      string     `json:"summary"`
	CreatedAt    time.Time  `json:"createdAt"`
	AcceptedAt   *time.Time `json:"acceptedAt,omitempty"`
}
type Snapshot struct {
	Project   Project    `json:"project"`
	Nodes     []Node     `json:"nodes"`
	Tasks     []Task     `json:"tasks"`
	Memories  []Memory   `json:"memories"`
	Issues    []Issue    `json:"issues"`
	Events    []Event    `json:"events"`
	Usage     []Usage    `json:"usage"`
	Members   []Member   `json:"members"`
	Handovers []Handover `json:"handovers"`
}
type TaskContext struct {
	Project  Project  `json:"project"`
	Task     Task     `json:"task"`
	Memories []Memory `json:"memories"`
	Issues   []Issue  `json:"issues"`
	Stale    bool     `json:"stale"`
	Changes  []Memory `json:"changes"`
}

type Conversation struct {
	ID             string    `json:"id"`
	ProjectID      string    `json:"projectId,omitempty"`
	NodeID         string    `json:"nodeId,omitempty"`
	TaskID         string    `json:"taskId,omitempty"`
	IssueID        string    `json:"issueId,omitempty"`
	Kind           string    `json:"kind"`
	Name           string    `json:"name"`
	ParticipantIDs []string  `json:"participantIds"`
	CreatedBy      string    `json:"createdBy"`
	CreatedAt      time.Time `json:"createdAt"`
	UnreadCount    int       `json:"unreadCount"`
	LastMessage    *Message  `json:"lastMessage,omitempty"`
}
type Message struct {
	ID               string    `json:"id"`
	ConversationID   string    `json:"conversationId"`
	SenderID         string    `json:"senderId"`
	Body             string    `json:"body"`
	MentionIDs       []string  `json:"mentionIds"`
	CreatedAt        time.Time `json:"createdAt"`
	PromotedMemoryID string    `json:"promotedMemoryId,omitempty"`
}
type Receipt struct {
	MemberID  string    `json:"memberId"`
	MessageID string    `json:"messageId"`
	ReadAt    time.Time `json:"readAt"`
}

type Notification struct {
	ID         string     `json:"id"`
	MemberID   string     `json:"memberId"`
	ProjectID  string     `json:"projectId"`
	Kind       string     `json:"kind"`
	Title      string     `json:"title"`
	Body       string     `json:"body"`
	TaskID     string     `json:"taskId,omitempty"`
	IssueID    string     `json:"issueId,omitempty"`
	HandoverID string     `json:"handoverId,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	ReadAt     *time.Time `json:"readAt,omitempty"`
}
