# Intelligent Organization pilot API contract

All JSON uses camelCase. REST /api, Authorization: Bearer <member access token>. All mutations authorize server-side. One company workspace; projects have membership via nodes. Admin can access all. Members only access projects where assigned in a node. Tokens stored hashed in DB, invitation token shown only on creation. Local admin bootstraps using IO_ADMIN_TOKEN env. Error JSON: {error:string,code?:string}; status 401 auth,403 permission,409 version/conflict,422 validation. GET /health.

Models:
Member {id,name,role:"admin"|"member",active:boolean,createdAt}
Project {id,name,description,status,sourceProjectId?:string,createdAt}
Node {id,projectId,name,position:number,ownerIds:string[],memberIds:string[]}
Task {id,projectId,nodeId,title,description,ownerId,collaboratorIds:string[],reviewerId,status:"todo"|"in_progress"|"review"|"done"|"blocked",acceptanceCriteria,deliverable,version:number,memoryRefs:Record<string,number>,createdAt,updatedAt}
Memory {id,projectId,nodeId?:string,title,content,kind:"requirement"|"contract"|"decision"|"lesson",status:"draft"|"published"|"superseded",version:number,sourceMemoryId?:string,sourceVersion?:number,updatedBy,updatedAt}
Issue {id,projectId,nodeId,taskId?:string,title,description,assigneeId,status:"open"|"acknowledged"|"resolved",createdAt,updatedAt}
Event {id,projectId,actorId,kind,message,createdAt}
Usage {id,requestId,projectId,nodeId?:string,taskId?:string,memberId,host,provider,model,inputTokens:number,outputTokens:number,cacheReadTokens:number,cost?:number,currency?:string,costSource:"reported"|"estimated"|"unknown",createdAt}. inputTokens includes cacheReadTokens (do not add cache twice). Return duplicate request safely. Identity bound to authenticated member except admin may report memberId. Monetary totals must separate currency, reported/estimated.
Handover {id,projectId,fromMemberId,toMemberId,nodeIds:string[],reason,status:"pending"|"accepted",summary,createdAt,acceptedAt?:string}

API:
GET /api/me -> Member
GET /api/members -> Member[] (admin full, others project co-members only)
POST /api/members {name,role} -> {member:Member,token:string} admin
POST /api/members/:id/deactivate -> Member admin; retain history, revoke access, require responsibilities transferred first.
GET /api/projects -> Project[] visible
POST /api/projects {name,description} -> Project admin; default nodes 售前/产品经理/UI与UE/前端开发/后端开发/部署/测试/交付
GET /api/projects/:pid/snapshot -> {project,nodes:Node[],tasks:Task[],memories:Memory[],issues:Issue[],events:Event[],usage:Usage[],members:Member[],handovers:Handover[]}
PATCH /api/projects/:pid/nodes/:id {ownerIds,memberIds} -> Node admin (valid active member IDs; owners included members)
POST /api/projects/:pid/tasks {nodeId,title,description?,ownerId?,collaboratorIds?,reviewerId?,acceptanceCriteria?} -> Task
PATCH /api/projects/:pid/tasks/:id {version:number,title?,description?,status?,ownerId?,collaboratorIds?,reviewerId?,acceptanceCriteria?} -> Task; no direct done/review bypass; done requires reviewer/admin and current review plus current memory baseline.
GET /api/projects/:pid/tasks/:id/context -> {project,task,memories:Memory[],issues:Issue[],stale:boolean,changes:Memory[]} all published global memories + published matching node. Do not mutate GET.
POST /api/projects/:pid/tasks/:id/sync {version:number} -> Task captures eligible published memory versions, increments task version
POST /api/projects/:pid/tasks/:id/submit {version:number,deliverable:string} -> Task; rejects stale baselines 409, requires nonempty deliverable, moves review. Captured refs cannot be overwritten by submit body. Rejected if baseline references superseded memory (deletion not allowed).
POST /api/projects/:pid/memories {nodeId?,title,content,kind,status?} -> Memory; default draft; admin/node owner may publish
PATCH /api/projects/:pid/memories/:id {version:number,title?,content?,status?} -> Memory; version CAS, historical versions saved; only admin or owner can publish
GET /api/projects/:pid/memories/:id/history -> Memory[] historical + current
POST /api/projects/:pid/issues {nodeId,taskId?,title,description?,assigneeId} -> Issue
PATCH /api/projects/:pid/issues/:id {status} -> Issue assignee/admin
POST /api/projects/:pid/handovers {fromMemberId,toMemberId,nodeIds:string[],reason} -> Handover admin; atomic node membership + owners, unfinished tasks/collaborators/reviewer + open issues transfer. Historical events, authors and finished task ownership unchanged. Generate deterministic source-linked summary from actual records, not invented AI summary. Validates target active and source present.
POST /api/projects/:pid/handovers/:id/accept -> Handover target only; acceptance records recipient acknowledgement.
POST /api/projects/:pid/reuse {name,description,memoryIds:string[]} -> Project admin; new nodes no people. Selected memories copied as draft with provenance. Task templates copy titles/criteria, reset status to todo, no assignees/deliverable/usage/events copied. New requirements in description, differences are for human/AI review, not automatically claimed validated.
POST /api/projects/:pid/usage UsageInput -> Usage idempotent by memberId+host+requestId; nonnegative numeric values, finite amounts, task/node belong project. No budget enforcement.

No fake AI summaries, automatic provider account provisioning, hidden reasoning capture or universal automatic telemetry. Desktop offers actual project CRUD/workflows and token access configuration. Plugins invoke same authenticated domain routes. Native DSH telemetry only for configured project sessions; unavailable accounting explicitly omitted, never estimated as actual.

