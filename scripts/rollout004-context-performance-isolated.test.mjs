import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {assertCloneDelta,composeCloneApproval,canonicalTransition,assertPhaseTransition,recordNativeRpc,containedCommand,isolatedEnvironment,phaseControllerEnvironment,buildPhaseReport} from './rollout004-context-performance-isolated.mjs';
import {assertNestedDelta,assertConfigDelta} from './rollout004-context-performance-authority.mjs';
import * as A from './rollout004-context-performance-authority.mjs';
import {verifyIsolatedCompletion} from './verify-rollout004-context-performance.mjs';
import {configProjection} from './rollout004-context-performance.mjs';

async function temporary(t){
 const root=await mkdtemp(path.join(tmpdir(),'rollout004-isolated-test-'));
 assert(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep));
 t.after(()=>rm(root,{recursive:true,force:true}));return root;
}
function initialSnapshot(){
 const events=[['SessionStart','sessionStart'],['PreToolUse','preToolUse'],['PreCompact','preCompact'],['Stop','stop'],['UserPromptSubmit','userPromptSubmit'],['PostToolUse','postToolUse']];
 const nativeDefinitions=events.map(([configEvent,eventName],index)=>({key:`managed-${configEvent}`,eventName,currentHash:`sha256:${hashText('hook-'+index)}`,trustedHash:`sha256:${hashText('hook-'+index)}`,trustStatus:'trusted',command:`node hook-${index}.mjs`,matcher:'',statusMessage:`status-${index}`}));
 const canonical={hooks:{PreCompact:[{matcher:'',hooks:[{type:'command',command:'node precompact.mjs',statusMessage:'original'}]}],Stop:[{hooks:[{type:'command',command:'node stop.mjs'}]}]}};
 return {sourceRuntime:'runtime-before',installedRuntime:'runtime-before',bootstrap:'bootstrap-constant',canonical,installed:structuredClone(canonical),nativeDefinitions,nativeConfig:{hooks:{state:Object.fromEntries(nativeDefinitions.map(item=>[item.key,{trusted_hash:item.currentHash,enabled:true}]))},other:'keep'},nativeConfigSha256:'config-before'};
}
function canonicalSnapshot(before){
 const after=structuredClone(before);after.canonical=JSON.parse(canonicalTransition(JSON.stringify(before.canonical)));after.installed=structuredClone(after.canonical);
 const precompact=after.nativeDefinitions.find(item=>item.eventName==='preCompact');
 precompact.currentHash='sha256:'+hashText('precompact-current-after');precompact.trustedHash=precompact.currentHash;
 precompact.statusMessage=after.canonical.hooks.PreCompact[0].hooks[0].statusMessage;
 after.nativeConfig.hooks.state[precompact.key].trusted_hash=precompact.currentHash;after.nativeConfigSha256='config-after';return after;
}

const runtimePath='skill/codex-harness/assets/project-runtime.mjs';
const templatePath='skill/codex-harness/assets/codex-hooks.json.template';
const hashText=text=>A.sha(Buffer.from(text));
const successfulOutcome=()=>({exitCode:0,confirmed:true,timedOut:false,signal:null,controllerExitCode:0});

function fixtureReceipts(after,before,write){
 const receipts=[];let id=0;
 const add=(method,request,response,boundary)=>{
  const rpcId=++id;
  receipts.push({stage:'request',id:rpcId,method,...request},{stage:'response',id:rpcId,method,resultSha256:A.digest({ok:true}),...response},{stage:'raw-boundary',id:rpcId,method,...boundary});
 };
 const oldHash=write?(before?.nativeConfigSha256??hashText('untrusted initial native config')):after.nativeConfigSha256;
 const version='fixture-layer-v1';
 const keys=Object.keys(after.nativeConfig.hooks.state),prior=structuredClone(before?.nativeConfig??after.nativeConfig);if(write&&!before)for(const def of after.nativeDefinitions)prior.hooks.state[def.key].trusted_hash=null;
 const proposal=configProjection(after.nativeConfig,keys);
 add('hooks/list',{}, {definitions:structuredClone(after.nativeDefinitions)},{beforeSha256:oldHash,afterSha256:oldHash,readStable:true});
 add('config/read',{includeLayers:true},{layer:{version,...configProjection(prior,keys)}},{beforeSha256:oldHash,afterSha256:oldHash,readStable:true});
 if(write)add('config/batchWrite',{readReceiptId:2,proposal,reloadUserConfig:true,expectedVersion:version,beforeSha256:oldHash,edits:[{keyPath:'hooks.state',mergeStrategy:'replace',valueSha256:A.digest(after.nativeConfig.hooks.state)}]},{},{beforeSha256:oldHash,afterSha256:after.nativeConfigSha256});
 add('config/read',{includeLayers:true},{layer:{version:'fixture-layer-v2',...proposal}},{beforeSha256:after.nativeConfigSha256,afterSha256:after.nativeConfigSha256,readStable:true});
 const discovery={data:[{hooks:structuredClone(after.nativeDefinitions)}]};
 add('hooks/list',{}, {discovery,definitions:discovery.data[0].hooks,resultSha256:A.digest(discovery)},{beforeSha256:after.nativeConfigSha256,afterSha256:after.nativeConfigSha256});
 return receipts;
}

