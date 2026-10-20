import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {authenticateReconciliationSources,reconciliationPaths,validatePinnedTelemetry} from './fix-nine-rollout-continuation-auth.mjs';
import {validateContextTelemetry,readOnlyReconciliationClient,observeSource0Reconciliation,validateSourcePlan,completionScope,validateCompletionScope,confirmedReportRow} from './fix-nine-rollout-continuation.mjs';
import {targets} from './fix-nine-rollout-preflight.mjs';
import {canonicalHash} from './fix-nine-rollout-evidence.mjs';
import {authenticateContextEpochSources,validateContextEpochAuthority,contextEpochPaths,authenticateParkedBridgeSources,parkedBridgePaths} from './fix-nine-rollout-continuation-auth.mjs';
import {parseParkedObservation,replayParkedTransfer,validateParkedSuccessor,validateContinuationStep,validateContinuationTransfer} from './fix-nine-rollout-continuation.mjs';
import {authenticateFiniteGapSources,finiteGapPaths} from './fix-nine-rollout-continuation-auth.mjs';
import {finiteGapIdentities,validateFiniteTransferGap,replayFiniteTransferGap,continuationTransfers} from './fix-nine-rollout-continuation.mjs';
import {contextAdmissionPaths,contextAdmissionPin,validateContextAdmissionAuthority,
  authenticateContextAdmissionTelemetry,authenticateContextAdmissionSources,
  authenticateContextAdmissionSupplement,authenticatePreservedSourceFile} from './fix-nine-rollout-continuation-auth.mjs';
import {sourceInstalledHookPins,validateSourceInstalledHookRepair,authenticateSourceInstalledHookRepair,
  authenticateHistoricalPreparedSource,authenticatePreparedSourceWithRepair} from './fix-nine-rollout-continuation-auth.mjs';
import {validateSourceClosure} from './fix-nine-rollout-closure.mjs';
import {authenticateFile} from './fix-nine-rollout-files.mjs';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {guardRecoveryPins,guardRecoveryHostPins,validateTranscriptAliasEvidence,authenticateGuardRecoveryEvidence} from './fix-nine-rollout-continuation-auth.mjs';
import {replayAvailability180} from './fix-nine-rollout-continuation.mjs';
import {generateKeyPairSync,sign} from 'node:crypto';
import {validateReview,reviewPayload,reviewPublicKey,validateExoClearanceReview,exoClearanceReviewBody} from './fix-nine-rollout-deployment.mjs';
import {captureSourceReleaseBoundary,authenticateSourceRelease} from './fix-nine-rollout-release.mjs';
import {authenticateContinuationReview,isRecoveryReviewPath,recoveryEpochAnchorRef} from './fix-nine-rollout-continuation-auth.mjs';
import {pinFile} from './fix-nine-rollout-files.mjs';
import {gateDirectory,rolloutFeatureId} from './fix-nine-rollout-evidence.mjs';
import os from 'node:os';
import path from 'node:path';

const copy=value=>structuredClone(value),hash='a'.repeat(64);
const pin=(path,sha256=hash)=>({path,bytes:10,sha256});
function telemetry() {
  const state={version:1,actorHash:hash,role:'orchestrator',startedAt:'2026-10-18T16:37:15.362Z',mutations:0,toolCalls:0,outputChars:0,
    telemetry:{status:'unavailable',bytesSinceUsage:0,interruptedGoals:0,goalPrompts:0,interruptions:0},
    updatedAt:'2026-10-18T16:37:15.363Z',lastNotice:null};
  const raw=JSON.stringify(state);
  return {state,admission:{authorityGranted:false,identity:'unknown',raw,captured:{path:`.harness/context/${hash}.json`,
    bytes:Buffer.byteLength(raw),sha256:createHash('sha256').update(raw).digest('hex')}}};
}
test('unknown telemetry admits only its exact captured record and zero-mutation monotonic data',()=>{
  const {state,admission}=telemetry(),current={...copy(state),toolCalls:3,outputChars:40,updatedAt:'2026-10-18T17:00:00.000Z'};
  assert.equal(validatePinnedTelemetry(admission,current),admission.captured.path);
  for(const change of [row=>row.mutations=1,row=>row.actorHash='b'.repeat(64),row=>row.role='worker',row=>row.toolCalls=-1,
    row=>row.telemetry.interruptions=-1,row=>row.updatedAt='2020-01-01T00:00:00Z',row=>row.owner='fabricated']) {
    const changed=copy(current);change(changed);assert.throws(()=>validatePinnedTelemetry(admission,changed));
  }
  for(const change of [row=>row.authorityGranted=true,row=>row.identity='root',row=>row.raw+=' ',row=>row.captured.path='.harness/context/other.json']) {
    const changed=copy(admission);change(changed);assert.throws(()=>validatePinnedTelemetry(changed,current));
  }
});
function sourceFixture() {
  const old=reconciliationPaths.sources.map(path=>pin(path)),unchanged=pin('scripts/fix-nine-rollout-continuation-gate.mjs');
  const body={sources:[...old,unchanged]},amendment={archives:old.map((row,index)=>({...row,
    path:`.harness/fix-nine-rollout-001/continuation/original-${index?'continuation-auth':'continuation'}-g168.mjs`})),
    sources:[...reconciliationPaths.sources,reconciliationPaths.test].map(path=>pin(path,'b'.repeat(64)))};
  const actual=new Map([...amendment.archives,...amendment.sources,unchanged].map(row=>[row.path,copy(row)]));
  const checked=[],io={authenticate:async ref=>{assert.deepEqual(ref,actual.get(ref.path),'Changed physical source');checked.push(ref.path);}};
  return {body,amendment,actual,checked,io};
}
test('amended bootstrap authenticates both exact old archives, new executable pins and unchanged sources',async()=>{
  const fixture=sourceFixture(),sources=await authenticateReconciliationSources(fixture);
  assert.deepEqual(sources.map(row=>row.path),fixture.body.sources.map(row=>row.path));
  assert.deepEqual(sources.slice(0,2),fixture.amendment.sources.slice(0,2));
  for(const row of [...fixture.amendment.archives,...fixture.amendment.sources,...sources]) assert(fixture.checked.includes(row.path));
});
test('bootstrap rejects changed old history, a missing new source, unchanged-source drift and extra executable scope',async()=>{
  for(const change of [f=>f.amendment.archives[0].sha256='c'.repeat(64),f=>f.actual.delete(reconciliationPaths.sources[0]),
    f=>f.actual.get('scripts/fix-nine-rollout-continuation-gate.mjs').sha256='c'.repeat(64),
    f=>f.amendment.sources.push(pin('scripts/extra.mjs'))]) {
    const fixture=sourceFixture();change(fixture);await assert.rejects(authenticateReconciliationSources(fixture));
  }
});
test('reconciliation native transport rejects config writes before dispatch',async()=>{
  const calls=[],client=readOnlyReconciliationClient({rpc:async(method,params)=>{calls.push({method,params});return {read:true};}});
  await client.rpc('config/read',{includeLayers:true});await client.rpc('hooks/list',{cwds:targets});
  assert.throws(()=>client.rpc('config/batchWrite',{edits:[]}));assert.throws(()=>client.rpc('hooks/approve',{}));
  assert.deepEqual(calls.map(row=>row.method),['config/read','hooks/list']);
});
function observationFixture() {
  const plan={target:targets[0],blocked:false,operations:Array.from({length:28},(_,index)=>({path:`runtime-${index}`,action:'preserve'})),readSet:[]};
  const calls=[],native={semanticSha256:hash,raw:{sha256:hash}},client=readOnlyReconciliationClient({rpc:async method=>{calls.push(method);return {};}});
  const deps={preserve:async()=>calls.push('preserve'),readPlan:async()=>copy(plan),validatePlan:value=>validateSourcePlan(plan,value),
    readNative:async()=>{await client.rpc('config/read',{});await client.rpc('hooks/list',{});return copy(native);},
    validateNative:value=>assert.deepEqual(value,native),readAudit:async()=>({criticalFailures:0}),readStartup:async()=>[{exitCode:0}]};
  return {deps,plan,calls};
}
test('read-only reconciliation observes the plan and native state twice without issuing sync or native writes',async()=>{
  const {deps,plan,calls}=observationFixture(),result=await observeSource0Reconciliation(deps);
  assert.deepEqual(result.planObservation,plan);assert.deepEqual(result.nativeObservation.before,result.nativeObservation.after);
  assert.deepEqual(calls,['preserve','config/read','hooks/list','preserve','config/read','hooks/list']);
  assert(!Object.hasOwn(result,'sync'));assert(!Object.hasOwn(result,'native'));
});
test('reconciliation fails closed on any source write or native change, before a receipt can be returned',async()=>{
  const writing=observationFixture();writing.deps.readPlan=async()=>({...copy(writing.plan),operations:[{path:'runtime',action:'write'}]});
  await assert.rejects(observeSource0Reconciliation(writing.deps));assert.deepEqual(writing.calls,['preserve']);
  const changed=observationFixture();let reads=0;changed.deps.readNative=async()=>({version:++reads});changed.deps.validateNative=()=>{};
  await assert.rejects(observeSource0Reconciliation(changed.deps),/Native state changed/);
});
test('reconciliation supplement leaves original all-eleven completion scope strict',()=>{
  const all=completionScope(true),nine=completionScope(false);
  assert.equal(all.currentIndices.length,11);assert.equal(nine.currentIndices.length,10);
  assert.throws(()=>validateCompletionScope({scope:nine.scope},true));
});
test('reconciled source0 report uses its actual audit after saved outcome and amendment references',()=>{
  const receipt=pin('target-00-receipt.json'),reservation=pin('target-00-reservation.json'),
    outcome=pin('target-00-outcome.json'),amendment=pin('source0-reconciliation-body.json'),audit=pin('target-00-audit.json');
  const result={ref:receipt,auditRef:audit,references:[receipt,reservation,outcome,amendment,audit]};
  const row=confirmedReportRow(0,result);
  assert.deepEqual(row,{index:0,root:targets[0],apply:receipt,audit});
  assert.notDeepEqual(row.audit,result.references[2]);
  assert.deepEqual(result.references,[receipt,reservation,outcome,amendment,audit]);
  assert.throws(()=>confirmedReportRow(0,{...result,auditRef:undefined}),/explicit audit reference/);
});

