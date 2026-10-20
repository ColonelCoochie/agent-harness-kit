// Reviewed continuation of the immutable eleven-target authority. The completed
// Exo pilot is imported as evidence, never executed again. No work runs on import.
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceRoot, targets, directory, featureId} from './fix-nine-rollout-preflight.mjs';
import {canonicalHash} from './fix-nine-rollout-evidence.mjs';
import {authenticateFile, authenticatePrefix, exclusiveJson, pinFile, readJson, regularInventoryPaths} from './fix-nine-rollout-files.mjs';
import {authenticateSourceClosure} from './fix-nine-rollout-closure.mjs';
import {requiredHelpers} from './fix-nine-rollout-auth.mjs';
import {authenticateGateInventory, mapBounded, forEachBounded, freezeInventoryBounded,
  authenticateReconciliationSupplement,validatePinnedTelemetry,authenticateLaterParkedBridge,authenticateContextAdmissionTelemetry,
  authenticatePreservedSourceFile,authenticatePreparedSourceWithRepair,validateTranscriptAliasEvidence,authenticateContinuationReview} from './fix-nine-rollout-continuation-auth.mjs';
import {cleanEnvironment} from './fix-nine-rollout-gate.mjs';
import {authorityPath, composedPath, sealPath, reportPath, reviewPublicKey, reviewPayload, validateReview, validateRoots,
  validateNativeAuthority, validateLifecycle, validatePreservation, validateExoClearanceReview, validateExoClearanceReceipt,
  exoClearanceReviewBody, validateExoClearanceAudit, authenticateExoClearanceWorkflow, validateTransfer,
  exoClearanceAuditPath, exoClearanceContinuePath, exoClearancePath} from './fix-nine-rollout-deployment.mjs';
import {normalizedContract, gateDirectory} from './fix-nine-rollout-evidence.mjs';
import {captureSourceReleaseBoundary, authenticateOwnedReleaseBoundary, authenticateSourceRelease, releaseState} from './fix-nine-rollout-release.mjs';
import {pilotClearanceBody, validatePilotAudit, validatePilotOwner} from './fix-nine-rollout-pilot.mjs';
import {planSync, syncHarness, auditHarness} from '../skill/codex-harness/scripts/lib/core.mjs';
import {connectNativeHookClient} from '../skill/codex-harness/scripts/lib/native-hook-client.mjs';

export const continuationDirectory = `${directory}/continuation`;
export const continuationOrder = Object.freeze([4, 0, 1, 2, 3, 5, 6, 7, 8, 9, 10]);
export const routerPath = 'scripts/verify-fix-nine-rollout.mjs';
export const archivePath = `${continuationDirectory}/original-verify-fix-nine-rollout.mjs`;
export const continuationSources = Object.freeze(['scripts/fix-nine-rollout-continuation.mjs',
  'scripts/fix-nine-rollout-continuation-auth.mjs', 'scripts/fix-nine-rollout-continuation-gate.mjs',
  'scripts/fix-nine-rollout-continuation.test.mjs', routerPath]);
const lifecyclePaths = new Set(['.harness/features.json', '.harness/continuity.json', '.harness/progress.md', '.harness/handoff.md', '.harness/events.jsonl']);
const equal = assert.deepEqual, clone = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const json = relative => readJson(sourceRoot, relative);
const pinned = async ref => JSON.parse(await authenticateFile(sourceRoot, ref));
const save = async (relative, value) => {
  await mkdir(path.dirname(path.join(sourceRoot, relative)), {recursive:true});
  return exclusiveJson(sourceRoot, relative, value);
};
const run = promisify(execFile), actor = () => process.env.CODEX_THREAD_ID;
const slot = (index, kind) => `${continuationDirectory}/target-${String(index).padStart(2, '0')}-${kind}.json`;
const bodyPath = `${continuationDirectory}/review-body.json`;
const reviewPath = `${continuationDirectory}/review.json`;
const snapshotPath = `${continuationDirectory}/source-boundary.json`;
const orchestratorId = '01a14a19-85af-7be1-b673-9df348f21123';
const io = {authenticate:ref => authenticateFile(sourceRoot, ref), pin:relative => pinFile(sourceRoot, relative)};

// Only the reviewed router replacement is admitted. All other original helper
// bytes, the original authority and all original review artifacts stay exact.
export async function authenticateOriginal({sources,sourceRepair} = {}) {
  const [authority, closure, originalReview] = await Promise.all([authorityPath, composedPath, sealPath].map(file => pinFile(sourceRoot, file)));
  const [value, composed, seal] = await Promise.all([authority, closure, originalReview].map(pinned));
  validateReview(seal, 'execution-authority', {authority, sourceClosure:closure, targetRoots:targets, scope:'ordered-eleven-deployment-only'});
  assert.equal(value.version, 1); assert.equal(value.kind, 'fix-nine-rollout-execution-authority');
  assert.equal(value.featureId, featureId); equal(value.targetRoots, targets); validateRoots(value.targets);
  equal(value.sourceClosure, closure); equal(value.preparedSource, composed.preparedSource);
  assert.equal(value.reviewPublicKeySha256, sha(reviewPublicKey));
  equal(composed.helperFiles.map(ref => ref.path).sort(), [...requiredHelpers].sort());
  assert.equal(new Set(composed.helperFiles.map(ref => ref.path)).size, requiredHelpers.length);
  for (const ref of composed.helperFiles) {
    if (ref.path === routerPath) {
      const archived = await pinFile(sourceRoot, archivePath);
      equal({...archived, path:routerPath}, ref, 'Original acceptance bytes must remain physically authenticated');
      await authenticateFile(sourceRoot, archived);
      if (sources) await authenticateFile(sourceRoot, sources.find(row => row.path === routerPath));
    } else await authenticateFile(sourceRoot, ref);
  }
  equal(sourceRepair?await authenticatePreparedSourceWithRepair({preparedRef:value.preparedSource,sourceRepair,io})
    :await authenticateSourceClosure(value.preparedSource.path),value.preparedSource);
  const [initial, native] = await Promise.all([value.initialPreflight, value.nativePreservation].map(pinned));
  equal(value.nativeBaseline, {version:native.layerVersion, semanticSha256:native.semanticSha256,
    unrelatedSha256:native.unrelatedSha256, trust:native.trust, definitions:native.definitions, raw:native.raw});
  validateNativeAuthority(value);
  for (const target of value.targets) {
    equal(target.originalPreservation, initial.targets[target.index].preservation);
    await Promise.all([target.plan, target.preservation, target.originalPreservation].map(ref => authenticateFile(sourceRoot, ref)));
  }
  return {value, authority, closure, originalReview, initial, composed};
}

async function currentLifecycle() {
  const [features, continuity] = await Promise.all(['features', 'continuity'].map(name => json(`.harness/${name}.json`)));
  return {features, continuity};
}
export function validateContinuationOwner(state, authority, identity, {passing=false}={}) {
  if(!passing) return validatePilotOwner(state,authority,identity);
  const {continuity,features,config}=state;
  assert(identity); assert.equal(continuity.phase,'working'); assert.equal(continuity.handoff,null);
  assert.equal(continuity.owner?.id,identity); assert.equal(continuity.owner.source,'CODEX_THREAD_ID');
  assert(!continuity.retiredWorkerIds.includes(identity));
  assert.equal(config.policies.maxAttempts,5); assert.equal(config.policies.maxRepeatedFailures,2);
  const current=features.features.find(row=>row.id===featureId), original=authority.targets[0].lifecycle.features.features.find(row=>row.id===featureId);
  assert.equal(current.status,'passing'); equal(normalizedContract(current),normalizedContract(original));
  equal(current.contract,original.contract); equal(current.scopeBaselineRef,original.scopeBaselineRef);
  assert(current.attempts>=original.attempts&&current.attempts<=5);
}
async function owned(original,options) {
  const state = await currentLifecycle();
  validateContinuationOwner({...state, config:await json('.harness/config.json')}, original.value,actor(),options);
  return state;
}
export function validateSourcePlan(frozen, current) {
  assert.equal(frozen.target, targets[0]); assert.equal(current.target, targets[0]);
  assert.equal(frozen.blocked, false); assert.equal(current.blocked, false);
  assert(frozen.operations.every(row => row.action === 'preserve'), 'Source runtime is already deployed; no new source writes are authorized');
  assert(current.operations.every(row => row.action === 'preserve'));
  const projection = plan => {
    const copy = clone(plan); delete copy.planHash;
    copy.operations = copy.operations.map(row => lifecyclePaths.has(row.path)
      ? Object.fromEntries(Object.entries(row).filter(([key]) => !['beforeHash', 'afterHash'].includes(key))) : row);
    copy.readSet = copy.readSet.filter(row => !lifecyclePaths.has(row.path));
    return copy;
  };
  equal(projection(current), projection(frozen), 'Only genuine source lifecycle read-set changes are permitted');
}

export function nativeExpected(authority, config, completed) {
  assert.equal(new Set(completed).size, completed.length);
  assert(completed.every(index => continuationOrder.includes(index)));
  const copy = clone(config);
  copy.hooks.state = clone(authority.nativeTrustRows);
  for (const row of authority.nativeTransitions) if (completed.includes(row.index)) copy.hooks.state[row.key].trusted_hash = row.after;
  return copy;
}
export function validateNativeSet(summary, authority, completed, expectedSemantic, observedIndex = null) {
  assert.equal(new Set(completed).size, completed.length); assert(completed.every(index=>continuationOrder.includes(index)));
  assert.equal(summary.raw.path, authority.nativeBaseline.raw.path);
  assert(Number.isSafeInteger(summary.raw.bytes) && summary.raw.bytes > 0); assert.match(summary.raw.sha256, /^[a-f0-9]{64}$/);
  assert.equal(typeof summary.version, 'string'); assert(summary.version);
  assert.equal(summary.unrelatedSha256, authority.nativeBaseline.unrelatedSha256);
  const trust = clone(authority.nativeBaseline.trust);
  for (const row of authority.nativeTransitions) if (completed.includes(row.index)) trust[row.key] = row.after;
  equal(summary.trust, trust); assert.equal(summary.semanticSha256, expectedSemantic);
  assert.equal(summary.definitions.length, 66); assert.equal(new Set(summary.definitions.map(row => row.key)).size, 66);
  for (const definition of summary.definitions) {
    const transition = authority.nativeTransitions.find(row => row.key === definition.key); assert(transition);
    if (transition.index === observedIndex) {
      const raw = clone(transition.afterRaw);
      if (transition.before !== transition.after) raw.trustStatus = 'modified';
      equal(definition, {...transition.afterDefinition, trustStatus:raw.trustStatus, definitionSha256:canonicalHash(raw)});
    } else equal(definition, completed.includes(transition.index) ? transition.afterDefinition : transition.beforeDefinition);
  }
}
export function continuationNativeAuthority(authority,current) {
  assert.match(current.unrelatedSha256,/^[a-f0-9]{64}$/);
  const value=clone(authority);value.nativeBaseline.unrelatedSha256=current.unrelatedSha256;
  return value;
}
const currentNativeAuthority=ctx=>continuationNativeAuthority(ctx.original.value,ctx.body.nativeCurrent);
async function nativeRead(client) {
  const file = path.join(process.env.CODEX_HOME ?? path.join(process.env.USERPROFILE, '.codex'), 'config.toml');
  const raw = await readFile(file), result = await client.rpc('config/read', {includeLayers:true});
  const layers = result.layers?.filter(row => row.name?.type === 'user' && !row.name.profile && path.resolve(row.name.file) === path.resolve(file));
  assert.equal(layers?.length, 1); const layer = layers[0];
  equal(await readFile(file), raw);
  const discovery = await client.rpc('hooks/list', {cwds:targets}); equal(await readFile(file), raw);
  equal(discovery.data.map(row => row.cwd), targets); assert(discovery.data.every(row => !row.errors?.length));
  const definitions = discovery.data.flatMap(row => row.hooks.filter(h => h.source === 'project' && h.sourcePath === path.join(row.cwd, '.codex/hooks.json')).map(h =>
    ({root:row.cwd,key:h.key,currentHash:h.currentHash,trustStatus:h.trustStatus,eventName:h.eventName,sourcePath:h.sourcePath,
      enabled:h.enabled,displayOrder:h.displayOrder,definitionSha256:canonicalHash(h),commandSha256:canonicalHash(h.command)})));
  const unrelated = clone(layer.config);
  for (const [key, row] of Object.entries(unrelated.hooks?.state ?? {})) { delete row.trusted_hash; if (!Object.keys(row).length) delete unrelated.hooks.state[key]; }
  return {layer, summary:{version:layer.version, semanticSha256:canonicalHash(layer.config), unrelatedSha256:canonicalHash(unrelated),
    trust:Object.fromEntries(Object.entries(layer.config.hooks?.state ?? {}).map(([key,row]) => [key,row.trusted_hash ?? null])),
    definitions, raw:{path:file,bytes:raw.length,sha256:sha(raw)}}};
}

