import {createHash} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {validateExoClearanceAudit,exoClearanceReviewBody,validateExoClearanceReview,validateExoClearanceReceipt,validateReview,
  authenticatePrerequisiteBaseline,validateInitialInventory,validatePreservation,inventoryDelta,authenticateAdditions} from '../scripts/fix-nine-rollout-deployment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, appendFile, mkdtemp, mkdir, rm, symlink, readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {PassThrough} from 'node:stream';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {generateKeyPairSync,sign} from 'node:crypto';
import {canonicalHash, expectedVerificationPlan, gateTimeout, gateDirectory, rolloutFeatureId,
  validateVerificationEvidence, validatePassingTransition, validateGateReceipt} from '../scripts/fix-nine-rollout-evidence.mjs';
import {authenticateFile, authenticatePrefix, exclusiveJson, freezeInventory, inventoryAdditions, pinFile, readJson, referencePath, regularPath} from '../scripts/fix-nine-rollout-files.mjs';
import {authenticateBindings, authenticateGateInventory, productionDeployment, requiredHelpers} from '../scripts/fix-nine-rollout-auth.mjs';
import {authenticateGate, beforePath, receiptPath, runGateWorkflow, invokeVerification} from '../scripts/fix-nine-rollout-gate.mjs';
import {runAcceptance} from '../scripts/verify-fix-nine-rollout.mjs';
import {validateNative,validateNativeAuthority,validateNativeReceipt,nativeStages,validateAudit,reviewPayload,validatePreGateHold,validateAttemptPaths,validateTransfer,validateRefreshPlan} from '../scripts/fix-nine-rollout-deployment.mjs';
import {targets as deploymentTargets,directory as deploymentDirectory} from '../scripts/fix-nine-rollout-preflight.mjs';
import {createReviewSigner,reviewedPayloadSeal,startReviewHttpSigner,startReviewSigner,signerSourcePaths} from '../scripts/fix-nine-rollout-signer.mjs';
import {captureSourceReleaseBoundary,authenticateSourceRelease,gateContinuity,releaseState,sourceContinuityArchivePath} from '../scripts/fix-nine-rollout-release.mjs';
import {authenticateExoClearanceWorkflow,authenticateSourceLifecycle,exoClearanceAuditPath,exoClearanceContinuePath,exoClearancePath} from '../scripts/fix-nine-rollout-deployment.mjs';

test('memory signer seals only independently approved exact domain and body', () => {
  const signer=createReviewSigner(), kind='execution-authority', body={authority:'fixture'};
  const approval={version:1,kind,verdict:'CONTINUE',findings:[],reviewerId:'fixture-reviewer',
    reviewedAt:'2026-10-17T22:00:00.000Z',payloadSha256:createHash('sha256').update(reviewPayload(kind,body)).digest('hex')};
  const request={kind,body,approval,requesterId:'fixture-worker'};
  validateReview(signer.seal(request),kind,body,signer.publicKey);
  for(const mutation of [r=>r.body.authority='changed',r=>r.kind='product-audit',r=>r.approval.verdict='HOLD',
    r=>r.approval.findings.push('unresolved'),r=>r.approval.reviewerId=r.requesterId,
    r=>r.approval.payloadSha256='a'.repeat(64)]) {
    const changed=structuredClone(request);mutation(changed);assert.throws(()=>signer.seal(changed));
  }
  assert.deepEqual(Object.keys(signer).sort(),['publicKey','seal']);
});

test('read-only signer emits exact authenticated seals without creating artifacts', async () => {
  const folder=await mkdtemp(path.join(tmpdir(),'rollout-relay-'));
  try {
    const signer=createReviewSigner(),kind='execution-authority',body={authority:'fixture'};
    const approvalPath='.harness/fix-nine-rollout-001/reviews/relay-fixture.json';
    await mkdir(path.join(folder,path.dirname(approvalPath)),{recursive:true});
    await mkdir(path.join(folder,'scripts'));
    await writeFile(path.join(folder,'scripts/fix-nine-rollout-deployment.mjs'),
      `export const reviewPublicKey = ${JSON.stringify(signer.publicKey)};\n`);
    await writeFile(path.join(folder,'body.json'),JSON.stringify(body));
    await writeFile(path.join(folder,approvalPath),JSON.stringify({version:1,kind,verdict:'CONTINUE',findings:[],
      reviewerId:'fixture-reviewer',reviewedAt:'2026-10-17T22:00:00.000Z',
      payloadSha256:createHash('sha256').update(reviewPayload(kind,body)).digest('hex')}));
    const request={mode:'seal',kind,bodyPath:'body.json',approvalRef:await pinFile(folder,approvalPath),requesterId:'fixture-worker'};
    const before=await readdir(folder,{recursive:true});
    validateReview(await reviewedPayloadSeal(signer,request,{projectRoot:folder}),kind,body,signer.publicKey);
    assert.deepEqual(await readdir(folder,{recursive:true}),before);
    await assert.rejects(reviewedPayloadSeal(signer,{...request,outputPath:'seal.json'},{projectRoot:folder}),/output path/);
    await writeFile(path.join(folder,'body.json'),JSON.stringify({authority:'unreviewed'}));
    await assert.rejects(reviewedPayloadSeal(signer,request,{projectRoot:folder}),/exact domain-bound bytes/);
    await writeFile(path.join(folder,'body.json'),JSON.stringify(body));
    await writeFile(path.join(folder,'scripts/fix-nine-rollout-deployment.mjs'),
      `export const reviewPublicKey = ${JSON.stringify(createReviewSigner().publicKey)};\n`);
    await assert.rejects(reviewedPayloadSeal(signer,request,{projectRoot:folder}),/reviewed public anchor/);
  } finally {await rm(folder,{recursive:true,force:true});}
});

const clone = value => structuredClone(value);

async function httpSignerFixture() {
  const folder=await mkdtemp(path.join(tmpdir(),'rollout-http-'));
  for(const name of signerSourcePaths) {
    await mkdir(path.join(folder,path.dirname(name)),{recursive:true});
    await writeFile(path.join(folder,name),await readFile(new URL('../'+name,import.meta.url)));
  }
  const signer=await startReviewHttpSigner({projectRoot:folder,port:0});
  const call=(route='/public',{method='GET',headers={},raw,command}={})=>new Promise((resolve,reject)=>{
    const bytes=raw??(command===undefined?undefined:JSON.stringify(command));
    const request=httpRequest(signer.metadata.endpoint+route,{method,agent:false,headers:{...(bytes===undefined?{}:{'content-type':'application/json'}),...headers}},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,value:JSON.parse(Buffer.concat(chunks))}));
    });request.on('error',reject);request.end(bytes);
  });
  const anchor=async()=>{
    const file=path.join(folder,'scripts/fix-nine-rollout-deployment.mjs');
    await writeFile(file,(await readFile(file,'utf8')).replace(/^export const reviewPublicKey = .*;$/m,
      `export const reviewPublicKey = ${JSON.stringify(signer.metadata.publicKey)};`));
  };
  const body={authority:'fixture'},kind='execution-authority',approvalPath='.harness/fix-nine-rollout-001/reviews/http-fixture.json';
  await mkdir(path.join(folder,path.dirname(approvalPath)),{recursive:true});
  await writeFile(path.join(folder,'body.json'),JSON.stringify(body));
  const approval={version:1,kind,verdict:'CONTINUE',findings:[],reviewerId:'fixture-reviewer',reviewedAt:'2026-10-17T22:00:00.000Z',
    payloadSha256:createHash('sha256').update(reviewPayload(kind,body)).digest('hex')};
  await writeFile(path.join(folder,approvalPath),JSON.stringify(approval));
  const command={mode:'seal',kind,bodyPath:'body.json',approvalRef:await pinFile(folder,approvalPath),requesterId:'fixture-worker'};
  return {folder,signer,call,anchor,body,approval,command,async close(){await signer.close();await rm(folder,{recursive:true,force:true});}};
}

test('HTTP signer reconnects with the same memory key, binds once and writes no artifacts',async()=>{
  const fixture=await httpSignerFixture();
  try {
    const {call,anchor,command,signer,folder,body}=fixture;
    const initial=await call();assert.equal(initial.value.health.anchorBound,false);
    assert.equal((await call('/seal',{method:'POST',command})).status,400);
    await anchor();const bound=await call();assert.equal(bound.value.health.anchorBound,true);
    assert.equal(bound.value.health.sourceUnchanged,true);assert.equal(Object.keys(bound.value.health.sourcePins).length,signerSourcePaths.length);
    const before=await readdir(folder,{recursive:true});
    const first=await call('/seal',{method:'POST',command}),second=await call('/seal',{method:'POST',command});
    assert.equal(first.status,200);assert.deepEqual(second.value,first.value);
    validateReview(first.value.seal,command.kind,body,signer.metadata.publicKey);
    assert.equal((await call()).value.metadata.publicKey,initial.value.metadata.publicKey);
    assert.deepEqual(await readdir(folder,{recursive:true}),before);
  } finally {await fixture.close();}
});

test('HTTP signer rejects transport attacks and retains exact independent approval checks',async()=>{
  const fixture=await httpSignerFixture();
  try {
    const {call,anchor,command,folder,approval}=fixture;await anchor();
    for(const [route,options,status] of [
      ['/public',{headers:{host:'foreign.example'}},403],['/public',{headers:{origin:'http://127.0.0.1'}},403],
      ['/unknown',{},404],['/public?query',{},404],['/public',{method:'POST'},405],['/seal',{},405],
      ['/seal',{method:'POST',raw:'{'},400],['/seal',{method:'POST',raw:'x'.repeat(16385)},413],
      ['/seal',{method:'POST',command:{...command,outputPath:'seal.json'}},400],
      ['/seal',{method:'POST',command:{...command,requesterId:approval.reviewerId}},400],
      ['/seal',{method:'POST',command:{...command,kind:'source-lifecycle-refresh'}},400],
      ['/seal',{method:'POST',command:{...command,bodyPath:'../outside.json'}},400],
      ['/seal',{method:'POST',command:{...command,approvalRef:{...command.approvalRef,path:'body.json'}}},400],
      ['/seal',{method:'POST',command:{...command,approvalRef:{...command.approvalRef,sha256:'a'.repeat(64)}}},400]
    ]) assert.equal((await call(route,options)).status,status,route+JSON.stringify(options));
    for(const change of [{verdict:'HOLD'},{findings:['finding']},{reviewerId:''},{reviewedAt:'invalid'},{payloadSha256:'a'.repeat(64)}]) {
      await writeFile(path.join(folder,command.approvalRef.path),JSON.stringify({...approval,...change}));
      assert.equal((await call('/seal',{method:'POST',command:{...command,approvalRef:await pinFile(folder,command.approvalRef.path)}})).status,400);
    }
    await writeFile(path.join(folder,command.approvalRef.path),JSON.stringify(approval));
    await writeFile(path.join(folder,'body.json'),JSON.stringify({authority:'unreviewed'}));
    assert.equal((await call('/seal',{method:'POST',command})).status,400);
    assert.equal((await call()).value.health.sourceUnchanged,true);
  } finally {await fixture.close();}
});

test('HTTP signer rejects every dependency drift permanently after public anchor binding',async t=>{
  for(const name of signerSourcePaths) await t.test(name,async()=>{
    const fixture=await httpSignerFixture();
    try {
      await fixture.anchor();assert.equal((await fixture.call()).value.health.anchorBound,true);
      const file=path.join(fixture.folder,name),original=await readFile(file);
      await appendFile(file,'\n ');
      assert.equal((await fixture.call('/seal',{method:'POST',command:fixture.command})).status,400);
      assert.equal((await fixture.call()).value.health.sourceUnchanged,false);
      await writeFile(file,original);
      assert.equal((await fixture.call()).value.health.sourceUnchanged,false);
      assert.equal((await fixture.call('/seal',{method:'POST',command:fixture.command})).status,400);
    } finally {await fixture.close();}
  });
});

test('HTTP signer allows only the sole initial key assignment and never rebases drift',async t=>{
  for(const mode of ['wrong-key','extra-edit','duplicate-anchor','dependency-before-bind','startup']) await t.test(mode,async()=>{
    const fixture=await httpSignerFixture();
    try {
      const deployment=path.join(fixture.folder,'scripts/fix-nine-rollout-deployment.mjs');
      if(mode==='wrong-key') await writeFile(deployment,(await readFile(deployment,'utf8')).replace(/^export const reviewPublicKey = .*;$/m,
        `export const reviewPublicKey = ${JSON.stringify(createReviewSigner().publicKey)};`));
      else if(mode==='dependency-before-bind'||mode==='startup') await appendFile(path.join(fixture.folder,signerSourcePaths[2]),'\n ');
      else {await fixture.anchor();await appendFile(deployment,mode==='duplicate-anchor'?'\nexport const reviewPublicKey = "duplicate";\n':'\n ');}
      if(mode==='startup') await assert.rejects(startReviewHttpSigner({projectRoot:fixture.folder,port:0}),/loaded graph/);
      assert.equal((await fixture.call()).value.health.sourceUnchanged,false);
      await fixture.anchor();
      assert.equal((await fixture.call()).value.health.sourceUnchanged,false);
      assert.equal((await fixture.call('/seal',{method:'POST',command:fixture.command})).status,400);
    } finally {await fixture.close();}
  });
});
const pin = path => ({path, bytes:0, sha256:'a'.repeat(64)});
const root = new URL('../', import.meta.url);

