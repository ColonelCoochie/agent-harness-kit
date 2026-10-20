import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {planSync,syncHarness,atomicWrite} from '../skill/codex-harness/scripts/lib/core.mjs';
import {enableHookPolicy,readHookPolicy,canonicalCodexHooks,reviewNativeDefinitions} from '../skill/codex-harness/scripts/lib/hook-policy.mjs';
import {connectNativeHookClient} from '../skill/codex-harness/scripts/lib/native-hook-client.mjs';
import {targets,sourceRoot,sha,featureDigest,verifyInstallation} from './verify-context-rollout.mjs';
import {reviewedPlan as reviewPlan} from './native-hook-rollout-v2-doc-review.mjs';
import {snapshot,stable,currentAuthority,sourceDigest,historicalDigest,artifactRoot,baselinePin,authenticateRef as authenticateCurrent,reference,exclusive as immutable,freshFullSourceGate,productionReport,isolatedReport} from './native-hook-rollout-v2-authority.mjs';

export const directory=artifactRoot;
export const baselinePath=baselinePin.path;
export const progressPath='.harness/native-hook-v2-rollout-002-progress.json';
export const frozenSource=sourceDigest;
const binary='C:/Users/Jason/AppData/Local/OpenAI/Codex/bin/9614f1d9b40d9c4f/codex.exe';
const home=path.join(process.env.USERPROFILE,'.codex');
const policyFile=path.join(home,'agent-harness-hook-policy.json');
const configFile=path.join(home,'config.toml');
const activeFeature='native-hook-v2-rollout-002';
const hostKeys=new Set(['PATH','Path','PATHEXT','SystemRoot','ComSpec','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA']);
export const cleanEnvironment=()=>Object.fromEntries(Object.entries(process.env).filter(([key])=>hostKeys.has(key)));
const absolute=relative=>path.join(sourceRoot,relative);
const json=async file=>JSON.parse(await readFile(file,'utf8'));
export const digest=value=>sha(stable(value));
const optional=async file=>{try{return await readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const hashOptional=async file=>{const bytes=await optional(file);return bytes===null?null:sha(bytes);};
async function exclusive(relative,value){return immutable(relative,value);}
async function contentRef(bytes){const relative=`${directory}/original-bytes/${sha(bytes)}.bin`;const existing=await optional(absolute(relative));if(existing!==null)assert.equal(sha(existing),sha(bytes));else await exclusive(relative,bytes);return {path:relative,bytes:bytes.length,sha256:sha(bytes)};}
const historicalFile=file=>/^\.harness\/(?:history|evidence|baselines|worker-capsules|handoffs)\//.test(file)||['.harness/context-rollout-report.json','.harness/native-hook-rollout-report.json','.harness/native-hook-auto-update-e2e-report.json','.harness/native-hook-v2-live-e2e-report.json'].includes(file);
export async function authenticateRef(ref){if(ref.kind==='digest-only-original'){assert(targets.includes(ref.root)&&historicalFile(ref.file));return authenticateCurrent({path:ref.file,bytes:ref.bytes,sha256:ref.sha256},ref.root);}return authenticateCurrent(ref);}
const safeCodes=new Set(['NATIVE_UNSUPPORTED_LAUNCHER','NATIVE_SHUTDOWN_INDETERMINATE','NATIVE_RPC_TIMEOUT','ROLLOUT_SAFE_FAILURE','ENOENT','EEXIST','EPERM','EACCES']);
export function safeFailure(error){const result=new Error('Rollout stopped safely; inspect authenticated hash-only receipts.');result.code=typeof error?.code==='number'&&Number.isFinite(error.code)?error.code:safeCodes.has(error?.code)?error.code:'ROLLOUT_SAFE_FAILURE';result.errorSha256=typeof error?.errorSha256==='string'&&/^[a-f0-9]{64}$/.test(error.errorSha256)?error.errorSha256:sha(String(error));if(error?.configWriteErrorCode==='configVersionConflict')result.configWriteErrorCode='configVersionConflict';if(Array.isArray(error?.safeReceipts))result.safeReceipts=error.safeReceipts;const location=String(error?.stack??'').match(/native-hook-rollout-v2\.mjs:(\d+):(\d+)/);result.localLine=error?.localLine??location?.[1]??null;result.localColumn=error?.localColumn??location?.[2]??null;return result;}
export function safeTrust(value){assert(value===null||(typeof value==='string'&&/^(?:sha256:)?[a-f0-9]{64}$/.test(value)),'Invalid native trust digest');return value;}
export function safeTrustLevel(value){assert(value===null||value==='trusted'||value==='untrusted','Invalid native project trust enum');return value;}
const session=root=>{const result=spawnSync(process.execPath,['.harness/run.mjs','session','--json'],{cwd:root,env:{...cleanEnvironment(),CODEX_THREAD_ID:process.env.CODEX_THREAD_ID},windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:200000});assert.equal(result.status,0,'Read-only session guard failed');return JSON.parse(result.stdout);};
export function assertOwner(root,state,actor=process.env.CODEX_THREAD_ID){assert.equal(state.phase,'working',`${root}: pending ownership transfer`);assert.equal(state.handoffId,null);if(root===sourceRoot){assert(actor,'Native child identity required');assert.equal(state.owner?.id,actor,'SOURCE must have this legitimate worker owner');}else assert.equal(state.owner,null,`${root}: another worker is active`);}
export function configWithoutAttempts(config){const copy=structuredClone(config);delete copy.policies.maxAttempts;return copy;}
export function unrelatedConfig(config,keys){const copy=structuredClone(config);for(const key of keys){const entry=copy.hooks?.state?.[key];if(entry){delete entry.trusted_hash;if(!Object.keys(entry).length)delete copy.hooks.state[key];}}return copy;}
const nativeProjection=item=>{assert(typeof item.key==='string'&&item.key.length>0&&item.key.length<2048&&!/[\r\n\x00]/.test(item.key),'Invalid native definition key');safeBytes(Buffer.from(item.key),'native-key');assert(typeof item.currentHash==='string'&&/^sha256:[a-f0-9]{64}$/.test(item.currentHash),'Invalid native definition hash');assert(['trusted','untrusted','modified'].includes(item.trustStatus),'Invalid native trust enum');assert(Number.isInteger(item.displayOrder)&&item.displayOrder>=0&&item.displayOrder<100000,'Invalid native definition order');assert(['sessionStart','preCompact','preToolUse','postToolUse','userPromptSubmit','stop'].includes(item.eventName),'Invalid native event enum');assert(targets.some(root=>item.sourcePath===path.join(root,'.codex/hooks.json'))&&item.source==='project','Invalid native definition source');assert(item.pluginId==null&&(item.enabled==null||typeof item.enabled==='boolean')&&(item.isManaged==null||typeof item.isManaged==='boolean'),'Invalid native definition flags');return Object.fromEntries(['key','currentHash','trustStatus','displayOrder','eventName','sourcePath','source','pluginId','enabled','isManaged','command','matcher','timeout','statusMessage','type'].map(key=>[key,item[key]??null]));};
const originalFiles=['.harness/config.json','.harness/features.json','.harness/continuity.json','.harness/events.jsonl','.harness/credentials-state.json','.harness/managed-files.json','.harness/repair-source.json','.harness/progress.md','.harness/handoff.md','.harness/docs-map.md','.codex/hooks.json','.codex/config.toml','.claude/settings.json','AGENTS.md','CLAUDE.md','.github/copilot-instructions.md'];
export const runtimeFiles={'.harness/run.mjs':'project-runtime.mjs','.harness/context-budget.mjs':'context-budget.mjs','.harness/repair.mjs':'repair.mjs','.harness/hooks/hook-recovery.mjs':'hook-recovery.mjs','.harness/hooks/native-hook-dispatch.mjs':'native-hook-dispatch.mjs','.harness/hooks/context-guard.mjs':'context-guard.mjs','.harness/hooks/native-hook-identity.mjs':'native-hook-identity.mjs','.harness/hooks/precompact-handoff.mjs':'precompact-handoff.mjs','.harness/hooks/sessionstart-routing.mjs':'sessionstart-routing.mjs','.harness/hooks/claude-worker-identity.mjs':'claude-worker-identity.mjs','.harness/hooks/native-hook-bootstrap-v1.json':'native-hook-bootstrap-v1.json','.harness/hooks/native-hook-bootstrap-v2.json':'native-hook-bootstrap-v2.json'};
async function tree(root,relative,output){const info=await lstat(path.join(root,relative)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(!info)return;assert(!info.isSymbolicLink(),'Baseline refuses symlinks');if(info.isDirectory()){for(const entry of (await readdir(path.join(root,relative))).sort())await tree(root,`${relative}/${entry}`,output);}else if(info.isFile())output.push(relative);else throw new Error('Unsupported historical baseline file');}
function safeBytes(bytes,file){const text=bytes.toString('utf8');for(const [key,value] of Object.entries(process.env))if(/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET)/i.test(key)&&value&&value.length>12)assert(!text.includes(value),'Environment-only credential found in proposed baseline');const shaped=/(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text);if(shaped){const error=new Error(`Secret-like content is not eligible for baseline byte copy: ${file}`);error.digestOnlyEligible=true;throw error;}}
async function originalRef(root,file,bytes){try{safeBytes(bytes,file);return await contentRef(bytes);}catch(error){assert(error.digestOnlyEligible===true&&historicalFile(file),'Original content is not eligible for evidence byte copy');return {kind:'digest-only-original',root,file,bytes:bytes.length,sha256:sha(bytes),classification:'Historical artifact contains key-shaped content; digest-only binding, no byte copy'};}}
async function sourceBindings(){const files={'.harness/native-hook-v2-live-e2e-report.json':'adc5e78109d1c6bc33f1f82342a633b2dc3d159a68996692742c879fd2c4c9b6','.harness/evidence/2026-10-16T06-22-30-833Z-native-hook-v2-live-001.json':'d89e7636570bf0f652ba20253326e3cf9737bb4c8725466cd2242ad63477833b','.harness/native-hook-auto-update-e2e-report.json':'d5dcf45ac27eac0a5145b8c250931d462d940d6778ae80c82bf65035d787637e','.harness/context-rollout-report.json':'4b826b70230de949060530d48cee850f037653f082287068a22789de6e0c4fa1','.harness/native-hook-rollout-report.json':'82c2f74477b004196cadc63ca55cf84b0f28955f1ef98a3a0f3ecccc9af95d3b'};for(const [file,hash] of Object.entries(files))assert.equal(await hashOptional(absolute(file)),hash,`Historical binding ${file}`);assert.equal((await json(absolute(Object.keys(files)[1]))).pass,true);return files;}
function baseLayer(result){const layers=result.layers?.filter(layer=>layer.name?.type==='user'&&!layer.name.profile&&path.resolve(layer.name.file)===configFile);assert.equal(layers?.length,1);assert.equal(typeof layers[0].version,'string');return layers[0];}
function configProjection(config,keys){return {semanticSha256:digest(config),hooksStateSha256:digest(config.hooks?.state??{}),unrelatedSha256:digest(unrelatedConfig(config,keys)),trust:Object.fromEntries(keys.map(key=>[key,safeTrust(config.hooks?.state?.[key]?.trusted_hash??null)])),projectTrust:Object.fromEntries(targets.map(root=>[root,safeTrustLevel(config.projects?.[root.toLowerCase()]?.trust_level??null)]))};}
export function assertNativeBaseline(projected,baseline){if(!baseline)return;assert.equal(projected.unrelatedSha256,baseline.unrelatedSha256,'Reviewed unrelated native configuration changed');assert.deepEqual(projected.projectTrust,baseline.projectTrust,'Reviewed native project trust changed');assert.deepEqual(Object.keys(projected.trust).sort(),[...baseline.keys].sort(),'Reviewed native key set changed');}
async function nativePreflight(baseline){return nativeSession(baseline.keys,async rpc=>{await rpc('config/read',{includeLayers:true});return {pass:true};},baseline);}
export async function nativeSession(keys,operation,nativeBaseline){
  const client=await connectNativeHookClient({cwd:sourceRoot,executable:binary,env:cleanEnvironment()});
  const receipts=[];let next=0,lastRead=null;
  const rpc=async(method,params={})=>{
    const id=++next,before=await hashOptional(configFile),request={stage:'request',id,method};
    if(method==='config/batchWrite'){
      assert.equal(params.filePath,configFile);assert.equal(params.expectedVersion,lastRead?.version,'CAS version must bind the immediately preceding native read');assert.equal(before,lastRead?.rawSha256,'Global bytes changed before CAS');
      assertNativeBaseline(configProjection(lastRead.config,keys),nativeBaseline);
      assert.equal(params.reloadUserConfig,true);assert.equal(params.edits.length,1);assert.equal(params.edits[0].keyPath,'hooks.state');assert.equal(params.edits[0].mergeStrategy,'replace');
      const proposed=structuredClone(lastRead.config);proposed.hooks.state=params.edits[0].value;
      assert.equal(digest(unrelatedConfig(proposed,keys)),digest(unrelatedConfig(lastRead.config,keys)),'Only enrolled trust hashes may change');
      Object.assign(request,{filePath:params.filePath,expectedVersion:params.expectedVersion,readReceiptId:lastRead.id,reloadUserConfig:true,proposal:configProjection(proposed,keys),edits:params.edits.map(edit=>({keyPath:edit.keyPath,mergeStrategy:edit.mergeStrategy,valueSha256:digest(edit.value)}))});
    }else if(method==='config/read')request.includeLayers=params.includeLayers===true;
    receipts.push(request);
    try{
      const result=await client.rpc(method,params),response={stage:'response',id,method,resultSha256:digest(result)};
      if(method==='config/read'){
        const layer=baseLayer(result);lastRead={...layer,id,rawSha256:before};
        response.layer={version:layer.version,...configProjection(layer.config,keys)};assertNativeBaseline(response.layer,nativeBaseline);
      }
      if(method==='hooks/list')response.definitions=result.data.flatMap(item=>item.hooks.filter(hook=>hook.source==='project'&&targets.some(root=>hook.sourcePath===path.join(root,'.codex/hooks.json'))).map(nativeProjection));
      receipts.push(response);return result;
    }catch(error){const safe=safeFailure(error);receipts.push({stage:'error',id,method,code:safe.code,errorSha256:safe.errorSha256});throw safe;}
    finally{const after=await hashOptional(configFile);receipts.push({stage:'raw-boundary',id,method,beforeSha256:before,afterSha256:after,readStable:method==='config/read'?before===after:null});if(method==='config/read')assert.equal(before,after,'Global config drift during native read');}
  };
  try{return {value:await operation(rpc),receipts};}catch(error){const safe=safeFailure(error);safe.safeReceipts=receipts;throw safe;}finally{try{await client.close();}catch(error){throw safeFailure(error);}}
}
async function saveProgress(report){await atomicWrite(absolute(progressPath),JSON.stringify(report,null,2)+'\n');}
export async function loadBaseline(){const progress=await json(absolute(progressPath));const baseline=JSON.parse(await authenticateRef(progress.baseline));assert.equal(baseline.version,2);assert.equal(baseline.sourceDigest,frozenSource);assert.deepEqual(baseline.targets.map(item=>item.root),targets);const current=await currentAuthority();assert.deepEqual(JSON.parse(await authenticateRef(progress.authority)),current);for(const target of baseline.targets)for(const ref of Object.values(target.files))if(ref)await authenticateRef(ref);return baseline;}
// Preparation captures the present authorized source separately from the frozen
// historical all-eleven baseline. It never replaces that historical artifact.
export async function prepare(){
  assert.equal(await optional(absolute(progressPath)),null,'Existing preparation must be authenticated, never overwritten');
  const authority=await currentAuthority(),historic=JSON.parse(await authenticateCurrent(baselinePin));
  assert.equal(historic.sourceDigest,historicalDigest);assert.deepEqual(historic.targets.map(item=>item.root),targets);
  const bindings=await sourceBindings(),records=[];
  for(const [index,root] of targets.entries()){
    const old=historic.targets[index];for(const ref of Object.values(old.files))if(ref)await authenticateRef(ref);
    assertOwner(root,session(root));if(index!==0)await assertOriginalPreserved(old);
    const plan=await planSync(root),reviewedReplacements=Object.fromEntries(plan.blockers.map(item=>[item.path,item.beforeHash]));
    // Only executables already reviewed in the immutable original plan may
    // receive a replacement authorization; a fresh customized path stops here.
    for(const blocker of plan.blockers)assert(old.originalPlan.blockers.some(item=>item.path===blocker.path&&item.beforeHash===blocker.beforeHash),'New unreviewed executable replacement');
    await reviewedPlan(await planSync(root,{replacements:reviewedReplacements}));
    const files=[...originalFiles,...Object.keys(runtimeFiles),...plan.readSet.filter(item=>item.kind==='file').map(item=>item.path),...(index===0?Object.keys(bindings):[])];
    for(const relative of ['.harness/history','.harness/evidence','.harness/baselines','.harness/worker-capsules','.harness/handoffs'])await tree(root,relative,files);
    const refs={};for(const file of [...new Set(files)].sort()){const bytes=await optional(path.join(root,file));refs[file]=bytes===null?null:await originalRef(root,file,bytes);}
    const config=JSON.parse(await authenticateRef(refs['.harness/config.json'])),features=JSON.parse(await authenticateRef(refs['.harness/features.json']));
    assert.equal(config.policies.maxRepeatedFailures,2);assert([3,5].includes(config.policies.maxAttempts));
    records.push({root,index,session:session(root),files:refs,reviewedReplacements,originalPlan:{planHash:plan.planHash,blockers:plan.blockers.map(({path,beforeHash,afterHash})=>({path,beforeHash,afterHash}))},configWithoutAttemptsHash:digest(configWithoutAttempts(config)),originalMaxAttempts:config.policies.maxAttempts,featuresDigest:featureDigest(features,index===0?[activeFeature]:[]),activeContract:index===0?features.features.find(item=>item.id===activeFeature)?.contract:null,preexistingDoctorFailures:old.preexistingDoctorFailures??[]});
  }
  const native=await nativeSession(historic.native.keys,async rpc=>{
    const first=baseLayer(await rpc('config/read',{includeLayers:true})),discovery=await rpc('hooks/list',{cwds:targets}),definitions=[];
    assert.equal(discovery.data.length,11);
    for(const root of targets){const data=discovery.data.filter(item=>path.resolve(item.cwd)===root);assert.equal(data.length,1);assert.equal(data[0].errors.length,0);const hooks=data[0].hooks.filter(item=>item.source==='project'&&item.sourcePath===path.join(root,'.codex/hooks.json'));assert.equal(hooks.length,6);definitions.push(...hooks.map(nativeProjection));}
    const second=baseLayer(await rpc('config/read',{includeLayers:true}));assert.equal(digest(first.config),digest(second.config));
    const keys=definitions.map(item=>item.key);assert.equal(new Set(keys).size,66);assert.deepEqual([...keys].sort(),[...historic.native.keys].sort());
    const unrelatedSha256=digest(unrelatedConfig(second.config,keys));assert.equal(unrelatedSha256,historic.native.unrelatedSha256,'Unrelated native config changed since the historical baseline');
    return {version:second.version,...configProjection(second.config,keys),keys,definitions};
  });
  assert.equal(await hashOptional(policyFile),historic.policy.sha256,'Initial policy drift requires reconciliation');
  for(const root of targets)assertOwner(root,session(root));
  const authorityRef=await exclusive(`${directory}/current-authority.json`,authority);
  const baseline=await exclusive(`${directory}/before-production-baseline.json`,{version:2,sourceDigest:frozenSource,authority:authorityRef,historicalBaseline:baselinePin,createdAt:new Date().toISOString(),targets:records,native:{...native.value,receipts:native.receipts},policy:historic.policy,bindings,historicalRawGap:'UNKNOWN'});
  await saveProgress({version:2,featureId:activeFeature,sourceDigest:frozenSource,authority:authorityRef,historicalBaseline:baselinePin,baseline,pending:null,policy:null,policyRef:null,firstwave:null,all11:null,targets:targets.map((root,index)=>({root,index,status:'captured'})),artifacts:[authorityRef,baseline]});
  return {status:'prepared',targets:11,authority:authorityRef,baseline};
}
function boundedBootstrap(root){const result=spawnSync(process.execPath,['.harness/run.mjs','bootstrap','--json'],{cwd:root,env:{...cleanEnvironment(),CODEX_THREAD_ID:process.env.CODEX_THREAD_ID},windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:200000});assert.equal(result.status,0);return JSON.parse(result.stdout);}
export const continuationFiles=['.harness/features.json','.harness/continuity.json','.harness/progress.md','.harness/handoff.md','.harness/events.jsonl'];
export async function verifyContinuationArchive(archive,authenticate){
  assert(archive);assert.equal(archive.root,targets[4]);assert.deepEqual(Object.keys(archive.files).sort(),[...continuationFiles].sort());
  const stored={};for(const file of continuationFiles){const ref=archive.files[file];if(file==='.harness/handoff.md'&&ref===null)continue;assert(ref,'Mandatory Reverse archive file missing');stored[file]=await authenticate(ref);}
  const events=archive.files['.harness/events.jsonl'];assert.deepEqual(archive.eventsPrefix,{bytes:events.bytes,sha256:events.sha256});
  assert.equal(stored['.harness/events.jsonl'].length,events.bytes);assert.equal(sha(stored['.harness/events.jsonl']),events.sha256);
  const features=JSON.parse(stored['.harness/features.json']),continuity=JSON.parse(stored['.harness/continuity.json']);
  assert.equal(continuity.phase,'working');assert.equal(continuity.handoff,null);assert.equal(continuity.owner,null);
  assert(Number.isSafeInteger(continuity.generation)&&Number.isSafeInteger(features.revision));
  assert.deepEqual(archive.anchor,{root:targets[4],generation:continuity.generation,featureRevision:features.revision});return {features,continuity};
}
export function assertContinuationFeatures(before,current){
  assert(Number.isSafeInteger(current.revision)&&current.revision>=before.revision);assert(current.features.length>=before.features.length);
  const mutable=new Set(['status','evidence','blocker','attempts','repeatedFailures','lastFailureFingerprint','updatedAt','lastVerification']);
  for(const [index,old] of before.features.entries()){
    const feature=current.features[index];assert.equal(feature?.id,old.id,'Historical feature order changed');
    if(old.status!=='active'){assert.deepEqual(feature,old,'Historical feature/contracts/counters changed');continue;}
    const immutable=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!mutable.has(key)));assert.deepEqual(immutable(feature),immutable(old),'Resumed feature contract changed');
    assert(Number.isSafeInteger(feature.attempts)&&feature.attempts>=old.attempts&&feature.attempts<=5,'Resumed attempts were reset or exceed policy');
    assert(Number.isSafeInteger(feature.repeatedFailures)&&feature.repeatedFailures>=0&&feature.repeatedFailures<=2);
    const evidence=value=>value==null?[]:Array.isArray(value)?value:[value];assert.deepEqual(evidence(feature.evidence).slice(0,evidence(old.evidence).length),evidence(old.evidence),'Historical evidence changed');
    if(feature.attempts===old.attempts){assert.equal(feature.repeatedFailures,old.repeatedFailures);assert.equal(feature.lastFailureFingerprint,old.lastFailureFingerprint);}
  }
}
export async function checkContinuationArchive(archive){
  await verifyContinuationArchive(archive,authenticateRef);
  const bytes=await readFile(path.join(archive.root,'.harness/events.jsonl'));
  assert(Number.isSafeInteger(archive.eventsPrefix.bytes)&&archive.eventsPrefix.bytes>=0&&bytes.length>=archive.eventsPrefix.bytes);
  assert.equal(sha(bytes.subarray(0,archive.eventsPrefix.bytes)),archive.eventsPrefix.sha256,'Reverse event prefix was replaced');
  // progress.md is atomically replaced by legitimate resumed work. The exact
  // firstwave version is authenticated above, without treating it as a prefix.
  return archive.anchor;
}
export async function inspectTarget(index,{baseline:original,nativeBaseline,policy,audit,firstwave}={}){
  assert(Number.isInteger(index)&&targets[index]);assert.equal(original.root,targets[index]);
  const continuation=index===4&&firstwave?.reverseArchive;
  if(continuation)original={...original,firstwaveArchive:firstwave.reverseArchive};
  const preservation=await assertOriginalPreserved(original,{applied:true,continuation:!!continuation});
  if(!continuation)assertOwner(original.root,session(original.root));
  for(const [file,asset] of Object.entries(runtimeFiles)){if(file.endsWith('claude-worker-identity.mjs')&&!(await json(path.join(original.root,'.harness/config.json'))).agents.enabled.includes('claude'))continue;assert.equal(await hashOptional(path.join(original.root,file)),await hashOptional(path.join(sourceRoot,'skill/codex-harness/assets',asset)));}
  const plan=await reviewedPlan(await planSync(original.root));assert.equal(plan.operations.filter(item=>item.action!=='preserve').length,0);
  await verifyInstallation(original.root,{preexistingDoctorFailures:original.preexistingDoctorFailures,canonicalV2:true,...(continuation?{continuation:await checkContinuationArchive(firstwave.reverseArchive)}:{})});
  assert(nativeBaseline&&policy,'Immutable native baseline and policy required');
  const native=await nativeSession(nativeBaseline.keys,async rpc=>{
    const definitions=reviewNativeDefinitions(await rpc('hooks/list',{cwds:[original.root]}),original.root,await json(path.join(original.root,'.codex/hooks.json')),await canonicalCodexHooks(sourceRoot));
    assert.equal(definitions.length,6);assert(definitions.every(item=>item.trustStatus==='trusted'&&item.enabled===true));
    const layer=baseLayer(await rpc('config/read',{includeLayers:true}));assert.equal(digest(unrelatedConfig(layer.config,nativeBaseline.keys)),nativeBaseline.unrelatedSha256);
    for(const item of definitions)assert.equal(layer.config.hooks.state[item.key].trusted_hash,item.currentHash);
    assert.deepEqual(await readHookPolicy(),policy);return {definitions:definitions.map(nativeProjection)};
  });
  if(audit)assert.deepEqual(native.value.definitions,audit.definitions);
  return {...native.value,maxAttempts:preservation.maxAttempts,maxRepeatedFailures:preservation.maxRepeatedFailures};
}
export async function sealFirstwave(){
  const baseline=await loadBaseline(),progress=await json(absolute(progressPath));assert.equal(progress.pending,null);assert.equal(progress.firstwave,null);
  assert(progress.targets.every((item,index)=>item.status===([0,4].includes(index)?'audited':'captured')),'Firstwave must contain only SOURCE and held Reverse');
  for(const index of [0,4]){const record=progress.targets[index],audit=JSON.parse(await authenticateRef(record.auditReceipt));await authenticateRef(record.applyReceipt);await inspectTarget(index,{baseline:baseline.targets[index],nativeBaseline:baseline.native,policy:progress.policy.value,audit});}
  const root=targets[4],files={};for(const file of ['.harness/features.json','.harness/continuity.json','.harness/progress.md','.harness/handoff.md','.harness/events.jsonl']){const bytes=await optional(path.join(root,file));files[file]=bytes===null?null:await contentRef(bytes);}
  const state=session(root),bootstrap=boundedBootstrap(root);assertOwner(root,state);assert(Number.isSafeInteger(bootstrap.revision));
  const events=files['.harness/events.jsonl'];assert(events);
  const reverseArchive={root,files,eventsPrefix:{bytes:events.bytes,sha256:events.sha256},anchor:{root,generation:state.generation,featureRevision:bootstrap.revision}};
  const ref=await exclusive(`${directory}/firstwave-boundary.json`,{version:1,stage:'firstwave',authority:progress.authority,baseline:progress.baseline,targets:[0,4].map(index=>({index,root:targets[index],applyReceipt:progress.targets[index].applyReceipt,auditReceipt:progress.targets[index].auditReceipt})),reverseArchive,sealedAt:new Date().toISOString()});
  progress.firstwave=ref;progress.artifacts.push(ref);await saveProgress(progress);return {status:'firstwave-sealed',firstwave:ref};
}
export async function sealAll11(){
  const baseline=await loadBaseline(),progress=await json(absolute(progressPath));assert.equal(progress.pending,null);assert.equal(progress.all11,null);assert(progress.firstwave);
  const firstwave=JSON.parse(await authenticateRef(progress.firstwave));assert(progress.targets.every(item=>item.status==='audited'));
  for(const [index,record] of progress.targets.entries()){await authenticateRef(record.applyReceipt);const audit=JSON.parse(await authenticateRef(record.auditReceipt));await inspectTarget(index,{baseline:baseline.targets[index],nativeBaseline:baseline.native,policy:progress.policy.value,audit,firstwave});}
  const ref=await exclusive(`${directory}/all11-boundary.json`,{version:1,stage:'all11',authority:progress.authority,baseline:progress.baseline,firstwave:progress.firstwave,targets:progress.targets.map(({index,root,applyReceipt,auditReceipt})=>({index,root,applyReceipt,auditReceipt})),sealedAt:new Date().toISOString()});
  progress.all11=ref;progress.artifacts.push(ref);await saveProgress(progress);return {status:'all11-sealed',all11:ref};
}
export async function finalize(isolated){
  const progress=await json(absolute(progressPath));assert.equal(progress.pending,null);assert(progress.all11);
  for(const key of ['launch','completion','report'])await authenticateRef(isolated[key]);
  const report={version:2,featureId:activeFeature,reportSelection:productionReport,status:'passed',pending:null,sourceDigest:frozenSource,historicalRawGap:'UNKNOWN',historicalBaseline:baselinePin,authority:progress.authority,baseline:progress.baseline,policy:progress.policyRef,firstwave:progress.firstwave,all11:progress.all11,targets:progress.targets.map(({index,root,status,applyReceipt,auditReceipt})=>({index,root,status,applyReceipt,auditReceipt})),isolated,completedAt:new Date().toISOString()};
  const {verifyProductionReport,productionDependencies}=await import('./verify-native-hook-rollout-v2.mjs');await verifyProductionReport(report,await productionDependencies());
  // The report is immutable and has no reference to its later configured gate.
  const bytes=Buffer.from(JSON.stringify(report,null,2)+'\n');await writeFile(absolute(productionReport),bytes,{flag:'wx'});return {status:'report-written',report:{path:productionReport,bytes:bytes.length,sha256:sha(bytes)}};
}
export async function assertOriginalPreserved(record,{applied=false,continuation=false}={}){
  const config=await json(path.join(record.root,'.harness/config.json'));
  assert.equal(digest(configWithoutAttempts(config)),record.configWithoutAttemptsHash,'Custom project config drift');assert.equal(config.policies.maxRepeatedFailures,2);if(applied)assert.equal(config.policies.maxAttempts,5);
  const features=await json(path.join(record.root,'.harness/features.json')),featuresHash=featureDigest(features,record.root===sourceRoot?[activeFeature]:[]);if(continuation){assert.equal(record.root,targets[4]);assert(record.firstwaveArchive);await checkContinuationArchive(record.firstwaveArchive);const archived=await verifyContinuationArchive(record.firstwaveArchive,authenticateRef);assertContinuationFeatures(archived.features,features);}
  if(!continuation)assert.equal(featuresHash,record.featuresDigest,'Historical features/contracts/counters drift');if(record.root===sourceRoot)assert.deepEqual(features.features.find(item=>item.id===activeFeature).contract,record.activeContract);
  const files={};
  for(const [file,ref] of Object.entries(record.files)){
    if(file.startsWith('.harness/evidence/')||file.startsWith('.harness/history/')||file.startsWith('.harness/baselines/')||file.startsWith('.harness/worker-capsules/')||file.startsWith('.harness/handoffs/')||['.harness/credentials-state.json','.harness/docs-map.md','.codex/config.toml','.claude/settings.json','AGENTS.md','CLAUDE.md','.github/copilot-instructions.md'].includes(file)||(record.root!==sourceRoot&&['.harness/features.json','.harness/continuity.json','.harness/events.jsonl','.harness/progress.md','.harness/handoff.md'].includes(file))){
      files[file]=await hashOptional(path.join(record.root,file));if(!(continuation&&['.harness/features.json','.harness/continuity.json','.harness/events.jsonl','.harness/progress.md','.harness/handoff.md'].includes(file)))assert.equal(files[file],ref?.sha256??null,`Preserved history/custom settings ${file}`);
    }
  }
  return {capturedAt:new Date().toISOString(),root:record.root,configWithoutAttemptsHash:record.configWithoutAttemptsHash,maxAttempts:config.policies.maxAttempts,maxRepeatedFailures:2,featuresHash,files};
}
async function enable(){const baseline=await loadBaseline();const report=await json(absolute(progressPath));assert.equal(report.pending,null);assert.equal(report.policy,null,'Policy already enabled; reconcile from receipt');for(const record of baseline.targets){await assertOriginalPreserved(record);assertOwner(record.root,session(record.root));}assert.equal(await hashOptional(policyFile),baseline.policy.sha256,'Guarded policy bytes changed');await nativePreflight(baseline.native);report.pending={operation:'enable',startedAt:new Date().toISOString()};await saveProgress(report);const value=await enableHookPolicy({sourceRoot,projects:targets});assert.deepEqual(value.projects,[...targets].sort());assert.deepEqual(await readHookPolicy(),value);report.policy={path:policyFile,sha256:await hashOptional(policyFile),value,guard:'Fresh all-eleven owner checks and immediately prior policy byte hash; atomic write with semantic readback, not version CAS'};const artifact=await exclusive(`${directory}/policy-enabled.json`,report.policy);report.artifacts.push(artifact);report.policyRef=artifact;report.pending=null;await saveProgress(report);console.log(JSON.stringify({status:'policy-enabled',projects:value.projects.length,artifact}));}
const fullSourceGate=freshFullSourceGate;
async function reviewedPlan(plan){return reviewPlan(plan,new Set([...Object.keys(runtimeFiles),'.harness/managed-files.json','.harness/repair-source.json','.codex/hooks.json','.claude/settings.json','.harness/codex-hooks.addition.json','.harness/claude-hooks.addition.json']));}
export async function apply(index){const startedAt=new Date().toISOString();assert(Number.isInteger(index)&&targets[index],'Exact enrolled project index required');const baseline=await loadBaseline();const report=await json(absolute(progressPath));assert.equal(report.pending,null,'Reconcile the unknown prior outcome before another write');assert.equal(await hashOptional(policyFile),report.policy?.sha256);assert.deepEqual(await readHookPolicy(),report.policy.value);const root=targets[index],original=baseline.targets[index],record=report.targets[index];if(index!==0&&index!==4){assert(report.firstwave,'Remaining wave requires immutable firstwave boundary');await authenticateRef(report.firstwave);}else assert.equal(report.firstwave,null);assert.equal(record.status,'captured','Already applied target must be audited, never replayed');const beforePreservation=await assertOriginalPreserved(original);const before=await readFile(path.join(root,'.harness/config.json'));const config=JSON.parse(before);assert.equal(config.policies.maxAttempts,original.originalMaxAttempts);assertOwner(root,session(root));await nativePreflight(baseline.native);report.pending={operation:'apply',root,phase:'policy-field',startedAt:new Date().toISOString()};await saveProgress(report);if(config.policies.maxAttempts!==5){const next=structuredClone(config);next.policies.maxAttempts=5;assert.equal(digest(configWithoutAttempts(next)),digest(configWithoutAttempts(config)));assertOwner(root,session(root));assert.equal(await hashOptional(path.join(root,'.harness/config.json')),sha(before),'Project config changed immediately before single-field patch');await atomicWrite(path.join(root,'.harness/config.json'),JSON.stringify(next,null,2)+'\n');assert.deepEqual(await json(path.join(root,'.harness/config.json')),next);}record.policyPatch={beforeSha256:sha(before),afterSha256:await hashOptional(path.join(root,'.harness/config.json')),guard:'Fresh owner and immediately prior byte hash; atomic write and exact readback, not version CAS',onlyField:'policies.maxAttempts'};const replacements=original.reviewedReplacements;const plan=await reviewedPlan(await planSync(root,{replacements}));record.planHash=plan.planHash;const review=await exclusive(`${directory}/target-${index}-plan.json`,{root,...plan});report.artifacts.push(review);report.pending.phase='sync-and-native-approval';await saveProgress(report);assertOwner(root,session(root));const artifacts=[];let native;try{native=await nativeSession(baseline.native.keys,async rpc=>{const applied=await syncHarness(root,{expectedPlanHash:plan.planHash,replacements,enrollHooks:true,hookApproval:{rpc,verifySource:verifiedRoot=>fullSourceGate(verifiedRoot,artifacts)},validateRepairAuthority:async()=>{assertOwner(root,session(root));await assertOriginalPreserved(original,{applied:true});}});assert.equal(applied.planHash,plan.planHash);assert.equal(applied.nativeHookApproval.status,'trusted');assert.equal(applied.nativeHookApproval.approved,6);return {approval:applied.nativeHookApproval,operations:applied.operations};},baseline.native);}catch(error){const receipt=await exclusive(`${directory}/target-${index}-failed-${Date.now()}.json`,{root,code:safeFailure(error).code,errorSha256:safeFailure(error).errorSha256,receipts:error.safeReceipts??[],artifacts});report.artifacts.push(...artifacts,receipt);report.pending.failure=receipt;await saveProgress(report);throw safeFailure(error);}
const receipt=await exclusive(`${directory}/target-${index}-apply.json`,{index,root,startedAt,completedAt:new Date().toISOString(),authority:report.authority,firstwave:report.firstwave,policy:report.policyRef,planHash:plan.planHash,policyPatch:record.policyPatch,beforePreservation,afterPreservation:await assertOriginalPreserved(original,{applied:true}),...native.value,receipts:native.receipts,sourceGates:artifacts});report.artifacts.push(...artifacts,receipt);record.applyReceipt=receipt;record.status='applied';report.pending=null;await saveProgress(report);await audit([index]);console.log(JSON.stringify({root,status:'audited',approval:native.value.approval,receipt}));}
export async function audit(indices){assert(Array.isArray(indices)&&indices.length>0);assert.equal(new Set(indices).size,indices.length);assert(indices.every(index=>Number.isInteger(index)&&targets[index]));const baseline=await loadBaseline();const report=await json(absolute(progressPath));assert.equal(report.pending,null);for(const index of indices){const auditStartedAt=new Date().toISOString();const root=targets[index],original=baseline.targets[index],record=report.targets[index];assert(['applied','audited'].includes(record.status));await authenticateRef(record.applyReceipt);const preservation=await assertOriginalPreserved(original,{applied:true});assertOwner(root,session(root));for(const [file,asset] of Object.entries(runtimeFiles)){if(file.endsWith('claude-worker-identity.mjs')&&!(await json(path.join(root,'.harness/config.json'))).agents.enabled.includes('claude'))continue;assert.equal(await hashOptional(path.join(root,file)),await hashOptional(path.join(sourceRoot,'skill/codex-harness/assets',asset)),`Canonical runtime ${root} ${file}`);}const preview=await reviewedPlan(await planSync(root));assert.equal(preview.operations.filter(item=>item.action!=='preserve').length,0,'Idempotent sync');record.installation=await verifyInstallation(root,{preexistingDoctorFailures:original.preexistingDoctorFailures,canonicalV2:true});const native=await nativeSession(baseline.native.keys,async rpc=>{const discovery=await rpc('hooks/list',{cwds:[root]});const definitions=reviewNativeDefinitions(discovery,root,await json(path.join(root,'.codex/hooks.json')),await canonicalCodexHooks(sourceRoot));assert.equal(definitions.length,6);assert(definitions.every(item=>item.trustStatus==='trusted'));const layer=baseLayer(await rpc('config/read',{includeLayers:true}));assert.equal(digest(unrelatedConfig(layer.config,baseline.native.keys)),baseline.native.unrelatedSha256,'Unrelated global config drift');for(const item of definitions)assert.equal(layer.config.hooks.state[item.key].trusted_hash,item.currentHash);return {definitions:definitions.map(nativeProjection),trust:Object.fromEntries(definitions.map(item=>[item.key,layer.config.hooks.state[item.key].trusted_hash])),semanticSha256:digest(layer.config),unrelatedSha256:digest(unrelatedConfig(layer.config,baseline.native.keys)),policyReadback:await readHookPolicy()};});assert.deepEqual(native.value.policyReadback,report.policy.value);assert.deepEqual(native.value.policyReadback.projects,[...targets].sort());record.auditReceipt=await exclusive(`${directory}/target-${index}-audit-${Date.now()}.json`,{index,root,authority:report.authority,firstwave:report.firstwave,policy:report.policyRef,startedAt:auditStartedAt,completedAt:new Date().toISOString(),preservation,...native.value,receipts:native.receipts,installation:record.installation});report.artifacts.push(record.auditReceipt);record.status='audited';record.auditedAt=new Date().toISOString();await saveProgress(report);}}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [command,...args]=process.argv.slice(2);let result;
    if(command==='prepare'){assert.equal(args.length,0);result=await prepare();}
    else if(command==='enable'){assert.equal(args.length,0);await enable();}
    else if(command==='apply'){assert.equal(args.length,1);assert(/^(?:[0-9]|10)$/.test(args[0]));await apply(Number(args[0]));}
    else if(command==='audit'){assert(args.length>0);assert(args.every(item=>/^(?:[0-9]|10)$/.test(item)));await audit(args.map(Number));}
    else if(command==='seal-firstwave'){assert.equal(args.length,0);result=await sealFirstwave();}
    else if(command==='seal-all11'){assert.equal(args.length,0);result=await sealAll11();}
    else if(command==='finalize'){assert.equal(args.length,1);result=await finalize(JSON.parse(await authenticateRef(await reference(args[0]))));}
    else if(command==='status'){assert.equal(args.length,0);const value=await json(absolute(progressPath));result={featureId:value.featureId,pending:value.pending,firstwave:value.firstwave,all11:value.all11,targets:value.targets.map(({index,root,status})=>({index,root,status}))};}
    else throw new Error('Explicit rollout stage required');
    if(result)console.log(JSON.stringify(result));
  }catch(error){const safe=safeFailure(error);console.error(JSON.stringify({status:'stopped-safely',code:safe.code,errorSha256:safe.errorSha256,localLine:safe.localLine}));process.exitCode=1;}
}