// Completed-pilot admission authenticates historical proof. Mutable current
// runtime, configuration and feature state are observed by the final live gate.
export async function authenticatePilotHistory({root,baseline,receipt,plan,expected=null}) {
  const eventPrefix=baseline.files.find(ref=>ref.path==='.harness/events.jsonl'); assert(eventPrefix);
  await authenticatePrefix(root,eventPrefix);
  const immutable=baseline.files.filter(ref=>/^\.harness\/(?:baselines|evidence|history|logs)\//.test(ref.path));
  await forEachBounded(immutable,ref=>authenticateFile(root,ref));
  const installed=new Map(receipt.targetFiles.map(ref=>[ref.path,ref]));
  assert.equal(installed.size,receipt.targetFiles.length,'Duplicate pilot receipt file');
  for(const operation of plan.operations.filter(op=>op.action==='write')) {
    const ref=installed.get(operation.path); assert(ref,'Missing historical pilot write: '+operation.path);
    assert.equal(ref.sha256,operation.afterHash);
  }
  // Signed receipt pins describe the completed install, not the files an active
  // maintenance worker owns now. Immutable historical evidence remains live.
  const history={version:1,kind:'authenticated-completed-pilot-history',scope:'completed-pilot-only',root,
    eventPrefix,immutable,installed:receipt.targetFiles};
  if(expected) equal(history,expected,'Completed pilot historical proof changed');
  return history;
}

async function authenticatePilot(original, refs, expected=null) {
  const receipt = await pinned(refs.receipt), clearance = await pinned(refs.clearance), reservation = await pinned(refs.reservation);
  assert.equal(receipt.confirmed, true); assert.equal(receipt.index, 4); assert.equal(receipt.root, targets[4]);
  equal(receipt.originalAuthority, original.authority); equal(receipt.sourceClosure, original.closure);
  equal(receipt.reservation, refs.reservation); equal(receipt.review, refs.materialReview);
  equal(reservation.originalAuthority, original.authority); equal(reservation.plan, original.value.targets[4].plan);
  assert.equal(reservation.expectedPlanHash, original.value.targets[4].planHash);
  const body = await pinned(refs.materialBody); validateReview(await pinned(refs.materialReview), 'execution-authority', body);
  equal(body.originalAuthority, original.authority); equal(body.sourceClosure, original.closure);
  equal(body.originalReview, original.originalReview); assert.equal(body.scope, 'exo-index-4-only');
  equal(body.plan, original.value.targets[4].plan); equal(body.preservation, original.value.targets[4].preservation);
  await Promise.all(body.pilotSources.map(ref => authenticateFile(sourceRoot, ref)));
  const external = await readFile(body.externalPreservation.path);
  assert.equal(external.length, body.externalPreservation.bytes); assert.equal(sha(external), body.externalPreservation.sha256);
  const result = await pinned(refs.resultReview);
  validateReview(result, 'product-audit', pilotClearanceBody(refs.receipt, receipt, result.body?.actor));
  const amendmentBody = await pinned(refs.clearanceBody);
  validateReview(await pinned(refs.clearanceReview), 'execution-authority', amendmentBody);
  equal(amendmentBody.receipt, refs.receipt); equal(amendmentBody.resultReview, refs.resultReview);
  await Promise.all(amendmentBody.amendmentSources.map(ref => authenticateFile(sourceRoot, ref)));
  equal(clearance.receipt, refs.receipt); equal(clearance.independentContinue, refs.resultReview);
  equal(clearance.clearanceAmendment, refs.clearanceReview);
  assert.equal(clearance.hold, 'cleared-for-this-pilot-only'); assert.equal(clearance.holdCleared, true);
  assert.equal(clearance.originalAllElevenHoldUnchanged, true);
  assert.equal(receipt.native.confirmed, true); assert.equal(receipt.native.writeCount, 1);
  validateNativeSet(receipt.native.before, original.value, [], original.value.nativeBaseline.semanticSha256);
  validateNativeSet(receipt.native.observed, original.value, [], receipt.native.before.semanticSha256, 4);
  validateNativeSet(receipt.native.after, original.value, [4], receipt.native.expectedSemanticSha256);
  validatePilotAudit(receipt.audit);
  const target=original.value.targets[4];
  const advancement=await authenticatePilotHistory({root:targets[4],baseline:await pinned(target.preservation),
    receipt,plan:await pinned(target.plan),expected});
  return {receipt,advancement};
}
async function preservation(original, index, final) {
  const target = original.value.targets[index];
  assert.notEqual(index, 0, 'Source preservation uses the reviewed source boundary');
  return validatePreservation(target, original.initial.targets[index], await pinned(target.preservation), await pinned(target.plan), {final});
}

// Pin current source lifecycle honestly, rather than claiming it equals the
// unavailable historical raw continuity. Existing recovery evidence stays pinned.
export async function prepareContinuation({validationPath,supplementPath} = {}) {
  const original = await authenticateOriginal(), lifecycle = await owned(original);
  validateLifecycle(original.value.targets[0].lifecycle, lifecycle, {transfer:true});
  const pilotNames = {receipt:'receipt',clearance:'clearance',reservation:'reservation',materialBody:'review-body',materialReview:'review',
    resultReview:'clearance-review',clearanceBody:'clearance-amendment-body',clearanceReview:'clearance-amendment-review'};
  const pilot = Object.fromEntries(await Promise.all(Object.entries(pilotNames).map(async ([key,name]) => [key,await pinFile(sourceRoot,`${directory}/pilot-exo/${name}.json`)])));
  const {advancement}=await authenticatePilot(original, pilot);
  const sourcePlan = clone(await planSync(sourceRoot, {approveNativeHooks:false}));
  validateSourcePlan(await pinned(original.value.targets[0].plan), sourcePlan);
  const client=await connectNativeHookClient(); let nativeStages,nativeCurrent;
  try {
    const native=await nativeRead(client);
    equal(native.layer.config.hooks.state,nativeExpected(original.value,native.layer.config,[4]).hooks.state);
    nativeCurrent=native.summary;
    validateNativeSet(native.summary,continuationNativeAuthority(original.value,nativeCurrent),[4],canonicalHash(nativeExpected(original.value,native.layer.config,[4])));
    nativeStages=continuationOrder.map((_,position)=>({completed:continuationOrder.slice(0,position+1),
      semanticSha256:canonicalHash(nativeExpected(original.value,native.layer.config,continuationOrder.slice(0,position+1)))}));
  } finally {await client.close();}
  const contexts=await Promise.all([lifecycle.continuity.owner.id,orchestratorId].map(async id=>{
    const name=`.harness/context/${sha(id)}.json`;return {path:name,value:await json(name)};
  }));
  assert(validationPath,'Captured successful focused test evidence is required');
  const validation=await pinFile(sourceRoot,validationPath), result=await pinned(validation);
  equal(result.outcome,{exitCode:0,signal:null,launchError:null});
  equal(result.args,['--test','tests/fix-nine-rollout.test.mjs','scripts/fix-nine-rollout-continuation.test.mjs']);
  await Promise.all([result.stdout,result.stderr].map(ref=>authenticateFile(sourceRoot,ref)));
  assert(supplementPath,'Captured current pilot-history regression evidence is required');
  const supplement=await pinFile(sourceRoot,supplementPath), focused=await pinned(supplement);
  equal(focused.outcome,{exitCode:0,signal:null,launchError:null});
  equal(focused.args,['--test','--test-name-pattern','pilot history|nine completion|current Exo|bounded inventory|bounded continuation gate|original all-eleven binding','scripts/fix-nine-rollout-continuation.test.mjs']);
  equal(focused.inputs.before,focused.inputs.after);
  for(const file of continuationSources) {
    const tested=focused.inputs.after.find(ref=>ref.path===file); assert(tested,'Untested current input: '+file);
    await authenticateFile(sourceRoot,tested);
  }
  await Promise.all([focused.stdout,focused.stderr].map(ref=>authenticateFile(sourceRoot,ref)));
  const advancementPath=`${continuationDirectory}/pilot-advancement.json`;
  let pilotAdvancement;
  try {
    pilotAdvancement=await pinFile(sourceRoot,advancementPath);
    equal(await pinned(pilotAdvancement),advancement,'Partial pilot advancement differs from authenticated history');
  } catch(error) {
    if(error.code!=='ENOENT') throw error;
    pilotAdvancement=await save(advancementPath,advancement);
  }
  const files = await freezeInventoryBounded(sourceRoot, '.harness');
  const sourceBoundary = await save(snapshotPath, {version:1,lifecycle,files,sourcePlan,contexts,
    limitation:'Original continuity raw snapshot was not retained; authentic recovery/events and semantic history are preserved, not fabricated raw equality.'});
  const body = {version:1,kind:'fix-nine-rollout-continuation-authority',scope:'exact-nine-with-source-reconciliation-and-historical-exo-pilot',
    originalAuthority:original.authority, originalReview:original.originalReview, sourceClosure:original.closure,
    originalRouter:original.composed.helperFiles.find(ref => ref.path === routerPath), archivedRouter:await pinFile(sourceRoot,archivePath),
    sources:await Promise.all(continuationSources.map(file => pinFile(sourceRoot,file))), sourceBoundary,pilot,pilotAdvancement,order:continuationOrder,nativeStages,nativeCurrent,
    validation:{result:validation,stdout:result.stdout,stderr:result.stderr,supplement,supplementStdout:focused.stdout,supplementStderr:focused.stderr},
    rules:{preserveOriginalAuthority:true,doNotReapplyExo:true,exactConsumerPreservation:true,maxAttempts:5,maxRepeatedFailures:2,
      reviewConsolidation:'Exact nine completion requires nine current consumer receipts/audits, separate source reconciliation, current non-Exo startup and native preservation, and one independent actual-results review before sealing. Historical Exo admission grants no current Exo or all-eleven clearance. The separate all-eleven route additionally requires current Exo policy/runtime/startup proof and independent post-gate clearance.',
      perTargetMachineAudit:true,independentFinalResultsReview:true,actualFinalVerify:true,
      completionScope:'exact-nine',historicalPilotGrantsCurrentClearance:false,allElevenRequiresCurrentExo:true,automaticRetry:false}};
  const ref = await save(bodyPath, body);
  return {reviewBody:ref,payloadSha256:sha(reviewPayload('execution-authority',body)),executionAuthorized:false};
}

export async function authenticateContinuation() {
  const ref = await pinFile(sourceRoot,bodyPath), body = await pinned(ref), review = await pinFile(sourceRoot,reviewPath);
  assert.equal(body.kind,'fix-nine-rollout-continuation-authority'); assert.equal(body.version,1);
  assert.equal(body.scope,'exact-nine-with-source-reconciliation-and-historical-exo-pilot');
  validateReview(await pinned(review),'execution-authority',body);
  equal(body.order,continuationOrder); equal(body.sources.map(row=>row.path),continuationSources);
  equal(body.nativeStages.map(row=>row.completed),continuationOrder.map((_,position)=>continuationOrder.slice(0,position+1)));
  assert(body.nativeStages.every(row=>/^[a-f0-9]{64}$/.test(row.semanticSha256)));
  const amendment=await authenticateReconciliationSupplement({root:sourceRoot,io,bodyRef:ref,body,reviewRef:review});
  if(!amendment) await Promise.all(body.sources.map(row=>authenticateFile(sourceRoot,row)));
  await Promise.all(Object.values(body.validation).map(row=>authenticateFile(sourceRoot,row)));
  const contextAdmission=amendment?.transferGap?.parkedBridge?.contextEpoch?.contextAdmission;
  const original = await authenticateOriginal({sources:body.sources,sourceRepair:contextAdmission?.sourceRepair});
  validateNativeSet(body.nativeCurrent,continuationNativeAuthority(original.value,body.nativeCurrent),[4],body.nativeStages[0].semanticSha256);
  equal(body.originalAuthority,original.authority); equal(body.originalReview,original.originalReview); equal(body.sourceClosure,original.closure);
  equal(body.originalRouter,original.composed.helperFiles.find(row=>row.path===routerPath));
  equal({...body.archivedRouter,path:routerPath},body.originalRouter); await authenticateFile(sourceRoot,body.archivedRouter);
  const snapshot = await pinned(body.sourceBoundary), pilot = await authenticatePilot(original,body.pilot,await pinned(body.pilotAdvancement));
  return {original,body,ref,review,snapshot,pilot,amendment};
}

async function sourcePreservation(ctx,sourceRelease) {
  const current = sourceRelease ? await releaseState(sourceRoot,sourceRelease) : await currentLifecycle();
  const transfer=await continuationTransfers(ctx,current);ctx.parkedTransferReferences=transfer.references;
  validateLifecycle(transfer.lifecycle,current);
  const config = await json('.harness/config.json');
  assert.equal(config.policies.maxAttempts,5); assert.equal(config.policies.maxRepeatedFailures,2);
  // Ownership/checkpoints may change only through the harness. Recovery, old
  // handoffs and every historical evidence/log are immutable physical inputs.
  const baseline = ctx.snapshot.files;
  if(!sourceRelease) await validateSourceProjections(current.continuity);
  const contexts = new Map(ctx.snapshot.contexts.map(row=>[row.path,row.value]));
  for(const row of transfer.contexts) contexts.set(row.path,row.value);
  if(ctx.amendment) {
    const telemetry=ctx.amendment.value.telemetry;
    validatePinnedTelemetry(telemetry,await json(telemetry.captured.path));
    contexts.set(telemetry.captured.path,JSON.parse(telemetry.raw));
  }
  const contextAdmission=ctx.amendment?.transferGap?.parkedBridge?.contextEpoch?.contextAdmission;
  if(contextAdmission) {
    const telemetry=await authenticateContextAdmissionTelemetry(contextAdmission.value,io);
    contexts.set(telemetry.path,telemetry.value);
  }
  const gate = await authenticateGateInventory(sourceRoot,sourceRelease);
  const allowed = new Set([...(gate?.paths ?? []),...transfer.paths,...(ctx.amendment?.references??[]).map(ref=>ref.path),...await gateProtocolPaths(gate,ctx.ref)]);
  const frozen = new Set(baseline.map(row=>row.path));
  for (const ref of baseline) {
    if (lifecyclePaths.has(ref.path)) {
      if(ref.path==='.harness/events.jsonl') await authenticatePrefix(sourceRoot,ref);
      continue;
    }
    if (contexts.has(ref.path)) {
      validateContextTelemetry(contexts.get(ref.path),await json(ref.path),{transcriptAlias:contextAdmission?.guardRecovery.diagnostic});
      continue;
    }
    await authenticatePreservedSourceFile(ref,{repair:contextAdmission?.value.sourceInstalledHookRepair,io});
  }
  for (const name of await regularInventoryPaths(sourceRoot,'.harness')) {
    if(frozen.has(name)||allowed.has(name)||contexts.has(name)) continue;
    assert(name.startsWith(`${continuationDirectory}/`) || /^\.harness\/fix-nine-rollout-001\/reviews\/[a-z0-9-]+\.json$/.test(name)
      || name===reportPath,`Unreviewed source addition: ${name}`);
  }
}

export function validateContextTelemetry(before,now,{transcriptAlias=null}={}) {
  for(const key of ['version','actorHash','role']) equal(now[key],before[key]);
  assert(['worker','orchestrator'].includes(now.role)); assert.match(now.actorHash,/^[a-f0-9]{64}$/);
  for(const key of ['mutations','toolCalls','outputChars']) assert(Number.isSafeInteger(now[key])&&now[key]>=before[key]);
  if(now.startedAt===before.startedAt) return;
  // Known orchestrator compaction advances the same transcript's epoch and clock.
  // Worker lifetimes and the existing monotonic counter requirement remain strict.
  assert.equal(now.role,'orchestrator');
  assert.equal(now.actorHash,sha(orchestratorId));
  const previous=before.telemetry,current=now.telemetry;
  assert.match(previous?.identity??'',/^[a-f0-9]{64}$/);
  if(current?.identity!==previous.identity) {
    assert(transcriptAlias,'Transcript identity change requires its exact signed alias proof');
    const witness=validateTranscriptAliasEvidence(transcriptAlias);
    for(const key of ['role','startedAt','updatedAt','mutations','toolCalls','outputChars'])equal(before[key],witness.before[key]);
    equal(before.telemetry.identity,witness.before.telemetry.identity);
    for(const key of ['epoch','offset','observedSize','usageOffset'])equal(before.telemetry[key],witness.before.telemetry[key]);
    assert.equal(current.identity,witness.currentAtObservation.telemetry.identity);
    assert.equal(now.actorHash,witness.actorHash);
    assert(Date.parse(now.updatedAt)>=Date.parse(witness.currentAtObservation.updatedAt));
    for(const key of ['epoch','offset','observedSize','usageOffset'])assert(current[key]>=witness.currentAtObservation.telemetry[key]);
  }
  assert(Number.isSafeInteger(previous.epoch)&&previous.epoch>=0);
  assert(Number.isSafeInteger(current.epoch)&&current.epoch>previous.epoch);
  for(const key of ['offset','observedSize','usageOffset']) {
    assert(Number.isSafeInteger(previous[key])&&previous[key]>=0);
    assert(Number.isSafeInteger(current[key])&&current[key]>=previous[key]);
  }
  const times=[before.startedAt,before.updatedAt,now.startedAt,now.updatedAt].map(value=>{
    assert.equal(typeof value,'string');const parsed=Date.parse(value);assert(Number.isFinite(parsed));return parsed;
  });
  assert(times[0]<=times[1]&&times[1]<=times[2]&&times[2]<=times[3]&&times[0]<times[2]);
}
export function validateContinuationTransfer(before,after,proof) {
  validateTransfer(before,after,proof);
  assert(!(before.continuity.retiredWorkerIds??[]).includes(after.continuity.owner.id));
  assert.deepEqual(proof.packet.drift,[]); assert.equal(proof.packet.driftAccepted,false);
}
export const finiteGapIdentities=Object.freeze([
  '01a14fda-a72c-7952-840a-e2dcb7164b49','01a14ff9-eb88-74d3-9ffc-85fcb59b22b4',
  '01a14ffe-f21f-77c1-a386-83f79a73a5bb','01a15009-a2cc-75d3-b74a-503ef76e832c'
]);
const finiteGapPairs=Object.freeze([
  ['handoff-20261018170153116-530a3730','2026-10-18T17:05:13.123Z','2026-10-18T17:07:37.233Z'],
  ['handoff-20261018170847081-9a3393b6','2026-10-18T17:10:13.071Z','2026-10-18T17:15:10.847Z'],
  ['handoff-20261018171916600-c61e15c6','2026-10-18T17:21:30.834Z','2026-10-18T17:24:45.139Z']
]);
export function validateFiniteTransferGap(before,gap,nativeCurrent) {
  assert.equal(gap.version,1);assert.equal(gap.kind,'fix-nine-rollout-finite-transfer-gap');
  assert.equal(gap.scope,'source-generations168-through171');
  assert.equal(gap.historicalSnapshotsAvailable,false);equal(gap.missingLifecycleGenerations,[169,170]);
  assert.equal(gap.nativeWriteCount,0);assert.equal(gap.syncRetried,false);
  const after=gap.lifecycle,old=before.continuity,current=after.continuity;
  assert.equal(old.generation,168);assert.equal(old.owner.id,finiteGapIdentities[0]);
  assert.equal(current.generation,171);assert.equal(current.owner.id,finiteGapIdentities[3]);
  assert.equal(gap.recordedBy,current.owner.id);
  validateLifecycle(before,after,{transfer:true});equal(after.features,before.features);
  equal(current.retiredWorkerIds,[...(old.retiredWorkerIds??[]),...finiteGapIdentities.slice(0,3)]);
  assert(!current.retiredWorkerIds.includes(current.owner.id));
  const owner=current.owner,packet=current.lastHandoff;
  equal(Object.keys(owner).sort(),['claimedAt','featureId','generation','id','parentSessionId','source']);
  assert.equal(owner.source,'CODEX_THREAD_ID');assert.equal(owner.generation,171);
  assert.equal(owner.parentSessionId,old.owner.parentSessionId);assert.equal(owner.featureId,featureId);
  assert.equal(gap.events.length,6);assert.equal(gap.archives.length,3);
  let lastTime=-Infinity;
  for(const [index,[id,readyAt,resumedAt]] of finiteGapPairs.entries()) {
    const [ready,resumed]=gap.events.slice(index*2,index*2+2);
    equal([ready.type,resumed.type],['handoff.ready','worker.resumed']);
    equal([ready.handoffId,resumed.handoffId],[id,id]);
    equal([ready.at,resumed.at],[readyAt,resumedAt]);
    equal([ready.generation,resumed.generation],[168+index,169+index]);
    assert.equal(ready.revision,before.features.revision);
    equal(resumed.drift,[]);assert.equal(resumed.driftAccepted,false);
    assert(Date.parse(ready.at)>lastTime);assert(Date.parse(resumed.at)>Date.parse(ready.at));lastTime=Date.parse(resumed.at);
    assert.equal(gap.archives[index].path,`.harness/history/progress/${id}.md`);
  }
  assert.equal(packet.id,finiteGapPairs[2][0]);assert.equal(packet.kind,'handoff');
  assert.equal(packet.selectedFeatureId,featureId);assert.equal(packet.featureRevision,after.features.revision);
  assert.equal(packet.owner.id,finiteGapIdentities[2]);assert.equal(packet.owner.generation,170);
  assert.equal(packet.owner.source,'CODEX_THREAD_ID');assert.equal(packet.owner.parentSessionId,owner.parentSessionId);
  assert.equal(packet.owner.featureId,featureId);equal(packet.drift,[]);assert.equal(packet.driftAccepted,false);
  assert.equal(owner.claimedAt,packet.resumedAt);assert.equal(current.resumedAt,packet.resumedAt);
  assert(Date.parse(packet.resumedAt)>=Date.parse(finiteGapPairs[2][1]));
  assert(Date.parse(packet.resumedAt)<=Date.parse(finiteGapPairs[2][2]));
  assert(Date.parse(gap.createdAt)>=lastTime);
  equal(gap.contexts.map(row=>row.identity),finiteGapIdentities.slice(1));
  for(const row of gap.contexts) {
    const contextPath=`.harness/context/${sha(row.identity)}.json`;
    assert.equal(row.path,contextPath);assert.equal(row.ref.path,contextPath);
    assert.equal(row.value.version,1);assert.equal(row.value.actorHash,sha(row.identity));assert.equal(row.value.role,'worker');
    assert(Number.isFinite(Date.parse(row.value.startedAt)));
    for(const key of ['mutations','toolCalls','outputChars']) assert(Number.isSafeInteger(row.value[key])&&row.value[key]>=0);
  }
  // This is the pinned historical stage0 capture. Live native checks remain in
  // the stage-aware apply/final paths; replay must not freeze later consumers.
  equal(gap.native.summary,nativeCurrent);
}
export async function replayFiniteTransferGap({before,eventRef,gap,nativeCurrent,io}) {
  validateFiniteTransferGap(before,gap,nativeCurrent);
  assert.equal(eventRef.path,'.harness/events.jsonl');assert.equal(gap.eventsRef.path,eventRef.path);
  assert(gap.eventsRef.bytes>eventRef.bytes);
  await io.prefix(eventRef);const bytes=await io.prefix(gap.eventsRef);
  const appended=bytes.subarray(eventRef.bytes,gap.eventsRef.bytes).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  equal(appended,gap.events,'The finite gap contains exactly its six genuine events');
  for(const ref of gap.archives) await io.authenticate(ref);
  for(const row of gap.contexts) validateContextTelemetry(row.value,await io.json(row.path));
  return {lifecycle:gap.lifecycle,eventRef:gap.eventsRef,
    contexts:gap.contexts.map(({path,value})=>({path,value})),paths:gap.archives.map(row=>row.path)};
}

// Validate actual states and exact packet consumption. No invented working
// snapshot is constructed, and the generic transfer validator is unchanged.
function validateParkedTransition(before,after,packet,events) {
  equal(before.features,after.features);const old=before.continuity,now=after.continuity;
  const mutable=new Set(['checkpoint','startedAt','resumedAt','phase','lastHandoff','generation','owner','retiredWorkerIds','handoff']);
  for(const key of new Set([...Object.keys(old),...Object.keys(now)]))if(!mutable.has(key))equal(now[key],old[key]);
  assert(['working','awaiting_resume'].includes(old.phase));assert.equal(now.generation,old.generation+1);
  if(old.phase==='awaiting_resume') {
    assert(old.handoff);const consumed=clone(packet);for(const key of ['resumedAt','drift','driftAccepted'])delete consumed[key];
    equal(consumed,old.handoff,'Only the actual parked packet may be consumed');
  } else assert.equal(old.handoff,null);
  equal(packet,now.lastHandoff);assert.notEqual(packet.id,old.lastHandoff?.id);assert.equal(packet.kind,'handoff');
  equal(packet.owner,old.owner);assert.equal(packet.selectedFeatureId,featureId);assert.equal(packet.featureRevision,after.features.revision);
  equal(packet.drift,[]);assert.equal(packet.driftAccepted,false);
  equal(now.retiredWorkerIds,[...(old.retiredWorkerIds??[]),old.owner.id]);assert.equal(new Set(now.retiredWorkerIds).size,now.retiredWorkerIds.length);
  const owner=now.owner;equal(Object.keys(owner).sort(),['claimedAt','featureId','generation','id','parentSessionId','source']);
  assert.equal(owner.source,'CODEX_THREAD_ID');assert.equal(owner.generation,now.generation);assert.equal(owner.featureId,featureId);
  assert.match(owner.id,/^[a-zA-Z0-9_./:-]{1,200}$/);assert(!now.retiredWorkerIds.includes(owner.id));
  assert(owner.parentSessionId===null||typeof owner.parentSessionId==='string'&&owner.parentSessionId.length>0);
  assert.equal(owner.claimedAt,packet.resumedAt);assert.equal(now.resumedAt,packet.resumedAt);
  assert.equal(events.length,2);const [ready,resumed]=events;
  equal([ready.type,resumed.type],['handoff.ready','worker.resumed']);equal([ready.handoffId,resumed.handoffId],[packet.id,packet.id]);
  equal([ready.generation,resumed.generation],[old.generation,now.generation]);assert.equal(ready.revision,after.features.revision);
  equal(resumed.drift,[]);assert.equal(resumed.driftAccepted,false);
  assert(Date.parse(ready.at)<=Date.parse(packet.resumedAt));assert(Date.parse(packet.resumedAt)<=Date.parse(resumed.at));
}
export function validateParkedSuccessor(before,after,proof) {
  assert.equal(before.continuity.phase,'awaiting_resume');assert.equal(after.continuity.phase,'working');assert.equal(after.continuity.handoff,null);
  validateParkedTransition(before,after,proof.packet,proof.events);
}
export function validateContinuationStep(before,after,proof) {
  if(before.continuity.phase==='awaiting_resume')return validateParkedSuccessor(before,after,proof);
  return validateContinuationTransfer(before,after,proof);
}
export function parseParkedObservation(observation) {
  assert.equal(observation.version,1);assert.equal(observation.kind,'independent-source-parked-observation');
  assert.equal(observation.readOnly,true);assert.equal(observation.historicalWorkingSnapshot,false);assert.equal(observation.phase,'awaiting_resume');
  assert(Number.isSafeInteger(observation.generation)&&observation.generation>0);
  assert.equal(observation.files.length,6);assert.equal(new Set(observation.files.map(row=>row.path)).size,6);
  const files=new Map(observation.files.map(ref=>{const bytes=Buffer.from(ref.raw,'utf8');
    assert.equal(bytes.length,ref.bytes);assert.equal(sha(bytes),ref.sha256);return [ref.path,{ref:{path:ref.path,bytes:ref.bytes,sha256:ref.sha256},bytes}];}));
  const read=name=>{const row=files.get(name);assert(row,`Missing parked input: ${name}`);return JSON.parse(row.bytes);};
  const lifecycle={features:read('.harness/features.json'),continuity:read('.harness/continuity.json')},now=lifecycle.continuity;
  assert.equal(now.phase,'awaiting_resume');assert.equal(now.generation,observation.generation);equal(now.owner,observation.owner);
  assert.equal(now.handoff?.id,observation.packetId);
  const contextPath=`.harness/context/${sha(now.owner.id)}.json`,context={path:contextPath,value:read(contextPath)};
  assert.equal(context.value.actorHash,sha(now.owner.id));assert.equal(context.value.version,1);assert.equal(context.value.role,'worker');
  const archives=[now.lastHandoff.id,now.handoff.id].map(id=>{const row=files.get(`.harness/history/progress/${id}.md`);assert(row);return row.ref;});
  const events=files.get('.harness/events.jsonl');assert(events);
  equal([...files.keys()].sort(),['.harness/features.json','.harness/continuity.json','.harness/events.jsonl',contextPath,...archives.map(row=>row.path)].sort());
  return {lifecycle,context,archives,events,observedAt:observation.observedAt};
}
export async function replayParkedTransfer({before,eventRef,admission,io}) {
  equal(admission.value.parentLifecycle,{generation:before.continuity.generation,sha256:canonicalHash(before),events:eventRef});
  const capture=parseParkedObservation(admission.observation),after=capture.lifecycle,now=after.continuity;
  assert.equal(eventRef.path,'.harness/events.jsonl');assert(capture.events.ref.bytes>eventRef.bytes);
  await io.prefix(eventRef);equal((await io.prefix(capture.events.ref)).subarray(0,capture.events.ref.bytes),capture.events.bytes);
  const suffix=capture.events.bytes.subarray(eventRef.bytes),lines=[];let start=0;
  for(let end=suffix.indexOf(10);end>=0;end=suffix.indexOf(10,start)) {
    assert(end>start);lines.push({value:JSON.parse(suffix.subarray(start,end)),end:eventRef.bytes+end+1});start=end+1;
  }
  assert.equal(start,suffix.length);assert.equal(lines.length,3,'Exactly ready/resumed and the next parked-ready event are required');
  validateParkedTransition(before,after,now.lastHandoff,lines.slice(0,2).map(row=>row.value));
  const pending=now.handoff,ready=lines[2].value;
  assert(pending);assert.equal(pending.kind,'handoff');assert.notEqual(pending.id,now.lastHandoff.id);equal(pending.owner,now.owner);
  assert.equal(pending.selectedFeatureId,featureId);assert.equal(pending.featureRevision,after.features.revision);
  for(const key of ['resumedAt','drift','driftAccepted'])assert(!Object.hasOwn(pending,key));
  assert.equal(ready.type,'handoff.ready');assert.equal(ready.handoffId,pending.id);assert.equal(ready.generation,now.generation);
  assert.equal(ready.revision,after.features.revision);
  assert(Date.parse(pending.createdAt)>=Date.parse(now.lastHandoff.resumedAt));
  assert(Date.parse(ready.at)>=Date.parse(pending.createdAt));assert(Date.parse(capture.observedAt)>=Date.parse(ready.at));
  for(const ref of capture.archives)await io.authenticate(ref);
  validateContextTelemetry(capture.context.value,await io.json(capture.context.path));
  // Authenticate the complete parked prefix above, but leave its genuine final
  // ready event for the next real resume's ordinary two-event consumption proof.
  const boundary=capture.events.bytes.subarray(0,lines[1].end);
  return {lifecycle:after,eventRef:{path:eventRef.path,bytes:boundary.length,sha256:sha(boundary)},
    contexts:[capture.context],paths:capture.archives.map(row=>row.path),references:[...admission.references,...capture.archives]};
}
async function parkedAdmission(ctx,lifecycle,eventRef,transferIo) {
  const first=ctx.amendment?.transferGap?.parkedBridge;assert(first,'Missing ordinary transfer requires an exact signed parked admission');
  const parentLifecycle={generation:lifecycle.continuity.generation,sha256:canonicalHash(lifecycle),events:eventRef};
  if(first.value.parentLifecycle.generation===parentLifecycle.generation){equal(first.value.parentLifecycle,parentLifecycle);return first;}
  return authenticateLaterParkedBridge({io:transferIo,continuation:ctx.ref,codeAuthority:first.ref,parentLifecycle});
}

// Replay the genuine generation180 working observation. The accepted drift and
// failed first resume remain historical facts; no ordinary transfer is invented.
export async function replayAvailability180({before,eventRef,recovery,io}) {
  const {diagnostic,working180:capture}=recovery;
  validateTranscriptAliasEvidence(diagnostic);
  assert.equal(before.continuity.generation,179);assert.equal(before.continuity.phase,'working');
  assert.equal(before.continuity.owner.id,'01a15069-7236-7a90-9865-370438955a5b');
  const predecessor=diagnostic.ownershipAtObservation.precedingTransferPin;
  assert.deepEqual(predecessor,{path:`${continuationDirectory}/transfer-179.json`,bytes:288742,
    sha256:'3ef1f33ab511dbe288089999b6a1515f6d1d006200d7c16dd40a02b97302e139'});
  equal(JSON.parse(await io.authenticate(predecessor)).lifecycle,before);
  assert.equal(capture.kind,'independent-source-working-observation');assert.equal(capture.version,1);
  assert.equal(capture.historicalWorkingSnapshot,true);assert.equal(capture.readOnly,true);assert.equal(capture.stableReadback,true);
  assert.equal(capture.generation,180);assert.equal(capture.phase,'working');
  assert.equal(capture.sourceRoot.replaceAll('\\','/').replace(/\/$/,''),'C:/Users/Jason/Documents/CoochieHarness');
  assert.equal(capture.files.length,6);assert.equal(new Set(capture.files.map(row=>row.path)).size,6);
  const rows=new Map(capture.files.map(row=>{
    const bytes=Buffer.from(row.raw);assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.sha256);
    return [row.path,{ref:{path:row.path,bytes:row.bytes,sha256:row.sha256},bytes}];
  }));
  const read=name=>{const row=rows.get(name);assert(row);return JSON.parse(row.bytes);};
  const after={features:read('.harness/features.json'),continuity:read('.harness/continuity.json')};
  equal(capture.owner,after.continuity.owner);
  assert.equal(after.continuity.owner.id,'01a15994-5827-7cf2-a0a1-bfd690a4270f');
  const packet=after.continuity.lastHandoff;
  assert.equal(packet.id,'handoff-20261020134731304-b2a3ab07');
  assert.equal(packet.resumedAt,'2026-10-20T14:01:19.581Z');
  assert.equal(packet.repository.available,false);
  assert.equal(packet.repository.head,'ed381928a5d6991c63f8878fe2c669fcb663b512');assert.equal(packet.repository.branch,'main');
  const eventRow=rows.get('.harness/events.jsonl');assert(eventRow);assert.equal(eventRef.path,eventRow.ref.path);
  assert(eventRow.ref.bytes>eventRef.bytes);
  await io.prefix(eventRef);equal((await io.prefix(eventRow.ref)).subarray(0,eventRow.ref.bytes),eventRow.bytes);
  const events=eventRow.bytes.subarray(eventRef.bytes).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    .filter(row=>['handoff.ready','worker.resumed'].includes(row.type));
  assert.equal(events.length,2);assert.equal(events[0].at,'2026-10-20T13:49:11.930Z');assert.equal(events[1].at,'2026-10-20T14:01:19.599Z');
  equal(packet.drift,['repository availability changed']);assert.equal(packet.driftAccepted,true);
  validateTransfer(before,after,{packet,events,driftDisposition:'availability-only'});
  assert(!(before.continuity.retiredWorkerIds??[]).includes(after.continuity.owner.id));
  const archives=[...rows.values()].filter(row=>row.ref.path.startsWith('.harness/history/progress/')).map(row=>row.ref);
  assert.equal(archives.length,2);
  assert(archives.some(row=>row.path===`.harness/history/progress/${packet.id}.md`));
  for(const ref of archives)await io.authenticate(ref);
  const contextPath=`.harness/context/${sha(after.continuity.owner.id)}.json`,context={path:contextPath,value:read(contextPath)};
  assert.equal(context.value.actorHash,sha(after.continuity.owner.id));assert.equal(context.value.role,'worker');
  validateContextTelemetry(context.value,await io.json(contextPath));
  assert(Date.parse(capture.observedAt)>=Date.parse(events[1].at));assert(Date.parse(capture.completedAt)>=Date.parse(capture.observedAt));
  return {lifecycle:after,eventRef:eventRow.ref,contexts:[context],paths:archives.map(row=>row.path),
    references:[...recovery.references,predecessor,...archives]};
}
export async function continuationTransfers(ctx,current,transferIo={
  json,pin:relative=>pinFile(sourceRoot,relative),prefix:ref=>authenticatePrefix(sourceRoot,ref),authenticate:ref=>authenticateFile(sourceRoot,ref)
}) {
  let lifecycle=ctx.snapshot.lifecycle;
  const contexts=[],paths=[],references=[];
  const initialEvents=ctx.snapshot.files.find(row=>row.path==='.harness/events.jsonl');
  let eventRef=initialEvents;
  while(lifecycle.continuity.generation<current.continuity.generation) {
    const recovery=ctx.amendment?.transferGap?.parkedBridge?.contextEpoch?.contextAdmission?.guardRecovery;
    if(lifecycle.continuity.generation===179&&current.continuity.generation>=180&&recovery) {
      const step=await replayAvailability180({before:lifecycle,eventRef,recovery,io:transferIo});
      lifecycle=step.lifecycle;eventRef=step.eventRef;contexts.push(...step.contexts);paths.push(...step.paths);
      references.push(...step.references);continue;
    }
    const admission=ctx.amendment?.transferGap;
    if(lifecycle.continuity.generation===168&&current.continuity.generation>=171&&admission) {
      const prior=admission.gap.pins.find(row=>row.path===`${continuationDirectory}/transfer-168.json`);
      assert(prior);await transferIo.authenticate(prior);
      const step=await replayFiniteTransferGap({before:lifecycle,eventRef,gap:admission.gap,nativeCurrent:ctx.body.nativeCurrent,io:transferIo});
      lifecycle=step.lifecycle;eventRef=step.eventRef;contexts.push(...step.contexts);paths.push(...step.paths);continue;
    }
    const name=`${continuationDirectory}/transfer-${lifecycle.continuity.generation+1}.json`;
    let record;
    try {record=await transferIo.json(name);}catch(error) {
      if(error.code!=='ENOENT')throw error;
      const admission=await parkedAdmission(ctx,lifecycle,eventRef,transferIo);
      const step=await replayParkedTransfer({before:lifecycle,eventRef,admission,io:transferIo});
      lifecycle=step.lifecycle;eventRef=step.eventRef;contexts.push(...step.contexts);paths.push(...step.paths);references.push(...step.references);continue;
    }
    validateContinuationStep(lifecycle,record.lifecycle,record.proof);
    await transferIo.prefix(eventRef); const next=record.events;
    const bytes=await transferIo.prefix(next);
    const events=bytes.subarray(eventRef.bytes,next.bytes).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
      .filter(row=>['handoff.ready','worker.resumed'].includes(row.type));
    equal(events,record.proof.events);
    assert.equal(record.proof.archive.path,`.harness/history/progress/${record.proof.packet.id}.md`);
    await transferIo.authenticate(record.proof.archive);paths.push(record.proof.archive.path);
    const contextPath=`.harness/context/${sha(record.lifecycle.continuity.owner.id)}.json`;
    assert.equal(record.context.path,contextPath);assert.equal(record.context.value.actorHash,sha(record.lifecycle.continuity.owner.id));
    assert.equal(record.context.value.role,'worker');validateContextTelemetry(record.context.value,await transferIo.json(contextPath));
    contexts.push(record.context); lifecycle=record.lifecycle;eventRef=next;
  }
  assert.equal(lifecycle.continuity.generation,current.continuity.generation);
  return {lifecycle,contexts,paths,eventRef,references};
}
// A successor retains the actual consumed packet before a later handoff can
// overwrite lastHandoff. No review or historical authority is regenerated.
export async function recordContinuationTransfer() {
  const ctx=await authenticateContinuation(),current=await owned(ctx.original);
  const before={...current,continuity:{...current.continuity,generation:current.continuity.generation-1}};
  const previous=await continuationTransfers(ctx,before);
  const eventRef=await pinFile(sourceRoot,'.harness/events.jsonl');
  await authenticatePrefix(sourceRoot,previous.eventRef);
  const bytes=await authenticateFile(sourceRoot,eventRef);
  const events=bytes.subarray(previous.eventRef.bytes).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    .filter(row=>['handoff.ready','worker.resumed'].includes(row.type));
  const packet=current.continuity.lastHandoff;
  const proof={packet,events,archive:await pinFile(sourceRoot,`.harness/history/progress/${packet.id}.md`)};
  validateContinuationStep(previous.lifecycle,current,proof);
  const contextPath=`.harness/context/${sha(current.continuity.owner.id)}.json`;
  return save(`${continuationDirectory}/transfer-${current.continuity.generation}.json`,{version:1,lifecycle:current,proof,events:eventRef,
    context:{path:contextPath,value:await json(contextPath)}});
}
export function validateGateProtocol(before,gate,continuation) {
  assert(gate); equal(before.bindings.references.find(row=>row.path===bodyPath),continuation);
  assert.equal(before.feature.id,featureId);
  return [`${gateDirectory}/before.json`,`${gateDirectory}/stdout.log`,`${gateDirectory}/stderr.log`,
    ...(gate.mode==='completed'?[`${gateDirectory}/invocation.json`,`${gateDirectory}/receipt.json`]:[])];
}
async function gateProtocolPaths(gate,continuation) {
  if(!gate) return [];
  const paths=validateGateProtocol(await json(`${gateDirectory}/before.json`),gate,continuation);
  // These exact artifacts are validated by the independent post-gate chain.
  paths.push(exoClearanceAuditPath,exoClearanceContinuePath,`${exoClearanceContinuePath}.epoch.json`,exoClearancePath,`${directory}/execution/post-gate-exo-source-continuity.json`);
  for(const name of ['doctor','bootstrap']) for(const stream of ['stdout','stderr']) paths.push(`${directory}/execution/post-gate-exo-${name}.${stream}.log`);
  return paths;
}
function stage(ctx,completed) {
  const row=ctx.body.nativeStages.find(row=>canonicalHash(row.completed)===canonicalHash(completed));assert(row,'Unreviewed native stage');return row.semanticSha256;
}
export function validateNativeReceipt(receipt,authority,completed,index,beforeSemantic,afterSemantic) {
  assert.equal(receipt.confirmed,true);
  validateNativeSet(receipt.before,authority,completed,beforeSemantic);
  validateNativeSet(receipt.observed,authority,completed,beforeSemantic,index);
  equal(receipt.observed.raw,receipt.before.raw);assert.equal(receipt.observed.version,receipt.before.version);
  validateNativeSet(receipt.after,authority,[...completed,index],afterSemantic);
  assert.equal(receipt.expectedSemanticSha256,afterSemantic);
  const needed=canonicalHash(receipt.before.trust)!==canonicalHash(receipt.after.trust);
  assert.equal(receipt.writeCount,needed?1:0);
  if(needed) {
    const request=receipt.request;equal(Object.keys(request).sort(),['edits','expectedVersion','filePath','reloadUserConfig']);
    assert.equal(request.filePath,receipt.observed.raw.path);assert.equal(request.expectedVersion,receipt.observed.version);assert.equal(request.reloadUserConfig,true);
    assert.equal(request.edits.length,1);const edit=request.edits[0];equal(Object.keys(edit).sort(),['keyPath','mergeStrategy','value']);
    assert.equal(edit.keyPath,'hooks.state');assert.equal(edit.mergeStrategy,'replace');
    const rows=clone(authority.nativeTrustRows);for(const row of authority.nativeTransitions) if([...completed,index].includes(row.index)) rows[row.key].trusted_hash=row.after;
    equal(edit.value,rows);
    assert(receipt.response===null||typeof receipt.response==='object');
  } else {assert.equal(receipt.request,null);assert.equal(receipt.responseError,null);}
}

