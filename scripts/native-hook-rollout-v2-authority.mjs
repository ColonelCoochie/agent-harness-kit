import assert from 'node:assert/strict';
import {readFile,readdir,lstat,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {sourceRoot,targets,sha} from './verify-context-rollout.mjs';
import {stable,authenticate} from './source-budget-compat-authority.mjs';
import {verifyCompatibilityGate,normalizedContract,futureAuthorizationPin} from './verify-source-budget-compat.mjs';
import {inspectReportLocation} from './native-hook-report-selection.mjs';

export {sourceRoot,targets,sha,stable};
export const sourceDigest='97d64567ecede9787105a0fd9c6535cc15b1a5eab15d0e8ba8d4b42c10ca82e9';
export const historicalDigest='3369d759d025a98e4fa5606036ec7b376b25064ca69a779d875526ac92088f98';
export const featureId='native-hook-v2-rollout-002';
export const productionReport='.harness/native-hook-v2-rollout-002-report.json';
export const artifactRoot='.harness/native-hook-v2-rollout-002';
export const isolatedReport='.harness/native-hook-v2-rollout-002-post-all11-isolated-report.json';
export const liveReport='.harness/native-hook-v2-live-002-e2e-report.json';
export const baselinePin={path:'.harness/native-hook-rollout-v2/original-baseline.json',bytes:509223,sha256:'c2dfe6805937aca2fd4b1180ee4ea1c92d0c16c002142066eb01b28d7b8401d5'};
export const liveGatePin={path:'.harness/native-hook-v2-live-002-gate/receipt.json',sha256:'f3d34ec15b72ed6fc1f36a76871fe5dd780c610c2a90e48ec9a61dd31f314dc4'};
export const liveEvidencePin={path:'.harness/evidence/2026-10-16T08-36-31-265Z-native-hook-v2-live-002.json',sha256:'6e948e6bc14b4423f8d3fce45d8df31f0fc8a4621e1a276db70576e2af16c05b'};
export const previousHelperFreeze={path:'.harness/native-hook-v2-rollout-002/production-helper-freeze.json',bytes:10278,sha256:'4d26dec5e98f8c621a9efbf211b5835252ec6a3e6ae0357f9897002a23742d45'};
// A fixed selection path, not a digest inside its own helper closure. The freeze
// authenticates helpers; reports authenticate this selected immutable freeze.
export const selectedHelperFreeze='.harness/native-hook-v2-rollout-002/production-helper-freeze-doc-review-v2.json';
export const helperRepairTestPaths=['scripts/native-hook-rollout-v2-verifier.test.mjs','scripts/native-hook-v2-rollout-gate.test.mjs','scripts/native-hook-rollout-v2-doc-review.test.mjs'];
export const helperRepairProjectionScript='scripts/native-hook-rollout-v2-doc-review-proof.mjs';
export const helperRepairEvidencePaths=Object.fromEntries(['independentReview','focusedEvidence','projectedPlans','fullRegression','validation'].map(role=>[role,`${artifactRoot}/production-helper-doc-review-${role}.json`]));
export const commandList=[...['bin/agent-harness.mjs','bin/codex-harness.mjs','skill/codex-harness/scripts/harness.mjs','skill/codex-harness/scripts/lib/core.mjs','skill/codex-harness/assets/project-runtime.mjs','skill/codex-harness/assets/precompact-handoff.mjs','.harness/run.mjs','.harness/hooks/precompact-handoff.mjs'].map(file=>`node --check ${file}`),'node --test tests/harness.test.mjs','node bin/agent-harness.mjs audit . --min-score 95'];
export const helperPaths=['scripts/native-hook-rollout-v2-authority.mjs','scripts/native-hook-rollout-v2.mjs','scripts/verify-native-hook-rollout-v2.mjs','scripts/verify-native-hook-rollout.mjs','scripts/verify-context-rollout.mjs','scripts/native-hook-v2-rollout-isolated.mjs','scripts/native-hook-v2-rollout-gate.mjs','scripts/native-hook-auto-update-e2e.mjs','scripts/verify-native-hook-auto-update-e2e.mjs','scripts/native-hook-rollout-v2-doc-review.mjs'];
export const helperRepairSyntaxCommands=[...commandList.slice(0,8),...helperPaths,...helperRepairTestPaths,helperRepairProjectionScript].map(item=>item.startsWith('node ')?item:`node --check ${item}`);
export const cleanEnvironment=()=>Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','Path','PATHEXT','SystemRoot','ComSpec','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA'].includes(key)));
export const digest=value=>sha(stable(value));
export async function regularFile(relative,root=sourceRoot){
  assert.equal(typeof relative,'string');assert(!relative.includes('\\')&&!relative.includes('\0')&&!path.isAbsolute(relative)&&!/^[A-Za-z]:/.test(relative));
  const parts=relative.split('/');assert(parts.every(part=>part&&part!=='.'&&part!=='..'),'Reference must be canonical');
  let file=root;for(const [index,part] of parts.entries()){file=path.join(file,part);const info=await lstat(file);assert(!info.isSymbolicLink(),'Reference cannot traverse a symlink');assert(index===parts.length-1?info.isFile():info.isDirectory(),'Reference type mismatch');}return file;
}
export async function reference(relative,root=sourceRoot){const bytes=await readFile(await regularFile(relative,root));return {path:relative,bytes:bytes.length,sha256:sha(bytes)};}
export async function authenticateRef(ref,root=sourceRoot){assert(ref&&Number.isSafeInteger(ref.bytes)&&ref.bytes>=0&&/^[a-f0-9]{64}$/.test(ref.sha256));const bytes=await readFile(await regularFile(ref.path,root));assert.equal(bytes.length,ref.bytes);assert.equal(sha(bytes),ref.sha256);return bytes;}
export async function exclusive(relative,value,root=sourceRoot){
  assert.equal(typeof relative,'string');assert(relative.startsWith(artifactRoot+'/'));
  // Complete the canonical/type/symlink/absence check before creating a parent.
  const destination=await inspectReportLocation(root,relative,{absent:true});
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n');
  let directory=root;for(const part of relative.split('/').slice(0,-1)){
    directory=path.join(directory,part);await mkdir(directory).catch(error=>{if(error.code!=='EEXIST')throw error;});
    const info=await lstat(directory);assert(info.isDirectory()&&!info.isSymbolicLink());
  }
  await writeFile(destination,bytes,{flag:'wx'});return reference(relative,root);
}
export async function snapshot(root=sourceRoot){const result={};async function visit(relative){const file=path.join(root,relative),info=await lstat(file);assert(!info.isSymbolicLink());if(info.isDirectory())for(const entry of (await readdir(file)).sort())await visit(`${relative}/${entry}`);else{assert(info.isFile());result[relative]=sha(await readFile(file));}}for(const input of ['package.json','bin','skill/codex-harness','tests'])await visit(input);return result;}
export async function verifyHelperFreeze(helpers,{ref=reference,auth=authenticateRef}={}){
  const selected=await ref(selectedHelperFreeze),freeze=JSON.parse(await auth(selected));
  assert.equal(freeze.version,2);assert.equal(freeze.kind,'production-helper-freeze');
  assert.equal(freeze.featureId,featureId);assert.equal(freeze.sourceDigest,sourceDigest);
  assert.deepEqual(freeze.supersedes,previousHelperFreeze);
  const previous=JSON.parse(await auth(previousHelperFreeze));
  assert.equal(previous.version,1);assert.equal(previous.kind,'production-helper-freeze');
  assert.equal(previous.featureId,featureId);assert.equal(previous.sourceDigest,sourceDigest);
  assert.deepEqual(freeze.helperPaths,helperPaths);assert.deepEqual(freeze.helpers,helpers);
  const changed=helpers.filter(item=>!previous.authority.helpers.some(old=>stable(old)===stable(item)));
  assert.deepEqual(changed.map(item=>item.path),['scripts/native-hook-rollout-v2-authority.mjs','scripts/native-hook-rollout-v2.mjs','scripts/native-hook-rollout-v2-doc-review.mjs']);
  assert.deepEqual(freeze.changedHelpers,changed);
  assert.deepEqual(freeze.sealedReferences,previous.sealedReferences);
  for(const item of freeze.sealedReferences)await auth(item);
  const evidence=async field=>{const item=freeze[field];assert.equal(item.path,helperRepairEvidencePaths[field]);const value=JSON.parse(await auth(item));assert.equal(value.version,1);assert.equal(value.kind,`production-helper-doc-review-${field}`);assert.equal(value.featureId,featureId);assert.equal(value.sourceDigest,sourceDigest);return value;};
  const review=await evidence('independentReview');
  assert.equal(review.verdict,'CLEAR');assert.equal(review.independentActualCode,true);
  assert.deepEqual(review.helpers,helpers);assert.deepEqual(review.changedHelpers,changed);
  assert.equal(review.sourceDigest,sourceDigest);assert.deepEqual(review.supersedes,previousHelperFreeze);
  const focused=await evidence('focusedEvidence');
  assert.equal(focused.exitCode,0);assert.equal(focused.failures,0);assert(focused.tests>=35);
  assert.equal(focused.command,`node --test ${helperRepairTestPaths.join(' ')}`);
  assert.deepEqual(focused.helpers,helpers);assert.deepEqual(focused.testFiles.map(item=>item.path),helperRepairTestPaths);
  for(const item of focused.testFiles)await auth(item);await auth(focused.log);
  const projection=await evidence('projectedPlans');
  assert.equal(projection.readOnly,true);assert.equal(projection.pass,true);assert.equal(projection.sourceDigest,sourceDigest);
  assert.deepEqual(projection.helpers,helpers);assert.deepEqual(projection.targets.map(item=>item.root),targets);
  assert.equal(projection.generator.path,helperRepairProjectionScript);await auth(projection.generator);
  for(const item of projection.targets){assert.equal(item.blocked,false);assert.equal(item.migrations,0);assert.equal(item.originalsPreserved,true);}
  const regression=await evidence('fullRegression');
  assert.equal(regression.exitCode,0);assert.equal(regression.signal,null);assert.equal(regression.errorCode,null);
  assert.equal(regression.command,'node --test tests/harness.test.mjs');assert.equal(regression.providerCredentials,false);
  assert.equal(regression.mocksOnly,true);assert.equal(regression.tempOutsideGit,true);
  assert.deepEqual(regression.helpers,helpers);assert.equal(regression.sourceBefore,sourceDigest);assert.equal(regression.sourceAfter,sourceDigest);
  assert(regression.summary.includes('# fail 0')&&regression.summary.includes('# cancelled 0'));await auth(regression.log);
  const validation=await evidence('validation');assert.equal(validation.pass,true);assert.deepEqual(validation.helpers,helpers);
  assert.equal(validation.sourceDigest,sourceDigest);assert.deepEqual(validation.syntax.map(item=>item.command),helperRepairSyntaxCommands);assert(validation.syntax.every(item=>item.exitCode===0));
  assert(validation.audit.score>=95&&validation.audit.criticalFindings===0);
  return selected;
}
export async function currentAuthority(){
  const historical=JSON.parse(await authenticateRef(baselinePin));assert.equal(historical.sourceDigest,historicalDigest);assert.deepEqual(historical.targets.map(item=>item.root),targets);
  const compatibility=await verifyCompatibilityGate();assert.equal(compatibility.sourceDigest,sourceDigest);assert.equal(digest(await snapshot()),sourceDigest);
  const grants=JSON.parse(await authenticate(futureAuthorizationPin));const features=JSON.parse(await readFile(path.join(sourceRoot,'.harness/features.json')));
  for(const id of ['native-hook-v2-live-002',featureId]){const feature=features.features.find(item=>item.id===id);const grant=grants.contracts[id];assert(feature&&grant,'Exact future authorization required');assert.equal(digest(grant.shape),grant.sha256);assert.deepEqual(normalizedContract(feature),grant.shape);}
  const gate=await reference(liveGatePin.path),evidence=await reference(liveEvidencePin.path);assert.equal(gate.sha256,liveGatePin.sha256);assert.equal(evidence.sha256,liveEvidencePin.sha256);
  // Selection-aware sealed live modules capture argv during first import.
  const saved=process.argv;process.argv=[saved[0],saved[1],'--report',liveReport];let verified;
  try{const live=await import('./native-hook-v2-live-gate.mjs');verified=await live.verifySourceGate(liveGatePin.path,liveReport);}finally{process.argv=saved;}
  assert.equal(verified.pass,true);assert.equal(verified.actualConfiguredGate,true);
  const helpers=await Promise.all(helperPaths.map(file=>reference(file)));
  const helperFreeze=await verifyHelperFreeze(helpers);
  return {version:1,sourceDigest,historicalBaseline:baselinePin,compatibility,liveGate:gate,liveEvidence:evidence,futureAuthorization:futureAuthorizationPin,helpers,helperFreeze};
}
export async function freshFullSourceGate(root,artifacts,write=exclusive){
  assert.equal(root,sourceRoot);const startedAt=new Date().toISOString(),invocationId=randomUUID(),before=digest(await snapshot(root));assert.equal(before,sourceDigest);
  const configRef=await reference('.harness/config.json'),config=JSON.parse(await authenticateRef(configRef));assert.deepEqual([...config.verification.quick,...config.verification.full,...config.verification.architecture],commandList);
  const results=[];for(const [index,command] of commandList.entries()){
    const commandStartedAt=new Date().toISOString(),commandInvocationId=randomUUID();const result=await new Promise((resolve,reject)=>{const args=command.split(' ').slice(1),child=spawn(process.execPath,args,{cwd:root,env:cleanEnvironment(),windowsHide:true,stdio:['ignore','pipe','pipe']});let outputBytes=0,timedOut=false;const chunks=[];const capture=chunk=>{outputBytes+=chunk.length;if(outputBytes>8000000){child.kill();reject(new Error('Gate output bound'));return;}chunks.push(chunk);};child.stdout.on('data',capture);child.stderr.on('data',capture);const timer=setTimeout(()=>{timedOut=true;child.kill();},600000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',(exitCode,signal)=>{clearTimeout(timer);resolve({index,command,invocationId:commandInvocationId,startedAt:commandStartedAt,finishedAt:new Date().toISOString(),exitCode,signal,timedOut,outputBytes,outputSha256:sha(Buffer.concat(chunks))});});});results.push(result);assert.equal(result.exitCode,0,'Fresh source command failed; no automatic retry');assert.equal(result.timedOut,false);assert.equal(result.signal,null);
  }
  const after=digest(await snapshot(root));assert.equal(after,before);assert.deepEqual(await reference('.harness/config.json'),configRef);
  const gate={version:2,invocationId,startedAt,finishedAt:new Date().toISOString(),sourceBefore:before,sourceAfter:after,config:configRef,helpers:await Promise.all(helperPaths.map(file=>reference(file))),results,mocks:false,stubbedVerifier:false,proofCache:false,providerCredentials:false,ordinaryTemp:true};const ref=await write(`${artifactRoot}/source-gate-${invocationId}.json`,gate);artifacts.push(ref);return gate;
}
