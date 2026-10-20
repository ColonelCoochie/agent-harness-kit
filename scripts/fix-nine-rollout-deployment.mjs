import {captureSourceReleaseBoundary, authenticateOwnedReleaseBoundary, authenticateSourceRelease, releaseState} from './fix-nine-rollout-release.mjs';
// Fixed, review-gated rollout for fix-nine-rollout-001. Importing is read-only.
import assert from 'node:assert/strict';
import {createHash, verify} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir, readdir, readFile, open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {planSync, syncHarness, auditHarness} from '../skill/codex-harness/scripts/lib/core.mjs';
import {canonicalCodexHooks, reviewNativeDefinitions} from '../skill/codex-harness/scripts/lib/hook-policy.mjs';
import {connectNativeHookClient} from '../skill/codex-harness/scripts/lib/native-hook-client.mjs';
import {authenticateSourceClosure, closurePath, validatePrerequisite} from './fix-nine-rollout-closure.mjs';
import {sourceRoot, targets, directory, featureId} from './fix-nine-rollout-preflight.mjs';
import {requiredHelpers, authenticateGateInventory} from './fix-nine-rollout-auth.mjs';
import {canonicalHash, normalizedContract, expectedVerificationPlan, gateDirectory} from './fix-nine-rollout-evidence.mjs';
import {authenticateFile, authenticatePrefix, exclusiveJson, pinFile, readJson, regularPath} from './fix-nine-rollout-files.mjs';
import {loadInventoryAdmission, authenticateContextInventory, authenticateObservedAddition, authenticatePrerequisiteArtifact, authenticatePrerequisiteInventory, validateManagedInventory, proposeContextAdmission, extendContextAdmission, captureContextWitness, captureReadOnlyContextObservation, extendLifecycleAdmission} from './fix-nine-rollout-inventory.mjs';