async function confirmed(ctx,index,{reviewed=true,sourceRelease}={}) {
  assert.notEqual(index,4);
  const ref=await pinFile(sourceRoot,slot(index,'receipt')), receipt=await pinned(ref);
  equal(receipt.continuation,ctx.ref); assert.equal(receipt.confirmed,true); assert.equal(receipt.index,index); assert.equal(receipt.root,targets[index]);
  equal(receipt.authority,ctx.original.authority); equal(receipt.sourceClosure,ctx.original.closure);
  const reservation=await pinned(receipt.reservation);
  equal(reservation.continuation,ctx.ref); assert.equal(reservation.index,index); assert.equal(reservation.expectedPlanHash,receipt.expectedPlanHash);
  assert.equal(reservation.actor,receipt.actor); assert.equal(reservation.root,targets[index]);
  equal(reservation.originalPlan,ctx.original.value.targets[index].plan);
  const frozen=await pinned(ctx.original.value.targets[index].plan);
  if(index!==0) assert.equal(receipt.expectedPlanHash,frozen.planHash);
  const reconciled=receipt.kind==='fix-nine-rollout-source0-reconciled';
  if(reconciled) {
    assert.equal(index,0);await validateReconciledSource0(ctx,receipt);
  } else {
    assert.equal(receipt.kind,'fix-nine-rollout-continuation-applied');
    const sync=clone(receipt.sync);equal(sync.nativeHookApproval,{status:'skipped',reason:'source-repair-never-approves-hooks'});delete sync.nativeHookApproval;
    if(index) equal(sync,frozen);else validateSourcePlan(ctx.snapshot.sourcePlan,sync);
    equal(receipt.sync.planHash,receipt.expectedPlanHash);assert.equal(receipt.native.confirmed,true);
    const position=continuationOrder.indexOf(index),completed=continuationOrder.slice(0,position);
    validateNativeReceipt(receipt.native,currentNativeAuthority(ctx),completed,index,stage(ctx,completed),stage(ctx,[...completed,index]));
    assert.equal(receipt.native.after.unrelatedSha256,receipt.native.before.unrelatedSha256);
  }
  equal(receipt.targetFiles.map(row=>row.path),frozen.operations.filter(row=>row.action!=='remove').map(row=>row.path));
  validatePilotAudit(receipt.audit); validateCommands(receipt.commands,targets[index],receipt.finishedAt);
  if(index) await preservation(ctx.original,index,true); else await sourcePreservation(ctx,sourceRelease);
  const repair=ctx.amendment?.transferGap?.parkedBridge?.contextEpoch?.contextAdmission?.value.sourceInstalledHookRepair;
  await forEachBounded(receipt.targetFiles.filter(row=>index!==0||!lifecyclePaths.has(row.path)),
    row=>index===0?authenticatePreservedSourceFile(row,{repair,root:targets[index],index,io}):authenticateFile(targets[index],row));
  const references=[ref,receipt.reservation];
  if(reconciled) references.push(receipt.savedOutcome,...ctx.amendment.references);
  let auditRef;
  if(reviewed) {
    auditRef=await pinFile(sourceRoot,slot(index,'audit')); const audit=await pinned(auditRef);
    equal(audit.apply,ref); equal(audit.continuation,ctx.ref); assert.equal(audit.index,index); assert.equal(audit.root,targets[index]);
    validatePilotAudit(audit.audit); validateCommands(audit.commands,targets[index],audit.at);
    references.push(auditRef);
  }
  return {ref,receipt,auditRef,references};
}
async function prior(ctx,index) {
  const position=continuationOrder.indexOf(index); assert(position>0,'Exo pilot cannot be applied again');
  for(const earlier of continuationOrder.slice(1,position)) await confirmed(ctx,earlier);
  return continuationOrder.slice(0,position);
}
async function startup(root,name) {
  const args=name==='doctor'?['doctor']:['bootstrap','--validate','--json'], startedAt=new Date().toISOString();
  const {stdout,stderr}=await run(process.execPath,['.harness/run.mjs',...args],{cwd:root,
    env:cleanEnvironment(await readJson(root,'.harness/config.json'),null),windowsHide:true,timeout:300000,maxBuffer:8*1024*1024});
  if(name==='bootstrap') assert.equal(JSON.parse(stdout).validation.healthy,true);
  else assert(stdout.startsWith(`Harness doctor: ${root} (runtime v`));
  return {command:`node .harness/run.mjs ${args.join(' ')}`,startedAt,finishedAt:new Date().toISOString(),stdout,stderr,exitCode:0};
}
export function validateCommands(commands,root,at) {
  equal(commands.map(row=>row.command),['node .harness/run.mjs doctor','node .harness/run.mjs bootstrap --validate --json']);
  for(const row of commands) { assert.equal(row.exitCode,0); assert(Date.parse(row.startedAt)<=Date.parse(row.finishedAt)); assert(Date.parse(row.finishedAt)<=Date.parse(at)); }
  assert(commands[0].stdout.startsWith(`Harness doctor: ${root} (runtime v`));
  assert.equal(JSON.parse(commands[1].stdout).validation.healthy,true);
}
async function currentStartup(root) { const rows=[]; for(const name of ['doctor','bootstrap']) rows.push(await startup(root,name)); return rows; }

