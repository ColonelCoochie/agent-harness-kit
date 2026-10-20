import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {authenticateGateReference,assertGateEvidence,assertReceiptOrder,expectedPlan,isolatedReferences,selectedReport,verifySourceGate} from './native-hook-v2-rollout-gate.mjs';
import {normalizedContract,reference} from './verify-source-budget-compat.mjs';
import {sha,stable,sourceRoot} from './source-budget-compat-authority.mjs';
const hash = value => sha(stable(value));
const state = JSON.parse(await readFile(new URL('../.harness/features.json',import.meta.url)));
const original = state.features.find(item => item.id === 'native-hook-v2-rollout-002');
const config = JSON.parse(await readFile(new URL('../.harness/config.json',import.meta.url)));
const clone = value => structuredClone(value);
function fixture() {
  const feature = clone(original), bindings = {configHash:hash(config),result:{pass:true}};
  const before = {runId:'test-run',actor:{source:'CODEX_THREAD_ID',id:'test-actor'},completedAt:'2026-10-16T10:00:00.000Z',
    attempts:0,config,feature:{shape:normalizedContract(feature),contract:feature.contract,baseline:feature.scopeBaselineRef},
    evidencePrefix:[{path:'.harness/evidence/prior.json',bytes:1,sha256:'0'.repeat(64)}],bindings};
  const plan = expectedPlan(before), stdout = JSON.stringify(bindings.result)+'\n';
  const evidence = {featureId:feature.id,schemaVersion:5,harnessVersion:6,pass:true,attempt:1,scopeViolations:[],
    contractHash:feature.contract.hash,configHash:bindings.configHash,verificationPlan:plan,verificationHash:hash(plan),
    requiredLayers:plan.requiredLayers.map(item => item.id),executedLayers:[...plan.requiredLayers.map(item => item.id),'acceptance'],
    commands:plan.executions.map(item => ({executionId:item.id,executionOrder:item.order,command:item.command,
      layer:item.layer,criterionId:item.criterionId,credentials:[],pass:true,exitCode:0,timedOut:false,
      stdout:item.kind === 'acceptance' ? stdout : '',stderr:'',truncated:false,originalBytes:item.kind === 'acceptance' ? Buffer.byteLength(stdout) : 0})),
    repository:{before:{statusHash:'before'},after:{statusHash:'after'}},
    startedAt:'2026-10-16T10:00:02.000Z',finishedAt:'2026-10-16T10:00:03.000Z'};
  feature.status='passing';feature.attempts=1;feature.evidence=['.harness/evidence/prior.json','.harness/evidence/new.json'];
  feature.lastVerification={pass:true,at:evidence.finishedAt};
  const receipt = {runId:before.runId,actor:before.actor,invocation:{executable:process.execPath,
    argv:['.harness/run.mjs','verify',feature.id],cwd:sourceRoot,actor:before.actor.id,pid:123,exitCode:0,signal:null,
    startedAt:'2026-10-16T10:00:01.000Z',finishedAt:'2026-10-16T10:00:04.000Z'},
    after:{completedAt:'2026-10-16T10:00:05.000Z',bindingsHash:hash(bindings),result:bindings.result},
    sealedAt:'2026-10-16T10:00:06.000Z',assurance:'cooperative sole-worker byte preservation across the genuine configured gate',
    repositoryBinding:'statusHash is scope metadata; report bytes are bound by authenticated BEFORE and AFTER references'};
  return {before,feature,evidence,receipt};
}
test('strict configured evidence accepts valid shape and rejects prefix, plan, result, and budget tampering',() => {
  const f=fixture();assertGateEvidence(f.before,f.feature,f.evidence);
  for(const change of [f=>f.feature.evidence[0]='changed',f=>f.feature.evidence.push('extra'),
    f=>f.feature.attempts=2,f=>f.evidence.commands.reverse(),f=>f.evidence.commands.pop(),f=>f.evidence.commands[10].command='changed',f=>f.evidence.commands[0].credentials=['openai'],f=>f.evidence.commands.at(-1).truncated=true,
    f=>f.evidence.commands.at(-1).stdout='{"pass":false}',f=>f.evidence.verificationPlan.executionPolicy.attemptBudget.featureMaxAttempts=5,
    f=>f.evidence.commands[0].timedOut=true,f=>f.evidence.scopeViolations.push('unexpected')]) {
    const value=fixture();change(value);assert.throws(()=>assertGateEvidence(value.before,value.feature,value.evidence));
  }
});
test('receipt order rejects time reversal, wrong run, actor, and invocation',() => {
  const f=fixture();assertReceiptOrder(f.before,f.receipt,f.evidence);
  for(const change of [f=>f.receipt.invocation.startedAt=f.receipt.sealedAt,f=>f.receipt.runId='other',
    f=>f.receipt.invocation.actor='other',f=>f.receipt.invocation.argv.push('--skip'),f=>f.receipt.after.bindingsHash='changed']) {
    const value=fixture();change(value);assert.throws(()=>assertReceiptOrder(value.before,value.receipt,value.evidence));
  }
});
test('reference authentication rejects altered hash, size, and traversal',async() => {
  const ref=await reference('scripts/native-hook-v2-rollout-gate.mjs');await authenticateGateReference(ref);
  await assert.rejects(authenticateGateReference({...ref,sha256:'0'.repeat(64)}));
  await assert.rejects(authenticateGateReference({...ref,bytes:ref.bytes+1}));
  await assert.rejects(authenticateGateReference({...ref,path:'../outside.json'}));
});
test('receipt consumer requires explicit selected report before reading receipt',async() => {
  await assert.rejects(verifySourceGate(),/Explicit selected rollout002 report/);
  await assert.rejects(verifySourceGate(undefined,'other.json'),/Explicit selected rollout002 report/);
});
test('isolated closure authenticates both sealed SHA-only gate refs and retains artifact refs',async() => {
  const source={path:'.harness/source-gate.json',bytes:10,sha256:'1'.repeat(64)},transition={path:'.harness/transition-gate.json',bytes:20,sha256:'2'.repeat(64)};
  const artifact={path:'.harness/artifact.json',bytes:30,sha256:'3'.repeat(64)},seen=[];
  const normalize=async relative=>{seen.push(relative);return relative===source.path?source:transition;};
  const report={sourceGate:{path:source.path,sha256:source.sha256},transitionGate:{path:transition.path,sha256:transition.sha256},artifacts:[artifact]};
  assert.deepEqual(await isolatedReferences(report,normalize),[source,transition,artifact]);assert.deepEqual(seen,[source.path,transition.path]);
  await assert.rejects(isolatedReferences({...report,transitionGate:{...report.transitionGate,sha256:'0'.repeat(64)}},normalize));
  await assert.rejects(isolatedReferences({...report,sourceGate:{...report.sourceGate,bytes:11}},normalize));
  await assert.rejects(isolatedReferences({...report,transitionGate:null},normalize));
});