export const reviewPublicKey = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAj0LfGoNw312Z47WeoIkNLQHdaiAHsJMjgqSIqIuk5i8=\n-----END PUBLIC KEY-----\n";
export const authorityPath = `${directory}/authority.json`;
export const composedPath = `${directory}/source-closure.json`;
export const sealPath = `${directory}/authority-review.json`;
export const reportPath = `${directory}-report.json`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const candidateSha = '5524e5c29c78a0f5774f4e30390b247cffa11f96f75ba6a6127f4d7d610c34ff';
const originalSha = 'a6face9dca313af34a4d94a9e02f0b6d208776daa8e943ed54c7e90d9a1a6292';
const nativeSha = '075ad24affd35954c13554f4d8304da86d5144ed437f2b597081c0ccddece625';
const lifecyclePaths = ['.harness/features.json', '.harness/continuity.json', '.harness/progress.md', '.harness/handoff.md', '.harness/events.jsonl'];
const recoveryPath = '.harness/native-hook-v2-rollout-004/v9-recovery-worker-transfer-proof-g126-target4-attestation.json';
const yieldPath = '.harness/native-hook-v2-rollout-004/source-yield-continuity-g89.json';
const recoverySha = 'ad6e3ed7d0a1364ccf2a74aa373b10cd0fe9a7d473eb9a675b2dd1f597a1a928';
const yieldSha = '3e131f02d1148028ab62e1da98fe31d8ac6ab7733c8300f71ad9557156301c55';
const executable = 'C:/Users/Jason/AppData/Local/OpenAI/Codex/bin/e78bad9887fa50cf/codex.exe';
const equal = (a, b) => assert.deepEqual(a, b);
const clone = value => structuredClone(value);
const pad = i => String(i).padStart(2, '0');
const ioAt = root => ({pin: p => pinFile(root, p), authenticate: r => authenticateFile(root, r), prefix: r => authenticatePrefix(root,r), json: p => readJson(root, p),reviewContextWitness:(seal,body)=>validateReview(seal,'context-owner-witness',body),reviewReadOnlyContextObservation:(seal,body)=>validateReview(seal,'context-readonly-observation',body)});
// An in-memory admission is attached only after proposal validation (prepare) or
// authentication of the enclosing review seal (execution). Never serialize it.
const attachInventory = (target,admission) => Object.defineProperty(target,'inventoryAdmission',{value:admission,configurable:true});
const jsonBytes = bytes => JSON.parse(bytes.toString('utf8'));
async function save(file, value) {
  await mkdir(path.dirname(path.join(sourceRoot, file)), {recursive:true});
  return exclusiveJson(sourceRoot, file, value);
}
async function saveBytes(file, bytes) {
  await mkdir(path.dirname(path.join(sourceRoot,file)),{recursive:true});
  const handle=await open(await regularPath(sourceRoot,file,{absent:true}),'wx');
  try {await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  return pinFile(sourceRoot,file);
}
async function pinnedJson(io, ref) { return jsonBytes(await io.authenticate(ref)); }
async function fixedJson(io, file, expectedSha) {
  const ref = await io.pin(file); if (expectedSha) assert.equal(ref.sha256, expectedSha, `Immutable anchor changed: ${file}`);
  return {ref, value:await pinnedJson(io, ref)};
}
function actor() { assert(process.env.CODEX_THREAD_ID, 'Native worker identity required'); return process.env.CODEX_THREAD_ID; }
async function owner() {
  const state = await readJson(sourceRoot, '.harness/continuity.json');
  assert.equal(state.owner?.id ?? state.owner, actor(), 'Active source worker must own rollout mutations');
  assert.equal(state.phase, 'working');
}

export function validateRoots(rows) {
  equal(rows.map(row => row.root), targets);
  equal(rows.map(row => row.index), targets.map((_, index) => index));
  assert.equal(new Set(rows.map(row => row.root)).size, 11);
}

// The signature is an independent exact-byte anchor, never an embedded hash
// which would change when the helper closure containing this file is sealed.
export function reviewPayload(kind, body) {
  assert(['execution-authority', 'source-lifecycle-refresh', 'product-audit','context-owner-witness','context-readonly-observation'].includes(kind));
  return Buffer.from(JSON.stringify({domain:'fix-nine-rollout-001/exact-review/v1', kind, body}));
}
export function validateReview(seal, kind, body, publicKey = reviewPublicKey) {
  equal(seal.body, body); assert.equal(seal.kind, kind); assert.equal(seal.version, 1);
  assert.equal(seal.verdict, 'CONTINUE');
  assert(typeof seal.signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(seal.signature));
  assert(verify(null, reviewPayload(kind, body), publicKey, Buffer.from(seal.signature, 'base64')), 'Missing or changed independent review signature');
}

export function validateLifecycle(before, after, {transfer = false} = {}) {
  assert.equal(after.features.version,before.features.version);
  assert(Number.isSafeInteger(after.features.revision) && after.features.revision >= before.features.revision);
  const original = before.features.features, current = after.features.features;
  equal(current.map(f => f.id), original.map(f => f.id));
  for (let i = 0; i < original.length; i++) {
    if (original[i].id !== featureId) equal(current[i], original[i]);
    else {
      equal(normalizedContract(current[i]), normalizedContract(original[i]));
      equal(current[i].contract, original[i].contract); equal(current[i].scopeBaselineRef, original[i].scopeBaselineRef);
      const omit = f => Object.fromEntries(Object.entries(f).filter(([key]) => !['status','attempts','evidence','lastVerification','repeatedFailures','lastFailureFingerprint','updatedAt'].includes(key)));
      equal(omit(current[i]), omit(original[i]));
      assert(current[i].attempts >= original[i].attempts && current[i].attempts <= 5);
      equal(current[i].evidence.slice(0, original[i].evidence.length), original[i].evidence);
    }
  }
  const mutable = ['checkpoint','startedAt','resumedAt','phase',...(transfer ? ['lastHandoff','generation','owner','retiredWorkerIds'] : [])];
  for (const key of new Set([...Object.keys(before.continuity), ...Object.keys(after.continuity)])) {
    if (!mutable.includes(key)) equal(after.continuity[key], before.continuity[key]);
  }
  const oldRetired = before.continuity.retiredWorkerIds ?? [], retired = after.continuity.retiredWorkerIds ?? [];
  equal(retired.slice(0, oldRetired.length), oldRetired);
  assert.equal(new Set(retired).size, retired.length);
  assert(after.continuity.generation >= before.continuity.generation);
  assert.equal(after.continuity.phase, 'working');
  assert.equal(after.continuity.handoff,null);
}

// Only a separately signed refresh may introduce a completed transfer. Its
// exact packet and ready/resumed event pair are pinned, never broadly mutable.
export function validateTransfer(before, after, proof) {
  validateLifecycle(before,after,{transfer:true});
  const packet=after.continuity.lastHandoff;
  assert(packet && packet.id !== before.continuity.lastHandoff?.id);
  equal(proof.packet,packet); assert.equal(packet.kind,'handoff');
  assert.equal(packet.selectedFeatureId,featureId); assert.equal(packet.featureRevision,after.features.revision);
  equal(before.features,after.features);
  equal(packet.owner,before.continuity.owner);
  assert.equal(proof.events.length,2);
  const [ready,resumed]=proof.events;
  assert.equal(ready.type,'handoff.ready'); assert.equal(resumed.type,'worker.resumed');
  assert.equal(ready.handoffId,packet.id);assert.equal(resumed.handoffId,packet.id);
  assert.equal(ready.generation,before.continuity.generation);
  assert.equal(ready.generation + 1,resumed.generation);assert.equal(resumed.generation,after.continuity.generation);
  assert(Date.parse(ready.at)<=Date.parse(packet.resumedAt));assert(Date.parse(packet.resumedAt)<=Date.parse(resumed.at));
  assert.equal(ready.revision,packet.featureRevision);
  equal(resumed.drift,packet.drift);assert.equal(resumed.driftAccepted,packet.driftAccepted);
  equal(after.continuity.retiredWorkerIds,[...(before.continuity.retiredWorkerIds??[]),packet.owner.id]);
  const owner=after.continuity.owner;
  assert(owner && typeof owner==='object' && !Array.isArray(owner));
  equal(Object.keys(owner).sort(),['claimedAt','featureId','generation','id','parentSessionId','source']);
  assert(typeof owner.id==='string' && /^[a-zA-Z0-9_./:-]{1,200}$/.test(owner.id));
  assert.equal(owner.source,'CODEX_THREAD_ID');
  assert(owner.parentSessionId===null || (typeof owner.parentSessionId==='string' && owner.parentSessionId.length>0));
  assert(Number.isSafeInteger(owner.generation));assert.equal(owner.generation,after.continuity.generation);
  assert.notEqual(owner.id,packet.owner.id);assert.equal(owner.claimedAt,packet.resumedAt);
  assert.equal(owner.featureId,packet.owner?.featureId ?? packet.selectedFeatureId ?? packet.activeFeatures?.[0]?.id ?? null);
  equal(packet.drift,proof.driftDisposition==='availability-only'?['repository availability changed']:[]);
  assert.equal(packet.driftAccepted,proof.driftDisposition==='availability-only');
}

// Authenticate signed semantic snapshots against the retained physical event
// prefix. Later appends do not invalidate an earlier, explicitly reviewed step.
export async function authenticateLifecycleStep(before,after,proof,io,references=[]) {
  const beforeEvents=before.refs.find(r=>r.path==='.harness/events.jsonl');
  const afterEvents=after.refs.find(r=>r.path==='.harness/events.jsonl');
  assert(beforeEvents && afterEvents);assert(afterEvents.bytes>=beforeEvents.bytes);
  await io.prefix(beforeEvents);const bytes=(await io.prefix(afterEvents)).subarray(0,afterEvents.bytes);
  const changed=JSON.stringify(before.continuity.lastHandoff)!==JSON.stringify(after.continuity.lastHandoff);
  if(changed) {
    assert(proof,'Completed transfer requires a signed physical proof');validateTransfer(before,after,proof);
    const appended=bytes.subarray(beforeEvents.bytes).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    const events=appended.filter(e=>['handoff.ready','worker.resumed'].includes(e.type));
    equal(events,proof.events);assert.equal(events.length,2);
    assert.equal(proof.archive.path,`.harness/history/progress/${proof.packet.id}.md`);
    await io.authenticate(proof.archive);references.push(proof.archive);
  } else {assert.equal(proof,null);validateLifecycle(before,after);}
}

export function validateManifest(manifest,root) {
  assert.equal(manifest.version,1);assert.equal(manifest.root,root);assert(Array.isArray(manifest.files));
  const paths=manifest.files.map(ref=>ref.path);assert.equal(new Set(paths).size,paths.length,'Duplicate preservation path');
  for(const ref of manifest.files) {assert(ref.path.startsWith('.harness/'));assert(!ref.path.includes('\\'));assert(!ref.path.split('/').some(p=>!p||p==='.'||p==='..'));assert(Number.isSafeInteger(ref.bytes)&&ref.bytes>=0);assert.match(ref.sha256,/^[a-f0-9]{64}$/);}
}

export async function authenticateAdditions(base,previous,current,io,transfer=null) {
  const baseline=new Set(base.files.map(r=>r.path)),old=previous.additions??[],added=current.additions??[];
  assert.equal(new Set(added.map(r=>r.path)).size,added.length);
  for(const ref of old) assert(added.some(r=>canonicalHash(r)===canonicalHash(ref)),'Prior signed addition changed or disappeared');
  for(const ref of added) {
    assert(!baseline.has(ref.path));assert(sourceAddition(ref.path));
    if(ref.path.startsWith('.harness/history/')&&!old.some(prior=>canonicalHash(prior)===canonicalHash(ref))) {
      equal(ref,transfer?.archive,'New archive requires the authenticated lifecycle transfer pin');
    }
    await io.authenticate(ref);
  }
}

async function lifecycle(root=sourceRoot) {
  const refs=await Promise.all(lifecyclePaths.map(file=>pinFile(root,file)));
  return {features:jsonBytes(await authenticateFile(root,refs[0])),continuity:jsonBytes(await authenticateFile(root,refs[1])),refs};
}

export async function authenticateSourceLifecycle(root,previous,sourceRelease) {
  const now=sourceRelease ? await releaseState(root,sourceRelease) : await lifecycle(root);
  validateLifecycle(previous,now);
  await authenticatePrefix(root,previous.refs.find(r=>r.path==='.harness/events.jsonl'));
  return now;
}
function withoutTrust(value) {
  const copy = clone(value);
  for (const [key, row] of Object.entries(copy.hooks?.state ?? {})) { delete row.trusted_hash; if (!Object.keys(row).length) delete copy.hooks.state[key]; }
  return copy;
}
function nativeSummary(layer, discovery) {
  equal(discovery.data.map(row => row.cwd), targets);
  assert(discovery.data.every(row => !row.errors?.length));
  const definitions = discovery.data.flatMap(row => row.hooks.filter(h => h.source === 'project' && h.sourcePath === path.join(row.cwd, '.codex/hooks.json')).map(h => ({root:row.cwd,key:h.key,currentHash:h.currentHash,trustStatus:h.trustStatus,eventName:h.eventName,sourcePath:h.sourcePath,enabled:h.enabled,displayOrder:h.displayOrder,definitionSha256:canonicalHash(h),commandSha256:canonicalHash(h.command)})));
  assert.equal(definitions.length, 66); assert.equal(new Set(definitions.map(d => d.key)).size, 66);
  const trust = Object.fromEntries(Object.entries(layer.config.hooks?.state ?? {}).map(([key, row]) => [key,row.trusted_hash ?? null]));
  assert.equal(Object.keys(trust).length, 84);
  return {version:layer.version, semanticSha256:canonicalHash(layer.config), unrelatedSha256:canonicalHash(withoutTrust(layer.config)), trust, definitions};
}
async function nativeRead(client) {
  const configPath=path.join(process.env.CODEX_HOME ?? path.join(process.env.USERPROFILE,'.codex'),'config.toml');
  const before=await readFile(configPath);
  const config = await client.rpc('config/read', {includeLayers:true});
  const layers = config.layers?.filter(row => row.name?.type === 'user' && !row.name.profile && path.resolve(row.name.file) === path.resolve(process.env.CODEX_HOME ?? path.join(process.env.USERPROFILE, '.codex'), 'config.toml'));
  assert.equal(layers?.length, 1); const layer = layers[0];
  equal(await readFile(layer.name.file),before,'Native config drift before discovery');
  const discovery = await client.rpc('hooks/list', {cwds:targets});
  equal(await readFile(layer.name.file), before, 'Native config drift during observation');
  return {layer, discovery, summary:{...nativeSummary(layer, discovery),raw:{path:layer.name.file,bytes:before.length,sha256:sha(before)}}};
}

export function validateNative(summary, authority, completed) {
  const baseline = authority.nativeBaseline;
  assert(Number.isInteger(completed)&&completed>=-1&&completed<=10);
  assert.equal(summary.raw.path,baseline.raw.path);assert(Number.isInteger(summary.raw.bytes)&&summary.raw.bytes>0);
  assert.match(summary.raw.sha256,/^[a-f0-9]{64}$/);assert.equal(typeof summary.version,'string');assert(summary.version);
  if(completed===-1) {equal(summary.raw,baseline.raw);assert.equal(summary.version,baseline.version);}
  assert.equal(summary.unrelatedSha256, baseline.unrelatedSha256);
  equal(Object.keys(summary.trust).sort(), Object.keys(baseline.trust).sort());
  const expected = clone(baseline.trust);
  for (const transition of authority.nativeTransitions) if (transition.index <= completed) expected[transition.key] = transition.after;
  equal(summary.trust, expected);
  const stage=authority.nativeStages.find(row=>row.completed===completed);assert(stage,'Missing reviewed native stage');
  assert.equal(summary.semanticSha256,stage.semanticSha256);
  assert.equal(summary.definitions.length, 66); assert.equal(new Set(summary.definitions.map(d => d.key)).size, 66);
  for (const definition of summary.definitions) {
    const change = authority.nativeTransitions.find(row => row.key === definition.key); assert(change);
    assert.equal(definition.root, targets[change.index]); assert.equal(definition.enabled, true);
    assert.equal(definition.currentHash, change.index <= completed ? change.after : change.before);
    assert.equal(definition.trustStatus, 'trusted');
    equal(definition,change.index<=completed ? change.afterDefinition : change.beforeDefinition);
  }
}

// The reviewed authority retains the entire discovered definitions, including
// fields outside the command. Summary hashes alone cannot authorize a rewrite.
export function validateNativeAuthority(authority) {
  const {nativeBaseline:baseline,nativeTransitions:transitions,nativeTrustRows:rows,nativeStages:stages}=authority;
  assert.equal(Object.keys(baseline.trust).length,84);equal(Object.keys(rows).sort(),Object.keys(baseline.trust).sort());
  assert.equal(transitions.length,66);assert.equal(new Set(transitions.map(t=>t.key)).size,66);
  equal(stages.map(s=>s.completed),Array.from({length:12},(_,i)=>i-1));
  assert.equal(stages[0].semanticSha256,baseline.semanticSha256);
  for(const [key,row] of Object.entries(rows)) assert.equal(row.trusted_hash??null,baseline.trust[key]);
  for(let index=0;index<11;index++) assert.equal(transitions.filter(t=>t.index===index).length,6);
  for(const transition of transitions) {
    assert.equal(transition.root,targets[transition.index]);assert.equal(transition.key,transition.beforeRaw.key);
    assert.equal(transition.key,transition.afterRaw.key);assert.equal(transition.before,transition.beforeRaw.currentHash);
    assert.equal(transition.after,transition.afterRaw.currentHash);assert.equal(transition.before,baseline.trust[transition.key]);
    assert.equal(transition.beforeRaw.trustStatus,'trusted');assert.equal(transition.afterRaw.trustStatus,'trusted');
    equal(transition.beforeDefinition,baseline.definitions.find(d=>d.key===transition.key));
    for(const which of ['before','after']) {
      const raw=transition[`${which}Raw`],definition=transition[`${which}Definition`];
      assert.equal(raw.source,'project');assert.equal(raw.sourcePath,path.join(transition.root,'.codex/hooks.json'));
      assert.equal(raw.enabled,true);assert.equal(raw.eventName,transition.eventName);
      equal(definition,{root:transition.root,key:raw.key,currentHash:raw.currentHash,trustStatus:raw.trustStatus,
        eventName:raw.eventName,sourcePath:raw.sourcePath,enabled:raw.enabled,displayOrder:raw.displayOrder,
        definitionSha256:canonicalHash(raw),commandSha256:canonicalHash(raw.command)});
    }
    for(const key of ['source','sourcePath','key','eventName','enabled','displayOrder']) equal(transition.afterRaw[key],transition.beforeRaw[key]);
  }
  assert.equal(Object.keys(baseline.trust).filter(key=>!transitions.some(t=>t.key===key)).length,18);
}

export function nativeStages(config,transitions) {
  const current=clone(config),stages=[{completed:-1,semanticSha256:canonicalHash(current)}];
  for(let index=0;index<11;index++) {
    for(const change of transitions.filter(t=>t.index===index)) current.hooks.state[change.key]={...current.hooks.state[change.key],trusted_hash:change.after};
    stages.push({completed:index,semanticSha256:canonicalHash(current)});
  }
  return stages;
}

export function validateNativeReceipt(receipt,authority,index) {
  assert.equal(receipt.confirmed,true);
  validateNative(receipt.before,authority,index-1);validateNative(receipt.after,authority,index);
  const expected=clone(receipt.before.trust), transitions=authority.nativeTransitions.filter(t=>t.index===index);
  assert.equal(transitions.length,6);
  for(const transition of transitions) expected[transition.key]=transition.after;
  equal(receipt.observed.trust,receipt.before.trust);
  equal(receipt.observed.raw,receipt.before.raw);assert.equal(receipt.observed.version,receipt.before.version);
  assert.equal(receipt.observed.semanticSha256,receipt.before.semanticSha256);
  assert.equal(receipt.observed.unrelatedSha256,receipt.before.unrelatedSha256);
  assert.equal(receipt.observed.definitions.length,66);
  assert.equal(new Set(receipt.observed.definitions.map(d=>d.key)).size,66);
  equal(receipt.observed.definitions.map(d=>d.key).sort(),authority.nativeTransitions.map(t=>t.key).sort());
  for(const definition of receipt.observed.definitions) {
    const transition=authority.nativeTransitions.find(t=>t.key===definition.key);assert(transition);
    const expectedDefinition=transition.index===index?transition.afterDefinition:receipt.before.definitions.find(d=>d.key===definition.key);
    const expected=clone(expectedDefinition);
    if(transition.index===index) {
      expected.trustStatus=transition.after===transition.before?'trusted':'modified';
      expected.definitionSha256=canonicalHash({...transition.afterRaw,trustStatus:expected.trustStatus});
    }
    equal(definition,expected);
    if(transition.index!==index) equal(definition,expectedDefinition);
  }
  equal(receipt.after.trust,expected);
  const needed=canonicalHash(expected)!==canonicalHash(receipt.before.trust);
  assert.equal(receipt.method,needed?'config/batchWrite':'unchanged');assert.equal(receipt.writeCount,needed?1:0);
  if(needed) {
    const request=receipt.request;assert.equal(request.filePath,receipt.observed.raw.path);
    assert.equal(request.expectedVersion,receipt.observed.version);assert.equal(request.reloadUserConfig,true);
    assert.equal(request.edits.length,1);equal(Object.keys(request).sort(),['edits','expectedVersion','filePath','reloadUserConfig']);
    const edit=request.edits[0];assert.equal(edit.keyPath,'hooks.state');assert.equal(edit.mergeStrategy,'replace');
    equal(Object.keys(edit).sort(),['keyPath','mergeStrategy','value']);
    equal(Object.keys(edit.value).sort(),Object.keys(expected).sort());
    for(const [key,value] of Object.entries(edit.value)) {assert.equal(value.trusted_hash,expected[key]);equal(value,authority.nativeTrustRows[key]&&{...authority.nativeTrustRows[key],trusted_hash:expected[key]});}
    assert.equal(receipt.after.semanticSha256,receipt.expectedSemanticSha256);
    assert.equal(receipt.expectedSemanticSha256,authority.nativeStages.find(r=>r.completed===index).semanticSha256);
    assert(receipt.response===null || typeof receipt.response==='object');
  } else {assert.equal(receipt.request,null);assert.equal(receipt.responseError,null);}
}

async function authenticateRecovery(io=ioAt(sourceRoot)) {
  const proof=await fixedJson(io,recoveryPath,recoverySha),yielded=await fixedJson(io,yieldPath,yieldSha);
  const current=await readJson(sourceRoot,'.harness/continuity.json'),recovered=proof.value.recovery.recovered;
  equal(current.lastRecovery,Object.fromEntries(['formerOwner','actor','reason','recoveredAt','generation'].map(key=>[key,recovered[key]])));
  equal(current.retiredWorkerIds.slice(0,yielded.value.retiredWorkerIds.length),yielded.value.retiredWorkerIds);
  const fromId=record=>typeof record==='string'?record:record?.id;
  for(const id of new Set([fromId(proof.value.recovery.from),...proof.value.transitions.map(t=>fromId(t.from))])) assert(current.retiredWorkerIds.includes(id));
  const events={path:'.harness/events.jsonl',...proof.value.eventsPrefix};await authenticatePrefix(sourceRoot,events);
  return {proof:proof.ref,sourceYield:yielded.ref,eventsPrefix:events,originalContinuityRawSnapshotRetained:false};
}

// Authenticate the original inventory, before admitting the additive baseline.
// The unavailable original continuity bytes are an observed historical pin;
// authentic recovery/events/retired IDs provide the explicit semantic bridge.
async function validateOriginal(target,original,manifest,candidate,plan,{final=false}={}) {
  const managed=new Map(candidate.source.managed.map(row=>[row.installed.path,row.installed]));
  const operations=new Map(plan.operations.map(row=>[row.path,row]));
  const admission=target.inventoryAdmission ?? (target.index===0 && manifest.files.some(ref=>ref.path.startsWith('.harness/context/')||ref.path==='.harness/managed-files.json') ? await loadInventoryAdmission(candidate,ioAt(target.root)) : null);
  for(const ref of manifest.files) {
    const op=operations.get(ref.path);
    if(final && op?.action==='remove') {await assert.rejects(()=>pinFile(target.root,ref.path),{code:'ENOENT'});continue;}
    if(final && op?.action==='write') {assert.equal((await pinFile(target.root,ref.path)).sha256,op.afterHash);continue;}
    if(target.index===0 && lifecyclePaths.includes(ref.path)) {
      if(ref.path==='.harness/events.jsonl') await authenticatePrefix(sourceRoot,ref);
      continue;
    }
    if(admission?.contexts.has(ref.path) && await authenticateContextInventory(target.root,ref.path,target.lifecycle.continuity,admission)) continue;
    if(admission && ref.path==='.harness/managed-files.json') {validateManagedInventory(await readJson(target.root,ref.path),candidate);continue;}
    if(target.index===0 && managed.has(ref.path)) await authenticateFile(sourceRoot,managed.get(ref.path));
    else await authenticateFile(target.root,ref);
  }
  if(target.index===0) await authenticateRecovery();
}

export function inventoryDelta(before,after) {
  for(const rows of [before,after]) assert.equal(new Set(rows.map(r=>r.path)).size,rows.length,'Duplicate inventory path');
  const old=new Map(before.map(r=>[r.path,r])),now=new Map(after.map(r=>[r.path,r]));
  return [...new Set([...old.keys(),...now.keys()])].sort().filter(p=>canonicalHash(old.get(p)??null)!==canonicalHash(now.get(p)??null))
    .map(p=>({path:p,before:old.get(p)??null,after:now.get(p)??null}));
}
// This is the one baseline created by the already accepted source prerequisite.
// Its raw pin alone is insufficient: retain the feature/evidence/contract bridge.
export async function authenticatePrerequisiteBaseline(candidate,io=ioAt(sourceRoot)) {
  const state=await io.json('.harness/features.json');
  const matches=state.features.filter(f=>f.id==='source-historical-budget-compat-002');
  assert.equal(matches.length,1);const feature=matches[0];
  assert.equal(feature.status,'passing');assert.equal(feature.attempts,1);
  equal(feature.evidence,[candidate.prerequisite.evidence.path]);
  const ref=feature.scopeBaselineRef;
  equal(ref,{version:1,path:'.harness/baselines/e70b23a7003f22df4028af80492748474e4a58f989e369a1ac9885174a62e119.json',
    sha256:'e70b23a7003f22df4028af80492748474e4a58f989e369a1ac9885174a62e119',bytes:6296916,
    baselineHash:'244ebe03a7b9f61be4b19ae77a07fb71fc10113a03d298ffe84a6c0a3e838279'});
  assert.equal(feature.contract.version,2);
  assert.equal(feature.contract.hash,'b34a7ee69344429897f2a9bf2d1f17e4cb7937faa43db361ae9bfbd51ec01b12');
  equal(feature.contract.snapshot,normalizedContract(feature));
  assert.equal(feature.contract.scopeBaselineHash,ref.baselineHash);
  assert.equal(canonicalHash({contract:feature.contract.snapshot,scopeBaselineHash:ref.baselineHash}),feature.contract.hash);
  const evidence=await pinnedJson(io,candidate.prerequisite.evidence);validatePrerequisite(evidence);
  assert.equal(evidence.contractHash,feature.contract.hash);
  assert.equal(candidate.prerequisite.contractHash,evidence.contractHash);
  assert.equal(candidate.prerequisite.configHash,evidence.configHash);
  assert.equal(candidate.prerequisite.verificationHash,evidence.verificationHash);
  assert.equal(evidence.verificationPlan.scope.baselineHash,ref.baselineHash);
  const pin={path:ref.path,sha256:ref.sha256,bytes:ref.bytes},baseline=await pinnedJson(io,pin);
  assert.equal(baseline.version,2);assert.equal(baseline.baselineHash,ref.baselineHash);
  const shape=Object.fromEntries(['version','head','tree','branch','files','worktreeHash',...(baseline.capturePolicy?['capturePolicy']:[])].map(key=>[key,baseline[key]]));
  assert.equal(canonicalHash(shape),ref.baselineHash);
  assert.equal(baseline.head,evidence.repository.before.head);assert.equal(baseline.tree,evidence.repository.before.tree);
  return pin;
}
export async function validateInitialInventory(target,original,fresh,candidate,io=ioAt(sourceRoot)) {
  validateManifest(original,target.root);validateManifest(fresh,target.root);
  equal(target.initialDelta,inventoryDelta(original.files,fresh.files));
  if(target.index!==0) equal(target.initialDelta,[]);
  else {
    const prerequisiteBaseline=await authenticatePrerequisiteBaseline(candidate,io);
    const admission=target.inventoryAdmission??await loadInventoryAdmission(candidate,io);
    await authenticatePrerequisiteInventory(fresh,admission,io);
    for(const change of target.initialDelta) {
      assert(change.after,'Source prerequisite removal is forbidden');
      const managed=candidate.source.managed.find(row=>row.installed.path===change.path);
      if(managed) equal(change.after,managed.installed);
      else if(change.path===prerequisiteBaseline.path) {assert.equal(change.before,null);equal(change.after,prerequisiteBaseline);}
      else if(lifecyclePaths.includes(change.path)) continue;
      else if(change.path.startsWith('.harness/context/')) assert(await authenticateContextInventory(target.root,change.path,target.lifecycle.continuity,admission),'Unexpected context path');
      else if(change.path==='.harness/managed-files.json') validateManagedInventory(await io.json(change.path),candidate);
      else {
        assert.equal(change.before,null,`Unauthorized original inventory delta: ${change.path}`);
        if(await authenticatePrerequisiteArtifact(target.root,change.after,admission)) continue;
        assert(sourceAddition(change.path),`Unauthorized original inventory delta: ${change.path}`);
        await authenticateObservedAddition(target.root,change.after,admission);
      }
    }
  }
}
function sourceAddition(file) {return /^\.harness\/(?:evidence|logs|history)\//.test(file);}

async function tree(root, relative = '.harness', provisional = new Set()) {
  const rows = [];
  for (const entry of await readdir(path.join(root, relative), {withFileTypes:true})) {
    const name = `${relative}/${entry.name}`;
    if (root === sourceRoot && (name === directory || name === reportPath)) continue;
    assert(!entry.isSymbolicLink(), 'Preservation inventory refuses links');
    if (entry.isDirectory()) rows.push(...await tree(root, name, provisional));
    else { assert(entry.isFile());
      if (provisional.has(name)) { await regularPath(root, name); rows.push({path:name}); }
      else rows.push(await pinFile(root, name)); }
  }
  return rows.sort((a,b) => a.path.localeCompare(b.path));
}

export async function validatePreservation(target, original, manifest, plan, {final = false, lifecycleTarget = target, gateInventory = null, sourceRelease} = {}) {
  if (gateInventory) { assert.equal(target.index, 0); assert.equal(target.root, sourceRoot); }
  const state = await readJson(target.root, '.harness/features.json');
  const config = await readJson(target.root, '.harness/config.json');
  assert.equal(config.policies.maxAttempts, 5); assert.equal(config.policies.maxRepeatedFailures, 2);
  for (const historical of original.historicalFeatures) {
    if (historical.id === featureId && target.index === 0) continue;
    assert.equal(canonicalHash(state.features.find(f => f.id === historical.id)), historical.sha256, `Historical feature changed: ${target.root}/${historical.id}`);
  }
  if (target.index === 4) {
    const old = target.lifecycle.features.features;
    equal(state.features, old);
    const matches=old.filter(f=>f.id==='exo-normal-text-flip');assert.equal(matches.length,1);
    const feature=matches[0];assert.equal(feature.attempts,4);
    assert.equal(feature.verificationBudget?.maxAttempts,23);
    assert.equal(feature.contract?.snapshot?.verificationBudget?.maxAttempts,23);
    assert.equal(Math.min(config.policies.maxAttempts,feature.verificationBudget.maxAttempts),5);
  }
  const operations = new Map(plan.operations.map(row => [row.path,row]));
  const admission=lifecycleTarget.inventoryAdmission ?? (target.index===0 && manifest.files.some(ref=>ref.path.startsWith('.harness/context/')||ref.path==='.harness/managed-files.json') ? await loadInventoryAdmission(undefined,ioAt(target.root)) : null);
  if(target.index===0&&admission) await authenticatePrerequisiteInventory(manifest,admission,ioAt(target.root));
  for (const ref of manifest.files) {
    if (target.index === 0 && lifecyclePaths.includes(ref.path)) continue;
    if(admission?.contexts.has(ref.path) && await authenticateContextInventory(target.root,ref.path,lifecycleTarget.lifecycle.continuity,admission)) continue;
    if(admission && ref.path==='.harness/managed-files.json') {validateManagedInventory(await readJson(target.root,ref.path),admission.candidate);continue;}
    const operation = operations.get(ref.path);
    if (final && operation?.action === 'remove') {
      await assert.rejects(() => pinFile(target.root, ref.path), {code:'ENOENT'});
    } else if (operation?.action === 'write') {
      const current = await pinFile(target.root, ref.path);
      assert.equal(current.sha256, final ? operation.afterHash : operation.beforeHash, `Managed preservation changed: ${ref.path}`);
    } else await authenticateFile(target.root, ref);
  }
  for (const surface of target.surfaces) {
    const operation = operations.get(surface.path);
    if(final && operation?.action==='remove') {await assert.rejects(()=>pinFile(target.root,surface.path),{code:'ENOENT'});continue;}
    if(surface.missing && !(final && operation?.action==='write')) {await assert.rejects(()=>pinFile(target.root,surface.path),{code:'ENOENT'});continue;}
    const current = await pinFile(target.root, surface.path);
    assert.equal(current.sha256, final && operation?.action === 'write' ? operation.afterHash : surface.sha256);
  }
  if (target.index === 0) {
    await authenticateSourceLifecycle(target.root,lifecycleTarget.lifecycle,sourceRelease);
    await authenticateRecovery();
  }
  const expected=new Set(manifest.files.map(r=>r.path));
  if(final) for(const operation of plan.operations) {
    if(operation.action==='remove') expected.delete(operation.path);
    if(operation.action==='write' && operation.path.startsWith('.harness/')) expected.add(operation.path);
  }
  const admitted = new Set(gateInventory?.paths ?? []);
  const actual=await tree(target.root, '.harness', admitted);
  for(const ref of actual) if(!expected.has(ref.path)) {
    assert.equal(target.index,0,`Unplanned target addition: ${ref.path}`);
    if (admitted.has(ref.path)) { expected.add(ref.path); continue; }
    if(admission && await authenticateContextInventory(target.root,ref.path,lifecycleTarget.lifecycle.continuity,admission)) {expected.add(ref.path);continue;}
    if(admission && await authenticatePrerequisiteArtifact(target.root,ref,admission)) {expected.add(ref.path);continue;}
    assert(sourceAddition(ref.path),`Unplanned source addition: ${ref.path}`);
    const allowed=lifecycleTarget.lifecycle.additions??[];
    assert(allowed.some(r=>canonicalHash(r)===canonicalHash(ref)),`Unreviewed lifecycle addition: ${ref.path}`);
    expected.add(ref.path);
  }
  equal(actual.map(r=>r.path).sort(),[...expected].sort());
  assert([...admitted].every(relative => actual.some(ref => ref.path === relative)), 'Admitted inventory disappeared');
}

async function authorityInputs(io = ioAt(sourceRoot)) {
  const source = await fixedJson(io, closurePath, candidateSha);
  equal(await authenticateSourceClosure(closurePath), source.ref);
  const initial = await fixedJson(io, `${directory}/preflight.json`, originalSha);
  const native = await fixedJson(io, `${directory}/native-preservation.json`, nativeSha);
  return {source, initial, native};
}

// Capture before an authorized pre-authority worker yields. This exact observation
// is proposal input only; a later independent authority signature admits it.
export async function recordContextWitness() {
  await owner();const io=ioAt(sourceRoot);
  const record=await captureContextWitness(await loadInventoryAdmission(undefined,io),await lifecycle(),io);
  const bytes=Buffer.from(JSON.stringify(record));
  return saveBytes(`.harness/fix-nine-rollout-001/context-witness-${sha(bytes)}.json`,bytes);
}

export async function recordReadOnlyContextObservation(actor) {
  await owner();const io=ioAt(sourceRoot);
  const record=await captureReadOnlyContextObservation(await loadInventoryAdmission(undefined,io),actor,io);
  const bytes=Buffer.from(JSON.stringify(record));
  return saveBytes(`.harness/fix-nine-rollout-001/readonly-context-observation-${sha(bytes)}.json`,bytes);
}

export async function reconstructInventoryAdmission(admission,lifecycle,io,{previous=null}={}) {
  const finite=await extendLifecycleAdmission(admission,lifecycle.lifecycleAdmission,lifecycle,io,{previous:previous?.lifecycleAdmission});
  return extendContextAdmission(finite,lifecycle.contextAdmission,lifecycle,io,{previous:previous?.contextAdmission});
}

export async function prepareDeployment({contextActors,contextWitnesses=[],readOnlyObservations=[],lifecycleAdditions} = {}) {
  await owner(); const io = ioAt(sourceRoot), input = await authorityInputs(io);
  const helperFiles = await Promise.all(requiredHelpers.map(p => io.pin(p)));
  const closure = {version:1,kind:'fix-nine-rollout-composed-source',featureId,preparedSource:input.source.ref,helperFiles};
  const client = await connectNativeHookClient({executable});
  let native;
  try { native = await nativeRead(client); } finally { await client.close(); }
  equal(native.summary.trust, input.native.value.trust); equal(native.summary.definitions,input.native.value.definitions);
  equal(native.summary.raw,input.native.value.raw);assert.equal(native.summary.version,input.native.value.layerVersion);
  assert.equal(native.summary.unrelatedSha256, input.native.value.unrelatedSha256);
  const canonical = await canonicalCodexHooks(sourceRoot);
  const sourceDefinitions = reviewNativeDefinitions(native.discovery, sourceRoot, await readJson(sourceRoot,'.codex/hooks.json'), canonical);
  const nativeTransitions = native.summary.definitions.map(d => {
    const source=sourceDefinitions.find(s=>s.eventName===d.eventName);assert(source);
    const beforeRaw=native.discovery.data.flatMap(row=>row.hooks).find(h=>h.key===d.key);assert(beforeRaw);
    const expected={...source,key:d.key,sourcePath:d.sourcePath,displayOrder:d.displayOrder,trustStatus:'trusted'};
    return {index:targets.indexOf(d.root),root:d.root,key:d.key,before:d.currentHash,after:source.currentHash,eventName:d.eventName,
      beforeRaw,afterRaw:expected,
      beforeDefinition:d,afterDefinition:{...d,currentHash:source.currentHash,trustStatus:'trusted',definitionSha256:canonicalHash(expected),commandSha256:canonicalHash(expected.command)}};
  });
  assert(nativeTransitions.every(t => /^sha256:[a-f0-9]{64}$/.test(t.after)));
  const records = [];
  for (const original of input.initial.value.targets) {
    const plan = await planSync(original.root, {approveNativeHooks:false}); assert(!plan.blocked, `Blocked plan: ${original.root}`);
    const currentLifecycle = original.index === 0 ? await lifecycle() : {features:await readJson(original.root,'.harness/features.json'),continuity:await readJson(original.root,'.harness/continuity.json')};
    const baseline = await pinnedJson(io, original.preservation);
    // Full original inventory is retained. Only the reviewed source prerequisite
    // changed source bytes before this new authority; capture its exact delta.
    const currentManifest = {version:1,root:original.root,files:await tree(original.root)};
    const delta=inventoryDelta(baseline.files,currentManifest.files);
    const row = {index:original.index,root:original.root,originalPreservation:original.preservation,planHash:plan.planHash,
      lifecycle:currentLifecycle,surfaces:original.customSurfaces,initialDelta:delta};
    if(original.index===0) {
      if(lifecycleAdditions!==undefined)currentLifecycle.lifecycleAdmission=structuredClone(lifecycleAdditions);
      const inventory=await extendLifecycleAdmission(await loadInventoryAdmission(input.source.value,io),currentLifecycle.lifecycleAdmission,currentLifecycle,io);
      currentLifecycle.contextAdmission=await proposeContextAdmission(inventory,currentLifecycle,io,null,contextActors,contextWitnesses,readOnlyObservations);
      attachInventory(row,await extendContextAdmission(inventory,currentLifecycle.contextAdmission,currentLifecycle,io));
    }
    await validateInitialInventory(row,baseline,currentManifest,input.source.value,io);
    await validateOriginal(row,original,baseline,input.source.value,plan);
    await validatePreservation(row, original, currentManifest, plan);
    records.push({...row,stagedManifest:currentManifest,stagedPlan:plan});
  }
  validateRoots(records);
  // No artifact is published until every read-only prerequisite has passed.
  const closureRef=await save(composedPath,closure);
  for(const row of records) {
    row.preservation=await save(`${directory}/execution/target-${pad(row.index)}-preservation.json`,row.stagedManifest);
    row.plan=await save(`${directory}/execution/target-${pad(row.index)}-plan.json`,row.stagedPlan);
    delete row.stagedManifest;delete row.stagedPlan;
  }
  const authority = {version:1,kind:'fix-nine-rollout-execution-authority',featureId,createdAt:new Date().toISOString(),sourceClosure:closureRef,
    preparedSource:input.source.ref,initialPreflight:input.initial.ref,nativePreservation:input.native.ref,
    reviewPublicKeySha256:sha(reviewPublicKey),targetRoots:targets,targets:records,recoveryBridge:await authenticateRecovery(),nativeBaseline:native.summary,nativeTransitions,
    nativeTrustRows:clone(native.layer.config.hooks.state),nativeStages:nativeStages(native.layer.config,nativeTransitions),
    rules:{expectedPlanHashRequired:true,orderedApplyAuditContinue:true,independentFinalAudit:true,automaticRetry:false,maxAttempts:5,maxRepeatedFailures:2,exoHold:true}};
  validateNativeAuthority(authority);
  const authorityRef = await save(authorityPath, authority);
  return {authority:authorityRef,sourceClosure:closureRef,reviewBody:{authority:authorityRef,sourceClosure:closureRef,targetRoots:targets,scope:'ordered-eleven-deployment-only'},executionAuthorized:false};
}

async function loadAuthority(io = ioAt(sourceRoot)) {
  const authority = await fixedJson(io, authorityPath), closure = await fixedJson(io, composedPath);
  const seal = await fixedJson(io,sealPath);
  validateReview(seal.value,'execution-authority',{authority:authority.ref,sourceClosure:closure.ref,targetRoots:targets,scope:'ordered-eleven-deployment-only'});
  const inputs = await authorityInputs(io);
  equal(authority.value.sourceClosure, closure.ref); equal(closure.value.preparedSource, inputs.source.ref);
  equal(authority.value.preparedSource, inputs.source.ref); equal(authority.value.initialPreflight, inputs.initial.ref); equal(authority.value.nativePreservation, inputs.native.ref);
  assert.equal(authority.value.kind,'fix-nine-rollout-execution-authority'); assert.equal(authority.value.version,1);
  equal(authority.value.targetRoots,targets); validateRoots(authority.value.targets);
  assert.equal(authority.value.reviewPublicKeySha256,sha(reviewPublicKey));
  equal(closure.value.helperFiles.map(r=>r.path).sort(),requiredHelpers.slice().sort());
  for (const ref of closure.value.helperFiles) await io.authenticate(ref);
  equal(authority.value.nativeBaseline.trust,inputs.native.value.trust);
  equal(authority.value.nativeBaseline.definitions,inputs.native.value.definitions);
  equal(authority.value.nativeBaseline.raw,inputs.native.value.raw);
  validateNativeAuthority(authority.value);
  assert.equal(authority.value.nativeBaseline.version,inputs.native.value.layerVersion);
  assert.equal(authority.value.nativeBaseline.unrelatedSha256,inputs.native.value.unrelatedSha256);
  equal(authority.value.recoveryBridge,await authenticateRecovery(io));
  const references = [authority.ref,closure.ref,inputs.source.ref,inputs.initial.ref,inputs.native.ref,...closure.value.helperFiles];
  references.push(seal.ref);
  for(const target of authority.value.targets) {
    equal(target.originalPreservation,inputs.initial.value.targets[target.index].preservation);
    equal(target.surfaces,inputs.initial.value.targets[target.index].customSurfaces);
    const original=await pinnedJson(io,target.originalPreservation),fresh=await pinnedJson(io,target.preservation),plan=await pinnedJson(io,target.plan);
    if(target.index===0) attachInventory(target,await reconstructInventoryAdmission(await loadInventoryAdmission(inputs.source.value,io),target.lifecycle,io));
    await validateInitialInventory(target,original,fresh,inputs.source.value,io);
    assert.equal(plan.planHash,target.planHash);assert.equal(plan.target,target.root);assert.equal(plan.blocked,false);
    references.push(target.originalPreservation,target.preservation,target.plan);
  }
  return {...authority,closure:closure.ref,inputs,references};
}

export async function prepareLifecycleRefresh(chain = [], {contextActors,contextWitnesses=[],readOnlyObservations=[],lifecycleAdditions} = {}) {
  await owner(); const io = ioAt(sourceRoot), authority = await loadAuthority(io);
  const old=await effectiveTarget(authority,chain,io,[]),previous=chain.at(-1)?.refresh??authority.ref;
  const current = await lifecycle(),baseline=await pinnedJson(io,authority.value.targets[0].preservation);
  current.additions=(await tree(sourceRoot)).filter(ref=>!baseline.files.some(r=>r.path===ref.path)&&sourceAddition(ref.path));
  let transfer=null;
  if(JSON.stringify(old.lifecycle.continuity.lastHandoff)!==JSON.stringify(current.continuity.lastHandoff)) {
    const packet=current.continuity.lastHandoff,eventsRef=current.refs.find(r=>r.path==='.harness/events.jsonl');
    const oldEvents=old.lifecycle.refs.find(r=>r.path==='.harness/events.jsonl');
    const bytes=await io.prefix(eventsRef),events=bytes.subarray(oldEvents.bytes,eventsRef.bytes).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(e=>['handoff.ready','worker.resumed'].includes(e.type));
    transfer={packet,events,archive:await io.pin(`.harness/history/progress/${packet.id}.md`),driftDisposition:packet.drift.length?'availability-only':'none'};
  }
  await authenticateLifecycleStep(old.lifecycle,current,transfer,io);
  await authenticateAdditions(baseline,old.lifecycle,current,io,transfer);
  if(lifecycleAdditions!==undefined)current.lifecycleAdmission=structuredClone(lifecycleAdditions);
  else if(old.lifecycle.lifecycleAdmission)current.lifecycleAdmission={...structuredClone(old.lifecycle.lifecycleAdmission),eventPrefix:current.refs.find(ref=>ref.path==='.harness/events.jsonl')};
  const inventory=await extendLifecycleAdmission(old.inventoryAdmission,current.lifecycleAdmission,current,io,{previous:old.lifecycle.lifecycleAdmission});
  current.contextAdmission=await proposeContextAdmission(inventory,current,io,old.lifecycle.contextAdmission,contextActors,contextWitnesses,readOnlyObservations);
  const plan = await planSync(sourceRoot,{approveNativeHooks:false}); assert(!plan.blocked);
  const id = `${directory}/execution/refresh-${sha(JSON.stringify(current.refs)).slice(0,16)}`;
  const planRef = await save(`${id}-plan.json`,plan);
  const body = {version:1,kind:'fix-nine-rollout-source-lifecycle-refresh',index:0,root:sourceRoot,
    authority:authority.ref,sourceClosure:authority.closure,previous,oldLifecycle:old.lifecycle.refs,
    lifecycle:current,transfer,plan:planRef,planHash:plan.planHash};
  const ref = await save(`${id}.json`,body);
  return {refresh:ref,reviewBody:{refresh:ref,authority:authority.ref,sourceClosure:authority.closure,scope:'source-lifecycle-and-exact-plan-only'}};
}

export function validateRefreshPlan(plan, refresh) {
  assert.equal(plan.planHash,refresh.planHash);assert.equal(plan.target,sourceRoot);
  assert.equal(plan.blocked,false,'Refreshed source plan must be explicitly unblocked');
}

export async function effectiveTarget(authority, refreshes, io, references, publicKey=reviewPublicKey) {
  assert(Array.isArray(refreshes),'Explicit source refresh chain required');
  let target = authority.value.targets[0], previous = authority.ref;
  if(target.inventoryAdmission?.prerequisiteArtifacts?.size) await authenticatePrerequisiteInventory(await pinnedJson(io,target.preservation),target.inventoryAdmission,io);
  for (const item of refreshes) {
    const refresh = await pinnedJson(io,item.refresh), review = await pinnedJson(io,item.review);
    validateReview(review,'source-lifecycle-refresh',{refresh:item.refresh,authority:authority.ref,sourceClosure:authority.closure,scope:'source-lifecycle-and-exact-plan-only'},publicKey);
    equal(refresh.previous,previous); equal(refresh.authority,authority.ref); equal(refresh.sourceClosure,authority.closure);
    assert.equal(refresh.index,0); assert.equal(refresh.root,sourceRoot); equal(refresh.oldLifecycle,target.lifecycle.refs);
    await authenticateLifecycleStep(target.lifecycle,refresh.lifecycle,refresh.transfer,io,references);
    await authenticateAdditions(await pinnedJson(io,target.preservation),target.lifecycle,refresh.lifecycle,io,refresh.transfer);
    const plan = await pinnedJson(io,refresh.plan); validateRefreshPlan(plan,refresh);
    const inventory=target.inventoryAdmission ? await reconstructInventoryAdmission(target.inventoryAdmission,refresh.lifecycle,io,{previous:target.lifecycle}) : null;
    references.push(item.refresh,item.review,refresh.plan); target={...target,lifecycle:refresh.lifecycle,plan:refresh.plan,planHash:refresh.planHash};
    if(inventory) attachInventory(target,inventory);previous=item.refresh;
  }
  return target;
}

function extendsRefreshes(chain, prefix, message) {
  assert(Array.isArray(chain) && Array.isArray(prefix),'Explicit source refresh chains required');
  assert.deepEqual(chain.slice(0,prefix.length),prefix,message);
}

async function canonicalAfter(root, native) {
  return reviewNativeDefinitions(native.discovery,root,await readJson(root,'.codex/hooks.json'),await canonicalCodexHooks(sourceRoot));
}
function applyPath(index) { return `${directory}/execution/target-${pad(index)}-apply.json`; }
function auditPath(index) { return `${directory}/execution/target-${pad(index)}-audit.json`; }
function continuePath(index) { return `${directory}/execution/target-${pad(index)}-continue.json`; }
function reservationPath(index) {return `${directory}/execution/target-${pad(index)}-reservation.json`;}

export async function validateStartup(io,startup,root,notBefore,references,prefix) {
  assert.equal(startup.healthy,true);assert.equal(startup.commands.length,2);
  const expected=[['doctor'],['bootstrap','--validate','--json']];let previous=Date.parse(notBefore);assert(Number.isFinite(previous));
  for(const [index,command] of startup.commands.entries()) {
    assert.equal(command.executable,process.execPath);equal(command.args,['.harness/run.mjs',...expected[index]]);assert.equal(command.cwd,root);
    equal(command.outcome,{confirmed:true,exitCode:0,signal:null,timedOut:false,error:null});
    assert(Date.parse(command.startedAt)>=previous);assert(Date.parse(command.finishedAt)>=Date.parse(command.startedAt));previous=Date.parse(command.finishedAt);
    const name=index===0?'doctor':'bootstrap';
    equal(command.logs.stdout.path,`${prefix}-${name}.stdout.log`);equal(command.logs.stderr.path,`${prefix}-${name}.stderr.log`);
    const stdout=String(await io.authenticate(command.logs.stdout));await io.authenticate(command.logs.stderr);
    if(index===0) assert(stdout.startsWith(`Harness doctor: ${root} (runtime v`),'Doctor output belongs to another root');
    else assert.equal(JSON.parse(stdout).validation?.healthy,true,'Physical bootstrap output is unhealthy');
    references.push(command.logs.stdout,command.logs.stderr);
  }
  return previous;
}

async function startupCommand(root,args) {
  const startedAt=new Date().toISOString();
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['.harness/run.mjs',...args],{cwd:root,env:readOnlyEnvironment(),windowsHide:true,stdio:['ignore','pipe','pipe']});
    const stdout=[],stderr=[];let bytes=0,timedOut=false,error=null;
    const timeout=setTimeout(()=>{timedOut=true;child.kill();},300000);
    const collect=target=>chunk=>{bytes+=chunk.length;if(bytes>8*1024*1024){error='Startup output limit exceeded';child.kill();}else target.push(chunk);};
    child.stdout.on('data',collect(stdout));child.stderr.on('data',collect(stderr));child.on('error',e=>{error=String(e.message);});
    child.on('close',(exitCode,signal)=>{
      clearTimeout(timeout);const outcome={confirmed:true,exitCode,signal,timedOut,error};
      if(exitCode!==0||signal||timedOut||error) {reject(new Error(`Read-only startup failed: ${JSON.stringify(outcome)}`));return;}
      resolve({executable:process.execPath,args:['.harness/run.mjs',...args],cwd:root,startedAt,finishedAt:new Date().toISOString(),outcome,
        stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr)});
    });
  });
}
async function captureStartup(root,prefix) {
  const commands=[];
  for(const args of [['doctor'],['bootstrap','--validate','--json']]) {
    const result=await startupCommand(root,args),name=args[0]==='doctor'?'doctor':'bootstrap';
    const logs={stdout:await saveBytes(`${prefix}-${name}.stdout.log`,result.stdout),stderr:await saveBytes(`${prefix}-${name}.stderr.log`,result.stderr)};
    delete result.stdout;delete result.stderr;commands.push({...result,logs});
  }
  return {healthy:true,commands};
}

