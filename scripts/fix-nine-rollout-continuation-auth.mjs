import {gateContinuity} from './fix-nine-rollout-release.mjs';
// Report/authority semantics belong to the separately reviewed deployment
// adapter. Its fixed path is deliberately fail-closed until implemented.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {canonicalHash, normalizedContract, rolloutFeatureId, rolloutReport, gateDirectory, expectedVerificationPlan,
  gateTimeout, validateVerificationEvidence, validatePassingTransition} from './fix-nine-rollout-evidence.mjs';
import {authenticateFile, authenticatePrefix, inventoryAdditions, pinFile, readJson, regularInventoryPaths} from './fix-nine-rollout-files.mjs';
import {validateReview,reviewPublicKey} from './fix-nine-rollout-deployment.mjs';
import {authenticateRecoveryReview} from './fix-nine-rollout-recovery-epoch.mjs';
import {validateSourceClosure,validatePrerequisite} from './fix-nine-rollout-closure.mjs';
import {targets} from './fix-nine-rollout-preflight.mjs';

// Final activation must replace null with the actual independently reviewed
// public-only launch anchor pin. An envelope can never select this trust root.
export const recoveryEpochAnchorRef=Object.freeze({"path":".harness/fix-nine-rollout-001/continuation/recovery/recovery-owner182-3a89afaa4c821486-anchor.json","bytes":1811,"sha256":"d53576631c6e7382411f625620ab9d1eaaeb7b231bfcc43c67eae2679a9db1d1"});
export function isRecoveryReviewPath(relative) {
 if([contextAdmissionPaths.review,
   '.harness/fix-nine-rollout-001/continuation/nine-final-continue.json',
   '.harness/fix-nine-rollout-001/continuation/final-continue.json',
   '.harness/fix-nine-rollout-001/continuation/transcript-maintenance/code-review.json',
   '.harness/fix-nine-rollout-001/continuation/transcript-maintenance/batch-review.json',
   '.harness/fix-nine-rollout-001/execution/post-gate-exo-continue.json'].includes(relative))return true;
 return false;
}
export async function authenticateContinuationReview({io,reviewRef,kind,body}) {
 if(!isRecoveryReviewPath(reviewRef.path)) {
   const seal=JSON.parse(await io.authenticate(reviewRef));validateReview(seal,kind,body);
   return {seal,publicKey:reviewPublicKey,refs:[reviewRef]};
 }
 const anchorRef=recoveryEpochAnchorRef;
 assert(anchorRef,'Recovery epoch activation requires the actual reviewed anchor pin');
 const checked=await authenticateRecoveryReview({io,sealRef:reviewRef,kind,body,admission:{anchorRef}});
 validateReview(checked.seal,kind,body,checked.publicKey);return checked;
}
export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sourceInstalledHookPins=Object.freeze({
  before:{path:'.harness/hooks/native-hook-identity.mjs',bytes:4060,sha256:'6979455444bcdec7c02bc843feafc0df1bb4bb6f2cba65b95f82e871de278f97'},
  after:{path:'.harness/hooks/native-hook-identity.mjs',bytes:4384,sha256:'69c7a129d9e8418758e9193cfd4bdd692bd36079a62270a3d57994241efbf94d'},
  archive:{path:'.harness/fix-nine-rollout-001/continuation/pre-recovery-native-hook-identity.mjs',bytes:4060,sha256:'6979455444bcdec7c02bc843feafc0df1bb4bb6f2cba65b95f82e871de278f97'},
  template:{path:'skill/codex-harness/assets/native-hook-identity.mjs',bytes:4060,sha256:'6979455444bcdec7c02bc843feafc0df1bb4bb6f2cba65b95f82e871de278f97'},
  inventoryBefore:{path:'.harness/managed-files.json',bytes:1696,sha256:'a754e5e3a49e92352d82a8f0252237cdaf40c0de1468b9ee71249b2758599a14'},
  inventoryAfter:{path:'.harness/managed-files.json',bytes:1696,sha256:'1d89d6db74d0dc17e3cb8fdb5ca2777726ee1ee3c8dc60f983267615bb4d50f3'},
  inventoryArchive:{path:'.harness/fix-nine-rollout-001/continuation/pre-recovery-managed-files.json',bytes:1696,sha256:'a754e5e3a49e92352d82a8f0252237cdaf40c0de1468b9ee71249b2758599a14'}
});
export function validateSourceInstalledHookRepair(value,{root=sourceRoot,index=0}={}) {
  assert.equal(index,0,'Installed hook repair is source-only');
  assert.equal(path.resolve(root),sourceRoot,'Installed hook repair is source-only');
  assert.deepEqual(Object.keys(value).sort(),['scope','root','index','before','after','archive','template','inventory',
    'ownershipAuthorized','nativeWriteAuthorized','consumerWriteAuthorized','retrySync','originalPlanRewriteAuthorized'].sort());
  assert.equal(value.scope,'source-installed-native-hook-identity-only');assert.equal(value.root,sourceRoot);assert.equal(value.index,0);
  for(const name of ['before','after','archive','template'])assert.deepEqual(value[name],sourceInstalledHookPins[name]);
  assert.deepEqual(Object.keys(value.inventory).sort(),['before','after','archive'].sort());
  for(const name of ['before','after','archive'])assert.deepEqual(value.inventory[name],
    sourceInstalledHookPins['inventory'+name[0].toUpperCase()+name.slice(1)]);
  for(const name of ['ownershipAuthorized','nativeWriteAuthorized','consumerWriteAuthorized','retrySync','originalPlanRewriteAuthorized'])
    assert.equal(value[name],false);
  return value;
}
export async function authenticateSourceInstalledHookRepair(authorization,{io={authenticate:ref=>authenticateFile(sourceRoot,ref),pin:relative=>pinFile(sourceRoot,relative)}}={}) {
  assert.deepEqual(Object.keys(authorization).sort(),['body','review'].sort());
  assert(recoveryEpochAnchorRef,'Recovery epoch activation requires the actual reviewed anchor pin');
  const reviewRef=await io.pin(contextAdmissionPaths.review);
  const validated=await authenticateContinuationReview({io,reviewRef,kind:'execution-authority',body:authorization.body});
  assert.deepEqual(validated.seal,authorization.review);
  assert.equal(authorization.body.kind,'fix-nine-rollout-additive-context-source-repair-authority');
  assert.equal(authorization.body.scope,'exact-ed453-source-hook-transcript-alias-g180-recovery-only');
  const repair=validateSourceInstalledHookRepair(authorization.body.sourceInstalledHookRepair);
  for(const ref of [repair.archive,repair.after,repair.template,
    repair.inventory.archive,repair.inventory.after])await io.authenticate(ref);
  return repair;
}
// Keep the original closure helper and every signer dependency byte-for-byte.
// Its exported validators still check the historical projection. This bounded
// adapter authenticates the same physical input set as buildSourceClosure,
// with only the separately signed source-installed pair read through archives.
export const preparedSourceAnchors=Object.freeze({
  '.harness/fix-nine-rollout-001/preflight.json':'a6face9dca313af34a4d94a9e02f0b6d208776daa8e943ed54c7e90d9a1a6292',
  '.harness/fix-nine-rollout-001/native-preservation.json':'075ad24affd35954c13554f4d8304da86d5144ed437f2b597081c0ccddece625',
  '.harness/evidence/2026-10-17T20-21-48-251Z-source-historical-budget-compat-002.json':'cd2a778d008f94d69d87d8fbb14618cbf3c8469777b5cd8b4d4e19dd00d0a034',
  '.harness/source-historical-budget-compat-002/exo-readonly-audit.json':'3de735c4e08d9dc249c59e25c1c15db32e872d1ee7b73af08692c8bd7bef98b2'
});
export async function authenticatePreparedSourceWithRepair({preparedRef,sourceRepair,io,
  outputIo={authenticate:ref=>authenticateFile('C:/Users/Jason/Documents/Codex/2026-10-17/re/outputs',ref)}}) {
  const repair=await authenticateSourceInstalledHookRepair(sourceRepair,{io});
  return authenticateHistoricalPreparedSource({preparedRef,repair,io,outputIo});
}
export async function authenticateHistoricalPreparedSource({preparedRef,repair,io,outputIo}) {
  validateSourceInstalledHookRepair(repair);
  assert.equal(preparedRef.path,'.harness/fix-nine-rollout-001/source-closure-candidate.json');
  const stored=JSON.parse(await io.authenticate(preparedRef));
  const anchorRefs=[stored.initialPreflight,stored.nativeSupplement,stored.prerequisite.evidence,stored.prerequisite.exoPreservationAudit];
  assert.deepEqual(anchorRefs.map(ref=>ref.path).sort(),Object.keys(preparedSourceAnchors).sort());
  for(const ref of anchorRefs)assert.equal(ref.sha256,preparedSourceAnchors[ref.path]);
  const [preflight,native,evidence]=await Promise.all(anchorRefs.slice(0,3).map(async ref=>JSON.parse(await io.authenticate(ref))));
  await io.authenticate(anchorRefs[3]);
  validatePrerequisite(evidence);validateSourceClosure(stored,{preflight,native,evidence});
  assert.deepEqual(stored.source.originalNineFixManifest,preflight.source.sourceManifest);
  assert.deepEqual(stored.source.originalIntegrationGateExport,preflight.source.gateExport);
  const stateRefs=await Promise.all(['.harness/features.json','.harness/config.json'].map(name=>io.pin(name)));
  const [features,config]=await Promise.all(stateRefs.map(async ref=>JSON.parse(await io.authenticate(ref))));
  const sourceFeature=(Array.isArray(features)?features:features.features).find(row=>row.id===evidence.featureId);
  assert(sourceFeature);assert.equal(sourceFeature.status,'passing');assert.equal(sourceFeature.attempts,1);
  assert.equal(sourceFeature.contract.hash,evidence.contractHash);assert.deepEqual(sourceFeature.evidence,[anchorRefs[2].path]);
  assert.equal(config.policies.maxAttempts,5);assert.equal(config.policies.maxRepeatedFailures,2);
  const refs=[...stored.source.files,...stored.source.additional,
    ...stored.source.managed.flatMap(row=>[row.installed,row.asset]),...stored.source.frozen,...stored.historical,
    ...preflight.targets.flatMap(row=>[row.preservation,row.plan]),preflight.policy.raw,...stored.preparationFiles,
    ...stored.prerequisite.commands.flatMap(row=>[row.logs.stdout,row.logs.stderr])];
  await forEachBounded(refs,ref=>authenticatePreservedSourceFile(ref,{repair,io}));
  const enrollment=JSON.parse(await io.authenticate(preflight.policy.raw));
  assert.equal(canonicalHash(enrollment),preflight.policy.valueSha256);assert.equal(enrollment.sourceRoot,sourceRoot);
  assert.deepEqual(enrollment.projects.slice().sort(),targets.slice().sort());
  for(const ref of [preflight.source.gateExport,preflight.source.sourceManifest])await outputIo.authenticate(ref);
  for(const ref of [...stateRefs,preparedRef])await io.authenticate(ref);
  return preparedRef;
}