function finiteSourcesFixture() {
  const f=sourceFixture(),admission={
    sources:f.amendment.sources.map(ref=>({...ref,sha256:'c'.repeat(64)})),
    archives:f.amendment.sources.map((ref,index)=>({...ref,path:finiteGapPaths.archives[index]}))
  };
  for(const ref of [...admission.sources,...admission.archives]) f.actual.set(ref.path,copy(ref));
  return {...f,admission};
}
test('finite gap bootstrap preserves all source0-approved bytes and authenticates only three admitted replacements',async()=>{
  const f=finiteSourcesFixture();
  assert.deepEqual(await authenticateFiniteGapSources(f),f.admission.sources);
  assert.deepEqual(f.checked,[...finiteGapPaths.archives,...f.admission.sources.map(row=>row.path)]);
  for(const change of [f=>f.admission.archives[0].sha256='d'.repeat(64),
    f=>f.actual.delete(finiteGapPaths.archives[1]),f=>f.actual.delete(reconciliationPaths.test),
    f=>f.admission.sources.push(pin('scripts/unreviewed.mjs')),f=>f.admission.archives.reverse()]) {
    const bad=finiteSourcesFixture();change(bad);await assert.rejects(authenticateFiniteGapSources(bad));
  }
});
test('finite admission composes with original source0 archive authentication without requiring replaced live bytes',async()=>{
  const f=finiteSourcesFixture(),admitted=await authenticateFiniteGapSources(f);
  const sources=await authenticateReconciliationSources({...f,transferGap:{sources:admitted}});
  assert.deepEqual(sources.slice(0,2),admitted.slice(0,2));
  for(const ref of [...f.amendment.archives,...f.admission.archives,...admitted]) assert(f.checked.includes(ref.path));
  const changed=finiteSourcesFixture();changed.actual.delete(changed.amendment.archives[0].path);
  await assert.rejects(authenticateReconciliationSources({...changed,transferGap:{sources:changed.admission.sources}}));
});
// Small synthetic fixtures exercise semantics only; production admission still
// requires the exact immutable f748... captured gap and its genuine signed seal.
function finiteGapFixture() {
  const digest=value=>createHash('sha256').update(value).digest('hex');
  const eventsPath='.harness/events.jsonl',prefix=Buffer.from('{}\n');
  const bytesPin=(path,bytes)=>({path,bytes:bytes.length,sha256:digest(bytes)});
  const eventRef=bytesPin(eventsPath,prefix),oldOwner={id:finiteGapIdentities[0],generation:168,
    source:'CODEX_THREAD_ID',parentSessionId:'orchestrator',claimedAt:'2026-10-18T16:33:10.792Z',featureId:'fix-nine-rollout-001'};
  const before={features:{version:1,revision:155,features:[]},continuity:{version:1,phase:'working',generation:168,
    startedAt:'2026-10-18T16:00:00.000Z',resumedAt:oldOwner.claimedAt,checkpoint:{id:'old'},handoff:null,lastHandoff:null,
    owner:oldOwner,retiredWorkerIds:['old-worker'],lastRecovery:null}};
  const pairs=[
    ['handoff-20261018170153116-530a3730','2026-10-18T17:05:13.123Z','2026-10-18T17:07:37.233Z'],
    ['handoff-20261018170847081-9a3393b6','2026-10-18T17:10:13.071Z','2026-10-18T17:15:10.847Z'],
    ['handoff-20261018171916600-c61e15c6','2026-10-18T17:21:30.834Z','2026-10-18T17:24:45.139Z']
  ];
  const events=pairs.flatMap(([id,ready,resumed],index)=>[
    {type:'handoff.ready',handoffId:id,at:ready,generation:168+index,revision:155},
    {type:'worker.resumed',handoffId:id,at:resumed,generation:169+index,drift:[],driftAccepted:false}]);
  const full=Buffer.concat([prefix,Buffer.from(events.map(row=>JSON.stringify(row)+'\n').join(''))]);
  const owner={...oldOwner,id:finiteGapIdentities[3],generation:171,claimedAt:'2026-10-18T17:24:45.127Z'};
  const packet={id:pairs[2][0],kind:'handoff',selectedFeatureId:'fix-nine-rollout-001',featureRevision:155,
    owner:{...oldOwner,id:finiteGapIdentities[2],generation:170,claimedAt:'2026-10-18T17:15:10.829Z'},
    resumedAt:owner.claimedAt,drift:[],driftAccepted:false};
  const lifecycle={features:copy(before.features),continuity:{...copy(before.continuity),generation:171,owner,
    resumedAt:owner.claimedAt,checkpoint:{id:'g171-current-capture'},lastHandoff:packet,
    retiredWorkerIds:[...before.continuity.retiredWorkerIds,...finiteGapIdentities.slice(0,3)]}};
  const contexts=finiteGapIdentities.slice(1).map(identity=>{
    const actorHash=digest(identity),path=`.harness/context/${actorHash}.json`;
    const value={version:1,actorHash,role:'worker',startedAt:'2026-10-18T17:00:00.000Z',mutations:0,toolCalls:1,outputChars:2};
    return {identity,path,ref:bytesPin(path,Buffer.from(JSON.stringify(value))),value};
  });
  const prior=pin('.harness/fix-nine-rollout-001/continuation/transfer-168.json');
  const nativeCurrent={version:'historical-stage0',raw:pin('historical-config.toml'),semanticSha256:hash};
  const gap={version:1,kind:'fix-nine-rollout-finite-transfer-gap',scope:'source-generations168-through171',
    recordedBy:owner.id,createdAt:'2026-10-18T17:28:03.320Z',historicalSnapshotsAvailable:false,missingLifecycleGenerations:[169,170],
    lifecycle,pins:[prior],eventsRef:bytesPin(eventsPath,full),events,
    archives:pairs.map(([id])=>pin(`.harness/history/progress/${id}.md`)),contexts,
    native:{summary:nativeCurrent},nativeWriteCount:0,syncRetried:false};
  const values=new Map(contexts.map(row=>[row.path,copy(row.value)])),refs=new Map([prior,...gap.archives].map(ref=>[ref.path,ref])),calls=[];
  const buffers=[prefix,full];
  const io={json:async path=>{calls.push(['json',path]);assert(values.has(path),`Unexpected read: ${path}`);return copy(values.get(path));},
    prefix:async ref=>{calls.push(['prefix',ref.path]);const bytes=buffers.find(bytes=>bytes.length===ref.bytes);assert(bytes);
      assert.deepEqual(ref,bytesPin(ref.path,bytes));return bytes;},
    authenticate:async ref=>{calls.push(['authenticate',ref.path]);assert.deepEqual(ref,refs.get(ref.path));}};
  return {before,eventRef,gap,nativeCurrent,io,values,refs,buffers,calls,bytesPin};
}
test('finite gap admits only the six real transition identities, unchanged lifecycle and three known contexts',()=>{
  const f=finiteGapFixture();validateFiniteTransferGap(f.before,f.gap,f.nativeCurrent);
  for(const change of [g=>g.events.pop(),g=>g.events[2].generation=168,g=>g.events[1].drift=['changed'],
    g=>g.events[3].driftAccepted=true,g=>g.archives.pop(),g=>g.lifecycle.features.revision++,
    g=>g.lifecycle.continuity.lastRecovery={fabricated:true},g=>g.lifecycle.continuity.retiredWorkerIds.pop(),
    g=>g.recordedBy=finiteGapIdentities[1],g=>g.lifecycle.continuity.owner.id='unknown',
    g=>g.contexts[1].identity='unknown',g=>g.contexts[0].value.role='orchestrator',
    g=>g.historicalSnapshotsAvailable=true,g=>g.missingLifecycleGenerations=[169],
    g=>g.lifecycle.continuity.lastHandoff.driftAccepted=true,g=>g.nativeWriteCount=1,g=>g.syncRetried=true,
    g=>g.native.summary.version='later-stage']) {
    const gap=copy(f.gap);change(gap);assert.throws(()=>validateFiniteTransferGap(f.before,gap,f.nativeCurrent));
  }
});
test('gap replay authenticates full event prefix, all archives and monotonic contexts without a live native read',async()=>{
  const f=finiteGapFixture();for(const value of f.values.values()){value.toolCalls++;value.outputChars+=4;}
  const result=await replayFiniteTransferGap(f);
  assert.equal(result.lifecycle.continuity.generation,171);assert.equal(result.contexts.length,3);
  assert.deepEqual(result.paths,f.gap.archives.map(row=>row.path));
  assert(!f.calls.some(([,path])=>path==='historical-config.toml'));
  const rollback=finiteGapFixture();rollback.values.get(rollback.gap.contexts[0].path).toolCalls=0;
  await assert.rejects(replayFiniteTransferGap(rollback));
  const missingArchive=finiteGapFixture();missingArchive.refs.delete(missingArchive.gap.archives[1].path);
  await assert.rejects(replayFiniteTransferGap(missingArchive));
  const extra=finiteGapFixture(),bytes=Buffer.concat([extra.buffers[1],Buffer.from('{"type":"unreviewed"}\n')]);
  extra.buffers.push(bytes);extra.gap.eventsRef=extra.bytesPin('.harness/events.jsonl',bytes);
  await assert.rejects(replayFiniteTransferGap(extra),/six genuine events/);
});
test('gap replay resumes ordinary transfer validation at172 and never requests invented169 or170 records',async()=>{
  const f=finiteGapFixture(),old=f.gap.lifecycle,now=copy(old),at='2026-10-18T17:40:00.000Z';
  now.continuity.generation=172;now.continuity.owner={...old.continuity.owner,id:'worker172',generation:172,claimedAt:at};
  now.continuity.retiredWorkerIds.push(old.continuity.owner.id);now.continuity.resumedAt=at;
  now.continuity.lastHandoff={id:'handoff172',kind:'handoff',selectedFeatureId:'fix-nine-rollout-001',featureRevision:155,
    owner:copy(old.continuity.owner),resumedAt:at,drift:[],driftAccepted:false};
  const events=[{type:'handoff.ready',handoffId:'handoff172',generation:171,revision:155,at:'2026-10-18T17:39:00.000Z'},
    {type:'worker.resumed',handoffId:'handoff172',generation:172,at,drift:[],driftAccepted:false}];
  const bytes=Buffer.concat([f.buffers[1],Buffer.from(events.map(row=>JSON.stringify(row)+'\n').join(''))]);f.buffers.push(bytes);
  const actorHash=createHash('sha256').update('worker172').digest('hex'),context={path:`.harness/context/${actorHash}.json`,
    value:{...copy(f.gap.contexts[2].value),actorHash,startedAt:at}};
  const archive=pin('.harness/history/progress/handoff172.md');f.refs.set(archive.path,archive);f.values.set(context.path,context.value);
  f.values.set('.harness/fix-nine-rollout-001/continuation/transfer-172.json',{
    lifecycle:now,proof:{packet:now.continuity.lastHandoff,events,archive},events:f.bytesPin('.harness/events.jsonl',bytes),context});
  const ctx={snapshot:{lifecycle:f.before,files:[f.eventRef]},amendment:{transferGap:{gap:f.gap}},body:{nativeCurrent:f.nativeCurrent}};
  const result=await continuationTransfers(ctx,now,f.io);
  assert.deepEqual(result.lifecycle,now);assert.equal(result.contexts.length,4);assert.equal(result.paths.length,4);
  assert(!f.calls.some(([,path])=>/transfer-(169|170)\.json$/.test(path)));
  const bad=copy(now);bad.continuity.retiredWorkerIds=[];
  f.values.get('.harness/fix-nine-rollout-001/continuation/transfer-172.json').lifecycle=bad;
  await assert.rejects(continuationTransfers(ctx,now,f.io));
});