export async function validateAudit(io, authority, row, references, publicKey=reviewPublicKey) {
  assert.equal(row.apply.path,applyPath(row.index));assert.equal(row.audit.path,auditPath(row.index));assert.equal(row.continue.path,continuePath(row.index));
  const applied = await pinnedJson(io,row.apply), audited = await pinnedJson(io,row.audit), review = await pinnedJson(io,row.continue);
  assert.equal(applied.kind,'fix-nine-rollout-applied'); assert.equal(applied.confirmed,true);
  equal(applied.authority,authority.ref); equal(applied.sourceClosure,authority.closure);
  assert.equal(applied.index,row.index); assert.equal(applied.root,row.root);
  assert.equal(applied.reservation.path,reservationPath(row.index));
  const reservation=await pinnedJson(io,applied.reservation);
  equal(reservation,{version:1,kind:'fix-nine-rollout-reserved',authority:authority.ref,sourceClosure:authority.closure,index:row.index,root:row.root,
    plan:applied.plan,expectedPlanHash:applied.expectedPlanHash,actor:applied.actor,startedAt:applied.startedAt,refreshes:applied.refreshes});
  assert(Date.parse(applied.finishedAt)>=Date.parse(applied.startedAt));
  validateNativeReceipt(applied.native,authority.value,row.index);
  equal(audited.apply,row.apply); assert.equal(audited.root,row.root); assert.equal(audited.index,row.index);
  assert.equal(audited.kind,'fix-nine-rollout-product-audit'); assert.equal(audited.pass,true);
  validateNative(audited.native,authority.value,row.index);equal(audited.native,applied.native.after);
  assert(audited.actor !== applied.actor,'Independent audit actor must differ from executor');
  const appliedSource=await effectiveTarget(authority,applied.refreshes,io,references,publicKey);
  await effectiveTarget(authority,audited.sourceRefreshes,io,references,publicKey);
  extendsRefreshes(audited.sourceRefreshes,applied.refreshes,'Audit source chain must extend its apply-time chain');
  const target=row.index===0?appliedSource:authority.value.targets[row.index];
  equal(applied.plan,target.plan);assert.equal(applied.expectedPlanHash,target.planHash);
  const startupFinished=await validateStartup(io,audited.startup,row.root,applied.finishedAt,references,`${directory}/execution/target-${pad(row.index)}-startup`);
  assert(Date.parse(audited.at)>=startupFinished);assert(audited.structural.overall >= 95); assert.equal(audited.structural.criticalFailures.length,0);
  assert(Date.parse(audited.at) >= Date.parse(applied.finishedAt));
  validateReview(review,'product-audit',{authority:authority.ref,sourceClosure:authority.closure,apply:row.apply,audit:row.audit,
    actor:audited.actor,index:row.index,root:row.root,scope:'same-target-after-deployment',verdict:'CONTINUE'},publicKey);
  references.push(applied.reservation,row.apply,row.audit,row.continue);
  return {applied,audited};
}

