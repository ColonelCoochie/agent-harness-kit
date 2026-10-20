// Cooperative exact-review relay. Import only captures this immutable source
// pair; it never generates a key, imports the live original graph, or launches.
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {lstat, open, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const relayLocation=fileURLToPath(import.meta.url);
const epochLocation=path.join(path.dirname(relayLocation),'fix-nine-rollout-recovery-epoch.mjs');
const shaBytes=b=>createHash('sha256').update(b).digest('hex');
const ownLoadedHashes=Object.freeze({
  'scripts/fix-nine-rollout-recovery-relay.mjs':shaBytes(readFileSync(relayLocation)),
  'scripts/fix-nine-rollout-recovery-epoch.mjs':shaBytes(readFileSync(epochLocation))
});
const {
  digest, reference, relativePath, recoveryPayload, envelopePayload, standardPayload,
  validateAnchor, validatePermit, validatePermitApproval,
  continuationDirectory, recoveryDirectory
}=await import('./fix-nine-rollout-recovery-epoch.mjs');
assert.equal(shaBytes(readFileSync(epochLocation)),ownLoadedHashes['scripts/fix-nine-rollout-recovery-epoch.mjs'],'Epoch module changed during import');
assert.equal(shaBytes(readFileSync(relayLocation)),ownLoadedHashes['scripts/fix-nine-rollout-recovery-relay.mjs'],'Relay changed during import');

export const originalSourcePaths = Object.freeze([
  ...['signer','deployment','files','release','evidence','closure','preflight','auth','inventory'].map(n => `scripts/fix-nine-rollout-${n}.mjs`),
  ...['core','hook-policy','native-hook-client'].map(n => `skill/codex-harness/scripts/lib/${n}.mjs`),
  'skill/codex-harness/assets/context-budget.mjs',
  ...[1,2,3].map(n => `skill/codex-harness/assets/native-hook-bootstrap-v${n}.json`)
]);
export const relaySourcePaths = Object.freeze([
  'scripts/fix-nine-rollout-recovery-relay.mjs',
  'scripts/fix-nine-rollout-recovery-epoch.mjs'
]);
export const activationDomain = 'fix-nine-rollout-001/recovery-activation/v1';
export const prelaunchDomain = 'fix-nine-rollout-001/recovery-prelaunch/v1';
const eq = (a,b,m) => assert.deepEqual(a,b,m);
const bytesOf = value => Buffer.from(JSON.stringify(value), 'utf8');
export const activationPayload = body => bytesOf({domain: activationDomain, body});
export const prelaunchPayload = body => bytesOf({domain: prelaunchDomain, body});
const requireOwner = value => assert(typeof value === 'string' && /^[a-zA-Z0-9_./:-]{1,200}$/.test(value));
export function validateHttpRequest(request,port) {
  assert(['127.0.0.1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress));
  const entries=[];
  for(let i=0;i<request.rawHeaders.length;i+=2) entries.push([request.rawHeaders[i].toLowerCase(),request.rawHeaders[i+1]]);
  const hosts=entries.filter(([name])=>name==='host');
  assert.equal(hosts.length,1);assert.equal(hosts[0][1],`127.0.0.1:${port}`,'Exact loopback Host required');
  assert(!entries.some(([name])=>name==='origin'),'Browser Origin is forbidden');
  assert(!entries.some(([name])=>name==='upgrade'),'Protocol upgrade is forbidden');
  assert.notEqual(request.method,'CONNECT');
  if(request.method==='POST') {
    const contentTypes=entries.filter(([name])=>name==='content-type');
    assert.equal(contentTypes.length,1);
    assert.match(contentTypes[0][1],/^application\/json(?:;\s*charset=utf-8)?$/i,'JSON-only request');
  }
}
export function validateLaunchConfiguration({root,config,relayPath=relayLocation,epochPath=epochLocation,loadedHashes=ownLoadedHashes}) {
  assert(typeof config.root==='string'&&path.isAbsolute(config.root));
  assert.equal(path.resolve(root),path.resolve(config.root),'Reviewed source root required');
  assert.equal(path.resolve(relayPath),path.resolve(root,'scripts/fix-nine-rollout-recovery-relay.mjs'),'Executing relay must be the pinned source file');
  assert.equal(path.resolve(epochPath),path.resolve(root,'scripts/fix-nine-rollout-recovery-epoch.mjs'));
  eq(config.protectedRefs.map(r=>r.path).sort(),[...originalSourcePaths,...relaySourcePaths].sort());
  for(const ref of config.protectedRefs) reference(ref);
  for(const source of relaySourcePaths) assert.equal(config.protectedRefs.find(r=>r.path===source).sha256,loadedHashes[source],'Reviewed source differs from loaded relay modules');
}
function exactApproval(approval, {kind, payload, reviewerId, requesterId}) {
  assert.equal(approval.version,1); assert.equal(approval.kind,kind);
  assert.equal(approval.verdict,'CONTINUE'); eq(approval.findings,[]);
  assert.equal(approval.payloadSha256,digest(payload));
  assert.equal(approval.reviewerId,reviewerId); requireOwner(reviewerId); requireOwner(requesterId);
  assert.notEqual(reviewerId,requesterId);
  assert(typeof approval.reviewedAt==='string' && Number.isFinite(Date.parse(approval.reviewedAt)));
}
export function createReadOnlyIO(root) {
  const base = path.resolve(root);
  async function read(relative, prefixBytes) {
    relativePath(relative);
    const rootInfo=await lstat(base); assert(rootInfo.isDirectory()&&!rootInfo.isSymbolicLink());
    assert.equal(path.resolve(await realpath(base)),base,'Canonical project directory required');
    let current=base;
    const segments=relative.split('/');
    for(let i=0;i<segments.length;i++) {
      current=path.join(current,segments[i]);
      const info=await lstat(current); assert(!info.isSymbolicLink(),'Symlink evidence is forbidden');
      assert(i===segments.length-1?info.isFile():info.isDirectory());
    }
    const handle=await open(current,'r');
    try {
      const before=await handle.stat(); assert(before.isFile());
      assert(before.size<=128*1024*1024,'Evidence exceeds bounded read size');
      const wanted=prefixBytes??before.size;
      assert(Number.isSafeInteger(wanted)&&wanted>=0&&wanted<=before.size);
      const bytes=Buffer.alloc(wanted);let offset=0;
      while(offset<wanted) {
        const {bytesRead}=await handle.read(bytes,offset,wanted-offset,offset);
        assert(bytesRead>0,'Evidence shortened during read');offset+=bytesRead;
      }
      const after=await handle.stat(),physical=await lstat(current);
      assert(!physical.isSymbolicLink()&&physical.isFile());
      eq([before.dev,before.ino],[after.dev,after.ino]);
      eq([before.dev,before.ino],[physical.dev,physical.ino]);
      if(prefixBytes===undefined) assert.equal(after.size,before.size);
      return bytes;
    } finally {await handle.close();}
  }
  return {
    read,
    async pin(p) {const b=await read(p);return {path:p,bytes:b.length,sha256:digest(b)};},
    async authenticate(ref) {
      reference(ref);const b=await read(ref.path);
      assert.equal(b.length,ref.bytes);assert.equal(digest(b),ref.sha256);return b;
    },
    async prefix(ref) {
      reference(ref);const b=await read(ref.path,ref.bytes);
      assert.equal(digest(b),ref.sha256);return b;
    }
  };
}
async function readPinned(io,p) {
  const ref=await io.pin(p);return {ref,value:JSON.parse(await io.authenticate(ref))};
}
// Reuse the unchanged original lifecycle verifier, starting from the actual
// working launch observation independently admitted with activation. It is not
// necessary to replay or rewrite earlier exceptional handoff records.
export function createOwnerVerifier({io,launchObservation,authenticateLifecycleStep}) {
  assert.equal(launchObservation.version,1);
  assert.equal(launchObservation.kind,'fix-nine-rollout-recovery-launch-observation');
  const base=launchObservation.lifecycle;
  assert.equal(base.continuity.phase,'working');assert.equal(base.continuity.handoff,null);
  assert.equal(base.continuity.owner.source,'CODEX_THREAD_ID');
  reference(launchObservation.events);assert.equal(launchObservation.events.path,'.harness/events.jsonl');
  return async requesterId => {
    requireOwner(requesterId);
    const feature=await readPinned(io,'.harness/features.json');
    const continuity=await readPinned(io,'.harness/continuity.json');
    const current=continuity.value;
    assert.equal(current.phase,'working');assert.equal(current.handoff,null);
    assert.equal(current.owner?.source,'CODEX_THREAD_ID');assert.equal(current.owner?.id,requesterId);
    assert.equal(current.owner.generation,current.generation);
    assert(!(current.retiredWorkerIds??[]).includes(requesterId));
    assert(Number.isSafeInteger(current.generation)&&current.generation>=base.continuity.generation);
    assert(current.generation-base.continuity.generation<=512,'Unbounded transfer chain');
    const refs=[feature.ref,continuity.ref],prefixes=[launchObservation.events];
    await io.prefix(launchObservation.events);
    let before={...base,refs:[launchObservation.events]};
    for(let g=base.continuity.generation+1;g<=current.generation;g++) {
      const row=await readPinned(io,`${continuationDirectory}/transfer-${g}.json`);
      assert.equal(row.value.version,1);
      assert.equal(row.value.lifecycle?.continuity?.generation,g);
      assert(!row.value.proof?.driftDisposition,'Availability drift is outside recovery owner authority');
      reference(row.value.events);assert.equal(row.value.events.path,'.harness/events.jsonl');
      const after={...row.value.lifecycle,refs:[row.value.events]};
      await authenticateLifecycleStep(before,after,row.value.proof,io,refs);
      const actor=after.continuity.owner.id;
      assert.equal(row.value.context?.path,`.harness/context/${createHash('sha256').update(actor).digest('hex')}.json`);
      assert.equal(row.value.context?.value?.actorHash,createHash('sha256').update(actor).digest('hex'));
      assert.equal(row.value.context?.value?.role,'worker');
      refs.push(row.ref);prefixes.push(row.value.events);before=after;
    }
    const currentEvents=await io.pin('.harness/events.jsonl');
    const after={features:feature.value,continuity:current,refs:[currentEvents]};
    await authenticateLifecycleStep(before,after,null,io,refs);
    prefixes.push(currentEvents);
    for(const ref of refs) await io.authenticate(ref);
    for(const ref of prefixes) await io.prefix(ref);
    return {owner:requesterId,generation:current.generation,refs,prefixes};
  };
}
export function createRecoveryService({io,signer,metadata,protectedRefs,verifyOwner,launchObservationRef,reviewerId}) {
  let active=null,poisoned=false;
  let queue=Promise.resolve();
  const issued=new Map();
  assert.equal(metadata.publicKey,signer.publicKey);
  async function protectedGraph() {
    assert(!poisoned,'Relay protected graph previously drifted; restart is not automatic recovery');
    try {for(const ref of protectedRefs) await io.authenticate(ref);}
    catch(error) {poisoned=true;throw error;}
  }
  async function stableOwner(observation) {
    for(const ref of observation.refs) await io.authenticate(ref);
    for(const ref of observation.prefixes) await io.prefix(ref);
  }
  async function publicState() {
    await protectedGraph();
    return {metadata,phase:active?'active':'public-only',epoch:active?.anchor.epoch??null};
  }
  async function activate({anchorRef,activationRef,approvalRef,requesterId}) {
    await protectedGraph();assert.equal(active,null,'An epoch may activate only once');
    const owner=await verifyOwner(requesterId);
    reference(anchorRef);reference(activationRef);reference(approvalRef);
    assert(activationRef.path.startsWith(`${recoveryDirectory}/`)&&activationRef.path.endsWith('-activation.json'));
    assert(approvalRef.path.startsWith(`${recoveryDirectory}/reviews/`));
    const anchor=JSON.parse(await io.authenticate(anchorRef));validateAnchor(anchor,anchorRef);
    assert.equal(anchor.reviewerId,reviewerId);assert.equal(anchor.publicKey,metadata.publicKey);
    const evidence=['originalAuthority','originalContinuation','authorization','deathDiagnosis','nativeLaunch','publicMetadata'].map(k=>anchor[k]);
    for(const ref of evidence) await io.authenticate(ref);
    const actualPublic=JSON.parse(await io.authenticate(anchor.publicMetadata));
    eq(actualPublic.metadata,metadata,'Activation must admit actual public-only launch metadata');
    const body=JSON.parse(await io.authenticate(activationRef));
    assert.equal(body.version,1);assert.equal(body.kind,'fix-nine-rollout-recovery-activation');
    assert.equal(body.epoch,anchor.epoch);eq(body.epochAnchor,anchorRef);
    eq(body.publicMetadata,anchor.publicMetadata);eq(body.launchObservation,launchObservationRef);
    eq(body.protectedRefs,protectedRefs);assert.equal(body.scopePolicyVersion,1);
    assert(Array.isArray(body.materialRefs)&&body.materialRefs.length>0&&body.materialRefs.length<=256);
    body.materialRefs.forEach(reference);
    const approval=JSON.parse(await io.authenticate(approvalRef));
    exactApproval(approval,{kind:body.kind,payload:activationPayload(body),reviewerId,requesterId});
    for(const ref of body.materialRefs) await io.authenticate(ref);
    await io.authenticate(launchObservationRef);
    for(const ref of [anchorRef,activationRef,approvalRef,...evidence]) await io.authenticate(ref);
    await stableOwner(owner);await protectedGraph();
    // Adapter material is authenticated for activation, not imported or pinned as
    // loaded code. Each later exact permit authenticates its then-current set.
    active={anchor,anchorRef,activationRef,approvalRef,evidence};
    return {activated:true,epoch:anchor.epoch,epochAnchor:anchorRef,owner:owner.owner,generation:owner.generation};
  }
  async function seal({recordPath,kind,body,permitRef,requesterId}) {
    await protectedGraph();assert(active,'Relay is public-only until exact reviewed activation');
    const owner=await verifyOwner(requesterId);
    for(const ref of [active.anchorRef,active.activationRef,active.approvalRef,...active.evidence]) await io.authenticate(ref);
    reference(permitRef);assert(permitRef.path.startsWith(`${recoveryDirectory}/permits/`)&&permitRef.path.endsWith('.json'));
    const permit=JSON.parse(await io.authenticate(permitRef));
    validatePermit(permit,{anchor:active.anchor,anchorRef:active.anchorRef,recordPath,kind,body});
    const approval=JSON.parse(await io.authenticate(permit.approvalRef));
    validatePermitApproval(approval,permit,active.anchor,requesterId);
    for(const ref of permit.materialRefs) await io.authenticate(ref);
    const payload=recoveryPayload({epoch:active.anchor.epoch,epochAnchor:active.anchorRef,recordPath,kind,body});
    const requestHash=digest(bytesOf({payloadSha256:digest(payload),permitRef}));
    if(issued.has(recordPath)) {
      const previous=issued.get(recordPath);
      assert.equal(previous.requestHash,requestHash,'A record may not be resigned for different content');
      try {
        const published=await readPinned(io,recordPath);eq(published.value,previous.result.seal,'Existing publication differs');
      } catch(error) {if(error.code!=='ENOENT')throw error;}
      try {
        const sidecar=await readPinned(io,`${recordPath}.epoch.json`);eq(sidecar.value,previous.result.epochEnvelope,'Existing epoch sidecar differs');
      } catch(error) {if(error.code!=='ENOENT')throw error;}
      await stableOwner(owner);await protectedGraph();return previous.result;
    }
    try {await io.pin(recordPath);assert.fail('Existing publication cannot be overwritten or resigned');}
    catch(error) {if(error.code!=='ENOENT')throw error;}
    try {await io.pin(`${recordPath}.epoch.json`);assert.fail('Existing epoch sidecar cannot be overwritten or resigned');}
    catch(error) {if(error.code!=='ENOENT')throw error;}
    const inner={version:1,kind,body,verdict:'CONTINUE',signature:signer.sign(standardPayload(kind,body))};
    const envelope={
      version:1,kind:'fix-nine-rollout-recovery-epoch-review',epoch:active.anchor.epoch,
      epochAnchor:active.anchorRef,recordPath,reviewKind:kind,permitRef,body,seal:inner,
      signature:signer.sign(envelopePayload({epoch:active.anchor.epoch,epochAnchor:active.anchorRef,recordPath,kind,body,permitRef}))
    };
    for(const ref of [permitRef,permit.approvalRef,...permit.materialRefs]) await io.authenticate(ref);
    await stableOwner(owner);await protectedGraph();
    const result={recordPath,epochPath:`${recordPath}.epoch.json`,seal:inner,epochEnvelope:envelope};
    issued.set(recordPath,{requestHash,result});
    return result;
  }
  const serial = operation => input => {
    const next=queue.then(()=>operation(input));
    queue=next.catch(()=>{});
    return next;
  };
  return Object.freeze({publicState,activate:serial(activate),seal:serial(seal)});
}
function inMemorySigner() {
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  return {publicKey:publicKey.export({type:'spki',format:'pem'}).toString(),
    sign:payload=>sign(null,payload,privateKey).toString('base64')};
}
export async function startRecoveryRelay({root,configPath,approvalPath,port=64140}) {
  assert(Number.isSafeInteger(port)&&port>1024&&port<65536);
  const io=createReadOnlyIO(root);
  const {ref:configRef,value:config}=await readPinned(io,configPath);
  const {ref:approvalRef,value:approval}=await readPinned(io,approvalPath);
  assert.equal(config.version,1);assert.equal(config.kind,'fix-nine-rollout-recovery-prelaunch');
  validateLaunchConfiguration({root,config});
  const requesterId=process.env.CODEX_THREAD_ID;requireOwner(requesterId);
  exactApproval(approval,{kind:config.kind,payload:prelaunchPayload(config),reviewerId:config.reviewerId,requesterId});
  reference(config.authorizationRef);await io.authenticate(config.authorizationRef);
  reference(config.launchObservationRef);
  for(const ref of config.protectedRefs) {reference(ref);await io.authenticate(ref);}
  // Only the existing immutable original graph is imported. No continuation
  // adapter/auth imports and no old signer import or old signer startup.
  const original=await import(pathToFileURL(path.join(root,'scripts/fix-nine-rollout-deployment.mjs')).href);
  for(const ref of config.protectedRefs) await io.authenticate(ref);
  const launchObservation=JSON.parse(await io.authenticate(config.launchObservationRef));
  const verifyOwner=createOwnerVerifier({io,launchObservation,authenticateLifecycleStep:original.authenticateLifecycleStep});
  const owner=await verifyOwner(requesterId);
  assert.equal(owner.generation,launchObservation.lifecycle.continuity.generation,'Launch observation must be current');
  const signer=inMemorySigner();
  const metadata={
    version:1,kind:'fix-nine-rollout-recovery-memory-signer',transport:'loopback-http',
    pid:process.pid,startedAt:new Date().toISOString(),endpoint:`http://127.0.0.1:${port}`,
    publicKey:signer.publicKey,launchOwner:owner.owner,launchGeneration:owner.generation,
    prelaunch:configRef,prelaunchApproval:approvalRef,authorization:config.authorizationRef,
    launchObservation:config.launchObservationRef,protectedRefs:config.protectedRefs
  };
  const service=createRecoveryService({io,signer,metadata,protectedRefs:config.protectedRefs,
    verifyOwner,launchObservationRef:config.launchObservationRef,reviewerId:config.reviewerId});
  const server=createServer(async(request,response)=>{
    const reply=(code,value)=>{response.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));};
    try {
      validateHttpRequest(request,port);
      if(request.url==='/public'&&request.method==='GET') {request.resume();reply(200,await service.publicState());return;}
      if(!['/activate','/seal'].includes(request.url)||request.method!=='POST') {request.resume();reply(404,{error:'Unsupported route'});return;}
      let length=0;const chunks=[];
      for await(const chunk of request) {length+=chunk.length;assert(length<=512*1024,'Request exceeds bound');chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result=request.url==='/activate'?await service.activate(input):await service.seal(input);
      reply(200,result);
    } catch(error) {reply(409,{error:String(error.message).slice(0,600)});}
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  server.on('upgrade',(_request,socket)=>socket.destroy());
  server.on('connect',(_request,socket)=>socket.destroy());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,metadata};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [mode,root,configPath,approvalPath,port]=process.argv.slice(2);
  assert.equal(mode,'serve','Only explicit reviewed public-only launch is supported');
  const {metadata}=await startRecoveryRelay({root,configPath,approvalPath,port:port===undefined?64140:Number(port)});
  process.stdout.write(JSON.stringify({metadata,phase:'public-only'})+'\n');
}
