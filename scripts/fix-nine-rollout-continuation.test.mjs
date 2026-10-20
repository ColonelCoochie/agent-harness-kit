import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate as boundedImmediate} from 'node:timers/promises';
import {mapBounded,freezeInventoryBounded,authenticateBindings as authenticateContinuationBindings,authenticateGateInventory as authenticateContinuationGateInventory} from './fix-nine-rollout-continuation-auth.mjs';
import {runGateWorkflow as runContinuationGateWorkflow} from './fix-nine-rollout-continuation-gate.mjs';
import {readFile,writeFile,appendFile,mkdtemp,mkdir,rm,copyFile,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expectedVerificationPlan,gateTimeout,gateDirectory,rolloutFeatureId,validateVerificationEvidence} from './fix-nine-rollout-evidence.mjs';
import {authenticateBindings,authenticateGateInventory,requiredHelpers} from './fix-nine-rollout-auth.mjs';
import {authenticateFile,authenticatePrefix,freezeInventory,pinFile,readJson,regularInventoryPaths} from './fix-nine-rollout-files.mjs';
import {beforePath,receiptPath,runGateWorkflow} from './fix-nine-rollout-gate.mjs';
import {canonicalHash} from './fix-nine-rollout-evidence.mjs';
import {authenticatePilotHistory,completionScope,validateCompletionScope,requireAllElevenClearance,validateCurrentExoPolicy,continuationDirectory,validateGateProtocol,validateContinuationTransfer,continuationOrder,nativeExpected,validateNativeSet,validateNativeReceipt,validateSourcePlan,validateContextTelemetry,validateCommands} from './fix-nine-rollout-continuation.mjs';
import {targets} from './fix-nine-rollout-preflight.mjs';
import {continuationNativeAuthority} from './fix-nine-rollout-continuation.mjs';

