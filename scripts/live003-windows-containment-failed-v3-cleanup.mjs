import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha,stable,snapshot,verifyWindowsContainmentGate,authenticate} from './source-windows-containment-authority.mjs';
import {authenticateHelperFreeze,authenticateSuccessorSelection,recoveryPath} from './live003-windows-containment-gate.mjs';
import {assertRecoveryProcessesAbsent,configReceiptProjection,assertConfigReceiptBindings} from './live003-windows-containment-e2e.mjs';
import {connect} from './live-host-e2e/native-client.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const reportPin={path:'.harness/native-hook-v2-live-003-e2e-report-v3.json',bytes:9189,sha256:'5066f79d112449e76dbfa0c6b14098d4d62853aff4931359ad7a3158743b987b'};
const controllerPin={path:'.harness/native-hook-v2-live-003-e2e-report-v3/fixture-reviewed-sync-controller.json',bytes:2449,sha256:'49391ffdf8061b66fc7dc1ce1e351bd7891b28153efd88caa83d528a54bf1518'};
const recoveryPin={path:recoveryPath,bytes:8090,sha256:'09c071aa88db64db771035e76ec022742dfbd16d31f9b8f2a88e092977792402'};
const directory='.harness/native-hook-v2-live-003-failed-v3-cleanup';
const ledgerFile=path.join(root,directory,'receipt.json');
const policyFile=path.join(process.env.USERPROFILE,'.codex/agent-harness-hook-policy.json');
const configFile=path.join(process.env.USERPROFILE,'.codex/config.toml');
const hash=value=>sha(stable(value));
const optional=async file=>{try{return await readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const save=async ledger=>writeFile(ledgerFile,JSON.stringify(ledger,null,2)+'\n');

export function assertFailedPreparation(report,controller){
 assert.equal(report.status,'preparing');assert.equal(report.pending,null);assert.equal(report.version,1);assert.equal(report.featureId,'native-hook-v2-live-003');
 assert.equal(report.reportSelection,reportPin.path);assert.equal(report.sourceRoot,root);assert.equal(report.projectKey,report.fixture.toLowerCase());assert.equal(report.projectTrustPersisted,true);
 assert.equal(path.basename(report.fixture),'agent-harness-v2-live-55rNJ6');assert.equal(controller.exitCode,1);assert.equal(controller.stdout,'');
 for(const key of ['definitions','installedInventory','workerA','workerB','transfer','lifecycle','cleanup'])assert(!Object.hasOwn(report,key),'Partial lifecycle cannot use failed-preparation cleanup');
 assert.equal(report.policy.baselineAbsent,true);assert.equal(report.policy.currentHash,report.policy.expectedEnabledHash);
 assert.deepEqual(report.terminations.map(item=>item.treePids),[[50776,10520]]);assert(report.terminations.every(item=>item.treeAbsent));
}
export function planFailedPreparationCleanup(config,projectKey){
 assert.equal(config.projects?.[projectKey]?.trust_level,'trusted','Owned fixture trust drifted');
 const target=structuredClone(config);delete target.projects[projectKey].trust_level;
 if(!Object.keys(target.projects[projectKey]).length)delete target.projects[projectKey];
 assert.equal(hash(target.hooks??null),hash(config.hooks??null),'Cleanup must preserve entire hooks state');
 return target;
}
async function processesAbsent(report){
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','Path','PATHEXT','SystemRoot','ComSpec','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA'].includes(key)));
 const output=await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'],{env,windowsHide:true,timeout:30000,maxBuffer:4000000},(error,stdout)=>error?reject(new Error('Process inventory failed')):resolve(stdout)));
 const rows=JSON.parse(output);return assertRecoveryProcessesAbsent(rows===null?[]:Array.isArray(rows)?rows:[rows],report);
}
async function authority(){
 const report=JSON.parse(await authenticate(reportPin)),controller=JSON.parse(await authenticate(controllerPin));assertFailedPreparation(report,controller);
 assert.deepEqual(report.sourceAuthority,await verifyWindowsContainmentGate());
 assert.deepEqual(report.helperFreeze,await authenticateHelperFreeze());assert.deepEqual(report.successorSelection,await authenticateSuccessorSelection());
 assert.deepEqual(report.predecessorRecovery,recoveryPin);await authenticate(recoveryPin);
 assert.equal(sha(stable(await snapshot())),report.sourceDigest);
 assert.equal(new Set(report.artifacts.map(item=>item.path)).size,report.artifacts.length);
 for(const record of report.artifacts){assert.equal(path.posix.dirname(record.path),report.artifactDirectory);await authenticate(record);}
 const policy=await readFile(policyFile);assert.equal(sha(policy),report.policy.expectedEnabledHash);
 assert.deepEqual(JSON.parse(policy),report.policy.transitions.at(-1).expected);return {report,policy};
}
async function baseUser(client){
 const response=await client.rpc('config/read',{includeLayers:true});
 const layers=response.layers?.filter(layer=>layer.name?.type==='user'&&!layer.name.profile&&path.resolve(layer.name.file)===configFile);
 assert.equal(layers?.length,1);assert.equal(typeof layers[0].version,'string');assert(layers[0].version.length);return layers[0];
}
export async function cleanupFailedPreparation(){
 assert.equal(process.platform,'win32');const {report,policy}=await authority();const before=await processesAbsent(report);
 await mkdir(path.join(root,directory));
 const ledger={version:1,status:'cleaning',createdAt:new Date().toISOString(),nativeSuccess:false,report:reportPin,controller:controllerPin,recovery:recoveryPin,sourceAuthority:report.sourceAuthority,helperFreeze:report.helperFreeze,successorSelection:report.successorSelection,processesBefore:before,pending:null};
 await writeFile(ledgerFile,JSON.stringify(ledger,null,2)+'\n',{flag:'wx'});
 const receipts=[];const client=await connect({cwd:report.fixture,log:path.join(root,directory,'native-events.jsonl'),configReceipt:data=>{const receipt=configReceiptProjection(report,data);receipts.push(receipt);return receipt;}});
 const rpc=client.rpc;client.rpc=async(method,params)=>{
  const rawBefore=await optional(configFile),first=receipts.length;
  try{return await rpc(method,params);}finally{const rawAfter=await optional(configFile);const request=receipts.slice(first).find(item=>item.stage==='request');
   const boundary={stage:'raw-boundary',method,id:request?.id??null,beforeSha256:rawBefore===null?null:sha(rawBefore),afterSha256:rawAfter===null?null:sha(rawAfter),readStable:method==='config/read'?sha(rawBefore??'')===sha(rawAfter??''):null};
   receipts.push(boundary);if(method==='config/read')assert(boundary.readStable,'Raw user config changed during read');}
 };
 try{
  const base=await baseUser(client),target=planFailedPreparationCleanup(base.config,report.projectKey);
  ledger.pending={kind:'config/batchWrite',expectedVersion:base.version};await save(ledger);
  await client.rpc('config/batchWrite',{filePath:configFile,expectedVersion:base.version,reloadUserConfig:true,edits:[{keyPath:'projects',mergeStrategy:'replace',value:target.projects}]});
  const after=await baseUser(client);assert.equal(hash(after.config),hash(target),'Fresh native readback differs from requested cleanup');
  assert.equal(hash(after.config.hooks??null),hash(base.config.hooks??null));
  ledger.nativeConfig={freshReadback:true,beforeHash:hash(base.config),afterHash:hash(after.config),hooksBeforeHash:hash(base.config.hooks??null),hooksAfterHash:hash(after.config.hooks??null),ownedProjectTrustRemoved:true,unrelatedPreserved:true};
  ledger.pending=null;await save(ledger);
 }finally{
  try{await writeFile(path.join(root,directory,'config-receipts.json'),JSON.stringify({version:1,receipts},null,2)+'\n',{flag:'wx'});}
  finally{ledger.termination=await client.closeConfirmed();await save(ledger);}
 }
 const events=(await readFile(path.join(root,directory,'native-events.jsonl'),'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 assertConfigReceiptBindings({receipts},events);
 ledger.processesAfter=await processesAbsent({...report,terminations:[...report.terminations,{...ledger.termination}]});
 assert.equal(sha(await readFile(policyFile)),sha(policy),'Temporary policy changed before removal');
 ledger.pending={kind:'policy/remove',expectedSha256:sha(policy)};await save(ledger);
 assert.equal(sha(await readFile(policyFile)),sha(policy),'Temporary policy changed immediately before removal');
 await unlink(policyFile);assert.equal(await optional(policyFile),null);
 ledger.policy={beforeSha256:sha(policy),afterSha256:null,originalAbsenceRestored:true};ledger.pending=null;ledger.status='blocked-cleaned';ledger.finishedAt=new Date().toISOString();
 await save(ledger);await authenticate(reportPin);const bytes=await readFile(ledgerFile);return {status:ledger.status,nativeSuccess:false,ledger:{path:directory+'/receipt.json',bytes:bytes.length,sha256:sha(bytes)}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))cleanupFailedPreparation().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
