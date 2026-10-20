import assert from 'node:assert/strict';
import {cp,mkdir,readFile,writeFile,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {windowsCommand} from '../skill/codex-harness/assets/windows-command.mjs';
import {connectNativeHookClient} from '../skill/codex-harness/scripts/lib/native-hook-client.mjs';
import * as A from './rollout004-context-performance-authority.mjs';
import {verifyNativeReceipts,verifyIsolatedCompletion} from './verify-rollout004-context-performance.mjs';
import {configProjection} from './rollout004-context-performance.mjs';

export const phases=['initial','runtime','canonical'];
const work='.harness/native-hook-v2-rollout-004-isolated';
const runtimeFile='skill/codex-harness/assets/project-runtime.mjs';
const templateFile='skill/codex-harness/assets/codex-hooks.json.template';
const runtimeAddition='\n// rollout004 isolated runtime transition\n';
const canonicalMessage='Persist rollout004 isolated worker continuity';
const binary='C:/Users/Jason/AppData/Local/OpenAI/Codex/bin/e78bad9887fa50cf/codex.exe';
const readJSON=async file=>JSON.parse(await readFile(file,'utf8'));
const quote=value=>'"'+String(value).replaceAll('"','\\"')+'"';
const paths=()=>({base:A.absolute(work),kit:A.absolute(work+'/kit'),target:A.absolute(work+'/project'),home:A.absolute(work+'/home'),state:A.absolute(work+'/state.json')});

export function isolatedEnvironment(home){
 const env=A.cleanEnvironment();
 for(const key of Object.keys(env))if(/(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|CODEX_(?:THREAD|SESSION)_ID)/i.test(key))delete env[key];
 env.CODEX_HOME=home;return env;
}
export function phaseControllerEnvironment(home,controllerIdentity=false){
 const env=isolatedEnvironment(home);if(controllerIdentity){assert.equal(typeof process.env.CODEX_THREAD_ID,'string','Native controller identity required');assert(process.env.CODEX_THREAD_ID.trim());env.CODEX_THREAD_ID=process.env.CODEX_THREAD_ID;}return env;
}
export function buildPhaseReport({phase,authority,clone,before,after,receipts,tests,nativeClose}){
 return {version:1,kind:'rollout004-isolated-phase',phase,status:'passed',authority,sourceGate:authority.sourceGate,clone,before,after,actualChange:{beforeSha256:before?A.digest(before):A.sha(Buffer.alloc(0)),afterSha256:A.digest(after)},nativeDefinitions:after.nativeDefinitions,receipts,tests,nativeClose};
}
export function canonicalTransition(text){
 const start=text.indexOf('"PreCompact"');assert(start>=0);
 const tail=text.slice(start),match=/"statusMessage"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(tail);assert(match,'Missing PreCompact statusMessage');
 const at=start+match.index+match[0].indexOf(match[1]);
 return text.slice(0,at)+JSON.stringify(canonicalMessage)+text.slice(at+match[1].length);
}
export function assertCloneDelta(baseline,current,allowed){
 const expected={...baseline};
 for(const operation of allowed){assert.equal(expected[operation.path],operation.beforeHash);expected[operation.path]=operation.afterHash;}
 assert.deepEqual(current,expected,'Unapproved isolated kit delta');return true;
}
export async function composeCloneApproval({approval,kit,sourceRoot,validateClone}){
 const check=async()=>{await validateClone();await approval.verifySource(sourceRoot);await validateClone();};
 await check();
 return {runningSource:kit,rpc:async(method,params)=>{await check();const result=await approval.rpc(method,params);await check();return result;},verifySource:async root=>{assert.equal(path.resolve(root),path.resolve(kit));await check();return {pass:true,sourceRoot,clone:kit};}};
}
export async function cloneProofInputs(){const policy=await import(pathToFileURL(path.join(A.sourceRoot,'skill/codex-harness/scripts/lib/hook-policy.mjs')).href);return {baseline:await kitTree(A.sourceRoot),runtimeText:await readFile(path.join(A.sourceRoot,runtimeFile),'utf8'),templateText:await readFile(path.join(A.sourceRoot,templateFile),'utf8'),canonical:await policy.canonicalCodexHooks(A.sourceRoot),reviewDiscovery:(discovered,installed,canonical)=>policy.reviewNativeDefinitions(discovered,paths().target,installed,canonical)};}
async function kitTree(kit){const result={};for(const file of ['package.json','bin','skill','tests'])Object.assign(result,await A.tree(kit,file));return result;}
function userLayer(result,home){const layers=result.layers?.filter(layer=>layer.name?.type==='user'&&!layer.name.profile&&path.resolve(layer.name.file??'')===path.join(home,'config.toml'));assert.equal(layers?.length,1);assert.equal(typeof layers[0].version,'string');assert(layers[0].config&&typeof layers[0].config==='object');return layers[0];}
function withoutTrustedHash(config,key){const copy=structuredClone(config);assert(copy.hooks?.state?.[key]);delete copy.hooks.state[key].trusted_hash;return copy;}
export async function recordNativeRpc({client,home,receipts,validate}){
 let id=0,lastRead,previousRaw;let definitions=[];const configFile=path.join(home,'config.toml');
 const project=config=>configProjection(config,[...new Set([...Object.keys(config.hooks?.state??{}),...definitions.map(d=>d.key)])]);
 return async(method,params={})=>{
  assert(['hooks/list','config/read','config/batchWrite'].includes(method),'Isolated native RPC method refused');await validate();
  const number=++id,before=await A.hashOptional(configFile),request={stage:'request',id:number,method};
  if(previousRaw!==undefined)assert.equal(before,previousRaw,'Unexplained native raw hash gap');
  if(method==='config/read'){assert.equal(params.includeLayers,true);request.includeLayers=true;}
  if(method==='config/batchWrite'){
   assert(lastRead);assert.equal(params.filePath,configFile);assert.equal(params.expectedVersion,lastRead.version);assert.equal(before,lastRead.rawSha256);assert.equal(params.reloadUserConfig,true);assert.equal(params.edits.length,1);assert.equal(params.edits[0].keyPath,'hooks.state');assert.equal(params.edits[0].mergeStrategy,'replace');
   const proposed=structuredClone(lastRead.config);proposed.hooks.state=params.edits[0].value;
   Object.assign(request,{readReceiptId:lastRead.id,proposal:project(proposed),expectedVersion:params.expectedVersion,reloadUserConfig:true,beforeSha256:before,edits:[{keyPath:'hooks.state',mergeStrategy:'replace',valueSha256:A.digest(params.edits[0].value)}]});
  }
  receipts.push(request);
  try{
   const result=await client.rpc(method,params),after=await A.hashOptional(configFile),response={stage:'response',id:number,method,resultSha256:A.digest(result)};
   if(method!=='config/batchWrite')assert.equal(after,before,'Native config changed during read-only RPC');
   if(method==='config/read'){const layer=userLayer(result,home);lastRead={...layer,id:number,rawSha256:after};response.layer={version:layer.version,...project(layer.config)};}
   if(method==='hooks/list'){response.definitions=result.data.flatMap(item=>item.hooks??[]);response.discovery=result;definitions=response.definitions;}
   previousRaw=after;
   receipts.push(response,{stage:'raw-boundary',id:number,method,beforeSha256:before,afterSha256:after,readStable:before===after});await validate();return result;
  }catch(error){receipts.push({stage:'failure',id:number,method,errorSha256:A.digest(A.safeFailure(error))});throw error;}
 };
}
export async function containedCommand(args,{cwd,home,logPrefix,timeoutMs,command=windowsCommand,controllerIdentity=false}={}){
 assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=2147473647,'Finite isolated deadline required');
 const stdoutPath=logPrefix+'.stdout.log',stderrPath=logPrefix+'.stderr.log';await mkdir(path.dirname(stdoutPath),{recursive:true});
 const stdout=await open(stdoutPath,'wx');let stderr;
 try{stderr=await open(stderrPath,'wx');}catch(error){await stdout.close();throw error;}
 let queue=Promise.resolve(),captureError,bytes=0,controller,outcome;const startedAt=new Date().toISOString();
 const capture=handle=>chunk=>{bytes+=chunk.length;if(bytes>16_000_000){captureError??=new Error('Isolated output bound exceeded');controller.cancel('output-limit');return;}queue=queue.then(()=>handle.write(chunk)).catch(error=>{captureError??=error;controller.cancel('capture-failed');});};
 try{controller=command([process.execPath,...args].map(quote).join(' '),cwd,phaseControllerEnvironment(home,controllerIdentity),timeoutMs);const closed=new Promise(resolve=>controller.child.once('close',(code,signal)=>resolve({code,signal})));controller.child.stdout.on('data',capture(stdout));controller.child.stderr.on('data',capture(stderr));outcome=await controller.done;if(outcome.confirmed){const end=await closed;outcome={...outcome,signal:end.signal,controllerExitCode:end.code};}await queue;}
 finally{await queue;await Promise.all([stdout.close(),stderr.close()]);}
 const invocation={args,cwd,startedAt,finishedAt:new Date().toISOString(),outcome,stdout:await A.reference(stdoutPath),stderr:await A.reference(stderrPath)};
 try{assert(!captureError,String(captureError));assert.equal(outcome.confirmed,true);if(outcome.exitCode===75){const error=new Error('Isolated process rotated');error.exitCode=75;throw error;}assert.equal(outcome.exitCode,0);assert.equal(outcome.timedOut,false);assert.equal(outcome.signal,null);assert.equal(outcome.controllerExitCode,0);}catch(error){error.invocation=invocation;throw error;}return invocation;
}
export async function runPhase(phase,reportFile){
 assert(phases.includes(phase));await A.assertOwner(A.sourceRoot);const authority=await A.currentAuthority(),p=paths();await mkdir(p.base,{recursive:true});
 let state;
 if(phase==='initial'){
  assert.equal(await A.optional(p.state),null,'Isolated experiment must be fresh');await mkdir(p.kit);for(const file of ['package.json','bin','skill','tests'])await cp(path.join(A.sourceRoot,file),path.join(p.kit,file),{recursive:true,errorOnExist:true,force:false});
  const trustedRoots=[A.sourceRoot,p.target];
  const isolatedConfig='[features]\ncodex_hooks = true\n'+trustedRoots.map(root=>`\n[projects.${JSON.stringify(root)}]\ntrust_level = "trusted"\n`).join('');
  await mkdir(p.home);await writeFile(path.join(p.home,'config.toml'),isolatedConfig,{flag:'wx'});
  state={version:1,kind:'rollout004-isolated-state',authority,baseline:await kitTree(A.sourceRoot),allowed:[],completed:[]};
 }else state=await readJSON(p.state);
 assert.deepEqual(state.completed,phases.slice(0,phases.indexOf(phase)),'Isolated phases must run once in order');assert.deepEqual(state.authority,authority);
 assert.deepEqual(state.baseline,await kitTree(A.sourceRoot),'Isolated baseline must equal sealed SOURCE bytes');
 const expectedAllowed=[];for(const prior of phases.slice(1,phases.indexOf(phase))){const file=prior==='runtime'?runtimeFile:templateFile,old=await readFile(path.join(A.sourceRoot,file),'utf8'),next=prior==='runtime'?old+runtimeAddition:canonicalTransition(old);expectedAllowed.push({path:file,beforeHash:A.sha(Buffer.from(old)),afterHash:A.sha(Buffer.from(next))});}
 assert.deepEqual(state.allowed,expectedAllowed,'Stored clone allowance changed');await assertCloneDelta(state.baseline,await kitTree(p.kit),state.allowed);
 const cloneCore=await import(pathToFileURL(path.join(p.kit,'skill/codex-harness/scripts/lib/core.mjs')).href);
 const clonePolicy=await import(pathToFileURL(path.join(p.kit,'skill/codex-harness/scripts/lib/hook-policy.mjs')).href);
 let before=null;
 const validate=async()=>assertCloneDelta(state.baseline,await kitTree(p.kit),state.allowed);
 await mkdir(p.target,{recursive:true});const receipts=[];let connected;
 const client={rpc:async(...args)=>{connected??=await connectNativeHookClient({cwd:p.target,executable:binary,env:isolatedEnvironment(p.home)});return connected.rpc(...args);},close:async()=>{if(connected)await connected.close();}};let result,after,nativeClose;
 try{
  const rawRpc=await recordNativeRpc({client,home:p.home,receipts,validate});
  const sourceApproval=await A.verifiedHookApproval({rpc:rawRpc,helperFreeze:authority.helperFreeze});
  const hookApproval={...await composeCloneApproval({approval:sourceApproval,kit:p.kit,sourceRoot:A.sourceRoot,validateClone:validate}),home:p.home};
  if(phase!=='initial'){
   const discovered=await hookApproval.rpc('hooks/list',{cwds:[p.target]}),config=await hookApproval.rpc('config/read',{includeLayers:true});before=await phaseSnapshot(p,clonePolicy,{discovered,config});
   const prior=JSON.parse(await A.authenticate(state.lastReport));assert.deepEqual(before,prior.after,'Prior isolated native phase changed');
   const file=phase==='runtime'?runtimeFile:templateFile,old=await readFile(path.join(p.kit,file),'utf8'),next=phase==='runtime'?old+runtimeAddition:canonicalTransition(old);
   assert.notEqual(next,old);const operation={path:file,beforeHash:A.sha(Buffer.from(old)),afterHash:A.sha(Buffer.from(next))};await writeFile(path.join(p.kit,file),next);state.allowed.push(operation);
  }
  await clonePolicy.enableHookPolicy({sourceRoot:p.kit,projects:[p.target],home:p.home,runningSource:p.kit});
  result=phase==='initial'?await cloneCore.initHarness(p.target,{agent:'codex',hookApproval,enrollHooks:true,commands:'node --check .harness/run.mjs'}):await cloneCore.syncHarness(p.target,{hookApproval,enrollHooks:true});
  assert.equal(result.nativeHookApproval?.status,'trusted');
  const discovered=await hookApproval.rpc('hooks/list',{cwds:[p.target]}),config=await hookApproval.rpc('config/read',{includeLayers:true});
  after=await phaseSnapshot(p,clonePolicy,{discovered,config});await validate();
 }finally{await client.close();nativeClose={confirmed:true};}
 const native=verifyNativeReceipts(receipts,{writes:true});assert.equal(native.writes,phase==='runtime'?0:1);
 assertPhaseTransition(phase,before,after);
 const config=await readJSON(path.join(p.target,'.harness/config.json')),deadline=config.policies.commandTimeoutMs*2;assert(Number.isSafeInteger(deadline));
 const tests=await containedCommand(['.harness/run.mjs','bootstrap','--validate','--json'],{cwd:p.target,home:p.home,logPrefix:path.join(p.base,phase+'.tests'),timeoutMs:deadline});
 const report=buildPhaseReport({phase,authority,clone:{baseline:state.baseline,allowed:state.allowed,current:await kitTree(p.kit)},before,after,receipts,tests,nativeClose});
 await A.exclusive(reportFile,report);state.completed.push(phase);state.lastReport=await A.reference(reportFile);await writeFile(p.state,JSON.stringify(state,null,2)+'\n');return report;
}
async function phaseSnapshot(p,policy,{discovered,config}={}){
 const canonical=await policy.canonicalCodexHooks(p.kit),installed=await readJSON(path.join(p.target,'.codex/hooks.json'));
 const nativeDefinitions=discovered?policy.reviewNativeDefinitions(discovered,p.target,installed,canonical):[];
 const snapshot={sourceRuntime:await A.hashOptional(path.join(p.kit,runtimeFile)),installedRuntime:await A.hashOptional(path.join(p.target,'.harness/run.mjs')),bootstrap:await A.hashOptional(path.join(p.target,'.harness/hooks/native-hook-bootstrap-v2.json')),canonical,installed,nativeDefinitions};
 if(config){const layer=userLayer(config,p.home);snapshot.nativeConfig=layer.config;snapshot.nativeConfigSha256=await A.hashOptional(path.join(p.home,'config.toml'));for(const item of nativeDefinitions){assert.equal(item.trustStatus,'trusted');assert.equal(layer.config.hooks.state[item.key]?.trusted_hash,item.currentHash);}}
 return snapshot;
}
export function assertPhaseTransition(phase,before,after){
 assert.equal(after.nativeDefinitions.length,6,'Exactly six native definitions required');assert(after.nativeDefinitions.every(item=>item.trustStatus==='trusted'),'Native definitions must be trusted');
 assert.equal(new Set(after.nativeDefinitions.map(item=>item.key)).size,6,'Native definition keys must be unique');assert.deepEqual(after.installed,after.canonical,'Installed canonical definitions differ');assert.equal(after.installedRuntime,after.sourceRuntime,'Installed runtime differs from source');for(const item of after.nativeDefinitions){assert.equal(after.nativeConfig.hooks.state[item.key]?.trusted_hash,item.currentHash,'Native trust must bind the actual current hash');if(item.trustedHash!==undefined)assert.equal(item.trustedHash,item.currentHash,'Definition trustedHash differs from current hash');}
 if(phase==='initial'){assert.equal(before,null);return true;}
 assert.equal(after.bootstrap,before.bootstrap,'Bootstrap changed during phase');assert.equal(after.installedRuntime,after.sourceRuntime);
 if(phase==='runtime'){assert.notEqual(after.sourceRuntime,before.sourceRuntime,'Runtime phase requires changed source');assert.notEqual(after.installedRuntime,before.installedRuntime,'Runtime phase requires changed installed runtime');assert.deepEqual(after.canonical,before.canonical,'Runtime phase changed canonical definitions');assert.deepEqual(after.installed,before.installed,'Runtime phase changed installed definitions');assert.deepEqual(after.nativeDefinitions,before.nativeDefinitions,'Runtime phase changed native definitions');assert.deepEqual(after.nativeConfig,before.nativeConfig,'Runtime phase changed native config');assert.equal(after.nativeConfigSha256,before.nativeConfigSha256,'Runtime phase changed native raw config');}
 else{
  assert.equal(phase,'canonical');assert.equal(after.sourceRuntime,before.sourceRuntime,'Canonical phase changed runtime');assert.equal(after.installedRuntime,before.installedRuntime);
  const expected=structuredClone(before.canonical);expected.hooks.PreCompact[0].hooks[0].statusMessage=canonicalMessage;assert.deepEqual(after.canonical,expected,'Canonical phase status change differs');assert.deepEqual(after.installed,after.canonical);
  const matches=before.nativeDefinitions.filter(item=>item.eventName==='preCompact');assert.equal(matches.length,1,'Exactly one preCompact native definition required');const old=matches[0],next=after.nativeDefinitions.find(item=>item.key===old.key);assert(next,'Canonical native definition missing');assert.notEqual(next.currentHash,old.currentHash,'Canonical phase requires changed native hash');if(next.statusMessage!==undefined)assert.equal(next.statusMessage,canonicalMessage,'Canonical native status changed');
  const normalize=item=>{const copy=structuredClone(item);if(item.key===old.key){delete copy.currentHash;delete copy.trustedHash;delete copy.statusMessage;}return copy;};assert.deepEqual(after.nativeDefinitions.map(normalize),before.nativeDefinitions.map(normalize),'Canonical phase changed unrelated native definitions');
  assert.deepEqual(withoutTrustedHash(after.nativeConfig,old.key),withoutTrustedHash(before.nativeConfig,old.key),'Only the canonical PreCompact trusted_hash may change');
 }
 return true;
}
export async function runIsolated(){
 await A.assertOwner(A.sourceRoot);const p=paths();await mkdir(p.base,{recursive:true});const config=await A.json('.harness/config.json'),timeoutMs=config.policies.commandTimeoutMs*4,records=[];
 for(const phase of phases){const report=work+'/'+phase+'.json',args=['scripts/rollout004-context-performance-isolated.mjs','--phase',phase,'--report',report];const invocation=await containedCommand(args,{cwd:A.sourceRoot,home:p.home,logPrefix:path.join(p.base,phase+'.invocation'),timeoutMs,controllerIdentity:true});records.push({...invocation,phase,report:await A.reference(report)});}
 const completion={version:1,kind:'rollout004-isolated-three-phase',status:'passed',phases:records};await verifyIsolatedCompletion(completion);await A.exclusive(work+'/completion.json',completion);return A.reference(work+'/completion.json');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),phase=args.indexOf('--phase'),report=args.indexOf('--report');
 (phase<0?runIsolated():runPhase(args[phase+1],args[report+1])).then(result=>console.log(JSON.stringify({status:'passed',phase:result.phase??null,reference:result.path??null}))).catch(error=>{const safe=A.safeFailure(error);console.error(JSON.stringify({name:safe.name,message:safe.message}));process.exitCode=error.exitCode===75?75:1;});
}
