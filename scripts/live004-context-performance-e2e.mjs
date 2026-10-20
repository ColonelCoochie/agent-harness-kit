import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,lstat,writeFile,unlink,readdir,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {canonicalCodexHooks,reviewNativeDefinitions} from '../skill/codex-harness/scripts/lib/hook-policy.mjs';
import {syncHarness} from '../skill/codex-harness/scripts/lib/core.mjs';
import {root as sourceRoot,sha,stable,sourceSnapshot,verifyGate,verifiedHookApproval,authenticatePredecessor,reference,authenticate as readReference,futureHelperPaths} from './source-context-performance-authority.mjs';
import {windowsCommand} from '../skill/codex-harness/assets/windows-command.mjs';
import {connect,binary} from './live-host-e2e/native-client.mjs';
import {reportArtifactDirectory,inspectReportLocation} from './native-hook-report-selection.mjs';
export {sourceRoot,sha};
export const selectedReport='.harness/native-hook-v2-live-004-e2e-report.json';
export const artifactDirectory=reportArtifactDirectory(selectedReport);
export const reportPath=path.join(sourceRoot,selectedReport);
let artifactRoot=path.join(sourceRoot,artifactDirectory);
export const helperFreezePath='.harness/native-hook-v2-live-004-helper-freeze.json';
export const correctionFreezePath='.harness/native-hook-v2-live-004-correction-helper-freeze-v3.json';
export const correctionV2Pin={path:'.harness/native-hook-v2-live-004-correction-helper-freeze-v2.json',bytes:3930,sha256:'70e5a8686328b0ba9b909015cae6e633ec9a8a5b8402b92a86c918e5e26deba2'};
export const correctionPredecessorPin={path:'.harness/native-hook-v2-live-004-correction-helper-freeze.json',bytes:3507,sha256:'ab6f469dc1ea0ff35fb23f6509d8e43f433be3dd8934c9ce1863e52a87f8407b'};
export const originalFreezePin={path:helperFreezePath,bytes:1305,sha256:'32a145a76fee50fa733709841c3d1a32d48255717afe55d31e587d1038e2e8be'};
export const nativeReportPin={path:selectedReport,bytes:54777,sha256:'4e5a951c49241aada0f4ff54e6b76fa12de49004ff35eaae9480fae5094aca73'};
export const predecessorCleanupPin={path:'.harness/native-hook-v2-live-003-failed-v3-cleanup/receipt.json',bytes:4449,sha256:'51769fb9f3a6c08d7724412350d12d16661c2b3c3904fd59a852497d6279ad3f'};
const policyPath=path.join(process.env.USERPROFILE,'.codex/agent-harness-hook-policy.json');
const configPath=path.join(process.env.USERPROFILE,'.codex/config.toml');
const hostKeys=new Set(['PATH','Path','PATHEXT','SystemRoot','ComSpec','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA']);
const cleanEnv=()=>({...Object.fromEntries(Object.entries(process.env).filter(([key])=>hostKeys.has(key))),CODEX_EXECUTABLE:binary});
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const optionalBytes=async file=>{try{return await readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
let phaseDeadline=Infinity,phaseExpired=false,finalizationDeadline=0,phaseReport;
let abortPhase;
const phaseAbort=new Promise((_,reject)=>{abortPhase=reject;});
// Attach a handler before a phase starts; every native wait races this fence.
phaseAbort.catch(()=>{});
const clients=new Set(),controllers=new Set(),closed=new WeakMap(),nativeLabels=new WeakMap(),terminated=[],closeFailures=[];
const guardDeadline=()=>assert(!phaseExpired&&Date.now()<phaseDeadline,'Overall phase deadline reached; reconcile recorded outcome before another invocation');
const guardPersistence=finalizing=>finalizing?assert(Date.now()<finalizationDeadline,'Bounded finalization deadline reached'):guardDeadline();
const closeNative=client=>{if(!closed.has(client))closed.set(client,client.closeConfirmed().then(proof=>{terminated.push({label:nativeLabels.get(client),...proof});return proof;},error=>{closeFailures.push({label:nativeLabels.get(client),errorSha256:sha(String(error)),unknownOutcome:true});throw error;}).finally(()=>clients.delete(client)));return closed.get(client);};
async function nativeConnect(options){
 guardDeadline();const label=path.basename(options.log).replace(/-events\.jsonl$/,'');
 assert(phaseReport,'Native session must belong to the selected phase report');phaseReport.nativeSessions??=[];phaseReport.nativeSessions.push({label,log:path.relative(sourceRoot,options.log).replaceAll('\\','/'),stage:'connecting'});await save(phaseReport);
 let client;
 try{client=await connect(options);clients.add(client);nativeLabels.set(client,label);phaseReport.nativeSessions.at(-1).stage='opened';await save(phaseReport);}
 catch(error){
  try{if(client){const proof=await closeNative(client);phaseReport.terminations.push({label,...proof});}else{const stream=eventsFrom(await readFile(options.log));const event=stream.find(item=>item.kind==='confirmedTermination');assert(event?.treeAbsent,'Initialization failure has no finalized native termination proof');const {at,kind,providerEnvironmentSanitized,...proof}=event;phaseReport.terminations.push({label,...proof});}await artifactExisting(phaseReport,options.log);}catch(failure){phaseReport.closeFailures??=[];phaseReport.closeFailures.push({label,errorSha256:sha(String(failure)),unknownOutcome:true});}
  await save(phaseReport,{finalizing:phaseExpired});throw error;
 }
 if(phaseExpired||Date.now()>=phaseDeadline){await closeNative(client);guardDeadline();}
 for(const name of ['rpc','start','turn','waitFor','headerAfterTurn']){const operation=client[name];client[name]=(...args)=>{guardDeadline();return Promise.race([operation(...args),phaseAbort]);};}
 return client;
}
export async function authenticateCorrectionLineage(freeze,{read=readReference}={}){
 if(freeze.successorPredecessor){
  assert.deepEqual(freeze.successorPredecessor,correctionV2Pin);
  const prior=JSON.parse(await read(correctionV2Pin));await authenticateCorrectionLineage(prior,{read});
  for(const key of ['predecessor','nativeReport','historicalHelpers','correctionPredecessor','correctionProvenance'])assert.deepEqual(freeze[key],prior[key]);
  const provenance=JSON.parse(await read(freeze.successorProvenance));assert.equal(provenance.kind,'authenticated-correction-predecessor-helper-archives');assert.deepEqual(provenance.predecessor,correctionV2Pin);
  assert.deepEqual(provenance.historicalHelpers.map(item=>item.original),prior.helpers);assert.equal(new Set(provenance.historicalHelpers.map(item=>item.archive.path)).size,prior.helpers.length);
  for(const {original,archive} of provenance.historicalHelpers){assert.equal(path.posix.dirname(archive.path),'.harness/native-hook-v2-live-004-correction-v2-helpers');assert.equal(archive.bytes,original.bytes);assert.equal(archive.sha256,original.sha256);const bytes=await read(archive);assert.equal(bytes.length,archive.bytes);assert.equal(sha(bytes),archive.sha256);}
  assert.equal(freeze.childLineage.path,'.harness/native-hook-v2-live-004-child-lineage.json');await read(freeze.childLineage);
 }
 assert.deepEqual(freeze.correctionPredecessor,correctionPredecessorPin);
 const correction=JSON.parse(await read(freeze.correctionPredecessor));
 assert.equal(correction.kind,'independent-context-performance-successor-helper-freeze');assert.equal(correction.outcome,'clean');assert.equal(correction.independentActualCode,true);assert.deepEqual(correction.findings,[]);
 assert.deepEqual(correction.predecessor,originalFreezePin);assert.deepEqual(correction.nativeReport,nativeReportPin);assert.deepEqual(correction.historicalHelpers,freeze.historicalHelpers);
 const provenance=JSON.parse(await read(freeze.correctionProvenance));assert.equal(provenance.kind,'authenticated-correction-predecessor-helper-archives');assert.deepEqual(provenance.predecessor,correctionPredecessorPin);
 assert.deepEqual(provenance.historicalHelpers.map(item=>item.original),correction.helpers);assert.equal(new Set(provenance.historicalHelpers.map(item=>item.archive.path)).size,correction.helpers.length);
 for(const {original,archive} of provenance.historicalHelpers){assert.equal(path.posix.dirname(archive.path),'.harness/native-hook-v2-live-004-correction-v1-helpers');assert.equal(archive.bytes,original.bytes);assert.equal(archive.sha256,original.sha256);const bytes=await read(archive);assert.equal(bytes.length,archive.bytes);assert.equal(sha(bytes),archive.sha256);}
 assert.deepEqual(freeze.predecessor,originalFreezePin);assert.deepEqual(freeze.nativeReport,nativeReportPin);
 const predecessor=JSON.parse(await read(freeze.predecessor));const report=JSON.parse(await read(freeze.nativeReport));
 assert.equal(predecessor.kind,'independent-context-performance-successor-helper-freeze');assert.equal(predecessor.outcome,'clean');assert.equal(predecessor.independentActualCode,true);assert.deepEqual(predecessor.findings,[]);
 assert.equal(report.status,'passed');assert.equal(report.pending,null);assert.equal(report.cleanup.nativeOwnedChangesRemoved,true);assert.equal(report.cleanup.freshReadback,true);assert.deepEqual(report.helperFreeze,originalFreezePin);
 assert.deepEqual(freeze.historicalHelpers.map(item=>item.original),predecessor.helpers);
 assert.equal(new Set(freeze.historicalHelpers.map(item=>item.archive.path)).size,predecessor.helpers.length);
 for(const {original,archive} of freeze.historicalHelpers){assert.equal(path.posix.dirname(archive.path),'.harness/native-hook-v2-live-004-original-helpers');assert.equal(archive.bytes,original.bytes);assert.equal(archive.sha256,original.sha256);const bytes=await read(archive);assert.equal(bytes.length,archive.bytes);assert.equal(sha(bytes),archive.sha256);}
 return originalFreezePin;
}
export async function authenticateHelperFreeze(){
 let ref;try{ref=await reference(correctionFreezePath);}catch(error){if(error.code!=='ENOENT')throw error;ref=await reference(helperFreezePath);}
 const freeze=JSON.parse(await readReference(ref));assert(freeze.helpers.every(item=>futureHelperPaths.includes(item.path)));
 if(ref.path===correctionFreezePath){assert.deepEqual(freeze.successorPredecessor,correctionV2Pin);await authenticateCorrectionLineage(freeze);}
 await verifyGate({allowSuccessors:true,helperFreeze:ref});return ref;
}
export async function authenticateCleanupPredecessor(){await authenticatePredecessor();const ref=await reference(predecessorCleanupPin.path);assert.deepEqual(ref,predecessorCleanupPin);const value=JSON.parse(await readReference(ref));assert.equal(value.status,'blocked-cleaned');assert.equal(value.nativeSuccess,false);return ref;}
export function selectedArtifactDirectory(report){
 const directory=report.recovery?`${artifactDirectory}-recovery-${report.recovery.failedReportSha256.slice(0,16)}`:artifactDirectory;
 if(report.recovery)assert.match(report.recovery.failedReportSha256,/^[a-f0-9]{64}$/);
 assert.equal(report.artifactDirectory,directory);return directory;
}
const save=async(report,{exclusive=false,finalizing=false}={})=>{guardPersistence(finalizing);assert.equal(report.reportSelection,selectedReport);selectedArtifactDirectory(report);if(!exclusive)await inspectReportLocation(sourceRoot,selectedReport);await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:exclusive?'wx':'w'});};
export function assertConfirmedTermination(report,label,stream){
 const matches=report.terminations.filter(item=>item.label===label);assert.equal(matches.length,1,'Exactly one recorded native termination');
 const events=stream.filter(event=>event.kind==='confirmedTermination');assert.equal(events.length,1);
 const {at,kind,providerEnvironmentSanitized,...proof}=events[0];const {label:ignored,...record}=matches[0];
 assert.deepEqual(record,proof,'Recorded termination must bind the native event');assert.equal(proof.treeAbsent,true);assert.equal(providerEnvironmentSanitized,true);
 assert(Array.isArray(proof.treePids)&&proof.treePids.length>0&&proof.treePids.every(pid=>Number.isSafeInteger(pid)&&pid>0));assert.equal(new Set(proof.treePids).size,proof.treePids.length);
 assert.equal(stream.at(-1),events[0],'Native event capture must finish with confirmed tree termination');
}

