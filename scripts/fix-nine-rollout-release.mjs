// Clearance-only source release authentication. Default gate/deployment paths
// never use this capability; it is minted from the signed, sealed audit chain.
import assert from 'node:assert/strict';
import {verify} from 'node:crypto';
import path from 'node:path';
import {authenticateFile, pinFile, readJson} from './fix-nine-rollout-files.mjs';
import {canonicalHash, gateDirectory, rolloutFeatureId} from './fix-nine-rollout-evidence.mjs';

const base = '.harness/fix-nine-rollout-001/execution/post-gate-exo';
export const sourceContinuityArchivePath = `${base}-source-continuity.json`;
const paths = ['.harness/features.json', '.harness/continuity.json', '.harness/progress.md', '.harness/handoff.md', '.harness/events.jsonl'];
const contexts = new WeakMap();
const json = bytes => JSON.parse(bytes.toString('utf8'));
const equal = (a,b) => assert.deepEqual(a,b);

export async function captureSourceReleaseBoundary(root, saveArchive) {
  const before = await readJson(root, `${gateDirectory}/before.json`);
  const bytes = await authenticateFile(root, before.continuity);
  const continuity = json(bytes);
  assert.equal(continuity.owner?.id, before.owner);
  assert.equal(continuity.owner?.source, 'CODEX_THREAD_ID');
  assert.equal(continuity.owner?.featureId, rolloutFeatureId);
  assert.equal(continuity.phase, 'working'); assert.equal(continuity.handoff, null);
  const archive = await saveArchive(sourceContinuityArchivePath, bytes);
  const refs = await Promise.all(paths.map(p => pinFile(root,p)));
  const boundary = {version:1, archive, lifecycle:{features:json(await authenticateFile(root,refs[0])), continuity, refs},
    config:await pinFile(root,'.harness/config.json'), runtime:await pinFile(root,'.harness/run.mjs')};
  await validateBoundary(root,boundary,before);
  for(const ref of [...refs,boundary.config,boundary.runtime]) await authenticateFile(root,ref);
  return boundary;
}

async function validateBoundary(root,boundary,before) {
  assert.equal(boundary?.version,1);
  assert.equal(boundary.archive.path,sourceContinuityArchivePath);
  equal({bytes:boundary.archive.bytes,sha256:boundary.archive.sha256},
    {bytes:before.continuity.bytes,sha256:before.continuity.sha256});
  equal(json(await authenticateFile(root,boundary.archive)),boundary.lifecycle.continuity);
  equal(boundary.lifecycle.refs.map(r=>r.path),paths);
  equal(boundary.lifecycle.refs[1],before.continuity);
  assert.equal(boundary.config.path,'.harness/config.json'); assert.equal(boundary.runtime.path,'.harness/run.mjs');
  equal(boundary.config,before.bindings.config);
  const owner=boundary.lifecycle.continuity.owner;
  assert.equal(owner?.id,before.owner); assert.equal(owner?.source,'CODEX_THREAD_ID');
  assert.equal(owner?.featureId,rolloutFeatureId);
  equal(json(await authenticateFile(root,boundary.lifecycle.refs[0])),boundary.lifecycle.features);
  for(const ref of [boundary.config,boundary.runtime]) await authenticateFile(root,ref);
}

function validTime(value) { const time=Date.parse(value); assert(Number.isFinite(time)); assert.equal(new Date(time).toISOString(),value); return time; }
export async function authenticateOwnedReleaseBoundary(root,boundary) {
  const before=await readJson(root,`${gateDirectory}/before.json`);
  await validateBoundary(root,boundary,before);
  for(const ref of boundary.lifecycle.refs) await authenticateFile(root,ref);
}