test('parked overlay authenticates exact approved gap sources through additional archives',async()=>{
  const f=finiteSourcesFixture(),parent=f.admission,admission={sources:parent.sources.map(ref=>({...ref,sha256:'d'.repeat(64)})),
    archives:parent.sources.map((ref,index)=>({...ref,path:parkedBridgePaths.archives[index]}))};
  for(const ref of [...admission.archives,...admission.sources])f.actual.set(ref.path,copy(ref));
  assert.deepEqual(await authenticateParkedBridgeSources({parent,admission,io:f.io}),admission.sources);
  const bad=copy(admission);bad.archives[0].sha256='e'.repeat(64);
  await assert.rejects(authenticateParkedBridgeSources({parent,admission:bad,io:f.io}));
});
function parkedFixture() {
  const f=finiteGapFixture(),before=f.gap.lifecycle,after=copy(before),owner={...before.continuity.owner,id:'worker172',generation:172,claimedAt:'2026-10-18T17:34:09.942Z'};
  const consumed={id:'handoff171',kind:'handoff',createdAt:'2026-10-18T17:28:28.097Z',owner:copy(before.continuity.owner),
    selectedFeatureId:'fix-nine-rollout-001',featureRevision:155,resumedAt:owner.claimedAt,drift:[],driftAccepted:false};
  const pending={id:'handoff172',kind:'handoff',createdAt:'2026-10-18T17:40:05.930Z',owner:copy(owner),selectedFeatureId:'fix-nine-rollout-001',featureRevision:155};
  Object.assign(after.continuity,{phase:'awaiting_resume',generation:172,owner,resumedAt:owner.claimedAt,lastHandoff:consumed,handoff:pending,
    retiredWorkerIds:[...before.continuity.retiredWorkerIds,before.continuity.owner.id]});
  const events=[{type:'handoff.ready',handoffId:consumed.id,generation:171,revision:155,at:'2026-10-18T17:29:48.798Z'},
    {type:'worker.resumed',handoffId:consumed.id,generation:172,drift:[],driftAccepted:false,at:'2026-10-18T17:34:09.950Z'},
    {type:'handoff.ready',handoffId:pending.id,generation:172,revision:155,at:'2026-10-18T17:41:01.282Z'}];
  const encode=rows=>Buffer.from(rows.map(row=>JSON.stringify(row)+'\n').join(''));
  const boundary=Buffer.concat([f.buffers[1],encode(events.slice(0,2))]),full=Buffer.concat([f.buffers[1],encode(events)]);f.buffers.push(boundary,full);
  // Match authenticatePrefix: authenticate the prefix but return the entire
  // current append-only event file, including later genuine successor events.
  f.io.prefix=async ref=>{const bytes=f.buffers.at(-1);assert.deepEqual(ref,f.bytesPin(ref.path,bytes.subarray(0,ref.bytes)));return bytes;};
  const actorHash=createHash('sha256').update(owner.id).digest('hex'),context={...copy(f.gap.contexts[2].value),actorHash};
  const contextPath=`.harness/context/${actorHash}.json`;f.values.set(contextPath,context);
  const file=(path,raw)=>({...f.bytesPin(path,Buffer.from(raw)),raw});
  const archives=[consumed.id,pending.id].map(id=>file(`.harness/history/progress/${id}.md`,'actual archive '+id+'\n'));
  for(const {raw,...ref} of archives)f.refs.set(ref.path,ref);
  const observation={version:1,kind:'independent-source-parked-observation',historicalWorkingSnapshot:false,readOnly:true,
    generation:172,phase:'awaiting_resume',owner:copy(owner),packetId:pending.id,observedAt:'2026-10-18T17:43:14.492Z',files:[
      file('.harness/continuity.json',JSON.stringify(after.continuity)),file('.harness/features.json',JSON.stringify(after.features)),
      file('.harness/events.jsonl',full.toString()),file(contextPath,JSON.stringify(context)),...archives]};
  const admission={ref:pin('parked-body.json'),value:{parentLifecycle:{generation:171,sha256:canonicalHash(before),events:f.gap.eventsRef}},observation,references:[]};
  return {...f,before,after,events,boundary,full,admission,encode};
}
test('parked replay preserves actual awaiting state and authenticates full prefix while retaining successor-ready boundary',async()=>{
  const f=parkedFixture(),parsed=parseParkedObservation(f.admission.observation);
  assert.equal(parsed.lifecycle.continuity.phase,'awaiting_resume');
  const result=await replayParkedTransfer({...f,eventRef:f.gap.eventsRef});
  assert.deepEqual(result.lifecycle,f.after);assert.equal(result.eventRef.bytes,f.boundary.length);
  assert(result.eventRef.bytes<f.full.length);assert.equal(result.paths.length,2);
  for(const change of [a=>a.observation.historicalWorkingSnapshot=true,a=>a.observation.files[0].raw+=' ',
    a=>a.value.parentLifecycle.sha256='f'.repeat(64)]) {
    const admission=copy(f.admission);change(admission);await assert.rejects(replayParkedTransfer({...f,admission,eventRef:f.gap.eventsRef}));
  }
});
function parkedSuccessor(f) {
  const after=copy(f.after),old=f.after.continuity,at='2026-10-18T17:43:36.887Z';
  Object.assign(after.continuity,{phase:'working',generation:173,handoff:null,resumedAt:at,
    owner:{...old.owner,id:'worker173',generation:173,claimedAt:at},retiredWorkerIds:[...old.retiredWorkerIds,old.owner.id],
    lastHandoff:{...copy(old.handoff),resumedAt:at,drift:[],driftAccepted:false}});
  const resumed={type:'worker.resumed',handoffId:old.handoff.id,generation:173,at,drift:[],driftAccepted:false};
  return {after,resumed,proof:{packet:after.continuity.lastHandoff,events:[f.events[2],resumed],archive:pin('.harness/history/progress/handoff172.md')}};
}
test('actual parked pending packet needs explicit consumption; generic transfers remain strict',()=>{
  const f=parkedFixture(),next=parkedSuccessor(f);
  assert.throws(()=>validateContinuationTransfer(f.after,next.after,next.proof));
  validateParkedSuccessor(f.after,next.after,next.proof);validateContinuationStep(f.after,next.after,next.proof);
  for(const change of [n=>n.proof.packet.summary='fabricated',n=>n.after.continuity.handoff={},
    n=>n.after.continuity.retiredWorkerIds.pop(),n=>n.proof.events[1].driftAccepted=true]) {
    const bad=copy(next);change(bad);assert.throws(()=>validateContinuationStep(f.after,bad.after,bad.proof));
  }
});
test('traversal bridges actual parked172 then records173 and ordinary174 without reconstructing working172',async()=>{
  const f=parkedFixture(),next=parkedSuccessor(f),full173=Buffer.concat([f.full,f.encode([next.resumed])]);f.buffers.push(full173);
  const originalJson=f.io.json;f.io.json=async name=>{
    if(name.endsWith('/transfer-172.json'))throw Object.assign(new Error('missing genuine working record'),{code:'ENOENT'});
    return originalJson(name);
  };
  const addRecord=(generation,lifecycle,proof,bytes)=>{
    const actorHash=createHash('sha256').update(lifecycle.continuity.owner.id).digest('hex'),context={path:`.harness/context/${actorHash}.json`,
      value:{...copy(f.gap.contexts[2].value),actorHash}};
    f.values.set(context.path,context.value);proof.archive=f.refs.get(proof.archive.path)??proof.archive;f.refs.set(proof.archive.path,proof.archive);
    f.values.set(`.harness/fix-nine-rollout-001/continuation/transfer-${generation}.json`,{lifecycle,proof,events:f.bytesPin('.harness/events.jsonl',bytes),context});
  };
  addRecord(173,next.after,next.proof,full173);
  const after174=copy(next.after),at='2026-10-18T17:50:00.000Z',packet={id:'handoff173',kind:'handoff',selectedFeatureId:'fix-nine-rollout-001',
    featureRevision:155,owner:copy(next.after.continuity.owner),resumedAt:at,drift:[],driftAccepted:false};
  Object.assign(after174.continuity,{generation:174,owner:{...next.after.continuity.owner,id:'worker174',generation:174,claimedAt:at},
    resumedAt:at,lastHandoff:packet,retiredWorkerIds:[...next.after.continuity.retiredWorkerIds,'worker173']});
  const events=[{type:'handoff.ready',handoffId:'handoff173',generation:173,revision:155,at:'2026-10-18T17:49:00.000Z'},
    {type:'worker.resumed',handoffId:'handoff173',generation:174,at,drift:[],driftAccepted:false}];
  const full174=Buffer.concat([full173,f.encode(events)]);f.buffers.push(full174);
  addRecord(174,after174,{packet,events,archive:pin('.harness/history/progress/handoff173.md')},full174);
  const ctx={ref:pin('continuation-body.json'),snapshot:{lifecycle:f.gap.lifecycle,files:[f.gap.eventsRef]},body:{nativeCurrent:f.nativeCurrent},
    amendment:{transferGap:{gap:f.gap,parkedBridge:f.admission}}};
  const result=await continuationTransfers(ctx,after174,f.io);assert.deepEqual(result.lifecycle,after174);
  assert.equal(result.contexts.length,3);assert.equal(f.admission.observation.phase,'awaiting_resume');
});