const managedExecutables = [
  ['project-runtime.mjs','.harness/run.mjs','always'],
  ['windows-command.mjs','.harness/windows-command.mjs','always'],
  ['windows-command-supervisor.ps1','.harness/windows-command-supervisor.ps1','always'],
  ['context-budget.mjs','.harness/context-budget.mjs','always'],
  ['repair.mjs','.harness/repair.mjs','always'],
  ['hook-recovery.mjs','.harness/hooks/hook-recovery.mjs','shared'],
  ['native-hook-dispatch.mjs','.harness/hooks/native-hook-dispatch.mjs','shared'],
  ['native-hook-bootstrap-v1.json','.harness/hooks/native-hook-bootstrap-v1.json','shared'],
  ['native-hook-bootstrap-v2.json','.harness/hooks/native-hook-bootstrap-v2.json','shared'],
  ['context-guard.mjs','.harness/hooks/context-guard.mjs','shared'],
  ['native-hook-identity.mjs','.harness/hooks/native-hook-identity.mjs','shared'],
  ['precompact-handoff.mjs','.harness/hooks/precompact-handoff.mjs','shared'],
  ['sessionstart-routing.mjs','.harness/hooks/sessionstart-routing.mjs','shared'],
  ['claude-worker-identity.mjs','.harness/hooks/claude-worker-identity.mjs','claude']
];

export function managedExecutableSelection(enabled) {
  assert(Array.isArray(enabled) && enabled.length > 0);
  assert.equal(new Set(enabled).size,enabled.length);
  assert(enabled.every(agent => ['codex','claude','github-copilot'].includes(agent)));
  return managedExecutables.filter(([, ,kind]) => kind === 'always'
    || kind === 'shared' && enabled.some(agent => ['codex','claude'].includes(agent))
    || kind === 'claude' && enabled.includes('claude'));
}

async function fixtureBytes(root,relative) {
  assert(relative && !relative.includes('\\') && !relative.includes(':')
    && relative.split('/').every(part => part && part !== '.' && part !== '..'));
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current,part); const info = await lstat(current);
    assert(!info.isSymbolicLink(),'Installed inventory rejects symlink components');
    assert(current === path.join(root,relative) ? info.isFile() : info.isDirectory());
  }
  return readFile(current);
}

export async function captureInstalledInventory(root,archive) {
  const configBytes = await fixtureBytes(root,'.harness/config.json');
  const config = JSON.parse(configBytes), enabled = config.agents.enabled;
  const inventoryBytes = await fixtureBytes(root,'.harness/managed-files.json');
  const inventory = JSON.parse(inventoryBytes), selected = managedExecutableSelection(enabled);
  assert.equal(inventory.version,1);
  assert.deepEqual(Object.keys(inventory.files).sort(),selected.map(([,installed]) => installed).sort(),'Installed inventory must be complete and exclusive');
  const entries = [];
  for (const [index,[asset,installed]] of selected.entries()) {
    const source = `skill/codex-harness/assets/${asset}`;
    const bytes = await fixtureBytes(root,installed), canonical = await readFile(path.join(sourceRoot,source));
    assert.equal(sha(bytes),inventory.files[installed],'Installed inventory hash is stale');
    assert.deepEqual(bytes,canonical,'Installed managed executable differs from sealed SOURCE');
    entries.push({source,installed,sourceReference:await reference(source),
      installedArchive:await archive(`installed-executable-${index}${path.extname(asset)}`,bytes),
      sourceArchive:await archive(`source-executable-${index}${path.extname(asset)}`,canonical)});
  }
  return {version:1,enabled:[...enabled],config:await archive('installed-inventory-config.json',configBytes),
    inventory:await archive('installed-managed-files.json',inventoryBytes),entries};
}

