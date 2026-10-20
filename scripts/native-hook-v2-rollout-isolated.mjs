import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceRoot,sourceDigest,featureId,artifactRoot,isolatedReport,targets,sha,digest,reference,authenticateRef,exclusive,currentAuthority,freshFullSourceGate,cleanEnvironment,snapshot} from './native-hook-rollout-v2-authority.mjs';
import {inspectReportLocation} from './native-hook-report-selection.mjs';

export const isolatedPhases=['initial','runtime','canonical'];
export const phaseArguments=phase=>['scripts/native-hook-auto-update-e2e.mjs','--phase',phase,'--report',isolatedReport];
export const verifierArguments=['scripts/verify-native-hook-auto-update-e2e.mjs','--report',isolatedReport];
const json=async relative=>JSON.parse(await readFile(path.join(sourceRoot,relative),'utf8'));
const now=()=>new Date().toISOString();

// Selection-aware runner imports occur only in explicit fresh child processes.
// The wrapper stores output hashes and never copies the real native config.
export async function selectedChild(argv){
  const invocationId=randomUUID(),startedAt=now();let timedOut=false,outputBytes=0;const chunks=[];
  const child=spawn(process.execPath,argv,{cwd:sourceRoot,env:cleanEnvironment(),windowsHide:true,stdio:['ignore','pipe','pipe']});
  const collect=chunk=>{outputBytes+=chunk.length;if(outputBytes<=8*1024*1024)chunks.push(chunk);else child.kill();};
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  const timer=setTimeout(()=>{timedOut=true;child.kill();},600000);
  let outcome;try{outcome=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(exitCode,signal)=>resolve({exitCode,signal}));});}finally{clearTimeout(timer);}
  const receipt={invocationId,executable:process.execPath,argv,cwd:sourceRoot,pid:child.pid,startedAt,finishedAt:now(),...outcome,timedOut,outputBytes,outputSha256:sha(Buffer.concat(chunks))};
  assert(outputBytes<=8*1024*1024,'Child output limit exceeded; no automatic retry');assert.equal(outcome.exitCode,0,'Selected isolated child failed; no automatic retry');assert.equal(outcome.signal,null);assert.equal(timedOut,false);return receipt;
}

export async function runPostAll11Isolated(){
  assert.equal(path.resolve(process.cwd()),sourceRoot);
  const continuity=await json('.harness/continuity.json');assert.equal(continuity.phase,'working');assert.equal(continuity.handoff,null);assert.equal(continuity.owner?.source,'CODEX_THREAD_ID');assert.equal(continuity.owner?.id,process.env.CODEX_THREAD_ID);assert(process.env.CODEX_THREAD_ID);
  const feature=(await json('.harness/features.json')).features.find(item=>item.id===featureId);assert.equal(feature.status,'active');assert(feature.attempts<5);
  const progress=await json('.harness/native-hook-v2-rollout-002-progress.json');assert.equal(progress.pending,null);assert(progress.all11);assert(progress.targets.every(item=>item.status==='audited'));assert.deepEqual(progress.targets.map(item=>item.root),targets);
  const authority=await currentAuthority();assert.deepEqual(JSON.parse(await authenticateRef(progress.authority)),authority);
  const all=JSON.parse(await authenticateRef(progress.all11));assert.equal(all.stage,'all11');assert.deepEqual(all.authority,progress.authority);assert.deepEqual(all.baseline,progress.baseline);assert.deepEqual(all.firstwave,progress.firstwave);assert.deepEqual(all.targets.map(item=>item.root),targets);for(const target of all.targets){await authenticateRef(target.applyReceipt);await authenticateRef(target.auditReceipt);}
  await inspectReportLocation(sourceRoot,isolatedReport,{absent:true});
  const nativePath=path.join(process.env.USERPROFILE,'.codex','config.toml'),nativeBytes=await readFile(nativePath);
  const nativeConfig=await exclusive(`${artifactRoot}/isolated-native-binding.json`,{path:nativePath,bytes:nativeBytes.length,sha256:sha(nativeBytes)});
  const launch=await exclusive(`${artifactRoot}/isolated-launch.json`,{version:1,stage:'post-all11-isolated-launch',sourceDigest,all11:progress.all11,authority:progress.authority,reportSelection:isolatedReport,nativeConfig,startedAt:now()});
  const currentSourceGates=[],phases=[];
  for(const phase of isolatedPhases){const artifacts=[];await freshFullSourceGate(sourceRoot,artifacts);currentSourceGates.push({phase,gate:artifacts.at(-1)});phases.push({phase,...await selectedChild(phaseArguments(phase))});}
  // Ordinary scratch survives both preservation authentication and verification.
  const authentication=await selectedChild(phaseArguments('authenticate'));
  const verification=await selectedChild(verifierArguments);
  const report=await reference(isolatedReport),value=JSON.parse(await authenticateRef(report));assert.equal(value.status,'passed');assert.equal(value.pending,null);assert.equal(value.globalConfig.before,sha(nativeBytes));assert.equal(value.globalConfig.after,sha(nativeBytes));assert.equal(value.nativeDispatch.status,'not_exercised');
  const currentNative=await readFile(nativePath);assert.equal(currentNative.length,nativeBytes.length);assert.equal(sha(currentNative),sha(nativeBytes));assert.equal(digest(await snapshot(sourceRoot)),sourceDigest);assert.deepEqual(await currentAuthority(),authority);
  const completion=await exclusive(`${artifactRoot}/isolated-completion.json`,{version:1,stage:'post-all11-isolated-completion',launch,report,status:'passed',currentSourceGates,phases,authentication,verification,completedAt:now()});
  return {launch,completion,report};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{assert.deepEqual(process.argv.slice(2),['run','--report',isolatedReport]);console.log(JSON.stringify(await runPostAll11Isolated()));}
  catch(error){console.error(JSON.stringify({status:'stopped-safely',errorSha256:sha(String(error))}));process.exitCode=1;}
}
