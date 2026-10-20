import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoots = [];
const goodCommand = 'node --version';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function save(file, value) { await writeFile(file, JSON.stringify(value, null, 2) + '\n'); }
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-boundary-test-'));
  fixtureRoots.push(root);
  await mkdir(path.join(root, '.harness/hooks'), { recursive: true });
  await mkdir(path.join(root, '.harness/evidence'), { recursive: true });
  for (const name of ['run.mjs', 'context-budget.mjs', 'hooks/hook-recovery.mjs', 'hooks/native-hook-identity.mjs', 'hooks/precompact-handoff.mjs', 'hooks/sessionstart-routing.mjs']) await copyFile(path.join(repository, '.harness', name), path.join(root, '.harness', name));
  const config = await json(path.join(repository, '.harness/config.json'));
  config.verification = { quick: [], full: [goodCommand], architecture: [], e2e: [], clean: [] };
  config.completion = { baseLayers: ['full'], alwaysRunWhenConfigured: [], requireAcceptanceCommands: true };
  config.docs.required = [];
  config.agents = { enabled: ['codex'], instructions: { codex: 'AGENTS.md' } };
  await save(path.join(root, '.harness/config.json'), config);
  await save(path.join(root, '.harness/features.json'), { version: 1, revision: 0, features: [] });
  await save(path.join(root, '.harness/continuity.json'), { version: 1, phase: 'working', generation: 1, checkpoint: null, handoff: null });
  await save(path.join(root, '.harness/credentials-state.json'), { version: 1, cursors: {} });
  for (const name of ['progress.md', 'handoff.md', 'docs-map.md']) await writeFile(path.join(root, '.harness', name), '# Fixture\n');
  await writeFile(path.join(root, 'AGENTS.md'), '# Fixture\n## Development-Harness Boundary\n## Orchestrated-Worker Protocol\nORCHESTRATED_WORKER_CONTINUITY_V1\nRead .harness/config.json .harness/features.json .harness/continuity.json and .harness/run.mjs session and .harness/run.mjs resume.\n');
  for (const args of [['init'], ['config','user.email','harness@example.test'], ['config','user.name','Harness Fixture'], ['add','.'], ['commit','-m','Fixture baseline']]) await exec('git', args, { cwd: root, windowsHide: true });
  return root;
}
function env(actor) { const value = { ...process.env, CODEX_SESSION_ID: 'shared-parent' }; if(actor) value.CODEX_THREAD_ID=actor; else delete value.CODEX_THREAD_ID; return value; }
async function run(root, actor, ...args) { return exec(process.execPath, [path.join(root,'.harness/run.mjs'), ...args], { cwd: root, windowsHide: true, env: env(actor), maxBuffer: 2 * 1024 * 1024 }); }
async function add(root, actor='worker-a') { await run(root,actor,'add','repair-001','--title','Repair','--description','Bounded repair','--criterion','Pass fixture','--command',goodCommand,'--allow','src/**'); }
async function stateBytes(root) { return Promise.all(['features.json','continuity.json','events.jsonl'].map(p=>readFile(path.join(root,'.harness',p),'utf8').catch(()=>null))); }
async function hook(root,name,actor,input) {
 return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'.harness/hooks',name)],{cwd:root,windowsHide:true,env:env(actor)});let output='',errors='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>errors+=d);child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(output)):reject(Error(errors)));child.stdin.end(JSON.stringify(input));});
}

test('worker boundary: explicit claim, wrong owner, self resume and repeated resume fail without state writes', async()=>{
 const root=await fixture();
 await assert.rejects(run(root,'worker-a','add','x'),/No worker owns/);
 await run(root,'worker-a','claim'); await add(root); await run(root,'worker-a','start','repair-001');
 for(const args of [['add','x'],['start','repair-001'],['block','repair-001','--reason','no'],['check','full'],['verify','repair-001'],['checkpoint','--summary','bad'],['handoff','--summary','bad'],['migrate']]) {
   const before=await stateBytes(root); await assert.rejects(run(root,'worker-b',...args),/ownership mismatch/); assert.deepEqual(await stateBytes(root),before);
 }
 await run(root,'worker-a','handoff','--summary','Transfer');
 const c=await json(path.join(root,'.harness/continuity.json')); const before=await stateBytes(root);
 await assert.rejects(run(root,'worker-a','resume',c.handoff.id),/cannot resume/); assert.deepEqual(await stateBytes(root),before);
 await run(root,'worker-b','resume',c.handoff.id); await run(root,'worker-b','resume',c.handoff.id);
 const resumed=await stateBytes(root); await assert.rejects(run(root,'worker-c','resume',c.handoff.id),/ownership mismatch/); assert.deepEqual(await stateBytes(root),resumed);
 assert.equal((await json(path.join(root,'.harness/continuity.json'))).owner.id,'worker-b');
});

