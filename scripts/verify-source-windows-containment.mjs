import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {digest,exclusive,featureId,invocationPath,json,sealWindowsContainmentGate,snapshot,sourceRoot,verifyWindowsContainmentCandidate,verifyWindowsContainmentGate,windowsContainmentAcceptance} from './source-windows-containment-authority.mjs';

// This runner invokes the real configured gate once. Provider values are never
// copied into its environment, arguments, invocation record, or automatic retry.
export async function runWindowsContainmentGate() {
  const candidate=await verifyWindowsContainmentCandidate();
  const config=await json('.harness/config.json'),startedAt=new Date().toISOString();
  const environment={};
  for(const key of [...config.security.environmentAllow,'CODEX_THREAD_ID']) if(Object.hasOwn(process.env,key)) environment[key]=process.env[key];
  const argv=['.harness/run.mjs','verify',featureId];
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,argv,{cwd:sourceRoot,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const stdout=[],stderr=[];
    child.stdout.on('data',bytes=>stdout.push(bytes));child.stderr.on('data',bytes=>stderr.push(bytes));
    child.once('error',reject);child.once('close',(exitCode,signal)=>resolve({exitCode,signal,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')}));
  });
  const finishedAt=new Date().toISOString(),sourceAfter=digest(await snapshot());
  const record={version:1,featureId,argv,startedAt,finishedAt,...result,stdoutBytes:Buffer.byteLength(result.stdout),stderrBytes:Buffer.byteLength(result.stderr),timedOut:false,truncated:false,providerFree:true,sourceBefore:candidate.sourceDigest,sourceAfter};
  const invocation=await exclusive(invocationPath,record);
  assert.equal(result.signal,null);assert.equal(result.exitCode,0,`Configured gate failed; complete invocation: ${invocation.path}`);assert.equal(sourceAfter,candidate.sourceDigest);
  return {version:1,pass:true,featureId,invocation};
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  try {
    const action=process.argv[2]??'acceptance';assert.equal(process.argv.length,action==='acceptance'?2:3,'Unexpected SOURCE authority arguments');
    const result=action==='acceptance'?await windowsContainmentAcceptance():action==='run-gate'?await runWindowsContainmentGate():action==='seal-gate'?await sealWindowsContainmentGate():action==='verify-gate'?await verifyWindowsContainmentGate():null;
    assert(result,'Unknown SOURCE authority action');console.log(JSON.stringify(result));
  } catch(error) {console.error(error.stack??error);process.exitCode=1;}
}