// This wrapper is deliberately incapable of issuing a native mutation.
export function readOnlyReconciliationClient(client) {
  return {rpc(method,params) {assert(['config/read','hooks/list'].includes(method),'Reconciliation permits native reads only');return client.rpc(method,params);}};
}
export async function observeSource0Reconciliation({preserve,readPlan,validatePlan,readNative,validateNative,readAudit,readStartup}) {
  await preserve();const plan=await readPlan();validatePlan(plan);
  const before=await readNative();validateNative(before,'before');
  const audit=await readAudit(),commands=await readStartup();
  await preserve();const after=await readNative();validateNative(after,'after');equal(after,before,'Native state changed during reconciliation');
  const finalPlan=await readPlan();validatePlan(finalPlan);equal(finalPlan,plan,'Source plan changed during reconciliation');
  return {planObservation:plan,nativeObservation:{before,after},audit,commands};
}
async function savedSource0Attempt(ctx) {
  assert(ctx.amendment,'Source0 reconciliation requires its separately reviewed finite supplement');
  const value=ctx.amendment.value,refs=value.savedFailure;
  assert.equal(refs.reservation.path,slot(0,'reservation'));assert.equal(refs.outcome.path,slot(0,'outcome'));
  const reservation=await pinned(refs.reservation),outcome=await pinned(refs.outcome);
  equal(reservation.continuation,ctx.ref);assert.equal(reservation.index,0);assert.equal(reservation.root,targets[0]);
  equal(reservation.originalPlan,ctx.original.value.targets[0].plan);
  assert.equal(reservation.expectedPlanHash,value.originalExpectedPlanHash);
  equal(outcome.continuation,ctx.ref);equal(outcome.reservation,refs.reservation);assert.equal(outcome.index,0);
  assert.equal(outcome.phase,'native-confirmed');assert.equal(outcome.confirmed,false);assert.equal(outcome.automaticRetry,false);
  assert.equal(outcome.errorSha256,'a22c6de2c1194583d436d4fcbc06564c1a2479cac4b3ac31d1e6ef8270477640');
  assert(Date.parse(outcome.at)>=Date.parse(reservation.startedAt));
  assert.equal(stage(ctx,[4]),stage(ctx,[4,0]),'Source0 reconciliation cannot authorize a native transition');
  return {reservation,outcome};
}
function validateSource0Observation(ctx,plan) {
  validateSourcePlan(ctx.snapshot.sourcePlan,plan);assert.equal(plan.operations.length,28);
  assert(plan.operations.every(row=>row.action==='preserve'));
  assert.equal(plan.planHash,canonicalHash(Object.fromEntries(Object.entries(plan).filter(([key])=>key!=='planHash'))));
}
async function validateReconciledSource0(ctx,receipt) {
  const {reservation,outcome}=await savedSource0Attempt(ctx);
  equal(receipt.reconciliationAuthority,ctx.amendment.ref);equal(receipt.savedOutcome,ctx.amendment.value.savedFailure.outcome);
  equal(receipt.reservation,ctx.amendment.value.savedFailure.reservation);assert.equal(receipt.expectedPlanHash,reservation.expectedPlanHash);
  assert.equal(receipt.syncRetried,false);assert.equal(receipt.nativeWriteCount,0);assert.equal(receipt.historicalSnapshotsAvailable,false);
  assert(!Object.hasOwn(receipt,'sync'));assert(!Object.hasOwn(receipt,'native'));
  validateSource0Observation(ctx,receipt.planObservation);
  validateNativeSet(receipt.nativeObservation.before,currentNativeAuthority(ctx),[4],stage(ctx,[4]));
  validateNativeSet(receipt.nativeObservation.after,currentNativeAuthority(ctx),[4,0],stage(ctx,[4,0]));
  equal(receipt.nativeObservation.after,receipt.nativeObservation.before);
  equal(receipt.nativeObservation.before.raw,ctx.body.nativeCurrent.raw);
  assert(Date.parse(receipt.startedAt)>Date.parse(outcome.at));assert(Date.parse(receipt.finishedAt)>=Date.parse(receipt.startedAt));
}
export async function reconcileContinuationSource0({executable}={}) {
  const ctx=await authenticateContinuation();await owned(ctx.original);await prior(ctx,0);
  const {reservation}=await savedSource0Attempt(ctx),startedAt=new Date().toISOString();
  // Exclusive receipt creation, with the original reservation/outcome retained.
  try {await pinFile(sourceRoot,slot(0,'receipt'));throw new Error('Source0 already has a receipt');}
  catch(error) {if(error.code!=='ENOENT') throw error;}
  const client=await connectNativeHookClient({executable});
  try {
    const observation=await observeSource0Reconciliation({
      preserve:()=>sourcePreservation(ctx),readPlan:async()=>clone(await planSync(targets[0],{approveNativeHooks:false})),
      validatePlan:plan=>validateSource0Observation(ctx,plan),
      readNative:async()=>(await nativeRead(readOnlyReconciliationClient(client))).summary,
      validateNative:(summary,when)=>{validateNativeSet(summary,currentNativeAuthority(ctx),when==='before'?[4]:[4,0],stage(ctx,[4]));equal(summary.raw,ctx.body.nativeCurrent.raw);},
      readAudit:async()=>{const result=clone(await auditHarness(targets[0]));validatePilotAudit(result);return result;},
      readStartup:()=>currentStartup(targets[0])});
    await owned(ctx.original);
    const receipt={version:1,kind:'fix-nine-rollout-source0-reconciled',confirmed:true,continuation:ctx.ref,
      authority:ctx.original.authority,sourceClosure:ctx.original.closure,index:0,root:targets[0],actor:reservation.actor,
      reconciledBy:actor(),reservation:ctx.amendment.value.savedFailure.reservation,savedOutcome:ctx.amendment.value.savedFailure.outcome,
      reconciliationAuthority:ctx.amendment.ref,expectedPlanHash:reservation.expectedPlanHash,syncRetried:false,nativeWriteCount:0,
      historicalSnapshotsAvailable:false,...observation,
      targetFiles:await mapBounded(observation.planObservation.operations,row=>pinFile(targets[0],row.path)),startedAt,finishedAt:new Date().toISOString()};
    await validateReconciledSource0(ctx,receipt);validateCommands(receipt.commands,targets[0],receipt.finishedAt);
    return save(slot(0,'receipt'),receipt);
  } finally {await client.close();}
}

