// Clearance-only correction: source development ownership is not an installation.
// The reviewed pilot, receipt, original authority and original helper stay immutable.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceRoot, targets} from './fix-nine-rollout-preflight.mjs';
import {canonicalHash} from './fix-nine-rollout-evidence.mjs';
import {authenticateFile, exclusiveJson, pinFile, readJson} from './fix-nine-rollout-files.mjs';
import {reviewPayload, validateReview, validatePreservation} from './fix-nine-rollout-deployment.mjs';
import {authenticatePilotOriginal, pilotDirectory, pilotIndex, pilotClearanceBody,
  validatePilotOwner, validatePilotNative, validatePilotAudit} from './fix-nine-rollout-pilot.mjs';
import {planSync, auditHarness} from '../skill/codex-harness/scripts/lib/core.mjs';
import {connectNativeHookClient} from '../skill/codex-harness/scripts/lib/native-hook-client.mjs';

const equal = assert.deepEqual;
const clone = value => JSON.parse(JSON.stringify(value));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => readJson(sourceRoot, file);
const pinned = async ref => JSON.parse(await authenticateFile(sourceRoot, ref));
const sources = ['scripts/fix-nine-rollout-pilot-clearance.mjs', 'scripts/fix-nine-rollout-pilot-clearance.test.mjs'];
export const installationIndices = [1, 2, 3, 5, 6, 7, 8, 9, 10];
const otherIndices = [0, ...installationIndices];

export function validateOtherInstallations(otherTargets, current) {
  const validate = (rows, indices) => {
    equal(rows.map(row => row.index), indices, 'Exact installation coverage required');
    for (const row of rows) {
      assert.equal(row.root, targets[row.index]);
      assert.match(row.sha256, /^[a-f0-9]{64}$/);
    }
  };
  assert.equal(otherTargets.unchanged, true);
  validate(otherTargets.before, otherIndices); validate(otherTargets.after, otherIndices);
  equal(otherTargets.after, otherTargets.before, 'Original pilot preservation changed');
  validate(current, installationIndices);
  equal(current, otherTargets.before.filter(row => row.index !== 0), 'Another installation changed');
}

// Accept only the authentic, immediate, drift-free transfer from the deployment owner.
// No historical source plan is synthesized and no installation hash is normalized.
export function validatePilotTransfer(state, receipt, reservation, actor = process.env.CODEX_THREAD_ID) {
  const {continuity, features, events} = state;
  const handoff = continuity.lastHandoff;
  assert.equal(receipt.actor, reservation.actor);
  assert.equal(continuity.phase, 'working');
  assert.equal(continuity.owner?.id, actor);
  assert.equal(continuity.owner?.generation, continuity.generation);
  assert.equal(continuity.generation, reservation.generation + 1);
  assert.notEqual(actor, receipt.actor);
  assert.equal(handoff?.kind, 'handoff');
  assert.equal(handoff.owner?.id, receipt.actor);
  assert.equal(handoff.owner?.generation, reservation.generation);
  assert.equal(continuity.checkpoint?.id, handoff.id);
  equal(continuity.checkpoint?.owner, handoff.owner);
  assert.equal(handoff.featureRevision, features.revision);
  equal(handoff.drift, []); assert.equal(handoff.driftAccepted, false);
  assert.equal(continuity.handoff, null);
  assert(Date.parse(reservation.startedAt) <= Date.parse(receipt.finishedAt));
  assert(Date.parse(receipt.finishedAt) < Date.parse(handoff.createdAt));
  const suffix = events.filter(event => Date.parse(event.at) > Date.parse(receipt.finishedAt));
  assert.equal(suffix.length, 2, 'Only the authenticated handoff/resume may follow the receipt');
  const [ready, resumed] = suffix;
  assert.equal(ready.type, 'handoff.ready'); assert.equal(resumed.type, 'worker.resumed');
  assert.equal(ready.handoffId, handoff.id); assert.equal(resumed.handoffId, handoff.id);
  assert.equal(ready.generation, reservation.generation);
  assert.equal(ready.revision, features.revision);
  assert.equal(resumed.generation, continuity.generation);
  equal(resumed.drift, []); assert.equal(resumed.driftAccepted, false);
  assert(Date.parse(handoff.createdAt) <= Date.parse(ready.at));
  assert(Date.parse(ready.at) <= Date.parse(handoff.resumedAt));
  assert.equal(continuity.resumedAt, handoff.resumedAt);
  assert.equal(continuity.owner.claimedAt, handoff.resumedAt);
  assert(Date.parse(handoff.resumedAt) <= Date.parse(resumed.at));
  return {handoffId:handoff.id, fromGeneration:reservation.generation,
    toGeneration:continuity.generation, fromActor:receipt.actor, toActor:actor};
}