function completionFixture(){
 const objects=new Map();
 const ref=(name,value)=>{
  objects.set(name,value);
  const reference={path:name,bytes:Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value)),sha256:typeof value==='string'?hashText(value):A.digest(value)};
  return reference;
 };
 const authority={sourceGate:structuredClone(A.sourceGatePin)};
 objects.set(authority.sourceGate.path,{});
 const initial=initialSnapshot();
 initial.nativeConfig.hooks.state['managed-PreCompact'].aux={source:'keep',nested:{enabled:false}};
 initial.nativeConfig.hooks.state['unrelated-managed-entry']={trusted_hash:'sha256:'+hashText('unrelated-hash'),enabled:false,aux:{keep:true}};
 const runtimeText='fixture runtime',templateText=JSON.stringify(initial.canonical);
 const baseline={[runtimePath]:hashText(runtimeText),[templatePath]:hashText(templateText),'guarded.mjs':hashText('guarded')};
 const runtimeNext=hashText(runtimeText+'\n// rollout004 isolated runtime transition\n');
 const templateNext=hashText(canonicalTransition(templateText));
 const allowed=[{path:runtimePath,beforeHash:baseline[runtimePath],afterHash:runtimeNext},{path:templatePath,beforeHash:baseline[templatePath],afterHash:templateNext}];
 initial.sourceRuntime=initial.installedRuntime=baseline[runtimePath];initial.nativeConfigSha256=A.digest(initial.nativeConfig);
 const runtime=structuredClone(initial);runtime.sourceRuntime=runtime.installedRuntime=runtimeNext;
 const canonical=canonicalSnapshot(runtime);canonical.nativeConfigSha256=A.digest(canonical.nativeConfig);
 const snapshots=[initial,runtime,canonical],reports=[];
 const inputs={baseline,runtimeText,templateText,canonical:structuredClone(initial.canonical),reviewDiscovery:(discovery,installed,canon)=>{assert.deepEqual(installed,canon);return discovery.data.flatMap(item=>item.hooks??[]);}};
 const phases=['initial','runtime','canonical'].map((phase,index)=>{
  const after=snapshots[index],before=index?snapshots[index-1]:null;
  const current=structuredClone(baseline);if(index>0)current[runtimePath]=runtimeNext;if(index>1)current[templatePath]=templateNext;
  const start=Date.UTC(2026,0,1)+index*20000;
  const startedAt=new Date(start).toISOString(),finishedAt=new Date(start+10000).toISOString();
  const tests={args:['.harness/run.mjs','bootstrap','--validate','--json'],outcome:successfulOutcome(),stdout:ref(`${phase}/bootstrap.stdout`,''),stderr:ref(`${phase}/bootstrap.stderr`,''),startedAt:new Date(start+2000).toISOString(),finishedAt:new Date(start+3000).toISOString()};
  const report=buildPhaseReport({phase,authority,clone:{baseline:structuredClone(baseline),allowed:structuredClone(allowed.slice(0,index)),current},before:structuredClone(before),after:structuredClone(after),receipts:fixtureReceipts(after,before,index!==1),tests,nativeClose:{confirmed:true}});
  reports.push(report);const reportRef=ref(`${phase}/report.json`,report);
  return {phase,report:reportRef,stdout:ref(`${phase}/stdout`,''),stderr:ref(`${phase}/stderr`,''),args:['scripts/rollout004-context-performance-isolated.mjs','--phase',phase,'--report',reportRef.path],cwd:A.sourceRoot,outcome:successfulOutcome(),startedAt,finishedAt};
 });
 const authenticate=async reference=>{
  assert(reference&&objects.has(reference.path),`unregistered ref ${reference?.path}`);
  if(reference.path===authority.sourceGate.path){assert.deepEqual(reference,A.sourceGatePin);return objects.get(reference.path);}
  const value=objects.get(reference.path),bytes=Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value));
  assert.equal(reference.bytes,bytes,'authenticated reference size changed');
  assert.equal(reference.sha256,typeof value==='string'?hashText(value):A.digest(value),'authenticated reference digest changed');
  return value;
 };
 const deps={authenticate,json:async reference=>{assert(objects.has(reference.path));return objects.get(reference.path);},currentAuthority:async()=>authority,cloneProofInputs:async()=>inputs};
 return {completion:{version:1,kind:'rollout004-isolated-three-phase',status:'passed',phases},reports,deps,snapshots,objects,inputs};
}