export async function executeContinuationTarget(index,{executable}={}) {
  const ctx=await authenticateContinuation(); await owned(ctx.original); const completed=await prior(ctx,index);
  await sourcePreservation(ctx);
  const target=ctx.original.value.targets[index], frozen=await pinned(target.plan);
  const plan=clone(await planSync(target.root,{approveNativeHooks:false}));
  if(index===0) validateSourcePlan(ctx.snapshot.sourcePlan,plan); else { equal(plan,frozen); await preservation(ctx.original,index,false); }
  const client=await connectNativeHookClient({executable}); let reservation=null,phase='before-reservation';
  try {
    const before=await nativeRead(client);
    equal(before.layer.config.hooks.state,nativeExpected(ctx.original.value,before.layer.config,completed).hooks.state);
    validateNativeSet(before.summary,currentNativeAuthority(ctx),completed,stage(ctx,completed));
    reservation=await save(slot(index,'reservation'),{version:1,continuation:ctx.ref,index,root:target.root,expectedPlanHash:plan.planHash,
      originalPlan:target.plan,actor:actor(),startedAt:new Date().toISOString()});
    phase='sync-started'; await owned(ctx.original);
    const result=clone(await syncHarness(target.root,{expectedPlanHash:plan.planHash,approveNativeHooks:false}));
    assert.equal(result.planHash,plan.planHash); phase='sync-confirmed';
    const observed=await nativeRead(client); validateNativeSet(observed.summary,currentNativeAuthority(ctx),completed,before.summary.semanticSha256,index);
    equal(observed.summary.raw,before.summary.raw,'Native raw config changed before CAS');
    assert.equal(observed.summary.version,before.summary.version,'Native version changed before CAS');
    const expected=nativeExpected(ctx.original.value,observed.layer.config,[...completed,index]);
    assert.equal(canonicalHash(expected),stage(ctx,[...completed,index]));
    const request={filePath:observed.layer.name.file,expectedVersion:observed.layer.version,reloadUserConfig:true,
      edits:[{keyPath:'hooks.state',mergeStrategy:'replace',value:expected.hooks.state}]};
    const needsWrite=canonicalHash(observed.layer.config)!==canonicalHash(expected); let response=null,responseError=null;
    await owned(ctx.original); phase=needsWrite?'native-request-started':'native-unchanged';
    if(needsWrite) try { response=await client.rpc('config/batchWrite',request); } catch(error) {responseError={code:error.code??null,message:String(error.message)};}
    const after=await nativeRead(client); equal(after.layer.config,expected,'Unknown native outcome; no automatic retry');
    validateNativeSet(after.summary,currentNativeAuthority(ctx),[...completed,index],stage(ctx,[...completed,index])); phase='native-confirmed';
    if(index) await preservation(ctx.original,index,true); else await sourcePreservation(ctx);
    const audit=clone(await auditHarness(target.root)); validatePilotAudit(audit);
    const commands=await currentStartup(target.root);
    const targetFiles=await mapBounded(plan.operations.filter(row=>row.action!=='remove'),row=>pinFile(target.root,row.path));
    return save(slot(index,'receipt'),{version:1,kind:'fix-nine-rollout-continuation-applied',confirmed:true,continuation:ctx.ref,
      authority:ctx.original.authority,sourceClosure:ctx.original.closure,index,root:target.root,actor:actor(),reservation,
      expectedPlanHash:plan.planHash,sync:result,targetFiles,audit,commands,finishedAt:new Date().toISOString(),
      native:{before:before.summary,observed:observed.summary,after:after.summary,request:needsWrite?request:null,response,responseError,
        expectedSemanticSha256:canonicalHash(expected),confirmed:true,writeCount:needsWrite?1:0}});
  } catch(error) {
    if(reservation) await save(slot(index,'outcome'),{version:1,continuation:ctx.ref,reservation,index,phase,confirmed:false,
      automaticRetry:false,errorSha256:sha(String(error)),at:new Date().toISOString()});
    throw error;
  } finally {await client.close();}
}