async function liveState(authority, receipt, reservation) {
  const [continuity, features, config, eventText] = await Promise.all([
    json('.harness/continuity.json'), json('.harness/features.json'), json('.harness/config.json'),
    readFile(path.join(sourceRoot, '.harness/events.jsonl'), 'utf8')]);
  validatePilotOwner({continuity, features, config}, authority);
  const events = eventText.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return validatePilotTransfer({continuity, features, events}, receipt, reservation);
}

async function authenticatedInputs() {
  const original = await authenticatePilotOriginal();
  const refs = Object.fromEntries(await Promise.all(['receipt', 'reservation', 'review-body', 'review', 'clearance-review'].map(async name =>
    [name, await pinFile(sourceRoot, `${pilotDirectory}/${name}.json`)])));
  const receipt = await pinned(refs.receipt), reservation = await pinned(refs.reservation);
  assert.equal(receipt.confirmed, true); assert.equal(receipt.index, pilotIndex);
  assert.equal(receipt.root, targets[pilotIndex]);
  equal(receipt.originalAuthority, original.authority); equal(reservation.originalAuthority, original.authority);
  equal(receipt.reservation, refs.reservation); equal(receipt.review, refs.review); equal(reservation.review, refs.review);
  const target = original.value.targets[pilotIndex];
  assert.equal(reservation.index, pilotIndex); assert.equal(reservation.root, target.root);
  equal(reservation.plan, target.plan); assert.equal(reservation.expectedPlanHash, target.planHash);
  const materialBody = await pinned(refs['review-body']), materialReview = await pinned(refs.review);
  validateReview(materialReview, 'execution-authority', materialBody);
  equal(materialBody.originalAuthority, original.authority); equal(materialBody.originalReview, original.originalReview);
  equal(materialBody.sourceClosure, original.closure); equal(materialBody.preparedSource, original.value.preparedSource);
  assert.equal(materialBody.scope, 'exo-index-4-only'); assert.equal(materialBody.index, pilotIndex);
  assert.equal(materialBody.root, target.root); equal(materialBody.plan, target.plan);
  equal(materialBody.preservation, target.preservation); assert.equal(materialBody.expectedPlanHash, target.planHash);
  equal(materialBody.pilotSources.map(ref => ref.path), ['scripts/fix-nine-rollout-pilot.mjs', 'scripts/fix-nine-rollout-pilot.test.mjs']);
  await Promise.all(materialBody.pilotSources.map(ref => authenticateFile(sourceRoot, ref)));
  const external = await readFile(materialBody.externalPreservation.path);
  assert.equal(external.length, materialBody.externalPreservation.bytes);
  assert.equal(sha(external), materialBody.externalPreservation.sha256);
  const resultReview = await pinned(refs['clearance-review']);
  validateReview(resultReview, 'product-audit', pilotClearanceBody(refs.receipt, receipt, resultReview.body?.actor));
  await liveState(original.value, receipt, reservation);
  return {original, refs, receipt, reservation, target};
}

