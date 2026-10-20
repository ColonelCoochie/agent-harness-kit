import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import * as A from './rollout004-context-performance-authority.mjs';
import * as C from './source-context-performance-authority.mjs';
import * as W from './source-windows-containment-authority.mjs';
import {collectAudit,nativeSession,configProjection} from './rollout004-context-performance.mjs';
import {verifyNativeReceipts,verifyProductionReport,attestTarget4Continuation,verifyContinuationArchive} from './verify-rollout004-context-performance.mjs';
import {verifyEvidence,verifyGateTransition} from './rollout004-context-performance-gate.mjs';

const H=A.sha('before'),J=A.sha('after'),K=A.sha('unrelated');
const time=n=>new Date(Date.UTC(2026,0,1)+n*1000).toISOString();
const definitions=(root=A.targets[0],prefix='key')=>Array.from({length:6},(_,i)=>({key:`${prefix}-${i}`,currentHash:`sha256:${H}`,sourcePath:path.join(root,'.codex/hooks.json'),source:'project',trustStatus:'trusted'}));
const triplet=(id,method,request={},response={},before=H,after=before)=>[{stage:'request',id,method,...request},{stage:'response',id,method,resultSha256:H,...response},{stage:'raw-boundary',id,method,beforeSha256:before,afterSha256:after,readStable:method==='config/batchWrite'?null:true}];

function target4Fixture(){
 const preservation={path:A.directory+'/reverse-firstwave-preservation.json',bytes:277552,sha256:'d65a7d1ee4e6a88c48aef6c04fb2a7b7453737d6aad3edadc6ee8c7bc99da063'};
 const prefix=Buffer.from('{"type":"retained"}\n'),handoffId='handoff-20261017175438726-fcaba434';
 const events=[{type:'worker.claimed',generation:25},{type:'handoff.ready',generation:25,handoffId},{type:'worker.resumed',generation:26,handoffId,driftAccepted:false,drift:[]},{type:'checkpoint.written',generation:26}];
 const suffix=Buffer.from(events.map(event=>JSON.stringify(event)).join('\n')+'\n');
 const before={root:A.targets[4],config:{sha256:H},features:{sha256:J},histories:Object.fromEntries(Array.from({length:131},(_,i)=>[`.harness/history/progress/retained-${i}.md`,H])),selected:{'.harness/progress.md':H,'.harness/handoff.md':J,'retained':K},events:{bytes:prefix.length,sha256:A.sha(prefix)}};
 const archive={path:`.harness/history/progress/${handoffId}.md`,bytes:5962,sha256:H};
 const after={...structuredClone(before),continuity:{owner:null,generation:26},histories:{...before.histories,[archive.path]:H},selected:{...before.selected,'.harness/progress.md':J,'.harness/handoff.md':K}};
 const fixture={before,after,bytes:Buffer.concat([prefix,suffix]),strictCalls:0,authCalls:0};
 after.events={bytes:fixture.bytes.length,sha256:A.sha(fixture.bytes)};
 const attestation={version:1,kind:'rollout004-target4-postseal-continuity',root:A.targets[4],preservation,eventsBefore:before.events,eventsAfter:after.events,oldHistoryCount:131,continuitySha256:A.digest(after.continuity),archive,selectedBefore:{'.harness/progress.md':H,'.harness/handoff.md':J},selectedAfter:{'.harness/progress.md':J,'.harness/handoff.md':K},suffix:{bytes:suffix.length,sha256:A.sha(suffix)},events};
 const firstwave={kind:'rollout004-firstwave',sealedAt:time(1),reverse:{preservation}},checkpoint={reason:'worker_yield',createdAt:time(2),generation:124};
 const continuation={kind:'reverse-firstwave-continuity-archive',firstwave:{path:'fixture-firstwave',sha256:H},preservation,release:{kind:'authorized-reverse-continuation',releasedAt:time(3),sourceYield:{path:'fixture-yield'},ownerAfterYield:null,handoffAfterYield:null,sourceGeneration:124,firstwaveSha256:H}};
 const deps={authenticate:async ref=>{assert.deepEqual(ref,A.target4PostsealAttestationPin);fixture.authCalls++;return Buffer.from(JSON.stringify(attestation));},currentPreservation:async root=>{assert.equal(root,A.targets[4]);return after;},readEvents:async root=>{assert.equal(root,A.targets[4]);return fixture.bytes;},assertPreserved:async(adjusted,options)=>{fixture.strictCalls++;assert.deepEqual(options,{continuation:true,allowOwnFeature:false});assert.deepEqual(adjusted,{...before,histories:{...before.histories,[archive.path]:H},selected:{...before.selected,...attestation.selectedAfter}});},json:async ref=>ref.path==='fixture-firstwave'?firstwave:checkpoint,preservation:async ref=>{assert.deepEqual(ref,preservation);return before;}};
 return Object.assign(fixture,{preservation,attestation,continuation,deps});
}
test('target4 continuation retains its authenticated post-seal exception and strict preservation check',async()=>{
 const f=target4Fixture();assert.equal((await verifyContinuationArchive(f.continuation,f.deps)).pass,true);assert.equal(f.authCalls,1);assert.equal(f.strictCalls,1);
});
test('target4 post-seal attestation rejects unrelated or altered continuation state',async t=>{
 const cases=[
  ['foreign target',f=>{f.before.root=A.targets[3];}],
  ['foreign preservation',f=>{f.preservation={...f.preservation,sha256:J};}],
  ['changed config',f=>{f.after.config={sha256:K};}],
  ['changed feature state',f=>{f.after.features={sha256:K};}],
  ['live owner',f=>{f.after.continuity.owner={id:'active'};f.attestation.continuitySha256=A.digest(f.after.continuity);}],
  ['changed continuity digest',f=>{f.after.continuity.generation++;}],
  ['extra history',f=>{f.after.histories.extra=H;}],
  ['extra selected artifact',f=>{f.after.selected.extra=H;}],
  ['changed archive identity',f=>{f.attestation.archive.bytes++;}],
  ['changed event prefix',f=>{f.bytes[0]=32;}],
  ['changed event suffix',f=>{f.attestation.suffix.sha256=K;}],
  ['changed event sequence',f=>{f.attestation.events[2].driftAccepted=true;}],
 ];
 for(const [name,mutate] of cases)await t.test(name,async()=>{const f=target4Fixture();mutate(f);await assert.rejects(attestTarget4Continuation(f.before,f.preservation,f.deps));assert.equal(f.strictCalls,0);});
});