export async function auditContinuationTarget(index) {
  const ctx=await authenticateContinuation(); await owned(ctx.original); await prior(ctx,index);
  const {ref,receipt}=await confirmed(ctx,index,{reviewed:false});
  const audit=clone(await auditHarness(targets[index])); validatePilotAudit(audit);
  const commands=await currentStartup(targets[index]);
  const auditRef=await save(slot(index,'audit'),{version:1,kind:'fix-nine-rollout-continuation-target-audit',continuation:ctx.ref,
    apply:ref,index,root:targets[index],actor:actor(),audit,commands,at:new Date().toISOString()});
  return {audit:auditRef,index,confirmed:true,nextIndex:continuationOrder[continuationOrder.indexOf(index)+1]??null};
}

export function confirmedReportRow(index,result) {
  assert(result.auditRef,'Reviewed confirmation requires an explicit audit reference');
  return {index,root:targets[index],apply:result.ref,audit:result.auditRef};
}
async function allConfirmed(ctx,sourceRelease) {
  const rows=[{index:4,root:targets[4],apply:ctx.body.pilot.receipt,continue:ctx.body.pilot.resultReview}];
  const references=[];
  for(const index of continuationOrder.slice(1)) {const result=await confirmed(ctx,index,{sourceRelease}); rows.push(confirmedReportRow(index,result));
    references.push(...result.references);}
  rows.sort((a,b)=>a.index-b.index); validateRoots(rows); return {rows,references};
}
export const nineReportPath=`${continuationDirectory}/nine-report.json`;
export const nineConsumerIndices=Object.freeze([1,2,3,5,6,7,8,9,10]);
export function completionScope(allEleven=false) {
  return allEleven
    ? {scope:'continuation-final-all-eleven-after-deployment-and-current-startup',kind:'fix-nine-rollout-deployed',indices:targets.map((_,i)=>i),currentIndices:targets.map((_,i)=>i),reportPath,auditPath:`${continuationDirectory}/final-audit.json`,reviewPath:`${continuationDirectory}/final-continue.json`}
    : {scope:'continuation-final-exact-nine-with-source-reconciliation',kind:'fix-nine-rollout-nine-deployed',indices:[...nineConsumerIndices],currentIndices:[0,...nineConsumerIndices],reportPath:nineReportPath,auditPath:`${continuationDirectory}/nine-final-audit.json`,reviewPath:`${continuationDirectory}/nine-final-continue.json`};
}
export function validateCompletionScope(value,allEleven=false) {
  const scope=completionScope(allEleven);
  assert.equal(value.kind,scope.kind);assert.equal(value.scope,scope.scope);assert.equal(value.holdCleared,false);
  equal(value.targets.map(row=>row.index),scope.indices);
  for(const row of value.targets) assert.equal(row.root,targets[row.index]);
  if(!allEleven) {
    assert.equal(value.sourceReconciliation.index,0);assert.equal(value.sourceReconciliation.root,targets[0]);
    assert.equal(value.historicalPilot.index,4);assert.equal(value.historicalPilot.root,targets[4]);
    assert.equal(value.historicalPilot.scope,'completed-pilot-only');
  }
  return scope;
}
export function validateCurrentExoPolicy(runtime,config) {
  assert.equal(config.policies.maxAttempts,5);assert.equal(config.policies.maxRepeatedFailures,2);
  assert.match(runtime,/effectiveMaxAttempts:\s*Math\.min\(globalMaxAttempts,\s*featureMaxAttempts\s*\?\?\s*globalMaxAttempts\)/);
  assert.match(runtime,/budget\.effectiveMaxAttempts\s*===\s*Math\.min\(budget\.globalMaxAttempts,\s*budget\.featureMaxAttempts\s*\?\?\s*budget\.globalMaxAttempts\)/);
}
async function currentExoObservation() {
  const root=targets[4],files=['.harness/run.mjs','.harness/config.json','.harness/features.json','.harness/continuity.json','.harness/events.jsonl'];
  const refs=await Promise.all(files.map(file=>pinFile(root,file)));
  const runtime=(await authenticateFile(root,refs[0])).toString('utf8'),config=JSON.parse(await authenticateFile(root,refs[1]));
  validateCurrentExoPolicy(runtime,config);
  for(const ref of refs) await authenticateFile(root,ref);
  return {kind:'current-exo-policy-observation',root,refs};
}
const finalReviewBody=(ctx,scope,audit,actorId)=>({scope:scope.scope,continuation:ctx.ref,
  authority:ctx.original.authority,audit,targetRoots:scope.currentIndices.map(index=>targets[index]),actor:actorId,verdict:'CONTINUE'});