async function prerequisiteInventoryFixture(t) {
  const directory=await mkdtemp(path.join(tmpdir(),'rollout-prerequisite-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const state=JSON.parse(await readFile(new URL('.harness/features.json',root)));
  const feature=clone(state.features.find(row=>row.id==='source-historical-budget-compat-002'));
  const candidate=JSON.parse(await readFile(new URL('.harness/fix-nine-rollout-001/source-closure-candidate.json',root)));
  const ref=Object.fromEntries(['path','sha256','bytes'].map(key=>[key,feature.scopeBaselineRef[key]]));
  for(const file of [ref.path,candidate.prerequisite.evidence.path]) {
    await mkdir(path.dirname(path.join(directory,file)),{recursive:true});
    await writeFile(path.join(directory,file),await readFile(new URL(file,root)));
  }
  const save=()=>writeFile(path.join(directory,'.harness/features.json'),JSON.stringify({features:[feature]}));
  await save();
  const io={json:file=>readJson(directory,file),authenticate:pin=>authenticateFile(directory,pin)};
  const original={version:1,root:directory,files:[]},fresh={...original,files:[ref]};
  const target={index:0,root:directory,initialDelta:inventoryDelta(original.files,fresh.files),inventoryAdmission:{pins:new Map(),contexts:new Map(),prerequisiteArtifacts:new Map()}};
  return {directory,feature,candidate,ref,save,io,original,fresh,target};
}

test('prepare and authority replay admit only the accepted prerequisite baseline with its immutable provenance',async t=>{
  const f=await prerequisiteInventoryFixture(t);
  assert.deepEqual(await authenticatePrerequisiteBaseline(f.candidate,f.io),f.ref);
  await validateInitialInventory(f.target,f.original,f.fresh,f.candidate,f.io);
  const orphan={path:'.harness/baselines/orphan.json',sha256:'a'.repeat(64),bytes:1};
  const fresh={...f.fresh,files:[f.ref,orphan]},target={...f.target,initialDelta:inventoryDelta([],fresh.files)};
  await assert.rejects(()=>validateInitialInventory(target,f.original,fresh,f.candidate,f.io),/Unauthorized original inventory delta/);
  await assert.rejects(()=>validateInitialInventory({...f.target,index:1},f.original,f.fresh,f.candidate,f.io));
  const replaced={...f.original,files:[{...f.ref,sha256:'b'.repeat(64)}]};
  await assert.rejects(()=>validateInitialInventory({...f.target,initialDelta:inventoryDelta(replaced.files,f.fresh.files)},replaced,f.fresh,f.candidate,f.io));
  await assert.rejects(()=>authenticateAdditions({files:[]},{additions:[]},{additions:[f.ref]},f.io));
});

test('accepted prerequisite baseline admission rejects orphaned state, contract drift and evidence drift',async t=>{
  const f=await prerequisiteInventoryFixture(t),accepted=clone(f.feature);
  for(const mutate of [
    feature=>{feature.status='active';},
    feature=>{feature.attempts=2;},
    feature=>{feature.evidence=[];},
    feature=>{feature.scopeBaselineRef.path='.harness/baselines/orphan.json';},
    feature=>{feature.scopeBaselineRef.sha256='b'.repeat(64);},
    feature=>{feature.contract.snapshot.title+=' drift';},
    feature=>{feature.title+=' drift';},
  ]) {
    Object.assign(f.feature,clone(accepted));mutate(f.feature);await f.save();
    await assert.rejects(()=>validateInitialInventory(f.target,f.original,f.fresh,f.candidate,f.io));
  }
  Object.assign(f.feature,accepted);await f.save();
  await writeFile(path.join(f.directory,'.harness/features.json'),JSON.stringify({features:[]}));
  await assert.rejects(()=>validateInitialInventory(f.target,f.original,f.fresh,f.candidate,f.io));
  await writeFile(path.join(f.directory,'.harness/features.json'),JSON.stringify({features:[accepted,accepted]}));
  await assert.rejects(()=>validateInitialInventory(f.target,f.original,f.fresh,f.candidate,f.io));
  await f.save();
  const wrongPin=clone(f.candidate);wrongPin.prerequisite.evidence.sha256='b'.repeat(64);
  await assert.rejects(()=>validateInitialInventory(f.target,f.original,f.fresh,wrongPin,f.io));
  const wrongBridge=clone(f.candidate);wrongBridge.prerequisite.contractHash='b'.repeat(64);
  await assert.rejects(()=>validateInitialInventory(f.target,f.original,f.fresh,wrongBridge,f.io));
  const evidence=await readJson(f.directory,f.candidate.prerequisite.evidence.path);
  evidence.repository.before.head='b'.repeat(40);
  await writeFile(path.join(f.directory,f.candidate.prerequisite.evidence.path),JSON.stringify(evidence));
  const resignedPin=clone(f.candidate);
  resignedPin.prerequisite.evidence=await pinFile(f.directory,f.candidate.prerequisite.evidence.path);
  await assert.rejects(()=>validateInitialInventory(f.target,f.original,f.fresh,resignedPin,f.io));
});

async function prerequisiteArtifactFixture(t) {
  const f=await prerequisiteInventoryFixture(t);
  const admission=await loadInventoryAdmission(undefined,{authenticate:ref=>authenticateFile(process.cwd(),ref),prefix:ref=>authenticatePrefix(process.cwd(),ref)});
  const artifacts=[...admission.prerequisiteArtifacts.values()];
  for(const ref of artifacts) {
    await mkdir(path.dirname(path.join(f.directory,ref.path)),{recursive:true});
    await writeFile(path.join(f.directory,ref.path),await readFile(new URL(ref.path,root)));
  }
  f.target.inventoryAdmission=admission;f.fresh.files.push(...artifacts);
  f.target.initialDelta=inventoryDelta(f.original.files,f.fresh.files);
  return {...f,artifacts,admission};
}

test('initial inventory admits exactly eight authenticated prerequisite artifacts as a distinct class',async t=>{
  const f=await prerequisiteArtifactFixture(t);
  await validateInitialInventory(f.target,f.original,f.fresh,f.candidate,f.io);
  await authenticatePrerequisiteInventory(f.fresh,f.admission,f.io);
  for(const ref of f.artifacts) {
    assert.equal(f.admission.pins.has(ref.path),false);
    assert.equal(await authenticatePrerequisiteArtifact(f.directory,ref,f.admission),true);
    await assert.rejects(()=>authenticateObservedAddition(f.directory,ref,f.admission),/Unreviewed/);
    await assert.rejects(()=>authenticateAdditions({files:[]},{additions:[]},{additions:[ref]},f.io));
    const collided={...f.admission,pins:new Map([...f.admission.pins,[ref.path,ref]])};
    await assert.rejects(()=>authenticatePrerequisiteInventory(f.fresh,collided,f.io),/class collision/);
  }
  assert.equal(await authenticatePrerequisiteArtifact(f.directory,f.ref,f.admission),false);
  await assert.rejects(()=>validateInitialInventory({...f.target,index:1},f.original,f.fresh,f.candidate,f.io));
  const ninth={...f.artifacts[0],path:'.harness/source-historical-budget-compat-002/ninth.log'};
  await writeFile(path.join(f.directory,ninth.path),await readFile(path.join(f.directory,f.artifacts[0].path)));
  const fresh={...f.fresh,files:[...f.fresh.files,ninth]};
  await assert.rejects(()=>validateInitialInventory({...f.target,initialDelta:inventoryDelta([],fresh.files)},f.original,fresh,f.candidate,f.io),/Unauthorized original inventory delta/);
  assert.equal(await authenticatePrerequisiteArtifact(f.directory,{...ninth,path:'.harness/source-historical-budget-compat-002/../ninth.log'},f.admission),false);
});

test('every prerequisite artifact rejects tampering, removal, wrong refs and replacement of prior bytes',async t=>{
  const f=await prerequisiteArtifactFixture(t);
  for(const ref of f.artifacts) {
    const file=path.join(f.directory,ref.path),raw=await readFile(file);
    await appendFile(file,'changed');
    await assert.rejects(()=>validateInitialInventory(f.target,f.original,f.fresh,f.candidate,f.io));
    await assert.rejects(()=>authenticatePrerequisiteArtifact(f.directory,ref,f.admission));
    await writeFile(file,raw);await rm(file);
    await assert.rejects(()=>validateInitialInventory(f.target,f.original,f.fresh,f.candidate,f.io));
    await writeFile(file,raw);
    const omitted={...f.fresh,files:f.fresh.files.filter(row=>row.path!==ref.path)};
    await assert.rejects(()=>validateInitialInventory({...f.target,initialDelta:inventoryDelta([],omitted.files)},f.original,omitted,f.candidate,f.io),/disappeared/);
    for(const wrong of [{...ref,sha256:'f'.repeat(64)},{...ref,bytes:ref.bytes+1}]) {
      const changed={...f.fresh,files:f.fresh.files.map(row=>row.path===ref.path?wrong:row)};
      await assert.rejects(()=>validateInitialInventory({...f.target,initialDelta:inventoryDelta([],changed.files)},f.original,changed,f.candidate,f.io));
      await assert.rejects(()=>authenticatePrerequisiteArtifact(f.directory,wrong,f.admission));
    }
    const prior={...f.original,files:[{...ref,sha256:'e'.repeat(64)}]};
    await assert.rejects(()=>validateInitialInventory({...f.target,initialDelta:inventoryDelta(prior.files,f.fresh.files)},prior,f.fresh,f.candidate,f.io),/Unauthorized original inventory delta/);
  }
  await writeFile(path.join(f.directory,'.harness/config.json'),JSON.stringify({policies:{maxAttempts:5,maxRepeatedFailures:2}}));
  const manifest={...f.fresh,files:f.fresh.files.filter(row=>row.path!==f.artifacts[0].path)};
  await assert.rejects(()=>validatePreservation({...f.target,surfaces:[]},{historicalFeatures:[]},manifest,{operations:[]}),/disappeared/);
});

test('accepted prerequisite baseline admission authenticates baseline bytes before inventory admission',async t=>{
  const f=await prerequisiteInventoryFixture(t);
  await appendFile(path.join(f.directory,f.ref.path),' ');
  await assert.rejects(()=>validateInitialInventory(f.target,f.original,f.fresh,f.candidate,f.io));
});

test('Exo preservation retains the actual nested historical budget and the effective five-attempt limit',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'rollout-exo-budget-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(path.join(directory,'.harness'));
  const config={policies:{maxAttempts:5,maxRepeatedFailures:2}};
  const feature={id:'exo-normal-text-flip',attempts:4,verificationBudget:{maxAttempts:23},contract:{snapshot:{verificationBudget:{maxAttempts:23}}}};
  const accepted=clone(feature),state={features:[feature]},target={index:4,root:directory,lifecycle:{features:state},surfaces:[]};
  const check=async()=>{
    await writeFile(path.join(directory,'.harness/features.json'),JSON.stringify(state));
    await writeFile(path.join(directory,'.harness/config.json'),JSON.stringify(config));
    const files=await Promise.all(['.harness/config.json','.harness/features.json'].map(file=>pinFile(directory,file)));
    return validatePreservation(target,{historicalFeatures:[]},{files},{operations:[]});
  };
  await check();
  for(const mutate of [
    value=>{value.attempts=3;},
    value=>{value.verificationBudget.maxAttempts=5;},
    value=>{value.contract.snapshot.verificationBudget.maxAttempts=5;},
    value=>{delete value.verificationBudget;value.maxAttempts=23;},
    value=>{value.id='unrelated';},
  ]) {
    state.features=[clone(accepted)];mutate(state.features[0]);await assert.rejects(check);
  }
  state.features=[clone(accepted)];config.policies.maxAttempts=23;await assert.rejects(check);
  config.policies.maxAttempts=5;config.policies.maxRepeatedFailures=3;await assert.rejects(check);
});

function transferFixture(ownerFeatureId=rolloutFeatureId) {
  const feature={id:rolloutFeatureId,attempts:0,evidence:[]};
  const oldOwner={id:'fixture-worker-old',source:'CODEX_THREAD_ID',parentSessionId:null,generation:7,claimedAt:'2026-10-17T20:00:00.000Z',featureId:ownerFeatureId};
  const before={features:{version:1,revision:12,features:[feature]},continuity:{phase:'working',generation:7,owner:oldOwner,handoff:null,lastHandoff:null,retiredWorkerIds:[]}};
  const packet={id:'fixture-handoff',kind:'handoff',selectedFeatureId:rolloutFeatureId,featureRevision:12,owner:clone(oldOwner),
    activeFeatures:[{id:'ignored-active-feature'}],resumedAt:'2026-10-17T20:00:02.000Z',drift:[],driftAccepted:false};
  const after=clone(before);
  after.continuity={...after.continuity,generation:8,lastHandoff:packet,retiredWorkerIds:[oldOwner.id],
    owner:{id:'fixture-worker-new',source:'CODEX_THREAD_ID',parentSessionId:null,generation:8,claimedAt:packet.resumedAt,featureId:ownerFeatureId??rolloutFeatureId}};
  const proof={packet:clone(packet),driftDisposition:'none',events:[
    {type:'handoff.ready',handoffId:packet.id,generation:7,revision:12,at:'2026-10-17T20:00:01.000Z'},
    {type:'worker.resumed',handoffId:packet.id,generation:8,at:'2026-10-17T20:00:03.000Z',drift:[],driftAccepted:false}]};
  return {before,after,proof};
}

test('source transfer accepts exact native resumed owner and feature fallback precedence',()=>{
  for(const featureId of [rolloutFeatureId,'retained-owner-feature',null]) {
    const f=transferFixture(featureId);validateTransfer(f.before,f.after,f.proof);
  }
  const f=transferFixture(null);delete f.before.continuity.owner.featureId;delete f.after.continuity.lastHandoff.owner.featureId;delete f.proof.packet.owner.featureId;
  f.after.continuity.owner.parentSessionId='fixture-parent-session';validateTransfer(f.before,f.after,f.proof);
});

for(const [name,mutate] of [
  ['wrong generation',f=>f.after.continuity.owner.generation=7],
  ['missing generation',f=>delete f.after.continuity.owner.generation],
  ['noninteger generation',f=>f.after.continuity.owner.generation='8'],
  ['missing native source',f=>delete f.after.continuity.owner.source],
  ['explicit attestation source',f=>f.after.continuity.owner.source='explicit-attestation'],
  ['malformed worker id',f=>f.after.continuity.owner.id='worker with spaces'],
  ['missing parent session',f=>delete f.after.continuity.owner.parentSessionId],
  ['malformed parent session',f=>f.after.continuity.owner.parentSessionId={}],
  ['extra owner field',f=>f.after.continuity.owner.extra=true],
  ['selected feature replacing retained owner feature',f=>f.after.continuity.owner.featureId=rolloutFeatureId],
  ['missing feature binding',f=>delete f.after.continuity.owner.featureId]
]) test(`source transfer rejects ${name}`,()=>{
  const f=transferFixture('retained-owner-feature');mutate(f);assert.throws(()=>validateTransfer(f.before,f.after,f.proof));
});

test('source refresh accepts only an explicitly unblocked exact plan',()=>{
  const refresh={planHash:'fixture-plan-hash'},plan={planHash:refresh.planHash,target:deploymentTargets[0],blocked:false};
  validateRefreshPlan(plan,refresh);
  for(const blocked of [true,undefined,null,0,'false']) assert.throws(()=>validateRefreshPlan({...plan,blocked},refresh));
  const missing=clone(plan);delete missing.blocked;assert.throws(()=>validateRefreshPlan(missing,refresh));
  assert.throws(()=>validateRefreshPlan({...plan,planHash:'other'},refresh));
  assert.throws(()=>validateRefreshPlan({...plan,target:deploymentTargets[1]},refresh));
});

function nativeFixture(roots=deploymentTargets) {
  const raw=(index,event,after=false)=>({source:'project',sourcePath:path.join(roots[index],'.codex/hooks.json'),
    key:`CaseSensitive-${index}-${event}`,eventName:`event-${event}`,enabled:true,displayOrder:event,
    currentHash:`sha256:${(after?'b':'a').repeat(64)}`,trustStatus:'trusted',command:{command:after?'reviewed new command':'retained command',timeoutMs:1000},retainedMetadata:{mode:'exact'}});
  const definition=(index,h)=>({root:roots[index],key:h.key,currentHash:h.currentHash,trustStatus:h.trustStatus,
    eventName:h.eventName,sourcePath:h.sourcePath,enabled:h.enabled,displayOrder:h.displayOrder,definitionSha256:canonicalHash(h),commandSha256:canonicalHash(h.command)});
  const transitions=roots.flatMap((root,index)=>Array.from({length:6},(_,event)=>{
    const beforeRaw=raw(index,event),afterRaw=raw(index,event,true);
    return {index,root,key:beforeRaw.key,eventName:beforeRaw.eventName,before:beforeRaw.currentHash,after:afterRaw.currentHash,
      beforeRaw,afterRaw,beforeDefinition:definition(index,beforeRaw),afterDefinition:definition(index,afterRaw)};
  }));
  const state=Object.fromEntries(transitions.map(t=>[t.key,{trusted_hash:t.before,retained:'exact'}]));
  for(let i=0;i<18;i++) state[`Unrelated-${i}`]={trusted_hash:`sha256:${'c'.repeat(64)}`,retained:'exact'};
  const config={hooks:{state},unrelated:{retained:true}};
  const baseline={version:'raw-version-0',raw:{path:'C:\\fixture\\config.toml',bytes:1234,sha256:'d'.repeat(64)},
    semanticSha256:canonicalHash(config),unrelatedSha256:'e'.repeat(64),trust:Object.fromEntries(Object.entries(state).map(([k,v])=>[k,v.trusted_hash])),
    definitions:transitions.map(t=>t.beforeDefinition)};
  const authority={nativeBaseline:baseline,nativeTransitions:transitions,nativeTrustRows:clone(state),nativeStages:nativeStages(config,transitions)};
  const before=clone(baseline),observed=clone(before),after=clone(before),newState=clone(state);
  for(const t of transitions.filter(t=>t.index===0)) {
    const h={...t.afterRaw,trustStatus:'modified'};
    observed.definitions[observed.definitions.findIndex(d=>d.key===t.key)]=definition(0,h);
    after.definitions[after.definitions.findIndex(d=>d.key===t.key)]=t.afterDefinition;
    after.trust[t.key]=t.after;newState[t.key].trusted_hash=t.after;
  }
  after.version='raw-version-1';after.raw={...after.raw,bytes:1250,sha256:'f'.repeat(64)};
  after.semanticSha256=authority.nativeStages[1].semanticSha256;
  const receipt={before,observed,after,confirmed:true,method:'config/batchWrite',writeCount:1,
    request:{filePath:before.raw.path,expectedVersion:before.version,reloadUserConfig:true,edits:[{keyPath:'hooks.state',mergeStrategy:'replace',value:newState}]},
    expectedSemanticSha256:after.semanticSha256,response:{confirmed:true},responseError:null};
  return {authority,receipt};
}

test('deployment authority retains all 66 full native definitions, 84 case-sensitive mappings and 18 unrelated rows',()=>{
  const f=nativeFixture();validateNativeAuthority(f.authority);validateNativeReceipt(f.receipt,f.authority,0);
});

for(const [name,mutate] of [
  ['missing native definition',f=>f.authority.nativeTransitions.pop()],
  ['changed full definition metadata',f=>f.authority.nativeTransitions[0].afterRaw.retainedMetadata.mode='changed'],
  ['case-folded trust mapping',f=>{const rows=f.authority.nativeTrustRows;rows['casesensitive-0-0']=rows['CaseSensitive-0-0'];delete rows['CaseSensitive-0-0'];}],
  ['changed retained unrelated trust',f=>f.authority.nativeTrustRows['Unrelated-0'].trusted_hash='changed'],
  ['reordered native stages',f=>f.authority.nativeStages.reverse()],
]) test(`deployment authority rejects ${name}`,()=>{const f=nativeFixture();mutate(f);assert.throws(()=>validateNativeAuthority(f.authority));});

for(const [name,mutate] of [
  ['initial raw native version drift',f=>f.receipt.before.version='unreviewed'],
  ['initial raw native byte drift',f=>f.receipt.before.raw.sha256='0'.repeat(64)],
  ['unrelated mapping mutation',f=>f.receipt.after.trust['Unrelated-0']='changed'],
  ['CAS version bypass',f=>f.receipt.request.expectedVersion='stale'],
  ['CAS extra operation',f=>f.receipt.request.edits.push(clone(f.receipt.request.edits[0]))],
  ['CAS partial trust replacement',f=>delete f.receipt.request.edits[0].value['Unrelated-0']],
  ['CAS retained field mutation',f=>f.receipt.request.edits[0].value['Unrelated-0'].retained='changed'],
  ['wrong whole-config readback',f=>f.receipt.expectedSemanticSha256='0'.repeat(64)],
  ['changed discovered full definition',f=>f.receipt.observed.definitions[0].definitionSha256='0'.repeat(64)],
  ['duplicate after definition',f=>f.receipt.after.definitions[1]=clone(f.receipt.after.definitions[0])],
  ['duplicate observed definition',f=>f.receipt.observed.definitions[1]=clone(f.receipt.observed.definitions[0])],
  ['unconfirmed native outcome',f=>f.receipt.confirmed=false],
  ['automatic native replay',f=>f.receipt.writeCount=2],
]) test(`deployment receipt rejects ${name}`,()=>{const f=nativeFixture();mutate(f);assert.throws(()=>validateNativeReceipt(f.receipt,f.authority,0));});

test('native RPC error is accepted only with the complete confirmed CAS readback',()=>{
  const f=nativeFixture();f.receipt.response=null;f.receipt.responseError={code:'transport',message:'outcome initially unknown'};
  validateNativeReceipt(f.receipt,f.authority,0);
  f.receipt.after.trust['CaseSensitive-0-0']=f.receipt.before.trust['CaseSensitive-0-0'];
  assert.throws(()=>validateNativeReceipt(f.receipt,f.authority,0));
});

async function deploymentAuditFixture(t,relocateSource=false) {
  const root=await mkdtemp(path.join(tmpdir(),'rollout-adapter-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const folder=`${deploymentDirectory}/execution`;await mkdir(path.join(root,folder),{recursive:true});
  const io={pin:file=>pinFile(root,file),authenticate:ref=>authenticateFile(root,ref),prefix:ref=>authenticatePrefix(root,ref)};
  const put=async(file,value)=>{await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),typeof value==='string'?value:JSON.stringify(value));return io.pin(file);};
  const roots=relocateSource?[root,...deploymentTargets.slice(1)]:deploymentTargets;
  const native=nativeFixture(roots),keys=generateKeyPairSync('ed25519');
  const authority={ref:pin(`${deploymentDirectory}/authority.json`),closure:pin(`${deploymentDirectory}/source-closure.json`),value:native.authority,references:[]};
  const startedAt='2026-10-17T20:00:00.000Z',finishedAt='2026-10-17T20:00:01.000Z';
  const reservation={version:1,kind:'fix-nine-rollout-reserved',authority:authority.ref,sourceClosure:authority.closure,index:0,root:deploymentTargets[0],
    plan:pin(`${folder}/target-00-plan.json`),expectedPlanHash:'a'.repeat(64),actor:'executor',startedAt,refreshes:[]};
  const transfer=transferFixture(),events=await put('.harness/events.jsonl','{"retained":true}\n');
  const oldLifecycle={...transfer.before,refs:[events]};
  authority.value.targets=deploymentTargets.map((root,index)=>({index,root}));
  Object.assign(authority.value.targets[0],{lifecycle:oldLifecycle,plan:reservation.plan,planHash:reservation.expectedPlanHash,
    preservation:await put(`${folder}/preservation.json`,{files:[]})});
  const applied={...clone(reservation),kind:'fix-nine-rollout-applied',confirmed:true,finishedAt,native:native.receipt};
  const commands=[];
  for(const [i,args] of [['doctor'],['bootstrap','--validate','--json']].entries()) {
    const name=i===0?'doctor':'bootstrap',prefix=`${folder}/target-00-startup-${name}`;
    const stdout=i===0?`Harness doctor: ${deploymentTargets[0]} (runtime v6, schema v1)\n`:JSON.stringify({validation:{healthy:true}});
    commands.push({executable:process.execPath,args:['.harness/run.mjs',...args],cwd:deploymentTargets[0],
      startedAt:`2026-10-17T20:00:0${i+2}.000Z`,finishedAt:`2026-10-17T20:00:0${i+3}.000Z`,
      outcome:{confirmed:true,exitCode:0,signal:null,timedOut:false,error:null},
      logs:{stdout:await put(`${prefix}.stdout.log`,stdout),stderr:await put(`${prefix}.stderr.log`,'')}});
  }
  const audited={version:1,kind:'fix-nine-rollout-product-audit',index:0,root:deploymentTargets[0],actor:'independent-auditor',
    at:'2026-10-17T20:00:05.000Z',pass:true,structural:{overall:100,criticalFailures:[]},startup:{healthy:true,commands},native:clone(native.receipt.after),sourceRefreshes:[]};
  const row={index:0,root:deploymentTargets[0]};
  async function persist() {
    applied.reservation=await put(`${folder}/target-00-reservation.json`,reservation);
    row.apply=await put(`${folder}/target-00-apply.json`,applied);audited.apply=row.apply;
    row.audit=await put(`${folder}/target-00-audit.json`,audited);
    const body={authority:authority.ref,sourceClosure:authority.closure,apply:row.apply,audit:row.audit,actor:audited.actor,index:0,root:row.root,scope:'same-target-after-deployment',verdict:'CONTINUE'};
    row.continue=await put(`${folder}/target-00-continue.json`,{version:1,kind:'product-audit',verdict:'CONTINUE',body,signature:sign(null,reviewPayload('product-audit',body),keys.privateKey).toString('base64')});
  }
  async function refresh(mutate=()=>{}) {
    const after=clone(transfer.after),proof=clone(transfer.proof);
    await appendFile(path.join(root,'.harness/events.jsonl'),proof.events.map(e=>JSON.stringify(e)).join('\n')+'\n');
    proof.archive=await put(`.harness/history/progress/${proof.packet.id}.md`,'retained transfer archive');
    const lifecycle={...after,refs:[await io.pin('.harness/events.jsonl')],additions:[proof.archive]};
    const plan={target:authority.value.targets[0].root,planHash:'b'.repeat(64),blocked:false,operations:[]};
    const value={version:1,kind:'fix-nine-rollout-source-lifecycle-refresh',index:0,root:plan.target,authority:authority.ref,sourceClosure:authority.closure,
      previous:authority.ref,oldLifecycle:oldLifecycle.refs,lifecycle,transfer:proof,plan:await put(`${folder}/refresh-plan.json`,plan),planHash:plan.planHash};
    await mutate(value,plan);
    value.plan=await put(`${folder}/refresh-plan.json`,plan);
    const refresh=await put(`${folder}/refresh.json`,value),body={refresh,authority:authority.ref,sourceClosure:authority.closure,scope:'source-lifecycle-and-exact-plan-only'};
    const review=await put(`${folder}/refresh-review.json`,{version:1,kind:'source-lifecycle-refresh',verdict:'CONTINUE',body,
      signature:sign(null,reviewPayload('source-lifecycle-refresh',body),keys.privateKey).toString('base64')});
    return {refresh,review};
  }
  await persist();return {root,io,authority,reservation,applied,audited,row,put,persist,refresh,keys,check:()=>validateAudit(io,authority,row,[],keys.publicKey)};
}

// Isolate only external authority/native adapters. The audit, ownership,
// signed transfer, physical lifecycle, preservation and startup code is the
// production module, loaded from an independently named fixture file.
async function auditOperationFixture(t) {
  const f=await deploymentAuditFixture(t,true),target=f.authority.value.targets[0],before=target.lifecycle;
  target.root=f.root;f.reservation.root=f.applied.root=f.audited.root=f.row.root=f.root;
  f.reservation.actor=f.applied.actor=before.continuity.owner.id;
  for(const command of f.audited.startup.commands) command.cwd=f.root;
  await f.put('.harness/config.json',{policies:{maxAttempts:5,maxRepeatedFailures:2}});
  await f.put('.harness/features.json',before.features);await f.put('.harness/continuity.json',before.continuity);
  await f.put('.harness/progress.md','fixture progress');await f.put('.harness/handoff.md','fixture handoff');
  await f.put('.harness/run.mjs',"console.log(process.argv[2]==='doctor'?'Harness doctor: '+process.cwd()+' (runtime v6, schema v1)':JSON.stringify({validation:{healthy:true}}));");
  const managed=await f.put('.harness/managed.txt','before'),removed=await f.put('.harness/removed.txt','remove');
  const files=await Promise.all((await readdir(path.join(f.root,'.harness'))).filter(name=>name!=='fix-nine-rollout-001').map(name=>f.io.pin(`.harness/${name}`)));
  target.preservation=await f.put(`${deploymentDirectory}/execution/preservation.json`,{files});
  const installed=await f.put(managed.path,'installed');await rm(path.join(f.root,removed.path));
  const plan={target:f.root,planHash:f.applied.expectedPlanHash,blocked:false,operations:[
    {path:managed.path,action:'write',beforeHash:managed.sha256,afterHash:installed.sha256},{path:removed.path,action:'remove'}]};
  target.plan=f.reservation.plan=f.applied.plan=await f.put(`${deploymentDirectory}/execution/target-00-plan.json`,plan);
  target.surfaces=[];f.authority.inputs={initial:{value:{targets:[{historicalFeatures:[]}]}},source:{value:{}}};
  await f.persist();
  for(const ref of [f.row.audit,f.row.continue,...f.audited.startup.commands.flatMap(command=>[command.logs.stdout,command.logs.stderr])]) {
    await rm(path.join(f.root,ref.path));
  }
  const key=`auditFixture${Math.random().toString(16).slice(2)}`;
  const adapter={root:f.root,authority:f.authority,native:{summary:f.applied.native.after},connects:0};
  globalThis[key]=adapter;t.after(()=>delete globalThis[key]);
  let source=await readFile(new URL('../scripts/fix-nine-rollout-deployment.mjs',import.meta.url),'utf8');
  const replace=(from,to)=>{assert.equal(source.split(from).length,2,`Fixture adapter boundary changed: ${from}`);source=source.replace(from,to);};
  source=source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_,quote,relative)=>`from ${quote}${new URL(relative,new URL('../scripts/fix-nine-rollout-deployment.mjs',import.meta.url)).href}${quote}`);
  replace('import {sourceRoot, targets, directory, featureId}', 'import {targets as originalTargets, directory, featureId}');
  replace('import {planSync, syncHarness, auditHarness}', 'import {planSync, syncHarness, auditHarness as originalAuditHarness}');
  replace('import {connectNativeHookClient}', 'import {connectNativeHookClient as originalConnectNativeHookClient}');
  replace('import {requiredHelpers, authenticateGateInventory}', 'import {requiredHelpers, authenticateGateInventory as originalAuthenticateGateInventory}');
  replace('async function loadAuthority(', 'async function originalLoadAuthority(');
  replace('async function nativeRead(', 'async function originalNativeRead(');
  replace('async function authenticateRecovery(', 'async function originalAuthenticateRecovery(');
  const fixturePublicKey=f.keys.publicKey.export({type:'spki',format:'pem'}).toString();
  source=source.replace(/export const reviewPublicKey = [^;]+;/,`export const reviewPublicKey = ${JSON.stringify(fixturePublicKey)};`);
  source+=`\nconst fixture=globalThis[${JSON.stringify(key)}],sourceRoot=fixture.root,targets=[sourceRoot,...originalTargets.slice(1)];\nasync function loadAuthority(){return fixture.authority;}\nasync function nativeRead(){return fixture.native;}\nasync function authenticateRecovery(){}\nconst auditHarness=async()=>({overall:100,criticalFailures:[]});\nconst authenticateGateInventory=async(root,sourceRelease)=>{fixture.sourceRelease=sourceRelease;return [];};\nconst connectNativeHookClient=async()=>{fixture.connects++;return {close:async()=>{}};};\n`;
  const moduleFile=path.join(f.root,'audit-fixture.mjs');await writeFile(moduleFile,source);
  f.module=await import(pathToFileURL(moduleFile));f.adapter=adapter;f.managed=managed;f.installed=installed;f.removed=removed;
  f.enter=async()=>{const item=await f.refresh(),value=await readJson(f.root,item.refresh.path);
    await f.put('.harness/features.json',value.lifecycle.features);await f.put('.harness/continuity.json',value.lifecycle.continuity);
    f.chain=[item];f.newOwner=value.lifecycle.continuity.owner.id;return value;};
  f.audit=async()=>{
    const result=await withFixtureActor(f.newOwner,()=>f.module.auditTarget(0,f.chain));f.row.audit=result.audit;
    f.row.continue=await f.put(`${deploymentDirectory}/execution/target-00-continue.json`,{version:1,kind:'product-audit',verdict:'CONTINUE',body:result.reviewBody,
      signature:sign(null,reviewPayload('product-audit',result.reviewBody),f.keys.privateKey).toString('base64')});
    return result;
  };
  return f;
}

