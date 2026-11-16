#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createOrganizationServer } from './server.js';

async function main() {
  const server = createOrganizationServer({
    baseUrl: process.env.IO_SERVICE_URL ?? 'http://127.0.0.1:17890',
    token: process.env.IO_MEMBER_TOKEN ?? '',
    host: process.env.IO_HOST ?? 'mcp',
  });
  await server.connect(new StdioServerTransport());
}
main().catch((error: unknown) => {
  // stdout is reserved for MCP JSON-RPC; credentials are never logged.
  process.stderr.write(
    `Intelligent Organization MCP failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exitCode = 1;
});