test('worker boundary: normal yield and needs input revoke mutation until a distinct worker claims',async()=>{
 const root=await fixture();await run(root,'worker-a','claim');
 await run(root,'worker-a','checkpoint','--summary','Complete','--reason','worker_yield');
 assert.equal(JSON.parse((await run(root,'worker-a','session','--json')).stdout).action,'delegate_worker');
 const before=await stateBytes(root);
 await assert.rejects(run(root,'worker-a','claim'),/Retired worker/);await assert.rejects(run(root,'worker-a','checkpoint','--summary','repeat'),/No worker owns/);assert.deepEqual(await stateBytes(root),before);
 await run(root,'worker-b','claim'); await run(root,'worker-b','checkpoint','--summary','Decision','--reason','needs_input');
 assert.equal(JSON.parse((await run(root,'worker-b','session','--json')).stdout).action,'await_user');
 await assert.rejects(run(root,'worker-b','claim'),/Retired worker/);await run(root,'worker-c','claim');
 assert.equal(JSON.parse((await run(root,'worker-c','session','--json')).stdout).action,'continue_worker');
});

test('worker boundary: no shared-session identity fallback or host identity override',async()=>{
 const root=await fixture();await assert.rejects(run(root,null,'claim'),/Worker identity required/);
 await assert.rejects(run(root,'worker-a','claim','--worker-id','worker-b'),/conflicts/);
 await run(root,null,'claim','--worker-id','manual-worker');
 const c=await json(path.join(root,'.harness/continuity.json'));assert.equal(c.owner.source,'explicit-attestation');
});

test('worker baseline: migration is lossless, idempotent and compact, preserving status and contracts',async()=>{
 const root=await fixture();await run(root,'worker-a','claim');await add(root);await run(root,'worker-a','start','repair-001');
 const file=path.join(root,'.harness/features.json');const state=await json(file);const baseline=await json(path.join(root,state.features[0].scopeBaselineRef.path));
 state.features[0].scopeBaseline=baseline;delete state.features[0].scopeBaselineRef;
 state.features[0].scopeBaseline.output='diagnostic-'+ 'x'.repeat(60000);
 const original=structuredClone(state);await save(file,state);await run(root,'worker-a','migrate');const migrated=await json(file);
 const resolved=await json(path.join(root,migrated.features[0].scopeBaselineRef.path));assert.deepEqual(resolved,original.features[0].scopeBaseline);
 const reconstructed=structuredClone(migrated);reconstructed.features[0].scopeBaseline=resolved;delete reconstructed.features[0].scopeBaselineRef;assert.deepEqual(reconstructed,original);
 const bytes=await readFile(file,'utf8');assert.ok(bytes.length<10000);await run(root,'worker-a','migrate');assert.equal(await readFile(file,'utf8'),bytes);
 await writeFile(path.join(root,migrated.features[0].scopeBaselineRef.path),'{}');
 await assert.rejects(run(root,'worker-a','verify','repair-001'),/scope-baseline-unavailable|verification failed|FAIL/i);
 const latest=await json(file);const evidence=await json(path.join(root,latest.features[0].evidence.at(-1)));assert.equal(evidence.pass,false);
});

test('worker bootstrap: historical feature volume and baseline maps never enter bounded startup',async()=>{
 const root=await fixture();await run(root,'worker-a','claim');const state={version:1,revision:1,features:[]};
 for(let i=0;i<300;i++)state.features.push({id:'old-'+i,title:'Historical',description:'Historical',status:'blocked',dependencies:[],scopeBaseline:{files:[{path:'BASELINE_SECRET_SENTINEL',output:'x'.repeat(1000)}]},blocker:'OLD_BLOCKER_SENTINEL',evidence:[]});
 await save(path.join(root,'.harness/features.json'),state);const before=await stateBytes(root);
 const output=(await run(root,'worker-a','bootstrap','--json')).stdout;assert.ok(Buffer.byteLength(output)<4000);assert.doesNotMatch(output,/BASELINE_SECRET_SENTINEL|OLD_BLOCKER_SENTINEL/);assert.equal(JSON.parse(output).counts.blocked,300);
 const status=(await run(root,'worker-a','status')).stdout;assert.ok(status.length<2000);assert.deepEqual(await stateBytes(root),before);
});