// This validates a bounded release projection, not the provenance of the whole
// new checkpoint. In particular repository hashes/fingerprints are advisory:
// the yield happened after the signed boundary and those values are not signed.
// Gate/preservation decisions must use only the archived lifecycle returned by
// releaseState, together with their independently authenticated physical files.
function validateCheckpoint(before,after,config,sealedAt,observedAt) {
  const checkpoint=after.checkpoint, state=before.features;
  equal(Object.keys(checkpoint).sort(),['id','kind','createdAt','reason','agent','automatic','summary','next','decisions','blockers','historicalBlockedCount','featureRevision','activeFeatures','selectedFeatureId','passingFeatureCount','evidence','configHash','repository'].sort());
  assert.equal(checkpoint.kind,'checkpoint'); assert.equal(checkpoint.reason,'worker_yield');
  assert.equal(checkpoint.selectedFeatureId,before.continuity.owner.featureId);
  assert.equal(checkpoint.featureRevision,state.revision); assert.equal(checkpoint.configHash,canonicalHash(config));
  assert.equal(checkpoint.automatic,false); assert.equal(checkpoint.agent,null);
  assert.equal(checkpoint.historicalBlockedCount,state.features.filter(f=>f.status==='blocked').length);
  assert.equal(checkpoint.passingFeatureCount,state.features.filter(f=>f.status==='passing').length);
  equal(checkpoint.activeFeatures,state.features.filter(f=>f.status==='active').map(({id,title,description})=>({id,title,description})));
  assert(typeof checkpoint.summary==='string' && checkpoint.summary.length>0 && Buffer.byteLength(checkpoint.summary)<=4000);
  assert(typeof checkpoint.next==='string' && checkpoint.next.length>0 && Buffer.byteLength(checkpoint.next)<=2000);
  for(const [name,limit] of [['decisions',20],['blockers',20],['evidence',30]]) {
    const list=checkpoint[name]; assert(Array.isArray(list) && list.length<=limit);
    for(const item of list) assert(typeof item==='string' && item.trim().length>0 && Buffer.byteLength(item)<=1024);
  }
  equal(checkpoint.blockers,[...new Set(checkpoint.blockers)]); equal(checkpoint.evidence,[...new Set(checkpoint.evidence)]);
  assert(Buffer.byteLength(JSON.stringify({summary:checkpoint.summary,next:checkpoint.next,decisions:checkpoint.decisions,blockers:checkpoint.blockers,evidence:checkpoint.evidence}))<=12288);
  const repository=checkpoint.repository;
  equal(Object.keys(repository).sort(),['available','head','branch','clean','worktreeHash','captureMode','capturePolicy','changedFileCount','changedFiles'].sort());
  assert.equal(typeof repository.available,'boolean'); assert.equal(typeof repository.clean,'boolean');
  assert(repository.head===null || /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(repository.head));
  assert(repository.branch===null || typeof repository.branch==='string');
  assert(repository.worktreeHash===null || /^[a-f0-9]{64}$/.test(repository.worktreeHash));
  const policy=config.scope?.capture;
  equal(repository.capturePolicy,{version:1,metadataRoots:[...new Set(policy?.metadataRoots??[])].sort(),metadataExtensions:[...new Set(policy?.metadataExtensions??[])].sort()});
  assert.equal(repository.captureMode,repository.capturePolicy.metadataRoots.length?'artifact-metadata-v1':'content-v1');
  assert(Number.isSafeInteger(repository.changedFileCount) && repository.changedFileCount>=0);
  assert(Array.isArray(repository.changedFiles)); assert.equal(repository.changedFiles.length,Math.min(repository.changedFileCount,100));
  for(const file of repository.changedFiles) {
    assert(typeof file.path==='string' && file.path.length>0 && typeof file.status==='string');
    assert(file.hash===null || typeof file.hash==='string');
    equal(Object.keys(file).sort(),['path','status','hash',...(file.fingerprint?['fingerprint']:[])].sort());
  }
  const seed={kind:'checkpoint',createdAt:checkpoint.createdAt,summary:checkpoint.summary,next:checkpoint.next,revision:state.revision,head:checkpoint.repository.head};
  equal(checkpoint.id,`checkpoint-${checkpoint.createdAt.replace(/[^0-9]/g,'').slice(0,17)}-${canonicalHash(seed).slice(0,8)}`);
  assert(validTime(checkpoint.createdAt)>=validTime(sealedAt)); assert(validTime(checkpoint.createdAt)<=validTime(observedAt));
  assert(Buffer.byteLength(JSON.stringify(checkpoint))<=24576);
  return checkpoint;
}

async function validateCurrent(root,boundary,sealedAt,observedAt) {
  const live=await Promise.all(paths.map(p=>pinFile(root,p)));
  for(const ref of [boundary.lifecycle.refs[0],boundary.config,boundary.runtime]) await authenticateFile(root,ref);
  const current=json(await authenticateFile(root,live[1]));
  if(canonicalHash(live)===canonicalHash(boundary.lifecycle.refs)) {
    equal(current,boundary.lifecycle.continuity); return live;
  }
  const old=boundary.lifecycle.continuity;
  assert.equal(current.owner,null);
  equal(current.retiredWorkerIds,[...new Set([...(old.retiredWorkerIds??[]),old.owner.id])]);
  equal({...current,checkpoint:old.checkpoint,owner:old.owner,retiredWorkerIds:old.retiredWorkerIds},old);
  const checkpoint=validateCheckpoint(boundary.lifecycle,current,json(await authenticateFile(root,boundary.config)),sealedAt,observedAt);
  const events=await authenticateFile(root,live[4]),prefix=boundary.lifecycle.refs[4];
  assert.equal(events.subarray(0,prefix.bytes).length,prefix.bytes);
  // Authenticate the exact historical prefix using the archived digest.
  equal(await pinPrefix(events,prefix),prefix);
  const suffix=events.subarray(prefix.bytes).toString('utf8');
  assert(suffix.endsWith('\n')); const lines=suffix.slice(0,-1).split('\n'); assert.equal(lines.length,1);
  const event=JSON.parse(lines[0]); assert.equal(suffix,JSON.stringify(event)+'\n');
  equal(event,{version:1,id:event.id,at:event.at,type:'checkpoint.written',checkpointId:checkpoint.id,summary:checkpoint.summary,next:checkpoint.next,revision:checkpoint.featureRevision,generation:old.generation});
  const eventIdentity=/^(\d+)-[1-9]\d*-[a-f0-9]{1,8}$/.exec(event.id); assert(eventIdentity);
  assert(Number(eventIdentity[1])>=validTime(checkpoint.createdAt)); assert(Number(eventIdentity[1])<=validTime(event.at));
  assert(validTime(event.at)>=validTime(checkpoint.createdAt)); assert(validTime(event.at)<=validTime(observedAt));
  for(const [i,render] of [[2,renderProgress],[3,renderWorkingHandoff]]) {
    const text=(await authenticateFile(root,live[i])).toString('utf8');
    const generated=/^Generated: (.+)$/m.exec(text)?.[1];
    assert(validTime(generated)>=validTime(checkpoint.createdAt)); assert(validTime(generated)<=validTime(event.at));
    equal(text,i===2?render(checkpoint,'working',old.generation,generated):render(current,null,generated));
  }
  return live;
}