test('all authority authenticators return their single validated buffer under concurrent replacement',async t=>{
 const directory=await fs.mkdtemp(path.join(A.sourceRoot,'.authority-regression-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'authority.json'),relative=path.relative(A.sourceRoot,file).split(path.sep).join('/'),original=Buffer.from('{"approved":false}'),changed=Buffer.from('{"approved":true}');
 const read=fs.readFile;
 for(const [name,authority] of [['rollout004',A],['context',C],['windows',W]])await t.test(name,async()=>{
  await fs.writeFile(file,original);const ref=await authority.reference(relative);let reads=0;
  fs.readFile=async(location,...args)=>{const bytes=await read(location,...args);if(path.resolve(location)===file&&++reads===1)await fs.writeFile(file,changed);return bytes;};syncBuiltinESMExports();
  try{const bytes=await authority.authenticate(ref);assert.equal(reads,1);assert.deepEqual(bytes,original);assert.equal(A.sha(bytes),ref.sha256);}finally{fs.readFile=read;syncBuiltinESMExports();}
  await assert.rejects(authority.authenticate(ref),/Reference changed|Authority (?:bytes )?changed/);
  await fs.writeFile(file,original);await assert.rejects(authority.authenticate({...ref,bytes:ref.bytes+1}),/Reference changed|Authority (?:bytes )?changed/);
 });
});

function nativeFixture({historical=false,embedded=false}={}){
 const defs=definitions(),keys=[...defs.map(d=>d.key),'retained'],beforeConfig={hooks:{state:Object.fromEntries(keys.map(key=>[key,{trusted_hash:key==='retained'?`sha256:${K}`:null}]))},other:'preserved'},afterConfig=structuredClone(beforeConfig);
 for(const def of defs)afterConfig.hooks.state[def.key].trusted_hash=def.currentHash;
 const before=configProjection(beforeConfig,keys),after=configProjection(afterConfig,keys),request={expectedVersion:'v1',reloadUserConfig:true,beforeSha256:H,edits:[{keyPath:'hooks.state',mergeStrategy:'replace',valueSha256:after.hooksStateSha256}]};
 if(!historical)Object.assign(request,{readReceiptId:2,proposal:after});
 const response=embedded?{nativePreservation:A.nativePreservationPin,approvedDefinitions:defs,preWriteTrust:before.trust,postWriteTrust:after.trust,postWriteLayer:{version:'v2',...after}}:{};
 const receipts=[...triplet(1,'hooks/list',{cwds:[A.targets[0]]},{definitions:defs}),...triplet(2,'config/read',{includeLayers:true},{layer:{version:'v1',...before}}),...triplet(3,'config/batchWrite',request,response,H,J)];
 if(!embedded)receipts.push(...triplet(4,'config/read',{includeLayers:true},{layer:{version:'v2',...after}},J));
 return {receipts,defs,before,after};
}
test('native receipts accept projected and explicitly retained historical readback schemas',()=>{
 for(const options of [{},{historical:true},{historical:true,embedded:true}]){const f=nativeFixture(options);assert.equal(verifyNativeReceipts(f.receipts,{writes:true,definitions:f.defs}).writes,1);}
});
test('native receipts reject discontinuity, stale read bindings, missing readback and trust deltas',async t=>{
 const cases=[
  ['raw gap',r=>{r[5].beforeSha256=J;r[5].afterSha256=J;},/Unexplained native raw hash gap/],
  ['read ID',r=>{r[6].readReceiptId=1;},/Native write read receipt changed/],
  ['version',r=>{r[6].expectedVersion='stale';},/Native write version differs/],
  ['missing readback',r=>{r.splice(9);},/verified final readback/],
  ['unrelated setting',r=>{r[6].proposal.unrelatedSha256=K;},/changed unrelated settings/],
  ['unrelated trust',r=>{r[10].layer.trust.retained=`sha256:${J}`;},/unrelated trust key/],
  ['state digest',r=>{r[10].layer.hooksStateSha256=K;},/write\/readback state mismatch/],
  ['read-only change',r=>{r[2].afterSha256=J;},/read-only RPC changed config/],
 ];
 for(const [name,mutate,expected] of cases)await t.test(name,()=>{const f=nativeFixture();mutate(f.receipts);assert.throws(()=>verifyNativeReceipts(f.receipts,{writes:true,definitions:f.defs}),expected);});
 const f=nativeFixture({historical:true,embedded:true});f.receipts[7].postWriteTrust.retained=`sha256:${J}`;assert.throws(()=>verifyNativeReceipts(f.receipts,{writes:true}),/unrelated trust key/);
 const forged=nativeFixture({historical:true,embedded:true});forged.receipts[7].approvedDefinitions=structuredClone(forged.defs);forged.receipts[7].approvedDefinitions[0].currentHash=`sha256:${J}`;assert.throws(()=>verifyNativeReceipts(forged.receipts,{writes:true}),/approved definitions differ from preceding discovery/);
});
test('collector rejects settings replaced between config read and hook discovery before second dispatch',async()=>{
 const index=2,root=A.targets[index],defs=definitions(root),keys=defs.map(d=>d.key),config={hooks:{state:Object.fromEntries(defs.map(d=>[d.key,{trusted_hash:d.currentHash}]))}},calls=[];let reads=0,closed=0;
 const client={rpc:async method=>{calls.push(method);return method==='config/read'?{layers:[{name:{type:'user',file:path.join(process.env.USERPROFILE,'.codex/config.toml')},version:'v1',config}]}:{data:[{cwd:root,errors:[],hooks:defs}]};},close:async()=>{closed++;}};
 const run=hash=>collectAudit(index,{progress:{targets:A.targets.map(()=>({applies:[{path:'apply'}]})),authority:{}},baseline:{native:{...configProjection(config,keys),keys}}},{auditState:async()=>({preserved:{},runtime:{}}),readFile:async()=>Buffer.from('{}'),canonicalCodexHooks:async()=>({}),reviewNativeDefinitions:()=>defs,nativeSession:(k,operation,baseline,options)=>nativeSession(k,operation,baseline,{...options,connect:async()=>client,approval:async({rpc})=>({rpc}),hash})});
 await assert.rejects(run(async()=>++reads<=2?H:J),/Unexplained native raw hash gap/);assert.deepEqual(calls,['config/read']);assert.equal(closed,1);
 const audit=await run(async()=>H);assert.equal(verifyNativeReceipts(audit.receipts,{root,definitions:audit.native.definitions}).writes,0);
});

function store(){const files=new Map();return {put(name,value){const bytes=Buffer.from(JSON.stringify(value)),ref={path:name,bytes:bytes.length,sha256:A.sha(bytes)};files.set(A.digest(ref),bytes);return ref;},async authenticate(ref){const bytes=files.get(A.digest(ref));assert(bytes,'Unknown fixture reference');assert.equal(bytes.length,ref.bytes);assert.equal(A.sha(bytes),ref.sha256);return bytes;}};}
function productionFixture({all:mutateAll=()=>{},first:mutateFirst=()=>{},audit:mutateAudit=()=>{},apply:mutateApply=()=>{}}={}){
 const data=store(),put=data.put,auth=data.authenticate;
 const current={version:1,bridge:A.bridgePin,sourceGate:A.sourceGatePin,sourceAuthority:A.sourceAuthorityPin,node:{version:20},helperFreeze:{path:'fixture-freeze'},sourceProjection:{path:'fixture-projection'}};
 const authority=put('authority',current),baseline=put('baseline',{originalBaseline:A.originalBaselinePin,authority,sourceConfig:{sha256:H},native:{unrelatedSha256:H}}),policyValue={projects:[...A.targets].sort()},policyRef=put('policy',{value:policyValue,sha256:H});
 const records=A.targets.map((root,index)=>{
  const start=[0,4].includes(index)?1:10,defs=definitions(root,'target-'+index),trust=Object.fromEntries(defs.map(d=>[d.key,d.currentHash])),projection={semanticSha256:H,hooksStateSha256:H,unrelatedSha256:H,trust};
  const plan=put(`plan-${index}`,{planHash:H,operations:[]}),patch=index?put(`patch-${index}`,{beforeSha256:H,afterSha256:H,before:{maxAttempts:1,maxRepeatedFailures:2},after:{maxAttempts:5,maxRepeatedFailures:2}}):null;
  const applyValue={index,root,authority,startedAt:time(start),completedAt:time(start+1),plan,policyPatch:patch,migration:null,configBeforeSha256:H,configAfterSha256:H,native:{approval:{status:'trusted',planHash:H}},receipts:triplet(1,'config/read',{includeLayers:true},{layer:{version:'v1',...projection}})};mutateApply(applyValue);const apply=put(`apply-${index}`,applyValue);
  const auditValue={index,root,authority,apply,startedAt:time(start+2),completedAt:time(start+3),runtime:{runtime:H},native:{...projection,definitions:defs},receipts:[...triplet(1,'config/read',{includeLayers:true},{layer:{version:'v1',...projection}}),...triplet(2,'hooks/list',{cwds:[root]},{discoveryScopes:[{cwd:root,errors:[]}],definitions:defs})]};mutateAudit(auditValue);const audit=put(`audit-${index}`,auditValue);
  return {index,root,status:'audited',applies:[apply],audits:[audit],runtime:{runtime:H}};
 });
 const preservation=put('preservation',{root:A.targets[4]}),first={version:1,kind:'rollout004-firstwave',sealedAt:time(5),authority,baseline,policy:policyRef,targets:structuredClone([records[0],records[4]]),reverse:{preservation,session:{owner:null,handoffId:null}}};mutateFirst(first);const firstwave=put('firstwave',first),sourceYield=put('yield',{reason:'worker_yield',createdAt:time(6),generation:1});
 const continuation=put('continuation',{kind:'reverse-firstwave-continuity-archive',firstwave,preservation,release:{kind:'authorized-reverse-continuation',releasedAt:time(7),sourceYield,ownerAfterYield:null,handoffAfterYield:null,sourceGeneration:1,firstwaveSha256:firstwave.sha256}});
 const all={version:1,kind:'rollout004-all11',sealedAt:time(20),authority,baseline,policy:policyRef,firstwave,continuation,targets:structuredClone(records)};mutateAll(all);
 return {report:{version:1,featureId:A.featureId,status:'passed',pending:null,authority,baseline,policyRef,policy:{value:policyValue,sha256:H},artifacts:[],firstwave,continuation,all11:put('all11',all),targets:records},deps:{authenticate:auth,json:async ref=>JSON.parse(await auth(ref)),currentAuthority:async()=>current,preservation:async ref=>JSON.parse(await auth(ref)),assertPreserved:async()=>true}};
}
test('all11 accepts an authenticated complete historical report graph',async()=>{const f=productionFixture();assert.equal((await verifyProductionReport(f.report,f.deps)).pass,true);});
test('all11 rejects authenticated but foreign seal fields, target references and operation order',async t=>{
 for(const key of ['authority','baseline','policy','firstwave','continuation'])await t.test(key,async()=>{const f=productionFixture({all:a=>{a[key]={path:'foreign'};}});await assert.rejects(verifyProductionReport(f.report,f.deps),new RegExp(`All11 ${key} differs`));});
 for(const [name,mutate] of [['empty targets',a=>{a.targets=[];}],['apply substitution',a=>{a.targets[1].applies=[a.targets[2].applies[0]];}],['audit omission',a=>{a.targets[1].audits=[];}]])await t.test(name,async()=>{const f=productionFixture({all:mutate});await assert.rejects(verifyProductionReport(f.report,f.deps),/All11 targets and receipt references differ/);});
 for(const [options,message] of [[{first:f=>{f.policy={path:'foreign'};}},/Firstwave policy differs/],[{first:f=>{f.targets[0].audits=[{path:'foreign'}];}},/Firstwave audit prefix differs/],[{audit:a=>{if(a.index===2)a.completedAt=time(21);}},/Audit\/all11 order regressed/],[{apply:a=>{if(a.index===2)a.startedAt=time(6);}},/Continuation\/apply order regressed/],[{audit:a=>{if(a.index===0)a.completedAt=time(6);}},/Firstwave audit\/seal order regressed/]]){const f=productionFixture(options);await assert.rejects(verifyProductionReport(f.report,f.deps),message);}
});

function evidenceFixture(change=()=>{}){
 const data=store(),entries=[{command:'node --test tests/harness.test.mjs',layer:'full',criterionId:null},{command:`node scripts/verify-rollout004-context-performance-supersession.mjs --report ${A.reportPath}`,layer:'acceptance',criterionId:'criterion'}],before={attempts:2,evidencePrefix:[],contractHash:H,configHash:H,contract:{hash:H},expected:{layers:['full'],entries}},invocation={startedAt:time(0),finishedAt:time(3)};
 const plan={schemaVersion:2,feature:{id:A.featureId,contractHash:H},config:{hash:H},requiredLayers:[{id:'full',order:0}],executions:entries.map((e,i)=>({id:`execution-${i}`,order:i,...e,commandHash:A.digest(e.command),commandRedacted:false,credentials:[],expected:{pass:true,exitCode:0,timedOut:false}}))};
 const log=data.put('.harness/logs/fixture.log',''),evidence={schemaVersion:5,harnessVersion:6,pass:true,featureId:A.featureId,contractHash:H,configHash:H,scopeViolations:[],verificationHash:A.digest(plan),verificationPlan:plan,requiredLayers:['full'],executedLayers:['full','acceptance'],attempt:3,startedAt:time(1),finishedAt:time(2),commands:entries.map((e,i)=>({...e,executionId:`execution-${i}`,executionOrder:i,credentials:[],pass:true,exitCode:0,timedOut:false,signal:null,terminationConfirmed:true,logs:{stdout:log.path,stderr:log.path}}))};change(evidence);
 return {ref:data.put('.harness/evidence/fixture.json',evidence),before,invocation,deps:{authenticate:data.authenticate,reference:async name=>{assert.equal(name,log.path);return log;}},after:{status:'passing',attempts:3,contract:before.contract,lastVerification:{at:evidence.finishedAt,pass:true}}};
}
test('attempt evidence and lastVerification bind the configured transition',async()=>{const f=evidenceFixture(),verified=await verifyEvidence(f.ref,f.before,f.invocation,f.deps);assert.equal(verifyGateTransition(f.before,f.after,verified),true);for(const field of ['at','pass']){const after=structuredClone(f.after);after.lastVerification[field]=field==='at'?time(3):false;assert.throws(()=>verifyGateTransition(f.before,after,verified),/lastVerification differs/);}});
test('attempt evidence rejects forged attempts, omitted/reordered layers and stale final state',async()=>{
 for(const [change,message] of [[e=>{e.attempt=999;},/Evidence attempt does not match transition/],[e=>{delete e.attempt;},/Evidence attempt does not match transition/],[e=>{e.executedLayers=['full'];},/Executed layers do not match/],[e=>{e.executedLayers.reverse();},/Executed layers do not match/]]){const f=evidenceFixture(change);await assert.rejects(verifyEvidence(f.ref,f.before,f.invocation,f.deps),message);}
 const f=evidenceFixture(),verified=await verifyEvidence(f.ref,f.before,f.invocation,f.deps);assert.throws(()=>verifyGateTransition(f.before,{...f.after,attempts:999},verified),/attempt transition changed/);assert.throws(()=>verifyGateTransition(f.before,{...f.after,contract:{}},verified),/contract changed/);
});