// Executes one target only. An exclusive reservation prevents an unknown
// filesystem/native outcome from being automatically replayed.
export async function executeTarget(index, refreshes = []) {
  await owner(); assert(Number.isInteger(index) && index >= 0 && index < 11);
  const io=ioAt(sourceRoot), authority=await loadAuthority(io), references=[];
  let target=authority.value.targets[index];
  const source=await effectiveTarget(authority,refreshes,io,references); if(index===0) target=source;
  for(let i=0;i<index;i++) {
    const {audited}=await validateAudit(io,authority,{index:i,root:targets[i],apply:await io.pin(applyPath(i)),audit:await io.pin(auditPath(i)),continue:await io.pin(continuePath(i))},references);
    extendsRefreshes(refreshes,audited.sourceRefreshes,'Execution source chain must extend every preceding audit chain');
  }
  const plan=await pinnedJson(io,target.plan); assert.equal(plan.planHash,target.planHash); assert.equal(plan.target,target.root);
  equal(JSON.parse(JSON.stringify(await planSync(target.root,{approveNativeHooks:false}))),plan,'Fresh sync plan changed; exact reviewed refresh required');
  const original=authority.inputs.initial.value.targets[index], manifest=await pinnedJson(io,target.preservation);
  await validatePreservation(target,original,manifest,plan);
  const client=await connectNativeHookClient({executable});
  const startedAt=new Date().toISOString();
  let reservation=null,phase='before-reservation';
  try {
    const before=await nativeRead(client); validateNative(before.summary,authority.value,index-1);
    if(index>0) equal(before.summary,(await pinnedJson(io,await io.pin(applyPath(index-1)))).native.after,'Native state drift since preceding confirmed target');
    reservation=await save(reservationPath(index),{version:1,kind:'fix-nine-rollout-reserved',authority:authority.ref,sourceClosure:authority.closure,index,root:target.root,plan:target.plan,expectedPlanHash:target.planHash,actor:actor(),startedAt,refreshes});
    phase='sync-started';
    const result=await syncHarness(target.root,{expectedPlanHash:target.planHash,approveNativeHooks:false});
    assert.equal(result.planHash,target.planHash);
    phase='sync-confirmed';
    const observed=await nativeRead(client), definitions=await canonicalAfter(target.root,observed);
    equal(observed.summary.trust,before.summary.trust); assert.equal(observed.summary.unrelatedSha256,before.summary.unrelatedSha256);
    const transitions=authority.value.nativeTransitions.filter(t=>t.index===index); assert.equal(transitions.length,6);
    for(const transition of transitions) assert(definitions.some(d=>d.key===transition.key && d.currentHash===transition.after));
    const state=clone(observed.layer.config.hooks.state);
    for(const transition of transitions) state[transition.key]={...state[transition.key],trusted_hash:transition.after};
    const request={filePath:observed.layer.name.file,expectedVersion:observed.layer.version,reloadUserConfig:true,edits:[{keyPath:'hooks.state',mergeStrategy:'replace',value:state}]};
    const needsWrite=canonicalHash(state)!==canonicalHash(observed.layer.config.hooks.state);
    let responseError=null,response=null;
    phase=needsWrite?'native-request-started':'native-unchanged';
    if(needsWrite) try { response=await client.rpc('config/batchWrite',request); } catch(error) {responseError={code:error.code??null,message:String(error.message)};}
    const after=await nativeRead(client); validateNative(after.summary,authority.value,index);
    const expected=clone(observed.layer.config); expected.hooks.state=state;
    assert.equal(after.summary.semanticSha256,canonicalHash(expected),'Native CAS readback is indeterminate; no retry authorized');
    await validatePreservation(target,original,manifest,plan,{final:true});
    const receipt={version:1,kind:'fix-nine-rollout-applied',authority:authority.ref,sourceClosure:authority.closure,index,root:target.root,
      actor:actor(),startedAt,finishedAt:new Date().toISOString(),confirmed:true,reservation,plan:target.plan,expectedPlanHash:target.planHash,refreshes,
      sync:JSON.parse(JSON.stringify(result)),native:{before:before.summary,observed:observed.summary,after:after.summary,
        method:needsWrite?'config/batchWrite':'unchanged',request:needsWrite?request:null,response,responseError,
        expectedSemanticSha256:canonicalHash(expected),confirmed:true,writeCount:needsWrite?1:0}};
    validateNativeReceipt(receipt.native,authority.value,index);
    return save(applyPath(index),receipt);
  } catch(error) {
    if(reservation) await save(`${directory}/execution/target-${pad(index)}-outcome.json`,{version:1,kind:'fix-nine-rollout-unconfirmed-outcome',
      authority:authority.ref,sourceClosure:authority.closure,index,root:target.root,reservation,phase,at:new Date().toISOString(),confirmed:false,retryAuthorized:false});
    throw error;
  } finally {await client.close();}
}

