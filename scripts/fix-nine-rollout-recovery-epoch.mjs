// Explicit new-epoch authentication. Historical callers keep their old key.
import assert from 'node:assert/strict';
import {createHash, verify, createPublicKey} from 'node:crypto';

export const recoveryDomain = 'fix-nine-rollout-001/recovery-epoch-review/v1';
export const envelopeDomain = 'fix-nine-rollout-001/recovery-epoch-envelope/v1';
export const permitDomain = 'fix-nine-rollout-001/recovery-permit-review/v1';
export const oldReviewDomain = 'fix-nine-rollout-001/exact-review/v1';
export const continuationDirectory = '.harness/fix-nine-rollout-001/continuation';
export const recoveryDirectory = '.harness/fix-nine-rollout-001/continuation/recovery';
export const immutableOldPublicKey = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAj0LfGoNw312Z47WeoIkNLQHdaiAHsJMjgqSIqIuk5i8=\n-----END PUBLIC KEY-----\n';
export const maintenancePaths = Object.freeze([
  'scripts/fix-nine-rollout-continuation.mjs',
  'scripts/fix-nine-rollout-continuation-auth.mjs',
  'scripts/fix-nine-rollout-continuation.test.mjs',
  'scripts/fix-nine-rollout-reconciliation.test.mjs',
  'scripts/fix-nine-rollout-recovery-epoch.test.mjs',
  'scripts/fix-nine-transcript-maintenance.mjs'
]);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (a, b, message) => assert.deepEqual(a, b, message);
const plain = x => x && typeof x === 'object' && !Array.isArray(x);
const hex = /^[a-f0-9]{64}$/;
const identity = /^[a-zA-Z0-9_./:-]{1,200}$/;
export function relativePath(value) {
  assert(typeof value === 'string' && value.length < 600);
  assert(!value.includes('\\') && !value.includes(':') && !value.startsWith('/'));
  assert(value.split('/').every(p => p && p !== '.' && p !== '..'));
  return value;
}
export function reference(ref) {
  assert(plain(ref)); equal(Object.keys(ref).sort(), ['bytes', 'path', 'sha256']);
  relativePath(ref.path); assert(Number.isSafeInteger(ref.bytes) && ref.bytes >= 0);
  assert.match(ref.sha256, hex); return ref;
}
export function recoveryPayload({epoch, epochAnchor, recordPath, kind, body}) {
  return Buffer.from(JSON.stringify({domain: recoveryDomain, epoch, epochAnchor, recordPath, kind, body}), 'utf8');
}
export function envelopePayload({epoch, epochAnchor, recordPath, kind, body, permitRef}) {
  const payloadSha256=digest(recoveryPayload({epoch,epochAnchor,recordPath,kind,body}));
  return Buffer.from(JSON.stringify({domain:envelopeDomain,epoch,epochAnchor,recordPath,kind,payloadSha256,permitRef}),'utf8');
}
export function standardPayload(kind, body) {
  return Buffer.from(JSON.stringify({domain: oldReviewDomain, kind, body}), 'utf8');
}
// The approval ref is deliberately excluded: the approval binds this payload,
// and the final immutable permit adds that approval's exact raw pin.
export function permitReviewPayload(permit) {
  const {approvalRef: ignored, ...body} = permit;
  return Buffer.from(JSON.stringify({domain: permitDomain, permit: body}), 'utf8');
}
export function validateAnchor(anchor, anchorRef) {
  reference(anchorRef);
  assert(anchorRef.path.startsWith(`${recoveryDirectory}/`) && anchorRef.path.endsWith('-anchor.json'));
  assert.equal(anchor.version, 1); assert.equal(anchor.kind, 'fix-nine-rollout-recovery-epoch-anchor');
  assert.match(anchor.epoch, /^[a-z0-9][a-z0-9-]{5,79}$/);
  assert.equal(anchor.scopePolicyVersion, 1);
  assert.equal(anchor.previousPublicKey, immutableOldPublicKey);
  assert.notEqual(anchor.publicKey, anchor.previousPublicKey);
  assert.equal(createPublicKey(anchor.publicKey).asymmetricKeyType, 'ed25519');
  assert.match(anchor.reviewerId, identity);
  for (const k of ['originalAuthority', 'originalContinuation', 'authorization', 'deathDiagnosis', 'nativeLaunch', 'publicMetadata']) reference(anchor[k]);
  assert.equal(anchor.originalAuthority.path, '.harness/fix-nine-rollout-001/authority.json');
  assert.equal(anchor.originalContinuation.path, `${continuationDirectory}/review-body.json`);
  return anchor;
}
export function validatePermit(permit, {anchor, anchorRef, recordPath, kind, body}) {
  assert.equal(permit.version, 1); assert.equal(permit.kind, 'fix-nine-rollout-recovery-permit');
  assert.equal(permit.epoch, anchor.epoch); equal(permit.epochAnchor, anchorRef);
  assert.equal(permit.recordPath, relativePath(recordPath)); assert.equal(permit.reviewKind, kind);
  assert.equal(permit.scope, body.scope); reference(permit.approvalRef);
  assert(permit.approvalRef.path.startsWith(`${recoveryDirectory}/reviews/`) && permit.approvalRef.path.endsWith('.json'));
  equal(permit.originalAuthority, anchor.originalAuthority);
  equal(permit.originalContinuation, anchor.originalContinuation);
  assert.equal(permit.payloadSha256, digest(recoveryPayload({epoch: anchor.epoch, epochAnchor: anchorRef, recordPath, kind, body})));
  assert(Array.isArray(permit.materialRefs) && permit.materialRefs.length > 0 && permit.materialRefs.length <= 256);
  permit.materialRefs.forEach(reference);
  assert.equal(new Set(permit.materialRefs.map(r => r.path)).size, permit.materialRefs.length);
  const fixed = {
    'initial-source-guard': [`${continuationDirectory}/context-admission-ed453-review.json`, 'execution-authority', 'exact-ed453-source-hook-transcript-alias-g180-recovery-only'],
    'nine-final': [`${continuationDirectory}/nine-final-continue.json`, 'product-audit', 'continuation-final-exact-nine-with-source-reconciliation'],
    'all-eleven-final': [`${continuationDirectory}/final-continue.json`, 'product-audit', 'continuation-final-all-eleven-after-deployment-and-current-startup'],
    'post-gate-exo': ['.harness/fix-nine-rollout-001/execution/post-gate-exo-continue.json', 'product-audit', 'exo-after-authenticated-final-gate-and-current-startup'],
    'transcript-maintenance-code': [`${continuationDirectory}/transcript-maintenance/code-review.json`, 'execution-authority', 'append-only-transcript-path-maintenance'],
    'transcript-maintenance-batch': [`${continuationDirectory}/transcript-maintenance/batch-review.json`, 'execution-authority', 'after-original-nine-completion-before-final-all-eleven-gate']
  };
  if (fixed[permit.category]) {
    equal([recordPath, kind, body.scope], fixed[permit.category]);
    if(permit.category.startsWith('transcript-maintenance-')) {
      for(const flag of ['ownershipAuthorized','nativeWriteAuthorized','originalReplayAuthorized']) assert.equal(body[flag],false);
      assert.equal(body.featureId,'fix-nine-rollout-001');
      if(permit.category==='transcript-maintenance-code') {
        assert.equal(body.kind,'fix-nine-transcript-maintenance-code');
        assert.equal(body.changes?.length,2);
        equal(body.changes.map(x=>x.before.path).sort(),['scripts/fix-nine-rollout-continuation-auth.mjs','scripts/fix-nine-rollout-continuation.mjs']);
        for(const change of body.changes) {
          for(const key of ['before','after','archive']) reference(change[key]);
          assert.equal(change.after.path,change.before.path);
          assert(change.archive.path.startsWith(`${continuationDirectory}/transcript-maintenance/`));
          equal([change.archive.bytes,change.archive.sha256],[change.before.bytes,change.before.sha256]);
        }
        reference(body.added);assert.equal(body.added.path,'scripts/fix-nine-transcript-maintenance.mjs');
      } else {
        assert.equal(body.kind,'fix-nine-transcript-maintenance-batch');
        assert(typeof body.collectedAt==='string'&&Number.isFinite(Date.parse(body.collectedAt)));
        for(const key of ['audit','review','authority']) reference(body.originalCompletion?.[key]);
        assert.equal(body.originalCompletion.audit.path,`${continuationDirectory}/nine-final-audit.json`);
        assert.equal(body.originalCompletion.review.path,`${continuationDirectory}/nine-final-continue.json`);
        equal(body.originalCompletion.authority,anchor.originalAuthority);
        equal(body.plans?.map(x=>x.index),Array.from({length:11},(_,i)=>i));
        for(const plan of body.plans) {
          assert.equal(plan.pairs?.length,plan.index===0?1:2);
          for(const pair of plan.pairs) for(const key of ['before','after','archive','candidate']) reference(pair[key]);
        }
      }
    }
  } else if (permit.category === 'continuation-maintenance') {
    assert.match(recordPath, /^\.harness\/fix-nine-rollout-001\/continuation\/maintenance-[a-z0-9-]+-review\.json$/);
    assert.equal(kind, 'execution-authority'); assert.equal(body.scope, 'continuation-guard-maintenance');
    assert(Array.isArray(permit.changes) && permit.changes.length > 0 && permit.changes.length <= maintenancePaths.length);
    assert.equal(new Set(permit.changes.map(c => c.path)).size, permit.changes.length);
    for (const change of permit.changes) {
      assert(maintenancePaths.includes(change.path), 'Maintenance cannot modify historical signer dependencies or consumers');
      for (const k of ['before', 'archive', 'after']) reference(change[k]);
      assert.equal(change.before.path, change.path); assert.equal(change.after.path, change.path);
      assert(change.archive.path.startsWith(`${recoveryDirectory}/archives/`));
      equal([change.archive.bytes, change.archive.sha256], [change.before.bytes, change.before.sha256]);
      assert(permit.materialRefs.some(r => JSON.stringify(r) === JSON.stringify(change.archive)));
      assert(permit.materialRefs.some(r => JSON.stringify(r) === JSON.stringify(change.after)));
    }
    equal(body.changes, permit.changes);
  } else assert.fail('Unrecognized recovery category; no wildcard permit');
  return permit;
}
export function validatePermitApproval(approval, permit, anchor, requesterId) {
  assert.equal(approval.version, 1); assert.equal(approval.kind, permit.reviewKind);
  assert.equal(approval.verdict, 'CONTINUE'); equal(approval.findings, []);
  assert.equal(approval.reviewerId, anchor.reviewerId);
  assert.match(approval.reviewerId, identity);
  if (requesterId !== undefined) {
    assert.match(requesterId, identity); assert.notEqual(approval.reviewerId, requesterId);
  }
  assert.equal(approval.payloadSha256, permit.payloadSha256);
  assert.equal(approval.permitSha256, digest(permitReviewPayload(permit)));
  assert(typeof approval.reviewedAt === 'string' && Number.isFinite(Date.parse(approval.reviewedAt)));
}
export function validateRecoveryEnvelope({envelope, recordPath, kind, body, anchor, anchorRef, permit, permitRef, approval}) {
  validateAnchor(anchor, anchorRef); reference(permitRef);
  verifyEnvelopeSignature({envelope,recordPath,kind,body,anchor,anchorRef});
  assert(permitRef.path.startsWith(`${recoveryDirectory}/permits/`) && permitRef.path.endsWith('.json'));
  validatePermit(permit, {anchor, anchorRef, recordPath, kind, body});
  validatePermitApproval(approval, permit, anchor);
  assert.equal(envelope.version, 1); assert.equal(envelope.kind, 'fix-nine-rollout-recovery-epoch-review');
  assert.equal(envelope.epoch, anchor.epoch); equal(envelope.epochAnchor, anchorRef);
  assert.equal(envelope.recordPath, recordPath); assert.equal(envelope.reviewKind, kind);
  equal(envelope.permitRef, permitRef); equal(envelope.body, body);
  const seal = envelope.seal;
  assert.equal(seal.version, 1); assert.equal(seal.kind, kind); assert.equal(seal.verdict, 'CONTINUE');
  equal(seal.body, body);
  assert(verify(null, standardPayload(kind, body), anchor.publicKey, Buffer.from(seal.signature, 'base64')), 'Invalid inner signature');
  return {seal, publicKey: anchor.publicKey};
}
export function verifyEnvelopeSignature({envelope,recordPath,kind,body,anchor,anchorRef}) {
  validateAnchor(anchor,anchorRef);
  assert.equal(envelope.version,1);assert.equal(envelope.kind,'fix-nine-rollout-recovery-epoch-review');
  assert.equal(envelope.epoch,anchor.epoch);equal(envelope.epochAnchor,anchorRef);
  assert.equal(envelope.recordPath,recordPath);assert.equal(envelope.reviewKind,kind);equal(envelope.body,body);
  reference(envelope.permitRef);
  const payload=envelopePayload({epoch:anchor.epoch,epochAnchor:anchorRef,recordPath,kind,body,permitRef:envelope.permitRef});
  assert(verify(null,payload,anchor.publicKey,Buffer.from(envelope.signature,'base64')),'Invalid epoch envelope signature');
}
export async function authenticateRecoveryReview({io, sealRef, kind, body, admission}) {
  assert(admission && admission.anchorRef, 'Exact externally admitted recovery anchor required');
  // The anchor comes only from the reviewed bootstrap. A permit locator is
  // accepted from a sidecar only after its exact raw pin is signed by that key.
  const {anchorRef} = admission;
  reference(sealRef); reference(anchorRef);
  const anchor = JSON.parse(await io.authenticate(anchorRef));
  validateAnchor(anchor, anchorRef);
  const anchorEvidence = ['originalAuthority', 'originalContinuation', 'authorization', 'deathDiagnosis', 'nativeLaunch', 'publicMetadata'].map(k => anchor[k]);
  for (const ref of anchorEvidence) await io.authenticate(ref);
  const sidecarRef=await io.pin(`${sealRef.path}.epoch.json`);
  const envelope=JSON.parse(await io.authenticate(sidecarRef));
  verifyEnvelopeSignature({envelope,recordPath:sealRef.path,kind,body,anchor,anchorRef});
  const permitRef=envelope.permitRef;
  if(admission.permitRef) equal(permitRef,admission.permitRef);
  const permit = JSON.parse(await io.authenticate(permitRef));
  validatePermit(permit, {anchor, anchorRef, recordPath: sealRef.path, kind, body});
  const approval = JSON.parse(await io.authenticate(permit.approvalRef));
  for (const ref of permit.materialRefs) await io.authenticate(ref);
  const standard=JSON.parse(await io.authenticate(sealRef));
  equal(envelope.seal,standard,'Standard historical-format record must equal authenticated epoch inner seal');
  const validated = validateRecoveryEnvelope({envelope, recordPath: sealRef.path, kind, body, anchor, anchorRef, permit, permitRef, approval});
  const refs = [anchorRef, ...anchorEvidence, permitRef, permit.approvalRef, ...permit.materialRefs, sealRef,sidecarRef];
  for (const ref of refs) await io.authenticate(ref);
  return {...validated, refs};
}