function knownOrchestratorEpochFixture() {
  const before={version:1,actorHash:'3c8d0154dbd6d7e2fcb6167992f61fa05208e24e02edaf2115577133ab2f44ed',role:'orchestrator',
    startedAt:'2026-10-18T16:06:44.000Z',updatedAt:'2026-10-18T16:24:15.621Z',mutations:0,toolCalls:118,outputChars:43182,
    telemetry:{identity:'12a63f9c66cf4e4d2938bd6c103c53c6170133ec506ac1690f074f7bcde9e7c8',epoch:18,
      offset:36387618,observedSize:36387618,usageOffset:36380425}};
  const now={...copy(before),startedAt:'2026-10-18T16:50:35.300Z',updatedAt:'2026-10-18T18:00:51.361Z',toolCalls:385,outputChars:118553,
    telemetry:{...copy(before.telemetry),epoch:19,offset:41417842,observedSize:41417842,usageOffset:41408869}};
  return {before,now};
}
test('known orchestrator compaction accepts an advancing epoch with stable identity and monotonic evidence',()=>{
  const {before,now}=knownOrchestratorEpochFixture(),saved=copy({before,now});
  assert.doesNotThrow(()=>validateContextTelemetry(before,now));
  assert.deepEqual({before,now},saved);
});
test('orchestrator epoch admission rejects identity, epoch, timestamp, offset and counter regressions',()=>{
  for(const change of [
    f=>f.now.version++,f=>f.now.actorHash='b'.repeat(64),f=>f.now.role='worker',
    f=>f.now.actorHash=f.before.actorHash='b'.repeat(64),
    f=>f.now.telemetry.identity='b'.repeat(64),f=>delete f.before.telemetry.identity,
    f=>f.now.telemetry.epoch=18,f=>f.now.telemetry.epoch=17,f=>f.now.telemetry.epoch=19.5,
    f=>f.now.startedAt='2026-10-18T16:00:00.000Z',f=>f.now.startedAt='2026-10-18T16:20:00.000Z',
    f=>f.now.updatedAt='2026-10-18T16:40:00.000Z',f=>f.now.startedAt='invalid',
    f=>f.before.updatedAt='invalid',f=>f.now.updatedAt=0,
    ...['offset','observedSize','usageOffset'].map(key=>f=>f.now.telemetry[key]=f.before.telemetry[key]-1),
    f=>f.now.telemetry.offset=Number.MAX_SAFE_INTEGER+1,
    f=>f.now.mutations=-1,f=>f.now.toolCalls=0,f=>f.now.outputChars=0,
  ]) {
    const fixture=knownOrchestratorEpochFixture();change(fixture);
    assert.throws(()=>validateContextTelemetry(fixture.before,fixture.now));
  }
});
test('ordinary context advancement retains worker lifetime and monotonic counters',()=>{
  for(const role of ['worker','orchestrator']) {
    const {before,now}=knownOrchestratorEpochFixture();before.role=now.role=role;now.startedAt=before.startedAt;
    now.telemetry.epoch=before.telemetry.epoch;
    assert.doesNotThrow(()=>validateContextTelemetry(before,now));
    for(const key of ['mutations','toolCalls','outputChars']) {
      const changed=copy(now);changed[key]=before[key]-1;
      assert.throws(()=>validateContextTelemetry(before,changed));
    }
  }
  const {before,now}=knownOrchestratorEpochFixture();before.role=now.role='worker';
  assert.throws(()=>validateContextTelemetry(before,now));
});