export async function auditTarget(index,sourceRefreshes=[]) {
  await owner();assert(Number.isInteger(index)&&index>=0&&index<11); const io=ioAt(sourceRoot),authority=await loadAuthority(io);
  const apply=await io.pin(applyPath(index)), applied=await pinnedJson(io,apply); assert.notEqual(actor(),applied.actor,'Audit requires a distinct native actor');
  const references=[],source=await effectiveTarget(authority,applied.refreshes,io,references),target=index===0?source:authority.value.targets[index];
  const latestSource=await effectiveTarget(authority,sourceRefreshes,io,references);
  extendsRefreshes(sourceRefreshes,applied.refreshes,'Audit source chain must extend its apply-time chain');
  equal(applied.plan,target.plan);assert.equal(applied.expectedPlanHash,target.planHash);
  await authenticateSourceLifecycle(sourceRoot,latestSource.lifecycle);
  const plan=await pinnedJson(io,target.plan),manifest=await pinnedJson(io,target.preservation);
  await validatePreservation(target,authority.inputs.initial.value.targets[index],manifest,plan,{final:true,lifecycleTarget:latestSource});
  const structural=await auditHarness(target.root); assert(structural.overall>=95); assert.equal(structural.criticalFailures.length,0);
  // The generated runtime's actual read-only startup validates its state and
  // content-addressed history without claiming or resuming that product.
  const startup=await captureStartup(target.root,`${directory}/execution/target-${pad(index)}-startup`);
  await validateStartup(io,startup,target.root,applied.finishedAt,[],`${directory}/execution/target-${pad(index)}-startup`);
  const client=await connectNativeHookClient({executable});let native;
  try {native=(await nativeRead(client)).summary;validateNative(native,authority.value,index);}finally{await client.close();}
  const audit={version:1,kind:'fix-nine-rollout-product-audit',index,root:target.root,actor:actor(),at:new Date().toISOString(),apply,
    pass:true,structural,startup,native,sourceRefreshes};
  const ref=await save(auditPath(index),audit);
  return {audit:ref,reviewBody:{authority:authority.ref,sourceClosure:authority.closure,apply,audit:ref,actor:audit.actor,index,root:target.root,scope:'same-target-after-deployment',verdict:'CONTINUE'}};
}
function readOnlyEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMW6432','COMMONPROGRAMFILES','CODEX_THREAD_ID'].includes(key.toUpperCase())));
}

