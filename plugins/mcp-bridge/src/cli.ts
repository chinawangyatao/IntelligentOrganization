#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createOrganizationServer } from './server.js';
import {
  ConnectionProvider,
  boundTaskContext,
  contextHookOutput,
  hookFailureOutput,
  type ServerConnection,
} from './binding.js';

async function main() {
  const connection: ServerConnection = {
    baseUrl: process.env.IO_SERVICE_URL,
    token: process.env.IO_MEMBER_TOKEN,
    host: process.env.IO_HOST,
    bindingFile: process.env.IO_BINDING_FILE,
    appDataDir: process.env.IO_APP_DATA_DIR,
  };
  const hookIndex = process.argv.indexOf('--hook');
  if (hookIndex >= 0) {
    const event = process.argv[hookIndex + 1] || 'UserPromptSubmit';
    if (!['SessionStart', 'UserPromptSubmit', 'PostCompact'].includes(event))
      throw new Error('Unsupported hook event');
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk.toString();
      if (raw.length > 65536) throw new Error('Hook input is too large');
    }
    let input: Record<string, any>;
    try {
      input = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      throw new Error('Hook input is invalid JSON');
    }
    const threadId = input.nativeSessionId ?? input.thread_id ?? input._meta?.threadId;
    const provider = new ConnectionProvider(connection);
    let output: unknown;
    try {
      const resolved = await provider.resolve(
        threadId === undefined ? undefined : { _meta: { threadId } },
      );
      output = contextHookOutput(await boundTaskContext(resolved), event);
    } catch (error) {
      output = hookFailureOutput(error, event);
    }
    process.stdout.write(JSON.stringify(output) + '\n');
    return;
  }
  const server = createOrganizationServer(connection);
  await server.connect(new StdioServerTransport());
}
main().catch((error: unknown) => {
  // stdout is reserved for MCP JSON-RPC or trusted hook JSON. Never print credentials.
  process.stderr.write(
    `Intelligent Organization MCP failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exitCode = 1;
});