test('worker hooks: owner transfer, routing parent isolation, missing identity and compact additionalContext',async()=>{
 const root=await fixture();await run(root,'worker-a','claim');const payload={hook_event_name:'PreCompact',trigger:'auto',cwd:root,session_id:'shared-parent'};
 const before=await stateBytes(root);
 for(const actor of ['shared-parent','worker-other']) assert.equal((await hook(root,'precompact-handoff.mjs',actor,payload)).continue,true);
 assert.deepEqual(await stateBytes(root),before);
 assert.equal((await hook(root,'precompact-handoff.mjs',null,payload)).continue,false);assert.deepEqual(await stateBytes(root),before);
 const route=await hook(root,'sessionstart-routing.mjs','shared-parent',{hook_event_name:'SessionStart',source:'compact'});assert.equal(route.hookSpecificOutput.hookEventName,'SessionStart');assert.match(route.hookSpecificOutput.additionalContext,/Existing worker worker-a/);assert.deepEqual(await stateBytes(root),before);
 assert.equal((await hook(root,'precompact-handoff.mjs','worker-a',payload)).continue,true);const parked=await stateBytes(root);const c=await json(path.join(root,'.harness/continuity.json'));assert.equal(c.phase,'awaiting_resume');
 const compact=await hook(root,'sessionstart-routing.mjs','shared-parent',{hook_event_name:'SessionStart',source:'compact'});assert.match(compact.hookSpecificOutput.additionalContext,/fork_turns="none"/);assert.match(compact.hookSpecificOutput.additionalContext,new RegExp(c.handoff.id));assert.ok(JSON.stringify(compact).length<1500);assert.deepEqual(await stateBytes(root),parked);
});

test.after(async()=>{const base=path.resolve(os.tmpdir())+path.sep;for(const root of fixtureRoots){assert.ok(path.resolve(root).startsWith(base));assert.ok(path.basename(root).startsWith('harness-boundary-test-'));await rm(root,{recursive:true,force:true});}});

test('worker scope: staged rename into reserved baseline directory retains protected source deletion',async()=>{
 const root=await fixture();await writeFile(path.join(root,'protected.txt'),'Do not remove\n');await exec('git',['add','.'],{cwd:root,windowsHide:true});await exec('git',['commit','-m','Protected source'],{cwd:root,windowsHide:true});
 await run(root,'worker-a','claim');await add(root);await run(root,'worker-a','start','repair-001');await exec('git',['mv','protected.txt','.harness/baselines/moved.txt'],{cwd:root,windowsHide:true});
 await assert.rejects(run(root,'worker-a','verify','repair-001'), error => /protected.txt/.test(error.stdout));
});

test('worker routing: current blocked feature and parked decisions remain bounded and actionable',async()=>{
 const root=await fixture();await run(root,'worker-a','claim');await add(root);await run(root,'worker-a','start','repair-001');await run(root,'worker-a','block','repair-001','--reason','CURRENT_BLOCKER');
 await run(root,'worker-a','handoff','--summary','Transfer decision','--reason','needs_input','--decision','PRESERVED_DECISION');
 let c=await json(path.join(root,'.harness/continuity.json'));assert.ok(c.handoff.blockers.includes('repair-001: CURRENT_BLOCKER'));assert.match(c.handoff.next,/CURRENT_BLOCKER/);
 const routing=JSON.parse((await run(root,'worker-a','session','--json')).stdout);assert.equal(routing.action,'await_user');assert.doesNotMatch(JSON.stringify(routing),/PRESERVED_DECISION|CURRENT_BLOCKER/);
 const compact=await hook(root,'sessionstart-routing.mjs','shared-parent',{hook_event_name:'SessionStart',source:'compact'});assert.match(compact.hookSpecificOutput.additionalContext,/user decision/);assert.doesNotMatch(compact.hookSpecificOutput.additionalContext,/Exact resume command/);
 await run(root,'worker-b','resume',c.handoff.id);const packet=JSON.parse((await run(root,'worker-b','bootstrap','--json')).stdout);assert.ok(packet.checkpoint.decisions.includes('PRESERVED_DECISION'));assert.ok(packet.checkpoint.blockers.includes('repair-001: CURRENT_BLOCKER'));
 await run(root,'worker-b','checkpoint','--summary','Still waiting','--reason','worker_yield');
 c=await json(path.join(root,'.harness/continuity.json'));assert.ok(c.checkpoint.blockers.includes('repair-001: CURRENT_BLOCKER'));assert.match(c.checkpoint.next,/CURRENT_BLOCKER/);
 await run(root,'worker-c','claim');await run(root,'worker-c','checkpoint','--summary','Current blocked work');
 c=await json(path.join(root,'.harness/continuity.json'));assert.ok(c.checkpoint.blockers.includes('repair-001: CURRENT_BLOCKER'));

});