function resealFixtureReports(fixture){
 for(const record of fixture.completion.phases){
  const report=fixture.objects.get(record.report.path);if(!report)continue;
  record.report.bytes=Buffer.byteLength(JSON.stringify(report));record.report.sha256=A.digest(report);
 }
}

test('authenticated three-phase completion accepts successful nested bootstrap evidence',async()=>{
 const fixture=completionFixture();
 assert.equal(fixture.reports[0].tests.exitCode,undefined);
 assert.deepEqual(await verifyIsolatedCompletion(fixture.completion,fixture.deps),{pass:true,phases:3});
});

test('three-phase completion rejects failed, timed out or unconfirmed nested bootstrap evidence',async t=>{
 for(const [name,changes,message] of [['failed',{exitCode:1},/command exit failed/],['timed out',{timedOut:true},/command timed out/],['unconfirmed',{confirmed:false},/command termination unconfirmed/],['controller failed',{controllerExitCode:1},/controller exit failed/],['signalled',{signal:'SIGTERM'},/command signalled/]])await t.test(name,async()=>{
  const fixture=completionFixture();Object.assign(fixture.reports[1].tests.outcome,changes);resealFixtureReports(fixture);
  await assert.rejects(verifyIsolatedCompletion(fixture.completion,fixture.deps),message);
 });
});

test('three-phase completion binds clone changes, snapshot chain, digests, order and evidence',async t=>{
 const cases=[
  ['phase order',f=>f.completion.phases.reverse(),/Isolated phase order changed/],
  ['clone baseline',f=>{f.reports[1].clone.baseline['guarded.mjs']=hashText('other baseline');},/Clone baseline changed/],
  ['clone delta',f=>{f.reports[1].clone.current['guarded.mjs']=hashText('drift');},/Unapproved isolated kit delta/],
  ['before snapshot',f=>{f.reports[1].before=null;},/Before snapshot chain changed/],
  ['after snapshot',f=>{f.reports[1].after.sourceRuntime=f.reports[0].after.sourceRuntime;},/Snapshot runtime differs from clone/],
  ['chained snapshot',f=>{f.reports[2].before.bootstrap='other-bootstrap';},/Before snapshot chain changed/],
  ['actual change required',f=>{f.reports[1].canonicalChange=f.reports[1].actualChange;delete f.reports[1].actualChange;},/Actual change required/],
  ['actual before digest',f=>{f.reports[1].actualChange.beforeSha256=hashText('wrong');},/Actual snapshot change digest differs/],
  ['actual after digest',f=>{f.reports[1].actualChange.afterSha256=hashText('wrong');},/Actual snapshot change digest differs/],
  ['outer controller failure',f=>{f.completion.phases[1].outcome.exitCode=1;},/command exit failed/],
  ['phase time',f=>{f.completion.phases[1].finishedAt=f.completion.phases[1].startedAt;},/Bootstrap timestamps outside phase/],
  ['phase stdout authentication',f=>{f.completion.phases[0].stdout.sha256=hashText('wrong');},/authenticated reference digest changed/],
  ['bootstrap stderr missing',f=>{f.reports[0].tests.stderr={path:'missing'};},/unregistered ref missing/],
  ['report missing',f=>{f.completion.phases[0].report={path:'missing'};},/unregistered ref missing/],
  ['native close unconfirmed',f=>{f.reports[0].nativeClose.confirmed=false;},/Native close unconfirmed/],
 ];
 for(const [name,corrupt,message] of cases)await t.test(name,async()=>{const fixture=completionFixture();corrupt(fixture);resealFixtureReports(fixture);await assert.rejects(verifyIsolatedCompletion(fixture.completion,fixture.deps),message);});
});