const copy=value=>structuredClone(value), hash='a'.repeat(64);
function nativeFixture(completed=[]) {
  const authority={nativeTrustRows:{unrelated:{trusted_hash:'retained',enabled:false}},nativeTransitions:[],
    nativeBaseline:{raw:{path:'native-config.toml'},unrelatedSha256:hash,trust:{unrelated:'retained'}}};
  for(let index=0;index<11;index++) for(let n=0;n<6;n++) {
    const key=`${index}-${n}`,before=`before-${key}`,after=index===0?before:`after-${key}`;
    const beforeRaw={key,trustStatus:'trusted',command:{command:`old-${key}`}},afterRaw={key,trustStatus:'trusted',command:{command:`new-${key}`}};
    const beforeDefinition={key,currentHash:before,trustStatus:'trusted',definitionSha256:canonicalHash(beforeRaw)};
    const afterDefinition={key,currentHash:after,trustStatus:'trusted',definitionSha256:canonicalHash(afterRaw)};
    authority.nativeTrustRows[key]={trusted_hash:before,enabled:true};authority.nativeBaseline.trust[key]=before;
    authority.nativeTransitions.push({index,key,before,after,beforeRaw,afterRaw,beforeDefinition,afterDefinition});
  }
  const summary={raw:{path:'native-config.toml',bytes:123,sha256:hash},version:'v1',semanticSha256:hash,
    unrelatedSha256:hash,trust:copy(authority.nativeBaseline.trust),definitions:[]};
  for(const row of authority.nativeTransitions) {
    if(completed.includes(row.index)) summary.trust[row.key]=row.after;
    summary.definitions.push(copy(completed.includes(row.index)?row.afterDefinition:row.beforeDefinition));
  }
  return {authority,summary};
}
test('pilot completion is explicit and never inferred from an ordered prefix',()=>{
  assert.deepEqual(continuationOrder,[4,0,1,2,3,5,6,7,8,9,10]);
  const {authority,summary}=nativeFixture([4]);validateNativeSet(summary,authority,[4],hash);
  assert.throws(()=>validateNativeSet(summary,authority,[0,1,2,3,4],hash));
  assert.throws(()=>validateNativeSet(summary,authority,[4,4],hash));
  const config={provider:{name:'keep'},hooks:{state:copy(authority.nativeTrustRows),other:'retained'}};
  const expected=nativeExpected(authority,config,[4]);
  assert.equal(expected.hooks.state['4-0'].trusted_hash,'after-4-0');assert.equal(expected.hooks.state['1-0'].trusted_hash,'before-1-0');
  assert.deepEqual(expected.hooks.state.unrelated,config.hooks.state.unrelated);assert.deepEqual(expected.provider,config.provider);
  assert.throws(()=>nativeExpected(authority,config,[11]));
});
test('native set authenticates every definition, unrelated config and retained trust',()=>{
  const {authority,summary}=nativeFixture([4,0,1]);validateNativeSet(summary,authority,[4,0,1],hash);
  for(const corrupt of [s=>s.trust.unrelated='lost',s=>s.unrelatedSha256='b'.repeat(64),s=>s.definitions.pop(),
    s=>s.definitions[0].currentHash='forged',s=>s.definitions[20].definitionSha256='forged',s=>s.semanticSha256='forged']) {
    const changed=copy(summary);corrupt(changed);assert.throws(()=>validateNativeSet(changed,authority,[4,0,1],hash));
  }
});
test('native receipt requires one exact CAS and admits observed modified hooks only for this target',()=>{
  const {authority,summary:before}=nativeFixture([4,0]),{summary:after}=nativeFixture([4,0,1]);
  const observed=copy(before);
  for(const row of authority.nativeTransitions.filter(row=>row.index===1)) {
    const raw={...row.afterRaw,trustStatus:'modified'};
    observed.definitions[observed.definitions.findIndex(d=>d.key===row.key)]={...row.afterDefinition,trustStatus:'modified',definitionSha256:canonicalHash(raw)};
  }
  const request={filePath:observed.raw.path,expectedVersion:observed.version,reloadUserConfig:true,
    edits:[{keyPath:'hooks.state',mergeStrategy:'replace',value:nativeExpected(authority,{hooks:{state:{}}},[4,0,1]).hooks.state}]};
  const receipt={confirmed:true,before,observed,after,expectedSemanticSha256:hash,writeCount:1,request,response:{},responseError:null};
  validateNativeReceipt(receipt,authority,[4,0],1,hash,hash);
  for(const corrupt of [r=>r.writeCount=2,r=>r.request.expectedVersion='wrong',r=>delete r.request.edits[0].value.unrelated,
    r=>r.request.edits[0].value.unrelated.enabled=true,r=>r.observed.raw.sha256='b'.repeat(64),r=>r.after.trust['2-0']='after-2-0']) {
    const changed=copy(receipt);corrupt(changed);assert.throws(()=>validateNativeReceipt(changed,authority,[4,0],1,hash,hash));
  }
});
test('source plan allows lifecycle hashes only and rejects runtime writes or other drift',()=>{
  const frozen={target:targets[0],blocked:false,planHash:'old',operations:[{action:'preserve',path:'.harness/progress.md',beforeHash:'old',afterHash:'old'},
    {action:'preserve',path:'.harness/run.mjs',beforeHash:'runtime',afterHash:'runtime'}],readSet:[{path:'.harness/continuity.json',sha256:'old'},{path:'.harness/config.json',sha256:'config'}]};
  const now=copy(frozen);now.planHash='new';now.operations[0].beforeHash=now.operations[0].afterHash='new';now.readSet[0].sha256='new';
  validateSourcePlan(frozen,now);
  for(const corrupt of [p=>p.operations[1].action='write',p=>p.operations[1].beforeHash='changed',p=>p.readSet[1].sha256='changed',p=>p.operations.pop()]) {
    const changed=copy(now);corrupt(changed);assert.throws(()=>validateSourcePlan(frozen,changed));
  }
});
test('source context permits monotonic telemetry without changing worker identity',()=>{
  const before={version:1,actorHash:hash,role:'worker',startedAt:'2026-10-18T00:00:00Z',mutations:0,toolCalls:3,outputChars:100};
  validateContextTelemetry(before,{...before,toolCalls:4,outputChars:200});
  for(const changed of [{...before,actorHash:'b'.repeat(64)},{...before,role:'orchestrator'},{...before,toolCalls:2}]) assert.throws(()=>validateContextTelemetry(before,changed));
});
test('current startup requires successful doctor/bootstrap and completed timestamps',()=>{
  const commands=[{command:'node .harness/run.mjs doctor',exitCode:0,startedAt:'2026-10-18T00:00:00Z',finishedAt:'2026-10-18T00:01:00Z',stdout:`Harness doctor: ${targets[1]} (runtime v3)`},
    {command:'node .harness/run.mjs bootstrap --validate --json',exitCode:0,startedAt:'2026-10-18T00:01:00Z',finishedAt:'2026-10-18T00:02:00Z',stdout:JSON.stringify({validation:{healthy:true}})}];
  validateCommands(commands,targets[1],'2026-10-18T00:03:00Z');
  const bad=copy(commands);bad[1].exitCode=1;assert.throws(()=>validateCommands(bad,targets[1],'2026-10-18T00:03:00Z'));
  assert.throws(()=>validateCommands(commands,targets[1],'2026-10-18T00:01:00Z'));
});

