import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,readdir,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {canonicalCodexHooks,reviewNativeDefinitions} from '../skill/codex-harness/scripts/lib/hook-policy.mjs';
import {snapshot,stable,verifyWindowsContainmentGate} from './source-windows-containment-authority.mjs';
import {captureInstalledInventory, authenticateHelperFreeze, authenticateSuccessorSelection, authenticatePredecessorArchive, archivePin, recoveryPath, originalReport, selectedReport as successorReport} from './live003-windows-containment-gate.mjs';
import {connect,binary} from './live-host-e2e/native-client.mjs';
import {selectReport,reportArtifactDirectory,inspectReportLocation} from './native-hook-report-selection.mjs';
export function assertConfirmedTermination(report,label,stream){
 const matches=report.terminations.filter(item=>item.label===label);assert.equal(matches.length,1,'Exactly one recorded native termination');
 const events=stream.filter(event=>event.kind==='confirmedTermination');assert.equal(events.length,1);
 const {at,kind,providerEnvironmentSanitized,...proof}=events[0];const {label:ignored,...record}=matches[0];
 assert.deepEqual(record,proof,'Recorded termination must bind the native event');assert.equal(proof.treeAbsent,true);assert.equal(providerEnvironmentSanitized,true);
 assert(Array.isArray(proof.treePids)&&proof.treePids.length>0&&proof.treePids.every(pid=>Number.isSafeInteger(pid)&&pid>0));assert.equal(new Set(proof.treePids).size,proof.treePids.length);
 assert.equal(stream.at(-1),events[0],'Native event capture must finish with confirmed tree termination');
}

const originalReportPath='.harness/native-hook-v2-live-003-e2e-report.json';