function contextEpochSourcesFixture() {
  const f=finiteSourcesFixture(),gap=f.admission;
  const parent={sources:gap.sources.map(ref=>({...ref,sha256:'d'.repeat(64)})),
    archives:gap.sources.map((ref,index)=>({...ref,path:parkedBridgePaths.archives[index]}))};
  const admission={sources:parent.sources.map(ref=>({...ref,sha256:'e'.repeat(64)})),
    archives:parent.sources.map((ref,index)=>({...ref,path:contextEpochPaths.archives[index]}))};
  for(const ref of [...parent.archives,...admission.archives,...admission.sources])f.actual.set(ref.path,copy(ref));
  return {...f,gap,parent,admission};
}
test('epoch source admission preserves parked-approved bytes and propagates new pins through old archive chains',async()=>{
  const f=contextEpochSourcesFixture(),saved=copy(f.parent);
  const sources=await authenticateContextEpochSources(f);
  assert.deepEqual(sources,f.admission.sources);
  assert.deepEqual(await authenticateParkedBridgeSources({parent:f.gap,admission:f.parent,io:f.io,successor:{sources}}),sources);
  assert.deepEqual(await authenticateFiniteGapSources({...f,admission:f.gap,successor:{sources}}),sources);
  const selected=await authenticateReconciliationSources({...f,transferGap:{sources}});
  assert.deepEqual(selected.slice(0,2),sources.slice(0,2));assert.deepEqual(f.parent,saved);
  for(const ref of [...f.parent.archives,...f.admission.archives,...sources])assert(f.checked.includes(ref.path));
});
test('epoch code admission rejects altered archives, missing physical pins and expanded executable scope',async()=>{
  for(const change of [f=>f.admission.archives[0].sha256='f'.repeat(64),
    f=>f.actual.delete(contextEpochPaths.archives[1]),f=>f.actual.delete(reconciliationPaths.sources[0]),
    f=>f.admission.sources.push(pin('scripts/unreviewed.mjs')),f=>f.admission.archives.reverse(),
    f=>f.parent.sources.reverse()]) {
    const f=contextEpochSourcesFixture();change(f);await assert.rejects(authenticateContextEpochSources(f));
  }
});
test('epoch authority binds the exact retained parked body and seal with no native or sync authority',()=>{
  const parentRef=pin(parkedBridgePaths.body),parentReview=pin(parkedBridgePaths.review),f=contextEpochSourcesFixture();
  const value={version:1,kind:'fix-nine-rollout-context-epoch-authority',scope:'known-orchestrator-epoch-compatibility-only',
    parent:{body:parentRef,review:parentReview},archives:f.admission.archives,sources:f.admission.sources,
    validation:[pin('validation.json')],nativeWriteAuthorized:false,retrySync:false};
  assert.doesNotThrow(()=>validateContextEpochAuthority(value,{parentRef,parentReview}));
  for(const change of [v=>v.parent.body.sha256='f'.repeat(64),v=>v.parent.review.sha256='f'.repeat(64),
    v=>v.scope='all-code',v=>v.nativeWriteAuthorized=true,v=>v.retrySync=true,v=>v.validation=[],
    v=>v.validation.push(copy(v.validation[0])),v=>v.extraAuthority=true]) {
    const bad=copy(value);change(bad);assert.throws(()=>validateContextEpochAuthority(bad,{parentRef,parentReview}));
  }
});