async function amendmentBody(inputs) {
  const {original, refs} = inputs;
  return {version:1, kind:'fix-nine-rollout-pilot-clearance-amendment', scope:'exo-index-4-clearance-only',
    originalAuthority:original.authority, originalReview:original.originalReview, sourceClosure:original.closure,
    receipt:refs.receipt, reservation:refs.reservation, materialBody:refs['review-body'], materialReview:refs.review,
    resultReview:refs['clearance-review'], amendmentSources:await Promise.all(sources.map(file => pinFile(sourceRoot, file))),
    installationIndices, rules:{noDeployment:true, originalPilotHelperUnchanged:true,
      originalApprovalsUnchanged:true, exactOtherInstallationHashes:true, authenticatedImmediateTransfer:true,
      currentNativeOwnerRequired:true, immutableSourceClosureRequired:true, currentContractAndBudgetRequired:true,
      originalPreservationAndNativeChecksRequired:true, originalAllElevenHoldUnchanged:true, automaticRetry:false}};
}

export async function prepareClearanceAmendment() {
  const body = await amendmentBody(await authenticatedInputs());
  const ref = await exclusiveJson(sourceRoot, `${pilotDirectory}/clearance-amendment-body.json`, body);
  return {reviewBody:ref, payloadSha256:sha(reviewPayload('execution-authority', body)), executionAuthorized:false};
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
  const unrelated = clone(layer.config);
  for (const [key, row] of Object.entries(unrelated.hooks?.state ?? {})) {
    delete row.trusted_hash; if (!Object.keys(row).length) delete unrelated.hooks.state[key];
  }
  return {version:layer.version, semanticSha256:canonicalHash(layer.config), unrelatedSha256:canonicalHash(unrelated),
    trust:Object.fromEntries(Object.entries(layer.config.hooks?.state ?? {}).map(([key,row]) => [key,row.trusted_hash ?? null])),
    definitions, raw:{path:file,bytes:raw.length,sha256:sha(raw)}};
}

export async function clearPilotAfterTransfer({executable} = {}) {
  const inputs = await authenticatedInputs(), {original, refs, receipt, reservation, target} = inputs;
  const body = await amendmentBody(inputs);
  equal(await json(`${pilotDirectory}/clearance-amendment-body.json`), body);
  const amendmentRef = await pinFile(sourceRoot, `${pilotDirectory}/clearance-amendment-review.json`);
  validateReview(await pinned(amendmentRef), 'execution-authority', body);
  const plan = await pinned(target.plan);
  await validatePreservation(target, original.initial.targets[pilotIndex], await pinned(target.preservation), plan, {final:true});
  for (const ref of receipt.targetFiles) await authenticateFile(target.root, ref);
  const installations = await Promise.all(installationIndices.map(async index =>
    ({index, root:targets[index], sha256:canonicalHash(clone(await planSync(targets[index], {approveNativeHooks:false})))})));
  validateOtherInstallations(receipt.otherTargets, installations);
  validatePilotAudit(await auditHarness(target.root));
  const client = await connectNativeHookClient({executable});
  try {
    const native = await nativeRead(client);
    validatePilotNative(native, original.value, 'after', receipt.native.expectedSemanticSha256);
    const transfer = await liveState(original.value, receipt, reservation);
    return exclusiveJson(sourceRoot, `${pilotDirectory}/clearance.json`, {
      version:1,kind:'fix-nine-rollout-exo-pilot-clearance',receipt:refs.receipt, independentContinue:refs['clearance-review'],
      clearanceAmendment:amendmentRef, transfer, installations, nativeReadback:native,
      hold:'cleared-for-this-pilot-only',holdCleared:true,originalAllElevenHoldUnchanged:true,
      actor:process.env.CODEX_THREAD_ID,sealedAt:new Date().toISOString()});
  } finally { await client.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === 'prepare') console.log(JSON.stringify(await prepareClearanceAmendment()));
  else if (mode === 'clear') console.log(JSON.stringify(await clearPilotAfterTransfer()));
  else throw new Error('Use prepare or clear; clearance never deploys or retries');
}