// Regression fixtures use the real binding and native continuity writers.
const root=new URL('../',import.meta.url),clone=copy;
const pin=path=>({path,bytes:1,sha256:'a'.repeat(64)});
async function fixture() {
  const config = JSON.parse(await readFile(new URL('.harness/config.json', root)));
  const state = JSON.parse(await readFile(new URL('.harness/features.json', root)));
  const feature = clone(state.features.find(item => item.id === rolloutFeatureId));
  // Model a fresh gate, independently of whether the real rollout has finished.
  feature.status = 'active'; feature.attempts = 0; feature.evidence = [];
  const plan = expectedVerificationPlan(config, feature);
  const before = {config, feature, evidencePrefix:[], root:'C:\\reviewed\\source', owner:'fixture-worker',
    nodeExecutable:'C:\\reviewed\\node.exe', gateId:'ea2325fc-f8d9-4f70-854a-d7a70ff15e43'};
  const invocation = {executable:before.nodeExecutable, args:['.harness/run.mjs', 'verify', rolloutFeatureId],
    cwd:before.root, actor:before.owner, executionCount:plan.executions.length, timeoutMs:gateTimeout(config, plan),
    startedAt:'2026-10-17T20:00:00.000Z', finishedAt:'2026-10-17T20:00:03.000Z',
    outcome:{confirmed:true, exitCode:0, controllerExitCode:0, signal:null, timedOut:false},
    logs:{stdout:pin(`${gateDirectory}/stdout.log`), stderr:pin(`${gateDirectory}/stderr.log`)}};
  const ref = pin(`.harness/evidence/2026-10-17T20-00-02-000Z-${rolloutFeatureId}.json`);
  const evidence = {schemaVersion:5, harnessVersion:6, featureId:rolloutFeatureId, pass:true,
    contractHash:feature.contract.hash, configHash:canonicalHash(config), verificationPlan:plan,
    verificationHash:canonicalHash(plan), attempt:1, scopeViolations:[],
    requiredLayers:plan.requiredLayers.map(layer => layer.id), executedLayers:[...new Set(plan.executions.map(entry => entry.layer))],
    startedAt:'2026-10-17T20:00:01.000Z', finishedAt:'2026-10-17T20:00:02.000Z',
    commands:plan.executions.map((entry, i) => ({executionId:entry.id, executionOrder:i, command:entry.command,
      layer:entry.layer, criterionId:entry.criterionId, credentials:[], pass:true, exitCode:0, timedOut:false,
      signal:null, terminationConfirmed:true, durationMs:1,
      logs:{stdout:`.harness/logs/00000000-0000-4000-8000-${String(i).padStart(12,'0')}.stdout.log`,
        stderr:`.harness/logs/00000000-0000-4000-8000-${String(i).padStart(12,'0')}.stderr.log`}}))};
  return {before, invocation, ref, evidence};
}

async function diskFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'fix-nine-gate-'));
  t.after(async () => { await rm(directory, {recursive:true, force:true}); });
  const write = async (relative, value) => {
    await mkdir(path.dirname(path.join(directory, relative)), {recursive:true});
    await writeFile(path.join(directory, relative), typeof value === 'string' ? value : JSON.stringify(value) + '\n');
  };
  const f = await fixture(), config = f.before.config, feature = f.before.feature;
  const baselinePath = '.harness/baselines/fixture.json';
  await write(baselinePath, {fixture:true});
  feature.scopeBaselineRef = {version:1, ...await pinFile(directory, baselinePath), baselineHash:feature.contract.scopeBaselineHash};
  feature.evidence = ['.harness/evidence/old-selected.json'];
  await write(feature.evidence[0], {commands:[{logs:{stdout:'.harness/logs/old.stdout.log', stderr:'.harness/logs/old.stderr.log'}}]});
  await write('.harness/evidence/old-other.json', {commands:[]});
  await write('.harness/logs/old.stdout.log', 'retained stdout\n');
  await write('.harness/logs/old.stderr.log', 'retained stderr\n');
  await write('.harness/logs/unreferenced.log', 'retained unreferenced log\n');
  await write('.harness/evidence/unreferenced.json', {retained:true});
  const state = {version:1, revision:7, features:[{id:'historical', attempts:4, verificationBudget:{maxAttempts:23},
    evidence:['.harness/evidence/old-other.json'], immutable:'recovery retained'}, feature]};
  const owner = 'fixture-worker';
  await write('.harness/config.json', config); await write('.harness/features.json', state);
  await write('.harness/continuity.json', {version:1, phase:'working', owner:{id:owner, source:'CODEX_THREAD_ID'},
    handoff:null, retiredWorkerIds:['retained-retired-worker'], lastRecovery:{retained:true}});
  await write('.harness/events.jsonl', '{"retained":true}\n');
  await write('.harness/run.mjs', '// fixture runtime\n');
  for (const relative of requiredHelpers) await write(relative, `// fixture ${relative}\n`);
  await write('.harness/fix-nine-rollout-001/authority.json', {fixture:true, executionAuthorized:false});
  await write('.harness/fix-nine-rollout-001-report.json', {fixture:true, neverAProductionReport:true});
  await write('.harness/fix-nine-rollout-001/source-closure.json', {helperFiles:await Promise.all(requiredHelpers.map(relative => pinFile(directory, relative)))});
  const deployed = {version:1, kind:'fix-nine-rollout-authenticated-deployment', featureId:rolloutFeatureId,
    authority:await pinFile(directory, '.harness/fix-nine-rollout-001/authority.json'),
    report:await pinFile(directory, '.harness/fix-nine-rollout-001-report.json'),
    sourceClosure:await pinFile(directory, '.harness/fix-nine-rollout-001/source-closure.json'), references:[]};
  const inventoryModes = [];
  const deployment = async () => { const inventory = await authenticateGateInventory(directory);
    inventoryModes.push(inventory?.mode ?? 'pre'); return clone(deployed); };
  return {root:directory, write, owner, config, state, feature, deployment, deployed, inventoryModes};
}