const admittedContextRaw='{"version":1,"actorHash":"ed453837750c086b385e202061c67eae99ae9f3e2ed8b88926271b8afe56c083","role":"orchestrator","startedAt":"2026-10-18T20:10:05.915Z","mutations":0,"toolCalls":0,"outputChars":0,"telemetry":{"status":"unavailable","bytesSinceUsage":0,"interruptedGoals":0,"goalPrompts":0,"interruptions":0},"updatedAt":"2026-10-18T20:10:05.916Z","lastNotice":null}\n';
function contextAdmissionFixture() {
  const f=contextEpochSourcesFixture(),epoch=f.admission;
  const parentRef=pin(contextEpochPaths.body),parentReview=pin(contextEpochPaths.review);
  const admission={version:1,kind:'fix-nine-rollout-additive-context-source-repair-authority',
    scope:'exact-ed453-source-hook-transcript-alias-g180-recovery-only',parent:{body:parentRef,review:parentReview},
    sources:epoch.sources.map(ref=>({...ref,sha256:'f'.repeat(64)})),
    archives:epoch.sources.map((ref,index)=>({...ref,path:contextAdmissionPaths.archives[index]})),
    telemetry:{captured:copy(contextAdmissionPin),raw:admittedContextRaw,identity:'unknown',authorityGranted:false},
    sourceInstalledHookRepair:sourceRepairFixture(),
    guardRecovery:{...copy(guardRecoveryPins),hostEvidence:copy(guardRecoveryHostPins)},
    recoveryCode:[pin("scripts/fix-nine-rollout-recovery-epoch.mjs")],
    validation:[pin('validation.json')],ownershipAuthorized:false,nativeWriteAuthorized:false,retrySync:false};
  for(const ref of [...admission.archives,...admission.sources])f.actual.set(ref.path,copy(ref));
  return {...f,epoch,admission,parentRef,parentReview};
}
function sourceRepairFixture() {
  const p=sourceInstalledHookPins;
  return {scope:'source-installed-native-hook-identity-only',root:targets[0],index:0,
    before:copy(p.before),after:copy(p.after),archive:copy(p.archive),template:copy(p.template),
    inventory:{before:copy(p.inventoryBefore),after:copy(p.inventoryAfter),archive:copy(p.inventoryArchive)},
    ownershipAuthorized:false,nativeWriteAuthorized:false,consumerWriteAuthorized:false,retrySync:false,originalPlanRewriteAuthorized:false};
}
test('additive telemetry authority permits only the exact unknown context and retained epoch authority',()=>{
  const f=contextAdmissionFixture(),before=copy(f.epoch);
  assert.doesNotThrow(()=>validateContextAdmissionAuthority(f.admission,f));
  assert.deepEqual(f.epoch,before);
  for(const change of [
    v=>v.telemetry.identity='trusted-owner',v=>v.telemetry.authorityGranted=true,
    v=>v.telemetry.raw+=' ',v=>v.telemetry.captured.bytes++,
    v=>v.telemetry.captured.sha256='0'.repeat(64),v=>v.telemetry.captured.path='.harness/context/other.json',
    v=>v.parent.body.sha256='0'.repeat(64),v=>v.parent.review.sha256='0'.repeat(64),
    v=>v.scope='all-contexts',v=>v.ownershipAuthorized=true,v=>v.nativeWriteAuthorized=true,
    v=>v.retrySync=true,v=>v.validation=[],v=>v.validation.push(copy(v.validation[0])),
    v=>v.telemetry.owner='unknown',v=>v.extraAuthority=true
  ]) {
    const bad=copy(f.admission);change(bad);
    assert.throws(()=>validateContextAdmissionAuthority(bad,f));
  }
});
test('additive telemetry source admission preserves all historical layers and propagates only reviewed pins',async()=>{
  const f=contextAdmissionFixture(),saved=copy({body:f.body,amendment:f.amendment,gap:f.gap,parent:f.parent,epoch:f.epoch});
  const sources=await authenticateContextAdmissionSources({parent:f.epoch,admission:f.admission,io:f.io});
  assert.deepEqual(sources,f.admission.sources);
  assert.deepEqual(await authenticateContextEpochSources({parent:f.parent,admission:f.epoch,io:f.io,successor:{sources}}),sources);
  assert.deepEqual(await authenticateParkedBridgeSources({parent:f.gap,admission:f.parent,io:f.io,successor:{sources}}),sources);
  assert.deepEqual(await authenticateFiniteGapSources({...f,admission:f.gap,successor:{sources}}),sources);
  const selected=await authenticateReconciliationSources({...f,transferGap:{sources}});
  assert.deepEqual(selected.slice(0,2),sources.slice(0,2));
  assert.deepEqual({body:f.body,amendment:f.amendment,gap:f.gap,parent:f.parent,epoch:f.epoch},saved);
  for(const ref of [...f.admission.archives,...sources])assert(f.checked.includes(ref.path));
});
test('additive telemetry source admission rejects archive changes, missing bytes and wider code scope',async()=>{
  for(const change of [
    f=>f.admission.archives[0].sha256='0'.repeat(64),f=>f.admission.archives.reverse(),
    f=>f.actual.delete(contextAdmissionPaths.archives[1]),f=>f.actual.delete(reconciliationPaths.sources[0]),
    f=>f.admission.sources.push(pin('scripts/extra.mjs')),f=>f.epoch.sources.reverse()
  ]) {
    const f=contextAdmissionFixture();change(f);
    await assert.rejects(authenticateContextAdmissionSources({parent:f.epoch,admission:f.admission,io:f.io}));
  }
});
test('additive telemetry physical check rejects any changed bytes including mutations and accounting growth',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'exact-context-'));
  try {
    const file=path.join(root,contextAdmissionPin.path);await mkdir(path.dirname(file),{recursive:true});
    const f=contextAdmissionFixture(),io={authenticate:ref=>authenticateFile(root,ref)};
    await writeFile(file,admittedContextRaw);
    assert.deepEqual(await authenticateContextAdmissionTelemetry(f.admission,io),
      {path:contextAdmissionPin.path,value:JSON.parse(admittedContextRaw)});
    for(const raw of [admittedContextRaw+' ',admittedContextRaw.replace('"mutations":0','"mutations":1'),
      admittedContextRaw.replace('"toolCalls":0','"toolCalls":1'),
      admittedContextRaw.replace('"orchestrator"','"worker"')]) {
      await writeFile(file,raw);await assert.rejects(authenticateContextAdmissionTelemetry(f.admission,io));
    }
  } finally {await rm(root,{recursive:true,force:true});}
});
test('additive telemetry missing optional body is the only absent-layer fallback',async()=>{
  const f=contextAdmissionFixture();
  assert.equal(await authenticateContextAdmissionSupplement({...f,parent:f.epoch,io:{
    pin:async()=>{throw Object.assign(Error('absent'),{code:'ENOENT'});}
  }}),null);
  for(const code of ['EACCES','ELOOP'])await assert.rejects(authenticateContextAdmissionSupplement({...f,parent:f.epoch,io:{
    pin:async()=>{throw Object.assign(Error('fail closed'),{code});}
  }}));
  await assert.rejects(authenticateContextAdmissionSupplement({...f,parent:f.epoch,io:{
    pin:async name=>pin(name),authenticate:async ref=>ref.path===contextAdmissionPaths.body
      ?JSON.stringify(f.admission):JSON.stringify({version:1,kind:'execution-authority',signature:'invalid'})
  }}));
});
test('additive telemetry is consumed by the actual preservation inventory without admitting other additions',async()=>{
  const code=await readFile(new URL('./fix-nine-rollout-continuation.mjs',import.meta.url),'utf8');
  const start=code.indexOf('async function sourcePreservation(');
  const end=code.indexOf('\nexport function validateContextTelemetry',start);
  assert(start>0&&end>start);
  const f=contextAdmissionFixture(),old=telemetry(),listed=[contextAdmissionPin.path];
  let physical=admittedContextRaw;
  const config={policies:{maxAttempts:5,maxRepeatedFailures:2}};
  const io={authenticate:async ref=>{
    assert.deepEqual(ref,contextAdmissionPin);
    assert.equal(Buffer.byteLength(physical),ref.bytes);
    assert.equal(createHash('sha256').update(physical).digest('hex'),ref.sha256);
    return physical;
  }};
  const deps={sourceRoot:'isolated',currentLifecycle:async()=>({continuity:{}}),
    continuationTransfers:async()=>({references:[],lifecycle:{},contexts:[],paths:[]}),
    validateLifecycle:()=>{},json:async name=>name==='.harness/config.json'?config:old.state,
    validateSourceProjections:async()=>{},validatePinnedTelemetry,authenticateContextAdmissionTelemetry,authenticatePreservedSourceFile,
    authenticateGateInventory:async()=>null,gateProtocolPaths:async()=>[],io,
    lifecyclePaths:new Set(),regularInventoryPaths:async()=>listed,
    continuationDirectory:'.harness/fix-nine-rollout-001/continuation',
    reportPath:'.harness/fix-nine-rollout-001-report.json',assert};
  const run=Function('deps',`const {${Object.keys(deps).join(',')}}=deps;\n${code.slice(start,end)}\nreturn sourcePreservation;`)(deps);
  const ctx={snapshot:{files:[],contexts:[]},ref:pin('original-body.json'),
    amendment:{value:{telemetry:old.admission},transferGap:{parkedBridge:{contextEpoch:{contextAdmission:{value:f.admission}}}}}};
  await run(ctx);
  const absent=copy(ctx);delete absent.amendment.transferGap.parkedBridge.contextEpoch.contextAdmission;
  await assert.rejects(run(absent),/Unreviewed source addition/);
  listed.push('.harness/context/'+'b'.repeat(64)+'.json');
  await assert.rejects(run(ctx),/Unreviewed source addition/);
  listed.pop();physical=admittedContextRaw+' ';
  await assert.rejects(run(ctx));
});
test('source hook recovery authority rejects other files, roots, consumers, templates and broader permissions',()=>{
  const repair=sourceRepairFixture();assert.deepEqual(validateSourceInstalledHookRepair(repair),repair);
  for(const options of [{index:1},{index:4},{root:targets[1]}])assert.throws(()=>validateSourceInstalledHookRepair(repair,options));
  for(const change of [
    r=>r.before.sha256='0'.repeat(64),r=>r.after.sha256='0'.repeat(64),r=>r.archive.path+='.other',
    r=>r.template.sha256=r.after.sha256,r=>r.template.path=r.after.path,
    r=>r.index=4,r=>r.root=targets[4],
    r=>r.inventory.after.sha256='0'.repeat(64),r=>r.inventory.archive.path+='.other',
    r=>r.extraFile=copy(r.after),r=>r.ownershipAuthorized=true,r=>r.nativeWriteAuthorized=true,
    r=>r.consumerWriteAuthorized=true,r=>r.retrySync=true,r=>r.originalPlanRewriteAuthorized=true
  ]){const bad=copy(repair);change(bad);assert.throws(()=>validateSourceInstalledHookRepair(bad));}
});

