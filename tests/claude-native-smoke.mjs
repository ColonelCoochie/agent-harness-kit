#!/usr/bin/env node
// Optional installed-host acceptance check. Model responses come from localhost.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initHarness } from '../skill/codex-harness/scripts/lib/core.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'harness-native-claude-'));
const project = path.join(temporary, 'project');
const profile = path.join(temporary, 'profile');
const requests = [];
const requestIdentities = [];
const parentSentinel = 'NATIVE_PARENT_HISTORY_SENTINEL';
const childSentinel = 'NATIVE_FRESH_CHILD_PROMPT';
let server;

async function harnessSnapshot(directory = path.join(project, '.harness'), prefix = '') {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const key = `${prefix}${entry.name}`;
    if (entry.isDirectory()) Object.assign(result, await harnessSnapshot(path.join(directory, entry.name), `${key}/`));
    else result[key] = createHash('sha256').update(await readFile(path.join(directory, entry.name))).digest('hex');
  }
  return result;
}

function isolatedEnvironment(baseURL) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(path|pathext|systemroot|windir|comspec|temp|tmp)$/i.test(name)) env[name] = value;
  }
  return Object.assign(env, {
    HOME: profile, USERPROFILE: profile, APPDATA: path.join(profile, 'AppData/Roaming'),
    LOCALAPPDATA: path.join(profile, 'AppData/Local'), CLAUDE_CONFIG_DIR: path.join(profile, '.claude'),
    TEMP: path.join(profile, 'tmp'), TMP: path.join(profile, 'tmp'),
    ANTHROPIC_API_KEY: 'native-smoke-dummy-key', ANTHROPIC_BASE_URL: baseURL,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1', CI: 'true'
  });
}

async function executable() {
  if (process.argv.length > 2) {
    assert.equal(process.argv[2], '--cli', 'Usage: node tests/claude-native-smoke.mjs [--cli /absolute/claude]');
    assert.equal(process.argv.length, 4);
    return path.resolve(process.argv[3]);
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    const native = path.join(process.env.APPDATA, 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe');
    try { await access(native); return native; } catch {}
  }
  return 'claude';
}

async function run(cli, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { cwd: project, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure;
    const kill = () => {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else child.kill('SIGKILL');
    };
    const timer = setTimeout(() => { failure = Error('Native CLI exceeded the 60 second deadline'); kill(); }, 60_000);
    for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.on('data', data => {
        if (name === 'stdout') stdout += data; else stderr += data;
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 2 * 1024 * 1024) {
          failure = Error('Native CLI output exceeded 2 MiB'); kill();
        }
      });
    }
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(Error(`Native CLI exited ${code}: ${stderr.slice(-4000)} ${stdout.slice(-4000)}`));
      else resolve({ stdout, stderr });
    });
  });
}

function sendMessage(response, body, content, stopReason) {
  const message = { id: `msg_native_${requests.length}`, type: 'message', role: 'assistant',
    model: body.model, content, stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 } };
  if (!body.stream) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(message));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const event = data => response.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
  event({ type: 'message_start', message: { ...message, content: [], stop_reason: null } });
  content.forEach((block, index) => {
    event({ type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } });
    event({ type: 'content_block_delta', index, delta: block.type === 'tool_use'
      ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
      : { type: 'text_delta', text: block.text } });
    event({ type: 'content_block_stop', index });
  });
  event({ type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 10 } });
  event({ type: 'message_stop' });
  response.end();
}