async function fixtureVerification(f, {before, plan}) {
  assert(await readJson(f.root, beforePath));
  await assert.rejects(readJson(f.root, receiptPath), /ENOENT/);
  const sample = await fixture(), time = new Date().toISOString();
  const evidence = {...sample.evidence, configHash:canonicalHash(before.config), contractHash:before.feature.contract.hash,
    verificationPlan:plan, verificationHash:canonicalHash(plan), attempt:before.feature.attempts + 1,
    startedAt:time, finishedAt:time};
  const prefix = plan.executions.findIndex(entry => entry.criterionId === 'ac-1');
  for (const [index, entry] of evidence.commands.entries()) {
    for (const stream of ['stdout', 'stderr']) await f.write(entry.logs[stream], `actual fixture ${stream}\n`);
    if (index === prefix) {
      await f.pendingMutation?.(f, {before, plan, evidence});
      f.pendingBindings = await authenticateBindings(f);
    }
  }
  await f.beforeEvidence?.(f, {before, plan, evidence});
  const relative = `.harness/evidence/fixture-${rolloutFeatureId}.json`;
  await f.write(relative, evidence);
  const invocation = {...sample.invocation, executable:process.execPath, cwd:f.root, actor:f.owner,
    startedAt:time, finishedAt:time, executionCount:plan.executions.length, timeoutMs:gateTimeout(before.config, plan)};
  for (const stream of ['stdout', 'stderr']) {
    await f.write(`${gateDirectory}/${stream}.log`, `outer fixture ${stream}\n`);
    invocation.logs[stream] = await pinFile(f.root, `${gateDirectory}/${stream}.log`);
  }
  const verified = validateVerificationEvidence(before, invocation, await pinFile(f.root, relative), evidence);
  const state = await readJson(f.root, '.harness/features.json'); state.revision++;
  state.features[state.features.findIndex(item => item.id === rolloutFeatureId)] = {...before.feature, status:'passing',
    attempts:before.feature.attempts + 1, evidence:[...before.feature.evidence, relative],
    lastVerification:verified.lastVerification, repeatedFailures:0, lastFailureFingerprint:null, updatedAt:time};
  await f.write('.harness/features.json', state);
  await appendFile(path.join(f.root, '.harness/events.jsonl'), '{"verified":true}\n');
  return {invocation, evidence, relative};
}
async function fixtureGate(f, mutation) {
  let count = 0;
  const result = runGateWorkflow({...f, invoke:async args => {
    count++; const verified = await fixtureVerification(f, args);
    await mutation?.(f, verified, args); return verified.invocation;
  }});
  return {result, count:() => count};
}

test('continuation gate admits exact artifacts from real pending and completed binding snapshots', async t => {
  const f=await diskFixture(t), bodyPath=`${continuationDirectory}/review-body.json`;
  await f.write(bodyPath,{version:1,kind:'continuation gate binding regression'});
  const continuation=await pinFile(f.root,bodyPath);
  f.deployed.references.push(continuation);
  const pendingPaths=[`${gateDirectory}/before.json`,`${gateDirectory}/stdout.log`,`${gateDirectory}/stderr.log`];
  let observedPending=false;
  f.pendingMutation=async (_,{before})=>{
    const gate=await authenticateGateInventory(f.root);
    assert.equal(gate.mode,'pending');
    assert.deepEqual(before.bindings,await authenticateBindings(f));
    assert.equal(before.bindings.deployment.references,undefined);
    assert.equal(before.bindings.deployment.featureId,undefined);
    assert.deepEqual(validateGateProtocol(before,gate,continuation),pendingPaths);
    observedPending=true;
  };
  const workflow=await fixtureGate(f);
  await workflow.result;
  assert.equal(workflow.count(),1);assert(observedPending);
  const before=await readJson(f.root,beforePath), gate=await authenticateGateInventory(f.root);
  assert.equal(gate.mode,'completed');
  assert.deepEqual(validateGateProtocol(before,gate,continuation),
    [...pendingPaths,`${gateDirectory}/invocation.json`,`${gateDirectory}/receipt.json`]);
  for(const change of [value=>value.bindings.references=[],
    value=>value.bindings.references.find(row=>row.path===bodyPath).sha256='f'.repeat(64),
    value=>value.feature.id='different-feature']) {
    const changed=clone(before);change(changed);
    assert.throws(()=>validateGateProtocol(changed,gate,continuation));
  }
});