test('source hook recovery file proof authenticates retained archive and current bytes and rejects consumer reuse',async()=>{
  const repair=sourceRepairFixture(),checked=[],actual=new Map([repair.archive,repair.after].map(r=>[r.path,copy(r)]));
  const io={authenticate:async ref=>{assert.deepEqual(ref,actual.get(ref.path));checked.push(ref.path);}};
  await authenticatePreservedSourceFile(repair.before,{repair,io});
  assert.deepEqual(checked,[repair.archive.path,repair.after.path]);
  await assert.rejects(authenticatePreservedSourceFile(repair.before,{repair,index:1,io}));
  await assert.rejects(authenticatePreservedSourceFile(repair.before,{repair,root:targets[4],index:4,io}));
  await assert.rejects(authenticatePreservedSourceFile({...repair.before,sha256:'0'.repeat(64)},{repair,io}));
  actual.get(repair.archive.path).sha256='0'.repeat(64);
  await assert.rejects(authenticatePreservedSourceFile(repair.before,{repair,io}));
  actual.set(repair.archive.path,copy(repair.archive));actual.get(repair.after.path).sha256='0'.repeat(64);
  await assert.rejects(authenticatePreservedSourceFile(repair.before,{repair,io}));
});
test('source hook recovery closure authorization rejects unsigned input before any physical override',async()=>{
  const f=contextAdmissionFixture();
  await assert.rejects(authenticateSourceInstalledHookRepair({body:f.admission}));
  await assert.rejects(authenticateSourceInstalledHookRepair({body:f.admission,review:{signature:'unsigned'}}));
});
test('source hook recovery inventory authenticates the exact historical/current pair and no other metadata',async()=>{
  const repair=sourceRepairFixture(),checked=[];
  const actual=new Map([repair.inventory.archive,repair.inventory.after].map(ref=>[ref.path,copy(ref)]));
  const io={authenticate:async ref=>{assert.deepEqual(ref,actual.get(ref.path));checked.push(ref.path);}};
  await authenticatePreservedSourceFile(repair.inventory.before,{repair,io});
  assert.deepEqual(checked,[repair.inventory.archive.path,repair.inventory.after.path]);
  await assert.rejects(authenticatePreservedSourceFile(repair.inventory.before,{repair,index:4,io}));
  actual.get(repair.inventory.after.path).sha256='0'.repeat(64);
  await assert.rejects(authenticatePreservedSourceFile(repair.inventory.before,{repair,io}));
});
async function historicalPreparedFixture() {
  const files=['.harness/fix-nine-rollout-001/source-closure-candidate.json',
    '.harness/fix-nine-rollout-001/preflight.json','.harness/fix-nine-rollout-001/native-preservation.json',
    '.harness/evidence/2026-10-17T20-21-48-251Z-source-historical-budget-compat-002.json'];
  const [stored,preflight,native,evidence]=await Promise.all(files.map(async file=>
    JSON.parse(await readFile(new URL('../'+file,import.meta.url),'utf8'))));
  // Synthetic IO relocates only fixture root fields; production IO authenticates raw bytes.
  stored.targetRoots[0]=targets[0];preflight.targetRoots[0]=targets[0];
  native.receipts[1].cwds[0]=targets[0];stored.native.baseline.receipts[1].cwds[0]=targets[0];
  preflight.targets[0].root=targets[0];stored.originalPreflightPlans[0].root=targets[0];
  const enrollment={sourceRoot:targets[0],projects:copy(targets)};
  preflight.policy.valueSha256=canonicalHash(enrollment);stored.enrollment.valueSha256=canonicalHash(enrollment);
  const repair=sourceRepairFixture(),preparedRef=pin(files[0]),actual=new Map(),checked=[],outputs=[];
  const refs=[...stored.source.files,...stored.source.additional,
    ...stored.source.managed.flatMap(row=>[row.installed,row.asset]),...stored.source.frozen,...stored.historical,
    ...preflight.targets.flatMap(row=>[row.preservation,row.plan]),preflight.policy.raw,...stored.preparationFiles,
    ...stored.prerequisite.commands.flatMap(row=>[row.logs.stdout,row.logs.stderr]),
    stored.prerequisite.exoPreservationAudit,repair.archive,repair.after,repair.template,
    repair.inventory.archive,repair.inventory.after];
  for(const ref of refs)actual.set(ref.path,{ref:copy(ref),bytes:Buffer.from('fixture physical input')});
  const addJson=(ref,value)=>actual.set(ref.path,{ref:copy(ref),bytes:Buffer.from(JSON.stringify(value))});
  addJson(preparedRef,stored);addJson(stored.initialPreflight,preflight);
  addJson(stored.nativeSupplement,native);addJson(stored.prerequisite.evidence,evidence);
  addJson(pin('.harness/features.json'),{features:[{id:evidence.featureId,status:'passing',attempts:1,
    contract:{hash:evidence.contractHash},evidence:[stored.prerequisite.evidence.path]}]});
  addJson(pin('.harness/config.json'),{policies:{maxAttempts:5,maxRepeatedFailures:2}});
  addJson(preflight.policy.raw,enrollment);
  const io={pin:async name=>{assert(actual.has(name));return copy(actual.get(name).ref);},
    authenticate:async ref=>{assert(actual.has(ref.path),'Missing physical input '+ref.path);
      assert.deepEqual(ref,actual.get(ref.path).ref,'Changed physical input '+ref.path);
      checked.push(ref.path);return actual.get(ref.path).bytes;}};
  const outputIo={authenticate:async ref=>{
    assert([preflight.source.gateExport,preflight.source.sourceManifest].some(row=>JSON.stringify(row)===JSON.stringify(ref)));
    outputs.push(ref.path);
  }};
  return {stored,preflight,native,evidence,repair,preparedRef,actual,checked,outputs,io,outputIo};
}
test('source hook recovery adapter preserves original closure validation and authenticates all finite input families',async()=>{
  const f=await historicalPreparedFixture(),before=copy(f.stored);
  assert.equal(validateSourceClosure(f.stored,f),true);
  assert.deepEqual(await authenticateHistoricalPreparedSource(f),f.preparedRef);
  assert.deepEqual(f.stored,before);
  for(const ref of [f.stored.source.files[0],f.stored.source.additional[0],f.stored.source.frozen[0],
    f.stored.historical[0],f.preflight.targets[4].preservation,f.preflight.targets[4].plan,
    f.preflight.policy.raw,f.stored.preparationFiles[1],f.stored.prerequisite.commands[0].logs.stdout,
    f.repair.archive,f.repair.after])assert(f.checked.includes(ref.path),ref.path);
  assert.equal(f.outputs.length,2);
  const drift=copy(f.stored);drift.source.managed.find(row=>row.installed.path===f.repair.after.path).installed=copy(f.repair.after);
  assert.throws(()=>validateSourceClosure(drift,f),'Original validator must still reject the live installed drift');
});
test('source hook recovery adapter rejects changed templates, archives, helpers, logs, historical and target plans',async()=>{
  const f=await historicalPreparedFixture();
  for(const name of [f.repair.template.path,f.repair.archive.path,f.repair.after.path,
    f.stored.preparationFiles[1].path,f.stored.prerequisite.commands[0].logs.stdout.path,
    f.stored.historical[0].path,f.preflight.targets[5].plan.path]){
    const saved=f.actual.get(name);f.actual.set(name,{...saved,ref:{...saved.ref,sha256:'0'.repeat(64)}});
    await assert.rejects(authenticateHistoricalPreparedSource(f));f.actual.set(name,saved);
  }
});
test('source hook recovery adapter rejects changed live policy, prerequisite state and enrollment',async()=>{
  for(const [name,change] of [
    ['.harness/config.json',v=>v.policies.maxAttempts=6],
    ['.harness/config.json',v=>v.policies.maxRepeatedFailures=3],
    ['.harness/features.json',v=>v.features[0].status='active'],
    ['.harness/features.json',v=>v.features[0].attempts=2]
  ]){
    const f=await historicalPreparedFixture(),row=f.actual.get(name),value=JSON.parse(row.bytes);change(value);row.bytes=Buffer.from(JSON.stringify(value));
    await assert.rejects(authenticateHistoricalPreparedSource(f));
  }
  const f=await historicalPreparedFixture(),row=f.actual.get(f.preflight.policy.raw.path);
  row.bytes=Buffer.from(JSON.stringify({sourceRoot:targets[4],projects:targets}));
  await assert.rejects(authenticateHistoricalPreparedSource(f));
});
test('source hook recovery adapter requires signed authority before any repair reads and keeps signer helper exact',async()=>{
  let reads=0;const io={authenticate:async()=>{reads++;throw Error('Unexpected read');}};
  await assert.rejects(authenticatePreparedSourceWithRepair({preparedRef:pin('unused'),sourceRepair:{
    body:contextAdmissionFixture().admission,review:{signature:'unsigned'}},io}));
  assert.equal(reads,0);
  const bytes=await readFile(new URL('./fix-nine-rollout-closure.mjs',import.meta.url));
  assert.equal(bytes.length,15637);assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '8c3dff5fb9deb18f3cfff9f6fdb249cf06a216e0ad8ab8e72b4067d427650f57');
  const bad=sourceRepairFixture();bad.helper={after:pin('scripts/fix-nine-rollout-closure.mjs')};
  assert.throws(()=>validateSourceInstalledHookRepair(bad));
});



