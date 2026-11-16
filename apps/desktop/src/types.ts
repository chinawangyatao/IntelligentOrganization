export interface Connection {
  baseUrl: string;
  token: string;
}
export interface Member {
  id: string;
  name: string;
  role: 'admin' | 'member';
  active: boolean;
  createdAt: string;
}
export interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  sourceProjectId?: string;
  createdAt: string;
}
export interface Node {
  id: string;
  projectId: string;
  name: string;
  position: number;
  ownerIds: string[];
  memberIds: string[];
}
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';
export interface Task {
  id: string;
  projectId: string;
  nodeId: string;
  title: string;
  description: string;
  ownerId: string;
  collaboratorIds: string[];
  reviewerId: string;
  status: TaskStatus;
  acceptanceCriteria: string;
  deliverable: string;
  version: number;
  memoryRefs: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}
export type MemoryKind = 'requirement' | 'contract' | 'decision' | 'lesson';
export interface Memory {
  id: string;
  projectId: string;
  nodeId?: string;
  title: string;
  content: string;
  kind: MemoryKind;
  status: 'draft' | 'published' | 'superseded';
  version: number;
  sourceMemoryId?: string;
  sourceVersion?: number;
  updatedBy: string;
  updatedAt: string;
}
export interface Issue {
  id: string;
  projectId: string;
  nodeId: string;
  taskId?: string;
  title: string;
  description: string;
  assigneeId: string;
  status: 'open' | 'acknowledged' | 'resolved';
  createdAt: string;
  updatedAt: string;
}
export interface ProjectEvent {
  id: string;
  projectId: string;
  actorId: string;
  kind: string;
  message: string;
  createdAt: string;
}
export interface Usage {
  id: string;
  requestId: string;
  projectId: string;
  nodeId?: string;
  taskId?: string;
  memberId: string;
  host: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost?: number;
  currency?: string;
  costSource: 'reported' | 'estimated' | 'unknown';
  createdAt: string;
}
export interface Handover {
  id: string;
  projectId: string;
  fromMemberId: string;
  toMemberId: string;
  nodeIds: string[];
  reason: string;
  status: 'pending' | 'accepted';
  summary: string;
  createdAt: string;
  acceptedAt?: string;
}
export interface Snapshot {
  project: Project;
  nodes: Node[];
  tasks: Task[];
  memories: Memory[];
  issues: Issue[];
  events: ProjectEvent[];
  usage: Usage[];
  members: Member[];
  handovers: Handover[];
}
export interface TaskContext {
  project: Project;
  task: Task;
  memories: Memory[];
  issues: Issue[];
  stale: boolean;
  changes: Memory[];
}
export type Api = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
export type Run = <T>(action: () => Promise<T>, success?: string) => Promise<T | undefined>;
export interface PageProps {
  data: Snapshot;
  members: Member[];
  me: Member;
  api: Api;
  run: Run;
  busy: boolean;
  onDiscuss?: (scope: ConversationScope) => void;
}
export const statusNames: Record<TaskStatus, string> = {
  todo: '待开始',
  in_progress: '进行中',
  review: '待验收',
  done: '已完成',
  blocked: '已阻塞',
};
export const memoryKinds: Record<MemoryKind, string> = {
  requirement: '需求',
  contract: '接口约定',
  decision: '项目决策',
  lesson: '经验',
};
export const memberName = (members: Member[], id: string) =>
  members.find((m) => m.id === id)?.name || (id ? '历史成员' : '未分配');
export const formatTime = (value?: string) =>
  value
    ? new Date(value).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

export type ConversationKind = 'project' | 'node' | 'task' | 'issue' | 'direct' | 'group';
export interface ConversationScope {
  kind: ConversationKind;
  projectId?: string;
  nodeId?: string;
  taskId?: string;
  issueId?: string;
  name?: string;
  participantIds?: string[];
}
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  mentionIds: string[];
  createdAt: string;
  promotedMemoryId?: string;
}
export interface Conversation extends ConversationScope {
  id: string;
  name: string;
  participantIds: string[];
  createdBy: string;
  createdAt: string;
  unreadCount: number;
  lastMessage?: Message;
}
export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
  receipts: { memberId: string; messageId: string; readAt: string }[];
}