export const adapterPath = 'scripts/fix-nine-rollout-deployment.mjs';
export const requiredHelpers = [
  'scripts/fix-nine-rollout-inventory.mjs',
  'scripts/fix-nine-rollout-preflight.mjs', 'scripts/fix-nine-rollout-closure.mjs',
  'scripts/fix-nine-rollout-closure.test.mjs',
  'scripts/fix-nine-rollout-evidence.mjs', 'scripts/fix-nine-rollout-files.mjs',
  'scripts/fix-nine-rollout-auth.mjs', 'scripts/fix-nine-rollout-gate.mjs', 'scripts/fix-nine-rollout-release.mjs',
  'scripts/verify-fix-nine-rollout.mjs', adapterPath, 'scripts/fix-nine-rollout-signer.mjs', 'tests/fix-nine-rollout.test.mjs',
  'skill/codex-harness/scripts/lib/native-hook-client.mjs'
];

const inventoryIoConcurrency = 16;
export async function mapBounded(items, operation) {
  const results = [];
  for (let offset = 0; offset < items.length; offset += inventoryIoConcurrency) {
    const settled = await Promise.allSettled(items.slice(offset, offset + inventoryIoConcurrency)
      .map((item, index) => Promise.resolve().then(() => operation(item, offset + index))));
    const failure = settled.find(result => result.status === 'rejected');
    // Settle every started operation before failing; never start the next batch.
    if (failure) throw failure.reason;
    results.push(...settled.map(result => result.value));
  }
  return results;
}
export async function forEachBounded(items, operation) {
  await mapBounded(items, async (item, index) => { await operation(item, index); });
}
export async function freezeInventoryBounded(root, relative) {
  return mapBounded(await regularInventoryPaths(root, relative), name => pinFile(root, name));
}

