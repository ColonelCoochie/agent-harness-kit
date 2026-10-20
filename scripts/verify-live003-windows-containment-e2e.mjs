import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {reportPath,selectedReport,explicitReport,artifactDirectory,sourceRoot,sha,authenticateRecovery} from './live003-windows-containment-e2e.mjs';
import {inspectReportLocation} from './native-hook-report-selection.mjs';
import {snapshot,stable,verifyWindowsContainmentGate} from './source-windows-containment-authority.mjs';
import {authenticateHelperFreeze,authenticateSuccessorSelection,assertSelectedReportBindings, assertInstalledInventory, assertArtifactStringReferences} from './live003-windows-containment-gate.mjs';
import {assertConfigReceiptBindings,assertConfirmedTermination} from './live003-windows-containment-e2e.mjs';
import {canonicalCodexHooks,reviewNativeDefinitions} from '../skill/codex-harness/scripts/lib/hook-policy.mjs';
export function assertHeaderPublication(worker,stream){
 const turnId=worker.turns?.[0]?.id??worker.turn?.id;
 const requestIndex=stream.findIndex(e=>e.kind==='request'&&e.method==='turn/start'&&e.threadId===worker.threadId);
 const completionIndex=stream.findIndex(e=>e.method==='turn/completed'&&e.threadId===worker.threadId&&e.turn?.id===turnId&&e.turn.status==='completed');
 const proofs=stream.filter(e=>e.kind==='transcriptHeaderProof'&&e.threadId===worker.threadId);assert.equal(proofs.length,1,'Exactly one native header observation');
 const proof=proofs[0],proofIndex=stream.indexOf(proof);assert(requestIndex>=0&&completionIndex>requestIndex&&proofIndex>completionIndex,'First native turn completes before header observation');
 const completed=stream[completionIndex];assert.equal(proof.turnId,turnId);assert.equal(proof.afterTurnCompletedEventIndex,completed.eventIndex);assert.deepEqual(proof.header,worker.header);
 assert.equal(worker.header.publishedAfterTurnId,turnId);assert.equal(worker.header.turnCompletedEventIndex,completed.eventIndex);assert.equal(worker.header.headerOnlyRead,true);
 const metadata=stream.find(e=>e.kind==='threadMetadata'&&e.id===worker.threadId);assert.equal(worker.header.path,metadata?.path,'Header uses the actual native transcript path');
 assert.equal(worker.header.type,'session_meta');assert.equal(worker.header.id,worker.threadId);assert.equal(worker.header.idMatchesExpected,true);assert.equal(worker.header.parentThreadId,null);
}
export function nativeCommandPayload(command){
 assert.equal(typeof command,'string');
 const wrapped=/^"([A-Za-z]:\\\\(?:[^"\\\r\n]+\\\\)*pwsh\.exe)"[ \t]+-Command[ \t]+'((?:[^']|'')*)'$/i.exec(command);
 if(wrapped)return wrapped[2].replace(/''/g,"'");
 // Unknown wrappers stay literal: they cannot match an exact delegated command,
 // and their complete text remains available to the earlier-mutation check.
 return command;
}
export function assertNativeHookPairs(worker,stream,definitions,fixture){
 const fixtureHooks=path.join(fixture,'.codex/hooks.json');
 const turns=worker.turns??[worker.turn];assert(turns.length>0);
 assert.equal(new Set(turns.map(turn=>turn.id)).size,turns.length);
 const events=stream.filter(event=>event.kind==='notification'||Object.hasOwn(event,'eventIndex')||['hook/started','hook/completed','turn/completed'].includes(event.method));
 assert(events.every(event=>Number.isSafeInteger(event.eventIndex)&&event.eventIndex>=0),'Every native notification needs a nonnegative safe integer index');
 assert(events.every((event,index)=>index===0||event.eventIndex>events[index-1].eventIndex),'Native notification indices must be unique and ordered');
 const groups=new Map();
 for(const event of stream.filter(event=>['hook/started','hook/completed'].includes(event.method))){
  assert.equal(event.threadId,worker.threadId);assert(turns.some(turn=>turn.id===event.turnId));
  const definitionsForEvent=definitions.filter(definition=>definition.eventName===event.run?.eventName);assert.equal(definitionsForEvent.length,1);
  const definition=definitionsForEvent[0],name=definition.eventName.replace(/[A-Z]/g,char=>'-'+char.toLowerCase());
  const prefix=`${name}:${definition.displayOrder}:${fixtureHooks}`;
  assert.equal(event.run.sourcePath,fixtureHooks);assert(typeof event.run.id==='string'&&(event.run.id===prefix||event.run.id.startsWith(prefix+':')),'Native hook ID must bind its reviewed canonical definition');
  const key=JSON.stringify([event.threadId,event.turnId,event.run.id]);const pair=groups.get(key)??{};
  const stage=event.method==='hook/started'?'started':'completed';assert(!pair[stage],'Duplicate native hook stage');pair[stage]=event;groups.set(key,pair);
 }
 const pairs=[...groups.values()];
 for(const pair of pairs){assert(pair.started&&pair.completed,'Every native hook needs a complete pair');assert(pair.started.eventIndex<pair.completed.eventIndex);assert.equal(pair.started.run.eventName,pair.completed.run.eventName);}
 const success=pair=>['completed','success'].includes(pair.completed.run.status);
 for(const turn of turns){
  assert.equal(turn.status,'completed');assert.equal(stream.filter(event=>event.method==='turn/completed'&&event.threadId===worker.threadId&&event.turn?.id===turn.id&&event.turn.status==='completed').length,1);
  for(const eventName of ['userPromptSubmit','stop'])assert(pairs.some(pair=>success(pair)&&pair.completed.turnId===turn.id&&pair.completed.run.eventName===eventName),'Paired native '+eventName+' for each completed turn');
 }
 for(const eventName of ['preToolUse','postToolUse'])assert(pairs.some(pair=>success(pair)&&pair.completed.run.eventName===eventName),'Paired native '+eventName);
 return pairs;
}
export {assertConfirmedTermination} from './live003-windows-containment-e2e.mjs';
export function assertConfigPhaseBindings(report,records){
 const labels=['before-enrollment','reviewed-readback','cleanup-readback'];assert.deepEqual(Object.keys(records),labels);
 assert.equal(report.projectKey,report.fixture.toLowerCase());
 assert.equal(report.definitions.length,6);assert.equal(new Set(report.definitions.map(definition=>definition.key)).size,6);
 const hooks=Object.fromEntries(report.definitions.map(definition=>{assert(typeof definition.key==='string'&&definition.key.length>0);assert(/^sha256:[a-f0-9]{64}$/.test(definition.currentHash));return [definition.key,definition.currentHash];}));
 const removed=Object.fromEntries(report.definitions.map(({key})=>[key,null]));
 const hash=value=>assert(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value));
 const phase=(label,methods,edits)=>{
  const record=records[label];assertConfigReceiptBindings(record);
  const requests=record.receipts.filter(receipt=>receipt.stage==='request');assert.deepEqual(requests.map(receipt=>receipt.method),methods,'Exact native config phase RPC plan');
  if(edits)assert.deepEqual(requests.find(receipt=>receipt.method==='config/batchWrite').edits.map(edit=>edit.keyPath),edits);
  return {reads:record.receipts.filter(receipt=>receipt.stage==='response'&&receipt.method==='config/read').map(receipt=>receipt.userLayers[0]),raw:record.receipts.filter(receipt=>receipt.stage==='raw-boundary')};
 };
 const enrolled=phase(labels[0],['config/read','config/batchWrite','config/read'],['projects']);
 const reviewed=phase(labels[1],['config/read']);
 const cleanup=phase(labels[2],['config/read','config/batchWrite','config/read'],['hooks.state','projects']);
 assert.deepEqual(enrolled.reads.map(read=>read.owned),[{projectTrust:null,hooks:{}},{projectTrust:'trusted',hooks:{}}]);
 assert.deepEqual(reviewed.reads[0].owned,{projectTrust:'trusted',hooks});
 assert.deepEqual(cleanup.reads.map(read=>read.owned),[{projectTrust:'trusted',hooks},{projectTrust:null,hooks:removed}]);
 for(const value of [report.nativeConfigBeforeHash,report.unrelatedBeforeHash,report.unrelatedEnrolledHash,report.cleanup.unrelatedBeforeHash,report.cleanup.unrelatedAfterHash,report.cleanup.finalConfigHash])hash(value);
 assert.equal(enrolled.reads[0].semanticSha256,report.nativeConfigBeforeHash);
 for(const read of [...enrolled.reads,...reviewed.reads])assert.equal(read.unrelatedSha256,report.unrelatedBeforeHash);
 assert.equal(report.unrelatedEnrolledHash,report.unrelatedBeforeHash);
 assert.equal(cleanup.reads[0].unrelatedSha256,report.cleanup.unrelatedBeforeHash);assert.equal(cleanup.reads[1].unrelatedSha256,report.cleanup.unrelatedAfterHash);assert.equal(report.cleanup.unrelatedBeforeHash,report.cleanup.unrelatedAfterHash);
 assert.equal(report.projectTrustPersisted,true);assert.equal(report.cleanup.nativeOwnedChangesRemoved,true);assert.equal(report.cleanup.freshReadback,true);
 assert.equal(cleanup.reads[1].semanticSha256,report.cleanup.finalConfigHash);
 const observation=report.fixtureSyncConfigObservation;hash(observation.beforeRawSha256);hash(observation.afterRawSha256);
 assert.equal(observation.internalExpectedVersionObserved,false);assert.equal(observation.internalWriteReceiptObserved,false);
}
export function assertLifecycleBindings(report,a,b,continuity,session){
 const fixtureHooks=path.join(report.fixture,'.codex/hooks.json');
 const success=e=>e.method==='hook/completed'&&['success','completed'].includes(e.run?.status)&&e.run.sourcePath===fixtureHooks;
 for(const [stream,worker] of [[a,report.workerA],[b,report.workerB]]){
  assertHeaderPublication(worker,stream);
  const invocation=stream.find(e=>e.kind==='invocation');assert.equal(invocation?.cwd,report.fixture);
  assertNativeHookPairs(worker,stream,report.definitions,report.fixture);
 }
 const start=a.find(e=>e.method==='item/started'&&e.item?.type==='contextCompaction'&&e.item.id===report.transfer.compactionItemId&&e.threadId===report.workerA.threadId&&e.turnId===report.transfer.turnId);assert(start);
 const end=a.find(e=>e.method==='item/completed'&&e.item?.id===start.item.id&&e.item.type==='contextCompaction'&&e.threadId===start.threadId&&e.turnId===start.turnId);assert(end);assert(end.eventIndex>start.eventIndex);
 assert.equal(report.transfer.threadId,report.workerA.threadId);assert.equal(report.transfer.compactionStartedIndex,start.eventIndex);
 assert(report.workerA.turns.some(t=>t.id===start.turnId&&t.status==='completed'));
 const hookPair=(eventName,predicate)=>{
  const completed=a.find(e=>success(e)&&e.threadId===start.threadId&&e.turnId===start.turnId&&e.run.eventName===eventName&&predicate(e));assert(completed,'Bound completed '+eventName);
  assert.equal(typeof completed.run.id,'string');assert(completed.run.id.length>0);
  const started=a.find(e=>e.method==='hook/started'&&e.threadId===completed.threadId&&e.turnId===completed.turnId&&e.run?.id===completed.run.id&&e.run.eventName===eventName&&e.run.sourcePath===fixtureHooks);assert(started,'Bound started '+eventName);
  assert(started.eventIndex<completed.eventIndex&&a.indexOf(started)<a.indexOf(completed),'Ordered hook pair '+eventName);
  return {started,completed};
 };
 // Native PreCompact runs before the compaction item; SessionStart(compact) follows it.
 const compact=hookPair('preCompact',e=>e.eventIndex<start.eventIndex);
 const routing=hookPair('sessionStart',e=>e.eventIndex>end.eventIndex&&e.structuredEntries?.some(x=>x.kind==='context'&&x.text?.includes(report.transfer.handoffId)&&x.text.includes(report.transfer.resumeCommand)));
 const lifecycle=[compact.started,compact.completed,start,end,routing.started,routing.completed];
 assert(lifecycle.every((e,i)=>i===0||(lifecycle[i-1].eventIndex<e.eventIndex&&a.indexOf(lifecycle[i-1])<a.indexOf(e))),'PreCompact, compaction, SessionStart lifecycle ordering');
 assert.equal(report.transfer.resumeCommand,`node .harness/run.mjs resume ${report.transfer.handoffId}`);
 assert.equal(session.phase,'awaiting_resume');assert.equal(session.handoffId,report.transfer.handoffId);assert.equal(session.resumeCommand,report.transfer.resumeCommand);assert.equal(session.owner?.id,report.workerA.threadId);
 const commands=b.filter(e=>e.method==='item/completed'&&e.threadId===report.workerB.threadId&&e.turnId===report.workerB.turn.id&&e.item?.type==='commandExecution'&&e.item.exitCode===0).sort((x,y)=>x.eventIndex-y.eventIndex);
 const payloads=commands.map(e=>nativeCommandPayload(e.item.command??'').trim());
 const resume=payloads.indexOf(report.transfer.resumeCommand);assert(resume>=0,'Fresh B executed exact delegated resume');
 assert.equal(payloads.filter(command=>command===report.transfer.resumeCommand).length,1,'Exactly one delegated resume');
 const bootstrap=payloads.findIndex((command,i)=>i>resume&&command==='node .harness/run.mjs bootstrap --json');
 const verify=payloads.findIndex((command,i)=>i>bootstrap&&command==='node .harness/run.mjs verify fixture-cents-001');
 const yielded=payloads.findIndex((command,i)=>i>verify&&/^node \.harness\/run\.mjs checkpoint --reason worker_yield(?:$|[ \t]+--)/.test(command));
 assert(bootstrap>resume&&verify>bootstrap&&yielded>verify,'Fresh B resume, bootstrap, verify, yield ordering');
 assert(!/node\s+\.harness[\\/]run\.mjs\s+(?:claim|resume|verify|start|feature|checkpoint|handoff|recover)\b/.test(payloads.slice(0,resume).join('\n')),'No B harness mutation before exact resume');
 const resumeItemStart=b.findIndex(e=>e.method==='item/started'&&e.item?.id===commands[resume].item.id);
 assert(resumeItemStart>=0);assert(!b.slice(0,resumeItemStart).some(e=>e.method==='item/started'&&e.item?.type==='commandExecution'&&/node\s+\.harness[\\/]run\.mjs\s+(?:claim|resume|verify|start|feature|checkpoint|handoff|recover)\b/.test(nativeCommandPayload(e.item.command??''))),'No attempted B mutation before exact resume');
 // Unrelated reads may be blocked by the native output guard. Require successful
 // command-bound hooks for the four exact lifecycle commands authenticated above.
 for(const index of [resume,bootstrap,verify,yielded]){
  const item=commands[index];
  const itemStart=b.find(e=>e.method==='item/started'&&e.threadId===item.threadId&&e.turnId===item.turnId&&e.item?.id===item.item.id);assert(itemStart,'Started lifecycle command '+payloads[index]);
  for(const event of ['preToolUse','postToolUse']){
   const completed=b.find(e=>success(e)&&e.threadId===report.workerB.threadId&&e.turnId===item.turnId&&e.run.eventName===event&&typeof e.run.id==='string'&&e.run.id.endsWith(':'+item.item.id));assert(completed,'Bound lifecycle '+event+' '+payloads[index]);
   const started=b.find(e=>e.method==='hook/started'&&e.threadId===item.threadId&&e.turnId===item.turnId&&e.run?.id===completed.run.id&&e.run.eventName===event&&e.run.sourcePath===fixtureHooks);assert(started,'Started lifecycle '+event+' '+payloads[index]);
   assert(started.eventIndex<completed.eventIndex&&b.indexOf(started)<b.indexOf(completed),'Ordered lifecycle hook pair '+event);
   assert(event==='preToolUse'?completed.eventIndex<itemStart.eventIndex:started.eventIndex>item.eventIndex,'Lifecycle hook command ordering '+event);
  }
 }
 assert.equal(continuity.phase,'working');assert.equal(continuity.owner,null);assert.equal(continuity.handoff,null);assert.equal(continuity.lastHandoff?.id,report.transfer.handoffId);assert.equal(continuity.lastHandoff?.owner?.id,report.workerA.threadId);assert.equal(continuity.lastHandoff.reason,'context_limit');assert.equal(continuity.lastHandoff.automatic,true);assert(continuity.lastHandoff.resumedAt);
 assert.equal(continuity.checkpoint?.reason,'worker_yield');assert(continuity.retiredWorkerIds.includes(report.workerA.threadId));assert(continuity.retiredWorkerIds.includes(report.workerB.threadId));
}
export async function verifyNativeReport(report){
assert(explicitReport,'LIVE003 requires an explicit fresh report');
const successorSelection=await authenticateSuccessorSelection();
await inspectReportLocation(sourceRoot,selectedReport);const reportBytes=await readFile(reportPath);assert.deepEqual(JSON.parse(reportBytes),report,'Verifier requires exactly the selected regular report');
assert.equal(report.version,1);assert.equal(report.featureId,'native-hook-v2-live-003');assert.equal(report.status,'passed');
assert.equal(report.reportSelection,selectedReport);assert.equal(report.artifactDirectory,artifactDirectory);assert.deepEqual(report.sourceAuthority,await verifyWindowsContainmentGate());assert.equal(report.sourceDigest,sha(stable(await snapshot(sourceRoot))));
assertSelectedReportBindings(report,{selection:successorSelection,freeze:await authenticateHelperFreeze(),recovery:await authenticateRecovery()});
assert.equal(new Set(report.artifacts.map(a=>a.path)).size,report.artifacts.length);assert.equal(report.sourceRoot,sourceRoot);assert(path.basename(report.fixture).startsWith('agent-harness-v2-live-'));assert.equal(path.dirname(report.fixture),os.tmpdir());
await inspectReportLocation(sourceRoot,artifactDirectory,{kind:'directory'});
for(const a of report.artifacts){assert(a.path.startsWith(artifactDirectory+'/'));assert.equal(path.posix.dirname(a.path),artifactDirectory);assert(!a.path.split(/[\\/]/).includes('..'));await inspectReportLocation(sourceRoot,a.path,{kind:'file'});const bytes=await readFile(path.join(sourceRoot,a.path));assert.equal(bytes.length,a.bytes);assert.equal(sha(bytes),a.sha256,a.path);}
const bound=name=>{const matches=report.artifacts.filter(a=>a.path.endsWith('/'+name));assert.equal(matches.length,1,'Unique authenticated artifact '+name);return path.join(sourceRoot,matches[0].path);};
const json=async name=>JSON.parse(await readFile(bound(name),'utf8'));
const rows=async name=>(await readFile(bound(name),'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
await assertInstalledInventory(report.installedInventory,report.artifacts);
assertArtifactStringReferences(report,report.artifacts,artifactDirectory);
const configLabels=['before-enrollment','reviewed-readback','cleanup-readback'];
assert.deepEqual(report.configReceiptPaths,configLabels.map(label=>`${artifactDirectory}/${label}-config-receipts.json`));
const configRecords={};
for(const label of configLabels){const record=await json(`${label}-config-receipts.json`),stream=await rows(`${label}-events.jsonl`);assert.equal(record.version,1);assert.equal(record.label,label);assert.equal(record.observedDirectRpc,true);assertConfigReceiptBindings(record,stream);assertConfirmedTermination(report,label,stream);configRecords[label]=record;}
assertConfigPhaseBindings(report,configRecords);assert.deepEqual(await json('fixture-sync-config-observation.json'),report.fixtureSyncConfigObservation);
const canonical=await canonicalCodexHooks(sourceRoot);assert.deepEqual(await json('canonical-rendered.json'),canonical);assert.deepEqual(await json('installed-hooks.json'),canonical);assert.deepEqual(await json('source-installed-hooks.json'),canonical);
for(const groups of Object.values(canonical.hooks))assert.equal(groups.length,1);
const sourceSnapshot=await json('source-snapshot.json');assert.equal(sha(stable(sourceSnapshot)),report.sourceDigest);
assert.equal(sha(await readFile(bound('fixture-runtime.mjs'))),sourceSnapshot['skill/codex-harness/assets/project-runtime.mjs']);
assert.deepEqual((await json('fixture-config.json')).verification,{quick:['node --check product.mjs'],full:['node --test acceptance.test.mjs'],e2e:[],architecture:[],clean:[]});
const init=await json('fixture-init-controller.json');assert.equal(init.exitCode,0);assert.equal(init.cwd,sourceRoot);assert.deepEqual(init.args,[path.join(sourceRoot,'bin/agent-harness.mjs'),'init',report.fixture]);
assert.equal(sha(await readFile(bound('canonical-template.txt'))),sourceSnapshot['skill/codex-harness/assets/codex-hooks.json.template']);
assert.equal(sha(await readFile(bound('canonical-bootstrap.json'))),sourceSnapshot['skill/codex-harness/assets/native-hook-bootstrap-v2.json']);
assert.equal(report.definitions.length,6);const nativeDiscovery=await json('reviewed-native-discovery.json');assert.equal(nativeDiscovery.data?.length,1);const reviewed=reviewNativeDefinitions(nativeDiscovery,report.fixture,canonical,canonical);assert.equal(reviewed.length,6);const discovery=nativeDiscovery.data[0].hooks;assert.equal(discovery?.length,6);
assert.deepEqual(report.definitions,reviewed.map(({command,...definition})=>({...definition,commandSha256:sha(command)})),'Exact unique reviewed canonical definitions required');
for(const d of report.definitions){const h=discovery.find(h=>h.key===d.key);assert(h&&h.enabled&&h.trustStatus==='trusted');assert.equal(h.currentHash,d.currentHash);assert.equal(sha(h.command),d.commandSha256);assert(Object.values(canonical.hooks).flat().some(g=>g.hooks.some(c=>(c.commandWindows??c.command)===h.command)));assert.equal(h.sourcePath,path.join(report.fixture,'.codex/hooks.json'));}
assert.equal(report.trustBypass,false);assert.equal(report.projectTrustOverride,false);assert.equal(report.manualCompaction,false);
const a=await rows('worker-a-events.jsonl'),b=await rows('worker-b-events.jsonl'),streams=[a,b];
assertConfirmedTermination(report,'worker-a',a);assertConfirmedTermination(report,'worker-b',b);
assertLifecycleBindings(report,a,b,await json('fixture-continuity.json'),await json('fixture-transfer-session.json'));
for(const stream of streams){assert(stream.some(e=>e.kind==='invocation'));assert(stream.some(e=>e.kind==='confirmedTermination'&&e.treeAbsent));for(const e of stream.filter(e=>e.kind==='invocation')){assert.equal(e.trustBypass,false);assert.equal(e.projectTrust,false);assert(!e.args.some(x=>/dangerously-bypass|trust_level=/.test(x)));}assert(!stream.some(e=>e.kind==='request'&&/compact/i.test(e.method)));}
const completed=streams.flat().filter(e=>e.method==='hook/completed'&&['completed','success'].includes(e.run?.status));
for(const event of ['preCompact','sessionStart','preToolUse','postToolUse','userPromptSubmit','stop'])assert(completed.some(e=>e.run.eventName===event),'Actual successful native '+event);
// assertLifecycleBindings above is the authoritative paired, identity-bound
// PreCompact -> actual compaction -> SessionStart(compact) ordering check.
assert.equal(report.workerA.autoCompactTokenLimit,5000);assert.equal(report.workerA.scope,'body_after_prefix');assert.notEqual(report.workerA.threadId,report.workerB.threadId);
for(const worker of [report.workerA,report.workerB]){assert.equal(worker.header.type,'session_meta');assert.equal(worker.header.id,worker.threadId);assert.equal(worker.header.idMatchesExpected,true);assert.equal(worker.header.parentThreadId,null);}
assert.equal(report.workerB.predecessorTranscriptProvided,false);assert.equal(report.workerB.freshThread,true);assert.equal(report.workerB.delegatedResumeCommand,report.transfer.resumeCommand);
// Exact lifecycle commands and their paired hooks are authenticated by
// assertLifecycleBindings; unrelated reads retain their native guard outcomes.
assert.equal(report.finalSession.phase,'working');assert.equal(report.finalSession.owner,null);const features=await json('fixture-features.json');assert.equal(features.features.find(f=>f.id==='fixture-cents-001')?.status,'passing');
const events=await rows('fixture-events.jsonl');assert(events.some(e=>e.type==='handoff.ready'&&e.handoffId===report.transfer.handoffId));assert(events.some(e=>e.type==='worker.resumed'&&e.handoffId===report.transfer.handoffId));
const fixtureFeature=features.features.find(f=>f.id==='fixture-cents-001');assert(fixtureFeature.evidence.length>0);assert.equal(report.fixturePassingEvidence.length,fixtureFeature.evidence.length);
for(const [i,reference] of report.fixturePassingEvidence.entries()){assert.equal(reference.fixturePath,fixtureFeature.evidence[i]);assert(report.artifacts.some(a=>a.path===reference.artifact.path&&a.sha256===reference.artifact.sha256));if(i===report.fixturePassingEvidence.length-1){const proof=JSON.parse(await readFile(path.join(sourceRoot,reference.artifact.path),'utf8'));assert.equal(proof.featureId,fixtureFeature.id);assert.equal(proof.pass,true);assert.deepEqual(proof.scopeViolations,[]);assert(proof.contractHash&&proof.configHash&&proof.verificationHash);assert(proof.commands.length>0&&proof.commands.every(c=>c.exitCode===0));assert(proof.commands.some(c=>c.command==='node --test acceptance.test.mjs'));}}
assert.equal(sha(await readFile(bound('final-acceptance.test.mjs'))),sha(await readFile(bound('original-acceptance.test.mjs'))));
assert(!(await readFile(bound('final-product.mjs'),'utf8')).includes('.harness'));
assert(report.terminations.filter(t=>/^worker-/.test(t.label)).every(t=>t.treeAbsent));assert(report.terminations.some(t=>t.label==='worker-a'));assert(report.terminations.some(t=>t.label==='worker-b'));
assert.equal(report.cleanup.nativeOwnedChangesRemoved,true);assert.equal(report.cleanup.freshReadback,true);assert.equal(report.cleanup.unrelatedBeforeHash,report.cleanup.unrelatedAfterHash);assert.equal(report.cleanup.policyBaselineAbsenceRestored,true);assert.equal(report.cleanup.noFixtureInFinalPolicy,true);
assert.equal(report.policy.baselineAbsent,true);assert.deepEqual(report.policy.projects.slice().sort(),[sourceRoot,report.fixture].sort());
assert.deepEqual(await json('policy-baseline.json'),{absent:true,sha256:null});
assert.equal(report.policy.transitions.length,4);assert.equal(report.policy.currentHash,null);let previous=null;
for(const [index,t] of report.policy.transitions.entries()){assert.equal(t.beforeHash,previous);assert(t.guard?.startsWith('checked-immediately-before-'));if(index<3){const bytes=await readFile(bound(`${t.label}-policy.json`));assert.equal(sha(bytes),t.afterHash);assert.deepEqual(JSON.parse(bytes),t.expected);}else{assert.equal(t.afterHash,null);assert.equal(t.expected,null);}previous=t.afterHash;}
assert.deepEqual(report.policy.transitions.map(t=>t.label),['temporary-policy-source-enable','temporary-policy-enable','temporary-policy-disable','temporary-policy-remove']);
assert.deepEqual(report.policy.transitions[0].expected.projects,[sourceRoot]);assert.deepEqual(report.policy.transitions[1].expected.projects,[sourceRoot,report.fixture].sort());assert.deepEqual(report.policy.transitions[2].expected,{version:1,enabled:false});
assert.equal(report.policy.expectedEnabledHash,report.policy.transitions[1].afterHash);assert.equal(report.policy.expectedDisabledHash,report.policy.transitions[2].afterHash);
return {pass:true,version:2,actualHost:true,canonicalSourceEquality:true,sixNativeEvents:true,automaticCompaction:true,freshResume:true,confirmedTreeTermination:true,guardedCleanup:true,windowsSourceAuthority:true,completeInstalledClosure:true,rootHelperFreeze:true,configReceipts:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){assert.equal(process.argv.length,4,'Exactly --report and its fixed selection are required');assert.equal(process.argv[2],'--report');await authenticateSuccessorSelection();console.log(JSON.stringify(await verifyNativeReport(JSON.parse(await readFile(reportPath,'utf8')))));}
