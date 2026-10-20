import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {verifyProductionReport,verifyNativeReceipts,verifyFreshGate} from './verify-native-hook-rollout-v2.mjs';
import {sourceRoot,targets,sourceDigest,historicalDigest,featureId,productionReport,isolatedReport,baselinePin,helperPaths,commandList,sha,stable} from './native-hook-rollout-v2-authority.mjs';
import {assertContinuation} from './verify-context-rollout.mjs';
import {assertContinuationFeatures,assertNativeBaseline,verifyContinuationArchive,continuationFiles} from './native-hook-rollout-v2.mjs';
import {exclusive,artifactRoot} from './native-hook-rollout-v2-authority.mjs';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import os from 'node:os';

const time=second=>new Date(Date.UTC(2026,9,16,0,0,second)).toISOString();
const hash=number=>number.toString(16).padStart(64,'0');
const projectTrust=Object.fromEntries(targets.map(root=>[root,'trusted']));
const allDefinitions=targets.flatMap((root,index)=>['sessionStart','preCompact','preToolUse','postToolUse','userPromptSubmit','stop'].map((eventName,i)=>({key:`${index}:${i}`,currentHash:`sha256:${hash(index*6+i+1)}`,eventName,trustStatus:'trusted',source:'project',sourcePath:path.join(root,'.codex/hooks.json'),enabled:true})));
const nativeBaseline={keys:allDefinitions.map(item=>item.key),unrelatedSha256:hash(7),projectTrust};
function nativeReceipts(write=false,definitions=allDefinitions.slice(0,6)){
  const methods=write?['hooks/list','config/read','config/batchWrite','config/read']:['hooks/list','config/read'];
  const trust=Object.fromEntries(allDefinitions.map(item=>[item.key,item.currentHash]));
  const proposed={semanticSha256:hash(8),hooksStateSha256:hash(4),unrelatedSha256:hash(7),trust,projectTrust};
  let raw=hash(1);return methods.flatMap((method,index)=>{
    const id=index+1,request={stage:'request',id,method},response={stage:'response',id,method,resultSha256:hash(3)},before=raw;
    if(method==='hooks/list')response.definitions=definitions;
    if(method==='config/read'){request.includeLayers=true;response.layer={version:'version-1',...structuredClone(proposed)};if(write&&index===1){response.layer.semanticSha256=hash(9);response.layer.hooksStateSha256=hash(10);for(const item of definitions)response.layer.trust[item.key]=null;}}
    if(method==='config/batchWrite'){Object.assign(request,{filePath:path.join(process.env.USERPROFILE,'.codex','config.toml'),readReceiptId:2,expectedVersion:'version-1',reloadUserConfig:true,proposal:structuredClone(proposed),edits:[{keyPath:'hooks.state',mergeStrategy:'replace',valueSha256:hash(4)}]});raw=hash(2);}
    return [request,response,{stage:'raw-boundary',id,method,beforeSha256:before,afterSha256:raw,readStable:method==='config/read'?true:null}];
  });
}
function fixture(){
  const files=new Map();let serial=0;
  const put=(label,value)=>{const bytes=Buffer.from(JSON.stringify(value));const ref={path:`fixture/${label}-${serial++}.json`,bytes:bytes.length,sha256:sha(bytes)};files.set(ref.path,{ref,bytes});return ref;};
  const helpers=helperPaths.map(file=>{const ref=put('helper',{file});files.set(file,files.get(ref.path));files.delete(ref.path);ref.path=file;files.get(file).ref=ref;return ref;});
  const authority={sourceDigest,helpers},authorityRef=put('authority',authority),baseline=put('baseline',{sourceDigest,authority:authorityRef,native:nativeBaseline,targets:targets.map(root=>({root}))});
  const policy=put('policy',{value:{sourceRoot,projects:[...targets].sort()}});
  const config=put('config',{policies:{maxAttempts:5,maxRepeatedFailures:2},verification:{quick:commandList.slice(0,8),full:commandList.slice(8,9),architecture:commandList.slice(9)}}),audits=[],records=[],applies=[];
  for(const [index,root] of targets.entries()){
    const early=index===0||index===4,start=early?0:40;
    const gate=put('gate',{version:2,sourceBefore:sourceDigest,sourceAfter:sourceDigest,config,helpers,invocationId:`gate-${index}`,startedAt:time(start+1),finishedAt:time(start+12),mocks:false,stubbedVerifier:false,proofCache:false,providerCredentials:false,ordinaryTemp:true,results:commandList.map((command,i)=>({index:i,command,invocationId:`project-${index}-command-${i}`,startedAt:time(start+i+1),finishedAt:time(start+i+2),exitCode:0,timedOut:false,signal:null,outputBytes:0,outputSha256:hash(1)}))});
    const definitions=allDefinitions.slice(index*6,index*6+6);
    const apply={index,root,authority:authorityRef,policy,firstwave:null,startedAt:time(start),completedAt:time(start+20),policyPatch:{onlyField:'policies.maxAttempts'},afterPreservation:{maxAttempts:5,maxRepeatedFailures:2},approval:{status:'trusted',approved:6,sourceDigest},sourceGates:[gate],receipts:nativeReceipts(index!==0,definitions)};
    const audit={index,root,authority:authorityRef,policy,firstwave:null,startedAt:time(start+21),completedAt:time(start+22),definitions,trust:Object.fromEntries(definitions.map(item=>[item.key,item.currentHash])),receipts:nativeReceipts(false,definitions)};if(index!==0)for(const receipt of audit.receipts)if(receipt.stage==='raw-boundary'){receipt.beforeSha256=hash(2);receipt.afterSha256=hash(2);}
    applies.push(apply);audits.push(audit);records.push({index,root,status:'audited',applyReceipt:null,auditReceipt:put('audit',audit)});
  }
  for(const index of [0,4])records[index].applyReceipt=put('apply',applies[index]);
  const archiveFiles=Object.fromEntries(continuationFiles.map(file=>[file,file==='.harness/handoff.md'?null:put('archive',file==='.harness/features.json'?{revision:10,features:[]}:file==='.harness/continuity.json'?{phase:'working',handoff:null,owner:null,generation:2}:{text:file})]));
  const eventRef=archiveFiles['.harness/events.jsonl'];
  const reverseArchive={root:targets[4],files:archiveFiles,eventsPrefix:{bytes:eventRef.bytes,sha256:eventRef.sha256},anchor:{root:targets[4],generation:2,featureRevision:10}};
  const firstwave=put('firstwave',{stage:'firstwave',authority:authorityRef,baseline,sealedAt:time(30),targets:[0,4].map(index=>records[index]),reverseArchive});
  for(let index=0;index<11;index++)if(index!==0&&index!==4){applies[index].firstwave=firstwave;audits[index].firstwave=firstwave;records[index].auditReceipt=put('audit',audits[index]);records[index].applyReceipt=put('apply',applies[index]);}
  const all11=put('all11',{stage:'all11',authority:authorityRef,baseline,firstwave,sealedAt:time(70),targets:records});
  const nativeConfig=put('native-config',{bytes:10,sha256:hash(1)}),launch=put('launch',{version:1,sourceDigest,stage:'post-all11-isolated-launch',all11,authority:authorityRef,reportSelection:isolatedReport,nativeConfig,startedAt:time(80)});
  const isolated=put('isolated',{status:'passed'});files.set(isolatedReport,files.get(isolated.path));files.delete(isolated.path);isolated.path=isolatedReport;files.get(isolatedReport).ref=isolated;
  const currentSourceGates=['initial','runtime','canonical'].map((phase,index)=>{const start=81+index*15;return {phase,gate:put('isolated-gate',{version:2,sourceBefore:sourceDigest,sourceAfter:sourceDigest,config,helpers,invocationId:'isolated-gate-'+index,startedAt:time(start),finishedAt:time(start+12),mocks:false,stubbedVerifier:false,proofCache:false,providerCredentials:false,ordinaryTemp:true,results:commandList.map((command,i)=>({index:i,command,invocationId:'isolated-command-'+index+'-'+i,startedAt:time(start+i),finishedAt:time(start+i+1),exitCode:0,timedOut:false,signal:null,outputBytes:0,outputSha256:hash(1)}))})};});
  const child=(phase,start,argv)=>({phase,invocationId:'child-'+phase,executable:process.execPath,argv,cwd:sourceRoot,pid:123,startedAt:time(start),finishedAt:time(start+1),exitCode:0,signal:null,timedOut:false,outputBytes:0,outputSha256:hash(1)});
  const phases=['initial','runtime','canonical'].map((phase,index)=>child(phase,93+index*15,['scripts/native-hook-auto-update-e2e.mjs','--phase',phase,'--report',isolatedReport]));
  const completion=put('completion',{version:1,stage:'post-all11-isolated-completion',launch,report:isolated,status:'passed',currentSourceGates,phases,authentication:child('authenticate',125,['scripts/native-hook-auto-update-e2e.mjs','--phase','authenticate','--report',isolatedReport]),verification:child('verify',127,['scripts/verify-native-hook-auto-update-e2e.mjs','--report',isolatedReport]),completedAt:time(129)});
  const report={version:2,featureId,reportSelection:productionReport,status:'passed',pending:null,sourceDigest,historicalRawGap:'UNKNOWN',historicalBaseline:baselinePin,authority:authorityRef,baseline,policy,firstwave,all11,targets:records,isolated:{launch,completion,report:isolated},completedAt:time(200)};
  const dependencies={authenticate:async ref=>{if(ref.path===baselinePin.path){assert.deepEqual(ref,baselinePin);return Buffer.from(JSON.stringify({sourceDigest:historicalDigest,targets:targets.map(root=>({root}))}));}const entry=files.get(ref.path);assert(entry,'Unknown reference');assert.deepEqual(ref,entry.ref);assert.equal(sha(entry.bytes),ref.sha256);return entry.bytes;},authority:async()=>authority,inspectTarget:async index=>({definitions:audits[index].definitions,maxAttempts:5,maxRepeatedFailures:2}),isolated:async()=>{}};
  const replace=(ref,mutate)=>{const entry=files.get(ref.path),value=JSON.parse(entry.bytes);mutate(value);entry.bytes=Buffer.from(JSON.stringify(value));entry.ref.bytes=entry.bytes.length;entry.ref.sha256=sha(entry.bytes);};
  return {report,dependencies,replace,files};
}
test('strict V2 accepts the complete dependency-authenticated ordered eleven graph',async()=>{const f=fixture();assert.equal((await verifyProductionReport(f.report,f.dependencies)).definitions,66);});
test('V2 rejects omission, target order, stale authority, altered ref and invented raw history',async()=>{
  for(const mutate of [r=>r.targets.pop(),r=>[r.targets[1],r.targets[2]]=[r.targets[2],r.targets[1]],r=>r.sourceDigest=historicalDigest,r=>r.authority.sha256=hash(99),r=>r.historicalRawGap='PROVEN']){const f=fixture();mutate(f.report);await assert.rejects(verifyProductionReport(f.report,f.dependencies));}
});
test('V2 rejects missing firstwave edge, gate reuse, trusted hash mismatch and raw receipt gap',async()=>{
  for(const mutate of [f=>f.replace(f.report.targets[1].applyReceipt,a=>a.firstwave=null),f=>f.replace(f.report.targets[1].applyReceipt,a=>{const first=JSON.parse(f.files.get(f.report.targets[0].applyReceipt.path).bytes);a.sourceGates=first.sourceGates;}),f=>f.replace(f.report.targets[1].auditReceipt,a=>a.trust[a.definitions[0].key]='sha256:'+hash(99)),f=>f.replace(f.report.targets[1].applyReceipt,a=>a.receipts[5].beforeSha256=hash(99))]){const f=fixture();mutate(f);await assert.rejects(verifyProductionReport(f.report,f.dependencies));}
});
test('fresh gate rejects truncated, reordered, failed, cached and repeated invocations',async()=>{
  for(const mutate of [g=>g.results.pop(),g=>[g.results[0],g.results[1]]=[g.results[1],g.results[0]],g=>g.results[0].exitCode=1,g=>g.proofCache=true,g=>g.results[1].invocationId=g.results[0].invocationId]){const f=fixture(),apply=JSON.parse(f.files.get(f.report.targets[0].applyReceipt.path).bytes),ref=apply.sourceGates[0];f.replace(ref,mutate);await assert.rejects(verifyFreshGate(ref,f.dependencies));}
});
test('native receipts reject empty, omitted boundary, stale CAS and missing real write',()=>{
  assert.throws(()=>verifyNativeReceipts([]));const incomplete=nativeReceipts();incomplete.pop();assert.throws(()=>verifyNativeReceipts(incomplete));const stale=nativeReceipts(true);stale[6].expectedVersion='stale';assert.throws(()=>verifyNativeReceipts(stale));assert.throws(()=>verifyNativeReceipts(nativeReceipts(),{writeRequired:true}));
});
test('native trusted no-op passes and sanitized proposal/unrelated/trust/readback drift fails',()=>{
  const definitions=allDefinitions.slice(0,6),options={nativeBaseline,definitions};assert.equal(verifyNativeReceipts(nativeReceipts(false),options).writes,0);
  for(const mutate of [r=>r[7].resultSha256='invalid',r=>r[6].proposal.hooksStateSha256=hash(22),r=>r[6].proposal.unrelatedSha256=hash(22),r=>r[6].proposal.trust['1:0']=null,r=>r[10].layer.semanticSha256=hash(22),r=>r[10].layer.trust['0:0']=null,r=>r[10].layer.projectTrust[targets[0]]='untrusted']){const receipts=nativeReceipts(true);mutate(receipts);assert.throws(()=>verifyNativeReceipts(receipts,options));}
});
test('native committed response loss requires exact readback and never a second write',()=>{
  const receipts=nativeReceipts(true);receipts[7]={stage:'error',id:3,method:'config/batchWrite',code:'NATIVE_RPC_TIMEOUT',errorSha256:hash(12)};
  assert.equal(verifyNativeReceipts(receipts,{nativeBaseline,definitions:allDefinitions.slice(0,6)}).recoveredWrites,1);
  const drift=structuredClone(receipts);drift[10].layer.hooksStateSha256=hash(20);assert.throws(()=>verifyNativeReceipts(drift));
  const unread=receipts.slice(0,9);assert.throws(()=>verifyNativeReceipts(unread));
  const badMethod=nativeReceipts();badMethod[1]={stage:'error',id:1,method:'hooks/list',code:'NATIVE_RPC_TIMEOUT',errorSha256:hash(12)};assert.throws(()=>verifyNativeReceipts(badMethod));
});
test('immutable native baseline rejects unrelated/project trust/key drift before writes',()=>{
  const layer=nativeReceipts()[4].layer;assertNativeBaseline(layer,nativeBaseline);
  for(const mutate of [v=>v.unrelatedSha256=hash(23),v=>v.projectTrust[targets[0]]='untrusted',v=>delete v.trust['0:0']]){const value=structuredClone(layer);mutate(value);assert.throws(()=>assertNativeBaseline(value,nativeBaseline));}
});
test('V2 graph requires internally bound baseline and Reverse archive',async()=>{
  for(const mutate of [f=>f.replace(f.report.all11,a=>a.baseline=null),f=>f.replace(f.report.firstwave,a=>delete a.reverseArchive),f=>f.replace(f.report.firstwave,a=>delete a.reverseArchive.files['.harness/progress.md']),f=>f.replace(f.report.firstwave,a=>a.reverseArchive.eventsPrefix.sha256=hash(22)),f=>f.replace(f.report.firstwave,a=>a.reverseArchive.anchor.generation++),f=>f.replace(f.report.firstwave,a=>a.reverseArchive.anchor.featureRevision++)]){const f=fixture();mutate(f);await assert.rejects(verifyProductionReport(f.report,f.dependencies));}
});
test('Reverse resumed feature state preserves historical contracts and counters',()=>{
  const old={revision:2,features:[{id:'history',status:'passing',attempts:2,evidence:['old'],contract:{scope:'fixed'}},{id:'active',status:'active',attempts:1,repeatedFailures:1,lastFailureFingerprint:'failure',evidence:['existing'],contract:{scope:'fixed'}}]};
  const current=structuredClone(old);current.revision++;current.features[1].attempts++;current.features[1].repeatedFailures=0;current.features[1].evidence.push('new');assertContinuationFeatures(old,current);
  for(const mutate of [s=>s.features[0].attempts=0,s=>s.features[1].attempts=0,s=>s.features[1].evidence[0]='replaced',s=>s.features[1].contract.scope='changed',s=>s.features[1].attempts=6]){const value=structuredClone(current);mutate(value);assert.throws(()=>assertContinuationFeatures(old,value));}
});
test('exclusive artifact rejects path traversal before creating any directory',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'rollout-exclusive-'));try{await assert.rejects(exclusive(`${artifactRoot}/../escaped.json`,{},root));assert.deepEqual(await readdir(root),[]);await exclusive(`${artifactRoot}/valid.json`,{},root);await assert.rejects(exclusive(`${artifactRoot}/valid.json`,{},root));}finally{await rm(root,{recursive:true,force:true});}
});
test('continuation is exclusive to Reverse and authenticates bounded revision/owner/generation',()=>{
  const owner={id:'resumed'},anchor={root:targets[4],generation:2,featureRevision:10},state={session:{phase:'working',handoffId:null,generation:3,owner},continuity:{phase:'working',handoff:null,generation:3,owner},bootstrap:{revision:11,continuity:{phase:'working',generation:3,owner}}};
  assert.equal(assertContinuation(targets[4],anchor,state).featureRevision,11);assert.throws(()=>assertContinuation(targets[3],anchor,state));state.bootstrap.revision=9;assert.throws(()=>assertContinuation(targets[4],anchor,state));
});

test('post-all11 completion rejects absent fresh gates, wrong selected child, timeout and reused invocations',async()=>{
  for(const change of [c=>c.currentSourceGates.pop(),c=>c.phases[0].argv[4]='historical.json',c=>c.phases[1].timedOut=true,c=>c.verification.invocationId=c.authentication.invocationId,c=>c.authentication.startedAt=c.completedAt]){const f=fixture();f.replace(f.report.isolated.completion,change);await assert.rejects(verifyProductionReport(f.report,f.dependencies));}
});