test('three-phase completion requires native write counts of one, zero, one',async t=>{
 for(const index of [0,1,2])await t.test(['initial','runtime','canonical'][index],async()=>{
  const fixture=completionFixture(),report=fixture.reports[index];report.receipts=fixtureReceipts(report.after,report.before,index===1);resealFixtureReports(fixture);
  await assert.rejects(verifyIsolatedCompletion(fixture.completion,fixture.deps),/Isolated phase native write count differs/);
 });
});

test('three-phase completion requires authenticated discovery and trusted hash status',async t=>{
 const cases=[
  ['discovery contents',f=>{f.reports[2].receipts.filter(item=>item.stage==='response'&&item.method==='hooks/list').at(-1).discovery.data[0].hooks[0].command='wrong';},/Native discovery digest differs/],
  ['approved status',f=>{f.reports[0].after.nativeDefinitions[2].trustStatus='approved';},/Native definitions must be trusted/],
  ['definition trusted hash',f=>{f.reports[2].after.nativeDefinitions[2].trustedHash='stale';},/Definition trustedHash differs/],
  ['state trusted hash',f=>{f.reports[2].after.nativeConfig.hooks.state['managed-PreCompact'].trusted_hash='stale';},/Native trust must bind/],
 ];
 for(const [name,corrupt,message] of cases)await t.test(name,async()=>{const fixture=completionFixture();corrupt(fixture);resealFixtureReports(fixture);await assert.rejects(verifyIsolatedCompletion(fixture.completion,fixture.deps),message);});
});