test('continuation authenticates real native transfer packets and monotonic successor context',async t=>{
  const {copyFile}=await import('node:fs/promises');
  const root=await mkdtemp(path.join(tmpdir(),'rollout-real-lifecycle-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'.harness/hooks'),{recursive:true});await mkdir(path.join(root,'.harness/evidence'),{recursive:true});
  for(const name of ['run.mjs','context-budget.mjs','hooks/hook-recovery.mjs','hooks/native-hook-identity.mjs','hooks/precompact-handoff.mjs','hooks/sessionstart-routing.mjs'])await copyFile(path.join(process.cwd(),'skill/codex-harness/assets',name==='run.mjs'?'project-runtime.mjs':path.basename(name)),path.join(root,'.harness',name));
  const put=async(p,value)=>{await mkdir(path.dirname(path.join(root,p)),{recursive:true});await writeFile(path.join(root,p),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)+'\n');return pinFile(root,p);};
  const config={version:1,project:{name:'Lifecycle regression',purpose:'Authenticate real finite lifecycle additions',stack:[]},policies:{wipLimit:1,maxAttempts:5,maxRepeatedFailures:2,commandTimeoutMs:30000,passingIsTerminal:true,requireEvidence:true},execution:{setup:[],start:[],health:[],shutdown:[]},scope:{enforcement:'required',defaultAllow:['src/**'],defaultDeny:[],capture:{version:1,metadataRoots:[],metadataExtensions:[]}},continuity:{mode:'orchestrated_worker',dirtyWorktree:'record',blockMutationsAfterHandoff:true},security:{environmentAllow:['PATH','SystemRoot','TEMP','TMP'],redactOutput:true,credentials:{stateFile:'.harness/credentials-state.json',providers:{}}},docs:{required:[],router:'.harness/docs-map.md'}};
  config.verification={quick:[],full:['node --version'],architecture:[],e2e:[],clean:[]};config.completion={baseLayers:['full'],alwaysRunWhenConfigured:[],requireAcceptanceCommands:true};config.docs.required=[];config.agents={enabled:['codex'],instructions:{codex:'AGENTS.md'}};
  await put('.harness/config.json',config);await put('.harness/features.json',{version:1,revision:0,features:[]});await put('.harness/continuity.json',{version:1,phase:'working',generation:1,checkpoint:null,handoff:null});await put('.harness/credentials-state.json',{version:1,cursors:{}});
  for(const name of ['progress.md','handoff.md','docs-map.md'])await put(`.harness/${name}`,'# Fixture\n');
  await put('AGENTS.md','# Fixture\n## Development-Harness Boundary\n## Orchestrated-Worker Protocol\nORCHESTRATED_WORKER_CONTINUITY_V1\nRead .harness/config.json .harness/features.json .harness/continuity.json and .harness/run.mjs session and .harness/run.mjs resume.\n');
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|HOME|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)));
  Object.assign(env,{HOME:root,USERPROFILE:root,TEMP:root,TMP:root,CODEX_HOME:path.join(root,'fixture-codex'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'empty-gitconfig'),GIT_CONFIG_COUNT:'0',GIT_TERMINAL_PROMPT:'0'});await put('empty-gitconfig','');
  const exec=(command,args,commandEnv=env)=>{const result=spawnSync(command,args,{cwd:root,env:commandEnv,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr||result.stdout);return result.stdout;};
  for(const args of [['init'],['config','user.email','fixture@example.test'],['config','user.name','Fixture'],['add','.'],['commit','-m','Fixture']])exec('git',args);
  const actors=[1,2,3,4].map(i=>`${i}`.repeat(8)+'-'+`${i}`.repeat(4)+'-4'+`${i}`.repeat(3)+'-8'+`${i}`.repeat(3)+'-'+`${i}`.repeat(12));
  const run=(actor,...args)=>exec(process.execPath,[path.join(root,'.harness/run.mjs'),...args],{...env,CODEX_THREAD_ID:actor,CODEX_SESSION_ID:'shared-parent'});
  const io={pin:p=>pinFile(root,p),authenticate:ref=>authenticateFile(root,ref),prefix:ref=>authenticatePrefix(root,ref)};
  const snapshot=async()=>{const refs=await Promise.all(['features.json','continuity.json','progress.md','handoff.md','events.jsonl'].map(p=>io.pin(`.harness/${p}`)));return {features:JSON.parse(await io.authenticate(refs[0])),continuity:JSON.parse(await io.authenticate(refs[1])),refs};};

  const transfer=async(from,to)=>{
    const before=await snapshot(),progress=await readFile(path.join(root,'.harness/progress.md'));
    run(from,'handoff','--summary','Real bounded transfer','--next','Continue fixture');
    const pending=JSON.parse(await readFile(path.join(root,'.harness/continuity.json'),'utf8'));
    assert.match(pending.handoff.id,/^handoff-\d{17}-[a-f0-9]{8}$/);
    const archive=await io.pin(`.harness/history/progress/${pending.handoff.id}.md`);
    assert.deepEqual(await io.authenticate(archive),progress);
    run(to,'resume',pending.handoff.id);run(to,'context','--observe','--json');
    const after=await snapshot(),events=(await readFile(path.join(root,'.harness/events.jsonl'),'utf8'))
      .trimEnd().split('\n').map(JSON.parse).filter(row=>row.handoffId===pending.handoff.id);
    const proof={packet:after.continuity.lastHandoff,events,archive};
    assert.equal(before.continuity.retiredWorkerIds,undefined,'First real native transfer has no historical retirements');
    validateContinuationTransfer(before,after,proof);
    const retiredBefore=clone(before);retiredBefore.continuity.retiredWorkerIds=[to];
    assert.throws(()=>validateContinuationTransfer(retiredBefore,after,proof));
    for(const change of [value=>value.events.pop(),value=>value.packet.drift.push('unreviewed drift'),
      value=>value.packet.driftAccepted=true]) {
      const changed=clone(proof);change(changed);
      assert.throws(()=>validateContinuationTransfer(before,after,changed));
    }
    const contextPath=`.harness/context/${createHash('sha256').update(to).digest('hex')}.json`;
    const telemetry=await readJson(root,contextPath);
    assert.equal(telemetry.actorHash,createHash('sha256').update(after.continuity.owner.id).digest('hex'));
    run(to,'context','--observe','--tool-calls','1','--output-chars','1','--json');
    const observed=await readJson(root,contextPath);validateContextTelemetry(telemetry,observed);
    for(const change of [value=>value.actorHash='f'.repeat(64),value=>value.role='orchestrator',
      value=>value.startedAt='changed',value=>value.toolCalls=telemetry.toolCalls-1]) {
      const changed=clone(observed);change(changed);assert.throws(()=>validateContextTelemetry(telemetry,changed));
    }
    return proof;
  };

  run(actors[0],'claim');run(actors[0],'add','fix-nine-rollout-001','--title','Fixture','--description','Fixture','--criterion','Fixture','--command','node --version','--allow','src/**');run(actors[0],'start','fix-nine-rollout-001');

  const proof=await transfer(actors[0],actors[1]);
  assert.equal(proof.packet.owner.id,actors[0]);
  assert.equal(proof.events[1].generation,proof.events[0].generation+1);
});