export async function prepareFinalAudit(sourceRefreshes=[]) {
  await owner();
  const io=ioAt(sourceRoot),authority=await loadAuthority(io),references=[],rows=[];
  const latestSource=await effectiveTarget(authority,sourceRefreshes,io,references);
  for(let index=0;index<11;index++) {
    const row={index,root:targets[index],apply:await io.pin(applyPath(index)),audit:await io.pin(auditPath(index)),continue:await io.pin(continuePath(index))};
    const result=await validateAudit(io,authority,row,references); assert.notEqual(actor(),result.applied.actor);
    extendsRefreshes(sourceRefreshes,result.applied.refreshes,'Final source chain must extend every apply-time chain');
    extendsRefreshes(sourceRefreshes,result.audited.sourceRefreshes,'Final source chain must extend every audit-time chain');
    rows.push(row);
  }
  const client=await connectNativeHookClient({executable});let native;
  try {native=(await nativeRead(client)).summary;validateNative(native,authority.value,10);}finally{await client.close();}
  const checks=[];
  for(const row of rows) {
    const applied=await pinnedJson(io,row.apply),source=await effectiveTarget(authority,applied.refreshes,io,references),target=row.index===0?source:authority.value.targets[row.index];
    await validateOriginal(target,authority.inputs.initial.value.targets[row.index],await pinnedJson(io,target.originalPreservation),authority.inputs.source.value,await pinnedJson(io,target.plan),{final:true});
    await validatePreservation(target,authority.inputs.initial.value.targets[row.index],await pinnedJson(io,target.preservation),await pinnedJson(io,target.plan),{final:true,lifecycleTarget:latestSource});
    const structural=await auditHarness(row.root);assert(structural.overall>=95);assert.equal(structural.criticalFailures.length,0);
    checks.push({index:row.index,root:row.root,structural});
  }
  const exoStartup=await captureStartup(targets[4],`${directory}/execution/final-exo`);
  const lastAudit=Math.max(...await Promise.all(rows.map(async row=>Date.parse((await pinnedJson(io,row.audit)).at))));
  await validateStartup(io,exoStartup,targets[4],new Date(lastAudit).toISOString(),[],`${directory}/execution/final-exo`);
  const final={version:1,kind:'fix-nine-rollout-final-independent-audit',authority:authority.ref,sourceClosure:authority.closure,actor:actor(),at:new Date().toISOString(),targets:rows,checks,native,sourceRefreshes,verdict:'CONTINUE',
    exo:{updatedDeployment:true,startup:exoStartup,independentAuditContinue:true,hold:'pending-final-gate',holdCleared:false}};
  const ref=await save(`${directory}/execution/final-audit.json`,final);
  return {audit:ref,reviewBody:{authority:authority.ref,sourceClosure:authority.closure,audit:ref,actor:final.actor,targetRoots:targets,scope:'final-all-eleven-after-deployment-and-startup',verdict:'CONTINUE'}};
}

