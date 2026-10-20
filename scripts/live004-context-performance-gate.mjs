import assert from 'node:assert/strict';
import {open,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {root,reference,authenticate,exclusive,digest,normalizedContract,futureShapes,closedInputs,nodeIdentity,expectedPlan,verifyGate} from './source-context-performance-authority.mjs';
import {windowsCommand} from '../skill/codex-harness/assets/windows-command.mjs';

export const featureId='native-hook-v2-live-004';
export const selectedReport='.harness/native-hook-v2-live-004-e2e-report.json';
export const directory='.harness/native-hook-v2-live-004-gate';
export const gatePath=`${directory}/receipt.json`;

const beforePath=`${directory}/before.json`;
const json=async name=>JSON.parse(await readFile(path.resolve(root,name),'utf8'));
const authenticatedJson=async ref=>JSON.parse(await authenticate(ref));
const actor=()=>{assert(process.env.CODEX_THREAD_ID,'Actual worker identity is required');return process.env.CODEX_THREAD_ID;};
function exactFeature(feature){assert(feature);const shape=futureShapes[featureId];assert.deepEqual(normalizedContract(feature),shape);assert.equal(feature.contract.version,2);assert.deepEqual(feature.contract.snapshot,shape);assert.equal(feature.contract.hash,digest({contract:shape,scopeBaselineHash:feature.contract.scopeBaselineHash}));return feature;}
async function currentFeature(){return exactFeature((await json('.harness/features.json')).features.find(item=>item.id===featureId));}
async function bindings(){const {authenticateHelperFreeze}=await import('./live004-context-performance-e2e.mjs');const freeze=await authenticateHelperFreeze(),source=await verifyGate({allowSuccessors:true,helperFreeze:freeze});const report=await reference(selectedReport);const {verifyNativeReport}=await import('./verify-live004-context-performance-e2e.mjs');const native=await verifyNativeReport(await authenticatedJson(report));assert.equal(native.pass,true);if(native.recovery){assert.equal(native.recovery.historicalNativeSuccess,false);assert.equal(native.recovery.currentNativeSuccess,true);for(const key of ['history','intent','outcome'])await authenticate(native.recovery[key]);}return {freeze,source,report,native,inputs:await closedInputs(),node:await nodeIdentity(),config:await reference('.harness/config.json')};}
export function parseGateArguments(args){assert.equal(args.length,4);const values={};for(let i=0;i<args.length;i+=2){assert(['--phase','--report'].includes(args[i]));assert(!Object.hasOwn(values,args[i]));values[args[i]]=args[i+1];}assert(['run','verify'].includes(values['--phase']));assert.equal(values['--report'],selectedReport);return {phase:values['--phase'],report:values['--report']};}
function environment(){const output={};for(const key of ['PATH','Path','SYSTEMROOT','SystemRoot','COMSPEC','ComSpec','PATHEXT','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','CODEX_THREAD_ID','CODEX_SESSION_ID','CODEX_HOME'])if(process.env[key]!==undefined)output[key]=process.env[key];return output;}
function quote(value){assert(!/["%!^&|<>\r\n]/.test(value),'Unsafe command argument');return `"${value}"`;}
async function invoke(){
 const stdoutPath=`${directory}/stdout.log`,stderrPath=`${directory}/stderr.log`;
 const stdout=await open(path.resolve(root,stdoutPath),'wx');let stderr;
 try{stderr=await open(path.resolve(root,stderrPath),'wx');}catch(error){await stdout.close();throw error;}
 const args=['.harness/run.mjs','verify',featureId],startedAt=new Date().toISOString();let controller,queue=Promise.resolve(),captureError,bytes=0,outcome;
 const capture=handle=>chunk=>{bytes+=chunk.length;if(bytes>16000000){captureError=new Error('Gate capture bound exceeded');controller.cancel();return;}queue=queue.then(()=>handle.writeFile(chunk)).catch(error=>{captureError=error;controller.cancel();});};
 try{controller=windowsCommand([process.execPath,...args].map(quote).join(' '),root,environment(),600000);const closed=new Promise(resolve=>controller.child.once('close',(code,signal)=>resolve({code,signal})));controller.child.stdout.on('data',capture(stdout));controller.child.stderr.on('data',capture(stderr));outcome=await controller.done;if(outcome.confirmed){const termination=await closed;outcome={...outcome,signal:termination.signal,controllerExitCode:termination.code};}await queue;}finally{await queue;await Promise.all([stdout.close(),stderr.close()]);}
 const logs={stdout:await reference(stdoutPath),stderr:await reference(stderrPath)};
 assert(!captureError,String(captureError));assert.equal(outcome.confirmed,true,'Gate process tree termination is unconfirmed');
 if(outcome.exitCode===75){const error=new Error('Rotation occurred before configured gate');error.exitCode=75;throw error;}
 assert.equal(outcome.exitCode,0);assert.equal(outcome.signal,null);assert.equal(outcome.timedOut,false);assert.equal(outcome.controllerExitCode,0);
 return {executable:process.execPath,args,cwd:root,actor:actor(),startedAt,finishedAt:new Date().toISOString(),outcome,logs};
}
async function verifyEvidence(ref,before,invocation){
 assert(!before.evidencePrefix.some(item=>item.path===ref.path),'Appended evidence must have a fresh path');
 const evidence=await authenticatedJson(ref),plan=evidence.verificationPlan,expected=before.expected;
 const times=[invocation.startedAt,evidence.startedAt,evidence.finishedAt,invocation.finishedAt].map(Date.parse);assert(times.every(Number.isFinite),'Gate timestamps must be valid');assert(times.every((value,index)=>index===0||value>=times[index-1]),'Evidence must be contained in its verify invocation');
 assert.equal(evidence.schemaVersion,5);assert.equal(evidence.harnessVersion,6);assert.equal(evidence.pass,true);assert.equal(evidence.featureId,featureId);assert.equal(evidence.contractHash,before.contractHash);assert.equal(evidence.configHash,before.configHash);assert.deepEqual(evidence.scopeViolations,[]);assert.equal(evidence.verificationHash,digest(plan));
 assert.equal(plan.schemaVersion,2);assert.deepEqual(plan.feature,{id:featureId,contractHash:before.contractHash});assert.deepEqual(plan.config,{hash:before.configHash});assert.deepEqual(evidence.requiredLayers,expected.layers);assert.deepEqual(plan.requiredLayers,expected.layers.map((id,order)=>({id,order})));
 assert.equal(plan.executions.length,expected.entries.length);assert.equal(evidence.commands.length,expected.entries.length);assert.equal(expected.entries.filter(item=>item.command==='node --test tests/harness.test.mjs').length,1);
 const logs=[];const ids=new Set();
 for(let i=0;i<expected.entries.length;i++){
  const entry=expected.entries[i],execution=plan.executions[i],result=evidence.commands[i];assert(!ids.has(execution.id));ids.add(execution.id);assert.equal(execution.order,i);assert.equal(execution.command,entry.command);assert.equal(execution.commandHash,digest(entry.command));assert.equal(execution.commandRedacted,false);assert.deepEqual(execution.credentials,[]);assert.deepEqual(execution.expected,{pass:true,exitCode:0,timedOut:false});assert.equal(execution.layer,entry.layer);assert.equal(execution.criterionId,entry.criterionId);
  assert.equal(result.executionId,execution.id);assert.equal(result.executionOrder,i);assert.equal(result.command,entry.command);assert.equal(result.layer,entry.layer);assert.equal(result.criterionId,entry.criterionId);assert.deepEqual(result.credentials,[]);assert.equal(result.pass,true);assert.equal(result.exitCode,0);assert.equal(result.timedOut,false);assert.equal(result.signal,null);assert.equal(result.terminationConfirmed,true);
  for(const stream of ['stdout','stderr']){const name=result.logs[stream];assert.equal(typeof name,'string');assert(name.startsWith('.harness/logs/')&&!name.includes('..'));const log=await reference(name);await authenticate(log);logs.push({executionId:execution.id,stream,...log});}
 }
 assert.equal(expected.entries.at(-1).command,`node scripts/verify-live004-context-performance-e2e.mjs --report ${selectedReport}`);return {evidence:ref,logs,verificationHash:evidence.verificationHash};
}
export async function runSourceGate(explicitSelectedReport=selectedReport){
 assert.equal(explicitSelectedReport,selectedReport);assert.equal(process.platform,'win32');const worker=actor(),continuity=await json('.harness/continuity.json');assert.equal(continuity.phase,'working');assert.equal(continuity.owner.id,worker);assert.equal(continuity.handoff,null);
 const feature=await currentFeature();assert.equal(feature.status,'active');const config=await json('.harness/config.json');const effectiveMaxAttempts=Math.min(config.policies.maxAttempts,feature.verificationBudget?.maxAttempts??config.policies.maxAttempts);assert(feature.attempts<effectiveMaxAttempts&&feature.repeatedFailures<config.policies.maxRepeatedFailures,'Attempt budget exhausted');const bound=await bindings(),expected=expectedPlan(config,feature);
 const evidencePrefix=await Promise.all(feature.evidence.map(reference));for(const ref of evidencePrefix)await authenticate(ref);
 await mkdir(path.resolve(root,directory),{recursive:true});const before={version:1,kind:'fresh-live004-configured-gate-before',featureId,runId:randomUUID(),actor:worker,startedAt:new Date().toISOString(),bindings:bound,contractHash:feature.contract.hash,configHash:digest(config),contract:feature.contract,attempts:feature.attempts,evidencePrefix,expected};await exclusive(beforePath,before);
 const invocation=await invoke(),after=await currentFeature();assert.equal(after.status,'passing');assert.equal(after.attempts,before.attempts+1);assert.equal(after.evidence.length,evidencePrefix.length+1);assert.deepEqual(after.contract,before.contract);assert.deepEqual(await Promise.all(after.evidence.slice(0,-1).map(reference)),evidencePrefix);
 const evidence=await verifyEvidence(await reference(after.evidence.at(-1)),before,invocation);assert.deepEqual(await bindings(),bound);const receipt={version:1,kind:'fresh-live004-configured-gate',featureId,runId:before.runId,actor:worker,before:await reference(beforePath),invocation,evidence,after:{attempts:after.attempts,status:after.status,contract:after.contract,bindings:await bindings()},sealedAt:new Date().toISOString()};await exclusive(gatePath,receipt);return verifySourceGate(gatePath,selectedReport);
}
export async function verifySourceGate(receiptPath=gatePath,explicitSelectedReport=selectedReport){
 assert.equal(receiptPath,gatePath);assert.equal(explicitSelectedReport,selectedReport);const gateRef=await reference(receiptPath),receipt=await authenticatedJson(gateRef);assert.equal(receipt.kind,'fresh-live004-configured-gate');assert.equal(receipt.featureId,featureId);const before=await authenticatedJson(receipt.before);assert.equal(before.kind,'fresh-live004-configured-gate-before');assert.equal(before.featureId,featureId);assert.equal(receipt.runId,before.runId);assert.equal(receipt.actor,before.actor);assert.deepEqual(receipt.after.bindings,before.bindings);assert.deepEqual(await bindings(),before.bindings);
 const feature=await currentFeature();assert.equal(feature.status,'passing');assert.equal(feature.attempts,before.attempts+1);assert.deepEqual(feature.contract,before.contract);assert.equal(feature.evidence.length,before.evidencePrefix.length+1);assert.deepEqual(await Promise.all(feature.evidence.slice(0,-1).map(reference)),before.evidencePrefix);assert.deepEqual(await reference(feature.evidence.at(-1)),receipt.evidence.evidence);assert.deepEqual(await verifyEvidence(receipt.evidence.evidence,before,receipt.invocation),receipt.evidence);
 const invocation=receipt.invocation;assert.equal(invocation.executable,process.execPath);assert.deepEqual(invocation.args,['.harness/run.mjs','verify',featureId]);assert.equal(invocation.actor,before.actor);assert.equal(invocation.cwd,root);assert.equal(invocation.outcome.exitCode,0);assert.equal(invocation.outcome.signal,null);assert.equal(invocation.outcome.timedOut,false);assert.equal(invocation.outcome.confirmed,true);assert.equal(invocation.outcome.controllerExitCode,0);for(const ref of Object.values(invocation.logs))await authenticate(ref);assert(Date.parse(receipt.sealedAt)>=Date.parse(invocation.finishedAt));return {version:1,pass:true,featureId,gate:gateRef,report:before.bindings.report,source:before.bindings.source,evidence:receipt.evidence.evidence};
}
async function main(){try{const options=parseGateArguments(process.argv.slice(2));console.log(JSON.stringify(await (options.phase==='run'?runSourceGate(options.report):verifySourceGate(gatePath,options.report))));}catch(error){console.error(JSON.stringify({status:'stopped-safely',errorHash:digest(String(error))}));process.exitCode=error.exitCode===75?75:1;}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))void main();
