import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { OrganizationClient } from '@intelligent-organization/mcp-bridge';

export interface SessionBinding {
  sessionId: string;
  projectId: string;
  nodeId?: string;
  taskId?: string;
}
export interface SessionLike {
  id: unknown;
  requestContext?: () => unknown;
  snapshotEvents?: () => unknown[];
}
export interface EventLike {
  type?: unknown;
  seq?: unknown;
  data?: unknown;
}
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Current DSH token buckets are disjoint. The service uses inclusive input. */
export function usageForEvent(
  session: SessionLike,
  event: EventLike,
  binding: SessionBinding,
): RecordValue | undefined {
  if (String(session.id) !== binding.sessionId || !count(event.seq)) return;
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return;
  const data = record(event.data);
  if (!data) return;
  let usage = record(data.usage);
  // An attempt may carry accounting only inside its compact durable stream.
  if (Array.isArray(data.stream)) {
    for (const value of data.stream) {
      const entry = record(value);
      const chunk = entry?.type === 'chunk' ? record(entry.chunk) : undefined;
      if (chunk?.type === 'usage') usage = record(chunk.usage);
    }
  }
  if (!usage || !count(usage.inputTokens) || !count(usage.outputTokens)) return;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  if (!count(cacheRead) || !count(cacheWrite)) return;
  const input = usage.inputTokens + cacheRead + cacheWrite;
  if (!count(input)) return;
  let route: RecordValue | undefined;
  if (session.snapshotEvents) {
    // A host may publish a whole batch after commit. Select the route effective
    // at this event, rather than a later route already present in that batch.
    for (const value of session.snapshotEvents()) {
      const entry = record(value);
      if (entry?.type === 'request/context' && count(entry.seq) && entry.seq <= event.seq)
        route = record(entry.data);
    }
  } else route = record(session.requestContext?.());
  if (
    typeof route?.provider !== 'string' ||
    !route.provider ||
    typeof route.model !== 'string' ||
    !route.model
  )
    return;
  return {
    projectId: binding.projectId,
    ...(binding.nodeId ? { nodeId: binding.nodeId } : {}),
    ...(binding.taskId ? { taskId: binding.taskId } : {}),
    requestId: `dsh:${createHash('sha256').update(`${binding.sessionId}:${event.seq}`).digest('hex')}`,
    host: 'deepseek-harness',
    provider: route.provider,
    model: route.model,
    inputTokens: input,
    outputTokens: usage.outputTokens,
    cacheReadTokens: cacheRead,
    costSource: 'unknown',
  };
}

/** Durable usage-only outbox. No messages, model reasoning or credentials are stored. */
export class UsageOutbox {
  private readonly directory: string;
  private pending = Promise.resolve();
  constructor(
    directory: string,
    private readonly client: OrganizationClient,
    private readonly reportFailure: () => void,
  ) {
    this.directory = resolve(directory);
  }
  enqueue(value: RecordValue): Promise<void> {
    this.pending = this.pending
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const key = createHash('sha256')
          .update(`${value.projectId}:${value.requestId}`)
          .digest('hex');
        const destination = join(this.directory, `${key}.json`);
        const temporary = join(this.directory, `${key}.${process.pid}.tmp`);
        await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
        await rename(temporary, destination);
      })
      .catch(() => this.reportFailure());
    return this.pending;
  }
  flush(): Promise<void> {
    this.pending = this.pending
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        for (const name of await readdir(this.directory)) {
          if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
          const path = join(this.directory, name);
          const value = JSON.parse(await readFile(path, 'utf8')) as RecordValue;
          const projectId = value.projectId;
          if (typeof projectId !== 'string') continue;
          const { projectId: _, ...body } = value;
          await this.client.request(
            'POST',
            `/projects/${encodeURIComponent(projectId)}/usage`,
            body,
          );
          await unlink(path);
        }
      })
      .catch(() => this.reportFailure());
    return this.pending;
  }
}