export async function writeDeploymentReport() {
  await owner();const io=ioAt(sourceRoot),authority=await loadAuthority(io);
  const final=await io.pin(`${directory}/execution/final-audit.json`),review=await io.pin(`${directory}/execution/final-continue.json`);
  const audit=await pinnedJson(io,final);
  validateReview(await pinnedJson(io,review),'product-audit',{authority:authority.ref,sourceClosure:authority.closure,audit:final,actor:audit.actor,targetRoots:targets,scope:'final-all-eleven-after-deployment-and-startup',verdict:'CONTINUE'});
  const report={version:1,kind:'fix-nine-rollout-deployed',featureId,authority:authority.ref,sourceClosure:authority.closure,targets:audit.targets,sourceRefreshes:audit.sourceRefreshes,finalAudit:final,finalContinue:review};
  await save(reportPath,report);
  return authenticateDeployment({root:sourceRoot,io});
}

export async function authenticateDeployment({root,io,sourceRelease}) {
  assert.equal(path.resolve(root),sourceRoot); const authority=await loadAuthority(io);
  const report=await fixedJson(io,reportPath),value=report.value,references=authority.references.slice();
  assert.equal(value.version,1);assert.equal(value.kind,'fix-nine-rollout-deployed');assert.equal(value.featureId,featureId);
  equal(value.authority,authority.ref);equal(value.sourceClosure,authority.closure);validateRoots(value.targets);
  const latestSource=await effectiveTarget(authority,value.sourceRefreshes,io,references);
  const gateInventory=await authenticateGateInventory(root,sourceRelease);
  validateAttemptPaths(await readdir(path.join(sourceRoot,directory,'execution')));
  let previousFinished=0,previousNative=null;
  for(const row of value.targets) {
    const {applied,audited}=await validateAudit(io,authority,row,references);
    extendsRefreshes(value.sourceRefreshes,applied.refreshes,'Final source chain does not extend an apply-time chain');
    extendsRefreshes(value.sourceRefreshes,audited.sourceRefreshes,'Final source chain does not extend an audit-time chain');
    assert(Date.parse(applied.startedAt)>=previousFinished);previousFinished=Date.parse(audited.at);
    const source=await effectiveTarget(authority,applied.refreshes,io,references),target=row.index===0?source:authority.value.targets[row.index];
    equal(applied.plan,target.plan);assert.equal(applied.expectedPlanHash,target.planHash);
    const plan=await pinnedJson(io,target.plan),manifest=await pinnedJson(io,target.preservation);
    equal(applied.sync.operations,plan.operations);assert.equal(applied.sync.planHash,plan.planHash);
    validateNativeReceipt(applied.native,authority.value,row.index);
    if(previousNative) equal(applied.native.before,previousNative,'Native receipt chain changed');
    previousNative=applied.native.after;
    await validateOriginal(target,authority.inputs.initial.value.targets[row.index],await pinnedJson(io,target.originalPreservation),authority.inputs.source.value,plan,{final:true});
    await validatePreservation(target,authority.inputs.initial.value.targets[row.index],manifest,plan,{final:true,lifecycleTarget:latestSource,
      gateInventory:row.index===0?gateInventory:null,sourceRelease:row.index===0?sourceRelease:undefined});
    references.push(target.plan,target.preservation);
  }
  const final=await pinnedJson(io,value.finalAudit),review=await pinnedJson(io,value.finalContinue);
  assert.equal(final.kind,'fix-nine-rollout-final-independent-audit');equal(final.targets,value.targets);equal(final.authority,authority.ref);equal(final.sourceClosure,authority.closure);
  equal(final.sourceRefreshes,value.sourceRefreshes);
  validateRoots(final.checks);assert(final.checks.every(r=>r.structural.overall>=95 && !r.structural.criticalFailures.length));
  assert.equal(final.verdict,'CONTINUE');assert(Date.parse(final.at)>=previousFinished);
  for(const row of value.targets) assert.notEqual(final.actor,(await pinnedJson(io,row.apply)).actor);
  validatePreGateHold(final.exo);
  const exoFinished=await validateStartup(io,final.exo.startup,targets[4],new Date(previousFinished).toISOString(),references,`${directory}/execution/final-exo`);
  assert(Date.parse(final.at)>=exoFinished);validateNative(final.native,authority.value,10);
  validateReview(review,'product-audit',{authority:authority.ref,sourceClosure:authority.closure,audit:value.finalAudit,actor:final.actor,targetRoots:targets,scope:'final-all-eleven-after-deployment-and-startup',verdict:'CONTINUE'});
  references.push(value.finalAudit,value.finalContinue);
  // Fresh native observation and all installed bytes are required at every
  // preverify/ac1/postverify call. These observations are not changing refs.
  const client=await connectNativeHookClient({executable});
  try {validateNative((await nativeRead(client)).summary,authority.value,10);}finally{await client.close();}
  // Current health is observed without adding changing references to the gate
  // binding, which remains identical before/ac1/after the outer verification.
  const doctor=await startupCommand(targets[4],['doctor']);assert(String(doctor.stdout).startsWith(`Harness doctor: ${targets[4]} (runtime v`));
  const bootstrap=await startupCommand(targets[4],['bootstrap','--validate','--json']);assert.equal(JSON.parse(String(bootstrap.stdout)).validation?.healthy,true);
  for(const ref of references) await io.authenticate(ref);
  await io.authenticate(report.ref);
  equal(await authenticateGateInventory(root,sourceRelease),gateInventory,'Gate inventory changed during deployment authentication');
  return {version:1,kind:'fix-nine-rollout-authenticated-deployment',featureId,report:report.ref,authority:authority.ref,sourceClosure:authority.closure,references};
}

// Additive post-gate evidence only: earlier HOLD/audit/history records stay exact.
export const exoClearanceAuditPath = `${directory}/execution/post-gate-exo-audit.json`;
export const exoClearanceContinuePath = `${directory}/execution/post-gate-exo-continue.json`;
export const exoClearancePath = `${directory}/execution/post-gate-exo-clearance.json`;