async function pilotHistoryFixture(run) {
  const root=await mkdtemp(path.join(tmpdir(),'pilot-history-'));
  try {
    await mkdir(path.join(root,'.harness/evidence'),{recursive:true});
    await writeFile(path.join(root,'.harness/evidence/completed.json'),'sealed evidence');
    await writeFile(path.join(root,'.harness/events.jsonl'),'historical prefix\n');
    const baseline={files:await Promise.all(['.harness/events.jsonl','.harness/evidence/completed.json'].map(file=>pinFile(root,file)))};
    const installed={path:'.harness/run.mjs',bytes:10,sha256:'b'.repeat(64)};
    const receipt={targetFiles:[installed]},plan={operations:[{action:'write',path:installed.path,afterHash:installed.sha256}]};
    await run({root,baseline,receipt,plan});
  } finally {await rm(root,{recursive:true,force:true});}
}
test('pilot history admits subsequent feature, lifecycle, config and runtime maintenance without freezing it',async()=>{
  await pilotHistoryFixture(async input=>{
    const expected=await authenticatePilotHistory(input);
    await appendFile(path.join(input.root,'.harness/events.jsonl'),JSON.stringify({type:'feature.blocked',revision:166})+'\n');
    for(const [file,value] of Object.entries({'features.json':{revision:166,features:[{id:'new-feature',status:'blocked'}]},
      'continuity.json':{phase:'awaiting_resume',generation:22},'config.json':{policies:{maxAttempts:1}},'run.mjs':'newer runtime'})) {
      await writeFile(path.join(input.root,'.harness',file),typeof value==='string'?value:JSON.stringify(value));
    }
    assert.deepEqual(await authenticatePilotHistory({...input,expected}),expected);
    assert.equal(expected.scope,'completed-pilot-only');
  });
});
test('pilot history rejects altered historical evidence and truncated event prefixes',async()=>{
  await pilotHistoryFixture(async input=>{
    await writeFile(path.join(input.root,'.harness/evidence/completed.json'),'altered evidence');
    await assert.rejects(authenticatePilotHistory(input));
    await writeFile(path.join(input.root,'.harness/evidence/completed.json'),'sealed evidence');
    await writeFile(path.join(input.root,'.harness/events.jsonl'),'rewritten prefix\n');
    await assert.rejects(authenticatePilotHistory(input));
  });
});
test('pilot history rejects rewritten historical receipt and review pins',async()=>{
  await pilotHistoryFixture(async input=>{
    const expected=await authenticatePilotHistory(input);
    const changed=copy(input);changed.receipt.targetFiles[0].sha256='c'.repeat(64);
    await assert.rejects(authenticatePilotHistory(changed));
    expected.immutable[0].sha256='d'.repeat(64);
    await assert.rejects(authenticatePilotHistory({...input,expected}));
  });
});

test('nine completion authenticates exactly nine receipts with separate source and historical pilot',()=>{
  const scope=completionScope(),row=index=>({index,root:targets[index]});
  const report={kind:scope.kind,scope:scope.scope,holdCleared:false,targets:scope.indices.map(row),
    sourceReconciliation:row(0),historicalPilot:{...row(4),scope:'completed-pilot-only'}};
  validateCompletionScope(report);
  assert.equal(report.targets.length,9);assert.deepEqual(scope.currentIndices,[0,1,2,3,5,6,7,8,9,10]);
  assert.throws(()=>requireAllElevenClearance(report));
  for(const change of [r=>r.targets.push(row(4)),r=>r.targets.shift(),r=>r.scope=completionScope(true).scope,
    r=>r.holdCleared=true,r=>r.sourceReconciliation=row(4),r=>r.historicalPilot.scope='current-exo']) {
    const changed=copy(report);change(changed);assert.throws(()=>validateCompletionScope(changed));
  }
  assert.equal(completionScope(true).indices.length,11);
});

