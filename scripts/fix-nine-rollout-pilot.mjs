// One independently reviewed Exo deployment. Original review
// artifacts stay immutable; native worker ownership is checked at execution.
import assert from 'node:assert/strict';
import {readFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {sourceRoot, targets, directory, featureId} from './fix-nine-rollout-preflight.mjs';
import {canonicalHash, normalizedContract} from './fix-nine-rollout-evidence.mjs';
import {authenticateFile, exclusiveJson, pinFile, readJson} from './fix-nine-rollout-files.mjs';
import {authenticateSourceClosure} from './fix-nine-rollout-closure.mjs';
import {requiredHelpers} from './fix-nine-rollout-auth.mjs';
import {cleanEnvironment} from './fix-nine-rollout-gate.mjs';
import {authorityPath, composedPath, sealPath, reviewPublicKey, reviewPayload, validateReview, validateRoots,
  validateNative, validateNativeAuthority, validatePreservation} from './fix-nine-rollout-deployment.mjs';
import {planSync, syncHarness, auditHarness} from '../skill/codex-harness/scripts/lib/core.mjs';
import {connectNativeHookClient} from '../skill/codex-harness/scripts/lib/native-hook-client.mjs';

export const pilotIndex = 4;
export const pilotDirectory = `${directory}/pilot-exo`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = assert.deepEqual;
const clone = value => JSON.parse(JSON.stringify(value));
const json = file => readJson(sourceRoot, file);
const pinned = async ref => JSON.parse(await authenticateFile(sourceRoot, ref));
const save = async (file, value) => {
  await mkdir(path.dirname(path.join(sourceRoot, file)), {recursive:true});
  return exclusiveJson(sourceRoot, file, value);
};
const run = promisify(execFile);
const pilotSources = ['scripts/fix-nine-rollout-pilot.mjs', 'scripts/fix-nine-rollout-pilot.test.mjs'];
const externalPreservation = {path:'C:/Users/Jason/Documents/Codex/2026-10-17/re/outputs/exo-preservation-before-actual-rollout-20261018.json',
  sha256:'90ba9b2b10dbb6cf7f318aa745f85b3523d5586f399ea0ced7d2e1b94820c0d0'};

async function frozenExternalPreservation() {
  const bytes = await readFile(externalPreservation.path);
  assert.equal(sha(bytes), externalPreservation.sha256);
  const report = JSON.parse(bytes); assert.equal(path.resolve(report.targetRoot), path.resolve(targets[pilotIndex]));
  assert.equal(report.preservationChecksPassed, true);
  return {...externalPreservation,bytes:bytes.length};
}

async function liveOwner(authority) {
  const [continuity, features, config] = await Promise.all(['continuity', 'features', 'config'].map(name => json(`.harness/${name}.json`)));
  validatePilotOwner({continuity, features, config}, authority);
  return {actor:process.env.CODEX_THREAD_ID, generation:continuity.generation};
}

export async function authenticatePilotOriginal() {
  const [authority, closure, originalReview] = await Promise.all([authorityPath, composedPath, sealPath].map(file => pinFile(sourceRoot, file)));
  const [value, composed, seal] = await Promise.all([authority, closure, originalReview].map(pinned));
  validateReview(seal, 'execution-authority', {authority, sourceClosure:closure, targetRoots:targets, scope:'ordered-eleven-deployment-only'});
  assert.equal(value.kind, 'fix-nine-rollout-execution-authority'); assert.equal(value.version, 1);
  assert.equal(value.featureId, featureId); equal(value.targetRoots, targets); validateRoots(value.targets);
  equal(value.sourceClosure, closure); equal(value.preparedSource, composed.preparedSource);
  assert.equal(value.reviewPublicKeySha256, sha(reviewPublicKey));
  equal(composed.helperFiles.map(row => row.path).sort(), [...requiredHelpers].sort());
  await Promise.all(composed.helperFiles.map(ref => authenticateFile(sourceRoot, ref)));
  equal(await authenticateSourceClosure(value.preparedSource.path), value.preparedSource);
  const [initial, native] = await Promise.all([value.initialPreflight, value.nativePreservation].map(pinned));
  equal(value.nativeBaseline, {version:native.layerVersion, semanticSha256:native.semanticSha256,
    unrelatedSha256:native.unrelatedSha256, trust:native.trust, definitions:native.definitions, raw:native.raw});
  validateNativeAuthority(value);
  for (const target of value.targets) {
    equal(target.originalPreservation, initial.targets[target.index].preservation);
    await Promise.all([target.plan, target.preservation, target.originalPreservation].map(ref => authenticateFile(sourceRoot, ref)));
  }
  return {value, authority, closure, originalReview, initial};
}

export function validatePilotOwner({continuity, features, config}, authority, actor = process.env.CODEX_THREAD_ID) {
  assert(actor, 'Native worker identity required');
  assert.equal(continuity.phase, 'working');
  assert.equal(continuity.owner?.id ?? continuity.owner, actor, 'Current native worker must own pilot execution');
  assert(!continuity.retiredWorkerIds?.includes(actor), 'Retired worker cannot execute pilot');
  assert.equal(config.policies.maxAttempts, 5);
  assert.equal(config.policies.maxRepeatedFailures, 2);
  const original = authority.targets[0].lifecycle.features.features.find(row => row.id === featureId);
  const current = features.features.find(row => row.id === featureId);
  assert(original && current);
  assert.equal(current.status, 'active');
  equal(normalizedContract(current), normalizedContract(original), 'Source feature contract changed');
  equal(current.contract, original.contract);
  equal(current.scopeBaselineRef, original.scopeBaselineRef);
  assert(current.attempts >= original.attempts && current.attempts < 5);
}

export function validatePilotPlan(authority, frozen, current) {
  const target = authority.targets[pilotIndex];
  assert.equal(target.index, pilotIndex);
  assert.equal(target.root, targets[pilotIndex]);
  assert.equal(frozen.target, target.root);
  assert.equal(frozen.planHash, target.planHash);
  assert.equal(frozen.blocked, false);
  equal(current, frozen, 'Deployment inputs changed after material review');
  assert.equal(frozen.operations.filter(row => row.action === 'write').length, 8, 'Pilot must perform eight actual writes');
  return target;
}

export function pilotNativeState(authority, config) {
  equal(config.hooks.state, authority.nativeTrustRows, 'Full native trust rows changed');
  const state = clone(config.hooks.state);
  const transitions = authority.nativeTransitions.filter(row => row.index === pilotIndex);
  assert.equal(transitions.length, 6);
  for (const row of transitions) state[row.key] = {...state[row.key], trusted_hash:row.after};
  return state;
}

export function validatePilotNative(summary, authority, phase, expectedSemanticSha256) {
  assert(['before', 'observed', 'after'].includes(phase));
  if (phase === 'before') { validateNative(summary, authority, -1); return; }
  const baseline = authority.nativeBaseline;
  assert.equal(summary.raw.path, baseline.raw.path);
  assert(Number.isSafeInteger(summary.raw.bytes) && summary.raw.bytes > 0);
  assert.match(summary.raw.sha256, /^[a-f0-9]{64}$/); assert.equal(typeof summary.version, 'string'); assert(summary.version);
  assert.equal(summary.unrelatedSha256, baseline.unrelatedSha256);
  const trust = clone(baseline.trust);
  if (phase === 'after') for (const row of authority.nativeTransitions.filter(row => row.index === pilotIndex)) trust[row.key] = row.after;
  equal(summary.trust, trust);
  assert.equal(summary.semanticSha256, expectedSemanticSha256);
  assert.equal(summary.definitions.length, 66);
  assert.equal(new Set(summary.definitions.map(row => row.key)).size, 66);
  for (const definition of summary.definitions) {
    const transition = authority.nativeTransitions.find(row => row.key === definition.key); assert(transition);
    if (transition.index !== pilotIndex) { equal(definition, transition.beforeDefinition); continue; }
    const raw = clone(transition.afterRaw);
    if (phase === 'observed' && transition.before !== transition.after) raw.trustStatus = 'modified';
    equal(definition, {...transition.afterDefinition, trustStatus:raw.trustStatus, definitionSha256:canonicalHash(raw)});
  }
  if (phase === 'observed') { equal(summary.raw, baseline.raw); assert.equal(summary.version, baseline.version); }
}

function withoutTrust(config) {
  const copy = clone(config);
  for (const [key, row] of Object.entries(copy.hooks?.state ?? {})) {
    delete row.trusted_hash; if (!Object.keys(row).length) delete copy.hooks.state[key];
  }
  return copy;
}

async function nativeRead(client) {
  const file = path.join(process.env.CODEX_HOME ?? path.join(process.env.USERPROFILE, '.codex'), 'config.toml');
  const raw = await readFile(file);
  const result = await client.rpc('config/read', {includeLayers:true});
  const layers = result.layers?.filter(row => row.name?.type === 'user' && !row.name.profile && path.resolve(row.name.file) === path.resolve(file));
  assert.equal(layers?.length, 1); const layer = layers[0];
  equal(await readFile(file), raw, 'Native config drift before discovery');
  const discovery = await client.rpc('hooks/list', {cwds:targets});
  equal(await readFile(file), raw, 'Native config drift during discovery');
  equal(discovery.data.map(row => row.cwd), targets); assert(discovery.data.every(row => !row.errors?.length));
  const definitions = discovery.data.flatMap(row => row.hooks.filter(h => h.source === 'project' && h.sourcePath === path.join(row.cwd, '.codex/hooks.json')).map(h =>
    ({root:row.cwd,key:h.key,currentHash:h.currentHash,trustStatus:h.trustStatus,eventName:h.eventName,sourcePath:h.sourcePath,
      enabled:h.enabled,displayOrder:h.displayOrder,definitionSha256:canonicalHash(h),commandSha256:canonicalHash(h.command)})));
  return {layer, summary:{version:layer.version, semanticSha256:canonicalHash(layer.config), unrelatedSha256:canonicalHash(withoutTrust(layer.config)),
    trust:Object.fromEntries(Object.entries(layer.config.hooks?.state ?? {}).map(([key,row]) => [key,row.trusted_hash ?? null])),
    definitions, raw:{path:file,bytes:raw.length,sha256:sha(raw)}}};
}

async function prepared() {
  const original = await authenticatePilotOriginal();
  const owner = await liveOwner(original.value);
  const target = original.value.targets[pilotIndex];
  const plan = await pinned(target.plan);
  validatePilotPlan(original.value, plan, clone(await planSync(target.root, {approveNativeHooks:false})));
  await validatePreservation(target, original.initial.targets[pilotIndex], await pinned(target.preservation), plan);
  return {original, target, plan, owner};
}

async function reviewBody(original) {
  return {version:1, kind:'fix-nine-rollout-one-project-pilot-amendment', originalAuthority:original.authority,
    originalReview:original.originalReview, sourceClosure:original.closure, preparedSource:original.value.preparedSource,
    externalPreservation:await frozenExternalPreservation(),
    pilotSources:await Promise.all(pilotSources.map(file => pinFile(sourceRoot, file))),
    scope:'exo-index-4-only', index:pilotIndex, root:targets[pilotIndex],
    plan:original.value.targets[pilotIndex].plan, preservation:original.value.targets[pilotIndex].preservation,
    expectedPlanHash:original.value.targets[pilotIndex].planHash,
    rules:{amendsOriginalOrderForThisPilotOnly:true, actualWrites:8, nativeTransitions:6, otherTargetsUnchanged:10,
      preserveOtherDefinitions:60, preserveUnrelatedTrust:18, currentNativeOwnerRequired:true,
      immutableMaterialReviewSurvivesWorkerTransfer:true, exclusiveReservation:true, automaticRetry:false,
      maxAttempts:5, maxRepeatedFailures:2, exoHold:true, stopAfterPilot:true,
      clearance:'additive-pilot-only-after-actual-sync-native-CAS-preservation-startup-and-independent-product-audit',
      originalAllElevenFinalGateUnchanged:true}};
}

export async function preparePilot() {
  const {original} = await prepared();
  const body = await reviewBody(original);
  const ref = await save(`${pilotDirectory}/review-body.json`, body);
  return {reviewBody:ref, payloadSha256:sha(reviewPayload('execution-authority', body)), executionAuthorized:false};
}

async function startup(root, name) {
  const startedAt = new Date().toISOString();
  const args = name === 'doctor' ? ['doctor'] : ['bootstrap', '--validate', '--json'];
  const env = cleanEnvironment(await readJson(root, '.harness/config.json'), null);
  const {stdout, stderr} = await run(process.execPath, ['.harness/run.mjs', ...args], {cwd:root, env, windowsHide:true, timeout:300000, maxBuffer:8*1024*1024});
  if (name === 'bootstrap') assert.equal(JSON.parse(stdout).validation.healthy, true);
  else assert(stdout.startsWith(`Harness doctor: ${root} (runtime v`));
  return {command:`node .harness/run.mjs ${args.join(' ')}`, startedAt,finishedAt:new Date().toISOString(),stdout,stderr,exitCode:0};
}

export function validatePilotAudit(audit) {
  assert(Number.isFinite(audit.overall) && audit.overall >= 95, 'Pilot structural audit must score at least 95');
  assert.equal(audit.criticalFailures, 0);
}

async function otherPlans(authority) {
  return Promise.all(authority.targets.filter(row => row.index !== pilotIndex).map(async row =>
    ({index:row.index,root:row.root,sha256:canonicalHash(clone(await planSync(row.root, {approveNativeHooks:false})))})));
}

export async function applyPilot({executable} = {}) {
  const {original, target, plan} = await prepared();
  const body = await reviewBody(original);
  equal(await json(`${pilotDirectory}/review-body.json`), body, 'Material review inputs changed');
  const review = await json(`${pilotDirectory}/review.json`);
  validateReview(review, 'execution-authority', body);
  const reviewRef = await pinFile(sourceRoot, `${pilotDirectory}/review.json`);
  const client = await connectNativeHookClient({executable});
  let phase = 'before-reservation', reservation = null, result = null, before = null, observed = null, after = null;
  try {
    before = await nativeRead(client); validatePilotNative(before.summary, original.value, 'before');
    const othersBefore = await otherPlans(original.value);
    const owner = await liveOwner(original.value);
    reservation = await save(`${pilotDirectory}/reservation.json`, {version:1,kind:'fix-nine-rollout-pilot-reservation',
      originalAuthority:original.authority,review:reviewRef,index:pilotIndex,root:target.root,plan:target.plan,
      expectedPlanHash:target.planHash,...owner,startedAt:new Date().toISOString()});
    phase = 'sync-started';
    result = await syncHarness(target.root, {expectedPlanHash:target.planHash,approveNativeHooks:false});
    assert.equal(result.planHash, target.planHash);
    phase = 'sync-confirmed';
    observed = await nativeRead(client);
    validatePilotNative(observed.summary, original.value, 'observed', before.summary.semanticSha256);
    const state = pilotNativeState(original.value, observed.layer.config);
    const expected = clone(observed.layer.config); expected.hooks.state = state;
    const request = {filePath:observed.layer.name.file,expectedVersion:observed.layer.version,reloadUserConfig:true,
      edits:[{keyPath:'hooks.state',mergeStrategy:'replace',value:state}]};
    await liveOwner(original.value);
    phase = 'native-request-started';
    let response = null, responseError = null;
    try { response = await client.rpc('config/batchWrite', request); }
    catch (error) { responseError = {code:error.code ?? null,message:String(error.message)}; }
    after = await nativeRead(client);
    validatePilotNative(after.summary, original.value, 'after', canonicalHash(expected));
    equal(after.layer.config, expected, 'Native CAS result is indeterminate; no retry authorized');
    phase = 'native-confirmed';
    await validatePreservation(target, original.initial.targets[pilotIndex], await pinned(target.preservation), plan, {final:true});
    const audit = clone(await auditHarness(target.root));
    validatePilotAudit(audit);
    const commands = [];
    for (const name of ['doctor','bootstrap']) commands.push(await startup(target.root, name));
    const othersAfter = await otherPlans(original.value); equal(othersAfter, othersBefore, 'Another project changed during pilot');
    const targetFiles = await Promise.all(plan.operations.filter(row => row.action !== 'remove').map(row => pinFile(target.root, row.path)));
    const receipt = {version:1,kind:'fix-nine-rollout-pilot-applied',confirmed:true,index:pilotIndex,root:target.root,
      originalAuthority:original.authority,sourceClosure:original.closure,review:reviewRef,reservation,
      actor:process.env.CODEX_THREAD_ID,finishedAt:new Date().toISOString(),plan:target.plan,expectedPlanHash:target.planHash,
      sync:clone(result),targetFiles,native:{before:before.summary,observed:observed.summary,after:after.summary,request,response,responseError,
        expectedSemanticSha256:canonicalHash(expected),confirmed:true,writeCount:1},audit,commands,
      otherTargets:{before:othersBefore,after:othersAfter,unchanged:true},hold:'pending-independent-pilot-clearance',holdCleared:false};
    return save(`${pilotDirectory}/receipt.json`, receipt);
  } catch (error) {
    if (reservation) await save(`${pilotDirectory}/outcome.json`, {version:1,confirmed:false,reservation,phase,
      message:String(error.message),sync:result,native:{before:before?.summary,observed:observed?.summary,after:after?.summary},
      automaticRetry:false,finishedAt:new Date().toISOString()});
    throw error;
  } finally { await client.close(); }
}

export function pilotClearanceBody(receiptRef, receipt, reviewerActor) {
  assert.equal(receipt.confirmed, true); assert.equal(receipt.index, pilotIndex); assert.equal(receipt.root, targets[pilotIndex]);
  assert.equal(receipt.holdCleared, false); assert(reviewerActor); assert.notEqual(reviewerActor, receipt.actor);
  return {scope:'exo-index-4-only-after-confirmed-pilot-and-current-startup',receipt:receiptRef,
    originalAuthority:receipt.originalAuthority,materialReview:receipt.review,actor:reviewerActor,verdict:'CONTINUE'};
}

export async function clearPilot({executable} = {}) {
  const original = await authenticatePilotOriginal(); await liveOwner(original.value);
  equal(await json(`${pilotDirectory}/review-body.json`), await reviewBody(original));
  const receiptRef = await pinFile(sourceRoot, `${pilotDirectory}/receipt.json`), receipt = await pinned(receiptRef);
  const reviewRef = await pinFile(sourceRoot, `${pilotDirectory}/clearance-review.json`), review = await pinned(reviewRef);
  validateReview(review, 'product-audit', pilotClearanceBody(receiptRef, receipt, review.body?.actor));
  equal(receipt.originalAuthority, original.authority);
  const target = original.value.targets[pilotIndex], plan = await pinned(target.plan);
  await validatePreservation(target, original.initial.targets[pilotIndex], await pinned(target.preservation), plan, {final:true});
  for (const ref of receipt.targetFiles) await authenticateFile(target.root, ref);
  equal(await otherPlans(original.value), receipt.otherTargets.before);
  validatePilotAudit(await auditHarness(target.root));
  const client = await connectNativeHookClient({executable});
  try {
    const current = await nativeRead(client);
    validatePilotNative(current.summary, original.value, 'after', receipt.native.expectedSemanticSha256);
    await liveOwner(original.value);
    return save(`${pilotDirectory}/clearance.json`, {version:1,kind:'fix-nine-rollout-exo-pilot-clearance',receipt:receiptRef,
      independentContinue:reviewRef,hold:'cleared-for-this-pilot-only',holdCleared:true,originalAllElevenHoldUnchanged:true,
      actor:process.env.CODEX_THREAD_ID,sealedAt:new Date().toISOString()});
  } finally { await client.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === 'prepare') console.log(JSON.stringify(await preparePilot()));
  else if (mode === 'apply') console.log(JSON.stringify(await applyPilot()));
  else if (mode === 'clear') console.log(JSON.stringify(await clearPilot()));
  else throw new Error('Use prepare, apply, or clear; a reserved pilot never retries automatically');
}