async function pinPrefix(bytes,ref) {
  const {createHash}=await import('node:crypto');
  return {path:ref.path,bytes:ref.bytes,sha256:createHash('sha256').update(bytes.subarray(0,ref.bytes)).digest('hex')};
}

// Public-key injection exists only for isolated fixture keys. Production passes
// the reviewed fixed anchor; no live token can be minted without its signature.
export async function authenticateSourceRelease({root,publicKey,observedAt=new Date().toISOString()}) {
  const refs=await Promise.all([`${base}-audit.json`,`${base}-continue.json`,`${base}-clearance.json`,`${gateDirectory}/before.json`].map(p=>pinFile(root,p)));
  const [audit,review,receipt,before]=await Promise.all(refs.map(async r=>json(await authenticateFile(root,r))));
  const boundary=audit.sourceReleaseBoundary;
  await validateBoundary(root,boundary,before);
  assert.equal(audit.kind,'fix-nine-rollout-exo-post-gate-audit'); assert.equal(audit.featureId,rolloutFeatureId);
  equal(audit.gate,await pinFile(root,`${gateDirectory}/receipt.json`));
  assert.equal(audit.actor,before.owner); assert.equal(audit.hold,'pending-independent-clearance'); assert.equal(audit.holdCleared,false);
  assert.equal(review.version,1); assert.equal(review.kind,'product-audit'); assert.equal(review.verdict,'CONTINUE');
  assert(typeof review.body.actor==='string' && review.body.actor.length>0); assert.notEqual(review.body.actor,audit.actor);
  const body={authority:audit.deployment.authority,sourceClosure:audit.deployment.sourceClosure,gate:audit.gate,audit:refs[0],actor:review.body.actor,target:audit.target,
    scope:'exo-after-authenticated-final-gate-and-current-startup',verdict:'CONTINUE'};
  equal(review.body,body);
  assert(verify(null,Buffer.from(JSON.stringify({domain:'fix-nine-rollout-001/exact-review/v1',kind:'product-audit',body})),publicKey,Buffer.from(review.signature,'base64')));
  const {sealedAt,...receiptBody}=receipt;
  equal(receiptBody,{version:1,kind:'fix-nine-rollout-exo-clearance',featureId:rolloutFeatureId,gate:audit.gate,deployment:audit.deployment,target:audit.target,audit:refs[0],independentContinue:refs[1],hold:'cleared',holdCleared:true});
  assert(validTime(sealedAt)>=validTime(audit.at)); assert(validTime(sealedAt)<=validTime(observedAt));
  const live=await validateCurrent(root,boundary,sealedAt,observedAt);
  const token=Object.freeze({}); contexts.set(token,{root:path.resolve(root),refs,boundary:structuredClone(boundary),before,live,sealedAt});
  await releaseState(root,token); return token;
}

export async function releaseState(root,token) {
  const context=contexts.get(token); assert(context,'Unvalidated source release context'); assert.equal(path.resolve(root),context.root);
  for(const ref of [...context.refs,...context.live]) await authenticateFile(root,ref);
  await validateBoundary(root,context.boundary,context.before);
  equal(await validateCurrent(root,context.boundary,context.sealedAt,new Date().toISOString()),context.live);
  // Never substitute the current checkpoint (including its advisory repository
  // digest fields) into the authenticated pre-release preservation snapshot.
  return structuredClone(context.boundary.lifecycle);
}

export async function gateContinuity(root,ref,sourceRelease) {
  if(!sourceRelease) return json(await authenticateFile(root,ref));
  const snapshot=await releaseState(root,sourceRelease); equal(snapshot.refs[1],ref); return snapshot.continuity;
}

// Exact current runtime projections; the sealed helper closure binds these bytes.
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

