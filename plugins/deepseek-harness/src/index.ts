import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { OrganizationClient } from '@intelligent-organization/mcp-bridge';
import { usageForEvent, UsageOutbox, type SessionLike, type EventLike } from './telemetry.js';

export const name = 'intelligent-organization';
export const inject = ['mcpManager', 'credentials'];
export interface Config {
  baseUrl: string;
  tokenEnv: string;
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
  const token = process.env[config.tokenEnv];
  if (!token)
    throw new Error(
      `Set ${config.tokenEnv} to this member's project access token before starting DSH`,
    );
  const client = new OrganizationClient({
    baseUrl: config.baseUrl,
    token,
    host: 'deepseek-harness',
  });
  // The host supplies this optional service. Its runtime shape is deliberately
  // narrow because current DSH workspace packages are not all published to npm.
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
  manager.register('intelligent-organization', {
    transport: 'stdio',
    command: process.execPath,
    args: [fileURLToPath(new URL('../runtime/server.cjs', import.meta.url))],
    expandTemplates: true,
    env: {
      IO_SERVICE_URL: client.baseUrl,
      IO_MEMBER_TOKEN: `\${credential:${config.tokenEnv}}`,
      IO_HOST: 'deepseek-harness',
    },
  });
  if (config.telemetryBindings.length === 0) return;
  const seen = new Set<string>();
  for (const binding of config.telemetryBindings) {
    if (seen.has(binding.sessionId))
      throw new Error('Each telemetry session must bind to exactly one project/task');
    seen.add(binding.sessionId);
  }
  const bindings = new Map(config.telemetryBindings.map((binding) => [binding.sessionId, binding]));
  const failure = () =>
    process.stderr.write(
      '[intelligent-organization] Usage outbox could not flush; pending records retained. Check connection and member permissions.\n',
    );
  // Switching members or services must never attribute an old outbox to a
  // different account. Persist counts under this connection's private key.
  const connectionKey = createHash('sha256').update(`${client.baseUrl}\0${token}`).digest('hex');
  const outbox = new UsageOutbox(join(config.stateDir, connectionKey), client, failure);
  // The optional session package is supplied by the host. Validate its public
  // durable event shape at this boundary rather than importing an older npm ABI.
  const eventHost = ctx as unknown as {
    on(
      event: 'session/event',
      listener: (session: SessionLike, event: EventLike) => void,
    ): () => void;
  };
  eventHost.on('session/event', (session, event) => {
    const binding = bindings.get(String(session.id));
    if (!binding) return;
    const value = usageForEvent(session, event, binding);
    if (value) void outbox.enqueue(value).then(() => outbox.flush());
  });
  const timer = setInterval(() => {
    void outbox.flush();
  }, 30_000);
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