async function withFixtureActor(actor,work) {
  const previous=process.env.CODEX_THREAD_ID;
  if(actor===undefined) delete process.env.CODEX_THREAD_ID;else process.env.CODEX_THREAD_ID=actor;
  try{return await work();}finally{if(previous===undefined) delete process.env.CODEX_THREAD_ID;else process.env.CODEX_THREAD_ID=previous;}
}

test('owned independent audit follows authenticated handoff while preserving original installed write and remove plan',async t=>{
  const f=await auditOperationFixture(t);await f.enter();
  const result=await withFixtureActor(f.newOwner,()=>f.module.auditTarget(0,f.chain));
  const audited=await readJson(f.root,result.audit.path);assert.deepEqual(audited.sourceRefreshes,f.chain);assert.equal(audited.actor,f.newOwner);
  assert.equal(f.adapter.connects,1);assert.equal((await f.io.pin(f.managed.path)).sha256,f.installed.sha256);
  await assert.rejects(f.io.pin(f.removed.path),{code:'ENOENT'});
});
test('owned independent audit accepts explicit empty chain only with unchanged source lifecycle',async t=>{
  const f=await auditOperationFixture(t);f.applied.actor=f.reservation.actor='different-executor';await f.persist();
  for(const ref of [f.row.audit,f.row.continue]) await rm(path.join(f.root,ref.path));
  const actor=f.authority.value.targets[0].lifecycle.continuity.owner.id;
  const result=await withFixtureActor(actor,()=>f.module.auditTarget(0,[]));
  assert.deepEqual((await readJson(f.root,result.audit.path)).sourceRefreshes,[]);
});
test('owned non-source audit rejects unrepresented source transfer before artifact writes',async t=>{
  const f=await auditOperationFixture(t);await f.enter();
  const target=f.authority.value.targets[1];target.plan=f.applied.plan;target.planHash=f.applied.expectedPlanHash;
  await f.put(`${deploymentDirectory}/execution/target-01-apply.json`,{...f.applied,index:1,root:target.root});
  const before=await readdir(f.root,{recursive:true});
  await withFixtureActor(f.newOwner,()=>assert.rejects(f.module.auditTarget(1,[]),error=>error.stack.includes('validateLifecycle')));
  assert.deepEqual(await readdir(f.root,{recursive:true}),before);assert.equal(f.adapter.connects,0);
});
for(const mode of ['execution','final-audit','report']) test(`owned ${mode} rejects source chain omitting prior signed audit extension`,async t=>{
  const f=await auditOperationFixture(t);await f.enter();await f.audit();
  let run,sourceRelease;
  if(mode==='execution') run=()=>f.module.executeTarget(1,[]);
  else if(mode==='final-audit') run=()=>f.module.prepareFinalAudit([]);
  else {
    const rows=f.authority.value.targets.map(({index,root})=>index===0?f.row:{index,root});
    for(let index=1;index<11;index++) for(const kind of ['reservation','apply']) await f.put(`${deploymentDirectory}/execution/target-${String(index).padStart(2,'0')}-${kind}.json`,{});
    await f.put(`${deploymentDirectory}-report.json`,{version:1,kind:'fix-nine-rollout-deployed',featureId:'fix-nine-rollout-001',authority:f.authority.ref,
      sourceClosure:f.authority.closure,targets:rows,sourceRefreshes:[]});
    sourceRelease={fixture:'authenticated-release'};run=()=>f.module.authenticateDeployment({root:f.root,io:f.io,sourceRelease});
  }
  const before=await readdir(f.root,{recursive:true});
  await withFixtureActor(f.newOwner,()=>assert.rejects(run,/chain.*(?:preceding audit|audit-time)/i));
  if(mode==='report') assert.equal(f.adapter.sourceRelease,sourceRelease);
  assert.deepEqual(await readdir(f.root,{recursive:true}),before);assert.equal(f.adapter.connects,1);
});
for(const [name,actor,mode] of [
  ['missing native identity',undefined,'audit'],['wrong owner','unowned-fixture','audit'],
  ['same executor','fixture-worker-old','audit'],['missing final identity',undefined,'final'],['wrong final owner','unowned-fixture','final'],
]) test(`owned audit rejects ${name} before artifact writes`,async t=>{
  const f=await auditOperationFixture(t);await f.enter();
  if(name==='same executor') {const state=await readJson(f.root,'.harness/continuity.json');state.owner.id=actor;await f.put('.harness/continuity.json',state);}
  const before=await readdir(f.root,{recursive:true});
  await withFixtureActor(actor,()=>assert.rejects(mode==='final'?f.module.prepareFinalAudit(f.chain):f.module.auditTarget(0,f.chain)));
  assert.deepEqual(await readdir(f.root,{recursive:true}),before);assert.equal(f.adapter.connects,0);
});
for(const [name,change] of [
  ['omitted transfer chain',async f=>{f.chain=[];}],
  ['tampered installed write',async f=>{await f.put(f.managed.path,'tampered');}],
  ['reappeared removed file',async f=>{await f.put(f.removed.path,'reappeared');}],
]) test(`owned independent audit rejects ${name} before startup artifacts`,async t=>{
  const f=await auditOperationFixture(t);await f.enter();await change(f);
  const before=await readdir(f.root,{recursive:true});await withFixtureActor(f.newOwner,()=>assert.rejects(f.module.auditTarget(0,f.chain)));
  assert.deepEqual(await readdir(f.root,{recursive:true}),before);assert.equal(f.adapter.connects,0);
});

test('actual deployment audit authenticator binds signed canonical reservation, full native receipt and physical startup',async t=>{
  const f=await deploymentAuditFixture(t);await f.check();
});
test('actual signed audit authenticates an independent owner transfer and retains every refresh reference',async t=>{
  const f=await deploymentAuditFixture(t),item=await f.refresh();f.audited.sourceRefreshes=[item];await f.persist();
  const references=[];await validateAudit(f.io,f.authority,f.row,references,f.keys.publicKey);
  for(const ref of [item.refresh,item.review,(await readJson(f.root,item.refresh.path)).plan,(await readJson(f.root,item.refresh.path)).transfer.archive]) {
    assert(references.some(r=>canonicalHash(r)===canonicalHash(ref)));
  }
  // The installed plan remains the immutable apply-time plan, even though the
  // independently reviewed lifecycle plan describes an already synced source.
  assert.deepEqual(f.applied.plan,f.authority.value.targets[0].plan);
});
for(const [name,mutate] of [
  ['missing audit chain',f=>delete f.audited.sourceRefreshes],
  ['nonarray audit chain',f=>f.audited.sourceRefreshes={}],
  ['truncated apply chain',async f=>{const refresh=await readJson(f.root,f.audited.sourceRefreshes[0].refresh.path);
    f.applied.refreshes=f.reservation.refreshes=f.audited.sourceRefreshes;f.applied.plan=f.reservation.plan=refresh.plan;
    f.applied.expectedPlanHash=f.reservation.expectedPlanHash=refresh.planHash;f.audited.sourceRefreshes=[];}],
  ['reordered chain',f=>f.audited.sourceRefreshes.push(...f.audited.sourceRefreshes)],
  ['changed signed review',async f=>{const item=f.audited.sourceRefreshes[0],review=await readJson(f.root,item.review.path);review.signature='AAAA';item.review=await f.put(item.review.path,review);}],
  ['changed archive bytes',async f=>{const value=await readJson(f.root,f.audited.sourceRefreshes[0].refresh.path);await f.put(value.transfer.archive.path,'changed');}],
]) test(`actual re-signed audit rejects ${name}`,async t=>{
  const f=await deploymentAuditFixture(t);f.audited.sourceRefreshes=[await f.refresh()];await mutate(f);await f.persist();
  await assert.rejects(f.check(),name==='truncated apply chain'?/Audit source chain must extend/:undefined);
});
for(const [name,mutate] of [
  ['foreign authority',r=>r.authority=pin('foreign.json')],
  ['foreign source closure',r=>r.sourceClosure=pin('foreign.json')],
  ['broken previous link',r=>r.previous=pin('foreign.json')],
  ['replaced lifecycle prefix',r=>r.oldLifecycle=[]],
  ['changed transfer owner',r=>r.transfer.packet.owner.id='foreign'],
  ['missing transfer proof',r=>r.transfer=null],
  ['changed archived path',r=>r.transfer.archive.path='.harness/history/progress/foreign.md'],
  ['blocked plan',(r,p)=>p.blocked=true],
  ['missing blocked plan flag',(r,p)=>delete p.blocked],
  ['changed plan target',(r,p)=>p.target=deploymentTargets[1]],
  ['changed plan hash',(r,p)=>p.planHash='c'.repeat(64)],
]) test(`actual re-signed audit rejects authenticated refresh with ${name}`,async t=>{
  const f=await deploymentAuditFixture(t);f.audited.sourceRefreshes=[await f.refresh(mutate)];await f.persist();await assert.rejects(f.check());
});
test('actual invalid signed audit chain stops acceptance, completed gate and released post-gate authentication',async t=>{
  const f=await deploymentAuditFixture(t);f.audited.sourceRefreshes=[await f.refresh((refresh,plan)=>plan.blocked=true)];await f.persist();
  let calls=0;const invalid=async()=>{calls++;return f.check();},blocked=error=>error.stack.includes('validateRefreshPlan');
  await assert.rejects(runAcceptance({tests:async()=>{},authenticate:invalid}),blocked);
  const gate=await diskFixture(t);await (await fixtureGate(gate)).result;
  await assert.rejects(authenticateGate({...gate,deployment:invalid}),blocked);
  const clearance=await releasedClearanceFixture(t);clearance.release();
  await assert.rejects(authenticateExoClearanceWorkflow({root:clearance.root,publicKey:clearance.publicKey,context:invalid}),blocked);
  assert.equal(calls,3);
});
for(const key of ['authority','sourceClosure','index','root','plan','expectedPlanHash','actor','startedAt','refreshes']) {
  test(`actual deployment audit rejects repinned reservation ${key}`,async t=>{
    const f=await deploymentAuditFixture(t);f.reservation[key]=key==='index'?1:key==='refreshes'?[pin('changed.json')]:typeof f.reservation[key]==='object'?pin('changed.json'):'changed';
    await f.persist();await assert.rejects(f.check());
  });
}
for(const [name,mutate] of [
  ['finished before start',f=>{f.applied.finishedAt='2026-10-17T19:59:00.000Z';}],
  ['startup wrong cwd',f=>{f.audited.startup.commands[0].cwd='different-root';}],
  ['startup wrong argv',f=>{f.audited.startup.commands[1].args=['.harness/run.mjs','status'];}],
  ['startup timeout',f=>{f.audited.startup.commands[1].outcome.timedOut=true;}],
  ['startup signal',f=>{f.audited.startup.commands[1].outcome.signal='SIGTERM';}],
  ['startup unconfirmed close',f=>{f.audited.startup.commands[1].outcome.confirmed=false;}],
  ['stale startup',f=>{f.audited.startup.commands[0].startedAt='2026-10-17T19:59:00.000Z';}],
  ['copied healthy flag with unhealthy physical output',async f=>{const cmd=f.audited.startup.commands[1];cmd.logs.stdout=await f.put(cmd.logs.stdout.path,JSON.stringify({validation:{healthy:false}}));}],
  ['doctor wrong root',async f=>{const cmd=f.audited.startup.commands[0];cmd.logs.stdout=await f.put(cmd.logs.stdout.path,'Harness doctor: other-root\n');}],
]) test(`actual deployment audit rejects ${name}`,async t=>{const f=await deploymentAuditFixture(t);await mutate(f);await f.persist();await assert.rejects(f.check());});

test('actual deployment audit rejects missing physical startup log and unknown reservation without apply',async t=>{
  const f=await deploymentAuditFixture(t);await rm(path.join(f.root,f.audited.startup.commands[0].logs.stdout.path));await assert.rejects(f.check());
  const other=await deploymentAuditFixture(t);await rm(path.join(other.root,other.row.apply.path));await assert.rejects(other.check());
});
for(const kind of ['apply','audit','continue']) test(`actual deployment audit rejects moved identical ${kind} bytes`,async t=>{
  const f=await deploymentAuditFixture(t),ref=f.row[kind],bytes=await f.io.authenticate(ref);const moved=`${deploymentDirectory}/execution/moved-${kind}.json`;
  await writeFile(path.join(f.root,moved),bytes);f.row[kind]=await f.io.pin(moved);await assert.rejects(f.check());
});

test('pre-gate HOLD remains pending and unknown or hidden attempts cannot pass the final authenticator',()=>{
  const exo={updatedDeployment:true,independentAuditContinue:true,hold:'pending-final-gate',holdCleared:false};validatePreGateHold(exo);
  assert.throws(()=>validatePreGateHold({...exo,holdCleared:true}));
  const names=Array.from({length:11},(_,i)=>[`target-${String(i).padStart(2,'0')}-reservation.json`,`target-${String(i).padStart(2,'0')}-apply.json`]).flat();
  validateAttemptPaths(names);assert.throws(()=>validateAttemptPaths([...names,'target-04-outcome.json']));
  assert.throws(()=>validateAttemptPaths(names.slice(1)));assert.throws(()=>validateAttemptPaths([...names,'target-11-reservation.json']));
});

async function fixture() {
  const config = JSON.parse(await readFile(new URL('.harness/config.json', root)));
  const state = JSON.parse(await readFile(new URL('.harness/features.json', root)));
  const feature = clone(state.features.find(item => item.id === rolloutFeatureId));
  // Model a fresh gate, independently of whether the real rollout has finished.
  feature.status = 'active'; feature.attempts = 0; feature.evidence = [];
  const plan = expectedVerificationPlan(config, feature);
  const before = {config, feature, evidencePrefix:[], root:'C:\\reviewed\\source', owner:'fixture-worker',
    nodeExecutable:'C:\\reviewed\\node.exe', gateId:'ea2325fc-f8d9-4f70-854a-d7a70ff15e43'};
  const invocation = {executable:before.nodeExecutable, args:['.harness/run.mjs', 'verify', rolloutFeatureId],
    cwd:before.root, actor:before.owner, executionCount:plan.executions.length, timeoutMs:gateTimeout(config, plan),
    startedAt:'2026-10-17T20:00:00.000Z', finishedAt:'2026-10-17T20:00:03.000Z',
    outcome:{confirmed:true, exitCode:0, controllerExitCode:0, signal:null, timedOut:false},
    logs:{stdout:pin(`${gateDirectory}/stdout.log`), stderr:pin(`${gateDirectory}/stderr.log`)}};
  const ref = pin(`.harness/evidence/2026-10-17T20-00-02-000Z-${rolloutFeatureId}.json`);
  const evidence = {schemaVersion:5, harnessVersion:6, featureId:rolloutFeatureId, pass:true,
    contractHash:feature.contract.hash, configHash:canonicalHash(config), verificationPlan:plan,
    verificationHash:canonicalHash(plan), attempt:1, scopeViolations:[],
    requiredLayers:plan.requiredLayers.map(layer => layer.id), executedLayers:[...new Set(plan.executions.map(entry => entry.layer))],
    startedAt:'2026-10-17T20:00:01.000Z', finishedAt:'2026-10-17T20:00:02.000Z',
    commands:plan.executions.map((entry, i) => ({executionId:entry.id, executionOrder:i, command:entry.command,
      layer:entry.layer, criterionId:entry.criterionId, credentials:[], pass:true, exitCode:0, timedOut:false,
      signal:null, terminationConfirmed:true, durationMs:1,
      logs:{stdout:`.harness/logs/00000000-0000-4000-8000-${String(i).padStart(12,'0')}.stdout.log`,
        stderr:`.harness/logs/00000000-0000-4000-8000-${String(i).padStart(12,'0')}.stderr.log`}}))};
  return {before, invocation, ref, evidence};
}
const validate = f => validateVerificationEvidence(f.before, f.invocation, f.ref, f.evidence);

test('pure module import completes silently without starting its CLI', () => {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./scripts/fix-nine-rollout-evidence.mjs')"],
    {cwd:root, encoding:'utf8', timeout:10000});
  assert.equal(run.status, 0); assert.equal(run.stdout, ''); assert.equal(run.stderr, '');
});

test('expected manifest matches actual successful prerequisite runtime evidence', async () => {
  const config = JSON.parse(await readFile(new URL('.harness/config.json', root)));
  const state = JSON.parse(await readFile(new URL('.harness/features.json', root)));
  const feature = clone(state.features.find(item => item.id === 'source-historical-budget-compat-002'));
  feature.attempts = 0;
  const evidence = JSON.parse(await readFile(new URL('.harness/evidence/2026-10-17T20-21-48-251Z-source-historical-budget-compat-002.json', root)));
  assert.deepEqual(expectedVerificationPlan(config, feature), evidence.verificationPlan);
});

test('current configured rollout plan, exact commands, logs and passing transition validate', async () => {
  const f = await fixture(), verified = validate(f);
  assert.equal(verified.requiredLogs.length, f.evidence.commands.length * 2);
  const after = {...f.before.feature, status:'passing', attempts:1, evidence:[f.ref.path],
    lastVerification:verified.lastVerification, repeatedFailures:0, lastFailureFingerprint:null, updatedAt:f.evidence.finishedAt};
  assert(validatePassingTransition(f.before, after, verified));
  for (const mutate of [a => a.attempts = 0, a => a.status = 'active', a => a.contract.hash = 'b'.repeat(64),
    a => a.evidence.push('extra'), a => a.maxAttempts = 23, a => a.updatedAt = f.invocation.finishedAt]) {
    const bad = clone(after); mutate(bad); assert.throws(() => validatePassingTransition(f.before, bad, verified));
  }
});

const negatives = [
  ['schema downgrade', f => f.evidence.schemaVersion = 4],
  ['runtime downgrade', f => f.evidence.harnessVersion = 5],
  ['wrong feature', f => f.evidence.featureId = 'native-hook-v2-rollout-004'],
  ['forged passing state', f => f.evidence.pass = false],
  ['scope violation', f => f.evidence.scopeViolations.push('unreviewed')],
  ['wrong attempt', f => f.evidence.attempt = 0],
  ['wrong config hash', f => f.evidence.configHash = 'b'.repeat(64)],
  ['wrong contract hash', f => f.evidence.contractHash = 'b'.repeat(64)],
  ['forged plan hash', f => f.evidence.verificationHash = 'b'.repeat(64)],
  ['forged canonical execution ID', f => { f.evidence.verificationPlan.executions[0].id = 'invented'; f.evidence.commands[0].executionId = 'invented'; f.evidence.verificationHash = canonicalHash(f.evidence.verificationPlan); }],
  ['changed command with recomputed hash', f => {const e = f.evidence.verificationPlan.executions[0]; e.command = 'node --version'; e.commandHash = canonicalHash(e.command); f.evidence.verificationHash = canonicalHash(f.evidence.verificationPlan);}],
  ['swapped execution order', f => f.evidence.commands.reverse()],
  ['missing full suite', f => f.evidence.commands.splice(f.evidence.commands.findIndex(e => e.layer === 'full'), 1)],
  ['missing acceptance', f => f.evidence.commands.pop()],
  ['skipped layer', f => f.evidence.executedLayers.pop()],
  ['credential request', f => f.evidence.commands[0].credentials = [{provider:'fixture'}]],
  ['failed command', f => f.evidence.commands[0].exitCode = 1],
  ['timed out command', f => f.evidence.commands[0].timedOut = true],
  ['signalled command', f => f.evidence.commands[0].signal = 'SIGTERM'],
  ['unconfirmed command', f => f.evidence.commands[0].terminationConfirmed = false],
  ['missing log', f => delete f.evidence.commands[0].logs.stdout],
  ['log traversal', f => f.evidence.commands[0].logs.stdout = '.harness/logs/../secret.stdout.log'],
  ['reused log', f => f.evidence.commands[1].logs = clone(f.evidence.commands[0].logs)],
  ['old evidence reused', f => {f.before.evidencePrefix.push(f.ref); f.before.feature.evidence.push(f.ref.path);}],
  ['altered evidence prefix', f => f.before.feature.evidence.push('.harness/evidence/unlisted.json')],
  ['stale evidence timestamp', f => f.evidence.startedAt = '2026-10-17T19:59:59.000Z'],
  ['evidence after verify', f => f.evidence.finishedAt = '2026-10-17T20:00:04.000Z'],
  ['invalid timestamp', f => f.evidence.startedAt = 'garbage'],
  ['wrong outer command', f => f.invocation.args[2] = 'native-hook-v2-rollout-004'],
  ['wrong owner', f => f.invocation.actor = 'other'],
  ['wrong root', f => f.invocation.cwd = 'C:\\unreviewed'],
  ['wrong executable', f => f.invocation.executable = 'other-node'],
  ['unconfirmed outer process', f => f.invocation.outcome.confirmed = false],
  ['failed outer process', f => f.invocation.outcome.exitCode = 1],
  ['timed out outer process', f => f.invocation.outcome.timedOut = true],
  ['signalled outer process', f => f.invocation.outcome.signal = 'SIGTERM'],
  ['shortened outer deadline', f => f.invocation.timeoutMs = 1],
  ['wrong outer execution count', f => f.invocation.executionCount--],
  ['old outer log', f => f.invocation.logs.stdout.path = '.harness/native-hook-v2-rollout-004-gate/stdout.log'],
  ['changed current policy', f => f.before.config.policies.maxAttempts = 23],
  ['exhausted budget', f => f.before.feature.attempts = 5],
  ['changed contract snapshot', f => f.before.feature.title = 'unreviewed']
];
for (const [name, mutate] of negatives) test(`rejects ${name}`, async () => {
  const f = await fixture(); mutate(f); assert.throws(() => validate(f));
});