export async function assertInstalledInventory(proof,artifacts) {
  assert.equal(proof.version,1);
  const unique = new Map(artifacts.map(item => [item.path,item]));
  assert.equal(unique.size,artifacts.length);
  const load = async ref => {
    assert.deepEqual(unique.get(ref.path),ref,'Inventory archive must uniquely bind an authenticated report artifact');
    return readReference(ref);
  };
  const config = JSON.parse(await load(proof.config)), inventory = JSON.parse(await load(proof.inventory));
  assert.deepEqual(proof.enabled,config.agents.enabled);
  const selected = managedExecutableSelection(proof.enabled);
  assert.equal(inventory.version,1);
  assert.deepEqual(Object.keys(inventory.files).sort(),selected.map(([,installed]) => installed).sort());
  assert.equal(proof.entries.length,selected.length);
  for (const [index,[asset,installed]] of selected.entries()) {
    const entry = proof.entries[index];
    assert.equal(entry.source,`skill/codex-harness/assets/${asset}`); assert.equal(entry.installed,installed);
    assert.equal(entry.sourceReference.path,entry.source);
    const source = await readReference(entry.sourceReference);
    const archivedSource = await load(entry.sourceArchive), archivedInstalled = await load(entry.installedArchive);
    assert.deepEqual(archivedSource,source); assert.deepEqual(archivedInstalled,source);
    assert.equal(sha(archivedInstalled),inventory.files[installed]);
  }
  return true;
}