const completionRows=(rows,scope)=>rows.filter(row=>scope.indices.includes(row.index));
export async function prepareContinuationFinal({executable,allEleven=false}={}) {
  const ctx=await authenticateContinuation(); await owned(ctx.original); const {rows}=await allConfirmed(ctx);
  const scope=completionScope(allEleven),exoBefore=allEleven?await currentExoObservation():null;
  const checks=[];
  for(const index of scope.currentIndices) {const audit=clone(await auditHarness(targets[index]));validatePilotAudit(audit);
    checks.push({index,root:targets[index],audit,commands:await currentStartup(targets[index])});}
  if(allEleven) equal(await currentExoObservation(),exoBefore,'Exo changed during current all-eleven checks');
  const client=await connectNativeHookClient({executable});
  try {
    const native=await nativeRead(client); equal(native.layer.config.hooks.state,nativeExpected(ctx.original.value,native.layer.config,continuationOrder).hooks.state);
    validateNativeSet(native.summary,currentNativeAuthority(ctx),continuationOrder,stage(ctx,continuationOrder));
    const ref=await save(scope.auditPath,{version:1,kind:'fix-nine-rollout-continuation-final-audit',scope:scope.scope,
      continuation:ctx.ref,targets:completionRows(rows,scope),sourceReconciliation:rows.find(row=>row.index===0),
      historicalPilot:{...rows.find(row=>row.index===4),scope:'completed-pilot-only'},checks,currentExo:exoBefore,
      native:native.summary,actor:actor(),at:new Date().toISOString()});
    return {audit:ref,reviewBody:finalReviewBody(ctx,scope,ref,actor())};
  } finally {await client.close();}
}
export async function writeContinuationReport({allEleven=false}={}) {
  const ctx=await authenticateContinuation();await owned(ctx.original);const {rows}=await allConfirmed(ctx);
  const scope=completionScope(allEleven),finalAudit=await pinFile(sourceRoot,scope.auditPath),audit=await pinned(finalAudit);
  equal(audit.targets,completionRows(rows,scope));assert.equal(audit.scope,scope.scope);
  const finalContinue=await pinFile(sourceRoot,scope.reviewPath);
  await authenticateContinuationReview({io,reviewRef:finalContinue,kind:'product-audit',body:finalReviewBody(ctx,scope,finalAudit,audit.actor)});
  if(allEleven) await currentExoObservation();
  return save(scope.reportPath,{version:1,kind:scope.kind,scope:scope.scope,featureId,authority:ctx.original.authority,sourceClosure:ctx.original.closure,
    continuation:ctx.ref,targets:audit.targets,sourceReconciliation:audit.sourceReconciliation,historicalPilot:audit.historicalPilot,
    finalAudit,finalContinue,hold:allEleven?'pending-real-final-gate-and-independent-post-gate-exo-clearance':'all-eleven-pending-current-exo-and-separate-clearance',holdCleared:false});
}
export async function authenticateContinuationDeployment({root=sourceRoot,sourceRelease,executable,allEleven=false}={}) {
  assert.equal(path.resolve(root),sourceRoot);const ctx=await authenticateContinuation();const {rows,references}=await allConfirmed(ctx,sourceRelease);
  const scope=completionScope(allEleven),report=await pinFile(sourceRoot,scope.reportPath),value=await pinned(report);
  validateCompletionScope(value,allEleven);equal(value.targets,completionRows(rows,scope));equal(value.continuation,ctx.ref);
  equal(value.sourceReconciliation,rows.find(row=>row.index===0));
  equal(value.historicalPilot,{...rows.find(row=>row.index===4),scope:'completed-pilot-only'});
  equal(value.authority,ctx.original.authority);equal(value.sourceClosure,ctx.original.closure);
  const final=await pinned(value.finalAudit);equal(final.targets,value.targets);equal(final.continuation,ctx.ref);assert.equal(final.scope,scope.scope);
  equal(final.sourceReconciliation,value.sourceReconciliation);equal(final.historicalPilot,value.historicalPilot);
  equal(final.checks.map(row=>row.index),scope.currentIndices);
  if(allEleven) {assert.equal(final.currentExo.kind,'current-exo-policy-observation');await currentExoObservation();}
  else assert.equal(final.currentExo,null);
  for(const check of final.checks) {assert.equal(check.root,targets[check.index]);validatePilotAudit(check.audit);validateCommands(check.commands,check.root,final.at);}
  validateNativeSet(final.native,currentNativeAuthority(ctx),continuationOrder,stage(ctx,continuationOrder));
  const finalReviewProof=await authenticateContinuationReview({io,reviewRef:value.finalContinue,kind:'product-audit',body:finalReviewBody(ctx,scope,value.finalAudit,final.actor)});
  references.push(...finalReviewProof.refs);
  const client=await connectNativeHookClient({executable});
  try {const live=(await nativeRead(client)).summary;validateNativeSet(live,currentNativeAuthority(ctx),continuationOrder,stage(ctx,continuationOrder));
    equal(live.raw,final.native.raw);assert.equal(live.version,final.native.version);}
  finally {await client.close();}
  const exoBefore=allEleven?await currentExoObservation():null;
  for(const index of scope.currentIndices) validateCommands(await currentStartup(targets[index]),targets[index],new Date().toISOString());
  if(allEleven) equal(await currentExoObservation(),exoBefore);
  await sourcePreservation(ctx,sourceRelease);
  references.push(...(ctx.parkedTransferReferences??[]),ctx.ref,ctx.review,ctx.body.sourceBoundary,ctx.body.pilotAdvancement,ctx.body.archivedRouter,...(ctx.amendment?.sources??ctx.body.sources),...(ctx.amendment?.references??[]),...Object.values(ctx.body.pilot),
    ...Object.values(ctx.body.validation),
    ctx.original.originalReview,ctx.original.value.preparedSource,ctx.original.value.initialPreflight,ctx.original.value.nativePreservation,
    value.finalAudit,value.finalContinue);
  for(const target of ctx.original.value.targets) references.push(target.plan,target.preservation,target.originalPreservation);
  return {version:1,kind:'fix-nine-rollout-authenticated-deployment',scope:scope.scope,featureId,report,authority:ctx.original.authority,sourceClosure:ctx.original.closure,references};
}