export const reconciliationPaths = Object.freeze({
  body:'.harness/fix-nine-rollout-001/continuation/source0-reconciliation-body.json',
  review:'.harness/fix-nine-rollout-001/continuation/source0-reconciliation-review.json',
  sources:['scripts/fix-nine-rollout-continuation.mjs','scripts/fix-nine-rollout-continuation-auth.mjs'],
  test:'scripts/fix-nine-rollout-reconciliation.test.mjs'
});
export function validatePinnedTelemetry(admission,current) {
  assert.equal(admission.authorityGranted,false);assert.equal(admission.identity,'unknown');
  const raw=Buffer.from(admission.raw,'utf8'),before=JSON.parse(raw);
  assert.equal(raw.length,admission.captured.bytes);
  assert.equal(createHash('sha256').update(raw).digest('hex'),admission.captured.sha256);
  assert.equal(admission.captured.path,`.harness/context/${before.actorHash}.json`);
  assert.match(before.actorHash,/^[a-f0-9]{64}$/);assert.equal(before.version,1);assert.equal(before.role,'orchestrator');
  assert.equal(before.mutations,0);assert.equal(current.mutations,0);
  assert.deepEqual(Object.keys(current).sort(),Object.keys(before).sort());
  for(const key of ['version','actorHash','role','startedAt']) assert.deepEqual(current[key],before[key]);
  for(const key of ['toolCalls','outputChars']) assert(Number.isSafeInteger(current[key])&&current[key]>=before[key]);
  assert.deepEqual(Object.keys(current.telemetry).sort(),Object.keys(before.telemetry).sort());
  assert.equal(current.telemetry.status,before.telemetry.status);
  for(const key of Object.keys(before.telemetry).filter(key=>key!=='status'))
    assert(Number.isSafeInteger(current.telemetry[key])&&current.telemetry[key]>=before.telemetry[key]);
  assert(Number.isFinite(Date.parse(current.updatedAt))&&Date.parse(current.updatedAt)>=Date.parse(before.updatedAt));
  assert.deepEqual(current.lastNotice,before.lastNotice);
  return admission.captured.path;
}
export async function authenticateReconciliationSources({body,amendment,io,transferGap=null}) {
  assert.deepEqual(amendment.sources.map(row=>row.path),[...reconciliationPaths.sources,reconciliationPaths.test]);
  assert.equal(amendment.archives.length,2);
  for(const [index,name] of reconciliationPaths.sources.entries()) {
    const old=body.sources.find(row=>row.path===name),archive=amendment.archives[index];assert(old);
    assert.equal(archive.path,`.harness/fix-nine-rollout-001/continuation/original-${index?'continuation-auth':'continuation'}-g168.mjs`);
    assert.deepEqual({...archive,path:name},old);await io.authenticate(archive);
  }
  const admitted=transferGap?transferGap.sources:amendment.sources;
  const sources=body.sources.map(ref=>admitted.find(row=>row.path===ref.path)??ref);
  await forEachBounded([...sources,admitted[2]],ref=>io.authenticate(ref));
  return sources;
}
// One historical, separately signed source transfer gap. It grants no new
// lifecycle, execution, native-write, or unknown-telemetry authority.
export const finiteGapPaths = Object.freeze({
  body:'.harness/fix-nine-rollout-001/continuation/transfer-gap-168-171-body.json',
  review:'.harness/fix-nine-rollout-001/continuation/transfer-gap-168-171-review.json',
  archives:[
    '.harness/fix-nine-rollout-001/continuation/source0-approved-continuation-g171.mjs',
    '.harness/fix-nine-rollout-001/continuation/source0-approved-continuation-auth-g171.mjs',
    '.harness/fix-nine-rollout-001/continuation/source0-approved-reconciliation-g171.test.mjs'
  ]
});
export const finiteGapPin = Object.freeze({
  path:'.harness/fix-nine-rollout-001/continuation/transfer-gap-168-171.json',
  bytes:360508,sha256:'f748b49877421c5a2a49c441d09ed1e51b9a2fd28aaa1b787e6b69953e960d73'
});
export const parkedBridgePaths=Object.freeze({
  body:'.harness/fix-nine-rollout-001/continuation/parked172-bridge-body.json',
  review:'.harness/fix-nine-rollout-001/continuation/parked172-bridge-review.json',
  archives:['.harness/fix-nine-rollout-001/continuation/gap-approved-continuation.mjs',
    '.harness/fix-nine-rollout-001/continuation/gap-approved-continuation-auth.mjs',
    '.harness/fix-nine-rollout-001/continuation/gap-approved-reconciliation.test.mjs']
});
export const parked172Pin=Object.freeze({path:'.harness/fix-nine-rollout-001/continuation/parked172-observation.json',
  bytes:700214,sha256:'77ae57bb41740a398f87d737e8a3e7445166b50eee2335bee1ac5c10e9008d22'});