test('nine completion reviews current unrelated native state without relaxing target trust or later preservation',()=>{
  const {authority,summary}=nativeFixture([4]);summary.unrelatedSha256='b'.repeat(64);
  assert.throws(()=>validateNativeSet(summary,authority,[4],hash));
  const reviewed=continuationNativeAuthority(authority,summary);
  validateNativeSet(summary,reviewed,[4],hash);
  assert.equal(authority.nativeBaseline.unrelatedSha256,hash);
  for(const change of [value=>value.unrelatedSha256='c'.repeat(64),value=>value.trust['4-0']='changed',
    value=>value.definitions[0].definitionSha256='changed']) {
    const changed=copy(summary);change(changed);assert.throws(()=>validateNativeSet(changed,reviewed,[4],hash));
  }
});

test('current Exo policy requires both effective cap paths while admitting unrelated maintenance',async()=>{
  const runtime=await readFile(new URL('../skill/codex-harness/assets/project-runtime.mjs',import.meta.url),'utf8');
  const config={policies:{maxAttempts:5,maxRepeatedFailures:2},unrelated:'newer maintenance'};
  validateCurrentExoPolicy(runtime,config);
  assert.throws(()=>validateCurrentExoPolicy(runtime,{policies:{maxAttempts:23,maxRepeatedFailures:2}}));
  for(const broken of [runtime.replace('Math.min(globalMaxAttempts, featureMaxAttempts ?? globalMaxAttempts)','featureMaxAttempts ?? globalMaxAttempts'),
    runtime.replace('Math.min(budget.globalMaxAttempts, budget.featureMaxAttempts ?? budget.globalMaxAttempts)','budget.featureMaxAttempts ?? budget.globalMaxAttempts')]) {
    assert.throws(()=>validateCurrentExoPolicy(broken,config));
  }
});

function boundedDeferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

test('bounded inventory: real file handles stay within 16 and frozen inventory matches sealed ordering', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bounded-inventory-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  await mkdir(path.join(directory, 'inventory'));
  for (let index = 0; index < 67; index++) {
    await writeFile(path.join(directory, 'inventory', `file-${index}.json`), `${index}\n`);
  }
  const paths = await regularInventoryPaths(directory, 'inventory');
  let active = 0, peak = 0, batch = [];
  const values = await mapBounded(paths, async (relative, index) => {
    const handle = await open(path.join(directory, relative), 'r');
    active++;
    peak = Math.max(peak, active);
    const release = boundedDeferred();
    batch.push(release.resolve);
    if (batch.length === Math.min(16, paths.length - Math.floor(index / 16) * 16)) {
      const ready = batch; batch = [];
      queueMicrotask(() => ready.reverse().forEach(resolve => resolve()));
    }
    try { await release.promise; return await handle.readFile('utf8'); }
    finally { await handle.close(); active--; }
  });
  assert.equal(peak, 16);
  assert.equal(active, 0);
  assert.deepEqual(values, await Promise.all(paths.map(relative => readFile(path.join(directory, relative), 'utf8'))));
  assert.deepEqual(await freezeInventoryBounded(directory, 'inventory'), await freezeInventory(directory, 'inventory'));
});

test('bounded inventory: bounds active work to 16 and preserves input order despite reversed completion', {timeout:2000}, async () => {
  const inputs = Array.from({length:67}, (_, index) => index);
  let active = 0, peak = 0;
  const started = [], completed = [];
  let batch = [];
  const output = await mapBounded(inputs, (value, index) => {
    started.push(index);
    active += 1;
    peak = Math.max(peak, active);
    const gate = boundedDeferred();
    batch.push(() => gate.resolve(value * 3));
    if (batch.length === 16 || index === inputs.length - 1) {
      const finishing = batch;
      batch = [];
      queueMicrotask(() => { for (const finish of finishing.reverse()) finish(); });
    }
    return gate.promise.then(result => {
      active -= 1;
      completed.push(index);
      return result;
    });
  });
  assert.equal(peak, 16);
  assert.equal(active, 0);
  assert.deepEqual(started, inputs);
  assert.deepEqual(completed.slice(0, 16), inputs.slice(0, 16).reverse());
  assert.deepEqual(output, inputs.map(value => value * 3));
});