async function exoClearanceContext(sourceRelease) {
  // Dynamic import avoids a module-initialization cycle with the gate adapter.
  // This authenticates all eleven deployments, preservation, hooks, recovery,
  // five-attempt policy, and the actual configured final verification receipt.
  const {authenticateGate} = await import('./fix-nine-rollout-gate.mjs');
  const gate = await authenticateGate({sourceRelease});
  assert.equal(gate.pass, true); assert.equal(gate.featureId, featureId);
  const io = ioAt(sourceRoot), receipt = await pinnedJson(io, gate.receipt);
  const deployment = receipt.bindings.deployment;
  const report = await pinnedJson(io, deployment.report);
  const row = report.targets[4]; assert.equal(row.index, 4); assert.equal(row.root, targets[4]);
  const runtime = await pinFile(row.root, '.harness/run.mjs');
  equal(runtime, receipt.bindings.runtime, 'Exo runtime differs from the final gate runtime');
  const state = await Promise.all(['.harness/config.json', '.harness/features.json',
    '.harness/continuity.json', '.harness/events.jsonl'].map(file => pinFile(row.root, file)));
  const config = jsonBytes(await authenticateFile(row.root, state[0]));
  assert.equal(config.policies.maxAttempts, 5); assert.equal(config.policies.maxRepeatedFailures, 2);
  const applyActors = await Promise.all(report.targets.map(async target => (await pinnedJson(io, target.apply)).actor));
  for (const ref of [runtime, ...state]) await authenticateFile(row.root, ref);
  await io.authenticate(gate.receipt); await io.authenticate(deployment.report);
  return {gate: gate.receipt, gateSealedAt: receipt.sealedAt, gateActor: receipt.invocation.actor,
    deployment, target: {...row, runtime, state}, applyActors};
}

export async function validateExoClearanceAudit(io, audit, current, references = []) {
  assert.equal(audit.version, 1); assert.equal(audit.kind, 'fix-nine-rollout-exo-post-gate-audit');
  assert.equal(audit.featureId, featureId); equal(audit.gate, current.gate);
  equal(audit.deployment, current.deployment); equal(audit.target, current.target);
  assert.equal(audit.hold, 'pending-independent-clearance'); assert.equal(audit.holdCleared, false);
  assert(typeof audit.actor === 'string' && audit.actor.length > 0);
  assert.equal(audit.actor, current.gateActor, 'The owned gate executor must capture the startup candidate');
  const finished = await validateStartup(io, audit.startup, current.target.root, current.gateSealedAt,
    references, `${directory}/execution/post-gate-exo`);
  assert(Number.isFinite(Date.parse(audit.at)) && Date.parse(audit.at) >= finished);
}

export function exoClearanceReviewBody(auditRef, audit, reviewerActor) {
  assert(typeof reviewerActor === 'string' && reviewerActor.length > 0);
  assert.notEqual(reviewerActor, audit.actor, 'Independent reviewer must differ from the startup capture actor');
  return {authority: audit.deployment.authority, sourceClosure: audit.deployment.sourceClosure,
    gate: audit.gate, audit: auditRef, actor: reviewerActor, target: audit.target,
    scope: 'exo-after-authenticated-final-gate-and-current-startup', verdict: 'CONTINUE'};
}

export function validateExoClearanceReview(review, auditRef, audit, current, publicKey = reviewPublicKey) {
  const reviewerActor = review.body?.actor;
  assert.notEqual(reviewerActor, current.gateActor, 'Post-gate review must be independent of the gate executor');
  for (const executor of current.applyActors) assert.notEqual(reviewerActor, executor, 'Post-gate review must be independent of deployment');
  validateReview(review, 'product-audit', exoClearanceReviewBody(auditRef, audit, reviewerActor), publicKey);
}

export function validateExoClearanceReceipt(receipt, {current, auditRef, audit, reviewRef}, observedAt) {
  const {sealedAt, ...body} = receipt;
  equal(body, {version: 1, kind: 'fix-nine-rollout-exo-clearance', featureId, gate: current.gate,
    deployment: current.deployment, target: current.target, audit: auditRef, independentContinue: reviewRef,
    hold: 'cleared', holdCleared: true});
  assert(Number.isFinite(Date.parse(sealedAt)) && Date.parse(sealedAt) >= Date.parse(audit.at));
  assert(Number.isFinite(Date.parse(observedAt)) && Date.parse(sealedAt) <= Date.parse(observedAt));
}

export async function prepareExoClearanceAudit() {
  await owner();
  const current = await exoClearanceContext(), io = ioAt(sourceRoot), captureActor = actor();
  assert.equal(captureActor, current.gateActor);
  const startup = await captureStartup(targets[4], `${directory}/execution/post-gate-exo`);
  const sourceReleaseBoundary=await captureSourceReleaseBoundary(sourceRoot,saveBytes);
  const audit = {version: 1, kind: 'fix-nine-rollout-exo-post-gate-audit', sourceReleaseBoundary, featureId, gate: current.gate,
    deployment: current.deployment, target: current.target, actor: captureActor, at: new Date().toISOString(),
    startup, hold: 'pending-independent-clearance', holdCleared: false};
  const references = []; await validateExoClearanceAudit(io, audit, current, references);
  equal(await exoClearanceContext(), current, 'Deployment changed during post-gate startup');
  await authenticateOwnedReleaseBoundary(sourceRoot,sourceReleaseBoundary);
  for (const ref of references) await io.authenticate(ref);
  await authenticateOwnedReleaseBoundary(sourceRoot,sourceReleaseBoundary);
  await owner();
  const ref = await save(exoClearanceAuditPath, audit);
  return {audit: ref, reviewKind: 'product-audit', reviewScope: 'exo-after-authenticated-final-gate-and-current-startup', holdCleared: false};
}

async function reviewedExoClearance(current, io, publicKey=reviewPublicKey) {
  const auditRef = await io.pin(exoClearanceAuditPath), reviewRef = await io.pin(exoClearanceContinuePath);
  const audit = await pinnedJson(io, auditRef), review = await pinnedJson(io, reviewRef), references = [];
  await validateExoClearanceAudit(io, audit, current, references);
  validateExoClearanceReview(review, auditRef, audit, current, publicKey);
  for (const ref of [auditRef, reviewRef, ...references]) await io.authenticate(ref);
  return {current, auditRef, audit, reviewRef, references};
}

export async function authenticateExoClearanceWorkflow({root,publicKey,context}) {
  const sourceRelease=await authenticateSourceRelease({root,publicKey});
  const current = await context(sourceRelease), io = ioAt(root);
  const reviewed = await reviewedExoClearance(current, io,publicKey), ref = await io.pin(exoClearancePath);
  const receipt = await pinnedJson(io, ref);
  validateExoClearanceReceipt(receipt, reviewed, new Date().toISOString());
  equal(await context(sourceRelease), current, 'Deployment changed during clearance authentication');
  await releaseState(root,sourceRelease);
  for (const pin of [ref, reviewed.auditRef, reviewed.reviewRef, ...reviewed.references]) await io.authenticate(pin);
  return {pass: true, featureId, clearance: ref, gate: current.gate, root: current.target.root, holdCleared: true};
}

export async function authenticateExoClearance() {
  return authenticateExoClearanceWorkflow({root:sourceRoot,publicKey:reviewPublicKey,context:exoClearanceContext});
}

export async function clearExoHold() {
  await owner();
  const current = await exoClearanceContext(), io = ioAt(sourceRoot);
  const reviewed = await reviewedExoClearance(current, io);
  equal(await exoClearanceContext(), current, 'Deployment changed before clearance sealing');
  await authenticateOwnedReleaseBoundary(sourceRoot,reviewed.audit.sourceReleaseBoundary);
  for (const ref of [reviewed.auditRef, reviewed.reviewRef, ...reviewed.references]) await io.authenticate(ref);
  await owner();
  const receipt = {version: 1, kind: 'fix-nine-rollout-exo-clearance', featureId, gate: current.gate,
    deployment: current.deployment, target: current.target, audit: reviewed.auditRef, independentContinue: reviewed.reviewRef,
    hold: 'cleared', holdCleared: true, sealedAt: new Date().toISOString()};
  validateExoClearanceReceipt(receipt, reviewed, new Date().toISOString());
  await authenticateOwnedReleaseBoundary(sourceRoot,reviewed.audit.sourceReleaseBoundary);
  await save(exoClearancePath, receipt); // Exclusive, additive, never rewrites the pre-gate HOLD.
  return authenticateExoClearance();
}


export function validatePreGateHold(exo) {
  assert.equal(exo.updatedDeployment,true);assert.equal(exo.independentAuditContinue,true);
  assert.equal(exo.hold,'pending-final-gate');assert.equal(exo.holdCleared,false);
}

export function validateAttemptPaths(names) {
  const actual=names.filter(name=>/^target-.*-(reservation|apply|outcome)\.json$/.test(name)).sort();
  const expected=Array.from({length:11},(_,index)=>[`target-${pad(index)}-reservation.json`,`target-${pad(index)}-apply.json`]).flat().sort();
  equal(actual,expected,'Every attempt must have its canonical reservation and confirmed apply; unknown outcomes require reconciliation, never an automatic retry');
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [mode,arg,refreshFile]=process.argv.slice(2);let result;
  if(mode==='prepare') result=await prepareDeployment(arg?await readJson(sourceRoot,arg):{});
  else if(mode==='record-context-witness') result=await recordContextWitness();
  else if(mode==='record-readonly-context-observation') result=await recordReadOnlyContextObservation(arg);
  else if(mode==='refresh') result=await prepareLifecycleRefresh(arg?await readJson(sourceRoot,arg):[],refreshFile?await readJson(sourceRoot,refreshFile):{});
  else if(mode==='execute') result=await executeTarget(Number(arg),refreshFile?await readJson(sourceRoot,refreshFile):[]);
  else if(mode==='audit') result=await auditTarget(Number(arg),refreshFile?await readJson(sourceRoot,refreshFile):[]);
  else if(mode==='final-audit') result=await prepareFinalAudit(arg?await readJson(sourceRoot,arg):[]);
  else if(mode==='report') result=await writeDeploymentReport();
  else if(mode==='authenticate') result=await authenticateDeployment({root:sourceRoot,io:ioAt(sourceRoot)});
  else if(mode==='prepare-exo-clearance') result=await prepareExoClearanceAudit();
  else if(mode==='clear-exo-hold') result=await clearExoHold();
  else if(mode==='authenticate-exo-clearance') result=await authenticateExoClearance();
  else throw new Error('Use record-context-witness|record-readonly-context-observation ACTOR|prepare [OPTIONS]|refresh [PREVIOUS] [OPTIONS]|execute INDEX [REFRESH_CHAIN]|audit INDEX [REFRESH_CHAIN]|final-audit|report|authenticate|prepare-exo-clearance|clear-exo-hold|authenticate-exo-clearance');
  console.log(JSON.stringify(result));
}