test('fresh receipt binds exact before, authenticated inputs, invocation and evidence after verify', async () => {
  const f = await fixture(), verified = validate(f), beforePin = pin(`${gateDirectory}/before.json`);
  const bindings = {authority:pin('.harness/fix-nine-rollout-001/authority.json')};
  const receipt = {version:1, kind:'fix-nine-rollout-outer-gate', featureId:rolloutFeatureId,
    gateId:f.before.gateId, before:beforePin, bindings, invocation:f.invocation, verified, sealedAt:'2026-10-17T20:00:04.000Z'};
  const options = {beforePin, bindings, observedAt:'2026-10-17T20:00:05.000Z'};
  const check = r => validateGateReceipt(f.before, f.invocation, verified, r, options);
  assert(check(receipt));
  for (const mutate of [r => r.sealedAt = '2026-10-17T20:00:02.000Z', r => r.sealedAt = '2026-10-17T20:00:06.000Z',
    r => r.gateId = '0'.repeat(36), r => r.before.sha256 = 'b'.repeat(64), r => r.bindings = {},
    r => r.invocation.args[2] = 'old004', r => r.verified.evidence.path = '.harness/evidence/old004.json']) {
    const bad = clone(receipt); mutate(bad); assert.throws(() => check(bad));
  }
});

// These fixtures model adapter output only. They never authorize deployment or
// run the repository's configured verify; every mutation is inside a temp root.
async function diskFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'fix-nine-gate-'));
  t.after(async () => { await rm(directory, {recursive:true, force:true}); });
  const write = async (relative, value) => {
    await mkdir(path.dirname(path.join(directory, relative)), {recursive:true});
    await writeFile(path.join(directory, relative), typeof value === 'string' ? value : JSON.stringify(value) + '\n');
  };
  const f = await fixture(), config = f.before.config, feature = f.before.feature;
  const baselinePath = '.harness/baselines/fixture.json';
  await write(baselinePath, {fixture:true});
  feature.scopeBaselineRef = {version:1, ...await pinFile(directory, baselinePath), baselineHash:feature.contract.scopeBaselineHash};
  feature.evidence = ['.harness/evidence/old-selected.json'];
  await write(feature.evidence[0], {commands:[{logs:{stdout:'.harness/logs/old.stdout.log', stderr:'.harness/logs/old.stderr.log'}}]});
  await write('.harness/evidence/old-other.json', {commands:[]});
  await write('.harness/logs/old.stdout.log', 'retained stdout\n');
  await write('.harness/logs/old.stderr.log', 'retained stderr\n');
  await write('.harness/logs/unreferenced.log', 'retained unreferenced log\n');
  await write('.harness/evidence/unreferenced.json', {retained:true});
  const state = {version:1, revision:7, features:[{id:'historical', attempts:4, verificationBudget:{maxAttempts:23},
    evidence:['.harness/evidence/old-other.json'], immutable:'recovery retained'}, feature]};
  const owner = 'fixture-worker';
  await write('.harness/config.json', config); await write('.harness/features.json', state);
  await write('.harness/continuity.json', {version:1, phase:'working', owner:{id:owner, source:'CODEX_THREAD_ID'},
    handoff:null, retiredWorkerIds:['retained-retired-worker'], lastRecovery:{retained:true}});
  await write('.harness/events.jsonl', '{"retained":true}\n');
  await write('.harness/run.mjs', '// fixture runtime\n');
  for (const relative of requiredHelpers) await write(relative, `// fixture ${relative}\n`);
  await write('.harness/fix-nine-rollout-001/authority.json', {fixture:true, executionAuthorized:false});
  await write('.harness/fix-nine-rollout-001-report.json', {fixture:true, neverAProductionReport:true});
  await write('.harness/fix-nine-rollout-001/source-closure.json', {helperFiles:await Promise.all(requiredHelpers.map(relative => pinFile(directory, relative)))});
  const deployed = {version:1, kind:'fix-nine-rollout-authenticated-deployment', featureId:rolloutFeatureId,
    authority:await pinFile(directory, '.harness/fix-nine-rollout-001/authority.json'),
    report:await pinFile(directory, '.harness/fix-nine-rollout-001-report.json'),
    sourceClosure:await pinFile(directory, '.harness/fix-nine-rollout-001/source-closure.json'), references:[]};
  const inventoryModes = [];
  const deployment = async () => { const inventory = await authenticateGateInventory(directory);
    inventoryModes.push(inventory?.mode ?? 'pre'); return clone(deployed); };
  return {root:directory, write, owner, config, state, feature, deployment, deployed, inventoryModes};
}

async function fixtureVerification(f, {before, plan}) {
  assert(await readJson(f.root, beforePath));
  await assert.rejects(readJson(f.root, receiptPath), /ENOENT/);
  const sample = await fixture(), time = new Date().toISOString();
  const evidence = {...sample.evidence, configHash:canonicalHash(before.config), contractHash:before.feature.contract.hash,
    verificationPlan:plan, verificationHash:canonicalHash(plan), attempt:before.feature.attempts + 1,
    startedAt:time, finishedAt:time};
  const prefix = plan.executions.findIndex(entry => entry.criterionId === 'ac-1');
  for (const [index, entry] of evidence.commands.entries()) {
    for (const stream of ['stdout', 'stderr']) await f.write(entry.logs[stream], `actual fixture ${stream}\n`);
    if (index === prefix) {
      await f.pendingMutation?.(f, {before, plan, evidence});
      f.pendingBindings = await authenticateBindings(f);
    }
  }
  await f.beforeEvidence?.(f, {before, plan, evidence});
  const relative = `.harness/evidence/fixture-${rolloutFeatureId}.json`;
  await f.write(relative, evidence);
  const invocation = {...sample.invocation, executable:process.execPath, cwd:f.root, actor:f.owner,
    startedAt:time, finishedAt:time, executionCount:plan.executions.length, timeoutMs:gateTimeout(before.config, plan)};
  for (const stream of ['stdout', 'stderr']) {
    await f.write(`${gateDirectory}/${stream}.log`, `outer fixture ${stream}\n`);
    invocation.logs[stream] = await pinFile(f.root, `${gateDirectory}/${stream}.log`);
  }
  const verified = validateVerificationEvidence(before, invocation, await pinFile(f.root, relative), evidence);
  const state = await readJson(f.root, '.harness/features.json'); state.revision++;
  state.features[state.features.findIndex(item => item.id === rolloutFeatureId)] = {...before.feature, status:'passing',
    attempts:before.feature.attempts + 1, evidence:[...before.feature.evidence, relative],
    lastVerification:verified.lastVerification, repeatedFailures:0, lastFailureFingerprint:null, updatedAt:time};
  await f.write('.harness/features.json', state);
  await appendFile(path.join(f.root, '.harness/events.jsonl'), '{"verified":true}\n');
  return {invocation, evidence, relative};
}
async function fixtureGate(f, mutation) {
  let count = 0;
  const result = runGateWorkflow({...f, invoke:async args => {
    count++; const verified = await fixtureVerification(f, args);
    await mutation?.(f, verified, args); return verified.invocation;
  }});
  return {result, count:() => count};
}

test('physical inventory freezes unreferenced files and enumerates new names independently of live bytes', async t => {
  const f = await diskFixture(t), frozen = await freezeInventory(f.root, '.harness/logs');
  const relative = '.harness/logs/11111111-1111-4111-8111-111111111111.stdout.log';
  await f.write(relative, 'first live bytes');
  assert.deepEqual(await inventoryAdditions(f.root, '.harness/logs', frozen), [relative]);
  await f.write(relative, 'different live bytes');
  assert.deepEqual(await inventoryAdditions(f.root, '.harness/logs', frozen), [relative]);
  await assert.rejects(inventoryAdditions(f.root, '.harness/logs', [...frozen, frozen[0]]));
  await f.write('.harness/logs/unreferenced.log', 'changed old bytes');
  await assert.rejects(inventoryAdditions(f.root, '.harness/logs', frozen));
});

const pendingNegatives = [
  ['unrelated new file', async f => f.write('.harness/logs/unrelated.txt', 'extra')],
  ['malformed UUID pair', async f => { for (const stream of ['stdout', 'stderr']) await f.write(`.harness/logs/not-a-uuid.${stream}.log`, 'extra'); }],
  ['missing UUID stream', async (f, {evidence}) => rm(path.join(f.root, evidence.commands[0].logs.stderr))],
  ['extra UUID pair', async f => { for (const stream of ['stdout', 'stderr']) await f.write(`.harness/logs/11111111-1111-4111-8111-111111111111.${stream}.log`, 'extra'); }],
  ['nested UUID pair', async f => { for (const stream of ['stdout', 'stderr']) await f.write(`.harness/logs/nested/11111111-1111-4111-8111-111111111111.${stream}.log`, 'extra'); }],
  ['pending evidence', async f => f.write('.harness/evidence/unlinked-new.json', {})],
  ['frozen state', async f => f.write('.harness/features.json', {...f.state, revision:100})],
  ['old physical inventory', async f => f.write('.harness/evidence/unreferenced.json', {changed:true})],
  ['owner', async f => { const before = await readJson(f.root, beforePath); before.owner = 'another-worker'; await f.write(beforePath, before); }],
  ['attempt', async f => { const before = await readJson(f.root, beforePath); before.feature.attempts++; await f.write(beforePath, before); }],
  ['plan', async f => { const before = await readJson(f.root, beforePath); before.plan.executions.pop(); await f.write(beforePath, before); }],
  ['invocation identity', async f => { const before = await readJson(f.root, beforePath); before.invocationIdentity.actor = 'another-worker'; await f.write(beforePath, before); }]
];
for (const [name, mutation] of pendingNegatives) test(`composed pending gate refuses ${name}`, async t => {
  const f = await diskFixture(t); f.pendingMutation = mutation;
  const gate = await fixtureGate(f); await assert.rejects(gate.result); assert.equal(gate.count(), 1);
  await assert.rejects(readJson(f.root, receiptPath), /ENOENT/);
});

for (const [name, mutation] of [
  ['cross-paired execution UUIDs', async (_f, {evidence}) => {
    [evidence.commands[0].logs.stderr, evidence.commands[1].logs.stderr] =
      [evidence.commands[1].logs.stderr, evidence.commands[0].logs.stderr];
  }],
  ['non-UUID completed streams', async (f, {evidence}) => {
    const entry = evidence.commands.at(-1);
    for (const stream of ['stdout', 'stderr']) {
      await rm(path.join(f.root, entry.logs[stream]));
      entry.logs[stream] = `.harness/logs/malformed.${stream}.log`; await f.write(entry.logs[stream], 'malformed');
    }
  }]
]) test(`composed completed gate refuses ${name}`, async t => {
  const f = await diskFixture(t); f.beforeEvidence = mutation;
  const gate = await fixtureGate(f); await assert.rejects(gate.result); assert.equal(gate.count(), 1);
  await assert.rejects(readJson(f.root, receiptPath), /ENOENT/);
});

for (const [name, mutation] of [
  ['added log pair', async f => { for (const stream of ['stdout', 'stderr']) await f.write(`.harness/logs/11111111-1111-4111-8111-111111111111.${stream}.log`, 'callback'); }],
  ['added evidence', async f => f.write('.harness/evidence/callback.json', {})],
  ['removed old inventory', async f => rm(path.join(f.root, '.harness/evidence/unreferenced.json'))],
  ['substituted old inventory', async f => f.write('.harness/logs/unreferenced.log', 'callback')]
]) test(`completed callback ${name} cannot seal a receipt`, async t => {
  const f = await diskFixture(t), original = f.deployment; let mutated = false;
  f.deployment = async args => {
    const deployed = await original(args);
    if (!mutated && (await authenticateGateInventory(f.root))?.mode === 'completed') { mutated = true; await mutation(f); }
    return deployed;
  };
  const gate = await fixtureGate(f); await assert.rejects(gate.result); assert.equal(gate.count(), 1); assert(mutated);
  await assert.rejects(readJson(f.root, receiptPath), /ENOENT/);
});

test('filesystem pins reject traversal, ADS, ambiguous Windows names and altered bytes', async t => {
  const f = await diskFixture(t);
  for (const relative of ['../outside', '/absolute', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'a:stream', 'CON.txt', 'a. ', 'a.', 'a\u0000'])
    assert.throws(() => referencePath(relative));
  const ref = await pinFile(f.root, '.harness/config.json');
  await f.write(ref.path, 'changed'); await assert.rejects(authenticateFile(f.root, ref));
  await assert.rejects(authenticateFile(f.root, {...ref, bytes:-1}));
  await assert.rejects(regularPath(f.root, '.harness', {directory:false}));
  await assert.rejects(exclusiveJson(f.root, ref.path, {overwrite:true}));
  const events = await pinFile(f.root, '.harness/events.jsonl');
  await appendFile(path.join(f.root, events.path), 'additive\n'); await authenticatePrefix(f.root, events);
  await f.write(events.path, 'replaced\n'); await assert.rejects(authenticatePrefix(f.root, events));
  await assert.rejects(authenticatePrefix(f.root, {...events, bytes:-1}));
});