async function boundedFailedBatch({synchronous}) {
  const failure = new Error(synchronous ? 'synchronous callback failure' : 'asynchronous callback failure');
  const started = [], finished = [];
  const releases = [], allStarted = boundedDeferred();
  let rejected = false;
  const result = mapBounded(Array.from({length:48}, (_, index) => index), index => {
    started.push(index);
    if (started.length === 16) allStarted.resolve();
    if (index === 3) {
      if (synchronous) {
        finished.push(index);
        throw failure;
      }
      return Promise.resolve().then(() => { throw failure; }).finally(() => { finished.push(index); });
    }
    const gate = boundedDeferred();
    releases.push(gate.resolve);
    return gate.promise.finally(() => { finished.push(index); });
  });
  // Attach rejection handling immediately, while the started batch is held open.
  const outcome = result.then(
    () => ({unexpectedSuccess:true}),
    error => { rejected = true; return {error}; }
  );
  await allStarted.promise;
  await boundedImmediate();
  assert.equal(rejected, false, 'must not reject before outstanding operations settle');
  assert.equal(started.length, 16);
  assert.deepEqual(finished, [3]);
  releases.forEach(resolve => resolve());
  const settled = await outcome;
  assert.equal(settled.error, failure);
  assert.equal(rejected, true);
  assert.deepEqual(finished.slice().sort((a,b) => a-b), Array.from({length:16}, (_, index) => index));
  assert.deepEqual(started, Array.from({length:16}, (_, index) => index), 'later batches must never start');
}

test('bounded inventory: synchronous throw drains every started operation before rejection', {timeout:2000}, async () => {
  await boundedFailedBatch({synchronous:true});
});

test('bounded inventory: asynchronous failure drains its batch and never starts future batches', {timeout:2000}, async () => {
  await boundedFailedBatch({synchronous:false});
});


test('original all-eleven binding rejects a nine-only deployment result through both authenticators', async t => {
  const f = await diskFixture(t);
  const originalReportPath = completionScope(true).reportPath;
  const nineScope = completionScope();
  const row = index => ({index, root:targets[index]});
  const nineReport = {kind:nineScope.kind, scope:nineScope.scope, holdCleared:false,
    targets:nineScope.indices.map(row), sourceReconciliation:row(0),
    historicalPilot:{...row(4), scope:'completed-pilot-only'}};
  validateCompletionScope(nineReport);
  await f.write(nineScope.reportPath, nineReport);
  const nineReportRef = await pinFile(f.root, nineScope.reportPath);
  const originalState = await pinFile(f.root, '.harness/features.json');
  for (const authenticate of [authenticateBindings, authenticateContinuationBindings]) {
    const valid = await authenticate({...f, deployment:async () => copy(f.deployed)});
    assert.equal(valid.deployment.report.path, originalReportPath);
    await assert.rejects(authenticate({...f, deployment:async () => ({...copy(f.deployed), report:nineReportRef})}),
      {code:'ERR_ASSERTION', actual:nineScope.reportPath, expected:originalReportPath});
  }
  assert.deepEqual(await pinFile(f.root, '.harness/features.json'), originalState);
});

test('bounded continuation gate verifies once and retains every historical fixture file', async t => {
  const f = await diskFixture(t);
  const retained = ['.harness/evidence/old-selected.json', '.harness/evidence/old-other.json',
    '.harness/evidence/unreferenced.json', '.harness/logs/old.stdout.log',
    '.harness/logs/old.stderr.log', '.harness/logs/unreferenced.log'];
  const beforePins = [];
  for (const relative of retained) beforePins.push(await pinFile(f.root, relative));
  const modes = [];
  f.deployment = async () => {
    const inventory = await authenticateContinuationGateInventory(f.root);
    modes.push(inventory?.mode ?? 'pre');
    return copy(f.deployed);
  };
  f.pendingMutation = async (_, {before}) => {
    assert.equal((await authenticateContinuationGateInventory(f.root)).mode, 'pending');
    assert.deepEqual(await authenticateContinuationBindings(f), before.bindings);
  };
  let invocations = 0;
  const result = await runContinuationGateWorkflow({...f, invoke:async args => {
    invocations++;
    return (await fixtureVerification(f, args)).invocation;
  }});
  assert.equal(invocations, 1);
  assert.equal(result.pass, true);
  assert.equal(result.featureId, rolloutFeatureId);
  assert(modes.includes('pending'));
  assert(modes.includes('completed'));
  for (const ref of beforePins) await authenticateFile(f.root, ref);
  const after = (await readJson(f.root, '.harness/features.json')).features.find(row => row.id === rolloutFeatureId);
  assert.equal(after.status, 'passing');
  assert.equal(after.attempts, f.feature.attempts + 1);
  const receipt = await readJson(f.root, receiptPath);
  assert.deepEqual(receipt.bindings.deployment.report, f.deployed.report);
});

test('bounded continuation gate refuses changed historical inventory without a receipt or retry', async t => {
  const f = await diskFixture(t);
  f.deployment = async () => {
    await authenticateContinuationGateInventory(f.root);
    return copy(f.deployed);
  };
  let invocations = 0;
  await assert.rejects(runContinuationGateWorkflow({...f, invoke:async args => {
    invocations++;
    const result = await fixtureVerification(f, args);
    // This file is intentionally unreferenced by any feature; complete inventory
    // preservation must still detect a change before sealing the gate receipt.
    await f.write('.harness/evidence/unreferenced.json', {tampered:true, longerThanOriginal:true});
    return result.invocation;
  }}), /Reference (?:size|bytes) changed/);
  assert.equal(invocations, 1);
  await assert.rejects(readJson(f.root, receiptPath), {code:'ENOENT'});
  assert(await readJson(f.root, `${gateDirectory}/invocation.json`), 'retain the actual failed outcome');
});
