'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { launch, RpcClient } = require('../runtime/launcher.cjs');

async function fixture(t, { active = false, mode = 'stdio', contextOverride } = {}) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'io-codex-launcher-')));
  const token = `test-only-secret-${Math.random()}`;
  const session = {
    id: 'work-session-a', serviceInstanceId: 'service-a', memberId: 'member-a', projectId: 'project-a',
    taskId: 'task-a', nodeId: 'node-a', host: 'codex', status: active ? 'active' : 'prepared',
    ...(active ? { nativeSessionId: 'existing-thread-a' } : {}),
  };
  const context = {
    project: { id: 'project-a', name: '项目 A' },
    task: { id: 'task-a', projectId: 'project-a', nodeId: 'node-a', title: '准确任务', version: 3 },
    memories: [{ id: 'memory-a', title: '需求', content: '真实需求', version: 2, status: 'published' }], issues: [], stale: true,
  };
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization, threadId: req.headers['x-io-thread-id'] });
    assert.equal(req.method, 'GET');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(contextOverride || { session, context }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profilePath = path.join(dir, 'profile.json');
  const log = path.join(dir, 'rpc.jsonl');
  const pidPath = path.join(dir, 'codex.pid');
  const codexPath = path.join(dir, 'fake-codex');
  await fs.writeFile(profilePath, JSON.stringify({ version: 1, token, baseUrl: `http://127.0.0.1:${server.address().port}`, session, workspacePath: dir }), { mode: 0o600 });
  await fs.writeFile(codexPath, `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
fs.writeFileSync(${JSON.stringify(pidPath)},String(process.pid));
process.stderr.write('private child diagnostics must never appear in launcher output');
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
const handle = line => {
 const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');
 if(${JSON.stringify(mode)}==='hang')return;
 if(m.method==='initialize')send({id:m.id,result:{userAgent:'test'}});
 else if(m.method==='thread/start')send({id:m.id,result:{thread:{id:${JSON.stringify(mode === 'bad-thread' ? '../../escape' : 'new-thread-a')}}}});
 else if(m.method==='mcpServerStatus/list')send({id:m.id,result:{data:${JSON.stringify(mode === 'missing-mcp' ? [] : [{name:'intelligent-organization-task',tools:{organization_bound_context:{name:'organization_bound_context'}}}])}}});
 else if(m.method==='thread/inject_items'||m.method==='thread/name/set')send({id:m.id,result:{}});
};
readline.createInterface({input:process.stdin}).on('line',handle);
`, { mode: 0o700 });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  return { dir, token, session, profilePath, codexPath, requests, log, pidPath, input: { profilePath, workspacePath: dir, codexPath } };
}

function runCli(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '../runtime/launcher.cjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject); child.on('exit', code => resolve({ code, stdout, stderr, result: JSON.parse(stdout) }));
    child.stdin.end(JSON.stringify(input));
  });
}