test('filesystem rejects linked parent directories', async t => {
  const f = await diskFixture(t);
  try { await symlink(path.join(f.root, '.harness'), path.join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Host does not permit fixture links'); return; } throw error; }
  await assert.rejects(pinFile(f.root, 'linked/config.json'));
  await assert.rejects(freezeInventory(f.root, 'linked/logs'));
});

test('filesystem rejects linked final files', async t => {
  const f = await diskFixture(t);
  try { await symlink(path.join(f.root, '.harness/config.json'), path.join(f.root, 'linked-file'), 'file'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Host does not permit fixture file symlinks'); return; } throw error; }
  await assert.rejects(pinFile(f.root, 'linked-file'));
  await symlink(path.join(f.root, '.harness/config.json'), path.join(f.root, '.harness/logs/linked-file'), 'file');
  await assert.rejects(freezeInventory(f.root, '.harness/logs'));
});

test('report adapter bindings authenticate exact helper/report/authority/baseline bytes', async t => {
  const f = await diskFixture(t), bindings = await authenticateBindings(f);
  assert.equal(bindings.configHash, canonicalHash(f.config));
  await f.write(f.deployed.report.path, {tampered:true});
  await assert.rejects(authenticateBindings(f));
});

test('config, state and baseline mutations inside adapter callbacks cannot split authenticated inputs', async t => {
  for (const relative of ['.harness/config.json', '.harness/features.json', '.harness/baselines/fixture.json']) {
    const f = await diskFixture(t);
    await assert.rejects(authenticateBindings({...f, deployment:async () => {
      await f.write(relative, {changedDuringAdapter:true}); return f.deployed;
    }}));
  }
});

test('missing, extra and duplicate helper closures fail closed', async t => {
  for (const mutate of [c => c.helperFiles.pop(), c => c.helperFiles.push(c.helperFiles[0]),
    c => c.helperFiles.push(pin('scripts/unreviewed.mjs'))]) {
    const f = await diskFixture(t), closure = await readJson(f.root, f.deployed.sourceClosure.path);
    mutate(closure); await f.write(f.deployed.sourceClosure.path, closure);
    f.deployed.sourceClosure = await pinFile(f.root, f.deployed.sourceClosure.path);
    await assert.rejects(authenticateBindings(f));
  }
});

test('production adapter rejects fixture roots; no caller-selected adapter is executed', async t => {
  const f = await diskFixture(t);
  await assert.rejects(productionDeployment({root:f.root, io:{pin:() => assert.fail('must reject root first')}}));
});

test('ac1 runs focused tests first, stops on failures, and never requires future receipt', async () => {
  const order = [];
  const authenticate = async () => { order.push('authenticate'); return {deployment:{report:pin('.harness/fix-nine-rollout-001-report.json')}}; };
  assert((await runAcceptance({tests:async () => { order.push('tests'); }, authenticate})).pass);
  assert.deepEqual(order, ['tests', 'authenticate']);
  await assert.rejects(runAcceptance({tests:async () => { throw Error('fixture failure'); }, authenticate}));
  assert.deepEqual(order, ['tests', 'authenticate']);
});

test('wrapper imports are silent and do not invoke focused tests or a CLI', () => {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e',
    "for(const name of ['files','auth','gate'])await import('./scripts/fix-nine-rollout-'+name+'.mjs');await import('./scripts/verify-fix-nine-rollout.mjs')"],
    {cwd:root, encoding:'utf8', timeout:10000});
  assert.equal(run.status, 0); assert.equal(run.stdout, ''); assert.equal(run.stderr, '');
});

test('composed filesystem gate invokes once, appends exactly one evidence, and seals afterward', async t => {
  const f = await diskFixture(t), gate = await fixtureGate(f);
  assert((await gate.result).pass); assert.equal(gate.count(), 1);
  assert(f.inventoryModes.includes('pre') && f.inventoryModes.includes('pending') && f.inventoryModes.includes('completed'));
  assert(!f.pendingBindings.references.some(ref => /^\.harness\/(?:logs|evidence)\//.test(ref.path)));
  assert((await authenticateGate(f)).pass);
  const before = await readJson(f.root, beforePath), receipt = await readJson(f.root, receiptPath);
  assert.equal(receipt.verified.commandLogs.length, expectedVerificationPlan(before.config, before.feature).executions.length * 2);
  const current = await readJson(f.root, '.harness/features.json');
  assert.deepEqual(current.features[0], f.state.features[0]);
  assert.equal(current.features[1].attempts, 1);
  let calls = 0;
  await assert.rejects(runGateWorkflow({...f, invoke:async () => { calls++; }})); assert.equal(calls, 0);
});

const compositionNegatives = [
  ['current config bytes', async f => f.write('.harness/config.json', {...f.config, changed:true})],
  ['reviewed helper bytes', async f => f.write(requiredHelpers[0], '// changed\n')],
  ['report bytes', async f => f.write(f.deployed.report.path, {selfAssertedPass:true})],
  ['authority bytes', async f => f.write(f.deployed.authority.path, {selfAssertedSeal:true})],
  ['closure bytes', async f => f.write(f.deployed.sourceClosure.path, {helperFiles:[]})],
  ['baseline bytes', async f => f.write(f.feature.scopeBaselineRef.path, 'changed')],
  ['old selected evidence', async f => f.write(f.feature.evidence[0], {changed:true})],
  ['other old evidence', async f => f.write('.harness/evidence/old-other.json', {changed:true})],
  ['old physical log', async f => f.write('.harness/logs/old.stdout.log', 'changed')],
  ['unreferenced old log', async f => f.write('.harness/logs/unreferenced.log', 'changed')],
  ['unreferenced old evidence', async f => f.write('.harness/evidence/unreferenced.json', {changed:true})],
  ['missing unreferenced old file', async f => rm(path.join(f.root, '.harness/logs/unreferenced.log'))],
  ['extra completed log pair', async f => { for (const stream of ['stdout', 'stderr'])
    await f.write(`.harness/logs/11111111-1111-4111-8111-111111111111.${stream}.log`, 'extra'); }],
  ['extra unlinked evidence', async f => f.write('.harness/evidence/extra.json', {})],
  ['recovery and owner history', async f => f.write('.harness/continuity.json', {phase:'working', owner:null})],
  ['old events prefix', async f => f.write('.harness/events.jsonl', '{"rewritten":true}\n')],
  ['before snapshot', async f => f.write(beforePath, {forged:true})],
  ['outer physical log', async (f, r) => f.write(r.invocation.logs.stdout.path, 'changed')],
  ['new evidence command', async (f, r) => { r.evidence.commands[0].credentials = ['forged']; await f.write(r.relative, r.evidence); }],
  ['unconfirmed invocation', async (f, r) => { r.invocation.outcome.confirmed = false; }],
  ['wrong invocation command', async (f, r) => { r.invocation.args = ['--version']; }],
  ['historical feature', async f => {const s = await readJson(f.root, '.harness/features.json'); s.features[0].attempts = 0; await f.write('.harness/features.json', s);}],
  ['feature array order', async f => {const s = await readJson(f.root, '.harness/features.json'); s.features.reverse(); await f.write('.harness/features.json', s);}],
  ['evidence append count', async f => {const s = await readJson(f.root, '.harness/features.json'); s.features[1].evidence.push('extra'); await f.write('.harness/features.json', s);}],
  ['selected evidence prefix order', async f => {const s = await readJson(f.root, '.harness/features.json'); s.features[1].evidence[0] = '.harness/evidence/old-other.json'; await f.write('.harness/features.json', s);}],
  ['extra state revision', async f => {const s = await readJson(f.root, '.harness/features.json'); s.revision++; await f.write('.harness/features.json', s);}]
];
for (const [name, mutate] of compositionNegatives) test(`composed gate refuses ${name} drift without a receipt or retry`, async t => {
  const f = await diskFixture(t), gate = await fixtureGate(f, mutate);
  await assert.rejects(gate.result); assert.equal(gate.count(), 1);
  assert(await readJson(f.root, `${gateDirectory}/invocation.json`));
  await assert.rejects(readJson(f.root, receiptPath), /ENOENT/);
});

test('postreceipt command log tampering is detected by physical hash', async t => {
  const f = await diskFixture(t), gate = await fixtureGate(f); await gate.result;
  const receipt = await readJson(f.root, receiptPath);
  await f.write(receipt.verified.commandLogs[0].path, 'changed log after seal');
  await assert.rejects(authenticateGate(f));
});

test('postcallback artifact, state and log substitution cannot authenticate a changed receipt', async t => {
  const commandLog = (await fixture()).evidence.commands[0].logs.stdout;
  for (const relative of [receiptPath, beforePath, `${gateDirectory}/invocation.json`, '.harness/features.json',
    '.harness/continuity.json', '.harness/evidence/old-other.json', commandLog]) {
    const f = await diskFixture(t), gate = await fixtureGate(f); await gate.result;
    await assert.rejects(authenticateGate({...f, deployment:async () => {
      await f.write(relative, {substitutedDuringAuthentication:true}); return f.deployed;
    }}));
  }
});

test('preexisting gate reservation and wrong owner cannot consume an attempt', async t => {
  const f = await diskFixture(t); let calls = 0;
  const invoke = async () => { calls++; };
  await assert.rejects(runGateWorkflow({...f, owner:'other', invoke}));
  await mkdir(path.join(f.root, gateDirectory));
  await assert.rejects(runGateWorkflow({...f, invoke})); assert.equal(calls, 0);
});

test('actual outer runner uses fixed argv, owned clean environment, drained physical logs and confirmed close', async t => {
  const f = await diskFixture(t);
  await mkdir(path.join(f.root, gateDirectory));
  await f.write('.harness/run.mjs', "console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),owner:process.env.CODEX_THREAD_ID,keys:Object.keys(process.env).filter(k=>/KEY|TOKEN|SECRET|PASSWORD|AUTH_FIXTURE/i.test(k))}));console.error('drained stderr');");
  const previous = process.env.AUTH_FIXTURE;
  process.env.AUTH_FIXTURE = 'fixture-only';
  t.after(() => { if (previous === undefined) delete process.env.AUTH_FIXTURE; else process.env.AUTH_FIXTURE = previous; });
  const config = clone(f.config); config.security.environmentAllow.push('AUTH_FIXTURE');
  config.security.credentials.providers.fixture = {targetEnvironment:'AUTH_FIXTURE', sources:[]};
  const plan = expectedVerificationPlan(config, f.feature);
  const invocation = await invokeVerification({root:f.root, before:{config, owner:f.owner}, plan});
  assert.deepEqual(invocation.args, ['.harness/run.mjs', 'verify', rolloutFeatureId]);
  assert.deepEqual(invocation.outcome, {confirmed:true, exitCode:0, controllerExitCode:0, signal:null, timedOut:false});
  const output = JSON.parse(await authenticateFile(f.root, invocation.logs.stdout));
  assert.deepEqual(output, {args:['verify', rolloutFeatureId], cwd:f.root, owner:f.owner, keys:[]});
  assert.equal(String(await authenticateFile(f.root, invocation.logs.stderr)), 'drained stderr\n');
});

// Isolated synthetic clearance cases import the actual adapter; fixture keys have no production authority.
{
const clone = value => structuredClone(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pin = path => ({path, bytes:1, sha256:'a'.repeat(64)});
const directory = '.harness/fix-nine-rollout-001';
function fixture() {
  const files=new Map(), put=(path, text) => {const bytes=Buffer.from(text);files.set(path,bytes);return {path,bytes:bytes.length,sha256:sha(bytes)};};
  const current={gate:pin(`${directory}/gate/receipt.json`),gateSealedAt:'2026-10-17T20:00:00.000Z',gateActor:'synthetic-gate-executor',
    deployment:{report:pin(`${directory}-report.json`),authority:pin(`${directory}/authority.json`),sourceClosure:pin(`${directory}/source-closure.json`)},
    target:{index:4,root:'C:/synthetic/exo',runtime:pin('.harness/run.mjs'),state:['config.json','features.json','continuity.json','events.jsonl'].map(file=>pin(`.harness/${file}`)),
      apply:pin(`${directory}/execution/target-04-apply.json`),audit:pin(`${directory}/execution/target-04-audit.json`),continue:pin(`${directory}/execution/target-04-continue.json`)},
    applyActors:Array.from({length:11},(_,i)=>`synthetic-deployer-${i}`)};
  const commands=['doctor','bootstrap'].map((name,i)=>({executable:process.execPath,args:['.harness/run.mjs',...(i===0?['doctor']:['bootstrap','--validate','--json'])],
    cwd:current.target.root,startedAt:`2026-10-17T20:00:0${i*2+1}.000Z`,finishedAt:`2026-10-17T20:00:0${i*2+2}.000Z`,
    outcome:{confirmed:true,exitCode:0,signal:null,timedOut:false,error:null},
    logs:{stdout:put(`${directory}/execution/post-gate-exo-${name}.stdout.log`,i===0?`Harness doctor: ${current.target.root} (runtime v6, schema v1)\n`:JSON.stringify({validation:{healthy:true}})),
      stderr:put(`${directory}/execution/post-gate-exo-${name}.stderr.log`,'')}}));
  const audit={version:1,kind:'fix-nine-rollout-exo-post-gate-audit',featureId:'fix-nine-rollout-001',gate:clone(current.gate),deployment:clone(current.deployment),target:clone(current.target),
    actor:current.gateActor,at:'2026-10-17T20:00:05.000Z',startup:{healthy:true,commands},hold:'pending-independent-clearance',holdCleared:false};
  const auditRef=pin(`${directory}/execution/post-gate-exo-audit.json`),reviewRef=pin(`${directory}/execution/post-gate-exo-continue.json`);
  const io={authenticate:async ref=>{const bytes=files.get(ref.path);assert(bytes,'Missing physical log');assert.equal(bytes.length,ref.bytes);assert.equal(sha(bytes),ref.sha256);return bytes;}};
  const receipt={version:1,kind:'fix-nine-rollout-exo-clearance',featureId:'fix-nine-rollout-001',gate:clone(current.gate),deployment:clone(current.deployment),target:clone(current.target),audit:auditRef,independentContinue:reviewRef,
    hold:'cleared',holdCleared:true,sealedAt:'2026-10-17T20:00:06.000Z'};
  return {current,audit,io,put,files,auditRef,reviewRef,receipt,reviewed:{current,auditRef,audit,reviewRef}};
}
test('exo clearance: synthetic final-gate/startup/current-runtime conjunction validates while prior audit stays pending',async()=>{
  const f=fixture(),before=clone(f.audit),refs=[];
  await validateExoClearanceAudit(f.io,f.audit,f.current,refs);assert.equal(refs.length,4);
  validateExoClearanceReceipt(f.receipt,f.reviewed,'2026-10-17T20:00:07.000Z');assert.deepEqual(f.audit,before);
});
const auditNegatives=[
  ['old gate',f=>f.audit.gate.sha256='b'.repeat(64)],
  ['wrong deployment',f=>f.audit.deployment.report.sha256='b'.repeat(64)],
  ['wrong target',f=>f.audit.target.root='C:/synthetic/other'],
  ['stale runtime',f=>f.audit.target.runtime.sha256='b'.repeat(64)],
  ['changed config',f=>f.audit.target.state[0].sha256='b'.repeat(64)],
  ['changed historical features',f=>f.audit.target.state[1].sha256='b'.repeat(64)],
  ['changed recovery state',f=>f.audit.target.state[2].sha256='b'.repeat(64)],
  ['changed event prefix',f=>f.audit.target.state[3].sha256='b'.repeat(64)],
  ['wrong startup capture actor',f=>f.audit.actor='unowned-capture-actor'],
  ['empty actor',f=>f.audit.actor=''],
  ['premature cleared hold',f=>f.audit.holdCleared=true],
  ['startup preceding gate',f=>f.audit.startup.commands[0].startedAt='2026-10-17T19:59:00.000Z'],
  ['unhealthy flag',f=>f.audit.startup.healthy=false],
  ['unhealthy physical output',f=>{const cmd=f.audit.startup.commands[1];cmd.logs.stdout=f.put(cmd.logs.stdout.path,JSON.stringify({validation:{healthy:false}}));}],
  ['wrong physical doctor root',f=>{const cmd=f.audit.startup.commands[0];cmd.logs.stdout=f.put(cmd.logs.stdout.path,'Harness doctor: other-root (runtime v6)\n');}],
  ['missing physical log',f=>f.files.delete(f.audit.startup.commands[1].logs.stdout.path)],
  ['changed physical log bytes',f=>f.files.set(f.audit.startup.commands[1].logs.stdout.path,Buffer.from('changed'))],
  ['wrong startup executable',f=>f.audit.startup.commands[0].executable='different-node'],
  ['wrong startup argv',f=>f.audit.startup.commands[1].args=['.harness/run.mjs','status']],
  ['wrong startup cwd',f=>f.audit.startup.commands[1].cwd='different-root'],
  ['startup timeout',f=>f.audit.startup.commands[1].outcome.timedOut=true],
  ['startup failure',f=>f.audit.startup.commands[1].outcome.exitCode=1],
  ['unconfirmed startup',f=>f.audit.startup.commands[1].outcome.confirmed=false],
  ['startup signal',f=>f.audit.startup.commands[1].outcome.signal='SIGTERM'],
  ['audit preceding startup finish',f=>f.audit.at='2026-10-17T20:00:03.000Z'],
];
for(const [name,mutate] of auditNegatives)test(`exo clearance: rejects ${name}`,async()=>{const f=fixture();mutate(f);await assert.rejects(()=>validateExoClearanceAudit(f.io,f.audit,f.current));});
test('exo clearance: independent CONTINUE signature binds the exact gate, audit, runtime/state and scope',()=>{
  const f=fixture(),keys=generateKeyPairSync('ed25519'),body=exoClearanceReviewBody(f.auditRef,f.audit,'synthetic-independent-reviewer');
  const seal={version:1,kind:'product-audit',verdict:'CONTINUE',body,signature:sign(null,reviewPayload('product-audit',body),keys.privateKey).toString('base64')};
  validateExoClearanceReview(seal,f.auditRef,f.audit,f.current,keys.publicKey);
  for(const mutate of [b=>b.gate.sha256='b'.repeat(64),b=>b.audit.sha256='b'.repeat(64),b=>b.target.runtime.sha256='b'.repeat(64),
    b=>b.target.state[1].sha256='b'.repeat(64),b=>b.scope='same-target-after-deployment',b=>b.actor='deployer']) {
    const changed=clone(body);mutate(changed);const changedSeal={...seal,body:changed};
    assert.throws(()=>validateReview(changedSeal,'product-audit',changed,keys.publicKey));
  }
  assert.throws(()=>validateReview({...seal,signature:'A'.repeat(86)+'=='},'product-audit',body,keys.publicKey));
  assert.throws(()=>validateReview({...seal,verdict:'HOLD'},'product-audit',body,keys.publicKey));
  for(const reviewer of [f.current.gateActor,...f.current.applyActors]) {
    const selfBody={...clone(body),actor:reviewer};
    const selfSeal={...seal,body:selfBody,signature:sign(null,reviewPayload('product-audit',selfBody),keys.privateKey).toString('base64')};
    assert.throws(()=>validateExoClearanceReview(selfSeal,f.auditRef,f.audit,f.current,keys.publicKey));
  }
  assert.throws(()=>exoClearanceReviewBody(f.auditRef,f.audit,''));
});
for(const [name,mutate] of [
  ['early clearance',f=>f.receipt.sealedAt='2026-10-17T20:00:04.000Z'],
  ['future clearance',f=>f.receipt.sealedAt='2026-10-17T20:00:08.000Z'],
  ['changed review pin',f=>f.receipt.independentContinue={...f.reviewRef,sha256:'b'.repeat(64)}],
  ['changed gate pin',f=>f.receipt.gate.sha256='b'.repeat(64)],
  ['changed runtime pin',f=>f.receipt.target.runtime.sha256='b'.repeat(64)],
  ['missing clearance flag',f=>delete f.receipt.holdCleared],
])test(`exo clearance: receipt rejects ${name}`,()=>{const f=fixture();mutate(f);assert.throws(()=>validateExoClearanceReceipt(f.receipt,f.reviewed,'2026-10-17T20:00:07.000Z'));});

test('exo clearance: actual module authenticates physical startup logs and rejects replacement or removal',async t=>{
  const fixtureRoot=await mkdtemp(path.join(tmpdir(),'exo-clearance-'));
  assert(path.resolve(fixtureRoot).startsWith(path.resolve(tmpdir())+path.sep));
  t.after(()=>rm(fixtureRoot,{recursive:true,force:true}));
  const f=fixture();
  for(const [relative,bytes] of f.files) {
    const file=path.join(fixtureRoot,relative);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);
  }
  const physicalIo={authenticate:ref=>authenticateFile(fixtureRoot,ref)},references=[];
  await validateExoClearanceAudit(physicalIo,f.audit,f.current,references);assert.equal(references.length,4);
  const changed=f.audit.startup.commands[1].logs.stdout.path;
  await appendFile(path.join(fixtureRoot,changed),'tampered');
  await assert.rejects(()=>validateExoClearanceAudit(physicalIo,f.audit,f.current));
  await writeFile(path.join(fixtureRoot,changed),f.files.get(changed));
  await rm(path.join(fixtureRoot,f.audit.startup.commands[0].logs.stderr.path));
  await assert.rejects(()=>validateExoClearanceAudit(physicalIo,f.audit,f.current));
});
}

// These fixture keys and gate adapters never authorize a real deployment. The
// actual copied runtime performs the isolated worker_yield operation.
async function releasedClearanceFixture(t) {
  const f=await diskFixture(t), prefix='.harness/fix-nine-rollout-001/execution/post-gate-exo';
  const continuity=await readJson(f.root,'.harness/continuity.json');
  Object.assign(continuity,{generation:2,checkpoint:null,startedAt:'2026-10-17T19:00:00.000Z',resumedAt:null,lastHandoff:null});
  continuity.owner.featureId=rolloutFeatureId;
  await f.write('.harness/continuity.json',continuity);
  await f.write('.harness/progress.md','retained pre-release progress\n');
  await f.write('.harness/handoff.md','retained pre-release handoff\n');
  await f.write('.harness/run.mjs',await readFile(new URL('../skill/codex-harness/assets/project-runtime.mjs',import.meta.url),'utf8'));
  await f.write('.harness/context-budget.mjs',await readFile(new URL('../skill/codex-harness/assets/context-budget.mjs',import.meta.url),'utf8'));
  f.preGateHold='.harness/fix-nine-rollout-001/execution/fixture-exo-004-HOLD.json';
  await f.write(f.preGateHold,{target:4,verdict:'HOLD',holdCleared:false});
  let previous=null,callback=null;
  f.layers={gate:0,inventory:0,preservation:0};
  f.deployment=async ({sourceRelease}={})=>{
    await authenticateGateInventory(f.root,sourceRelease); f.layers.inventory++;
    if(previous) {await authenticateSourceLifecycle(f.root,previous,sourceRelease);f.layers.preservation++;}
    if(callback) await callback();
    return clone(f.deployed);
  };
  await runGateWorkflow({...f,invoke:async options=>(await fixtureVerification(f,options)).invocation});
  const gate=await pinFile(f.root,receiptPath),gateReceipt=await readJson(f.root,receiptPath);
  const boundary=await captureSourceReleaseBoundary(f.root,async (relative,bytes)=>{await f.write(relative,bytes.toString('utf8'));return pinFile(f.root,relative);});
  previous=clone(boundary.lifecycle);
  const at=new Date().toISOString(),exoRoot=path.join(f.root,'exo');
  const exoFiles=['config.json','features.json','continuity.json','events.jsonl'];
  for(const file of exoFiles) await f.write(`exo/.harness/${file}`,file==='events.jsonl'?'{}\n':{retained:file});
  await f.write('exo/.harness/run.mjs','// retained Exo runtime\n');
  const target={index:4,root:exoRoot,runtime:await pinFile(exoRoot,'.harness/run.mjs'),
    state:await Promise.all(exoFiles.map(file=>pinFile(exoRoot,`.harness/${file}`)))};
  const current={gate,gateSealedAt:gateReceipt.sealedAt,gateActor:f.owner,deployment:clone(f.deployed),target,
    applyActors:Array.from({length:11},(_,i)=>`fixture-apply-${i}`)};
  const commands=[];
  for(const [index,name] of ['doctor','bootstrap'].entries()) {
    const stdout=`${prefix}-${name}.stdout.log`,stderr=`${prefix}-${name}.stderr.log`;
    await f.write(stdout,index===0?`Harness doctor: ${exoRoot} (runtime v6, schema v1)\n`:JSON.stringify({validation:{healthy:true}}));
    await f.write(stderr,'');
    commands.push({executable:process.execPath,args:['.harness/run.mjs',...(index===0?['doctor']:['bootstrap','--validate','--json'])],
      cwd:exoRoot,startedAt:at,finishedAt:at,outcome:{confirmed:true,exitCode:0,signal:null,timedOut:false,error:null},
      logs:{stdout:await pinFile(f.root,stdout),stderr:await pinFile(f.root,stderr)}});
  }
  const audit={version:1,kind:'fix-nine-rollout-exo-post-gate-audit',featureId:rolloutFeatureId,sourceReleaseBoundary:boundary,
    gate,deployment:clone(f.deployed),target,actor:f.owner,at,startup:{healthy:true,commands},hold:'pending-independent-clearance',holdCleared:false};
  const keys=generateKeyPairSync('ed25519');
  const sealedAt=new Date().toISOString();
  f.seal=async(value=audit)=>{
    await f.write(exoClearanceAuditPath,value);
    const auditRef=await pinFile(f.root,exoClearanceAuditPath),body=exoClearanceReviewBody(auditRef,value,'fixture-independent-reviewer');
    await f.write(exoClearanceContinuePath,{version:1,kind:'product-audit',verdict:'CONTINUE',body,
      signature:sign(null,reviewPayload('product-audit',body),keys.privateKey).toString('base64')});
    await f.write(exoClearancePath,{version:1,kind:'fix-nine-rollout-exo-clearance',featureId:rolloutFeatureId,gate,
      deployment:clone(f.deployed),target,audit:auditRef,independentContinue:await pinFile(f.root,exoClearanceContinuePath),
      hold:'cleared',holdCleared:true,sealedAt});
  };
  await f.seal();
  f.audit=audit; f.current=current; f.publicKey=keys.publicKey;
  f.authenticate=()=>authenticateExoClearanceWorkflow({root:f.root,publicKey:keys.publicKey,context:async sourceRelease=>{
    const authenticated=await authenticateGate({...f,sourceRelease});assert.equal(authenticated.pass,true);f.layers.gate++;
    for(const ref of [target.runtime,...target.state]) await authenticateFile(exoRoot,ref);
    return clone(current);
  }});
  f.callback=value=>{callback=value;};
  f.release=()=>{
    const run=spawnSync(process.execPath,['.harness/run.mjs','checkpoint','--reason','worker_yield','--summary','Fixture clearance sealed','--next','Authenticate retained clearance','--json'],
      {cwd:f.root,encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env,CODEX_THREAD_ID:f.owner}});
    assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout);
  };
  return f;
}

test('sealed clearance survives an actual normal yield through gate, inventory and source preservation',async t=>{
  const f=await releasedClearanceFixture(t);
  const retained=await Promise.all([beforePath,receiptPath,exoClearanceAuditPath,exoClearanceContinuePath,exoClearancePath,sourceContinuityArchivePath,f.preGateHold].map(file=>pinFile(f.root,file)));
  assert.equal((await f.authenticate()).holdCleared,true);
  f.release();
  assert.equal((await f.authenticate()).holdCleared,true);
  assert(Object.values(f.layers).every(count=>count>=2));
  for(const ref of retained) await authenticateFile(f.root,ref);
  await assert.rejects(()=>authenticateGate(f));
  await assert.rejects(()=>authenticateGateInventory(f.root));
  await assert.rejects(()=>authenticateSourceLifecycle(f.root,f.audit.sourceReleaseBoundary.lifecycle));
  await assert.rejects(()=>authenticateGate({...f,sourceRelease:{}}),/Unvalidated/);
});

test('released clearance rejects source drift, unsigned evidence, inventory changes and callback races',async t=>{
  const f=await releasedClearanceFixture(t); f.release();
  const files=new Map();
  async function visit(directory) {
    for(const entry of await readdir(path.join(f.root,directory),{withFileTypes:true})) {
      const relative=path.posix.join(directory,entry.name);
      if(entry.isDirectory()) await visit(relative); else files.set(relative,await readFile(path.join(f.root,relative)));
    }
  }
  await visit('.harness'); await visit('exo');
  const extras=['.harness/logs/extra.txt','.harness/evidence/extra.json'];
  const restore=async()=>{
    f.callback(null);
    for(const relative of extras) await rm(path.join(f.root,relative),{force:true});
    for(const [relative,bytes] of files) await writeFile(path.join(f.root,relative),bytes);
  };
  const edit=async(relative,mutate)=>{const value=await readJson(f.root,relative);mutate(value);await f.write(relative,value);};
  const continuity=mutate=>edit('.harness/continuity.json',mutate);
  const checkpoint=mutate=>continuity(value=>mutate(value.checkpoint));
  const signedBoundary=async mutate=>{const audit=clone(f.audit);mutate(audit.sourceReleaseBoundary,audit);await f.seal(audit);};
  const event=async mutate=>{
    const text=(await readFile(path.join(f.root,'.harness/events.jsonl'),'utf8')),lines=text.trimEnd().split('\n');
    const value=JSON.parse(lines.pop());mutate(value);await f.write('.harness/events.jsonl',lines.join('\n')+'\n'+JSON.stringify(value)+'\n');
  };
  const cases=[
    ['missing archive',()=>rm(path.join(f.root,sourceContinuityArchivePath))],
    ['tampered archive',()=>appendFile(path.join(f.root,sourceContinuityArchivePath),' ')],
    ['wrong archive path',()=>signedBoundary(b=>b.archive.path='.harness/continuity.json')],
    ['wrong archive hash',()=>signedBoundary(b=>b.archive.sha256='a'.repeat(64))],
    ['wrong archive length',()=>signedBoundary(b=>b.archive.bytes++)],
    ['archive differs from source snapshot',()=>signedBoundary(b=>b.lifecycle.continuity.lastRecovery={changed:true})],
    ['unbound source snapshot',()=>edit(exoClearanceAuditPath,a=>a.sourceReleaseBoundary.lifecycle.continuity.startedAt='changed')],
    ['missing source snapshot',()=>signedBoundary((b,a)=>delete a.sourceReleaseBoundary)],
    ['source snapshot reference order',()=>signedBoundary(b=>b.lifecycle.refs.reverse())],
    ['wrong source snapshot config',()=>signedBoundary(b=>b.config.sha256='a'.repeat(64))],
    ['wrong signed gate',()=>signedBoundary((b,a)=>a.gate.sha256='a'.repeat(64))],
    ['historical 004 gate reuse',()=>signedBoundary((b,a)=>a.gate.path=f.preGateHold)],
    ['failed gate',()=>edit(receiptPath,r=>r.pass=false)],
    ['missing independent review',()=>rm(path.join(f.root,exoClearanceContinuePath))],
    ['bad independent review',()=>edit(exoClearanceContinuePath,r=>r.signature='A'.repeat(86)+'==')],
    ['self review',()=>edit(exoClearanceContinuePath,r=>r.body.actor=f.owner)],
    ['HOLD review',()=>edit(exoClearanceContinuePath,r=>r.verdict='HOLD')],
    ['missing sealed receipt',()=>rm(path.join(f.root,exoClearancePath))],
    ['release before seal',()=>edit(exoClearancePath,r=>r.sealedAt=new Date(Date.now()+60000).toISOString())],
    ['invalid seal time',()=>edit(exoClearancePath,r=>r.sealedAt='2026-10-17')],
    ['new owner',()=>continuity(c=>c.owner={...f.audit.sourceReleaseBoundary.lifecycle.continuity.owner,id:'new-owner'})],
    ['old owner retained',()=>continuity(c=>c.owner=clone(f.audit.sourceReleaseBoundary.lifecycle.continuity.owner))],
    ['retired owner missing',()=>continuity(c=>c.retiredWorkerIds.pop())],
    ['retired owner order',()=>continuity(c=>c.retiredWorkerIds.reverse())],
    ['retired owner extra',()=>continuity(c=>c.retiredWorkerIds.push('extra'))],
    ['retired owner duplicate',()=>continuity(c=>c.retiredWorkerIds.push(f.owner))],
    ['needs_input release',()=>checkpoint(c=>c.reason='needs_input')],
    ['changed phase',()=>continuity(c=>c.phase='awaiting_resume')],
    ['new handoff',()=>continuity(c=>c.handoff={id:'extra'})],
    ['changed generation',()=>continuity(c=>c.generation++)],
    ['changed recovery',()=>continuity(c=>c.lastRecovery={changed:true})],
    ['changed last handoff',()=>continuity(c=>c.lastHandoff={changed:true})],
    ['changed start',()=>continuity(c=>c.startedAt='changed')],
    ['changed resume',()=>continuity(c=>c.resumedAt=new Date().toISOString())],
    ['checkpoint schema',()=>checkpoint(c=>c.extra=true)],
    ['checkpoint selected feature',()=>checkpoint(c=>c.selectedFeatureId='004')],
    ['checkpoint config',()=>checkpoint(c=>c.configHash='a'.repeat(64))],
    ['checkpoint revision',()=>checkpoint(c=>c.featureRevision++)],
    ['checkpoint automatic',()=>checkpoint(c=>c.automatic=true)],
    ['checkpoint repository schema',()=>checkpoint(c=>c.repository.extra=true)],
    ['checkpoint decisions type',()=>checkpoint(c=>c.decisions=[{}])],
    ['checkpoint forged ID',()=>checkpoint(c=>c.id='checkpoint-forged')],
    ['checkpoint predates seal',()=>checkpoint(c=>c.createdAt='2026-10-17T00:00:00.000Z')],
    ['missing release event',()=>f.write('.harness/events.jsonl',files.get('.harness/events.jsonl').subarray(0,f.audit.sourceReleaseBoundary.lifecycle.refs[4].bytes).toString('utf8'))],
    ['multiple release events',()=>appendFile(path.join(f.root,'.harness/events.jsonl'),'{"type":"checkpoint.written"}\n')],
    ['extra release whitespace',()=>appendFile(path.join(f.root,'.harness/events.jsonl'),'\n')],
    ['extra lifecycle event',()=>appendFile(path.join(f.root,'.harness/events.jsonl'),'{"type":"worker.recovered"}\n')],
    ...['checkpointId','summary','next','revision','generation','type','id','at'].map(key=>[`release event ${key}`,()=>event(e=>e[key]=typeof e[key]==='number'?e[key]+1:'changed')]),
    ['changed event prefix',()=>f.write('.harness/events.jsonl','{"retained":false}\n'+files.get('.harness/events.jsonl').toString('utf8').split('\n').slice(1).join('\n'))],
    ['edited progress',()=>appendFile(path.join(f.root,'.harness/progress.md'),'edited')],
    ['edited handoff',()=>appendFile(path.join(f.root,'.harness/handoff.md'),'edited')],
    ['changed source features',()=>edit('.harness/features.json',s=>s.revision++)],
    ['changed source config',()=>edit('.harness/config.json',c=>c.extra=true)],
    ['changed source runtime',()=>appendFile(path.join(f.root,'.harness/run.mjs'),'\n// changed')],
    ['changed Exo features',()=>edit('exo/.harness/features.json',s=>s.extra=true)],
    ['changed Exo config',()=>edit('exo/.harness/config.json',s=>s.extra=true)],
    ['changed Exo runtime',()=>appendFile(path.join(f.root,'exo/.harness/run.mjs'),'// changed')],
    ['changed Exo events',()=>appendFile(path.join(f.root,'exo/.harness/events.jsonl'),'{}\n')],
    ['new log',()=>f.write(extras[0],'extra')],
    ['new evidence',()=>f.write(extras[1],{})],
    ['replaced log',()=>f.write('.harness/logs/unreferenced.log','changed')],
    ['deleted log',()=>rm(path.join(f.root,'.harness/logs/old.stdout.log'))],
    ['replaced evidence',()=>f.write('.harness/evidence/unreferenced.json',{})],
    ['deleted evidence',()=>rm(path.join(f.root,'.harness/evidence/old-other.json'))],
    ['replaced startup log',()=>f.write(f.audit.startup.commands[0].logs.stdout.path,'changed')],
  ];
  for(const [name,mutate] of cases) await t.test(name,async()=>{
    try {await mutate();await assert.rejects(()=>f.authenticate(),undefined,name);} finally {await restore();}
  });
  for(const relative of [sourceContinuityArchivePath,'.harness/continuity.json','.harness/events.jsonl','.harness/progress.md','.harness/handoff.md',exoClearanceAuditPath]) {
    await t.test(`callback changes ${relative}`,async()=>{
      try {f.callback(()=>appendFile(path.join(f.root,relative),' '));await assert.rejects(()=>f.authenticate());} finally {await restore();}
    });
  }
  assert.equal((await f.authenticate()).holdCleared,true);
});

test('released checkpoint digests are advisory and never replace the authenticated lifecycle',async t=>{
  const f=await releasedClearanceFixture(t); f.release();
  const archived=f.audit.sourceReleaseBoundary.lifecycle;
  const current=await readJson(f.root,'.harness/continuity.json');
  // A schema-valid advisory row need not describe a real file. Independent
  // physical inventory/preservation checks, not checkpoint digests, decide safety.
  Object.assign(current.checkpoint.repository,{worktreeHash:'a'.repeat(64),changedFileCount:1,
    changedFiles:[{path:'advisory.txt',status:' M',hash:'a'.repeat(64)}]});
  await f.write('.harness/continuity.json',current);
  const progress=await readFile(path.join(f.root,'.harness/progress.md'),'utf8');
  const rendered=progress.replace(/(## Changed project files\n\n)[\s\S]*?(\n\n## Latest evidence)/,'$1- M advisory.txt$2');
  assert.notEqual(rendered,progress);
  await f.write('.harness/progress.md',rendered);
  const inventory=await authenticateGateInventory(f.root,await authenticateSourceRelease({root:f.root,publicKey:f.publicKey}));
  for(const [name,mutate] of [
    ['valid worktree digest',r=>r.worktreeHash='b'.repeat(64)],
    ['valid changed-file content digest',r=>r.changedFiles[0].hash='c'.repeat(64)],
    ['valid changed-file metadata digest and fingerprint',r=>Object.assign(r.changedFiles[0],{hash:`metadata-v1:${'d'.repeat(64)}`,fingerprint:'metadata-v1'})],
  ]) await t.test(name,async()=>{
    await f.write('.harness/continuity.json',current);
    const originalToken=await authenticateSourceRelease({root:f.root,publicKey:f.publicKey});
    const modified=clone(current); mutate(modified.checkpoint.repository);
    await f.write('.harness/continuity.json',modified);
    await assert.rejects(()=>releaseState(f.root,originalToken));
    const token=await authenticateSourceRelease({root:f.root,publicKey:f.publicKey});
    assert.deepEqual(await releaseState(f.root,token),archived);
    assert.deepEqual(await gateContinuity(f.root,archived.refs[1],token),archived.continuity);
    assert.deepEqual(await authenticateGateInventory(f.root,token),inventory);
    assert.deepEqual(await authenticateSourceLifecycle(f.root,archived,token),archived);
    assert.equal((await f.authenticate()).holdCleared,true);
  });
});
import {validateContextState, validateManagedInventory, authenticateContextInventory, authenticateObservedAddition, authenticatePrerequisiteArtifact, authenticatePrerequisiteInventory, loadInventoryAdmission, validateArchiveProvenance,proposeContextAdmission,extendContextAdmission,captureContextWitness,captureReadOnlyContextObservation,extendLifecycleAdmission} from '../scripts/fix-nine-rollout-inventory.mjs';
import {effectiveTarget,reconstructInventoryAdmission} from '../scripts/fix-nine-rollout-deployment.mjs';

test('finite lifecycle admission retains real pre-authority archives across signed audit and gate transfers',async t=>{
  const {copyFile}=await import('node:fs/promises');
  const root=await mkdtemp(path.join(tmpdir(),'rollout-real-lifecycle-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'.harness/hooks'),{recursive:true});await mkdir(path.join(root,'.harness/evidence'),{recursive:true});
  for(const name of ['run.mjs','context-budget.mjs','hooks/hook-recovery.mjs','hooks/native-hook-identity.mjs','hooks/precompact-handoff.mjs','hooks/sessionstart-routing.mjs'])await copyFile(path.join(process.cwd(),'skill/codex-harness/assets',name==='run.mjs'?'project-runtime.mjs':path.basename(name)),path.join(root,'.harness',name));
  const put=async(p,value)=>{await mkdir(path.dirname(path.join(root,p)),{recursive:true});await writeFile(path.join(root,p),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)+'\n');return pinFile(root,p);};
  const config={version:1,project:{name:'Lifecycle regression',purpose:'Authenticate real finite lifecycle additions',stack:[]},policies:{wipLimit:1,maxAttempts:5,maxRepeatedFailures:2,commandTimeoutMs:30000,passingIsTerminal:true,requireEvidence:true},execution:{setup:[],start:[],health:[],shutdown:[]},scope:{enforcement:'required',defaultAllow:['src/**'],defaultDeny:[],capture:{version:1,metadataRoots:[],metadataExtensions:[]}},continuity:{mode:'orchestrated_worker',dirtyWorktree:'record',blockMutationsAfterHandoff:true},security:{environmentAllow:['PATH','SystemRoot','TEMP','TMP'],redactOutput:true,credentials:{stateFile:'.harness/credentials-state.json',providers:{}}},docs:{required:[],router:'.harness/docs-map.md'}};
  config.verification={quick:[],full:['node --version'],architecture:[],e2e:[],clean:[]};config.completion={baseLayers:['full'],alwaysRunWhenConfigured:[],requireAcceptanceCommands:true};config.docs.required=[];config.agents={enabled:['codex'],instructions:{codex:'AGENTS.md'}};
  await put('.harness/config.json',config);await put('.harness/features.json',{version:1,revision:0,features:[]});await put('.harness/continuity.json',{version:1,phase:'working',generation:1,checkpoint:null,handoff:null});await put('.harness/credentials-state.json',{version:1,cursors:{}});
  for(const name of ['progress.md','handoff.md','docs-map.md'])await put(`.harness/${name}`,'# Fixture\n');
  await put('AGENTS.md','# Fixture\n## Development-Harness Boundary\n## Orchestrated-Worker Protocol\nORCHESTRATED_WORKER_CONTINUITY_V1\nRead .harness/config.json .harness/features.json .harness/continuity.json and .harness/run.mjs session and .harness/run.mjs resume.\n');
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|HOME|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)));
  Object.assign(env,{HOME:root,USERPROFILE:root,TEMP:root,TMP:root,CODEX_HOME:path.join(root,'fixture-codex'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'empty-gitconfig'),GIT_CONFIG_COUNT:'0',GIT_TERMINAL_PROMPT:'0'});await put('empty-gitconfig','');
  const exec=(command,args,commandEnv=env)=>{const result=spawnSync(command,args,{cwd:root,env:commandEnv,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr||result.stdout);return result.stdout;};
  for(const args of [['init'],['config','user.email','fixture@example.test'],['config','user.name','Fixture'],['add','.'],['commit','-m','Fixture']])exec('git',args);
  const actors=[1,2,3,4].map(i=>`${i}`.repeat(8)+'-'+`${i}`.repeat(4)+'-4'+`${i}`.repeat(3)+'-8'+`${i}`.repeat(3)+'-'+`${i}`.repeat(12));
  const run=(actor,...args)=>exec(process.execPath,[path.join(root,'.harness/run.mjs'),...args],{...env,CODEX_THREAD_ID:actor,CODEX_SESSION_ID:'shared-parent'});
  const io={pin:p=>pinFile(root,p),authenticate:ref=>authenticateFile(root,ref),prefix:ref=>authenticatePrefix(root,ref)};
  const snapshot=async()=>{const refs=await Promise.all(['features.json','continuity.json','progress.md','handoff.md','events.jsonl'].map(p=>io.pin(`.harness/${p}`)));return {features:JSON.parse(await io.authenticate(refs[0])),continuity:JSON.parse(await io.authenticate(refs[1])),refs};};
  const archiveRow=async id=>{const events=(await readFile(path.join(root,'.harness/events.jsonl'),'utf8')).trimEnd().split('\n').map(JSON.parse);const row={ref:await io.pin(`.harness/history/progress/${id}.md`),handoffId:id};for(const [key,type]of [['ready','handoff.ready'],['resumed','worker.resumed']]){const event=events.find(e=>e.handoffId===id&&e.type===type);assert(event);assert.equal(event.archive,undefined);row[key]={id:event.id,sha256:createHash('sha256').update(JSON.stringify(event)).digest('hex')};}return row;};
  const transfer=async(from,to)=>{const progress=await readFile(path.join(root,'.harness/progress.md'));run(from,'handoff','--summary','Real bounded transfer','--next','Continue fixture');const pending=JSON.parse(await readFile(path.join(root,'.harness/continuity.json'),'utf8'));assert.match(pending.handoff.id,/^handoff-\d{17}-[a-f0-9]{8}$/);assert.deepEqual(await readFile(path.join(root,`.harness/history/progress/${pending.handoff.id}.md`)),progress);run(to,'resume',pending.handoff.id);run(to,'context','--observe','--json');return archiveRow(pending.handoff.id);};
  run(actors[0],'claim');run(actors[0],'add','fix-nine-rollout-001','--title','Fixture','--description','Fixture','--criterion','Fixture','--command','node --version','--allow','src/**');run(actors[0],'start','fix-nine-rollout-001');
  const first=await transfer(actors[0],actors[1]);let current=await snapshot();
  const historical=await put('.harness/logs/historical-fixture.log','Immutable prior observation\n');
  const immutable=await loadInventoryAdmission(undefined,{authenticate:ref=>authenticateFile(process.cwd(),ref),prefix:ref=>authenticatePrefix(process.cwd(),ref)});
  const prerequisiteArtifacts=new Map(immutable.prerequisiteArtifacts);
  for(const ref of prerequisiteArtifacts.values()) await put(ref.path,await readFile(path.join(process.cwd(),ref.path)));
  const log=await put('.harness/logs/finite-observation.log','Exact bounded observation\n'),base={pins:new Map([[historical.path,historical]]),contexts:new Map(),prerequisiteArtifacts,contextWriter:await io.pin('.harness/context-budget.mjs')};
  const proposal=()=>({version:1,kind:'fix-nine-rollout-finite-lifecycle-additions',executionAuthorized:false,contextWriter:base.contextWriter,eventPrefix:current.refs.find(r=>r.path==='.harness/events.jsonl'),logs:[log],archives:[first]});
  current.lifecycleAdmission=proposal();current.contextAdmission=await proposeContextAdmission(base,current,io);
  const preservation=await put('.harness/fixture-preservation.json',{files:[first.ref,log,...prerequisiteArtifacts.values()]});
  const target={index:0,root:deploymentTargets[0],lifecycle:current,preservation};
  const keys=generateKeyPairSync('ed25519'),seal=(kind,body)=>({version:1,kind,verdict:'CONTINUE',body,signature:sign(null,reviewPayload(kind,body),keys.privateKey).toString('base64')});
  const authorityRef=await put('.harness/fixture-authority.json',{targets:[target]}),closure=await put('.harness/fixture-closure.json',{}),body={authority:authorityRef,sourceClosure:closure,targetRoots:deploymentTargets,scope:'ordered-eleven-deployment-only'};
  const authorityReview=await put('.harness/fixture-authority-review.json',seal('execution-authority',body));
  const reloadAuthority=async(review=authorityReview)=>{const authority={ref:authorityRef,closure,value:JSON.parse(await io.authenticate(authorityRef))};validateReview(JSON.parse(await io.authenticate(review)),'execution-authority',body,keys.publicKey);Object.defineProperty(authority.value.targets[0],'inventoryAdmission',{value:await reconstructInventoryAdmission(base,authority.value.targets[0].lifecycle,io),configurable:true});return authority;};
  let authority=await reloadAuthority();
  const unsigned=await put('.harness/fixture-invalid-authority-review.json',{...seal('execution-authority',body),signature:'invalid'});await assert.rejects(()=>reloadAuthority(unsigned));
  assert.deepEqual(authority.value.targets[0].inventoryAdmission.pins.get(first.ref.path),first.ref);
  assert.deepEqual(authority.value.targets[0].inventoryAdmission.prerequisiteArtifacts,prerequisiteArtifacts);
  await authenticatePrerequisiteInventory(JSON.parse(await io.authenticate(preservation)),authority.value.targets[0].inventoryAdmission,io);
  const good=clone(current.lifecycleAdmission);
  const omittedInitial=clone(current);delete omittedInitial.lifecycleAdmission;const omittedPins=await reconstructInventoryAdmission(base,omittedInitial,io);await assert.rejects(()=>authenticateObservedAddition(root,first.ref,omittedPins),/Unreviewed/);await assert.rejects(()=>authenticateObservedAddition(root,{...first.ref,path:'.harness/history/progress/handoff-20261018000000000-ffffffff.md'},authority.value.targets[0].inventoryAdmission),/Unreviewed/);
  const detached=await extendLifecycleAdmission(base,good,current,io);good.archives[0].ref.sha256='f'.repeat(64);assert.deepEqual(detached.pins.get(first.ref.path),first.ref);good.archives[0].ref.sha256=first.ref.sha256;
  await assert.rejects(()=>extendLifecycleAdmission(base,good,{...current,refs:[...current.refs,current.lifecycleAdmission.eventPrefix]},io),/Exactly one/);
  await assert.rejects(()=>extendLifecycleAdmission(base,good,{...current,continuity:{...current.continuity,generation:1}},io),/generation/);
  for(const change of [p=>delete p.kind,p=>p.extra=true,p=>p.logs.push(clone(log)),p=>p.logs[0].path='.harness/logs/../injected',p=>p.logs[0].path='.harness/LOGS/finite-observation.log',p=>p.logs[0].path='.harness/evidence/injected.json',p=>p.logs[0].path='C:/absolute',p=>p.logs[0].path='.harness\\logs\\bad',p=>p.archives[0].ready.id='missing',p=>p.archives[0].resumed.sha256='f'.repeat(64),p=>p.eventPrefix.bytes--]){const changed=clone(good);change(changed);await assert.rejects(()=>extendLifecycleAdmission(base,changed,current,io));}
  await assert.rejects(()=>extendLifecycleAdmission({...base,pins:new Map([[log.path,log]])},good,current,io),/existing pin/);
  const eventBytes=await readFile(path.join(root,'.harness/events.jsonl'));
  const eventRows=eventBytes.toString('utf8').trimEnd().split('\n').map(JSON.parse);
  for(const key of ['ready','resumed'])for(const duplicate of [false,true]){const rows=eventRows.filter(row=>duplicate||row.id!==first[key].id);if(duplicate)rows.push({...eventRows.find(row=>row.id===first[key].id),id:'duplicate-'+key});await writeFile(path.join(root,'.harness/events.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');const changed=clone(current);changed.refs=await Promise.all(current.refs.map(r=>r.path==='.harness/events.jsonl'?io.pin(r.path):r));changed.lifecycleAdmission.eventPrefix=changed.refs.find(r=>r.path==='.harness/events.jsonl');await assert.rejects(()=>extendLifecycleAdmission(base,changed.lifecycleAdmission,changed,io),/unique/);}await writeFile(path.join(root,'.harness/events.jsonl'),eventBytes);
  for(const suffix of ['\n',JSON.stringify({id:first.ready.id,type:'unrelated'})+'\n','{"cut":']){await writeFile(path.join(root,'.harness/events.jsonl'),Buffer.concat([eventBytes,Buffer.from(suffix)]));const changed=clone(current);changed.refs=await Promise.all(current.refs.map(r=>r.path==='.harness/events.jsonl'?io.pin(r.path):r));changed.lifecycleAdmission.eventPrefix=changed.refs.find(r=>r.path==='.harness/events.jsonl');await assert.rejects(()=>extendLifecycleAdmission(base,changed.lifecycleAdmission,changed,io));}await writeFile(path.join(root,'.harness/events.jsonl'),eventBytes);
  const chain=[];let previous=authority.ref;
  for(let i=2;i<actors.length;i++){
    const prior=current,archive=await transfer(actors[i-1],actors[i]);current=await snapshot();current.additions=[...(prior.additions??[]),archive.ref];
    current.lifecycleAdmission={...clone(prior.lifecycleAdmission),eventPrefix:current.refs.find(r=>r.path==='.harness/events.jsonl'),archives:[...prior.lifecycleAdmission.archives,archive]};
    authority=await reloadAuthority();const old=await effectiveTarget(authority,chain,io,[],keys.publicKey);const finite=await extendLifecycleAdmission(old.inventoryAdmission,current.lifecycleAdmission,current,io,{previous:prior.lifecycleAdmission});current.contextAdmission=await proposeContextAdmission(finite,current,io,prior.contextAdmission);
    const packet=current.continuity.lastHandoff,events=(await readFile(path.join(root,'.harness/events.jsonl'),'utf8')).trimEnd().split('\n').map(JSON.parse).filter(e=>e.handoffId===packet.id&&['handoff.ready','worker.resumed'].includes(e.type));
    const plan={target:deploymentTargets[0],planHash:String(i).repeat(64),blocked:false,operations:[]};const record={index:0,root:plan.target,authority:authority.ref,sourceClosure:authority.closure,previous,oldLifecycle:prior.refs,lifecycle:current,transfer:{packet,events,archive:archive.ref,driftDisposition:'none'},plan:await put(`.harness/plan-${i}.json`,plan),planHash:plan.planHash};
    const refresh=await put(`.harness/refresh-${i}.json`,record),reviewBody={refresh,authority:authority.ref,sourceClosure:authority.closure,scope:'source-lifecycle-and-exact-plan-only'},review=await put(`.harness/review-${i}.json`,seal('source-lifecycle-refresh',reviewBody));
    const omitted=clone(record);delete omitted.lifecycle.lifecycleAdmission;const omittedRef=await put(`.harness/omitted-${i}.json`,omitted),omittedBody={...reviewBody,refresh:omittedRef},omittedReview=await put(`.harness/omitted-review-${i}.json`,seal('source-lifecycle-refresh',omittedBody));await assert.rejects(()=>effectiveTarget(authority,[...chain,{refresh:omittedRef,review:omittedReview}],io,[],keys.publicKey),/disappeared/);
    for(const mutate of [p=>p.logs=[],p=>p.archives.reverse(),p=>p.archives[0].ref=archive.ref]){const bad=clone(current.lifecycleAdmission);mutate(bad);await assert.rejects(()=>extendLifecycleAdmission(old.inventoryAdmission,bad,current,io,{previous:prior.lifecycleAdmission}));}
    chain.push({refresh,review});previous=refresh;
    const badReview=await put(`.harness/bad-review-${i}.json`,{...seal('source-lifecycle-refresh',reviewBody),signature:'invalid'});await assert.rejects(()=>effectiveTarget(authority,[...chain.slice(0,-1),{refresh,review:badReview}],io,[],keys.publicKey));
    if(chain.length>1)await assert.rejects(()=>effectiveTarget(authority,chain.slice(1),io,[],keys.publicKey));
    const admitted=await effectiveTarget(authority,JSON.parse(JSON.stringify(chain)),io,[],keys.publicKey);assert.deepEqual(admitted.inventoryAdmission.pins.get(first.ref.path),first.ref);assert.deepEqual(admitted.inventoryAdmission.pins.get(historical.path),historical);assert.equal(admitted.lifecycle.lifecycleAdmission.archives.length,i);
    assert.deepEqual(admitted.inventoryAdmission.prerequisiteArtifacts,prerequisiteArtifacts);
    for(const ref of prerequisiteArtifacts.values()) assert.equal(admitted.inventoryAdmission.pins.has(ref.path),false);
    await authenticatePrerequisiteInventory(JSON.parse(await io.authenticate(preservation)),admitted.inventoryAdmission,io);
  }
  for(const ref of prerequisiteArtifacts.values()) {
    const file=path.join(root,ref.path),raw=await readFile(file);
    await appendFile(file,'tampered');await assert.rejects(()=>effectiveTarget(authority,chain,io,[],keys.publicKey));
    await writeFile(file,raw);await rm(file);await assert.rejects(()=>effectiveTarget(authority,chain,io,[],keys.publicKey));await writeFile(file,raw);
  }
  const original=await readFile(path.join(root,first.ref.path));for(const replacement of [Buffer.from('changed archive'),await readFile(path.join(root,current.lifecycleAdmission.archives.at(-1).ref.path))]){await writeFile(path.join(root,first.ref.path),replacement);await assert.rejects(()=>effectiveTarget(authority,chain,io,[],keys.publicKey));}await writeFile(path.join(root,first.ref.path),original);await rm(path.join(root,first.ref.path));await assert.rejects(()=>effectiveTarget(authority,chain,io,[],keys.publicKey));
});

test('inventory context schema permits writer counters and compaction resets but rejects malformed fields',()=>{
  const actorHash='a'.repeat(64);
  const state={version:1,actorHash,role:'orchestrator',startedAt:'2026-10-18T00:00:00.000Z',updatedAt:'2026-10-18T00:00:01.000Z',mutations:0,toolCalls:0,outputChars:0,telemetry:{status:'unavailable',bytesSinceUsage:0,interruptedGoals:0,goalPrompts:0,interruptions:0},lastNotice:null};
  assert.equal(validateContextState(state,actorHash),state);
  state.telemetry.identity=actorHash;assert.equal(validateContextState(state,actorHash),state);
  for(const mutate of [s=>s.actorHash='b'.repeat(64),s=>s.version=2,s=>s.role='owner',s=>s.toolCalls=-1,s=>s.updatedAt='tomorrow',s=>s.telemetry.extra=true,s=>s.telemetry.identity=[actorHash],s=>s.authority=true]) {
    const changed=structuredClone(state); mutate(changed); assert.throws(()=>validateContextState(changed,actorHash));
  }
});

test('managed inventory admission requires the entire exact fifteen-entry candidate map',()=>{
  const candidate={source:{managed:Array.from({length:15},(_,i)=>({installed:{path:`.harness/file-${i}`,sha256:String(i).padStart(64,'0')}}))}};
  const value={version:1,files:Object.fromEntries(candidate.source.managed.map(row=>[row.installed.path,row.installed.sha256]))};
  validateManagedInventory(value,candidate);
  for(const mutate of [v=>v.version=2,v=>delete v.files['.harness/file-1'],v=>v.files.extra='a'.repeat(64),v=>v.files['.harness/file-0']='f'.repeat(64)]) {
    const changed=structuredClone(value);mutate(changed);assert.throws(()=>validateManagedInventory(changed,candidate));
  }
});

test('observed archival admission rejects unknown paths and changed captured pins',async()=>{
  const ref={path:'.harness/logs/observed.log',bytes:1,sha256:'a'.repeat(64)};
  const admission={pins:new Map([[ref.path,ref]])};
  await assert.rejects(()=>authenticateObservedAddition('.',{...ref,path:'.harness/logs/injected.log'},admission),/Unreviewed/);
  await assert.rejects(()=>authenticateObservedAddition('.',{...ref,sha256:'b'.repeat(64)},admission));
});

test('context inventory derives actors from owned continuity and does not accept path-shaped identity claims',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'rollout-context-'));
  try {
    const actor='inventory-fixture-owner',actorHash=createHash('sha256').update(actor).digest('hex');
    const relative=`.harness/context/${actorHash}.json`;
    await mkdir(path.join(root,'.harness/context'),{recursive:true});
    const value={version:1,actorHash,role:'worker',startedAt:'2026-10-18T00:00:00.000Z',updatedAt:'2026-10-18T00:00:01.000Z',mutations:0,toolCalls:1,outputChars:2,telemetry:{status:'unavailable',bytesSinceUsage:0,interruptedGoals:0,goalPrompts:0,interruptions:0},lastNotice:null};
    await writeFile(path.join(root,relative),JSON.stringify(value));
    const continuity={owner:{id:actor,parentSessionId:'parent'},retiredWorkerIds:[]},admission={contexts:new Map([[relative,{path:relative}]])};
    await assert.rejects(()=>authenticateContextInventory(root,relative,continuity,{contexts:new Map()}),/Unreviewed context path/);
    assert.equal(await authenticateContextInventory(root,relative,continuity,admission),true);
    value.toolCalls=12;value.outputChars=30;await writeFile(path.join(root,relative),JSON.stringify(value));
    assert.equal(await authenticateContextInventory(root,relative,continuity,admission),true);
    await assert.rejects(()=>authenticateContextInventory(root,relative,{owner:{id:'different'},retiredWorkerIds:[]},admission),/Unauthenticated/);
    value.telemetry.ownership=true;await writeFile(path.join(root,relative),JSON.stringify(value));
    await assert.rejects(()=>authenticateContextInventory(root,relative,continuity,admission),/Unexpected/);
    assert.equal(await authenticateContextInventory(root,relative+'.tmp',continuity,admission),false);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('finite inventory loader authenticates the candidate even when supplied and binds lifecycle witnesses',async()=>{
  const {authenticateFile:auth,authenticatePrefix:prefix}=await import('../scripts/fix-nine-rollout-files.mjs');
  const root=process.cwd(),calls=[];
  const io={authenticate:async ref=>{calls.push(ref.path);return auth(root,ref);},prefix:ref=>prefix(root,ref)};
  const admission=await loadInventoryAdmission(undefined,io);
  assert.equal(admission.contexts.size,28);
  assert.equal(admission.prerequisiteArtifacts.size,8);
  for(const ref of admission.prerequisiteArtifacts.values()) {assert(!admission.pins.has(ref.path));assert(calls.includes(ref.path));}
  const candidate=structuredClone(admission.candidate);candidate.source.managed[0].installed.sha256='a'.repeat(64);
  await assert.rejects(()=>loadInventoryAdmission(candidate,io),/Supplied inventory candidate/);
  assert.equal(calls.filter(p=>p.endsWith('/source-closure-candidate.json')).length,2);
  const extension=JSON.parse(await readFile('.harness/fix-nine-rollout-001/inventory-lifecycle-admission-g142.json','utf8'));
  const events=(await prefix(root,extension.eventPrefix)).subarray(0,extension.eventPrefix.bytes).toString('utf8').trim().split('\n').map(JSON.parse);
  const archive=extension.archives[0];validateArchiveProvenance(archive,events);
  for(const mutate of [a=>a.ref.path='.harness/history/progress/injected.md',a=>a.ready.sha256='f'.repeat(64),a=>a.resumed.id='unknown']) {
    const changed=structuredClone(archive);mutate(changed);assert.throws(()=>validateArchiveProvenance(changed,events));
  }
  assert.throws(()=>validateArchiveProvenance(archive,events.filter(e=>e.id!==archive.ready.id)),/unique/);
  assert.throws(()=>validateArchiveProvenance(archive,[...events,events.find(e=>e.id===archive.resumed.id)]),/unique/);
  const unrelated=structuredClone(extension);unrelated.archives[0].ref.path='.harness/history/injected.md';
  await assert.rejects(()=>loadInventoryAdmission(undefined,{...io,authenticate:ref=>ref.path.endsWith('/inventory-lifecycle-admission-g142.json')?Buffer.from(JSON.stringify(unrelated)):io.authenticate(ref)}));
  const supplementPath='.harness/fix-nine-rollout-001/inventory-admission-supplement-g140.json';
  const supplement=JSON.parse(await readFile(supplementPath,'utf8'));
  for(const mutate of [
    value=>value.prerequisiteArtifacts.push(clone(value.prerequisiteArtifacts[0])),
    value=>value.prerequisiteArtifacts[0].ref.path='.harness/source-historical-budget-compat-002/ninth.log',
    value=>value.prerequisiteArtifacts[0].ref.path='.harness/logs/class-collision.log',
    value=>value.prerequisiteArtifacts[0].ref.sha256='f'.repeat(64),
    value=>value.prerequisiteArtifacts[0].ref.path='.harness/source-historical-budget-compat-002/../unsafe.log',
    value=>value.prerequisiteArtifacts[1]=clone(value.prerequisiteArtifacts[0]),
  ]) {
    const changed=clone(supplement);mutate(changed);
    await assert.rejects(()=>loadInventoryAdmission(undefined,{...io,authenticate:ref=>ref.path===supplementPath?Buffer.from(JSON.stringify(changed)):io.authenticate(ref)}));
  }
  const diagnosticPath=supplement.diagnostic.path,observed=JSON.parse(await readFile(diagnosticPath,'utf8'));
  observed.rows[0].changes.find(row=>row.path===supplement.prerequisiteArtifacts[0].ref.path).before=clone(supplement.prerequisiteArtifacts[0].ref);
  await assert.rejects(()=>loadInventoryAdmission(undefined,{...io,authenticate:ref=>ref.path===diagnosticPath?Buffer.from(JSON.stringify(observed)):io.authenticate(ref)}));
});

test('finite context proposals reject unrelated actors, conflicting snapshots and removal',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'rollout-context-proposal-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const io={pin:p=>pinFile(root,p),authenticate:r=>authenticateFile(root,r)};
  const put=async(p,value)=>{await mkdir(path.dirname(path.join(root,p)),{recursive:true});await writeFile(path.join(root,p),typeof value==='string'?value:JSON.stringify(value));return io.pin(p);};
  const actor='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
  const relative=`.harness/context/${createHash('sha256').update(actor).digest('hex')}.json`;
  const value={version:1,actorHash:createHash('sha256').update(actor).digest('hex'),role:'worker',startedAt:'2026-10-18T00:00:00.000Z',updatedAt:'2026-10-18T00:00:01.000Z',mutations:0,toolCalls:0,outputChars:0,telemetry:{status:'unavailable',bytesSinceUsage:0,interruptedGoals:0,goalPrompts:0,interruptions:0},lastNotice:null};
  await put(relative,value);
  const base={contexts:new Map(),contextWriter:await put('.harness/context-budget.mjs','// exact fixture writer')};
  const lifecycle={continuity:{generation:1,owner:{id:actor,source:'CODEX_THREAD_ID',parentSessionId:null},retiredWorkerIds:[other]},refs:[await put('.harness/events.jsonl','retained\n')]};
  const proposal=await proposeContextAdmission(base,lifecycle,io),inventory=await extendContextAdmission(base,proposal,lifecycle,io);
  assert.equal(inventory.contexts.size,1);assert.equal(base.contexts.size,0);
  await assert.rejects(()=>proposeContextAdmission(base,lifecycle,io,null,[other]),/current native owner/);
  for(const mutate of [p=>p.contexts.push(clone(p.contexts[0])),p=>p.contexts[0].actor=other,p=>p.contexts[0].captured.path+='.tmp',p=>p.contexts[0].snapshot+=' ',p=>p.contexts[0].witness.generation++,p=>p.contextWriter.sha256='a'.repeat(64)]) {
    const changed=clone(proposal);mutate(changed);await assert.rejects(()=>extendContextAdmission(base,changed,lifecycle,io));
  }
  await assert.rejects(()=>extendContextAdmission(inventory,{...proposal,contexts:[]},lifecycle,io,{previous:proposal}),/changed or disappeared/);
  await assert.rejects(()=>extendContextAdmission(inventory,undefined,lifecycle,io,{previous:proposal}),/disappeared/);
  value.toolCalls=100;await put(relative,value);
  assert.equal(await authenticateContextInventory(root,relative,{owner:{id:other}},inventory),true);
  await assert.rejects(()=>authenticateContextInventory(root,relative,lifecycle.continuity,base),/Unreviewed context/);
  await put('.harness/context-budget.mjs','// changed writer');
  await assert.rejects(()=>extendContextAdmission(base,proposal,lifecycle,io));
});

test('signed finite context chain spans prepare, source apply, handoff audit and later gate owners',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'rollout-context-chain-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const io={pin:p=>pinFile(root,p),authenticate:r=>authenticateFile(root,r),prefix:r=>authenticatePrefix(root,r)};
  const put=async(p,value)=>{await mkdir(path.dirname(path.join(root,p)),{recursive:true});await writeFile(path.join(root,p),typeof value==='string'?value:JSON.stringify(value));return io.pin(p);};
  const actors=[1,2,3,4].map(i=>`${i}`.repeat(8)+'-'+`${i}`.repeat(4)+'-4'+`${i}`.repeat(3)+'-8'+`${i}`.repeat(3)+'-'+`${i}`.repeat(12));
  const contextPath=actor=>`.harness/context/${createHash('sha256').update(actor).digest('hex')}.json`;
  const writeContext=actor=>put(contextPath(actor),{version:1,actorHash:createHash('sha256').update(actor).digest('hex'),role:'worker',startedAt:'2026-10-18T00:00:00.000Z',updatedAt:'2026-10-18T00:00:01.000Z',mutations:0,toolCalls:1,outputChars:2,telemetry:{status:'unavailable',bytesSinceUsage:0,interruptedGoals:0,goalPrompts:0,interruptions:0},lastNotice:null});
  const frozen='.harness/context/0d35bf860a6c608273372618da9182777e72ef637e30d2986703573dee0b39cd.json';
  const base={contexts:new Map([[frozen,await put(frozen,'unidentified frozen observation')]]),contextWriter:await put('.harness/context-budget.mjs','// exact installed writer')};
  let current=transferFixture().before;
  current.continuity.owner.id=actors[0];current.refs=[await put('.harness/events.jsonl','{"retained":true}\n')];
  await writeContext(actors[0]);current.contextAdmission=await proposeContextAdmission(base,current,io);
  const preservation=await put('.harness/fixture-preservation.json',{files:[await io.pin(frozen),await io.pin(contextPath(actors[0]))]});
  const target={index:0,root:deploymentTargets[0],lifecycle:current,preservation};
  const authority={ref:await put('.harness/fixture-authority.json',{targets:[target]}),closure:await put('.harness/fixture-closure.json',{}),value:{targets:[target]}};
  const keys=generateKeyPairSync('ed25519'),seal=(kind,body)=>({version:1,kind,verdict:'CONTINUE',body,signature:sign(null,reviewPayload(kind,body),keys.privateKey).toString('base64')});
  const authorityBody={authority:authority.ref,sourceClosure:authority.closure,targetRoots:deploymentTargets,scope:'ordered-eleven-deployment-only'};
  validateReview(seal('execution-authority',authorityBody),'execution-authority',authorityBody,keys.publicKey);
  Object.defineProperty(target,'inventoryAdmission',{value:await extendContextAdmission(base,current.contextAdmission,current,io)});
  // Source apply keeps the same actor. Each later audit/gate/clearance owner
  // requires its exact physical ready/resumed pair and a new signed refresh.
  const chain=[];let previous=authority.ref;
  for(let i=1;i<actors.length;i++) {
    const prior=current,packet={...transferFixture().proof.packet,id:`fixture-transfer-${i}`,owner:clone(prior.continuity.owner),resumedAt:'2026-10-18T00:00:02.000Z'};
    current=clone(prior);const generation=prior.continuity.generation+1;
    current.continuity={...current.continuity,generation,lastHandoff:packet,retiredWorkerIds:[...prior.continuity.retiredWorkerIds,prior.continuity.owner.id],owner:{...prior.continuity.owner,id:actors[i],generation,claimedAt:packet.resumedAt}};
    const proof={packet,driftDisposition:'none',events:[{type:'handoff.ready',handoffId:packet.id,generation:generation-1,revision:packet.featureRevision,at:'2026-10-18T00:00:01.000Z'},{type:'worker.resumed',handoffId:packet.id,generation,at:'2026-10-18T00:00:03.000Z',drift:[],driftAccepted:false}],archive:await put(`.harness/history/progress/${packet.id}.md`,`immutable archive ${i}`)};
    await appendFile(path.join(root,'.harness/events.jsonl'),proof.events.map(e=>JSON.stringify(e)).join('\n')+'\n');
    current.refs=[await io.pin('.harness/events.jsonl')];current.additions=[...(prior.additions??[]),proof.archive];
    await writeContext(actors[i]);
    const old=await effectiveTarget(authority,chain,io,[],keys.publicKey);
    await assert.rejects(()=>authenticateContextInventory(root,contextPath(actors[i]),current.continuity,old.inventoryAdmission),/Unreviewed context/);
    current.contextAdmission=await proposeContextAdmission(old.inventoryAdmission,current,io,prior.contextAdmission);
    const plan={target:deploymentTargets[0],planHash:`${i}`.repeat(64),blocked:false,operations:[]};
    const refresh=await put(`.harness/refresh-${i}.json`,{index:0,root:plan.target,authority:authority.ref,sourceClosure:authority.closure,previous,oldLifecycle:prior.refs,lifecycle:current,transfer:proof,plan:await put(`.harness/plan-${i}.json`,plan),planHash:plan.planHash});
    const body={refresh,authority:authority.ref,sourceClosure:authority.closure,scope:'source-lifecycle-and-exact-plan-only'},review=await put(`.harness/review-${i}.json`,seal('source-lifecycle-refresh',body));
    const unsignedReview=await put(`.harness/unsigned-${i}.json`,{version:1,kind:'source-lifecycle-refresh',verdict:'CONTINUE',body,signature:'A'.repeat(86)+'=='});
    await assert.rejects(()=>effectiveTarget(authority,[...chain,{refresh,review:unsignedReview}],io,[],keys.publicKey),/review signature/);
    chain.push({refresh,review});previous=refresh;
    const admitted=await effectiveTarget(authority,chain,io,[],keys.publicKey);
    for(const actor of actors.slice(0,i+1)) assert.equal(await authenticateContextInventory(root,contextPath(actor),current.continuity,admitted.inventoryAdmission),true);
    assert.equal(await authenticateContextInventory(root,frozen,current.continuity,admitted.inventoryAdmission),true);
  }
  const latest=await effectiveTarget(authority,chain,io,[],keys.publicKey);
  assert.equal(latest.inventoryAdmission.contexts.size,5);assert.equal(latest.lifecycle.additions.length,3);
  await appendFile(path.join(root,latest.lifecycle.additions[0].path),'tamper');
  await assert.rejects(()=>effectiveTarget(authority,chain,io,[],keys.publicKey));
});

test('frozen historical context pins reject mutation and deletion and regular context rejects junctions',async()=>{
  const {pinFile:pin}=await import('../scripts/fix-nine-rollout-files.mjs');
  const root=await mkdtemp(path.join(tmpdir(),'rollout-frozen-'));
  const outside=await mkdtemp(path.join(tmpdir(),'rollout-context-outside-'));
  try {
    const hash='0d35bf860a6c608273372618da9182777e72ef637e30d2986703573dee0b39cd';
    const relative=`.harness/context/${hash}.json`;
    await mkdir(path.join(root,'.harness/context'),{recursive:true});await writeFile(path.join(root,relative),'frozen observation');
    const ref=await pin(root,relative),admission={contexts:new Map([[relative,ref]])};
    assert.equal(await authenticateContextInventory(root,relative,{},admission),true);
    await writeFile(path.join(root,relative),'changed observation');await assert.rejects(()=>authenticateContextInventory(root,relative,{},admission));
    await rm(path.join(root,relative));await assert.rejects(()=>authenticateContextInventory(root,relative,{},admission));
    await rm(path.join(root,'.harness/context'),{recursive:true});
    await symlink(outside,path.join(root,'.harness/context'),process.platform==='win32'?'junction':'dir');
    await writeFile(path.join(outside,`${hash}.json`),'frozen observation');
    await assert.rejects(()=>authenticateContextInventory(root,relative,{},admission));
  } finally {await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});

test('new lifecycle archives need the exact authenticated transfer pin',async()=>{
  const ref={path:'.harness/history/progress/handoff-20261018000000000-aaaaaaaa.md',bytes:1,sha256:'a'.repeat(64)};
  const io={authenticate:async()=>Buffer.from('x')},current={additions:[ref]},base={files:[]};
  await assert.rejects(()=>authenticateAdditions(base,{additions:[]},current,io));
  await assert.rejects(()=>authenticateAdditions(base,{additions:[]},current,io,{archive:{...ref,sha256:'b'.repeat(64)}}));
  await authenticateAdditions(base,{additions:[]},current,io,{archive:ref});
  await authenticateAdditions(base,current,current,io);
  await assert.rejects(()=>authenticateAdditions(base,current,{additions:[]},io),/changed or disappeared/);
});

test('pre-authority signer yield admits only independently signed exact native observations',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'rollout-owned-witness-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const signer=createReviewSigner(),owner='11111111-1111-4111-8111-111111111111',next='22222222-2222-4222-8222-222222222222',reviewer='33333333-3333-4333-8333-333333333333';
  const io={pin:p=>pinFile(root,p),authenticate:r=>authenticateFile(root,r),prefix:r=>authenticatePrefix(root,r),reviewContextWitness:(seal,body)=>validateReview(seal,'context-owner-witness',body,signer.publicKey)};
  const put=async(p,v)=>{await mkdir(path.dirname(path.join(root,p)),{recursive:true});await writeFile(path.join(root,p),typeof v==='string'?v:JSON.stringify(v));return io.pin(p);};
  const context=async actor=>put(`.harness/context/${createHash('sha256').update(actor).digest('hex')}.json`,{version:1,actorHash:createHash('sha256').update(actor).digest('hex'),role:'worker',startedAt:'2026-10-18T00:00:00.000Z',updatedAt:'2026-10-18T00:00:01.000Z',mutations:0,toolCalls:1,outputChars:2,telemetry:{status:'unavailable',bytesSinceUsage:0,interruptedGoals:0,goalPrompts:0,interruptions:0},lastNotice:null});
  const base={contexts:new Map(),contextWriter:await put('.harness/context-budget.mjs','// reviewed writer')};await context(owner);
  const old={continuity:{generation:143,owner:{id:owner,source:'CODEX_THREAD_ID',parentSessionId:null}},refs:[]};
  old.refs=[await put('.harness/continuity.json',old.continuity),await put('.harness/events.jsonl','{"type":"worker.resumed","generation":143}\n')];
  const observation=await captureContextWitness(base,old,io),bytes=JSON.stringify(observation);
  const record=await put(`.harness/fix-nine-rollout-001/context-witness-${createHash('sha256').update(bytes).digest('hex')}.json`,bytes);
  // A normal worker yield and fresh claim replace continuity; actor-free old
  // events and the retired list do not authenticate the old native identity.
  await appendFile(path.join(root,'.harness/events.jsonl'),' {"type":"checkpoint.written","generation":143}\n{"type":"worker.claimed","workerId":"'+next+'","generation":144}\n');
  const current={continuity:{generation:144,owner:{id:next,source:'CODEX_THREAD_ID',parentSessionId:null},retiredWorkerIds:[owner]},refs:[]};
  current.refs=[await put('.harness/continuity.json',current.continuity),await io.pin('.harness/events.jsonl')];await context(next);
  await assert.rejects(()=>proposeContextAdmission(base,current,io,null,[owner]),/current native owner/);
  await assert.rejects(()=>proposeContextAdmission(base,current,io,null,[next],[record]));
  const kind='context-owner-witness',body={witness:record,actor:owner,reviewerId:reviewer,scope:'exact-native-owner-observation-only'};
  const approval={version:1,kind,verdict:'CONTINUE',findings:[],reviewerId:reviewer,reviewedAt:'2026-10-18T00:00:02.000Z',payloadSha256:createHash('sha256').update(reviewPayload(kind,body)).digest('hex')};
  const seal=signer.seal({kind,body,approval,requesterId:next}),review=await put('.harness/fix-nine-rollout-001/reviews/witness-seal.json',seal),bundle={record,review};
  const proposal=await proposeContextAdmission(base,current,io,null,[next],[bundle]);
  assert.equal(proposal.contexts.length,2);assert.equal(base.contexts.size,0);
  const admitted=await extendContextAdmission(base,proposal,current,io);
  for(const row of proposal.contexts) assert.equal(await authenticateContextInventory(root,row.path,current.continuity,admitted),true);
  assert.throws(()=>signer.seal({kind,body:{...body,reviewerId:owner},approval:{...approval,reviewerId:owner},requesterId:next}));
  for(const changed of [{...seal,signature:'A'.repeat(86)+'=='},{...seal,body:{...body,actor:next}},{...seal,body:{...body,reviewerId:owner}}]) {
    const bad=await put('.harness/fix-nine-rollout-001/reviews/bad-witness.json',changed);
    await assert.rejects(()=>proposeContextAdmission(base,current,io,null,[next],[{record,review:bad}]));
  }
  const forged=clone(observation);forged.context.actor=next;
  const forgedBytes=JSON.stringify(forged),forgedRef=await put(`.harness/fix-nine-rollout-001/context-witness-${createHash('sha256').update(forgedBytes).digest('hex')}.json`,forgedBytes);
  await assert.rejects(()=>proposeContextAdmission(base,current,io,null,[],[{record:forgedRef,review}]));
  await put('.harness/context-budget.mjs','// altered writer');
  await assert.rejects(()=>proposeContextAdmission(base,current,io,null,[next],[bundle]));
});

test('finite read-only native observation requires an exact distinct review and survives signed cumulative replay',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'rollout-readonly-observation-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const signer=createReviewSigner(),kind='context-readonly-observation',scope='exact-native-read-only-context-observation-only';
  const actor='01a14cb8-f0c0-7770-abce-261880d1b286',owner='11111111-1111-4111-8111-111111111111',next='22222222-2222-4222-8222-222222222222',reviewer='33333333-3333-4333-8333-333333333333';
  const digest=value=>createHash('sha256').update(value).digest('hex'),contextPath=id=>`.harness/context/${digest(id)}.json`;
  const io={pin:p=>pinFile(root,p),authenticate:r=>authenticateFile(root,r),prefix:r=>authenticatePrefix(root,r),reviewReadOnlyContextObservation:(seal,body)=>validateReview(seal,kind,body,signer.publicKey)};
  const put=async(p,v)=>{await mkdir(path.dirname(path.join(root,p)),{recursive:true});await writeFile(path.join(root,p),typeof v==='string'?v:JSON.stringify(v));return io.pin(p);};
  // Exact real native observation: unavailable telemetry and no identity field
  // remain inert bytes; only the separate native review attests provenance.
  const raw='{"version":1,"actorHash":"6710fcf25730c6cfe8367d9738612881c2758cd40be274bcc8b55ecc6db02ae6","role":"orchestrator","startedAt":"2026-10-18T01:55:55.582Z","mutations":0,"toolCalls":1,"outputChars":0,"telemetry":{"status":"unavailable","bytesSinceUsage":0,"interruptedGoals":0,"goalPrompts":0,"interruptions":0},"updatedAt":"2026-10-18T01:55:55.583Z","lastNotice":null}\n';
  assert.equal(Buffer.byteLength(raw),367);assert.equal(digest(raw),'9e1fcc079fb9e2fb48969e2a0e5a2897f8a2f113c20a9d39505f11aeddc92fef');
  await put(contextPath(actor),raw);
  const writeOwner=async id=>put(contextPath(id),{...JSON.parse(raw),actorHash:digest(id),role:'worker'});
  const base={contexts:new Map(),contextWriter:await put('.harness/context-budget.mjs','// exact current writer')};
  const observation=await captureReadOnlyContextObservation(base,actor,io,'2026-10-18T01:56:00.000Z');
  const saveRecord=value=>{const bytes=JSON.stringify(value);return put(`.harness/fix-nine-rollout-001/readonly-context-observation-${digest(bytes)}.json`,bytes);};
  const sealFor=(reviewKind,body)=>signer.seal({kind:reviewKind,body,requesterId:owner,approval:{version:1,kind:reviewKind,verdict:'CONTINUE',findings:[],reviewerId:reviewer,reviewedAt:'2026-10-18T01:56:01.000Z',payloadSha256:digest(reviewPayload(reviewKind,body))}});
  let sequence=0;
  const bundleFor=async(value=observation,changeSeal=s=>s)=>{const record=await saveRecord(value),body={observation:record,actor:value.actor,reviewerId:reviewer,scope};return {record,review:await put(`.harness/fix-nine-rollout-001/reviews/readonly-${sequence++}.json`,changeSeal(sealFor(kind,body)))};};
  const bundle=await bundleFor();let current=transferFixture().before;current.continuity.owner.id=owner;
  current.refs=[await put('.harness/events.jsonl','{"retained":true}\n')];await writeOwner(owner);
  const propose=(bundles=[bundle],actors=[])=>proposeContextAdmission(base,current,io,null,actors,[],bundles);
  await assert.rejects(()=>proposeContextAdmission(base,current,io,null,[actor]),/current native owner/);
  await assert.rejects(()=>propose([{record:bundle.record}]));
  await assert.rejects(()=>propose([bundle.record]));
  await assert.rejects(()=>proposeContextAdmission(base,current,io,null,[],[bundle]));
  const proposal=await propose([bundle],[owner]);assert.equal(proposal.contexts.length,2);
  const admitted=await extendContextAdmission(base,proposal,current,io);
  assert.equal(await authenticateContextInventory(root,contextPath(actor),current.continuity,admitted),true);
  assert.equal(current.continuity.retiredWorkerIds.includes(actor),false);
  const unknown='44444444-4444-4444-8444-444444444444';await writeOwner(unknown);
  await assert.rejects(()=>authenticateContextInventory(root,contextPath(unknown),current.continuity,admitted),/Unreviewed/);
  for(const [name,mutate] of [
    ['actor mismatch',r=>r.actor=next],['path alias',r=>r.context.path=r.context.path.replace('/context/','/context/../context/')],
    ['captured ref',r=>r.context.captured.sha256='f'.repeat(64)],['snapshot',r=>r.context.snapshot+=' '],
    ['writer',r=>r.contextWriter.sha256='f'.repeat(64)],['version',r=>r.version=2],['missing kind',r=>delete r.kind],
    ['owner kind',r=>r.kind='fix-nine-rollout-context-witness'],['missing scope',r=>delete r.scope],['scope',r=>r.scope='exact-native-owner-observation-only'],
    ['execution permission',r=>r.executionAuthorized=true],['missing time',r=>delete r.observedAt],['earlier time',r=>r.observedAt='2026-10-18T01:55:00.000Z'],
    ['unknown identity assertion',r=>r.nativeIdentity=actor],['general attestation',r=>r.neverOwned=true],
    ['mutating snapshot',r=>{const state=JSON.parse(r.context.snapshot);state.mutations=1;r.context.snapshot=JSON.stringify(state);r.context.captured.bytes=Buffer.byteLength(r.context.snapshot);r.context.captured.sha256=digest(r.context.snapshot);}]
  ])await t.test(name,async()=>{const value=clone(observation);mutate(value);await assert.rejects(()=>bundleFor(value).then(b=>propose([b])));});
  for(const [name,mutate] of [
    ['missing signature',s=>delete s.signature],['invalid signature',s=>s.signature='A'.repeat(86)+'=='],['wrong signature kind domain',s=>s.signature=sealFor('context-owner-witness',s.body).signature],
    ['wrong review kind',s=>s.kind='context-owner-witness'],['wrong payload',s=>s.body.actor=next],['same reviewer',s=>s.body.reviewerId=actor],
    ['missing review schema',s=>delete s.version],['extra review schema',s=>s.extra=true],['wrong review scope',s=>s.body.scope='exact-native-owner-observation-only']
  ])await t.test(name,async()=>{await assert.rejects(()=>bundleFor(observation,s=>{mutate(s);return s;}).then(b=>propose([b])));});
  await assert.rejects(()=>propose([bundle,bundle]),/Duplicate/);
  await assert.rejects(()=>propose([{...bundle,record:{...bundle.record,path:bundle.record.path.replace('/readonly-','/../readonly-')}}]));
  const changedPath=clone(bundle);changedPath.record.path=changedPath.record.path.replace(/[a-f0-9]{64}\.json$/,'f'.repeat(64)+'.json');await assert.rejects(()=>propose([changedPath]));
  const selfBody={observation:bundle.record,actor,reviewerId:actor,scope};
  assert.throws(()=>signer.seal({kind,body:selfBody,requesterId:owner,approval:{version:1,kind,verdict:'CONTINUE',findings:[],reviewerId:actor,reviewedAt:'2026-10-18T01:56:01.000Z',payloadSha256:digest(reviewPayload(kind,selfBody))}}));
  const staleIo={...io,reviewReadOnlyContextObservation:(seal,body)=>validateReview(seal,kind,body,createReviewSigner().publicKey)};
  await assert.rejects(()=>extendContextAdmission(base,proposal,current,staleIo));
  // Context counters remain mutable only for the exact admitted actor.
  await put(contextPath(actor),{...JSON.parse(raw),toolCalls:8,outputChars:42,updatedAt:'2026-10-18T01:57:00.000Z'});
  assert.equal(await authenticateContextInventory(root,contextPath(actor),current.continuity,admitted),true);
  current.contextAdmission=proposal;
  const preservation=await put('.harness/preservation.json',{files:[]});
  const target={index:0,root:deploymentTargets[0],lifecycle:current,preservation};
  const authorityRef=await put('.harness/authority.json',{targets:[target]}),closure=await put('.harness/closure.json',{});
  const authorityBody={authority:authorityRef,sourceClosure:closure,targetRoots:deploymentTargets,scope:'ordered-eleven-deployment-only'};
  const authorityReview=await put('.harness/authority-review.json',sealFor('execution-authority',authorityBody));
  const reload=async()=>{const value=JSON.parse(await io.authenticate(authorityRef));validateReview(JSON.parse(await io.authenticate(authorityReview)),'execution-authority',authorityBody,signer.publicKey);Object.defineProperty(value.targets[0],'inventoryAdmission',{value:await reconstructInventoryAdmission(base,value.targets[0].lifecycle,io),configurable:true});return {ref:authorityRef,closure,value};};
  const chain=[];let previous=authorityRef;
  for(const id of [next,reviewer]) {
    const prior=current,generation=prior.continuity.generation+1;
    const packet={...transferFixture().proof.packet,id:`readonly-transfer-${generation}`,owner:clone(prior.continuity.owner),resumedAt:'2026-10-18T01:58:00.000Z'};
    current=clone(prior);current.continuity={...prior.continuity,generation,lastHandoff:packet,retiredWorkerIds:[...prior.continuity.retiredWorkerIds,prior.continuity.owner.id],owner:{...prior.continuity.owner,id,generation,claimedAt:packet.resumedAt}};
    const transfer={packet,driftDisposition:'none',events:[{type:'handoff.ready',handoffId:packet.id,generation:generation-1,revision:packet.featureRevision,at:'2026-10-18T01:57:59.000Z'},{type:'worker.resumed',handoffId:packet.id,generation,at:'2026-10-18T01:58:01.000Z',drift:[],driftAccepted:false}],archive:await put(`.harness/history/progress/${packet.id}.md`,'immutable archive')};
    await appendFile(path.join(root,'.harness/events.jsonl'),transfer.events.map(JSON.stringify).join('\n')+'\n');current.refs=[await io.pin('.harness/events.jsonl')];current.additions=[...(prior.additions??[]),transfer.archive];await writeOwner(id);
    const old=await effectiveTarget(await reload(),chain,io,[],signer.publicKey);
    current.contextAdmission=await proposeContextAdmission(old.inventoryAdmission,current,io,prior.contextAdmission);
    assert.equal(JSON.stringify(current.contextAdmission.contexts.find(r=>r.actor===actor)),JSON.stringify(proposal.contexts.find(r=>r.actor===actor)));
    for(const mutate of [p=>p.contexts=p.contexts.filter(r=>r.actor!==actor),p=>p.contexts.find(r=>r.actor===actor).witness.readOnlyObservation.review.sha256='f'.repeat(64),p=>p.contexts.push(clone(p.contexts.find(r=>r.actor===actor)))]){const bad=clone(current.contextAdmission);mutate(bad);await assert.rejects(()=>extendContextAdmission(old.inventoryAdmission,bad,current,io,{previous:prior.contextAdmission}));}
    await assert.rejects(()=>extendContextAdmission(old.inventoryAdmission,undefined,current,io,{previous:prior.contextAdmission}));
    const plan={target:deploymentTargets[0],planHash:String(generation).padStart(64,'0'),blocked:false,operations:[]};
    const refresh=await put(`.harness/refresh-${generation}.json`,{index:0,root:plan.target,authority:authorityRef,sourceClosure:closure,previous,oldLifecycle:prior.refs,lifecycle:current,transfer,plan:await put(`.harness/plan-${generation}.json`,plan),planHash:plan.planHash});
    const body={refresh,authority:authorityRef,sourceClosure:closure,scope:'source-lifecycle-and-exact-plan-only'},review=await put(`.harness/review-${generation}.json`,sealFor('source-lifecycle-refresh',body));chain.push({refresh,review});previous=refresh;
    const replay=await effectiveTarget(await reload(),JSON.parse(JSON.stringify(chain)),io,[],signer.publicKey);assert.equal(await authenticateContextInventory(root,contextPath(actor),current.continuity,replay.inventoryAdmission),true);
  }
  const authority=await reload(),reviewBytes=await io.authenticate(bundle.review);
  await put(bundle.review.path,{...JSON.parse(reviewBytes),signature:'A'.repeat(86)+'=='});await assert.rejects(()=>effectiveTarget(authority,chain,io,[],signer.publicKey));await writeFile(path.join(root,bundle.review.path),reviewBytes);
  await assert.rejects(()=>effectiveTarget(authority,chain,staleIo,[],signer.publicKey));
  const recordBytes=await io.authenticate(bundle.record);await appendFile(path.join(root,bundle.record.path),' ');await assert.rejects(()=>effectiveTarget(authority,chain,io,[],signer.publicKey));await writeFile(path.join(root,bundle.record.path),recordBytes);
  await put('.harness/context-budget.mjs','// changed writer');await assert.rejects(()=>effectiveTarget(authority,chain,io,[],signer.publicKey));
});

test('stdio and relay latch full helper drift before and after anchor binding',async t=>{
  for(const readOnly of [false,true]) await t.test(readOnly?'relay':'stdio',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'rollout-stdio-')),input=new PassThrough();
    const values=[],waiters=[];const output=line=>{const value=JSON.parse(line);if(waiters.length)waiters.shift()(value);else values.push(value);};
    const next=()=>values.length?Promise.resolve(values.shift()):new Promise(resolve=>waiters.push(resolve));
    let running;
    try {
      for(const name of signerSourcePaths) {await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),await readFile(new URL('../'+name,import.meta.url)));}
      await mkdir(path.join(root,'.harness'),{recursive:true});
      running=startReviewSigner('.harness/signer-metadata.json',{readOnly,projectRoot:root,input,output});
      const {metadata}=await next(),deployment=path.join(root,'scripts/fix-nine-rollout-deployment.mjs');
      input.write('{"mode":"public"}\n');assert.equal((await next()).health.anchorBound,false);
      await writeFile(deployment,(await readFile(deployment,'utf8')).replace(/^export const reviewPublicKey = .*;$/m,`export const reviewPublicKey = ${JSON.stringify(metadata.publicKey)};`));
      input.write('{"mode":"public"}\n');assert.equal((await next()).health.anchorBound,true);
      const kind='execution-authority',body={fixture:'guarded transport'},approvalPath='.harness/fix-nine-rollout-001/reviews/stdio.json';
      await mkdir(path.dirname(path.join(root,approvalPath)),{recursive:true});await writeFile(path.join(root,'body.json'),JSON.stringify(body));
      await writeFile(path.join(root,approvalPath),JSON.stringify({version:1,kind,verdict:'CONTINUE',findings:[],reviewerId:'fixture-reviewer',reviewedAt:'2026-10-18T00:00:00.000Z',payloadSha256:createHash('sha256').update(reviewPayload(kind,body)).digest('hex')}));
      const command={mode:'seal',kind,bodyPath:'body.json',approvalRef:await pinFile(root,approvalPath),requesterId:'fixture-worker',...(readOnly?{}:{outputPath:'.harness/seal.json'})};
      input.write(JSON.stringify(command)+'\n');const result=await next();assert.equal(result.error,undefined);
      const seal=readOnly?result.seal:JSON.parse(await readFile(path.join(root,'.harness/seal.json')));validateReview(seal,kind,body,metadata.publicKey);
      const file=path.join(root,'scripts/fix-nine-rollout-inventory.mjs'),original=await readFile(file);await appendFile(file,'\n ');
      input.write('{"mode":"public"}\n');assert.equal((await next()).health.sourceUnchanged,false);
      await writeFile(file,original);input.write(JSON.stringify({...command,outputPath:undefined})+'\n');assert((await next()).error);
      input.write('{"mode":"public"}\n');assert.equal((await next()).health.sourceUnchanged,false);
    } finally {input.end();if(running) await running;await rm(root,{recursive:true,force:true});}
  });
});