try {
  await mkdir(profile, { recursive: true });
  await mkdir(path.join(profile, 'tmp'));
  await initHarness(project, { name: 'Native Claude Fixture', purpose: 'Isolated native hook acceptance', agents: ['claude'] });
  const harnessBefore = await harnessSnapshot();
  const payloadFile = path.join(project, 'native-hook-payloads.jsonl');
  await writeFile(path.join(project, 'record-hook.cjs'), `const fs=require('node:fs');const input=JSON.parse(fs.readFileSync(0,'utf8'));fs.appendFileSync('native-hook-payloads.jsonl',JSON.stringify(input)+'\\n');process.stdout.write('{}');\n`);
  const settings = JSON.parse(await readFile(path.join(project, '.claude/settings.json'), 'utf8'));
  for (const name of ['Setup', 'SessionStart', 'SubagentStart']) {
    settings.hooks[name] ??= [];
    settings.hooks[name].unshift({ hooks: [{ type: 'command', command: 'node record-hook.cjs', timeout: 10 }] });
  }
  const settingsFile = path.join(project, 'native-settings.json');
  await writeFile(settingsFile, JSON.stringify(settings));
  const mcpFile = path.join(project, 'empty-mcp.json');
  await writeFile(mcpFile, JSON.stringify({ mcpServers: {} }));

  let protocolError, agentInputSchema;
  server = createServer(async (request, response) => {
    try {
      let raw = '';
      for await (const chunk of request) {
        raw += chunk;
        assert.ok(Buffer.byteLength(raw) <= 2 * 1024 * 1024, 'Mock request exceeds 2 MiB');
      }
      const endpoint = new URL(request.url, 'http://127.0.0.1').pathname;
      if (endpoint === '/' && ['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}'); return;
      }
      if (endpoint === '/v1/messages/count_tokens') {
        assert.ok(request.headers['x-api-key'] === 'native-smoke-dummy-key', 'Mock count_tokens x-api-key must use the fixture value');
        assert.ok(!request.headers.authorization, 'Unexpected Authorization header on count_tokens');
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ input_tokens: 10 })); return;
      }
      assert.equal(endpoint, '/v1/messages', `Unexpected mock endpoint: ${request.method} ${endpoint}`);
      assert.equal(request.method, 'POST');
      assert.ok(request.headers['x-api-key'] === 'native-smoke-dummy-key', 'Mock Messages x-api-key must use the fixture value');
      assert.ok(!request.headers.authorization, 'Unexpected Authorization header on Messages');
      const body = JSON.parse(raw);
      requests.push(body);
      requestIdentities.push({ agentId: request.headers['x-claude-code-agent-id'], parentAgentId: request.headers['x-claude-code-parent-agent-id'] });
      assert.ok(requests.length <= 4, 'Unexpected additional model call');
      const conversation = JSON.stringify(body.messages);
      if (requests.length === 1) {
        assert.ok(conversation.includes(parentSentinel));
        const agent = body.tools?.find(tool => tool.name === 'Agent');
        assert.ok(agent, 'Installed CLI did not expose the Agent tool');
        agentInputSchema = agent.input_schema;
        const input = { description: 'Native hook probe', prompt: childSentinel, subagent_type: 'native-probe' };
        if (agentInputSchema.properties?.fork_context) input.fork_context = false;
        if (agentInputSchema.properties?.run_in_background) input.run_in_background = false;
        for (const required of agentInputSchema.required ?? []) assert.ok(required in input, `Unknown required Agent field: ${required}`);
        sendMessage(response, body, [{ type: 'tool_use', id: 'toolu_native_agent', name: agent.name, input }], 'tool_use');
      } else if (request.headers['x-claude-code-agent-id']) {
        sendMessage(response, body, [{ type: 'text', text: 'Native child completed.' }], 'end_turn');
      } else {
        sendMessage(response, body, [{ type: 'text', text: 'Native parent completed.' }], 'end_turn');
      }
    } catch (error) {
      protocolError ??= error;
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: error.message } }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = isolatedEnvironment(`http://127.0.0.1:${server.address().port}`);
  assert.ok(!Object.keys(env).some(name => /CODEX|OPENAI|TOKEN|AWS|GOOGLE/i.test(name)), 'Host identities or provider credentials leaked');
  const cli = await executable();
  const version = (await run(cli, ['--version'], env)).stdout.trim();
  const common = ['--settings', settingsFile, '--setting-sources', '', '--strict-mcp-config', '--mcp-config', mcpFile, '--no-chrome'];
  await run(cli, [...common, '--init-only'], env);
  let payloads = (await readFile(payloadFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(payloads.some(payload => payload.hook_event_name === 'Setup'), 'Native Setup hook did not run');
  assert.ok(payloads.some(payload => payload.hook_event_name === 'SessionStart'), 'Native SessionStart hook did not run');
  assert.equal(requests.length, 0, 'Init-only unexpectedly called the model');

  const agents = { 'native-probe': { description: 'Validate a fresh bounded child', prompt: 'Complete this isolated native hook probe. Do not use tools.', tools: [] } };
  const result = await run(cli, [...common, '--print', '--no-session-persistence', '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--tools', 'Agent', '--allowedTools', 'Agent', '--agents', JSON.stringify(agents), '--max-turns', '3', '--model', 'claude-sonnet-4-5', parentSentinel], env);
  if (protocolError) throw protocolError;
  payloads = (await readFile(payloadFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const childPayloads = payloads.filter(payload => payload.hook_event_name === 'SubagentStart');
  assert.equal(childPayloads.length, 1, 'Expected exactly one native child hook');
  const child = childPayloads[0];
  assert.equal(child.agent_type, 'native-probe');
  assert.match(child.agent_id, /^[a-zA-Z0-9_./:-]{1,180}$/);
  assert.equal(path.resolve(child.cwd), project);
  const identity = `claude-agent:${child.agent_id}`;
  const childRequests = requests.filter((body, index) => requestIdentities[index].agentId === child.agent_id);
  assert.equal(childRequests.length, 1, 'Fresh child did not have an isolated Messages request');
  assert.ok(childRequests[0].messages.some(message => message.role === 'user' && Array.isArray(message.content) && message.content.some(block => block.type === 'text' && block.text === childSentinel)), 'Native child request lacks its delegated prompt');
  assert.ok(JSON.stringify(childRequests[0].messages).includes(identity), 'Production hook identity absent from the child request');
  assert.ok(!JSON.stringify(childRequests[0].messages).includes(parentSentinel), 'Child inherited the parent-only history');
  assert.ok(!JSON.stringify(requests[0].messages).includes(identity), 'Child identity leaked into parent input');
  // Native Agent dispatch may acknowledge an asynchronous launch before delivering
  // its completion notification. Depending on that race, the parent takes 2 or 3 turns.
  assert.ok([3, 4].includes(requests.length), 'Unexpected number of native model turns');
  assert.ok(JSON.stringify(requests.at(-1).messages).includes('Native child completed.'), 'Parent never received the child completion');
  assert.deepEqual(await harnessSnapshot(), harnessBefore, 'Read-only hooks changed authoritative harness files');
  const events = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(events.some(event => event.type === 'result' && !event.is_error), 'Native run did not finish successfully');
  console.log(JSON.stringify({ pass: true, cliVersion: version, startupHooks: ['Setup', 'SessionStart'], childHook: 'SubagentStart', childAgentId: child.agent_id,
    productionIdentityDelivered: true, nativeAgentHeaderMatched: true, inheritedParentHistory: false, hookOwnershipWrites: false,
    messagesRequests: requests.length, agentRequiredFields: agentInputSchema.required, nativeCompactionValidated: false,
    networkConfinementValidated: false, descendantCleanupValidated: false }));
} finally {
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  const temporaryRelative = path.relative(path.resolve(os.tmpdir()), path.resolve(temporary));
  assert.ok(temporaryRelative && !temporaryRelative.startsWith('..') && !path.isAbsolute(temporaryRelative), 'Temporary cleanup must remain inside os.tmpdir');
  await rm(temporary, { recursive: true, force: true });
}
