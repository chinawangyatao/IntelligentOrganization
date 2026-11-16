import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { ConnectionProvider, OrganizationClient } from '@intelligent-organization/mcp-bridge';
import { usageForEvent, UsageOutbox, type SessionLike, type EventLike } from './telemetry.js';

export const name = 'intelligent-organization';
export const inject = ['mcpManager'];
export interface Config {
  baseUrl: string;
  tokenEnv: string;
  bindingFile?: string;
  stateDir: string;
  telemetryBindings: Array<{
    sessionId: string;
    projectId: string;
    nodeId?: string;
    taskId?: string;
  }>;
}
export const Config: Schema<Config> = Schema.object({
  baseUrl: Schema.string().default('http://127.0.0.1:17890'),
  tokenEnv: Schema.string().default('IO_MEMBER_TOKEN'),
  bindingFile: Schema.string(),
  stateDir: Schema.string().default('.intelligent-organization/usage-outbox'),
  telemetryBindings: Schema.array(
    Schema.object({
      sessionId: Schema.string().required(),
      projectId: Schema.string().required(),
      nodeId: Schema.string(),
      taskId: Schema.string(),
    }),
  ).default([]),
});

export function apply(ctx: Context, config: Config): void {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(config.tokenEnv))
    throw new Error('tokenEnv must name an uppercase environment variable');
  const bindingFile = config.bindingFile || process.env.IO_BINDING_FILE;
  const token = process.env[config.tokenEnv];
  const manager = (
    ctx as unknown as {
      mcpManager: {
        register(
          name: string,
          entry: {
            transport: 'stdio';
            command: string;
            args: string[];
            expandTemplates: boolean;
            env: Record<string, string>;
          },
        ): void;
      };
    }
  ).mcpManager;
  // Missing credentials leave the tools discoverable so connection_status can
  // explain how to start a bound work session. Never expose raw tokens in entries.
  manager.register('intelligent-organization', {
    transport: 'stdio',
    command: process.execPath,
    args: [fileURLToPath(new URL('../runtime/server.cjs', import.meta.url))],
    expandTemplates: true,
    env: {
      IO_HOST: 'deepseek-harness',
      ...(bindingFile
        ? { IO_BINDING_FILE: bindingFile }
        : {
            IO_SERVICE_URL: config.baseUrl,
            ...(token ? { IO_MEMBER_TOKEN: `\${credential:${config.tokenEnv}}` } : {}),
          }),
    },
  });
  let lastFailure = 0;
  const failure = () => {
    if (Date.now() - lastFailure < 30000) return;
    lastFailure = Date.now();
    process.stderr.write(
      '[intelligent-organization] Usage could not upload; only explicitly bound, active native sessions can report. Pending counts are retained.\n',
    );
  };
  const eventHost = ctx as unknown as {
    on(
      event: 'session/event',
      listener: (session: SessionLike, event: EventLike) => void,
    ): () => void;
  };
  if (bindingFile) {
    const provider = new ConnectionProvider({ bindingFile, host: 'deepseek-harness' });
    const outboxes = new Map<string, UsageOutbox>();
    eventHost.on('session/event', (session, event) => {
      void (async () => {
        const candidate = await provider.resolve(undefined, undefined, false);
        const bound = candidate.session;
        if (!bound || bound.status !== 'active' || bound.nativeSessionId !== String(session.id))
          return;
        const resolved = await provider.resolve({ _meta: { threadId: String(session.id) } });
        const value = usageForEvent(session, event, {
          sessionId: bound.nativeSessionId,
          projectId: bound.projectId,
          nodeId: bound.nodeId,
          taskId: bound.taskId,
        });
        if (!value) return;
        const key = createHash('sha256')
          .update(`${resolved.connection.baseUrl}\0${resolved.connection.token}\0${bound.id}`)
          .digest('hex');
        let outbox = outboxes.get(key);
        if (!outbox) {
          outbox = new UsageOutbox(
            join(dirname(bindingFile), 'usage-outbox', key),
            resolved.client,
            failure,
          );
          outboxes.set(key, outbox);
        }
        await outbox.enqueue(value);
        await outbox.flush();
      })().catch(failure);
    });
    const timer = setInterval(() => {
      void provider
        .resolve()
        .then(() => Promise.all([...outboxes.values()].map((outbox) => outbox.flush())))
        .catch(failure);
    }, 30000);
    timer.unref();
    ctx.effect(
      () => async () => {
        clearInterval(timer);
        await Promise.all([...outboxes.values()].map((outbox) => outbox.flush()));
      },
      'bound project usage outbox',
    );
    return;
  }
  // Legacy manually configured telemetry remains opt-in and strictly allowlisted.
  if (!token || config.telemetryBindings.length === 0) return;
  const client = new OrganizationClient({
    baseUrl: config.baseUrl,
    token,
    host: 'deepseek-harness',
  });
  const seen = new Set<string>();
  for (const binding of config.telemetryBindings) {
    if (seen.has(binding.sessionId))
      throw new Error('Each telemetry session must bind to exactly one project/task');
    seen.add(binding.sessionId);
  }
  const bindings = new Map(config.telemetryBindings.map((binding) => [binding.sessionId, binding]));
  const connectionKey = createHash('sha256').update(`${client.baseUrl}\0${token}`).digest('hex');
  const outbox = new UsageOutbox(join(config.stateDir, connectionKey), client, failure);
  eventHost.on('session/event', (session, event) => {
    const binding = bindings.get(String(session.id));
    if (!binding) return;
    const value = usageForEvent(session, event, binding);
    if (value) void outbox.enqueue(value).then(() => outbox.flush());
  });
  const timer = setInterval(() => {
    void outbox.flush();
  }, 30000);
  timer.unref();
  ctx.effect(
    () => async () => {
      clearInterval(timer);
      await outbox.flush();
    },
    'project usage outbox',
  );
  void outbox.flush();
}