async function saveBytes(relative,bytes) {
  await mkdir(path.dirname(path.join(sourceRoot,relative)),{recursive:true});
  await writeFile(path.join(sourceRoot,relative),bytes,{flag:'wx'});return pinFile(sourceRoot,relative);
}
export async function authenticateCurrentContinuationDeployment(options={}) {
  let allEleven=false;
  try {await readFile(path.join(sourceRoot,reportPath));allEleven=true;}
  catch(error) {if(error.code!=='ENOENT') throw error;}
  return authenticateContinuationDeployment({...options,allEleven});
}
export function requireAllElevenClearance(report) {
  validateCompletionScope(report,true);
  assert.equal(report.hold,'pending-real-final-gate-and-independent-post-gate-exo-clearance');
}
export async function continuationExoContext(sourceRelease) {
  const {authenticateGate}=await import('./fix-nine-rollout-continuation-gate.mjs');
  const gate=await authenticateGate({sourceRelease});assert.equal(gate.pass,true);assert.equal(gate.featureId,featureId);
  const receipt=await pinned(gate.receipt),deployment=receipt.bindings.deployment,report=await pinned(deployment.report);
  requireAllElevenClearance(report);
  await authenticateContinuationDeployment({sourceRelease,allEleven:true});
  const row=report.targets[4];assert.equal(row.index,4);assert.equal(row.root,targets[4]);
  await currentExoObservation();
  const applyActors=await Promise.all(report.targets.map(async target=>(await pinned(target.apply)).actor));
  await io.authenticate(gate.receipt);await io.authenticate(deployment.report);
  return {gate:gate.receipt,gateSealedAt:receipt.sealedAt,gateActor:receipt.invocation.actor,deployment,target:row,applyActors};
}
export async function prepareContinuationExoAudit() {
  const ctx=await authenticateContinuation();await owned(ctx.original,{passing:true});
  const current=await continuationExoContext();assert.equal(actor(),current.gateActor);
  const observation=await currentExoObservation();
  const commands=[];
  for(const name of ['doctor','bootstrap']) {
    const result=await startup(targets[4],name),prefix=`${directory}/execution/post-gate-exo-${name}`;
    commands.push({executable:process.execPath,args:['.harness/run.mjs',...(name==='doctor'?['doctor']:['bootstrap','--validate','--json'])],
      cwd:targets[4],startedAt:result.startedAt,finishedAt:result.finishedAt,
      outcome:{confirmed:true,exitCode:result.exitCode,signal:null,timedOut:false,error:null},
      logs:{stdout:await saveBytes(`${prefix}.stdout.log`,result.stdout),stderr:await saveBytes(`${prefix}.stderr.log`,result.stderr)}});
  }
  const sourceReleaseBoundary=await captureSourceReleaseBoundary(sourceRoot,saveBytes);
  const auditResult=clone(await auditHarness(targets[4]));validatePilotAudit(auditResult);
  const audit={version:1,kind:'fix-nine-rollout-exo-post-gate-audit',featureId,gate:current.gate,deployment:current.deployment,
    target:current.target,currentExo:observation,sourceReleaseBoundary,actor:actor(),at:new Date().toISOString(),audit:auditResult,
    startup:{healthy:true,commands},hold:'pending-independent-clearance',holdCleared:false};
  const references=[];await validateExoClearanceAudit(io,audit,current,references);
  equal(await currentExoObservation(),observation,'Exo changed during post-gate startup');
  equal(await continuationExoContext(),current);await authenticateOwnedReleaseBoundary(sourceRoot,sourceReleaseBoundary);
  for(const ref of references) await io.authenticate(ref);await owned(ctx.original,{passing:true});
  return {audit:await save(exoClearanceAuditPath,audit),reviewKind:'product-audit',reviewScope:'exo-after-authenticated-final-gate-and-current-startup',holdCleared:false};
}
export async function clearContinuationExoHold() {
  const ctx=await authenticateContinuation();await owned(ctx.original,{passing:true});
  const current=await continuationExoContext(),auditRef=await io.pin(exoClearanceAuditPath),audit=await pinned(auditRef);
  const reviewRef=await io.pin(exoClearanceContinuePath),references=[];
  await validateExoClearanceAudit(io,audit,current,references);validatePilotAudit(audit.audit);
  const standardReview=await pinned(reviewRef);
  const reviewProof=await authenticateContinuationReview({io,reviewRef,kind:'product-audit',body:exoClearanceReviewBody(auditRef,audit,standardReview.body?.actor)});
  validateExoClearanceReview(reviewProof.seal,auditRef,audit,current,reviewProof.publicKey);
  references.push(...reviewProof.refs);
  equal(await continuationExoContext(),current);await authenticateOwnedReleaseBoundary(sourceRoot,audit.sourceReleaseBoundary);
  for(const ref of [auditRef,reviewRef,...references]) await io.authenticate(ref);await owned(ctx.original,{passing:true});
  const receipt={version:1,kind:'fix-nine-rollout-exo-clearance',featureId,gate:current.gate,deployment:current.deployment,target:current.target,
    audit:auditRef,independentContinue:reviewRef,hold:'cleared',holdCleared:true,sealedAt:new Date().toISOString()};
  validateExoClearanceReceipt(receipt,{current,auditRef,audit,reviewRef},new Date().toISOString());
  await authenticateOwnedReleaseBoundary(sourceRoot,audit.sourceReleaseBoundary);await save(exoClearancePath,receipt);
  return authenticateContinuationClearance();
}
export async function authenticateContinuationClearance() {
  const auditRef=await io.pin(exoClearanceAuditPath),audit=await pinned(auditRef),reviewRef=await io.pin(exoClearanceContinuePath);
  const standard=await pinned(reviewRef);
  const proof=await authenticateContinuationReview({io,reviewRef,kind:'product-audit',body:exoClearanceReviewBody(auditRef,audit,standard.body?.actor)});
  const result=await authenticateExoClearanceWorkflow({root:sourceRoot,publicKey:proof.publicKey,context:continuationExoContext});
  for(const ref of proof.refs)await io.authenticate(ref);
  return {...result,recoveryReviewReferences:proof.refs};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [mode,index,supplementPath]=process.argv.slice(2);
  const result=mode==='reconcile0'?await reconcileContinuationSource0():mode==='prepare'?await prepareContinuation({validationPath:index,supplementPath}):mode==='apply'?await executeContinuationTarget(Number(index)):
    mode==='audit'?await auditContinuationTarget(Number(index)):mode==='final-audit'?await prepareContinuationFinal():
      mode==='final-audit-all-eleven'?await prepareContinuationFinal({allEleven:true}):
      mode==='report-all-eleven'?await writeContinuationReport({allEleven:true}):
      mode==='report'?await writeContinuationReport():mode==='authenticate'?await authenticateCurrentContinuationDeployment():
        mode==='transfer'?await recordContinuationTransfer():mode==='post-gate-audit'?await prepareContinuationExoAudit():
          mode==='clear'?await clearContinuationExoHold():mode==='authenticate-clearance'?await authenticateContinuationClearance():null;
  assert(result,'Unknown continuation command');console.log(JSON.stringify(result));
}

// Exact projections copied from the pinned release adapter.
function markdownItems(items, empty = 'None recorded.') {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : empty;
}

function renderProgress(checkpoint, phase, generation, generatedAt) {
  const active = checkpoint.activeFeatures.map((item) => `${item.id}: ${item.title}`);
  const files = checkpoint.repository.changedFiles.map((item) => `${item.status.trim() || 'M'} ${item.path}`);
  const omitted = checkpoint.repository.changedFileCount - checkpoint.repository.changedFiles.length;
  if (omitted > 0) files.push(`... ${omitted} more changed project files (see Git status)`);
  const phaseText = phase === 'awaiting_resume'
    ? `Awaiting a fresh worker for handoff \`${checkpoint.id}\``
    : `Working generation ${generation}`;
  return `# Progress\n\nGenerated: ${generatedAt}\n\nThis is a bounded current-state snapshot. Use Git history, \`.harness/events.jsonl\`, and evidence files for older history.\n\n## Current state\n\n- Continuity: ${phaseText}\n- Feature revision: ${checkpoint.featureRevision}\n- Active features: ${active.length}\n- Passing features: ${checkpoint.passingFeatureCount}\n- Branch: ${checkpoint.repository.branch || '(detached or unavailable)'}\n- Commit: ${checkpoint.repository.head ?? '(unavailable)'}\n- Project worktree: ${checkpoint.repository.available ? checkpoint.repository.clean ? 'clean' : 'dirty (preserved for worker resume)' : 'unavailable'}\n\n## Current summary\n\n${checkpoint.summary}\n\n## Active feature\n\n${markdownItems(active, 'None.')}\n\n## Blockers and risks\n\n${markdownItems(checkpoint.blockers)}\n\n## Decisions to preserve\n\n${markdownItems(checkpoint.decisions)}\n\n## Next executable step\n\n${checkpoint.next}\n\n## Changed project files\n\n${markdownItems(files, checkpoint.repository.clean ? 'None.' : 'Unavailable.')}\n\n## Latest evidence\n\n${markdownItems(checkpoint.evidence, 'None.')}\n`;
}

function renderWorkingHandoff(continuity, consumedHandoff = null, generatedAt) {
  const status = consumedHandoff ? 'CONSUMED_HANDOFF' : 'NO_PENDING_HANDOFF';
  const consumed = consumedHandoff
    ? `\n- Consumed handoff ID: \`${consumedHandoff.id}\`\n- Consumed at: ${consumedHandoff.resumedAt}`
    : '';
  const checkpoint = continuity.checkpoint?.id
    ? `\n- Latest checkpoint: \`${continuity.checkpoint.id}\``
    : '';
  return `# Worker Handoff\n\nGenerated: ${generatedAt}\n\n- Status: **${status}**\n- Continuity: working generation ${continuity.generation}${consumed}${checkpoint}\n\nNo worker handoff is pending. The persistent development orchestrator may continue in the current user chat.\n`;
}


export async function validateSourceProjections(continuity) {
  const progress=await readFile(new URL('../.harness/progress.md',import.meta.url),'utf8');
  const handoff=await readFile(new URL('../.harness/handoff.md',import.meta.url),'utf8');
  const time=text=>{const value=/^Generated: (.+)$/m.exec(text)?.[1];assert(Number.isFinite(Date.parse(value)));assert(Date.parse(value)<=Date.now());return value;};
  equal(progress,renderProgress(continuity.checkpoint,continuity.phase,continuity.generation,time(progress)));
  const consumed=handoff.includes('**CONSUMED_HANDOFF**')?continuity.lastHandoff:null;
  equal(handoff,renderWorkingHandoff(continuity,consumed,time(handoff)));
}