test('native child environment strips ambient identity and secrets while the genuine controller retains its thread',()=>{
 const keys=['CODEX_THREAD_ID','CODEX_SESSION_ID','ROLLOUT_FIXTURE_API_KEY'];
 const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try{
  process.env.CODEX_THREAD_ID='fixture-controller-thread';process.env.CODEX_SESSION_ID='fixture-shared-session';process.env.ROLLOUT_FIXTURE_API_KEY='fixture-only-secret';
  const native=isolatedEnvironment('fixture-home');
  assert.equal(native.CODEX_HOME,'fixture-home');for(const key of keys)assert.equal(native[key],undefined);
  assert.equal(phaseControllerEnvironment('fixture-home').CODEX_THREAD_ID,undefined);
  const controller=phaseControllerEnvironment('fixture-home',true);
  assert.equal(controller.CODEX_THREAD_ID,'fixture-controller-thread');assert.equal(controller.CODEX_SESSION_ID,undefined);assert.equal(controller.ROLLOUT_FIXTURE_API_KEY,undefined);
  delete process.env.CODEX_THREAD_ID;assert.throws(()=>phaseControllerEnvironment('fixture-home',true),/Native controller identity required/);
 }finally{for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
});

test('canonical phase preserves all trust state beyond the reviewed PreCompact hash',()=>{
 const before=initialSnapshot();
 before.nativeConfig.hooks.state['managed-PreCompact'].operatorNote={reviewed:true};
 before.nativeConfig.hooks.state['unmanaged-extra']={trusted_hash:'extra-hash',enabled:false,operatorNote:'keep'};
 const after=canonicalSnapshot(before);assertPhaseTransition('canonical',before,after);
 const messages=[...Array(6).fill(/Only the canonical PreCompact trusted_hash may change/),/Native definitions must be trusted/,/Definition trustedHash differs/,/Native trust must bind/];
 for(const [index,corrupt] of [value=>{value.nativeConfig.hooks.state['managed-PreCompact'].enabled=false;},value=>{delete value.nativeConfig.hooks.state['managed-PreCompact'].operatorNote;},value=>{value.nativeConfig.hooks.state['managed-PreCompact'].operatorNote.reviewed=false;},value=>{delete value.nativeConfig.hooks.state['unmanaged-extra'];},value=>{value.nativeConfig.hooks.state['unmanaged-extra'].enabled=true;},value=>{value.nativeConfig.other='changed';},value=>{value.nativeDefinitions[2].trustStatus='approved';},value=>{value.nativeDefinitions[2].trustedHash='stale';},value=>{value.nativeConfig.hooks.state['managed-PreCompact'].trusted_hash='stale';}].entries()){
  const bad=structuredClone(after);corrupt(bad);assert.throws(()=>assertPhaseTransition('canonical',before,bad),messages[index]);
 }
});

test('clone delta requires exact paths, approved bytes and matching preimages',()=>{
 const baseline={'package.json':'package','skill/codex-harness/assets/project-runtime.mjs':'before','bin/agent-harness.mjs':'cli'};
 const allowed=[{path:'skill/codex-harness/assets/project-runtime.mjs',beforeHash:'before',afterHash:'after'}];
 const updated={...baseline,[allowed[0].path]:'after'};assert.equal(assertCloneDelta(baseline,updated,allowed),true);
 assert.throws(()=>assertCloneDelta(baseline,{...updated,'bin/agent-harness.mjs':'drift'},allowed));
 assert.throws(()=>assertCloneDelta(baseline,{...updated,'skill/extra.mjs':'new'},allowed));
 assert.throws(()=>assertCloneDelta(baseline,updated,[{...allowed[0],beforeHash:'wrong'}]));
 assert.throws(()=>assertCloneDelta(baseline,{...updated,[allowed[0].path]:'wrong'},allowed));
});

test('clone approval retains guarded SOURCE verification and checks clone changes around RPC',async()=>{
 const sourceRoot=path.resolve('source-fixture'),kit=path.resolve('clone-fixture');let cloneValid=true,sourceValid=true,rpcCalls=0;const events=[];
 const validateClone=async()=>{events.push('clone');assert(cloneValid,'clone drift');};
 const approval={verifySource:async root=>{events.push('source');assert.equal(root,sourceRoot);assert(sourceValid,'source drift');},rpc:async method=>{rpcCalls++;events.push('rpc');return {method};}};
 const composed=await composeCloneApproval({approval,kit,sourceRoot,validateClone});
 assert.deepEqual(events,['clone','source','clone']);events.length=0;
 assert.deepEqual(await composed.rpc('hooks/list',{}),{method:'hooks/list'});
 assert(events.indexOf('source')<events.indexOf('rpc'));assert(events.lastIndexOf('source')>events.indexOf('rpc'));
 assert.equal(composed.runningSource,kit);assert.equal((await composed.verifySource(kit)).pass,true);
 await assert.rejects(composed.verifySource(sourceRoot));
 sourceValid=false;await assert.rejects(composed.rpc('hooks/list',{}),/source drift/);assert.equal(rpcCalls,1);sourceValid=true;
 cloneValid=false;await assert.rejects(composed.rpc('hooks/list',{}),/clone drift/);assert.equal(rpcCalls,1);
});

test('clone approval detects drift caused by a guarded RPC and never retries',async()=>{
 let valid=true,calls=0;
 const composed=await composeCloneApproval({kit:path.resolve('clone'),sourceRoot:path.resolve('source'),validateClone:async()=>assert(valid,'clone changed'),approval:{verifySource:async()=>{},rpc:async()=>{calls++;valid=false;return {};}}});
 await assert.rejects(composed.rpc('config/read',{}),/clone changed/);assert.equal(calls,1);
});

test('initial, runtime and canonical proofs preserve six trusted definitions and their boundaries',()=>{
 const initial=initialSnapshot();assert.equal(assertPhaseTransition('initial',null,initial),true);
 const runtime=structuredClone(initial);runtime.sourceRuntime='runtime-after';runtime.installedRuntime='runtime-after';
 assert.equal(assertPhaseTransition('runtime',initial,runtime),true);
 const canonical=canonicalSnapshot(runtime);assert.equal(assertPhaseTransition('canonical',runtime,canonical),true);
 const untrusted=structuredClone(initial);untrusted.nativeDefinitions[0].trustStatus='untrusted';assert.throws(()=>assertPhaseTransition('initial',null,untrusted),/Native definitions must be trusted/);
 const missing=structuredClone(initial);missing.nativeDefinitions.pop();assert.throws(()=>assertPhaseTransition('initial',null,missing),/Exactly six native definitions required/);
 const stale=structuredClone(canonical);stale.nativeConfig.hooks.state['managed-PreCompact'].trusted_hash='old-hash';assert.throws(()=>assertPhaseTransition('canonical',runtime,stale),/Native trust must bind/);
 const wrongNamespace=structuredClone(runtime);wrongNamespace.nativeDefinitions[2].eventName='PreCompact';assert.throws(()=>assertPhaseTransition('canonical',wrongNamespace,canonical),/Exactly one preCompact native definition required/);
});

test('runtime phase refuses config, canonical definitions, bootstrap or installed source drift',()=>{
 const before=initialSnapshot();const after=structuredClone(before);after.sourceRuntime='new';after.installedRuntime='new';
 const messages=[/Runtime phase changed native config/,/Installed canonical definitions differ/,/Bootstrap changed during phase/,/Installed runtime differs from source/,/Runtime phase changed native definitions/];
 for(const [index,corrupt] of [value=>{value.nativeConfig.other='changed';},value=>{value.canonical.hooks.Stop[0].hooks[0].command='changed';},value=>{value.bootstrap='changed';},value=>{value.installedRuntime='unmatched';},value=>{value.nativeDefinitions[0].matcher='changed';}].entries()){
  const bad=structuredClone(after);corrupt(bad);assert.throws(()=>assertPhaseTransition('runtime',before,bad),messages[index]);
 }
 assert.throws(()=>assertPhaseTransition('runtime',before,before),/Runtime phase requires changed source/);
});

test('canonical phase changes only PreCompact status and its actual trust hash',()=>{
 const before=initialSnapshot(),after=canonicalSnapshot(before);
 const messages=[/Native trust must bind/,/Canonical phase changed unrelated native definitions/,/Canonical phase changed unrelated native definitions/,/Native trust must bind/,/Canonical phase changed unrelated native definitions/,/Only the canonical PreCompact trusted_hash may change/,/Installed runtime differs from source/,/Bootstrap changed during phase/];
 for(const [index,corrupt] of [value=>{value.nativeDefinitions[0].currentHash='other-hash';},value=>{value.nativeDefinitions[0].statusMessage='other-status';},value=>{value.nativeDefinitions[2].command='other-command';},value=>{value.nativeDefinitions[2].key='other-key';},value=>{value.nativeDefinitions[2].matcher='other-matcher';},value=>{value.nativeConfig.hooks.state['managed-Stop'].enabled=false;},value=>{value.sourceRuntime='other-runtime';},value=>{value.bootstrap='other-bootstrap';}].entries()){
  const bad=structuredClone(after);corrupt(bad);assert.throws(()=>assertPhaseTransition('canonical',before,bad),messages[index]);
 }
 assert.throws(()=>assertPhaseTransition('canonical',before,before),/Canonical phase status change differs/);
});

test('parent preservation admits only the reviewed child bytes at translated exact paths',()=>{
 const prefix='.local/agent-harness-kit/';const before={'README.md':'parent', '.local/agent-harness-kit/.harness/run.mjs':'old', '.local/agent-harness-kit/unmanaged.txt':'keep'};
 const authorized=[{path:'.harness/run.mjs',action:'update',beforeHash:'old',afterHash:'new'}];
 const after={...before,[prefix+'.harness/run.mjs']:'new'};assertNestedDelta(before,after,{prefix,authorized});
 for(const bad of [{...after,'README.md':'drift'},{...after,[prefix+'unmanaged.txt']:'drift'},{...after,[prefix+'.harness/run.mjs']:'wrong'},{...after,[prefix+'extra.mjs']:'unreviewed'}])assert.throws(()=>assertNestedDelta(before,bad,{prefix,authorized}));
 assert.throws(()=>assertNestedDelta(before,after,{prefix,authorized:[{...authorized[0],beforeHash:'wrong'}]}));
});

test('config comparison accepts only the two policy fields and an absent false default',()=>{
 const before={version:1,policies:{maxAttempts:3,maxRepeatedFailures:1,commandTimeoutMs:600000},context:{mode:'keep'}};
 const after=structuredClone(before);after.policies.maxAttempts=5;after.policies.maxRepeatedFailures=2;after.context.codexCodeModeResultSuppressionConfirmed=false;
 assert.equal(assertConfigDelta(before,after).defaultAdded,true);
 for(const corrupt of [value=>{value.context.codexCodeModeResultSuppressionConfirmed=true;},value=>{value.policies.commandTimeoutMs=1;},value=>{value.context.mode='changed';}]){const bad=structuredClone(after);corrupt(bad);assert.throws(()=>assertConfigDelta(before,bad));}
 for(const existing of [true,false]){const established=structuredClone(before);established.context.codexCodeModeResultSuppressionConfirmed=existing;const bad=structuredClone(established);bad.context.codexCodeModeResultSuppressionConfirmed=!existing;assert.throws(()=>assertConfigDelta(established,bad));}
});

test('native RPC binds enrollment to the read user layer version and exact raw config bytes',async t=>{
 const home=await temporary(t),filePath=path.join(home,'config.toml');await writeFile(filePath,'initial config');let calls=0,validations=0;const receipts=[];
 const client={rpc:async method=>{calls++;if(method==='config/read')return {layers:[{name:{type:'user',file:filePath},version:'base-v1',config:{hooks:{state:{}}}}]};return {ok:true};}};
 const rpc=await recordNativeRpc({client,home,receipts,validate:async()=>{validations++;}});
 await rpc('config/read',{includeLayers:true});
 const params={filePath,expectedVersion:'base-v1',reloadUserConfig:true,edits:[{keyPath:'hooks.state',mergeStrategy:'replace',value:{managed:{trusted_hash:'sha256:'+hashText('current-hash')}}}]};
 await rpc('config/batchWrite',params);assert.equal(calls,2);assert.equal(validations,4);
 const request=receipts.find(item=>item.stage==='request'&&item.method==='config/batchWrite');assert.equal(request.expectedVersion,'base-v1');assert(request.edits[0].valueSha256);
 await assert.rejects(rpc('config/batchWrite',{...params,expectedVersion:'stale'}));assert.equal(calls,2);
 await writeFile(filePath,'external drift');await assert.rejects(rpc('config/batchWrite',params));assert.equal(calls,2);
 await assert.rejects(rpc('unapproved/method',{}));assert.equal(calls,2);
});

test('unknown native RPC outcomes are recorded and remain single attempts',async t=>{
 const home=await temporary(t),receipts=[];let calls=0;
 const rpc=await recordNativeRpc({home,receipts,validate:async()=>{},client:{rpc:async()=>{calls++;throw new Error('unknown external outcome');}}});
 await assert.rejects(rpc('hooks/list',{}),/unknown external outcome/);assert.equal(calls,1);
 assert.deepEqual(receipts.map(item=>item.stage),['request','failure']);assert(receipts[1].errorSha256);
});

test('isolated command closes captures and preserves unknown termination and exit 75 evidence',async t=>{
 for(const [name,outcome] of [['unknown',{confirmed:false,exitCode:0,timedOut:false}],['rotation',{confirmed:true,exitCode:75,timedOut:false}]])await t.test(name,async childTest=>{
  const cwd=await temporary(childTest);let calls=0;
  const command=(_text,_cwd,_env,deadline)=>{
   calls++;assert.equal(deadline,257);const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
   const done=new Promise(resolve=>queueMicrotask(()=>{child.stderr.emit('data',Buffer.from(name));resolve(outcome);if(outcome.confirmed)child.emit('close',outcome.exitCode,null);}));
   return {child,done,cancel:()=>assert.fail('unexpected cancellation')};
  };
  await assert.rejects(containedCommand(['fixture.mjs'],{cwd,home:cwd,logPrefix:path.join(cwd,'capture'),timeoutMs:257,command}),error=>{
   assert(error.invocation);assert.equal(error.invocation.outcome.confirmed,outcome.confirmed);if(name==='rotation')assert.equal(error.exitCode,75);return true;
  });
  assert.equal(calls,1);assert.equal(await readFile(path.join(cwd,'capture.stderr.log'),'utf8'),name);
 });
});