test('managed launch initializes RPC, creates one fixed task thread and never starts a model turn', async t => {
  const f = await fixture(t);
  const output = await runCli(f.input);
  assert.equal(output.code, 0);
  assert.equal(output.result.nativeSessionId, 'new-thread-a');
  assert.equal(output.result.deepLink, 'codex://threads/new-thread-a');
  assert.equal(output.result.warnings.length, 2, 'desktop plugin installation and hook trust must be explicit');
  assert.equal(output.stderr, ''); assert.ok(!output.stdout.includes(f.token));
  const rpc = (await fs.readFile(f.log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rpc.map(message => message.method), ['initialize', 'initialized', 'thread/start', 'mcpServerStatus/list', 'thread/inject_items', 'thread/name/set']);
  const params = rpc[2].params;
  assert.equal(params.cwd, f.dir);
  for (const setting of ['model', 'modelProvider', 'sandbox', 'approvalPolicy', 'baseInstructions', 'projectId']) assert.equal(params[setting], undefined);
  const mcp = params.config['mcp_servers.intelligent-organization-task'];
  assert.equal(mcp.required, true);
  assert.equal(mcp.command, process.execPath);
  assert.deepEqual(mcp.env, { IO_BINDING_FILE: f.profilePath, IO_HOST: 'codex' });
  assert.equal(path.basename(mcp.args[0]), 'server.cjs');
  assert.ok(Object.keys(params.config).every(key => !key.startsWith('hooks.')), 'desktop global hooks must not be duplicated in thread config');
  assert.match(params.developerInstructions, /真实需求/);
  assert.match(params.developerInstructions, /project-a/);
  assert.ok(!JSON.stringify(params).includes(f.token));
  assert.equal(rpc[4].params.items[0].role, 'developer');
  assert.deepEqual(f.requests, [{ url: '/api/agent/context', authorization: `Bearer ${f.token}`, threadId: undefined }]);
  const profile = JSON.parse(await fs.readFile(f.profilePath, 'utf8'));
  assert.equal(profile.session.status, 'prepared', 'Native App attaches only after launcher returns');
});

test('missing task MCP tools prevents persistence and binding activation', async t => {
  const f = await fixture(t, { mode: 'missing-mcp' });
  const output = await runCli(f.input);
  assert.equal(output.code, 1);
  assert.equal(output.result.code, 'codex_mcp_unavailable');
  const log = await fs.readFile(f.log, 'utf8');
  assert.ok(!log.includes('thread/inject_items'));
});

test('resuming uses the attached native ID without creating or reading another Codex thread', async t => {
  const f = await fixture(t, { active: true });
  const result = await launch(f.input, { createClient: () => { throw new Error('must not spawn'); } });
  assert.equal(result.nativeSessionId, 'existing-thread-a');
  assert.equal(result.deepLink, 'codex://threads/existing-thread-a');
  assert.equal(f.requests[0].threadId, 'existing-thread-a');
});

test('server/profile mismatch stops before any Codex RPC', async t => {
  const f = await fixture(t);
  await assert.rejects(launch(f.input, {
    fetcher: async () => ({ ok: true, json: async () => ({ session: { ...f.session, taskId: 'task-b' }, context: {} }) }),
    createClient: () => { throw new Error('must not spawn'); },
  }), { code: 'binding_mismatch' });
});

test('insecure profiles and mismatched workspaces are rejected without printing secrets', async t => {
  const f = await fixture(t);
  if (process.platform !== 'win32') {
    await fs.chmod(f.profilePath, 0o644);
    const output = await runCli(f.input);
    assert.equal(output.code, 1); assert.equal(output.result.code, 'insecure_profile'); assert.ok(!output.stdout.includes(f.token));
    await fs.chmod(f.profilePath, 0o600);
  }
  await assert.rejects(launch({ ...f.input, workspacePath: os.tmpdir() }), { code: 'workspace_mismatch' });
});

test('invalid native thread response fails safely and never activates a binding', async t => {
  const f = await fixture(t, { mode: 'bad-thread' });
  const output = await runCli(f.input);
  assert.equal(output.code, 1); assert.equal(output.result.code, 'invalid_thread');
  assert.equal(output.result.nativeSessionId, undefined);
});

test('RPC deadlines terminate owned child processes', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'io-codex-rpc-timeout-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const rpc = new RpcClient(process.execPath, ['-e', 'process.stdin.resume();setInterval(()=>{},1000)'], dir);
  await assert.rejects(rpc.initialize(30), { code: 'codex_timeout' });
  await rpc.close();
  assert.ok(rpc.closed);
});

test('launcher SIGTERM closes its owned Codex process without exposing the grant', async t => {
  if (process.platform === 'win32') return t.skip('Unix signal behavior');
  const f = await fixture(t, { mode: 'hang' });
  const child = spawn(process.execPath, [path.join(__dirname, '../runtime/launcher.cjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.stdin.end(JSON.stringify(f.input));
  let codexPid;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { codexPid = Number(await fs.readFile(f.pidPath, 'utf8')); break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.ok(codexPid, 'the launcher must have started its owned Codex child');
  child.kill('SIGTERM');
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('launcher did not stop')), 3000).unref())]);
  assert.throws(() => process.kill(codexPid, 0), { code: 'ESRCH' });
  assert.ok(!stdout.includes(f.token)); assert.equal(stderr, '');
});