## In-app communication (first release, DingTalk deferred)
Conversation {id,projectId?:string,nodeId?:string,taskId?:string,issueId?:string,kind:"project"|"node"|"task"|"issue"|"direct"|"group",name,participantIds:string[],createdBy,createdAt,unreadCount:number,lastMessage?:Message}
Message {id,conversationId,senderId,body,mentionIds:string[],createdAt,promotedMemoryId?:string}
GET /api/conversations -> Conversation[] visible (project/node/task/issue scoped by project access; direct/group participant-only, even admin cannot read another private conversation)
POST /api/conversations {kind,name?,projectId?,nodeId?,taskId?,issueId?,participantIds?:string[]} -> Conversation; scope IDs must belong together. Public scope conversation unique by kind+scope ID, creation idempotent. Direct is unique canonical pair. Direct/group includes creator; requires active participants. Global member directory exposes only id,name,role,active (no credential); GET members may include company directory for starting direct conversations, updated contract supersedes earlier co-member restriction.
GET /api/conversations/:cid/messages?before=<messageId>&limit=50 -> {messages:Message[],hasMore:boolean,receipts:{memberId,messageId,readAt}[]} chronological page (fetch latest page first, older cursor supported).
POST /api/conversations/:cid/messages {body,mentionIds?:string[]} -> Message; trim body, max 12000 chars, mentions valid in scope, sender from auth. Messages are durable. No edit/delete in first release.
POST /api/conversations/:cid/read {messageId} -> {ok:true}; monotonically advance read cursor, only message in conversation.
POST /api/conversations/:cid/messages/:mid/promote {projectId,nodeId?,title,kind?:"decision"|"requirement"|"contract"|"lesson"} -> Memory; creates DRAFT memory with source message citation, never automatic formal decision. Requires both message visibility and target project access; private message promotion limited to sender to avoid copying somebody else's private message without action by author.
Project creation ensures project conversation; node/task/issue channels can be created on demand. GET conversation list includes unreadCount and lastMessage. A reply links within conversation via optional replyToId? First release can use body quote instead of fake UI threaded replies; task/issue conversations themselves serve threads.
Future reserved endpoint (not implemented in pilot): GET /api/stream -> authenticated SSE invalidation events {type:"message"|"project",projectId?,conversationId?}; no secrets/content in invalidation. Client may instead poll every 3s with visibility-aware pause and show sync state, not claim instant delivery. Reconnect must fetch durable history/unread. Mentions use body and mentionIds, member read is not task acceptance. Private chats never automatically enter shared AI context. Only explicitly promoted draft can be published under normal memory permissions.

## Actionable notifications
Notification {id,memberId,projectId,kind,title,body,taskId?:string,issueId?:string,handoverId?:string,createdAt,readAt?:string}
GET /api/notifications -> Notification[] current member only, newest first, up to 200. Do not include inaccessible project records after membership removal.
POST /api/notifications/:id/read -> {ok:true}, recipient only, idempotent.
Transactional notifications for task assignment/reassignment (new owner), submit (reviewer), return (owner), issue assignment, handover (recipient), published memory changes (owners of impacted unfinished tasks). Do not notify the actor themselves. Message unread stays in conversation model; no duplicated message notifications required. Read notification does not accept a task or handover.

## Organization overview (administrator only)
GET /api/organization/overview -> OrganizationOverview. Require active admin; ordinary member 403 even if assigned to a project. Read-only consistent snapshot; do not load individual project snapshots with N+1 requests and do not expose any conversation/private-message content.
OrganizationOverview {generatedAt:string,totals:{projectCount:number,activeMemberCount:number,totalTasks:number,doneTasks:number,reviewTasks:number,blockedTasks:number,openIssues:number,pendingHandovers:number,inputTokens:number,outputTokens:number,cacheReadTokens:number,requestCount:number},costs:CostTotal[],projects:OrganizationProject[]}
CostTotal {currency:string,source:"reported"|"estimated"|"unknown",amount:number}; currency and source remain separate, no currency conversion.
OrganizationProject {project:Project,nodeOwners:Member[],unassignedNodeCount:number,tasks:{total:number,todo:number,inProgress:number,review:number,done:number,blocked:number,unassigned:number},openIssues:number,pendingHandovers:number,publishedMemories:number,draftMemories:number,lastActivityAt:string,usage:{requests:number,inputTokens:number,outputTokens:number,cacheReadTokens:number},costs:CostTotal[]}
nodeOwners = unique current node owner IDs (not a fabricated single project manager). tasks.unassigned counts unfinished tasks without ownerId. unassignedNodeCount counts nodes without owners. lastActivityAt=max(project.createdAt, project event.createdAt, usage.createdAt), i.e. most recent project operation/accounting, not private chat activity. Token total is input+output; cached input is a subset. Zero-task project progress is unknown/display dash, not 100%. Overall completion uses total done tasks / total tasks, not mean of project percentages. All existing projects are included; do not hide or delete test/demo projects by naming heuristics.
Desktop: administrators get a separate '组织总览' entry and default landing page after authentication. Project selection remains for project-scoped pages, clearly labeled as current project; choosing a project or opening a summary row enters that project's overview. Ordinary members keep current project experience and cannot access organization overview. Admin can view/search project list, filter attention (blocked/review/open issues/pending handover/unassigned unfinished tasks), see aggregated progress and usage; clicking a row takes them to the right project. No permanent fake counters, overdue or budget claims without source data. New-project and existing workflow entry points remain functional.