export async function authenticateParkedBridgeSources({parent,admission,io,successor=null}) {
  assert.deepEqual(admission.sources.map(row=>row.path),[...reconciliationPaths.sources,reconciliationPaths.test]);
  assert.deepEqual(admission.archives.map(row=>row.path),parkedBridgePaths.archives);
  for(const [index,old] of parent.sources.entries()) {
    assert.deepEqual({...admission.archives[index],path:old.path},old);
    await io.authenticate(admission.archives[index]);
  }
  const sources=successor?successor.sources:admission.sources;
  await forEachBounded(sources,ref=>io.authenticate(ref));return sources;
}
export async function authenticateParkedBridgeSupplement({io,parentRef,parentReview,parent,gap}) {
  let ref;try{ref=await io.pin(parkedBridgePaths.body);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  const value=JSON.parse(await io.authenticate(ref)),review=await io.pin(parkedBridgePaths.review);
  validateReview(JSON.parse(await io.authenticate(review)),'execution-authority',value);
  assert.equal(value.version,1);assert.equal(value.kind,'fix-nine-rollout-parked-bridge-authority');
  assert.equal(value.scope,'exact-parked172-and-signed-successor-observations-only');
  assert.deepEqual(value.parent,{body:parentRef,review:parentReview});assert.deepEqual(value.observation,parked172Pin);
  assert.deepEqual(value.parentLifecycle,{generation:171,sha256:canonicalHash(gap.lifecycle),events:gap.eventsRef});
  assert.equal(value.historicalWorkingSnapshot,false);assert.equal(value.nativeWriteAuthorized,false);assert.equal(value.retrySync,false);
  const observation=JSON.parse(await io.authenticate(value.observation));
  const contextEpoch=await authenticateContextEpochSupplement({io,parentRef:ref,parentReview:review,parent:value});
  const sources=await authenticateParkedBridgeSources({parent,admission:value,io,successor:contextEpoch});
  assert(Array.isArray(value.validation)&&value.validation.length>0);
  for(const ref of value.validation)await io.authenticate(ref);
  return {ref,review,value,observation,sources,contextEpoch,references:[ref,review,value.observation,...value.archives,
    ...(contextEpoch?contextEpoch.references:sources),...value.validation]};
}
// Exact additive code authority: preserve the signed parked bridge and its
// executable bytes while admitting only this epoch compatibility correction.
export const contextEpochPaths=Object.freeze({
  body:'.harness/fix-nine-rollout-001/continuation/context-epoch-body.json',
  review:'.harness/fix-nine-rollout-001/continuation/context-epoch-review.json',
  archives:['.harness/fix-nine-rollout-001/continuation/parked-approved-continuation.mjs',
    '.harness/fix-nine-rollout-001/continuation/parked-approved-continuation-auth.mjs',
    '.harness/fix-nine-rollout-001/continuation/parked-approved-reconciliation.test.mjs']
});
export function validateContextEpochAuthority(value,{parentRef,parentReview}) {
  assert.deepEqual(Object.keys(value).sort(),['version','kind','scope','parent','archives','sources','validation',
    'nativeWriteAuthorized','retrySync'].sort());
  assert.equal(value.version,1);assert.equal(value.kind,'fix-nine-rollout-context-epoch-authority');
  assert.equal(value.scope,'known-orchestrator-epoch-compatibility-only');
  assert.deepEqual(value.parent,{body:parentRef,review:parentReview});
  assert.equal(value.nativeWriteAuthorized,false);assert.equal(value.retrySync,false);
  assert(Array.isArray(value.validation)&&value.validation.length>0);
  assert.equal(new Set(value.validation.map(ref=>ref.path)).size,value.validation.length);
}
export async function authenticateContextEpochSources({parent,admission,io,successor=null}) {
  const names=[...reconciliationPaths.sources,reconciliationPaths.test];
  assert.deepEqual(parent.sources.map(ref=>ref.path),names);
  assert.deepEqual(admission.sources.map(ref=>ref.path),names);
  assert.deepEqual(admission.archives.map(ref=>ref.path),contextEpochPaths.archives);
  for(const [index,old] of parent.sources.entries()) {
    assert.deepEqual({...admission.archives[index],path:old.path},old,'Parked-approved bytes must remain exact');
    await io.authenticate(admission.archives[index]);
  }
  const sources=successor?successor.sources:admission.sources;
  await forEachBounded(sources,ref=>io.authenticate(ref));return sources;
}
export async function authenticateContextEpochSupplement({io,parentRef,parentReview,parent}) {
  let ref;try{ref=await io.pin(contextEpochPaths.body);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  const value=JSON.parse(await io.authenticate(ref)),review=await io.pin(contextEpochPaths.review);
  validateReview(JSON.parse(await io.authenticate(review)),'execution-authority',value);
  validateContextEpochAuthority(value,{parentRef,parentReview});
  const contextAdmission=await authenticateContextAdmissionSupplement({io,parentRef:ref,parentReview:review,parent:value});
  const sources=await authenticateContextEpochSources({parent,admission:value,io,successor:contextAdmission});
  for(const ref of value.validation)await io.authenticate(ref);
  return {ref,review,value,sources,contextAdmission,references:[ref,review,...value.archives,
    ...(contextAdmission?contextAdmission.references:sources),...value.validation]};
}

// One exact, non-authoritative telemetry artifact. This layer preserves every
// prior signed body and code archive; it grants no actor or execution authority.
export const contextAdmissionPaths=Object.freeze({
  body:'.harness/fix-nine-rollout-001/continuation/context-admission-ed453-body.json',
  review:'.harness/fix-nine-rollout-001/continuation/context-admission-ed453-review.json',
  archives:['.harness/fix-nine-rollout-001/continuation/epoch-approved-continuation.mjs',
    '.harness/fix-nine-rollout-001/continuation/epoch-approved-continuation-auth.mjs',
    '.harness/fix-nine-rollout-001/continuation/epoch-approved-reconciliation.test.mjs']
});
export const contextAdmissionPin=Object.freeze({
  path:'.harness/context/ed453837750c086b385e202061c67eae99ae9f3e2ed8b88926271b8afe56c083.json',
  bytes:367,sha256:'ceadd0a3decfcb9e7391071fd5ca23997a400f0b7b5cccf247b99b7f9823d8f0'
});
export const guardRecoveryPins=Object.freeze({
 diagnostic:{path:'.harness/fix-nine-rollout-001/continuation/transcript-alias-and-accepted-drift-diagnostic.json',bytes:7142,sha256:'4296eb857d0094f2581a5c33c79af15614f4de0386cec30a4c6f2f138e308f69'},
 working180:{path:'.harness/fix-nine-rollout-001/continuation/g180-working-observation.json',bytes:621996,sha256:'2b17d75bfa9b0a7f48dc2f9759686b1e20b8abfd42cecc80e4694d0dd68b1803'}
});
export function validateTranscriptAliasEvidence(value) {
 assert.equal(value.kind,'read-only-transcript-alias-and-accepted-drift-diagnostic');
 assert.equal(value.sourceRoot.replaceAll('\\','/'),'C:/Users/Jason/Documents/CoochieHarness');
 const t=value.transcript,c=value.orchestratorContext;
 assert.equal(t.normalDerivedIdentity,'12a63f9c66cf4e4d2938bd6c103c53c6170133ec506ac1690f074f7bcde9e7c8');
 assert.equal(t.namespacedDerivedIdentity,'50fa4704873b6bf9d17d9b39fc2fd91e25c84bfde44c615c707b54d46bbc9862');
 assert.equal(t.normalPath.replaceAll('\\','/'),'C:/Users/Jason/.codex/sessions/2026/10/17/rollout-2026-10-17T09-42-29-01a14a19-85af-7be1-b673-9df348f21123.jsonl');
 assert.equal(t.namespacedPath,'\\\\?\\'+t.normalPath);
 const stat=t.statBothSpellings;
 assert.equal(stat.regularFile,true);assert.equal(stat.dev,2220294657);assert.equal(stat.inoAsNodeDefaultStatNumber,'39125021763265896');
 for(const [name,identity] of [['normalPath','normalDerivedIdentity'],['namespacedPath','namespacedDerivedIdentity']])
   assert.equal(createHash('sha256').update(path.win32.resolve(t[name])+':'+stat.dev+':'+stat.inoAsNodeDefaultStatNumber).digest('hex'),t[identity]);
 assert.equal(t.samePhysicalFileAtObservation,true);assert.equal(t.noSymlinkAncestorsOfNormalPath,true);
 assert.equal(t.filenameMatchesHeaderNativeId,true);assert.equal(t.header.type,'session_meta');
 assert.equal(t.header.id,'01a14a19-85af-7be1-b673-9df348f21123');
 assert.equal(path.win32.resolve(t.header.cwd).replaceAll('\\','/'),'C:/Users/Jason/Documents/CoochieHarness');
 assert(t.normalPath.endsWith('-'+t.header.id+'.jsonl'));assert.equal(c.actorId,t.header.id);
 assert.equal(c.actorHash,createHash('sha256').update(c.actorId).digest('hex'));
 assert.equal(c.path,'.harness/context/'+c.actorHash+'.json');
 assert.equal(c.before.telemetry.identity,t.normalDerivedIdentity);
 assert.equal(c.currentAtObservation.telemetry.identity,t.namespacedDerivedIdentity);
 for(const row of [c.before,c.currentAtObservation])assert.equal(row.role,'orchestrator');
 assert.equal(c.before.telemetry.epoch,18);assert.equal(c.currentAtObservation.telemetry.epoch,20);
 assert.equal(value.observationTiming.exactFilesystemSamplingWallTime,null);
 return c;
}
export const guardRecoveryHostPins=Object.freeze([{"path":".harness/fix-nine-rollout-001/continuation/g180-availability-reconciliation.json","bytes":1537,"sha256":"75f88594a6ad6478be45ea7b54112023395b9eeb51850bbc34527e1161cffa40"},{"path":".harness/fix-nine-rollout-001/continuation/g180-host-git-native-record.json","bytes":3655,"sha256":"352e7a903504bc6a005d9388ee9e5fce7031ff5020dbd057bdc4fd4544e7bdc7"},{"path":".harness/fix-nine-rollout-001/continuation/g180-resume-failed.capture.json","bytes":1089,"sha256":"5596de496983ecb309cf1fb2b73d76c389b782fd9d4e5efe3b061582d5a6f64f"},{"path":".harness/fix-nine-rollout-001/continuation/g180-resume-failed.stdout.log","bytes":0,"sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},{"path":".harness/fix-nine-rollout-001/continuation/g180-resume-failed.stderr.log","bytes":132,"sha256":"d7d4fdd6759cdf631a166c0218f912d3e983d584c4046ee95927c25761d3e46b"},{"path":".harness/fix-nine-rollout-001/continuation/g180-resume-accepted.capture.json","bytes":1165,"sha256":"6a1895b46a9e9c0777452ea5644d0f5989bea90e733070cb5ffa1d10c89893a7"},{"path":".harness/fix-nine-rollout-001/continuation/g180-resume-accepted.stdout.log","bytes":580,"sha256":"cfd76e3e055f1fd049a3e7cb8b06211b6fad05b6ee7efd5e40903abd443ac6d9"},{"path":".harness/fix-nine-rollout-001/continuation/g180-resume-accepted.stderr.log","bytes":0,"sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},{"path":".harness/fix-nine-rollout-001/continuation/g180-doctor.capture.json","bytes":1090,"sha256":"4197f5597611fbbc843a464d644e66cdf8770456eb61abeb3d40e71b93fe487a"},{"path":".harness/fix-nine-rollout-001/continuation/g180-doctor.stdout.log","bytes":2173,"sha256":"8d4c7452a2419e8955eee83f7b4a2fea23a4838d49b08aa5488590938d068934"},{"path":".harness/fix-nine-rollout-001/continuation/g180-doctor.stderr.log","bytes":0,"sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}]);
export async function authenticateGuardRecoveryEvidence(value,io) {
 assert.deepEqual(Object.keys(value).sort(),['diagnostic','working180','hostEvidence'].sort());
 assert.deepEqual(value.diagnostic,guardRecoveryPins.diagnostic);assert.deepEqual(value.working180,guardRecoveryPins.working180);
 assert.deepEqual(value.hostEvidence,guardRecoveryHostPins);
 const diagnostic=JSON.parse(await io.authenticate(value.diagnostic));validateTranscriptAliasEvidence(diagnostic);
 const working180=JSON.parse(await io.authenticate(value.working180));
 const host=new Map();
 for(const pin of value.hostEvidence)host.set(path.posix.basename(pin.path),await io.authenticate(pin));
 const json=name=>JSON.parse(host.get(name)),actor='01a15994-5827-7cf2-a0a1-bfd690a4270f',handoff='handoff-20261020134731304-b2a3ab07';
 const availability=json('g180-availability-reconciliation.json');
 assert.equal(availability.kind,'availability-only-resume-reconciliation');assert.equal(availability.actualActor,actor);
 assert.equal(availability.handoffId,handoff);assert.equal(availability.storedRepository.available,false);
 assert.equal(availability.observedCurrent.available,true);assert.equal(availability.storedRepository.historicalUnavailableReason,null);
 for(const key of ['head','branch'])assert.equal(availability.storedRepository[key],availability.observedCurrent[key]);
 assert.equal(availability.observedCurrent.head,'ed381928a5d6991c63f8878fe2c669fcb663b512');assert.equal(availability.observedCurrent.branch,'main');
 assert.equal(availability.observedCurrent.configChecksUnchanged,true);assert.equal(availability.gitRepairPerformed,false);
 assert.equal(availability.originalFailurePreserved,true);assert.equal(availability.resumedGeneration,180);
 const native=json('g180-host-git-native-record.json');assert.equal(native.kind,'retained-native-command-record-extraction');
 assert.equal(native.readOnly,true);assert.equal(native.sourceThreadId,actor);assert.equal(native.records.length,2);
 const [identity,git]=native.records;
 for(const record of native.records){assert.equal(record.status,'completed');assert.equal(record.exitCode,0);assert.equal(record.output.truncated,false);}
 assert.equal(git.id,'exec-ebc357af-70bb-4f4f-94df-ddf806832eac');
 const observed=JSON.parse(git.output.text);assert.equal(observed.actualActor,actor);assert.equal(observed.code,0);assert.equal(observed.stderr,'');
 assert.equal(observed.stdoutBytes,1406541);assert.equal(observed.stdoutSha256,'4c3a84acf04743aed28bee451b5b0931f1699782ec87b7ad4e19e87cc581b0f6');
 const identities=identity.output.text.trim().split('\n').map(JSON.parse);
 assert.equal(identities.find(row=>row.args.join(' ')==='symbolic-ref --short HEAD').stdout,'main');
 assert.equal(identities.find(row=>row.args.join(' ')==='rev-parse HEAD').stdout,availability.observedCurrent.head);
 for(const [prefix,code,args] of [['g180-resume-failed',1,['.harness/run.mjs','resume',handoff]],
   ['g180-resume-accepted',0,['.harness/run.mjs','resume',handoff,'--accept-drift']],['g180-doctor',0,['.harness/run.mjs','doctor']]]) {
   const capture=json(prefix+'.capture.json');assert.equal(capture.code,code);assert.equal(capture.signal,null);
   assert.equal(capture.actualActor,actor);assert.equal(capture.cwd.replaceAll('\\','/'),'C:/Users/Jason/Documents/CoochieHarness');
   assert.deepEqual(capture.args,args);assert.equal(capture.logs.length,2);
   for(const [index,stream] of ['stdout','stderr'].entries()){
     const bytes=host.get(prefix+'.'+stream+'.log'),log=capture.logs[index];
     assert.equal(bytes.length,log.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),log.sha256);
   }
   assert(Date.parse(capture.completedAt)>=Date.parse(capture.startedAt));
 }
 assert(host.get('g180-resume-failed.stderr.log').toString().includes('repository availability changed'));
 assert(Date.parse(json('g180-resume-failed.capture.json').completedAt)<Date.parse(json('g180-resume-accepted.capture.json').startedAt));
 return {diagnostic,working180,references:[value.diagnostic,value.working180,...value.hostEvidence]};
}
export function validateContextAdmissionAuthority(value,{parentRef,parentReview}) {
  assert.deepEqual(Object.keys(value).sort(),['version','kind','scope','parent','archives','sources','validation',
    'telemetry','sourceInstalledHookRepair','guardRecovery','recoveryCode','ownershipAuthorized','nativeWriteAuthorized','retrySync'].sort());
  assert.equal(value.version,1);assert.equal(value.kind,'fix-nine-rollout-additive-context-source-repair-authority');
  assert.equal(value.scope,'exact-ed453-source-hook-transcript-alias-g180-recovery-only');
  assert.deepEqual(value.parent,{body:parentRef,review:parentReview});
  for(const key of ['ownershipAuthorized','nativeWriteAuthorized','retrySync'])assert.equal(value[key],false);
  assert.deepEqual(Object.keys(value.telemetry).sort(),['captured','raw','identity','authorityGranted'].sort());
  assert.deepEqual(value.telemetry.captured,contextAdmissionPin);
  validatePinnedTelemetry(value.telemetry,JSON.parse(value.telemetry.raw));
  validateSourceInstalledHookRepair(value.sourceInstalledHookRepair);
  assert.deepEqual(Object.keys(value.guardRecovery).sort(),['diagnostic','working180','hostEvidence'].sort());
  assert.deepEqual(value.guardRecovery.diagnostic,guardRecoveryPins.diagnostic);assert.deepEqual(value.guardRecovery.working180,guardRecoveryPins.working180);
  assert.deepEqual(value.recoveryCode.map(ref=>ref.path),['scripts/fix-nine-rollout-recovery-epoch.mjs']);
  assert(Array.isArray(value.validation)&&value.validation.length>0);
  assert.equal(new Set(value.validation.map(ref=>ref.path)).size,value.validation.length);
}
export async function authenticatePreservedSourceFile(ref,{repair,root=sourceRoot,index=0,io}) {
  const pair=repair&&[repair,repair.inventory].find(row=>ref.path===row.before.path);
  if(!pair)return io.authenticate(ref);
  validateSourceInstalledHookRepair(repair,{root,index});
  assert.deepEqual(ref,pair.before,'Historical source file pin must remain exact');
  await io.authenticate(pair.archive);return io.authenticate(pair.after);
}
export async function authenticateContextAdmissionTelemetry(value,io) {
  assert.deepEqual(value.telemetry.captured,contextAdmissionPin);
  const raw=await io.authenticate(contextAdmissionPin),current=JSON.parse(raw);
  validatePinnedTelemetry(value.telemetry,current);
  return {path:contextAdmissionPin.path,value:current};
}
export async function authenticateContextAdmissionSources({parent,admission,io}) {
  const names=[...reconciliationPaths.sources,reconciliationPaths.test];
  assert.deepEqual(parent.sources.map(ref=>ref.path),names);
  assert.deepEqual(admission.sources.map(ref=>ref.path),names);
  assert.deepEqual(admission.archives.map(ref=>ref.path),contextAdmissionPaths.archives);
  for(const [index,old] of parent.sources.entries()) {
    assert.deepEqual({...admission.archives[index],path:old.path},old,'Epoch-approved bytes must remain exact');
    await io.authenticate(admission.archives[index]);
  }
  await forEachBounded(admission.sources,ref=>io.authenticate(ref));return admission.sources;
}
export async function authenticateContextAdmissionSupplement({io,parentRef,parentReview,parent}) {
  let ref;try{ref=await io.pin(contextAdmissionPaths.body);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  const value=JSON.parse(await io.authenticate(ref)),review=await io.pin(contextAdmissionPaths.review);
  const reviewProof=await authenticateContinuationReview({io,reviewRef:review,kind:'execution-authority',body:value});
  const signedReview=reviewProof.seal;
  validateContextAdmissionAuthority(value,{parentRef,parentReview});
  const sources=await authenticateContextAdmissionSources({parent,admission:value,io});
  await authenticateContextAdmissionTelemetry(value,io);
  const guardRecovery=await authenticateGuardRecoveryEvidence(value.guardRecovery,io);
  for(const pin of value.recoveryCode)await io.authenticate(pin);
  const repair=value.sourceInstalledHookRepair;
  for(const pin of [repair.archive,repair.after,repair.template,
    repair.inventory.archive,repair.inventory.after])await io.authenticate(pin);
  for(const pin of value.validation)await io.authenticate(pin);
  return {ref,review,value,sources,guardRecovery,sourceRepair:{body:value,review:signedReview},references:[ref,review,...value.archives,...sources,
    contextAdmissionPin,repair.archive,repair.after,repair.template,
    repair.inventory.archive,repair.inventory.after,...guardRecovery.references,...reviewProof.refs,...value.recoveryCode,...value.validation]};
}

// Later missing records require their own exact signed data admission. Existing
// ordinary records are always tried first; malformed ordinary records never fall back.
export async function authenticateLaterParkedBridge({io,continuation,codeAuthority,parentLifecycle}) {
  const generation=parentLifecycle.generation+1,dir='.harness/fix-nine-rollout-001/continuation';
  const ref=await io.pin(`${dir}/parked-transfer-${generation}-body.json`),review=await io.pin(`${dir}/parked-transfer-${generation}-review.json`);
  const value=JSON.parse(await io.authenticate(ref));validateReview(JSON.parse(await io.authenticate(review)),'execution-authority',value);
  assert.deepEqual(Object.keys(value).sort(),['version','kind','scope','continuation','codeAuthority','parentLifecycle','observation',
    'historicalWorkingSnapshot','nativeWriteAuthorized','retrySync'].sort());
  assert.equal(value.version,1);assert.equal(value.kind,'fix-nine-rollout-parked-transfer-evidence-authority');
  assert.equal(value.scope,'single-exact-parked-generation-only');assert.deepEqual(value.continuation,continuation);
  assert.deepEqual(value.codeAuthority,codeAuthority);assert.deepEqual(value.parentLifecycle,parentLifecycle);
  assert.equal(value.observation.path,`${dir}/parked-transfer-${generation}-observation.json`);
  assert(Number.isSafeInteger(value.observation.bytes)&&value.observation.bytes>0&&value.observation.bytes<=16*1024*1024);
  assert.equal(value.historicalWorkingSnapshot,false);assert.equal(value.nativeWriteAuthorized,false);assert.equal(value.retrySync,false);
  return {ref,review,value,observation:JSON.parse(await io.authenticate(value.observation)),
    references:[ref,review,value.observation]};
}

export async function authenticateFiniteGapSources({amendment,admission,io,successor=null}) {
  const names=[...reconciliationPaths.sources,reconciliationPaths.test];
  assert.deepEqual(admission.sources.map(ref=>ref.path),names);
  assert.deepEqual(admission.archives.map(ref=>ref.path),finiteGapPaths.archives);
  for(const [index,old] of amendment.sources.entries()) {
    const archive=admission.archives[index];
    assert.deepEqual({...archive,path:old.path},old,'Source0-approved bytes must remain exact');
    await io.authenticate(archive);
  }
  const sources=successor?successor.sources:admission.sources;
  await forEachBounded(sources,ref=>io.authenticate(ref));
  return sources;
}
export async function authenticateFiniteGapSupplement({io,bodyRef,body,reviewRef,amendmentRef,amendment,amendmentReview}) {
  let ref;
  try {ref=await io.pin(finiteGapPaths.body);}catch(error){if(error.code==='ENOENT') return null;throw error;}
  const value=JSON.parse(await io.authenticate(ref)),review=await io.pin(finiteGapPaths.review);
  validateReview(JSON.parse(await io.authenticate(review)),'execution-authority',value);
  assert.deepEqual(Object.keys(value).sort(),['version','kind','scope','continuation','source0','gap','archives','sources',
    'historicalSnapshotsAvailable','missingLifecycleGenerations','nativeWriteAuthorized','retrySync','validation'].sort());
  assert.equal(value.version,1);assert.equal(value.kind,'fix-nine-rollout-finite-transfer-gap-authority');
  assert.equal(value.scope,'source-transfer-gap168-through171-only');
  assert.deepEqual(value.continuation,{body:bodyRef,review:reviewRef});
  assert.deepEqual(value.source0,{body:amendmentRef,review:amendmentReview});
  assert.deepEqual(value.gap,finiteGapPin);
  assert.equal(value.historicalSnapshotsAvailable,false);assert.deepEqual(value.missingLifecycleGenerations,[169,170]);
  assert.equal(value.nativeWriteAuthorized,false);assert.equal(value.retrySync,false);
  const gap=JSON.parse(await io.authenticate(value.gap));
  const expected=[bodyRef,reviewRef,amendmentRef,amendmentReview,
    gap.pins.find(row=>row.path==='.harness/fix-nine-rollout-001/continuation/transfer-168.json'),
    body.sourceBoundary,body.originalAuthority,body.sourceClosure,amendment.savedFailure.reservation,
    amendment.savedFailure.outcome,gap.pins.find(row=>row.path==='.harness/config.json')];
  assert(expected.every(Boolean));assert.deepEqual(gap.pins,expected);
  await forEachBounded(gap.pins,ref=>io.authenticate(ref));
  const config=JSON.parse(await io.authenticate(expected.at(-1)));
  assert.equal(config.policies.maxAttempts,5);assert.equal(config.policies.maxRepeatedFailures,2);
  assert(Array.isArray(value.validation)&&value.validation.length>0);
  assert.equal(new Set(value.validation.map(row=>row.path)).size,value.validation.length);
  for(const pin of value.validation) await io.authenticate(pin);
  // The exact old source0 sources are archived, not re-signed or re-labelled.
  const parkedBridge=await authenticateParkedBridgeSupplement({io,parentRef:ref,parentReview:review,parent:value,gap});
  const sources=await authenticateFiniteGapSources({amendment,admission:value,io,successor:parkedBridge});
  return {ref,review,value,gap,sources,parkedBridge,references:[ref,review,value.gap,...gap.pins,...gap.archives,
    ...value.archives,...(parkedBridge?parkedBridge.references:sources),...value.validation]};
}

export async function authenticateReconciliationSupplement({root=sourceRoot,io,bodyRef,body,reviewRef}) {
  let ref;
  try {ref=await io.pin(reconciliationPaths.body);}catch(error){if(error.code==='ENOENT') return null;throw error;}
  const amendment=JSON.parse(await io.authenticate(ref)),review=await io.pin(reconciliationPaths.review);
  validateReview(JSON.parse(await io.authenticate(review)),'execution-authority',amendment);
  assert.equal(amendment.version,1);assert.equal(amendment.kind,'fix-nine-rollout-source0-reconciliation-authority');
  assert.equal(amendment.scope,'single-source0-preserve-only-and-nonauthoritative-telemetry');
  assert.deepEqual(amendment.continuation,bodyRef);assert.deepEqual(amendment.originalReview,reviewRef);
  assert.deepEqual(amendment.sourceBoundary,body.sourceBoundary);assert.equal(amendment.index,0);
  assert.equal(amendment.root,path.resolve(root));assert.equal(amendment.expectedOperationCount,28);
  assert.equal(amendment.retrySync,false);assert.equal(amendment.nativeWriteAuthorized,false);
  assert.equal(amendment.historicalSnapshotsAvailable,false);
  const transferGap=await authenticateFiniteGapSupplement({io,bodyRef,body,reviewRef,amendmentRef:ref,amendment,amendmentReview:review});
  const sources=await authenticateReconciliationSources({body,amendment,io,transferGap});
  validatePinnedTelemetry(amendment.telemetry,JSON.parse(await io.authenticate(await io.pin(amendment.telemetry.captured.path))));
  for(const value of Object.values(amendment.savedFailure)) await io.authenticate(value);
  for(const value of Object.values(amendment.validation)) await io.authenticate(value);
  return {ref,review,value:amendment,sources,transferGap,references:[ref,review,...amendment.archives,
    ...(transferGap?transferGap.references:amendment.sources),
    ...Object.values(amendment.savedFailure),...Object.values(amendment.validation)]};
}

export async function productionDeployment({root, io, sourceRelease}) {
  assert.equal(path.resolve(root), sourceRoot, 'Production adapter requires the actual source root');
  const bodyRef=await io.pin('.harness/fix-nine-rollout-001/continuation/review-body.json');
  const body=JSON.parse(await io.authenticate(bodyRef));
  const reviewRef=await io.pin('.harness/fix-nine-rollout-001/continuation/review.json');
  validateReview(JSON.parse(await io.authenticate(reviewRef)),'execution-authority',body);
  const adapterRef=body.sources.filter(row=>row.path==='scripts/fix-nine-rollout-continuation.mjs');
  assert.equal(adapterRef.length,1);
  const amendment=await authenticateReconciliationSupplement({root,io,bodyRef,body,reviewRef});
  if(!amendment) await io.authenticate(adapterRef[0]);
  const adapter = await import('./fix-nine-rollout-continuation.mjs');
  assert.equal(typeof adapter.authenticateContinuationDeployment, 'function', 'Missing reviewed deployment authenticator');
  return adapter.authenticateContinuationDeployment({root, io, sourceRelease, allEleven:true});
}

const uuidLog = relative => {
  const match = /^\.harness\/logs\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.(stdout|stderr)\.log$/.exec(relative);
  assert(match, 'Command log is not a contained UUID stream'); return {id:match[1], stream:match[2]};
};
function uuidPairs(logs) {
  const pairs = new Map();
  for (const relative of logs) {
    const {id, stream} = uuidLog(relative), streams = pairs.get(id) ?? new Set();
    assert(!streams.has(stream)); streams.add(stream); pairs.set(id, streams);
  }
  assert([...pairs.values()].every(streams => streams.size === 2), 'UUID stream pair is incomplete');
}

// Source-only, temporary inventory admission for the fixed outer verification.
// Live filenames establish containment and a bounded count, never command identity.
// The completed schema5 manifest must subsequently account for every new file.
export async function authenticateGateInventory(root, sourceRelease) {
  let before;
  try { before = await readJson(root, `${gateDirectory}/before.json`); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  assert.equal(before.version, 1); assert.equal(before.root, path.resolve(root));
  assert.equal(before.nodeExecutable, process.execPath);
  assert(Number.isFinite(Date.parse(before.capturedAt)));
  assert.equal(before.feature.id, rolloutFeatureId); assert.equal(before.feature.status, 'active');
  assert.equal(before.state.path, '.harness/features.json');
  assert.equal(before.continuity.path, '.harness/continuity.json');
  assert.equal(before.bindings.config.path, '.harness/config.json');
  const config = JSON.parse(await authenticateFile(root, before.bindings.config));
  assert.deepEqual(config, before.config);
  const plan = expectedVerificationPlan(config, before.feature);
  assert.deepEqual(before.plan, plan);
  const invocationIdentity = {executable:process.execPath, args:['.harness/run.mjs', 'verify', rolloutFeatureId],
    cwd:path.resolve(root), actor:before.owner, executionCount:plan.executions.length, timeoutMs:gateTimeout(config, plan)};
  assert.deepEqual(before.invocationIdentity, invocationIdentity);
  const continuity = await gateContinuity(root,before.continuity,sourceRelease);
  assert.equal(continuity.phase, 'working'); assert.equal(continuity.handoff, null);
  assert.equal(continuity.owner?.source, 'CODEX_THREAD_ID');
  assert.equal(typeof before.owner, 'string'); assert(before.owner);
  assert.equal(continuity.owner.id, before.owner);
  const logs = await inventoryAdditions(root, '.harness/logs', before.history.inventory.logs);
  const evidence = await inventoryAdditions(root, '.harness/evidence', before.history.inventory.evidence);
  let invocation, completed = false;
  try { invocation = await readJson(root, `${gateDirectory}/invocation.json`); completed = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!completed) {
    const state = JSON.parse(await authenticateFile(root, before.state));
    assert.deepEqual(state.features.find(feature => feature.id === rolloutFeatureId), before.feature);
    assert.deepEqual(evidence, [], 'Pending verification appended evidence');
    await authenticateFile(root, before.history.events);
    const prefix = plan.executions.findIndex(entry => entry.criterionId === 'ac-1');
    assert(prefix >= 0);
    assert.equal(plan.executions[prefix].command, `node scripts/verify-fix-nine-rollout.mjs --report ${rolloutReport}`);
    assert(logs.length <= 2 * (prefix + 1), 'Pending command log prefix exceeded');
    uuidPairs(logs);
    return {mode:'pending', paths:logs};
  }
  const state = await readJson(root, '.harness/features.json');
  const after = state.features.find(feature => feature.id === rolloutFeatureId); assert(after);
  assert.deepEqual(state.features.map(feature => feature.id), before.history.featureIds);
  assert.deepEqual(state.features.filter(feature => feature.id !== rolloutFeatureId)
    .map(feature => ({id:feature.id, sha256:canonicalHash(feature)})), before.history.features);
  assert.deepEqual(Object.fromEntries(Object.entries(state).filter(([key]) => !['features', 'revision'].includes(key))), before.history.stateHeader);
  assert.equal(state.revision, before.history.revision + 1);
  assert.equal(after.evidence.length, before.feature.evidence.length + 1);
  assert.deepEqual(after.evidence.slice(0, -1), before.feature.evidence);
  const evidenceRef = await pinFile(root, after.evidence.at(-1));
  const record = JSON.parse(await authenticateFile(root, evidenceRef));
  const verified = validateVerificationEvidence(before, invocation, evidenceRef, record);
  validatePassingTransition(before, after, verified);
  assert.deepEqual(logs, verified.requiredLogs.map(ref => ref.path).sort(), 'Completed log inventory differs from schema5');
  uuidPairs(logs);
  const executionPairs = new Map();
  for (const ref of verified.requiredLogs) {
    const uuid = uuidLog(ref.path); assert.equal(uuid.stream, ref.stream);
    if (executionPairs.has(ref.executionId)) assert.equal(executionPairs.get(ref.executionId), uuid.id, 'Execution streams use different UUIDs');
    else executionPairs.set(ref.executionId, uuid.id);
  }
  assert.deepEqual(evidence, [evidenceRef.path], 'Completed evidence inventory differs from append');
  await authenticatePrefix(root, before.history.events);
  const pins = await mapBounded(logs, relative => pinFile(root, relative));
  return {mode:'completed', paths:[...logs, ...evidence], pins:[...pins, evidenceRef,
    await pinFile(root, '.harness/features.json'), await pinFile(root, `${gateDirectory}/invocation.json`)]};
}

// Adapter result: exact authenticated refs plus authority/report/final closure.
// The adapter must authenticateSourceClosure, the reviewed authority anchor,
// exact ordered eleven apply/audit/independent CONTINUE records, native CAS and
// all historical preservation. Merely returning pinned JSON is insufficient.
export async function authenticateBindings({root = sourceRoot, deployment = productionDeployment, sourceRelease} = {}) {
  const io = {pin: relative => pinFile(root, relative), authenticate: ref => authenticateFile(root, ref),
    json: relative => readJson(root, relative)};
  const configRef = await io.pin('.harness/config.json');
  const config = JSON.parse(await io.authenticate(configRef));
  const stateRef = await io.pin('.harness/features.json');
  const state = JSON.parse(await io.authenticate(stateRef));
  assert.equal(state.features.filter(item => item.id === rolloutFeatureId).length, 1);
  const feature = state.features.find(item => item.id === rolloutFeatureId); assert(feature);
  const snapshot = normalizedContract(feature);
  assert.equal(feature.contract.version, 2);
  assert.deepEqual(feature.contract.snapshot, snapshot);
  assert.equal(feature.contract.hash, canonicalHash({contract: snapshot, scopeBaselineHash: feature.contract.scopeBaselineHash}));
  const baseline = feature.scopeBaselineRef;
  assert.equal(baseline.baselineHash, feature.contract.scopeBaselineHash);
  await io.authenticate({path: baseline.path, bytes: baseline.bytes, sha256: baseline.sha256});
  const deployed = await deployment({root, io, sourceRelease});
  assert.equal(deployed.version, 1); assert.equal(deployed.kind, 'fix-nine-rollout-authenticated-deployment');
  assert.equal(deployed.featureId, rolloutFeatureId);
  assert.equal(deployed.report.path, rolloutReport, 'Original all-eleven binding requires its original report');
  assert.equal(deployed.authority.path, '.harness/fix-nine-rollout-001/authority.json');
  assert.equal(deployed.sourceClosure.path, '.harness/fix-nine-rollout-001/source-closure.json');
  const refs = [...deployed.references, deployed.report, deployed.authority, deployed.sourceClosure];
  const unique = new Map();
  for (const ref of refs) {
    if (unique.has(ref.path)) assert.deepEqual(unique.get(ref.path), ref, 'Conflicting deployment references');
    else { await io.authenticate(ref); unique.set(ref.path, ref); }
  }
  const closure = JSON.parse(await io.authenticate(deployed.sourceClosure));
  assert.deepEqual(closure.helperFiles.map(ref => ref.path).sort(), [...requiredHelpers].sort(), 'Final helper closure must be exact');
  assert.equal(new Set(closure.helperFiles.map(ref => ref.path)).size, requiredHelpers.length);
  for (const ref of closure.helperFiles) {
    if (path.resolve(root) === sourceRoot && deployment === productionDeployment && ref.path === 'scripts/verify-fix-nine-rollout.mjs') {
      const archived = await io.pin('.harness/fix-nine-rollout-001/continuation/original-verify-fix-nine-rollout.mjs');
      assert.deepEqual({...archived,path:ref.path},ref);
      assert(unique.has(archived.path)); assert(unique.has(ref.path));
      continue;
    }
    await io.authenticate(ref);
    if (unique.has(ref.path)) assert.deepEqual(unique.get(ref.path), ref);
    unique.set(ref.path, ref);
  }
  // A deployment callback must not change the bytes used for our inputs.
  await io.authenticate(configRef); await io.authenticate(stateRef);
  await io.authenticate({path: baseline.path, bytes: baseline.bytes, sha256: baseline.sha256});
  // Bind generated runtime too, independently of the adapter's source graph.
  const runtime = await io.pin('.harness/run.mjs');
  return {config: configRef, configHash: canonicalHash(config),
    contract: {snapshot: normalizedContract(feature), value: feature.contract, baseline: feature.scopeBaselineRef},
    runtime, deployment: {report: deployed.report, authority: deployed.authority, sourceClosure: deployed.sourceClosure},
    references: [...unique.values()].sort((a, b) => a.path.localeCompare(b.path))};
}