async function policyTransition(report,label,args,expected){
 const before=await optionalBytes(policyPath);const beforeHash=before===null?null:sha(before);
 assert.equal(beforeHash,report.policy.currentHash??null,'Temporary policy drift; transition is parked');
 report.policy.attempt={label,beforeHash,expected,startedAt:new Date().toISOString()};await save(report);
 await command(report,label,args);
 const after=await readFile(policyPath);assert.deepEqual(JSON.parse(after),expected);
 const transition={label,beforeHash,afterHash:sha(after),expected,guard:'checked-immediately-before-command'};
 report.policy.transitions??=[];report.policy.transitions.push(transition);report.policy.currentHash=transition.afterHash;report.policy.attempt=null;
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
async function artifact(report,name,data,{finalizing=false}={}){
 const bytes=Buffer.isBuffer(data)?data:Buffer.from(typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');
 guardPersistence(finalizing);selectedArtifactDirectory(report);assert.equal(path.basename(name),name);await inspectReportLocation(sourceRoot,report.artifactDirectory,{kind:'directory'});
 const file=path.join(sourceRoot,report.artifactDirectory,name);await writeFile(file,bytes,{flag:'wx'});
 const record={path:path.relative(sourceRoot,file).replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)};report.artifacts.push(record);return record;
}
export async function authenticateReport(report){
 guardDeadline();assert.equal(report.version,1);assert.equal(report.featureId,'native-hook-v2-live-004');assert.equal(report.reportSelection,selectedReport);const directory=selectedArtifactDirectory(report);
 const currentFreeze=await authenticateHelperFreeze();
 if(currentFreeze.path===correctionFreezePath){assert.deepEqual(await reference(selectedReport),nativeReportPin);assert.deepEqual(report,JSON.parse(await readReference(nativeReportPin)));assert.deepEqual(report.helperFreeze,originalFreezePin);}else assert.deepEqual(report.helperFreeze,currentFreeze);
 assert.deepEqual(report.sourceAuthority,await verifyGate({allowSuccessors:true,helperFreeze:currentFreeze}));assert.deepEqual(report.predecessorCleanup,await authenticateCleanupPredecessor());assert.equal(sha(stable(await sourceSnapshot())),report.sourceDigest);
 if(report.recovery)await authenticateRecoveryHistory(report.recovery);
 await inspectReportLocation(sourceRoot,directory,{kind:'directory'});assert.equal(new Set(report.artifacts.map(ref=>ref.path)).size,report.artifacts.length);
 for(const ref of report.artifacts){assert.equal(path.posix.dirname(ref.path),directory);await readReference(ref);}
}
const authenticate=authenticateReport;
const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
export async function containedCommand(command,cwd,environment,timeoutMs=60000,{maxBytes=1000000,onSpawn}={}){
 guardDeadline();const startedAt=Date.now();const controller=windowsCommand(command,cwd,environment,Math.max(1,Math.min(timeoutMs,phaseDeadline-Date.now())));controllers.add(controller);let stdout='',stderr='',bytes=0,overflow=false;
 const capture=kind=>chunk=>{bytes+=chunk.length;if(bytes>maxBytes){overflow=true;controller.cancel();return;}if(kind==='stdout')stdout+=chunk;else stderr+=chunk;};controller.child.stdout.on('data',capture('stdout'));controller.child.stderr.on('data',capture('stderr'));
 try{if(onSpawn)await onSpawn(controller.child.pid??null);}catch(error){controller.cancel();await controller.done;controllers.delete(controller);throw error;}
 const outcome=await controller.done;controllers.delete(controller);return {...outcome,stdout,stderr,stdoutSha256:sha(stdout),stderrSha256:sha(stderr),overflow,originalBytes:bytes,pid:controller.child.pid??null,elapsedMs:Date.now()-startedAt};
}
async function command(report,label,args,cwd=sourceRoot){
 guardDeadline();assert.equal(report.pending,null,'Reconcile unknown command outcome before continuing');report.pending={label,args,cwd,startedAt:new Date().toISOString()};await save(report);
 const result=await containedCommand([process.execPath,...args].map(quote).join(' '),cwd,cleanEnv(),60000);await artifact(report,label+'-controller.json',{args,cwd,...result},{finalizing:phaseExpired});
 if(result.confirmed){report.pending=null;await save(report,{finalizing:phaseExpired});}assert.equal(result.confirmed,true,'Command tree termination is unknown; outcome stays parked');assert.equal(result.overflow,false,'Output capture exceeded bound');
 if(result.exitCode===75){const match=(result.stdout+'\n'+result.stderr).match(/node \.harness\/run\.mjs resume handoff-[A-Za-z0-9-]+/);report.rotation={label,exitCode:75,resumeCommand:match?.[0]??null,controllerArtifact:label+'-controller.json'};report.status='awaiting_resume';await save(report);const error=new Error('Exit 75 preserved; delegate the exact routing command without retry');error.exitCode=75;error.rotation=report.rotation;throw error;}
 assert.equal(result.exitCode,0,label+' failed; no automatic retry');return result;
}
export async function recordedGit(report,label,args,cwd,{execute=containedCommand,persist=save,record=artifact}={}){
 guardDeadline();assert.equal(report.pending,null,'Reconcile unknown Git outcome before continuing');
 report.pending={kind:'git',label,args,cwd,startedAt:new Date().toISOString(),pid:null};await persist(report);
 let result;
 try{result=await execute(['git',...args].map(quote).join(' '),cwd,cleanEnv(),30000,{onSpawn:async pid=>{report.pending.pid=pid;await persist(report);}});}
 catch(error){result={exitCode:null,timedOut:false,confirmed:false,pid:report.pending.pid,errorSha256:sha(String(error)),stdoutSha256:sha(''),stderrSha256:sha(''),elapsedMs:null};}
 report.gitControllers??=[];const proof=await record(report,label+'-controller.json',{version:1,kind:'git',label,args,cwd,...result},{finalizing:phaseExpired});report.gitControllers.push(proof);
 if(result.confirmed)report.pending=null;else report.unknownOutcome=true;
 await persist(report,{finalizing:phaseExpired});assert.equal(result.confirmed,true,'Git command tree termination is unknown; reconcile the durable intent and result');assert.equal(result.overflow,false);assert.equal(result.exitCode,0,'Fixture git command failed; no automatic retry');return result;
}
const recoveryPrefix='.harness/native-hook-v2-live-004-recovery';
export async function safeRecoveryFile(root,relative,{directory=false}={}){
 assert.equal(typeof relative,'string');assert(!path.isAbsolute(relative));assert(!relative.includes('\\'));assert(!relative.split('/').some(part=>!part||part==='.'||part==='..'));
 let cursor=root;for(const [index,part] of relative.split('/').entries()){cursor=path.join(cursor,part);const stat=await lstat(cursor);assert(!stat.isSymbolicLink(),'Recovery rejects symbolic links');if(index<relative.split('/').length-1||directory)assert(stat.isDirectory());else assert(stat.isFile());}return cursor;
}
async function recoveryReference(root,relative){const bytes=await readFile(await safeRecoveryFile(root,relative));return {path:relative,bytes:bytes.length,sha256:sha(bytes)};}
async function recoveryRead(root,ref){assert.match(ref.sha256,/^[a-f0-9]{64}$/);assert(Number.isSafeInteger(ref.bytes));const bytes=await readFile(await safeRecoveryFile(root,ref.path));assert.equal(bytes.length,ref.bytes);assert.equal(sha(bytes),ref.sha256,'Recovery reference changed');return bytes;}
export async function actualFailedManifest(root=sourceRoot){
 await safeRecoveryFile(root,artifactDirectory,{directory:true});const names=(await readdir(path.join(root,artifactDirectory))).sort();const refs=[];for(const name of names)refs.push(await recoveryReference(root,`${artifactDirectory}/${name}`));return refs;
}
export function assertRecoverablePrepare(report,reconciliation,manifest){
 assert.equal(report.version,1);assert.equal(report.featureId,'native-hook-v2-live-004');assert.equal(report.reportSelection,selectedReport);assert.equal(report.artifactDirectory,artifactDirectory);assert.equal(report.status,'blocked');assert(!report.recovery);
 assert(report.errors?.length>0);assert(report.errors.every(error=>error.phase==='prepare'));assert.equal(report.pending,null);
 for(const field of ['nativeSessions','nativeWrites','configReceiptPaths','terminations','workers','gitControllers'])assert(!report[field]?.length,'Recovery is exclusively pre-native');
 assert(!report.policy?.attempt);assert(!report.policy?.transitions?.length);assert.equal(report.policy?.baselineAbsent,true);assert(!report.trustBypass&&!report.projectTrustOverride&&!report.manualCompaction);
 assert.equal(reconciliation.kind,'pre-native-historical-retirement');assert.equal(reconciliation.fixture,report.fixture);assert.equal(reconciliation.fixtureGitAbsent,true);assert.equal(reconciliation.nativeSuccess,false);assert.equal(reconciliation.originalControllerConfirmed,false);
 assert.equal(reconciliation.originalProcess?.confirmedCompleteByHost,true);assert.equal(reconciliation.originalProcess?.exitCode,1);assert.equal(reconciliation.inspection?.completeVisibility,true);assert.equal(reconciliation.inspection.querySucceeded,true);assert.equal(reconciliation.inspection.queryErrorCount,0);assert.deepEqual(reconciliation.inspection.matches,[]);assert.deepEqual(reconciliation.inspection.descendants,[]);assert.match(reconciliation.inspection.rawInventorySha256,/^[a-f0-9]{64}$/);
 for(const criterion of ['all git.exe','cmd.exe quoted git init regardless of working directory','recursive candidate descendants'])assert(reconciliation.inspection.criteria.includes(criterion));
 assert.deepEqual(manifest.report,reconciliation.report);assert.deepEqual(manifest.artifacts,reconciliation.artifacts);assert.equal(manifest.kind,'actual-failed-file-manifest');assert.equal(new Set(manifest.artifacts.map(ref=>ref.path)).size,manifest.artifacts.length);assert(manifest.artifacts.length>0);
 for(const ref of report.artifacts)assert.deepEqual(manifest.artifacts.find(item=>item.path===ref.path),ref,'Stale report references must remain within the actual manifest');
}
export async function preserveFailedPrepare({root=sourceRoot,expectedReportSha256,reconciliationRef,manifestRef,historicalFreezePath='.harness/native-hook-v2-live-004-helper-freeze-before-recovery.json'}){
 assert.match(expectedReportSha256,/^[a-f0-9]{64}$/);const originalReport=await recoveryReference(root,selectedReport);assert.equal(originalReport.sha256,expectedReportSha256,'Expected raw blocked report changed');
 const raw=await recoveryRead(root,originalReport),report=JSON.parse(raw);const reconciliation=JSON.parse(await recoveryRead(root,reconciliationRef)),manifest=JSON.parse(await recoveryRead(root,manifestRef));assertRecoverablePrepare(report,reconciliation,manifest);assert.deepEqual(reconciliation.report,originalReport);assert.deepEqual(manifest.artifacts,await actualFailedManifest(root),'Actual failed artifact closure changed');
 assert.equal(await optionalBytes(path.join(report.fixture,'.git')),null,'Historical fixture Git state changed');
 const freezeRef=await recoveryReference(root,historicalFreezePath),freezeBytes=await recoveryRead(root,freezeRef);assert.equal(freezeRef.bytes,report.helperFreeze.bytes);assert.equal(freezeRef.sha256,report.helperFreeze.sha256);assert.deepEqual(reconciliation.helperFreeze,report.helperFreeze);
 const freeze=JSON.parse(freezeBytes);assert.equal(freeze.kind,'independent-context-performance-successor-helper-freeze');assert.equal(freeze.outcome,'clean');assert.equal(freeze.independentActualCode,true);assert.deepEqual(freeze.findings,[]);
 await recoveryRead(root,reconciliation.priorReconciliation);await recoveryRead(root,freeze.sourceGate);
 for(const ref of [report.sourceAuthority.gate,report.sourceAuthority.evidence,report.sourceAuthority.transition,report.sourceAuthority.futureGrant,report.predecessorCleanup])await recoveryRead(root,ref);
 const directory=`${recoveryPrefix}/${expectedReportSha256}`;await mkdir(path.join(root,recoveryPrefix),{recursive:true});await safeRecoveryFile(root,recoveryPrefix,{directory:true});
 // This exclusive intent forbids automatic replay after any interrupted archival or replacement.
 const intentPath=`${recoveryPrefix}/intent-${expectedReportSha256}.json`;await writeFile(path.join(root,intentPath),JSON.stringify({version:1,kind:'explicit-prepare-recovery-intent',expectedReportSha256,originalReport,reconciliation:reconciliationRef,manifest:manifestRef,directory,startedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
 const intent=await recoveryReference(root,intentPath);await mkdir(path.join(root,directory));
 const archive=async(name,bytes)=>{await writeFile(path.join(root,directory,name),bytes,{flag:'wx'});return recoveryReference(root,`${directory}/${name}`);};
 const archivedReport=await archive('failed-report.json',raw),archivedFreeze=await archive('historical-helper-freeze.json',freezeBytes),artifacts=[];
 for(const ref of manifest.artifacts)artifacts.push({original:ref,archived:await archive(path.posix.basename(ref.path),await recoveryRead(root,ref))});
 const history={version:1,kind:'immutable-failed-prepare-history',originalReport,archivedReport,historicalFreeze:report.helperFreeze,archivedFreeze,reconciliation:reconciliationRef,manifest:manifestRef,intent,artifacts,nativeSuccess:false,originalControllerConfirmed:false};
 const historyRef=await archive('history.json',Buffer.from(JSON.stringify(history,null,2)+'\n'));
 assert.deepEqual(await recoveryReference(root,selectedReport),originalReport,'Report CAS changed before replacement');assert.deepEqual(await actualFailedManifest(root),manifest.artifacts,'Artifact CAS changed before replacement');
 return {failedReportSha256:expectedReportSha256,history:historyRef,intent};
}
export async function authenticateRecoveryHistory(recovery,{root=sourceRoot}={}){
 assert.match(recovery.failedReportSha256,/^[a-f0-9]{64}$/);const history=JSON.parse(await recoveryRead(root,recovery.history));assert.equal(history.kind,'immutable-failed-prepare-history');assert.equal(history.nativeSuccess,false);assert.equal(history.originalControllerConfirmed,false);assert.equal(history.originalReport.sha256,recovery.failedReportSha256);assert.deepEqual(history.intent,recovery.intent);
 assert.equal(recovery.history.path,`${recoveryPrefix}/${recovery.failedReportSha256}/history.json`);const directory=path.posix.dirname(recovery.history.path);
 const report=JSON.parse(await recoveryRead(root,history.archivedReport));assert.equal(history.archivedReport.bytes,history.originalReport.bytes);assert.equal(history.archivedReport.sha256,history.originalReport.sha256);
 const reconciliation=JSON.parse(await recoveryRead(root,history.reconciliation)),manifest=JSON.parse(await recoveryRead(root,history.manifest));assertRecoverablePrepare(report,reconciliation,manifest);assert.deepEqual(reconciliation.report,history.originalReport);
 const freeze=JSON.parse(await recoveryRead(root,history.archivedFreeze));assert.equal(history.archivedFreeze.sha256,history.historicalFreeze.sha256);assert.equal(history.archivedFreeze.bytes,history.historicalFreeze.bytes);assert.deepEqual(report.helperFreeze,history.historicalFreeze);await recoveryRead(root,freeze.sourceGate);await recoveryRead(root,reconciliation.priorReconciliation);
 assert.equal(history.intent.path,`${recoveryPrefix}/intent-${recovery.failedReportSha256}.json`);const intent=JSON.parse(await recoveryRead(root,history.intent));assert.equal(intent.version,1);assert.equal(intent.kind,'explicit-prepare-recovery-intent');assert.equal(intent.expectedReportSha256,recovery.failedReportSha256);assert.deepEqual(intent.originalReport,history.originalReport);assert.deepEqual(intent.reconciliation,history.reconciliation);assert.deepEqual(intent.manifest,history.manifest);assert.equal(intent.directory,directory);
 assert.deepEqual(history.artifacts.map(item=>item.original),manifest.artifacts);for(const item of history.artifacts){assert.equal(path.posix.dirname(item.archived.path),directory);assert.equal(item.archived.bytes,item.original.bytes);assert.equal(item.archived.sha256,item.original.sha256);await recoveryRead(root,item.archived);await recoveryRead(root,item.original);}
 assert.deepEqual((await readdir(path.join(root,directory))).sort(),['failed-report.json','historical-helper-freeze.json','history.json',...history.artifacts.map(item=>path.posix.basename(item.archived.path))].sort(),'Historical archive closure changed');
 if(recovery.outcome){assert.equal(recovery.outcome.path,`${recoveryPrefix}/outcome-${recovery.failedReportSha256}.json`);const outcome=JSON.parse(await recoveryRead(root,recovery.outcome));assert.equal(outcome.version,1);assert.equal(outcome.kind,'explicit-prepare-recovery-complete');assert.deepEqual(outcome.history,recovery.history);assert.deepEqual(outcome.intent,recovery.intent);assert.equal(outcome.failedReportSha256,recovery.failedReportSha256);assert.equal(outcome.selectedReport,selectedReport);assert.equal(outcome.selectedReplacement.path,`${recoveryPrefix}/replacement-proof-${recovery.failedReportSha256}.json`);const ready=JSON.parse(await recoveryRead(root,outcome.selectedReplacement));assert.equal(ready.version,1);assert.equal(ready.featureId,'native-hook-v2-live-004');assert.equal(ready.status,'recovery-ready');assert.equal(ready.reportSelection,selectedReport);assert.equal(ready.artifactDirectory,`${artifactDirectory}-recovery-${recovery.failedReportSha256.slice(0,16)}`);assert.equal(ready.pending,null);assert.deepEqual(ready.artifacts,[]);assert.deepEqual(ready.recovery,{failedReportSha256:recovery.failedReportSha256,history:recovery.history,intent:recovery.intent});}
 return history;
}
async function recoverPrepare(options){
 assert.equal(await optionalBytes(policyPath),null,'Recovery requires the real HOME enable policy to remain absent');const old=await json(reportPath);
 const helperFreeze=await authenticateHelperFreeze(),sourceAuthority=await verifyGate({allowSuccessors:true,helperFreeze});assert.equal(old.sourceDigest,sourceAuthority.sourceDigest);
 const reconciliationRef=await recoveryReference(sourceRoot,options.reconciliation);assert.equal(reconciliationRef.sha256,options.reconciliationSha256);const manifestRef=await recoveryReference(sourceRoot,options.manifest);assert.equal(manifestRef.sha256,options.manifestSha256);
 const recovery=await preserveFailedPrepare({expectedReportSha256:options.expectedReportSha256,reconciliationRef,manifestRef});await authenticateRecoveryHistory(recovery);
 const directory=`${artifactDirectory}-recovery-${recovery.failedReportSha256.slice(0,16)}`;await inspectReportLocation(sourceRoot,directory,{kind:'directory',absent:true});
 const ready={version:1,featureId:'native-hook-v2-live-004',status:'recovery-ready',reportSelection:selectedReport,artifactDirectory:directory,recovery,helperFreeze,sourceAuthority,sourceDigest:sourceAuthority.sourceDigest,artifacts:[],pending:null};
 const readyBytes=Buffer.from(JSON.stringify(ready,null,2)+'\n'),proofPath=`${recoveryPrefix}/replacement-proof-${recovery.failedReportSha256}.json`;await writeFile(path.join(sourceRoot,proofPath),readyBytes,{flag:'wx'});const selectedReplacement=await recoveryReference(sourceRoot,proofPath);
 const replacement=`${recoveryPrefix}/replacement-${recovery.failedReportSha256}.json`;await writeFile(path.join(sourceRoot,replacement),readyBytes,{flag:'wx'});
 assert.equal((await recoveryReference(sourceRoot,selectedReport)).sha256,options.expectedReportSha256,'Final report CAS changed');assert.deepEqual(await actualFailedManifest(),(JSON.parse(await recoveryRead(sourceRoot,manifestRef))).artifacts,'Final artifact CAS changed');
 await rename(path.join(sourceRoot,replacement),reportPath);
 const actualReplacement=await recoveryReference(sourceRoot,selectedReport);assert.equal(actualReplacement.sha256,selectedReplacement.sha256);assert.equal(actualReplacement.bytes,selectedReplacement.bytes);assert.deepEqual(await recoveryRead(sourceRoot,actualReplacement),await recoveryRead(sourceRoot,selectedReplacement),'Selected replacement differs from its immutable proof');
 const outcomePath=`${recoveryPrefix}/outcome-${recovery.failedReportSha256}.json`;await writeFile(path.join(sourceRoot,outcomePath),JSON.stringify({version:1,kind:'explicit-prepare-recovery-complete',failedReportSha256:recovery.failedReportSha256,history:recovery.history,intent:recovery.intent,selectedReport,selectedReplacement,completedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
 recovery.outcome=await recoveryReference(sourceRoot,outcomePath);await authenticateRecoveryHistory(recovery);await save(ready);return ready;
}
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
export function assertOwnedBatchWrite(params,kind,ownership){
 assert(['project','hashes'].includes(kind),'Unrecognized native owned write kind');
 assert.equal(path.resolve(params.filePath).toLowerCase(),path.resolve(configPath).toLowerCase(),'Owned native write must target the real user config');
 assert.equal(params.reloadUserConfig,true);assert.equal(params.edits.length,1);const edit=params.edits[0];assert.equal(edit.mergeStrategy,'replace');
 assert.equal(edit.keyPath,kind==='project'?'projects':'hooks.state','Unrecognized native owned write form');
 if(kind==='project')assert(ownership.key&&ownership.requested&&stable(edit.value[ownership.key])===stable(ownership.requested),'Project write lacks the requested owned state');
 else for(const [key,hash] of Object.entries(ownership.requested))assert.equal(edit.value[key]?.trusted_hash,hash,'Hash write lacks the requested owned state');
}
async function nativeConfigSession(report,label,operation){
 const log=path.join(sourceRoot,report.artifactDirectory,`${label}-events.jsonl`),receipts=[];
 const client=await nativeConnect({cwd:report.fixture,log,configReceipt:data=>{const receipt=configReceiptProjection(report,data);receipts.push(receipt);return receipt;}});
 const rpc=client.rpc;
 client.rpc=async(method,params)=>{
  if(!['config/read','config/batchWrite'].includes(method))return rpc(method,params);
  const rawBefore=await optionalBytes(configPath),first=receipts.length;
  if(method==='config/batchWrite'&&label!=='cleanup-readback'){
   const kind=label==='before-enrollment'?'project':'hashes';assert(report.ownership?.[kind],'Owned write must have an authenticated baseline and exact requested state');assertOwnedBatchWrite(params,kind,report.ownership[kind]);
   report.nativeWrites??=[];report.nativeWrites.push({label,kind,expectedVersion:params.expectedVersion,beforeRawSha256:rawBefore===null?null:sha(rawBefore),ownership:structuredClone(report.ownership[kind]),unrelatedBeforeHash:report.unrelatedBeforeHash,stage:'before-rpc',at:new Date().toISOString()});await save(report);
  }
  try{return await rpc(method,params);}finally{
   const rawAfter=await optionalBytes(configPath),request=receipts.slice(first).find(receipt=>receipt.stage==='request');
   const record={stage:'raw-boundary',method,id:request?.id??null,beforeSha256:rawBefore===null?null:sha(rawBefore),afterSha256:rawAfter===null?null:sha(rawAfter),readStable:method==='config/read'?sha(rawBefore??'')===sha(rawAfter??''):null};receipts.push(record);
   if(method==='config/read')assert(record.readStable,'Native raw config drifted during read; outcome is parked');
  }
 };
 let completed=false,result;const failures=[];
 try{result=await operation(client);completed=true;}catch(error){failures.push(error);}
 // Teardown is independent of persistence: a full disk must never leave a native tree alive.
 try{const termination=await closeNative(client);report.terminations.push({label,...termination});}catch(error){failures.push(error);report.closeFailures??=[];report.closeFailures.push({label,errorSha256:sha(String(error)),unknownOutcome:true});}
 const finalizing=phaseExpired;
 try{const receipt=await artifact(report,`${label}-config-receipts.json`,{version:1,label,observedDirectRpc:true,receipts},{finalizing});report.configReceiptPaths??=[];report.configReceiptPaths.push(receipt.path);}catch(error){failures.push(error);}
 try{await artifactExisting(report,log);}catch(error){failures.push(error);}
 if(completed)try{assertConfigReceiptBindings({receipts});}catch(error){failures.push(error);}
 if(failures.length){report.finalizationFailures??=[];report.finalizationFailures.push(...failures.map(error=>({label,errorSha256:sha(String(error))})));}
 try{await save(report,{finalizing});}catch(error){failures.push(error);}
 if(failures.length)throw new AggregateError(failures,`${label} operation or finalization failed`);
 return result;
}
async function artifactExisting(report,file){const bytes=await readFile(file);const record={path:path.relative(sourceRoot,file).replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)};report.artifacts.push(record);return record;}
const eventsFrom=bytes=>bytes.toString().trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
async function prepare(){
 let recovery;const prior=await optionalBytes(reportPath);
 if(prior){await inspectReportLocation(sourceRoot,selectedReport);const ready=JSON.parse(prior);assert.equal(ready.status,'recovery-ready','Explicit recovery is required; prepare never retries a failed selection');assert(ready.recovery?.outcome,'Interrupted recovery is reconcile-only');await authenticateRecoveryHistory(ready.recovery);recovery=ready.recovery;}
 else await inspectReportLocation(sourceRoot,selectedReport,{absent:true});
 const directory=recovery?`${artifactDirectory}-recovery-${recovery.failedReportSha256.slice(0,16)}`:artifactDirectory;artifactRoot=path.join(sourceRoot,directory);
 await inspectReportLocation(sourceRoot,directory,{kind:'directory',absent:true});
 const helperFreeze=await authenticateHelperFreeze();
 const sourceAuthority=await verifyGate({allowSuccessors:true,helperFreeze});
 const predecessorCleanup=await authenticateCleanupPredecessor();
 assert.equal(await optionalBytes(policyPath),null,'Temporary real HOME policy must begin absent');
 await mkdir(path.dirname(artifactRoot),{recursive:true});await mkdir(artifactRoot);
 const report={version:1,featureId:'native-hook-v2-live-004',status:'preparing',createdAt:new Date().toISOString(),sourceRoot,sourceDigest:sourceAuthority.sourceDigest,sourceAuthority,helperFreeze,predecessorCleanup,reportSelection:selectedReport,artifactDirectory:directory,...(recovery?{recovery}:{}),fixture:null,projectKey:null,binary,artifacts:[],terminations:[],pending:null,policy:{baselineAbsent:true},trustBypass:false,projectTrustOverride:false,manualCompaction:false};
 phaseReport=report;
 await save(report,{exclusive:!recovery});
 const fixture=await mkdtemp(path.join(os.tmpdir(),'agent-harness-v2-live-'));report.fixture=fixture;report.projectKey=fixture.toLowerCase();
 await save(report);await artifact(report,'source-snapshot.json',await sourceSnapshot());
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
 await recordedGit(report,'git-init',['init'],fixture);await recordedGit(report,'git-name',['config','user.name','Disposable Fixture'],fixture);await recordedGit(report,'git-email',['config','user.email','fixture@example.invalid'],fixture);
 await command(report,'fixture-init',[path.join(sourceRoot,'bin/agent-harness.mjs'),'init',fixture]);
 const config=await json(path.join(fixture,'.harness/config.json'));config.verification={quick:['node --check product.mjs'],full:['node --test acceptance.test.mjs'],e2e:[],architecture:[],clean:[]};
 await writeFile(path.join(fixture,'.harness/config.json'),JSON.stringify(config,null,2)+'\n');
 await artifact(report,'fixture-runtime.mjs',await readFile(path.join(fixture,'.harness/run.mjs')));await artifact(report,'fixture-config.json',config);
 assert.equal(sha(await readFile(path.join(fixture,'.harness/run.mjs'))),sha(await readFile(path.join(sourceRoot,'skill/codex-harness/assets/project-runtime.mjs'))));
 await recordedGit(report,'git-add',['add','.'],fixture);await recordedGit(report,'git-commit',['commit','-m','Prepare deterministic native V2 fixture'],fixture);
 await nativeConfigSession(report,'before-enrollment',async client=>{
  const base=await baseUser(client);assert(!base.config.projects?.[report.projectKey],'Disposable fixture project key already exists');
  report.nativeConfigBeforeHash=configHash(base.config);report.unrelatedBeforeHash=configHash(withoutOwned(base.config,report));
  report.ownership??={};report.ownership.project={key:report.projectKey,baseline:null,requested:{trust_level:'trusted'}};await save(report);
  const projects={...(base.config.projects??{}),[report.projectKey]:{trust_level:'trusted'}};
  await client.rpc('config/batchWrite',{filePath:configPath,expectedVersion:base.version,reloadUserConfig:true,edits:[{keyPath:'projects',mergeStrategy:'replace',value:projects}]});
  const after=await baseUser(client);assert.equal(after.config.projects[report.projectKey].trust_level,'trusted');
  assertConfigHashEqual(withoutOwned(after.config,report),withoutOwned(base.config,report),'Native enrollment changed unrelated config');report.projectTrustPersisted=true;
 });
 await policyTransition(report,'temporary-policy-source-enable',[path.join(sourceRoot,'bin/agent-harness.mjs'),'hook-policy','enable',sourceRoot,'--project',sourceRoot],{version:1,enabled:true,authority:'explicit-canonical-kit-location',sourceRoot,projects:[sourceRoot]});
 await policyTransition(report,'temporary-policy-enable',[path.join(sourceRoot,'bin/agent-harness.mjs'),'hook-policy','enable',sourceRoot,'--project',fixture],{version:1,enabled:true,authority:'explicit-canonical-kit-location',sourceRoot,projects:[sourceRoot,fixture].sort()});
 const policy=await optionalBytes(policyPath);report.policy.expectedEnabledHash=sha(policy);report.policy.projects=(JSON.parse(policy)).projects;await save(report);
 assert.deepEqual(report.policy.projects.slice().sort(),[sourceRoot,fixture].sort());
 await nativeConfigSession(report,'scoped-enrollment',async client=>{
  const discovery=await client.rpc('hooks/list',{cwds:[fixture]});const defs=reviewNativeDefinitions(discovery,fixture,canonical,canonical);assert.equal(defs.length,6);
  report.definitions=defs.map(({command,...definition})=>({...definition,commandSha256:sha(command)}));assert(defs.every(definition=>definition.trustStatus!=='trusted'),'Fresh fixture hook hashes must begin untrusted');await save(report);
  await verifyGate({allowSuccessors:true,helperFreeze});
  const baseline=await baseUser(client);report.unrelatedBeforeHash=configHash(withoutOwned(baseline.config,report));report.ownership.hashes={baseline:Object.fromEntries(report.definitions.map(definition=>[definition.key,baseline.config.hooks?.state?.[definition.key]?.trusted_hash??null])),requested:Object.fromEntries(report.definitions.map(definition=>[definition.key,definition.currentHash]))};await save(report);
  const result=await syncHarness(fixture,{enrollHooks:true,hookApproval:await verifiedHookApproval({rpc:client.rpc,helperFreeze})});
  assert.equal(result.nativeHookApproval?.status,'trusted');assert.equal(result.nativeHookApproval?.approved,6);report.scopedEnrollment={actualNativeRpc:true,sourceAuthenticatedBeforeAfterWrites:true,status:result.nativeHookApproval.status,approved:result.nativeHookApproval.approved};await save(report);
 });
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
 const logA=path.join(artifactRoot,'worker-a-events.jsonl');const clientA=await nativeConnect({cwd:report.fixture,log:logA,limit:5000,bodyAfterPrefix:true});
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
 }finally{report.terminations.push({label:'worker-a',...await closeNative(clientA)});await artifactExisting(report,logA);await save(report);}
 const logB=path.join(artifactRoot,'worker-b-events.jsonl');const clientB=await nativeConnect({cwd:report.fixture,log:logB,limit:80000});
 try{
  const instructions=`You are a fresh sole mutating worker in this disposable fixture. No earlier worker transcript is provided. Objective: verify integer cents product acceptance and release ownership. Instead of claim, run exactly ${report.transfer.resumeCommand} then run exactly node .harness/run.mjs bootstrap --validate --json; read local config and docs and run doctor status next. Inspect only the bounded packet obtained by your own resume. Correct product.mjs only if needed. Run node .harness/run.mjs verify fixture-cents-001. On success run checkpoint --reason worker_yield with concise summary and next. Preserve all trust and acceptance files. Follow local AGENTS.md.`;
  const started=await clientB.start(instructions);const threadId=started.thread.id;assert.notEqual(threadId,report.workerA.threadId);
  report.workerB={threadId,header:null,freshThread:true,predecessorTranscriptProvided:false,delegatedResumeCommand:report.transfer.resumeCommand};await save(report);
  const turn=await settledTurn(clientB,threadId,'Resume the exact parked transfer, complete the configured feature verification, and yield with worker_yield.',report.fixture,{headerPath:started.thread.path});report.workerB.header=turn.header;report.workerB.turn={id:turn.turn.id,status:turn.turn.status};assert.equal(turn.turn.status,'completed');
 }finally{report.terminations.push({label:'worker-b',...await closeNative(clientB)});await artifactExisting(report,logB);await save(report);}
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
 assert.equal(report.pending,null,'Unknown command outcome must be reconciled before cleanup');
 assert(!report.closeFailures?.length,'Unconfirmed native termination must be reconciled before cleanup');
 assert(report.terminations.every(t=>t.treeAbsent),'Every opened native process tree must be confirmed terminated before cleanup');
 assert((report.nativeSessions??[]).every(session=>report.terminations.some(t=>t.label===session.label&&t.treeAbsent)),'Every attempted native session requires a finalized termination receipt');
 if(report.status==='native-passed')assert(report.terminations.some(t=>t.label==='worker-b'&&t.treeAbsent));
 const writes=report.nativeWrites??[];
 if(writes.length)await nativeConfigSession(report,'cleanup-readback',async client=>{
  const before=await baseUser(client);const config=structuredClone(before.config);const state=config.hooks?.state??{};
  const edits=[];
  if(writes.some(write=>write.kind==='hashes')){
   const owned=report.ownership.hashes;
   for(const [key,requested] of Object.entries(owned.requested)){const current=state[key]?.trusted_hash??null,baseline=owned.baseline[key];assert(current===baseline||current===requested,'Owned native hash differs from baseline and requested state; cleanup is parked');if(current===baseline)continue;if(baseline===null){delete state[key].trusted_hash;if(!Object.keys(state[key]).length)delete state[key];}else state[key].trusted_hash=baseline;}
   edits.push({keyPath:'hooks.state',mergeStrategy:'replace',value:state});
  }
  if(writes.some(write=>write.kind==='project')){
   const current=config.projects?.[report.projectKey]??null,owned=report.ownership.project;
   assert(stable(current)===stable(owned.baseline)||stable(current)===stable(owned.requested),'Owned project differs from baseline and requested state; cleanup is parked');
   if(owned.baseline===null)delete config.projects?.[report.projectKey];else config.projects[report.projectKey]=owned.baseline;
   edits.push({keyPath:'projects',mergeStrategy:'replace',value:config.projects??{}});
  }
  assert.equal(configHash(withoutOwned(before.config,report)),writes.at(-1).unrelatedBeforeHash,'Unrelated config drift; cleanup is parked');
  if(configHash(config)!==configHash(before.config))await client.rpc('config/batchWrite',{filePath:configPath,expectedVersion:before.version,reloadUserConfig:true,edits});
  const after=await baseUser(client);assertConfigHashEqual(after.config,config,'Native cleanup readback differs from requested config');assertConfigHashEqual(withoutOwned(after.config,report),withoutOwned(before.config,report),'Native cleanup changed unrelated config');
  report.cleanup={nativeOwnedChangesRemoved:true,freshReadback:true,unrelatedBeforeHash:configHash(withoutOwned(before.config,report)),unrelatedAfterHash:configHash(withoutOwned(after.config,report)),finalConfigHash:configHash(after.config)};
 });
 else report.cleanup={nativeOwnedChangesRemoved:true,noNativeWriteAttempted:true,freshReadback:false};
 assert.equal(report.policy.baselineAbsent,true);
 const currentPolicy=await optionalBytes(policyPath),currentHash=currentPolicy===null?null:sha(currentPolicy);
 if(report.policy.attempt){
  const attempt=report.policy.attempt;assert.equal(attempt.beforeHash,report.policy.currentHash??null,'Policy intent lacks its authenticated baseline');
  if(currentHash===attempt.beforeHash){report.policy.reconciliations??=[];report.policy.reconciliations.push({label:attempt.label,outcome:'baseline-unchanged',observedHash:currentHash});report.policy.attempt=null;await save(report);}
  else{
   const ref=report.artifacts.find(item=>item.path.endsWith('/'+attempt.label+'-controller.json'));assert(ref,'Changed policy has no command receipt');const bytes=await readReference(ref),receipt=JSON.parse(bytes);assert(receipt.confirmed&&receipt.exitCode===0&&!receipt.overflow,'Policy command outcome is unproved');assert.deepEqual(JSON.parse(currentPolicy),attempt.expected,'Policy intent readback differs from requested state');
   report.policy.transitions??=[];report.policy.transitions.push({label:attempt.label,beforeHash:attempt.beforeHash,afterHash:currentHash,expected:attempt.expected,guard:'confirmed-command-and-fresh-reconciliation-readback'});report.policy.currentHash=currentHash;report.policy.attempt=null;await save(report);
  }
 }
 if(currentPolicy===null&&report.policy.removalAttempt){assert.equal(report.policy.removalAttempt.beforeHash,report.policy.currentHash);report.policy.transitions.push({label:'temporary-policy-remove',beforeHash:report.policy.currentHash,afterHash:null,expected:null,guard:'fresh-absence-reconciled-after-guarded-unlink'});report.policy.currentHash=null;report.policy.removalAttempt=null;await save(report);}
 assert.equal(currentHash,report.policy.currentHash??null,'Temporary policy drift; cleanup is parked');
 if(currentPolicy!==null){
  await policyTransition(report,'temporary-policy-disable',[path.join(sourceRoot,'bin/agent-harness.mjs'),'hook-policy','disable'],{version:1,enabled:false});
  const disabled=await readFile(policyPath);assert.deepEqual(JSON.parse(disabled),{version:1,enabled:false});report.policy.expectedDisabledHash=sha(disabled);await save(report);
  report.policy.removalAttempt={beforeHash:report.policy.expectedDisabledHash};await save(report);assert.equal(sha(await readFile(policyPath)),report.policy.expectedDisabledHash);await unlink(policyPath);assert.equal(await optionalBytes(policyPath),null);
  report.policy.transitions.push({label:'temporary-policy-remove',beforeHash:report.policy.expectedDisabledHash,afterHash:null,expected:null,guard:'checked-immediately-before-unlink'});report.policy.currentHash=null;report.policy.removalAttempt=null;await save(report);
 }
 assert.equal(await optionalBytes(policyPath),null);
 report.cleanup.policyBaselineAbsenceRestored=true;report.cleanup.noFixtureInFinalPolicy=true;await authenticate(report);
 report.status=report.status==='native-passed'?'passed':'blocked-cleaned';report.finishedAt=new Date().toISOString();await save(report);return report;
}
export function parsePhaseArguments(args){
 assert.equal(args.length%2,0);const options={};for(let i=0;i<args.length;i+=2){assert(['--phase','--report','--expected-report-sha256','--reconciliation','--reconciliation-sha256','--manifest','--manifest-sha256'].includes(args[i]));assert(!Object.hasOwn(options,args[i]));assert.equal(typeof args[i+1],'string');options[args[i]]=args[i+1];}assert(['prepare','native','cleanup','recover'].includes(options['--phase']));assert.equal(options['--report'],selectedReport);
 if(options['--phase']!=='recover'){assert.equal(args.length,4,'Exactly --phase and --report are required');return {phase:options['--phase'],report:options['--report']};}
 assert.equal(args.length,14,'Explicit recovery requires expected raw report and authenticated reconciliation/manifest');for(const key of ['--expected-report-sha256','--reconciliation-sha256','--manifest-sha256'])assert.match(options[key]??'',/^[a-f0-9]{64}$/);
 for(const key of ['--reconciliation','--manifest'])assert.match(options[key]??'',/^\.harness\/native-hook-v2-live-004-[A-Za-z0-9-]+\.json$/);
 return {phase:'recover',report:selectedReport,expectedReportSha256:options['--expected-report-sha256'],reconciliation:options['--reconciliation'],reconciliationSha256:options['--reconciliation-sha256'],manifest:options['--manifest'],manifestSha256:options['--manifest-sha256']};
}
export async function runPhase(options){
 const {phase,report:selection}=options;assert.equal(selection,selectedReport);assert(['prepare','native','cleanup','recover'].includes(phase));assert.equal(phaseDeadline,Infinity,'One phase per controller process');const timeoutMs=phase==='native'?1200000:phase==='prepare'?240000:180000;phaseDeadline=Date.now()+timeoutMs;phaseExpired=false;
 let timer,report,work;const expiration=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('Overall '+phase+' phase deadline reached; reconcile recorded unknown outcome');phaseExpired=true;finalizationDeadline=Date.now()+105000;abortPhase(error);for(const controller of controllers)controller.cancel();reject(error);},timeoutMs);});
 try{work=(async()=>{if(phase==='recover'){report=await recoverPrepare(options);return {status:report.status,report:selectedReport,recovery:report.recovery,nativeSuccess:false};}if(phase!=='prepare'){await inspectReportLocation(sourceRoot,selectedReport);report=await json(reportPath);phaseReport=report;artifactRoot=path.join(sourceRoot,selectedArtifactDirectory(report));assert.equal(report.pending,null,'Reconcile pending command outcome first');await authenticate(report);}report=phase==='prepare'?await prepare():phase==='native'?await lifecycle(report):await cleanup(report);guardDeadline();assert.equal(clients.size,0,'Successful phase left a native session open');assert.equal(controllers.size,0,'Successful phase left a controller open');return {status:report.status,report:selectedReport,fixture:report.fixture,artifacts:report.artifacts.length,nativeSuccess:report.status==='passed'};})();return await Promise.race([work,expiration]);}
 catch(error){
  clearTimeout(timer);const deadlineReached=phaseExpired;phaseExpired=true;finalizationDeadline ||= Date.now()+105000;abortPhase(error);for(const controller of controllers)controller.cancel();
  const finalizationErrors=[];const settle=async promise=>{try{await promise;}catch(failure){finalizationErrors.push({errorSha256:sha(String(failure))});}};
  let finalTimer;try{await Promise.race([Promise.all([settle(work),...[...controllers].map(controller=>settle(controller.done)),...[...clients].map(client=>settle(closeNative(client)))]),new Promise((_,reject)=>{finalTimer=setTimeout(()=>reject(new Error('Finalization termination deadline reached')),Math.max(1,finalizationDeadline-Date.now()-5000));})]);}catch(failure){finalizationErrors.push({errorSha256:sha(String(failure)),unknownOutcome:true});}finally{clearTimeout(finalTimer);}
  report=phaseReport??report;if(!report&&phase!=='recover')report=await json(reportPath).catch(()=>null);
  if(report){
   report.errors??=[];report.errors.push({phase,at:new Date().toISOString(),errorSha256:sha(String(error)),unknownOutcome:Boolean(report.pending)||Boolean(report.unknownOutcome)||closeFailures.length>0||finalizationErrors.some(item=>item.unknownOutcome),phaseExpired:deadlineReached});
   if(report.status!=='awaiting_resume')report.status='blocked';report.finalizationFailures??=[];report.finalizationFailures.push(...finalizationErrors);report.closeFailures??=[];report.closeFailures.push(...closeFailures);
   for(const proof of terminated)if(!report.terminations.some(item=>item.label===proof.label))report.terminations.push(proof);
   await save(report,{finalizing:true});
  }
  throw error;
 }
 finally{clearTimeout(timer);}
}
async function main(){try{console.log(JSON.stringify(await runPhase(parsePhaseArguments(process.argv.slice(2)))));}catch(error){console.error(JSON.stringify(error.exitCode===75?{status:'awaiting_resume',resumeCommand:error.rotation?.resumeCommand??null,rotation:error.rotation??null}:{status:'stopped-safely',errorSha256:sha(String(error))}));process.exitCode=error.exitCode===75?75:1;}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))void main();