export const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const requestedReport=selectReport(process.argv.slice(2),originalReportPath);
export const selectedReport=successorReport;
export const explicitReport=process.argv.slice(2).includes('--report');
assert(!explicitReport || [originalReportPath,successorReport].includes(requestedReport),'Only the finite LIVE003 selections are authorized');
export const artifactDirectory=reportArtifactDirectory(selectedReport);
export const reportPath=path.join(sourceRoot,selectedReport);
export const artifactRoot=path.join(sourceRoot,artifactDirectory);
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const policyPath=path.join(process.env.USERPROFILE,'.codex/agent-harness-hook-policy.json');
const configPath=path.join(process.env.USERPROFILE,'.codex/config.toml');
const hostKeys=new Set(['PATH','Path','PATHEXT','SystemRoot','ComSpec','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA']);
const cleanEnv=()=>({...Object.fromEntries(Object.entries(process.env).filter(([key])=>hostKeys.has(key))),CODEX_EXECUTABLE:binary});
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const optionalBytes=async file=>{try{return await readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
export const recoveryDirectory='.harness/native-hook-v2-live-003-repair-v3/recovery';
const save=async(report,{exclusive=false}={})=>{const ledger=report.reportSelection===recoveryPath;const target=ledger?recoveryPath:selectedReport;assert.equal(report.reportSelection,target);assert.equal(report.artifactDirectory,ledger?recoveryDirectory:artifactDirectory);if(!exclusive)await inspectReportLocation(sourceRoot,target);return writeFile(path.join(sourceRoot,target),JSON.stringify(report,null,2)+'\n',{flag:exclusive?'wx':'w'});};
async function policyTransition(report,label,args,expected){
 const before=await optionalBytes(policyPath);const beforeHash=before===null?null:sha(before);
 assert.equal(beforeHash,report.policy.currentHash??null,'Temporary policy drift; transition is parked');
 await command(report,label,args);
 const after=await readFile(policyPath);assert.deepEqual(JSON.parse(after),expected);
 const transition={label,beforeHash,afterHash:sha(after),expected,guard:'checked-immediately-before-command'};
 report.policy.transitions??=[];report.policy.transitions.push(transition);report.policy.currentHash=transition.afterHash;
 await artifact(report,`${label}-policy.json`,after);await save(report);
 return after;
}
export async function settledTurn(client,threadId,text,fixture,{headerPath,headerOptions}={}){
 const turn=await client.turn(threadId,text);assert.equal(turn.turn.status,'completed');
 await client.waitFor(e=>e.method==='hook/completed'&&e.threadId===threadId&&e.turnId===turn.turn.id&&e.run?.eventName==='stop'&&e.run.sourcePath===path.join(fixture,'.codex/hooks.json')&&['success','completed'].includes(e.run.status),60000);
 const started=client.events.filter(e=>e.method==='hook/started'&&e.threadId===threadId&&e.turnId===turn.turn.id);
 for(const hook of started)await client.waitFor(e=>e.method==='hook/completed'&&e.threadId===threadId&&e.turnId===turn.turn.id&&e.run?.id===hook.run.id,60000);
 return headerPath?{...turn,header:await client.headerAfterTurn(headerPath,threadId,turn.turn.id,headerOptions)}:turn;
}
async function artifact(report,name,data){
 const bytes=Buffer.isBuffer(data)?data:Buffer.from(typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');
 assert.equal(report.artifactDirectory,report.reportSelection===recoveryPath?recoveryDirectory:artifactDirectory);assert.equal(path.basename(name),name);await inspectReportLocation(sourceRoot,report.artifactDirectory,{kind:'directory'});
 const file=path.join(sourceRoot,report.artifactDirectory,name);await writeFile(file,bytes,{flag:'wx'});
 const record={path:path.relative(sourceRoot,file).replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)};report.artifacts.push(record);return record;
}
async function authenticate(report){
 assert(explicitReport,'Native execution requires an explicitly selected fresh report');
 assert.equal(report.version,1);assert.equal(report.featureId,'native-hook-v2-live-003');
 assert.equal(report.reportSelection,selectedReport);assert.equal(report.artifactDirectory,artifactDirectory);
 assert.deepEqual(report.sourceAuthority,await verifyWindowsContainmentGate(),'Fresh native report source/gate authority changed');
 assert.deepEqual(report.helperFreeze,await authenticateHelperFreeze(),'Root helper freeze changed');
 assert.deepEqual(report.successorSelection,await authenticateSuccessorSelection(),'Successor selection bytes changed');
 assert.deepEqual(report.predecessorRecovery,await authenticateRecovery(),'Preparing predecessor cleanup changed');
 assert.equal(sha(stable(await snapshot(sourceRoot))),report.sourceDigest,'Canonical kit source drifted');
 await inspectReportLocation(sourceRoot,artifactDirectory,{kind:'directory'});
 assert.equal(new Set(report.artifacts.map(record=>record.path)).size,report.artifacts.length);
 for(const record of report.artifacts){assert.equal(path.posix.dirname(record.path),artifactDirectory);await inspectReportLocation(sourceRoot,record.path);const bytes=await readFile(path.join(sourceRoot,record.path));assert.equal(bytes.length,record.bytes);assert.equal(sha(bytes),record.sha256);}
}
async function command(report,label,args,cwd=sourceRoot){
 assert.equal(report.pending,null,'Reconcile unknown command outcome before continuing');
 report.pending={label,args,startedAt:new Date().toISOString()};await save(report);
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,args,{cwd,env:cleanEnv(),windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',bytes=0;
  const capture=kind=>chunk=>{bytes+=chunk.length;if(bytes>1000000){child.kill();reject(new Error('Controller capture exceeded bound; reconcile pending outcome'));return;}if(kind==='stdout')stdout+=chunk;else stderr+=chunk;};
  child.stdout.on('data',capture('stdout'));child.stderr.on('data',capture('stderr'));child.once('error',reject);child.once('close',exitCode=>resolve({exitCode,stdout,stderr}));
 });
 await artifact(report,`${label}-controller.json`,{args,cwd,exitCode:result.exitCode,stdout:result.stdout,stderr:result.stderr});
 report.pending=null;await save(report);assert.equal(result.exitCode,0,`${label} failed; no automatic retry`);return result;
}
async function git(args,cwd){await new Promise((resolve,reject)=>execFile('git',args,{cwd,env:cleanEnv(),windowsHide:true},error=>error?reject(error):resolve()));}
async function baseUser(client){
 const result=await client.rpc('config/read',{includeLayers:true});
 const layers=result.layers?.filter(layer=>layer.name?.type==='user'&&!layer.name.profile&&path.resolve(layer.name.file)===configPath);
 assert.equal(layers?.length,1);assert.equal(typeof layers[0].version,'string');return layers[0];
}
const configHash=config=>sha(stable(config));
export function assertConfigHashEqual(actual,expected,message){
 if(configHash(actual)!==configHash(expected))throw new Error(message);
}
export function configReceiptProjection(report,{stage,id,method,params,result,error}){
 const owned=config=>({projectTrust:['trusted','untrusted'].includes(config?.projects?.[report.projectKey]?.trust_level)?config.projects[report.projectKey].trust_level:null,hooks:Object.fromEntries((report.definitions??[]).map(({key})=>{
  const value=config?.hooks?.state?.[key]?.trusted_hash??null;
  assert(value===null||typeof value==='string'&&/^sha256:[0-9a-f]{64}$/.test(value),'Malformed native trusted hook hash');return [key,value];
 }))});
 const receipt={stage,id,method};
 if(stage==='request'){
  if(method==='config/read')receipt.includeLayers=params?.includeLayers===true;
  else Object.assign(receipt,{filePath:params.filePath,expectedVersion:params.expectedVersion,edits:params.edits.map(edit=>({keyPath:edit.keyPath,mergeStrategy:edit.mergeStrategy,valueSha256:configHash(edit.value),owned:owned(edit.keyPath==='projects'?{projects:edit.value}:edit.keyPath==='hooks.state'?{hooks:{state:edit.value}}:{})}))});
 }else if(stage==='response'){
  receipt.resultSha256=configHash(result);
  if(method==='config/read')receipt.userLayers=(result.layers??[]).filter(layer=>layer.name?.type==='user'&&!layer.name.profile&&path.resolve(layer.name.file)===configPath).map(layer=>({filePath:layer.name.file,version:layer.version,semanticSha256:configHash(layer.config),unrelatedSha256:configHash(withoutOwned(layer.config,report)),owned:owned(layer.config)}));
 }else receipt.errorSha256=sha(String(error));
 return receipt;
}
export function assertConfigReceiptBindings({receipts},events){
 assert(Array.isArray(receipts)&&receipts.length>=3&&receipts.length%3===0,'Complete nonempty native config receipt triples required');
 const digest=value=>assert(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value));
 const owned=value=>{
  assert(value&&['trusted','untrusted',null].includes(value.projectTrust));assert(value.hooks&&typeof value.hooks==='object'&&!Array.isArray(value.hooks));
  for(const hash of Object.values(value.hooks))assert(hash===null||typeof hash==='string'&&/^sha256:[a-f0-9]{64}$/.test(hash));
 };
 const groups=[];
 for(let i=0;i<receipts.length;i+=3){
  const [request,response,raw]=receipts.slice(i,i+3);
  assert.equal(request.stage,'request');assert.equal(response.stage,'response');assert.equal(raw.stage,'raw-boundary');
  assert(Number.isSafeInteger(request.id)&&request.id>0);assert(['config/read','config/batchWrite'].includes(request.method));
  assert.equal(response.id,request.id);assert.equal(raw.id,request.id);assert.equal(response.method,request.method);assert.equal(raw.method,request.method);
  digest(response.resultSha256);for(const hash of [raw.beforeSha256,raw.afterSha256])if(hash!==null)digest(hash);
  if(request.method==='config/read'){
   assert.equal(request.includeLayers,true);assert.equal(response.userLayers.length,1);assert.equal(raw.readStable,true);assert.equal(raw.beforeSha256,raw.afterSha256);
   const layer=response.userLayers[0];assert.equal(path.resolve(layer.filePath),configPath);assert(typeof layer.version==='string'&&layer.version.length>0);
   digest(layer.semanticSha256);digest(layer.unrelatedSha256);owned(layer.owned);
  }else{
   assert.equal(path.resolve(request.filePath),configPath);assert.equal(raw.readStable,null);
   assert(Array.isArray(request.edits)&&request.edits.length>0);assert.equal(new Set(request.edits.map(edit=>edit.keyPath)).size,request.edits.length);
   for(const edit of request.edits){assert(['projects','hooks.state'].includes(edit.keyPath));assert.equal(edit.mergeStrategy,'replace');digest(edit.valueSha256);owned(edit.owned);}
  }
  groups.push({request,response,raw});
 }
 assert.equal(new Set(groups.map(group=>group.request.id)).size,groups.length);
 assert(groups.some(group=>group.request.method==='config/read'));
 for(let i=0;i<groups.length;i++){
  const {request,raw}=groups[i];
  if(i)assert.equal(raw.beforeSha256,groups[i-1].raw.afterSha256,'Raw native config boundary chain changed');
  if(request.method==='config/batchWrite'){
   const prior=groups[i-1],after=groups[i+1];assert.equal(prior?.request.method,'config/read');assert.equal(after?.request.method,'config/read');
   const before=prior.response.userLayers[0],next=after.response.userLayers[0];
   assert.equal(request.expectedVersion,before.version);assert.equal(next.unrelatedSha256,before.unrelatedSha256);
   const expected=structuredClone(before.owned);
   for(const edit of request.edits){if(edit.keyPath==='projects')expected.projectTrust=edit.owned.projectTrust;else expected.hooks=edit.owned.hooks;}
   assert.deepEqual(next.owned,expected,'Version-checked write must produce its requested owned changes');
  }
 }
 if(events){
  const logged=events.filter(e=>e.kind==='configRpcReceipt').map(({at,kind,...receipt})=>receipt);
  assert.deepEqual(logged,receipts.filter(receipt=>receipt.stage!=='raw-boundary'),'Config receipt artifact must match native RPC event bytes');
  const nativeRequests=events.filter(e=>e.kind==='request'&&['config/read','config/batchWrite'].includes(e.method));
  assert.deepEqual(nativeRequests.map(({id,method})=>({id,method})),groups.map(({request:{id,method}})=>({id,method})));
  for(const {request,response} of groups){const start=events.findIndex(e=>e.kind==='request'&&e.id===request.id&&e.method===request.method),sent=events.findIndex(e=>e.kind==='configRpcReceipt'&&e.stage==='request'&&e.id===request.id),done=events.findIndex(e=>e.kind==='configRpcReceipt'&&e.stage==='response'&&e.id===response.id);assert(start>=0&&sent>start&&done>sent);}
 }
}
function withoutOwned(config,report){
 const copy=structuredClone(config);const state=copy.hooks?.state??{};
 for(const definition of report.definitions??[]){if(state[definition.key]){delete state[definition.key].trusted_hash;if(!Object.keys(state[definition.key]).length)delete state[definition.key];}}
 const project=copy.projects?.[report.projectKey];if(project){delete project.trust_level;if(!Object.keys(project).length)delete copy.projects[report.projectKey];}
 return copy;
}
async function nativeConfigSession(report,label,operation){
 const log=path.join(sourceRoot,report.artifactDirectory,`${label}-events.jsonl`),receipts=[];
 const client=await connect({cwd:report.fixture,log,configReceipt:data=>{const receipt=configReceiptProjection(report,data);receipts.push(receipt);return receipt;}});
 const rpc=client.rpc;
 client.rpc=async(method,params)=>{
  if(!['config/read','config/batchWrite'].includes(method))return rpc(method,params);
  const rawBefore=await optionalBytes(configPath),first=receipts.length;
  try{return await rpc(method,params);}finally{
   const rawAfter=await optionalBytes(configPath),request=receipts.slice(first).find(receipt=>receipt.stage==='request');
   const record={stage:'raw-boundary',method,id:request?.id??null,beforeSha256:rawBefore===null?null:sha(rawBefore),afterSha256:rawAfter===null?null:sha(rawAfter),readStable:method==='config/read'?sha(rawBefore??'')===sha(rawAfter??''):null};receipts.push(record);
   if(method==='config/read')assert(record.readStable,'Native raw config drifted during read; outcome is parked');
  }
 };
 let completed=false;
 try{const result=await operation(client);completed=true;return result;}finally{const receipt=await artifact(report,`${label}-config-receipts.json`,{version:1,label,observedDirectRpc:true,receipts});report.configReceiptPaths??=[];report.configReceiptPaths.push(receipt.path);await save(report);const termination=await client.closeConfirmed();report.terminations.push({label,...termination});await artifactExisting(report,log);await save(report);if(completed)assertConfigReceiptBindings({receipts});}
}
async function artifactExisting(report,file){const bytes=await readFile(file);const record={path:path.relative(sourceRoot,file).replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)};report.artifacts.push(record);return record;}
const eventsFrom=bytes=>bytes.toString().trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
async function readPinned(ref){await inspectReportLocation(sourceRoot,ref.path);const bytes=await readFile(path.join(sourceRoot,ref.path));assert.equal(bytes.length,ref.bytes);assert.equal(sha(bytes),ref.sha256);return bytes;}
async function recoveryReference(){await inspectReportLocation(sourceRoot,recoveryPath);const bytes=await readFile(path.join(sourceRoot,recoveryPath));return {path:recoveryPath,bytes:bytes.length,sha256:sha(bytes)};}
export function assertPreparingRecoveryShape(report){
 assert.equal(report.version,1);assert.equal(report.featureId,'native-hook-v2-live-003');assert.equal(report.status,'preparing');assert.equal(report.reportSelection,originalReport);assert.equal(report.pending,null);
 assert.equal(report.sourceRoot,sourceRoot);assert.equal(report.projectKey,report.fixture.toLowerCase());assert(path.isAbsolute(report.fixture));
 for(const key of ['definitions','installedInventory','workerA','workerB','transfer','lifecycle','cleanup'])assert(!Object.hasOwn(report,key),'Recovery rejects partial native lifecycle: '+key);
 assert.deepEqual(report.terminations.map(item=>item.label),['before-enrollment']);assert.equal(report.projectTrustPersisted,true);
 for(const key of ['trustBypass','projectTrustOverride','manualCompaction'])assert.equal(report[key],false);
 assert.equal(report.policy.baselineAbsent,true);assert.equal(report.policy.currentHash,report.policy.expectedEnabledHash);
 assert.deepEqual(report.policy.transitions.map(item=>item.label),['temporary-policy-source-enable','temporary-policy-enable']);
}
export function planRecoveryConfig(config,report){
 assert.equal(report.definitions.length,6);assert.equal(new Set(report.definitions.map(item=>item.key)).size,6);
 for(const definition of report.definitions){assert(/^sha256:[a-f0-9]{64}$/.test(definition.currentHash));assert.equal(definition.trustStatus,'trusted');assert.equal(definition.enabled,true);assert.equal(config.hooks?.state?.[definition.key]?.trusted_hash,definition.currentHash,'Owned native approval drift; recovery is parked');}
 assert.equal(config.projects?.[report.projectKey]?.trust_level,'trusted','Owned project trust drift; recovery is parked');
 return withoutOwned(config,report);
}
export function assertRecoveryProcessesAbsent(rows,report){
 assert(Array.isArray(rows));const pids=new Set(report.terminations.flatMap(item=>item.treePids));assert(pids.size>0);
 assert(!rows.some(row=>pids.has(row.ProcessId)),'A prior native PID is present or reused; recovery is parked');
 const fixture=report.fixture.toLowerCase();assert(!rows.some(row=>typeof row.CommandLine==='string'&&row.CommandLine.toLowerCase().includes(fixture)),'Fixture-associated process remains; recovery is parked');
 return {observedAt:new Date().toISOString(),priorTreePids:[...pids].sort((a,b)=>a-b),priorPidsAbsent:true,fixtureProcessesAbsent:true,providerEnvironmentSanitized:true};
}
export function assertRecoveryObservationOrder(ledger,events,before,after){
 const timestamp=value=>{assert.equal(typeof value,'string');const time=Date.parse(value);assert(Number.isFinite(time));assert.equal(new Date(time).toISOString(),value);return time;};
 const invocations=events.filter(event=>event.kind==='invocation'),terminations=events.filter(event=>event.kind==='confirmedTermination'),requests=events.filter(event=>event.kind==='request');
 assert.equal(invocations.length,1);assert.equal(terminations.length,1);
 assert.deepEqual(requests.map(event=>event.method),['initialize','hooks/list','config/read','config/batchWrite','config/read']);
 const start=timestamp(invocations[0].at),end=timestamp(terminations[0].at),created=timestamp(ledger.createdAt),finished=timestamp(ledger.finishedAt);
 assert(timestamp(before.observedAt)<=created&&created<=start,'Recovery initial observation must precede ledger creation and native invocation');
 assert(end<=timestamp(after.observedAt)&&timestamp(after.observedAt)<=finished,'Recovery final observation must follow confirmed termination and precede completion');
 assert(created<=finished&&start<=end);
 const startIndex=events.indexOf(invocations[0]),endIndex=events.indexOf(terminations[0]);let previous=start;
 for(const request of requests){const time=timestamp(request.at),index=events.indexOf(request);assert(startIndex<index&&index<endIndex);assert(previous<=time&&time<=end);previous=time;}
}
async function recoveryProcessAbsence(report){
 assert.equal(process.platform,'win32');
 const output=await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress'],{env:cleanEnv(),windowsHide:true,timeout:30000,maxBuffer:4000000},(error,stdout)=>error?reject(new Error('Recovery process inventory failed')):resolve(stdout)));
 const value=JSON.parse(output);return assertRecoveryProcessesAbsent(value===null?[]:Array.isArray(value)?value:[value],report);
}
async function predecessorRecoveryAuthority(){
 const archive=await authenticatePredecessorArchive();const report=JSON.parse(await readPinned(archive.report));assertPreparingRecoveryShape(report);
 const archived=async name=>{const matches=archive.archived.filter(item=>item.original.path===report.artifactDirectory+'/'+name);assert.equal(matches.length,1);return readPinned(matches[0].archive);};
 const receipts=JSON.parse(await archived('before-enrollment-config-receipts.json')),events=eventsFrom(await archived('before-enrollment-events.jsonl'));
 assertConfigReceiptBindings(receipts,events);assertConfirmedTermination(report,'before-enrollment',events);
 assert.deepEqual(receipts.receipts.filter(item=>item.stage==='request').map(item=>item.method),['config/read','config/batchWrite','config/read']);
 const reads=receipts.receipts.filter(item=>item.stage==='response'&&item.method==='config/read').map(item=>item.userLayers[0]);assert.deepEqual(reads.map(item=>item.owned),[{projectTrust:null,hooks:{}},{projectTrust:'trusted',hooks:{}}]);assert.equal(reads[0].semanticSha256,report.nativeConfigBeforeHash);assert.equal(reads[1].unrelatedSha256,report.unrelatedBeforeHash);
 const applied=JSON.parse(await archived('fixture-reviewed-sync-controller.json'));assert.equal(applied.exitCode,0);const approval=JSON.parse(applied.stdout).nativeHookApproval;assert.equal(approval.status,'trusted');assert.equal(approval.approved,6);
 const canonical=JSON.parse(await archived('canonical-rendered.json'));assert.deepEqual(canonical,await canonicalCodexHooks(sourceRoot));
 assert.deepEqual(JSON.parse(await archived('policy-baseline.json')),{absent:true,sha256:null});
 const policy=await archived('temporary-policy-enable-policy.json');assert.equal(sha(policy),report.policy.expectedEnabledHash);assert.deepEqual(JSON.parse(policy),report.policy.transitions[1].expected);
 return {archive,report,canonical,policy};
}
export async function authenticateRecovery(){
 const ref=await recoveryReference(),ledger=JSON.parse(await readPinned(ref)),authority=await predecessorRecoveryAuthority();
 assert.equal(ledger.version,1);assert.equal(ledger.featureId,'native-hook-v2-live-003');assert.equal(ledger.status,'blocked-cleaned');assert.equal(ledger.nativeSuccess,false);assert.equal(ledger.reportSelection,recoveryPath);assert.equal(ledger.artifactDirectory,recoveryDirectory);
 assert.deepEqual(ledger.predecessorArchive,archivePin);assert.deepEqual(ledger.originalReport,authority.archive.report);assert.deepEqual(ledger.helperFreeze,await authenticateHelperFreeze());assert.deepEqual(ledger.successorSelection,await authenticateSuccessorSelection());assert.equal(ledger.fixture,authority.report.fixture);assert.equal(ledger.projectKey,authority.report.projectKey);
 assert.equal(ledger.pending,null);assert.deepEqual(ledger.cleanup,{nativeOwnedChangesRemoved:true,freshReadback:true,unrelatedConfigPreserved:true,policyBaselineAbsenceRestored:true,confirmedTreeTermination:true});
 assert.equal(new Set(ledger.artifacts.map(item=>item.path)).size,ledger.artifacts.length);for(const item of ledger.artifacts){assert.equal(path.posix.dirname(item.path),recoveryDirectory);await readPinned(item);}
 const bound=async name=>{const matches=ledger.artifacts.filter(item=>item.path===recoveryDirectory+'/'+name);assert.equal(matches.length,1);return readPinned(matches[0]);};
 const discovery=JSON.parse(await bound('recovery-native-discovery.json'));const fixtureCanonical=await canonicalCodexHooks(sourceRoot);const definitions=reviewNativeDefinitions(discovery,ledger.fixture,fixtureCanonical,fixtureCanonical);assert.equal(definitions.length,6);assert(definitions.every(item=>item.trustStatus==='trusted'&&item.enabled));assert.deepEqual(ledger.definitions,definitions.map(({command,...definition})=>({...definition,commandSha256:sha(command)})));
 const record=JSON.parse(await bound('recovery-config-receipts.json')),events=eventsFrom(await bound('recovery-events.jsonl'));assertConfigReceiptBindings(record,events);assertConfirmedTermination(ledger,'recovery',events);
 const requests=record.receipts.filter(item=>item.stage==='request');assert.deepEqual(requests.map(item=>item.method),['config/read','config/batchWrite','config/read']);assert.deepEqual(requests[1].edits.map(item=>item.keyPath),['hooks.state','projects']);
 const reads=record.receipts.filter(item=>item.stage==='response'&&item.method==='config/read').map(item=>item.userLayers[0]);const hooks=Object.fromEntries(ledger.definitions.map(item=>[item.key,item.currentHash]));assert.deepEqual(reads[0].owned,{projectTrust:'trusted',hooks});assert.deepEqual(reads[1].owned,{projectTrust:null,hooks:Object.fromEntries(Object.keys(hooks).map(key=>[key,null]))});assert.equal(reads[0].unrelatedSha256,reads[1].unrelatedSha256);
 const before=JSON.parse(await bound('recovery-processes-before.json')),after=JSON.parse(await bound('recovery-processes-after.json'));
 for(const proof of [before,after]){assert.equal(proof.priorPidsAbsent,true);assert.equal(proof.fixtureProcessesAbsent,true);assert.equal(proof.providerEnvironmentSanitized,true);assert.deepEqual(proof.priorTreePids,authority.report.terminations[0].treePids.slice().sort((a,b)=>a-b));}
 assertRecoveryObservationOrder(ledger,events,before,after);
 assert.deepEqual(JSON.parse(await bound('recovery-policy-removal.json')),{beforeSha256:sha(authority.policy),afterSha256:null,baselineAbsent:true,guard:'checked-immediately-before-unlink'});
 return ref;
}
async function recoverPreparing(){
 assert(explicitReport&&requestedReport===originalReport,'Preparing recovery requires explicit original --report');
 await inspectReportLocation(sourceRoot,recoveryPath,{absent:true});await inspectReportLocation(sourceRoot,recoveryDirectory,{kind:'directory',absent:true});
 const authority=await predecessorRecoveryAuthority(),helperFreeze=await authenticateHelperFreeze(),successorSelection=await authenticateSuccessorSelection();
 const before=await recoveryProcessAbsence(authority.report);assert.equal(sha(await readFile(policyPath)),sha(authority.policy),'Temporary policy drift; recovery is parked');
 await mkdir(path.join(sourceRoot,recoveryDirectory));
 const ledger={version:1,featureId:'native-hook-v2-live-003',createdAt:new Date().toISOString(),status:'recovering',nativeSuccess:false,reportSelection:recoveryPath,artifactDirectory:recoveryDirectory,predecessorArchive:archivePin,originalReport:authority.archive.report,helperFreeze,successorSelection,fixture:authority.report.fixture,projectKey:authority.report.projectKey,pending:null,artifacts:[],terminations:[]};
 await save(ledger,{exclusive:true});
 try{
  await artifact(ledger,'recovery-processes-before.json',before);
  await nativeConfigSession(ledger,'recovery',async client=>{
   const canonical=await canonicalCodexHooks(sourceRoot);assert.deepEqual(await json(path.join(ledger.fixture,'.codex/hooks.json')),canonical,'Stopped fixture canonical definitions drifted');
   const discovery=await client.rpc('hooks/list',{cwds:[ledger.fixture]}),definitions=reviewNativeDefinitions(discovery,ledger.fixture,canonical,canonical);assert.equal(definitions.length,6);assert(definitions.every(item=>item.trustStatus==='trusted'&&item.enabled));ledger.definitions=definitions.map(({command,...definition})=>({...definition,commandSha256:sha(command)}));await artifact(ledger,'recovery-native-discovery.json',discovery);
   const base=await baseUser(client),target=planRecoveryConfig(base.config,ledger);assert(typeof base.version==='string'&&base.version.length>0);
   ledger.pending={kind:'config/batchWrite',expectedVersion:base.version};await save(ledger);
   await client.rpc('config/batchWrite',{filePath:configPath,expectedVersion:base.version,reloadUserConfig:true,edits:[{keyPath:'hooks.state',mergeStrategy:'replace',value:target.hooks.state},{keyPath:'projects',mergeStrategy:'replace',value:target.projects}]});
   const after=await baseUser(client);assertConfigHashEqual(after.config,target,'Recovery CAS readback differs from requested config');assertConfigHashEqual(withoutOwned(after.config,ledger),withoutOwned(base.config,ledger),'Recovery changed unrelated config');ledger.pending=null;await save(ledger);
  });
  await artifact(ledger,'recovery-processes-after.json',await recoveryProcessAbsence(authority.report));
  assert.equal(sha(await readFile(policyPath)),sha(authority.policy),'Temporary policy drift; recovery is parked');await unlink(policyPath);assert.equal(await optionalBytes(policyPath),null,'Policy removal outcome is unknown');
  await artifact(ledger,'recovery-policy-removal.json',{beforeSha256:sha(authority.policy),afterSha256:null,baselineAbsent:true,guard:'checked-immediately-before-unlink'});
  ledger.cleanup={nativeOwnedChangesRemoved:true,freshReadback:true,unrelatedConfigPreserved:true,policyBaselineAbsenceRestored:true,confirmedTreeTermination:true};ledger.status='blocked-cleaned';ledger.finishedAt=new Date().toISOString();await save(ledger);await authenticateRecovery();return ledger;
 }catch(error){ledger.status='blocked';ledger.failure='Recovery stopped; reconcile authenticated receipts and external state before any new action';await save(ledger);throw error;}
}
async function prepare(){
 assert(explicitReport&&requestedReport===selectedReport,'Prepare requires explicit successor --report');
 await inspectReportLocation(sourceRoot,selectedReport,{absent:true});
 await inspectReportLocation(sourceRoot,artifactDirectory,{kind:'directory',absent:true});
 const sourceAuthority=await verifyWindowsContainmentGate();
 const helperFreeze=await authenticateHelperFreeze();
 const successorSelection=await authenticateSuccessorSelection();const predecessorRecovery=await authenticateRecovery();
 assert.equal(await optionalBytes(policyPath),null,'Temporary real HOME policy must begin absent');
 await mkdir(path.dirname(artifactRoot),{recursive:true});await mkdir(artifactRoot);
 const report={version:1,featureId:'native-hook-v2-live-003',status:'preparing',createdAt:new Date().toISOString(),sourceRoot,sourceDigest:sourceAuthority.sourceDigest,sourceAuthority,helperFreeze,successorSelection,predecessorRecovery,reportSelection:selectedReport,artifactDirectory,fixture:null,projectKey:null,binary,artifacts:[],terminations:[],pending:null,policy:{baselineAbsent:true},trustBypass:false,projectTrustOverride:false,manualCompaction:false};
 await save(report,{exclusive:true});
 const fixture=await mkdtemp(path.join(os.tmpdir(),'agent-harness-v2-live-'));report.fixture=fixture;report.projectKey=fixture.toLowerCase();
 await save(report);await artifact(report,'source-snapshot.json',await snapshot(sourceRoot));
 await artifact(report,'canonical-template.txt',await readFile(path.join(sourceRoot,'skill/codex-harness/assets/codex-hooks.json.template')));
 await artifact(report,'canonical-bootstrap.json',await readFile(path.join(sourceRoot,'skill/codex-harness/assets/native-hook-bootstrap-v2.json')));
 const canonical=await canonicalCodexHooks(sourceRoot);await artifact(report,'canonical-rendered.json',canonical);
 await artifact(report,'source-installed-hooks.json',await readFile(path.join(sourceRoot,'.codex/hooks.json')));
 assert.deepEqual(await json(path.join(sourceRoot,'.codex/hooks.json')),canonical,'Source must contain one exact current canonical group for each event');
 await authenticate(report);await artifact(report,'policy-baseline.json',{absent:true,sha256:null});
 await writeFile(path.join(fixture,'package.json'),JSON.stringify({name:'native-v2-fixture',type:'module',private:true,scripts:{test:'node --test acceptance.test.mjs'}},null,2)+'\n');
 await writeFile(path.join(fixture,'product.mjs'),'export function sumCents(values) { throw new Error("Implement integer cents sum"); }\n');
 await writeFile(path.join(fixture,'acceptance.test.mjs'),"import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport {sumCents} from './product.mjs';\ntest('empty sum',()=>assert.equal(sumCents([]),0));\ntest('signed cents',()=>assert.equal(sumCents([125,-25,40]),140));\ntest('reject fraction',()=>assert.throws(()=>sumCents([1.5])));\ntest('reject unsafe sum',()=>assert.throws(()=>sumCents([Number.MAX_SAFE_INTEGER,1])));\ntest('reject non array',()=>assert.throws(()=>sumCents('1')));\n");
 await artifact(report,'original-acceptance.test.mjs',await readFile(path.join(fixture,'acceptance.test.mjs')));
 await git(['init'],fixture);await git(['config','user.name','Disposable Fixture'],fixture);await git(['config','user.email','fixture@example.invalid'],fixture);
 await command(report,'fixture-init',[path.join(sourceRoot,'bin/agent-harness.mjs'),'init',fixture]);
 const config=await json(path.join(fixture,'.harness/config.json'));config.verification={quick:['node --check product.mjs'],full:['node --test acceptance.test.mjs'],e2e:[],architecture:[],clean:[]};
 await writeFile(path.join(fixture,'.harness/config.json'),JSON.stringify(config,null,2)+'\n');
 await artifact(report,'fixture-runtime.mjs',await readFile(path.join(fixture,'.harness/run.mjs')));await artifact(report,'fixture-config.json',config);
 assert.equal(sha(await readFile(path.join(fixture,'.harness/run.mjs'))),sha(await readFile(path.join(sourceRoot,'skill/codex-harness/assets/project-runtime.mjs'))));
 await git(['add','.'],fixture);await git(['commit','-m','Prepare deterministic native V2 fixture'],fixture);
 await nativeConfigSession(report,'before-enrollment',async client=>{
  const base=await baseUser(client);assert(!base.config.projects?.[report.projectKey],'Disposable fixture project key already exists');
  report.nativeConfigBeforeHash=configHash(base.config);report.unrelatedBeforeHash=configHash(withoutOwned(base.config,report));
  const projects={...(base.config.projects??{}),[report.projectKey]:{trust_level:'trusted'}};
  await client.rpc('config/batchWrite',{filePath:configPath,expectedVersion:base.version,reloadUserConfig:true,edits:[{keyPath:'projects',mergeStrategy:'replace',value:projects}]});
  const after=await baseUser(client);assert.equal(after.config.projects[report.projectKey].trust_level,'trusted');
  assertConfigHashEqual(withoutOwned(after.config,report),withoutOwned(base.config,report),'Native enrollment changed unrelated config');report.projectTrustPersisted=true;
 });
 await policyTransition(report,'temporary-policy-source-enable',[path.join(sourceRoot,'bin/agent-harness.mjs'),'hook-policy','enable',sourceRoot,'--project',sourceRoot],{version:1,enabled:true,authority:'explicit-canonical-kit-location',sourceRoot,projects:[sourceRoot]});
 await policyTransition(report,'temporary-policy-enable',[path.join(sourceRoot,'bin/agent-harness.mjs'),'hook-policy','enable',sourceRoot,'--project',fixture],{version:1,enabled:true,authority:'explicit-canonical-kit-location',sourceRoot,projects:[sourceRoot,fixture].sort()});
 const policy=await optionalBytes(policyPath);report.policy.expectedEnabledHash=sha(policy);report.policy.projects=(JSON.parse(policy)).projects;await save(report);
 assert.deepEqual(report.policy.projects.slice().sort(),[sourceRoot,fixture].sort());
 const syncRawBefore=await optionalBytes(configPath);
 const applied=await command(report,'fixture-reviewed-sync',[path.join(sourceRoot,'bin/agent-harness.mjs'),'sync',fixture,'--enroll-hooks','--json']);
 const syncRawAfter=await optionalBytes(configPath);
 report.fixtureSyncConfigObservation={beforeRawSha256:syncRawBefore===null?null:sha(syncRawBefore),afterRawSha256:syncRawAfter===null?null:sha(syncRawAfter),internalExpectedVersionObserved:false,internalWriteReceiptObserved:false,authority:'CLI result and independent raw boundaries; internal CAS attested by unchanged canonical source'};
 await artifact(report,'fixture-sync-config-observation.json',report.fixtureSyncConfigObservation);
 const result=JSON.parse(applied.stdout);assert.equal(result.nativeHookApproval?.status,'trusted');assert.equal(result.nativeHookApproval?.approved,6);
 report.installedInventory=await captureInstalledInventory(fixture,(name,bytes)=>artifact(report,name,bytes));
 await artifact(report,'installed-hooks.json',await readFile(path.join(fixture,'.codex/hooks.json')));
 assert.deepEqual(await json(path.join(fixture,'.codex/hooks.json')),canonical);
 await nativeConfigSession(report,'reviewed-readback',async client=>{
  const discovery=await client.rpc('hooks/list',{cwds:[fixture]});const defs=reviewNativeDefinitions(discovery,fixture,canonical,canonical);
  assert.equal(defs.length,6);assert(defs.every(d=>d.trustStatus==='trusted'&&d.enabled));
  report.definitions=defs.map(({command,...definition})=>({...definition,commandSha256:sha(command)}));
  const base=await baseUser(client);for(const definition of defs)assert.equal(base.config.hooks.state[definition.key].trusted_hash,definition.currentHash);
  report.unrelatedEnrolledHash=configHash(withoutOwned(base.config,report));assert.equal(report.unrelatedEnrolledHash,report.unrelatedBeforeHash);
  await artifact(report,'reviewed-native-discovery.json',discovery);
 });
 await authenticate(report);report.status='prepared';await save(report);return report;
}
const workerAInstructions=`You are the sole mutating worker in a disposable native V2 development fixture. Follow the local AGENTS.md owned bounded startup exactly. Implement sumCents in product.mjs to satisfy the unchanged five acceptance cases. Create one feature fixture-cents-001 with acceptance command node --test acceptance.test.mjs and explicit allow product.mjs then start it. Work normally using real bounded tools. This milestone intentionally remains active for a later fresh worker verification. Do not manually handoff or checkpoint or verify before the automatic native context boundary. After native automatic compaction, read only node .harness/run.mjs session --json for routing, return its exact resume command, and stop; never resume or consume a packet in this thread. Never edit .harness implementation or acceptance.test.mjs or trust. Product runtime must stay independent of .harness.`;
const workPrompts=[
 'Run the bounded startup and implement the integer cents sum with safe integer validation and overflow rejection. Use the unchanged test file to understand all five cases. Keep this feature active after implementation for the fresh worker verification milestone.',
 'Inspect the completed product and unchanged acceptance cases using bounded real tools. Explain integer precision and overflow behavior, how signed refunds are handled, and which acceptance case covers each decision. Keep the active worker ownership until an automatic compaction boundary. If compaction has parked a transfer, return only session routing and its exact resume command.',
 'Review the fixture project documentation and current bounded harness status. Check the implementation against the five acceptance cases, inspect relevant operations documentation, and identify the exact remaining verification milestone. Continue normally through automatic host compaction; if parked, return only session routing.',
 'Inspect the product module and test module with real bounded tools once more to assess array validation, negative values, and unsafe integer boundaries. Explain the concrete coverage and how the independent successor should run the configured gate. If automatic compaction parked ownership, return only the exact routing command.'
];
async function lifecycle(report){
 assert.equal(report.status,'prepared','Lifecycle requires completed reviewed preparation');await authenticate(report);
 assert.equal(sha(await readFile(policyPath)),report.policy.expectedEnabledHash);
 report.status='native-running';await save(report);
 const logA=path.join(artifactRoot,'worker-a-events.jsonl');const clientA=await connect({cwd:report.fixture,log:logA,limit:5000,bodyAfterPrefix:true});
 try{
  const started=await clientA.start(workerAInstructions);const threadId=started.thread.id;
  report.workerA={threadId,header:null,turns:[],autoCompactTokenLimit:5000,scope:'body_after_prefix'};await save(report);
  for(let i=0;i<8;i++){
   const turn=await settledTurn(clientA,threadId,workPrompts[Math.min(i,workPrompts.length-1)],report.fixture,i===0?{headerPath:started.thread.path}:{});if(i===0)report.workerA.header=turn.header;report.workerA.turns.push({id:turn.turn.id,status:turn.turn.status});await save(report);
   const session=JSON.parse((await command(report,`fixture-routing-${i}`,[path.join(report.fixture,'.harness/run.mjs'),'session','--json'],report.fixture)).stdout);
   if(session.phase==='awaiting_resume'){
    const started=clientA.events.find(e=>e.method==='item/started'&&e.item?.type==='contextCompaction'&&e.threadId===threadId&&e.turnId===turn.turn.id);
    assert(started,'Transfer must accompany actual automatic native compaction');
    assert(clientA.events.some(e=>e.method==='item/completed'&&e.item?.id===started.item.id&&e.item?.type==='contextCompaction'),'Paired automatic compaction completion');
    assert.equal(session.resumeCommand,`node .harness/run.mjs resume ${session.handoffId}`);report.transfer={handoffId:session.handoffId,resumeCommand:session.resumeCommand,compactionItemId:started.item.id,compactionStartedIndex:started.eventIndex,threadId,turnId:turn.turn.id};await artifact(report,'fixture-transfer-session.json',session);break;
   }
  }
  assert(report.transfer,'No actual automatic compact transfer occurred within bounded normal work');
 }finally{report.terminations.push({label:'worker-a',...await clientA.closeConfirmed()});await artifactExisting(report,logA);await save(report);}
 const logB=path.join(artifactRoot,'worker-b-events.jsonl');const clientB=await connect({cwd:report.fixture,log:logB,limit:80000});
 try{
  const instructions=`You are a fresh sole mutating worker in this disposable fixture. No earlier worker transcript is provided. Objective: verify integer cents product acceptance and release ownership. Instead of claim, run exactly ${report.transfer.resumeCommand} then bootstrap --json; read local config and docs and run doctor status next. Inspect only the bounded packet obtained by your own resume. Correct product.mjs only if needed. Run node .harness/run.mjs verify fixture-cents-001. On success run checkpoint --reason worker_yield with concise summary and next. Preserve all trust and acceptance files. Follow local AGENTS.md.`;
  const started=await clientB.start(instructions);const threadId=started.thread.id;assert.notEqual(threadId,report.workerA.threadId);
  report.workerB={threadId,header:null,freshThread:true,predecessorTranscriptProvided:false,delegatedResumeCommand:report.transfer.resumeCommand};await save(report);
  const turn=await settledTurn(clientB,threadId,'Resume the exact parked transfer, complete the configured feature verification, and yield with worker_yield.',report.fixture,{headerPath:started.thread.path});report.workerB.header=turn.header;report.workerB.turn={id:turn.turn.id,status:turn.turn.status};assert.equal(turn.turn.status,'completed');
 }finally{report.terminations.push({label:'worker-b',...await clientB.closeConfirmed()});await artifactExisting(report,logB);await save(report);}
 const finalSession=JSON.parse((await command(report,'fixture-final-session',[path.join(report.fixture,'.harness/run.mjs'),'session','--json'],report.fixture)).stdout);
 assert.equal(finalSession.phase,'working');assert.equal(finalSession.owner,null);report.finalSession=finalSession;
 const featureState=await json(path.join(report.fixture,'.harness/features.json'));const feature=featureState.features.find(f=>f.id==='fixture-cents-001');assert.equal(feature.status,'passing');
 await artifact(report,'fixture-features.json',featureState);await artifact(report,'fixture-events.jsonl',await readFile(path.join(report.fixture,'.harness/events.jsonl')));
 await artifact(report,'fixture-continuity.json',await readFile(path.join(report.fixture,'.harness/continuity.json')));
 await artifact(report,'final-product.mjs',await readFile(path.join(report.fixture,'product.mjs')));
 assert(!(await readFile(path.join(report.fixture,'product.mjs'),'utf8')).includes('.harness'));
 assert.equal(sha(await readFile(path.join(report.fixture,'acceptance.test.mjs'))),report.artifacts.find(a=>a.path.endsWith('/original-acceptance.test.mjs')).sha256);
 const evidence=feature.evidence??[];assert(evidence.length>0,'Passing fixture must have configured verification evidence');report.fixturePassingEvidence=[];
 for(const [i,relative] of evidence.entries()){
  assert.equal(typeof relative,'string');assert(relative.startsWith('.harness/evidence/')&&!relative.split(/[\\/]/).includes('..'));
  const bytes=await readFile(path.join(report.fixture,relative));const record=JSON.parse(bytes);
  assert.equal(record.featureId,feature.id);if(i===evidence.length-1){assert.equal(record.pass,true);assert.equal(record.scopeViolations.length,0);assert(record.commands.length>0&&record.commands.every(c=>c.exitCode===0));}
  report.fixturePassingEvidence.push({fixturePath:relative,artifact:await artifact(report,`fixture-verification-${i}.json`,bytes)});
 }
 await artifact(report,'final-acceptance.test.mjs',await readFile(path.join(report.fixture,'acceptance.test.mjs')));
 await authenticate(report);report.status='native-passed';await save(report);return report;
}
async function cleanup(report){
 assert(report.terminations.some(t=>t.label==='worker-a')&&report.terminations.filter(t=>/^worker-/.test(t.label)).every(t=>t.treeAbsent),'Native lifecycle termination must be confirmed before cleanup');
 if(report.status==='native-passed')assert(report.terminations.some(t=>t.label==='worker-b'&&t.treeAbsent));
 await nativeConfigSession(report,'cleanup-readback',async client=>{
  const before=await baseUser(client);const config=structuredClone(before.config);const state=config.hooks?.state??{};
  for(const definition of report.definitions){assert.equal(state[definition.key]?.trusted_hash,definition.currentHash,'Owned native hash drift; cleanup is parked');delete state[definition.key].trusted_hash;if(!Object.keys(state[definition.key]).length)delete state[definition.key];}
  assert.equal(config.projects?.[report.projectKey]?.trust_level,'trusted','Owned project trust drift; cleanup is parked');delete config.projects[report.projectKey].trust_level;if(!Object.keys(config.projects[report.projectKey]).length)delete config.projects[report.projectKey];
  await client.rpc('config/batchWrite',{filePath:configPath,expectedVersion:before.version,reloadUserConfig:true,edits:[{keyPath:'hooks.state',mergeStrategy:'replace',value:state},{keyPath:'projects',mergeStrategy:'replace',value:config.projects}]});
  const after=await baseUser(client);assertConfigHashEqual(after.config,config,'Native cleanup readback differs from requested config');assertConfigHashEqual(withoutOwned(after.config,report),withoutOwned(before.config,report),'Native cleanup changed unrelated config');
  report.cleanup={nativeOwnedChangesRemoved:true,freshReadback:true,unrelatedBeforeHash:configHash(withoutOwned(before.config,report)),unrelatedAfterHash:configHash(withoutOwned(after.config,report)),finalConfigHash:configHash(after.config)};
 });
 assert.equal(sha(await readFile(policyPath)),report.policy.expectedEnabledHash,'Temporary policy drift; cleanup is parked');
 await policyTransition(report,'temporary-policy-disable',[path.join(sourceRoot,'bin/agent-harness.mjs'),'hook-policy','disable'],{version:1,enabled:false});
 const disabled=await readFile(policyPath);assert.deepEqual(JSON.parse(disabled),{version:1,enabled:false});report.policy.expectedDisabledHash=sha(disabled);await save(report);
 assert.equal(sha(await readFile(policyPath)),report.policy.expectedDisabledHash);await unlink(policyPath);assert.equal(await optionalBytes(policyPath),null);
 report.policy.transitions.push({label:'temporary-policy-remove',beforeHash:report.policy.expectedDisabledHash,afterHash:null,expected:null,guard:'checked-immediately-before-unlink'});report.policy.currentHash=null;await save(report);
 report.cleanup.policyBaselineAbsenceRestored=true;report.cleanup.noFixtureInFinalPolicy=true;await authenticate(report);
 report.status=report.status==='native-passed'?'passed':'blocked-cleaned';report.finishedAt=new Date().toISOString();await save(report);return report;
}
export async function runPhase(phase){
 assert(explicitReport,'Actual V2 phases require an explicit fresh --report selection');
 if(phase==='recover-preparing'){const report=await recoverPreparing();console.log(JSON.stringify({status:report.status,report:recoveryPath,fixture:report.fixture,artifacts:report.artifacts.length,nativeSuccess:false}));return;}
 assert.equal(requestedReport,selectedReport,'Native phases require the explicit V2 report');
 assert(['prepare','native','cleanup'].includes(phase),'Select --phase recover-preparing|prepare|native|cleanup');
 if(phase!=='prepare')await inspectReportLocation(sourceRoot,selectedReport);
 let report=phase==='prepare'?await prepare():await json(reportPath);
 if(phase!=='prepare')await authenticate(report);
 if(phase==='native')report=await lifecycle(report);
 else if(phase==='cleanup')report=await cleanup(report);
 else assert.equal(phase,'prepare','Select --phase prepare|native|cleanup');
 console.log(JSON.stringify({status:report.status,report:path.relative(sourceRoot,reportPath),fixture:report.fixture,artifacts:report.artifacts.length}));
}
export function parsePhaseArguments(args){
 assert.equal(args.length,4,'Exactly --phase and --report are required');
 const options={};for(let i=0;i<args.length;i+=2){assert(['--phase','--report'].includes(args[i]),'Unsupported phase argument');assert(!Object.hasOwn(options,args[i]),'Duplicate phase argument');assert.equal(typeof args[i+1],'string');options[args[i]]=args[i+1];}
 assert(['recover-preparing','prepare','native','cleanup'].includes(options['--phase']));
 assert.equal(options['--report'],options['--phase']==='recover-preparing'?originalReport:selectedReport,'The phase requires its fixed report');return options['--phase'];
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runPhase(parsePhaseArguments(process.argv.slice(2)));