const guardRoot=new URL('../',import.meta.url);
async function guardFixture() {
  const io={authenticate:ref=>authenticateFile(guardRoot.pathname.startsWith('/')?decodeURIComponent(guardRoot.pathname).slice(1):guardRoot.pathname,ref)};
  const recovery=await authenticateGuardRecoveryEvidence({...guardRecoveryPins,hostEvidence:guardRecoveryHostPins},io);
  const predecessor=recovery.diagnostic.ownershipAtObservation.precedingTransferPin;
  const record=JSON.parse(await io.authenticate(predecessor));
  const rows=new Map(recovery.working180.files.map(row=>[row.path,Buffer.from(row.raw)]));
  const testIo={authenticate:async ref=>{
    if(ref.path===predecessor.path)return io.authenticate(ref);
    const bytes=rows.get(ref.path);assert(bytes);assert.equal(bytes.length,ref.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),ref.sha256);return bytes;
  },prefix:async ref=>{
    const bytes=rows.get(ref.path).subarray(0,ref.bytes);
    assert.equal(bytes.length,ref.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),ref.sha256);return bytes;
  },json:async name=>JSON.parse(rows.get(name))};
  return {recovery,before:record.lifecycle,eventRef:record.events,io:testIo,physicalIo:io};
}
test('guard recovery authenticates exact retained host evidence without inventing raw Git output',async()=>{
  const f=await guardFixture();assert.equal(f.recovery.references.length,13);
  for(const edit of [v=>v.hostEvidence.pop(),v=>v.hostEvidence.reverse(),
    v=>v.hostEvidence[0].sha256='a'.repeat(64),v=>v.working180.bytes++,v=>v.diagnostic.sha256='f'.repeat(64)]){
    const value={...copy(guardRecoveryPins),hostEvidence:copy(guardRecoveryHostPins)};edit(value);
    await assert.rejects(authenticateGuardRecoveryEvidence(value,f.physicalIo));
  }
});
test('guard recovery admits only evidenced same-file identity pair and monotonic orchestrator state',async()=>{
  const f=await guardFixture(),proof=f.recovery.diagnostic,c=proof.orchestratorContext;
  const before={version:1,actorHash:c.actorHash,...copy(c.before)},now={version:1,actorHash:c.actorHash,...copy(c.currentAtObservation)};
  assert.throws(()=>validateContextTelemetry(before,now));
  assert.doesNotThrow(()=>validateContextTelemetry(before,now,{transcriptAlias:proof}));
  for(const edit of [v=>v.transcript.statBothSpellings.inoAsNodeDefaultStatNumber='39125021763265897',
    v=>v.transcript.namespacedPath='\\\\server\\file',v=>v.transcript.noSymlinkAncestorsOfNormalPath=false,
    v=>v.transcript.header.id='another-thread',v=>v.transcript.normalDerivedIdentity='f'.repeat(64)]){
    const changed=copy(proof);edit(changed);assert.throws(()=>validateTranscriptAliasEvidence(changed));
  }
  for(const edit of [v=>v.telemetry.identity=c.before.telemetry.identity+'0',v=>v.role='worker',
    v=>v.actorHash='a'.repeat(64),v=>v.telemetry.offset--,v=>v.mutations=-1,v=>v.updatedAt=c.before.updatedAt]){
    const changed=copy(now);edit(changed);assert.throws(()=>validateContextTelemetry(before,changed,{transcriptAlias:proof}));
  }
  const advanced=copy(now);advanced.toolCalls++;advanced.outputChars++;advanced.telemetry.offset++;
  assert.doesNotThrow(()=>validateContextTelemetry(before,advanced,{transcriptAlias:proof}));
});
test('guard recovery replays actual generation180 availability-only observation and unchanged preceding history',async()=>{
  const f=await guardFixture(),result=await replayAvailability180(f);
  assert.equal(result.lifecycle.continuity.generation,180);
  assert.deepEqual(result.lifecycle.continuity.lastHandoff.drift,['repository availability changed']);
  assert.equal(result.lifecycle.continuity.lastHandoff.driftAccepted,true);
  assert.equal(result.eventRef.sha256,'6a8590113553f2446b03e3d98a4af6905576ab3ebe317cffc3509b73783ea847');
  assert.equal(result.contexts[0].value.role,'worker');
  assert.throws(()=>validateContinuationTransfer(f.before,result.lifecycle,{packet:result.lifecycle.continuity.lastHandoff,
    events:f.recovery.working180.files.find(row=>row.path==='.harness/events.jsonl').raw.slice(f.eventRef.bytes).trim().split('\n').map(JSON.parse)
      .filter(row=>['handoff.ready','worker.resumed'].includes(row.type)),driftDisposition:'availability-only'}));
  for(const edit of [v=>v.before.continuity.generation=178,v=>v.recovery.working180.generation=181,
    v=>v.recovery.working180.files[0].raw+=' ',v=>v.recovery.working180.owner.id='other',
    v=>v.eventRef.sha256='0'.repeat(64)]){
    const changed={...f,before:copy(f.before),recovery:copy(f.recovery),eventRef:copy(f.eventRef)};
    edit(changed);await assert.rejects(replayAvailability180(changed));
  }
});

test('epoch routing retains original signatures and cannot activate from a self-selected new key',async()=>{
  const root=decodeURIComponent(guardRoot.pathname).slice(1),io={authenticate:ref=>authenticateFile(root,ref)};
  const reviewRef=await pinFile(root,contextEpochPaths.review),body=JSON.parse(await readFile(path.join(root,contextEpochPaths.body)));
  const proof=await authenticateContinuationReview({io,reviewRef,kind:'execution-authority',body});
  assert.equal(proof.publicKey,reviewPublicKey);
  assert.equal(isRecoveryReviewPath(contextEpochPaths.review),false);
  assert.equal(isRecoveryReviewPath(contextAdmissionPaths.review),true);
  assert.equal(isRecoveryReviewPath('.harness/fix-nine-rollout-001/continuation/parked-transfer-179-review.json'),false);
  assert.equal(isRecoveryReviewPath('.harness/fix-nine-rollout-001/continuation/parked-transfer-180-review.json'),false);
  const keys=generateKeyPairSync('ed25519'),seal={version:1,kind:'execution-authority',verdict:'CONTINUE',body,
    signature:sign(null,reviewPayload('execution-authority',body),keys.privateKey).toString('base64')};
  await assert.rejects(authenticateContinuationReview({io:{authenticate:async()=>Buffer.from(JSON.stringify(seal))},reviewRef,kind:'execution-authority',body}));
  let reads=0;
  await assert.rejects(authenticateContinuationReview({io:{authenticate:async()=>{reads++;throw Error('unexpected');}},
    reviewRef:pin(contextAdmissionPaths.review),kind:'execution-authority',body}));
  assert.equal(reads,recoveryEpochAnchorRef?1:0);
});
test('epoch routing preserves standard final and postgate seals through original release helpers',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'recovery-routing-fixture-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const put=async(relative,value)=>{
    const target=path.join(root,relative);await mkdir(path.dirname(target),{recursive:true});
    await writeFile(target,typeof value==='string'?value:JSON.stringify(value));return pinFile(root,relative);
  };
  const actor='fixture-gate-owner',reviewer='fixture-independent-reviewer',now=new Date().toISOString();
  await put('.harness/features.json',{version:1,revision:1,features:[]});
  const continuity=await put('.harness/continuity.json',{phase:'working',handoff:null,generation:1,
    owner:{id:actor,source:'CODEX_THREAD_ID',featureId:rolloutFeatureId}});
  for(const name of ['progress.md','handoff.md','events.jsonl'])await put('.harness/'+name,'fixture retained bytes\n');
  const config=await put('.harness/config.json',{policies:{maxAttempts:5,maxRepeatedFailures:2}});
  await put('.harness/run.mjs','// isolated inert runtime\n');
  await put(gateDirectory+'/before.json',{owner:actor,continuity,bindings:{config}});
  const gate=await put(gateDirectory+'/receipt.json',{fixture:'gate'});
  const boundary=await captureSourceReleaseBoundary(root,async(relative,bytes)=>put(relative,bytes.toString('utf8')));
  const base='.harness/fix-nine-rollout-001/execution/post-gate-exo';
  const audit={version:1,kind:'fix-nine-rollout-exo-post-gate-audit',featureId:rolloutFeatureId,
    sourceReleaseBoundary:boundary,gate,actor,at:now,deployment:{authority:pin('authority.json'),sourceClosure:pin('closure.json')},
    target:{index:4,root:path.join(root,'exo')},hold:'pending-independent-clearance',holdCleared:false};
  const auditRef=await put(base+'-audit.json',audit),body=exoClearanceReviewBody(auditRef,audit,reviewer);
  const keys=generateKeyPairSync('ed25519'),wrong=generateKeyPairSync('ed25519');
  const seal={version:1,kind:'product-audit',verdict:'CONTINUE',body,
    signature:sign(null,reviewPayload('product-audit',body),keys.privateKey).toString('base64')};
  validateReview(seal,'product-audit',body,keys.publicKey);
  assert.throws(()=>validateReview(seal,'product-audit',body));
  const current={gateActor:actor,applyActors:['fixture-apply']};
  validateExoClearanceReview(seal,auditRef,audit,current,keys.publicKey);
  assert.throws(()=>validateExoClearanceReview(seal,auditRef,audit,current,wrong.publicKey));
  const reviewRef=await put(base+'-continue.json',seal);
  await put(base+'-clearance.json',{version:1,kind:'fix-nine-rollout-exo-clearance',featureId:rolloutFeatureId,
    gate,deployment:audit.deployment,target:audit.target,audit:auditRef,independentContinue:reviewRef,
    hold:'cleared',holdCleared:true,sealedAt:new Date().toISOString()});
  await authenticateSourceRelease({root,publicKey:keys.publicKey});
  await assert.rejects(authenticateSourceRelease({root,publicKey:reviewPublicKey}));
  await assert.rejects(authenticateSourceRelease({root,publicKey:wrong.publicKey}));
  await put(base+'-continue.json',{version:1,kind:'fix-nine-rollout-recovery-epoch-review',body,seal,signature:seal.signature});
  await assert.rejects(authenticateSourceRelease({root,publicKey:keys.publicKey}));
});
