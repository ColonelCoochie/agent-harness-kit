import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {initHarness} from '../skill/codex-harness/scripts/lib/core.mjs';
import {managedExecutableSelection,captureInstalledInventory,nestedReferences,authorityClosure,
  assertRawLogPreview,assertRawCommandLogs,assertHelperReview,helperPaths,helperReviewPath,featureId,
  sourceAuthorityContainers,assertArtifactStringReferences,expectedPlan,archivePin,originalReport,selectedReport,
  selectionPath,helperFreezePath,recoveryPath,acceptanceCommand,assertSuccessorSelection,assertSelectedReportBindings} from './live003-windows-containment-gate.mjs';
import {sourceRoot,sha,stable,snapshot,verifyWindowsContainmentGate,futureShapes,predecessorPin} from './source-windows-containment-authority.mjs';
import {configReceiptProjection,assertConfigReceiptBindings,assertPreparingRecoveryShape,planRecoveryConfig,assertRecoveryProcessesAbsent,assertRecoveryObservationOrder,parsePhaseArguments} from './live003-windows-containment-e2e.mjs';
import {assertNativeHookPairs,assertConfirmedTermination,assertConfigPhaseBindings} from './verify-live003-windows-containment-e2e.mjs';

test('conditional installed executable closure includes both Windows supervisors and all enabled hooks',()=>{
  assert.equal(managedExecutableSelection(['codex','claude','github-copilot']).length,14);
  assert.equal(managedExecutableSelection(['codex']).length,13);
  assert.equal(managedExecutableSelection(['github-copilot']).length,5);
  for(const enabled of [['codex'],['claude'],['github-copilot']]){
    const installed=managedExecutableSelection(enabled).map(([,file])=>file);
    assert(installed.includes('.harness/windows-command.mjs'));
    assert(installed.includes('.harness/windows-command-supervisor.ps1'));
  }
  assert.throws(()=>managedExecutableSelection(['codex','codex']));
  assert.throws(()=>managedExecutableSelection(['unknown']));
  assert.throws(()=>managedExecutableSelection(['copilot']));
  assert.throws(()=>managedExecutableSelection(['copilot','github-copilot']));
});

test('real initialized canonical configuration captures all managed executable bytes',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'live003-canonical-config-test-'));
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
  try{
    await initHarness(root,{agents:'codex,claude,github-copilot'});
    const config=JSON.parse(await readFile(path.join(root,'.harness/config.json'),'utf8'));
    assert.deepEqual(config.agents.enabled,['codex','claude','github-copilot']);
    const archives=[];
    const archive=async(name,bytes)=>{const ref={path:`.harness/test/${name}`,bytes:bytes.length,sha256:sha(bytes)};archives.push(ref);return ref;};
    const proof=await captureInstalledInventory(root,archive);
    assert.equal(proof.entries.length,14);assert.equal(archives.length,30);
    assert.deepEqual(proof.entries.map(e=>e.installed),managedExecutableSelection(config.agents.enabled).map(([,file])=>file));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('installed archive capture rejects missing, extra, and stale managed entries',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'live003-inventory-test-'));
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
  try{
    const selected=managedExecutableSelection(['codex','claude','github-copilot']),files={};
    await mkdir(path.join(root,'.harness/hooks'),{recursive:true});
    await writeFile(path.join(root,'.harness/config.json'),JSON.stringify({agents:{enabled:['codex','claude','github-copilot']}}));
    for(const [asset,installed] of selected){
      const source=path.join(sourceRoot,'skill/codex-harness/assets',asset);
      await copyFile(source,path.join(root,installed));files[installed]=sha(await readFile(source));
    }
    const put=()=>writeFile(path.join(root,'.harness/managed-files.json'),JSON.stringify({version:1,files}));
    await put();
    const archives=[];
    const archive=async(name,bytes)=>{const ref={path:`.harness/test/${name}`,bytes:bytes.length,sha256:sha(bytes)};archives.push(ref);return ref;};
    const proof=await captureInstalledInventory(root,archive);
    assert.equal(proof.entries.length,14);assert.equal(archives.length,30);
    assert.deepEqual(proof.entries.map(e=>e.installed),selected.map(([,file])=>file));
    const missing=files['.harness/windows-command.mjs'];delete files['.harness/windows-command.mjs'];await put();
    await assert.rejects(captureInstalledInventory(root,archive));
    files['.harness/windows-command.mjs']=missing;files['.harness/unreviewed.mjs']=missing;await put();
    await assert.rejects(captureInstalledInventory(root,archive));
    delete files['.harness/unreviewed.mjs'];files['.harness/windows-command.mjs']='0'.repeat(64);await put();
    await assert.rejects(captureInstalledInventory(root,archive));
    files['.harness/windows-command.mjs']=missing;await put();
    await writeFile(path.join(root,'.harness/windows-command.mjs'),'stale executable');
    await assert.rejects(captureInstalledInventory(root,archive));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('historical source identities bind immutable archive bytes and fixture evidence remains a leaf',async()=>{
  const fixture={path:'.harness/fixture-proof.json',bytes:2,sha256:sha('{}')};
  const archived={path:'skill/codex-harness/assets/project-runtime.mjs',archive:'.harness/archive/runtime.mjs',bytes:3,sha256:sha('old')};
  assert.deepEqual(nestedReferences(archived),[{path:archived.archive,bytes:3,sha256:archived.sha256}]);
  const body=JSON.stringify({sourceFiles:[archived],fixtureEvidence:fixture});
  const top={path:'.harness/container.json',bytes:Buffer.byteLength(body),sha256:sha(body)};
  const data=new Map([[top.path,body],[archived.archive,'old'],[fixture.path,'{}']]);
  const readReference=async ref=>{assert.equal(Buffer.byteLength(data.get(ref.path)),ref.bytes);assert.equal(sha(data.get(ref.path)),ref.sha256);return Buffer.from(data.get(ref.path));};
  const result=await authorityClosure([top],{containers:new Set([top.path]),readReference});
  assert.deepEqual(result.map(r=>r.path),[archived.archive,top.path,fixture.path].sort());
  await assert.rejects(authorityClosure([top,{...top,sha256:'0'.repeat(64)}],{readReference}));
  data.set(archived.archive,'new');
  await assert.rejects(authorityClosure([top],{containers:new Set([top.path]),readReference}));
});

test('complete raw logs authenticate truthful 6000 character previews and byte counts',()=>{
  const stdout='line\n'.repeat(1800),stderr='';
  const command={stdout:stdout.slice(-6000),stderr,truncated:true,originalBytes:Buffer.byteLength(stdout)};
  assertRawLogPreview(command,stdout,stderr);
  assert.throws(()=>assertRawLogPreview({...command,stdout:'forged'},stdout,stderr));
  assert.throws(()=>assertRawLogPreview({...command,truncated:false},stdout,stderr));
  assert.throws(()=>assertRawLogPreview({...command,originalBytes:-1},stdout,stderr));
  assertRawLogPreview({stdout:'✓\n',stderr:'',truncated:false,originalBytes:4},'✓\n','');
  assertRawLogPreview({stdout:'[REDACTED]',stderr:'',truncated:false,originalBytes:1},'[REDACTED]','');
  const omitted='\n[OUTPUT OMITTED: oversized uninterrupted span]\n';
  assertRawLogPreview({stdout:omitted,stderr:'',truncated:true,originalBytes:100000},omitted,'');
});

test('raw log seals bind full stream bytes even when the preview is unchanged',async()=>{
 const output='prefix\n'+'tail\n'.repeat(1400),data=new Map([['.harness/logs/out.log',output],['.harness/logs/err.log','']]);
 const options={getReference:async file=>({path:file,bytes:Buffer.byteLength(data.get(file)),sha256:sha(data.get(file))}),readReference:async ref=>Buffer.from(data.get(ref.path))};
 const evidence={commands:[{executionId:'quick:1',logs:{stdout:'.harness/logs/out.log',stderr:'.harness/logs/err.log'},stdout:output.slice(-6000),stderr:'',truncated:true,originalBytes:Buffer.byteLength(output)}]};
 const sealedLogs=await assertRawCommandLogs(evidence,options);assert.deepEqual(sealedLogs.map(item=>[item.executionId,item.stream]),[['quick:1','stdout'],['quick:1','stderr']]);
 await assertRawCommandLogs(evidence,{...options,sealedLogs});data.set('.harness/logs/out.log','edited\n'+'tail\n'.repeat(1400));
 await assert.rejects(assertRawCommandLogs(evidence,{...options,sealedLogs}),/changed after sealing/);
});

test('dynamic SOURCE containers reach repair, normalization, and all original baselines without traversing fixture evidence',async()=>{
 const ref=(file,body)=>({path:file,bytes:Buffer.byteLength(body),sha256:sha(body)}),data=new Map();
 const put=(file,value)=>{const body=JSON.stringify(value);data.set(file,body);return ref(file,body);};
 const baselines=Array.from({length:11},(_,i)=>put(`.harness/original-baseline-${i}.json`,{}));
 const featureState=put('.harness/original-features.json',{features:baselines.map(scopeBaselineRef=>({scopeBaselineRef}))});
 const repair=put('.harness/repair-result.json',{}),review=put('.harness/repair-review.json',{}),normalization=put('.harness/normalization.json',{baselines});
 const transition=put('.harness/transition.json',{repair:{result:repair,review}}),futureGrant=put('.harness/grant.json',{normalizationProof:normalization});
 const readReference=async reference=>{if(reference.path===predecessorPin.path)return Buffer.from(JSON.stringify({featureState}));return Buffer.from(data.get(reference.path));};
 // The predecessor has a fixed authenticated path; this reader returns only its bounded fixture projection.
 const containers=await sourceAuthorityContainers({transition,futureGrant},{readReference});
 const result=await authorityClosure([transition,futureGrant,featureState],{containers,readReference});
 for(const item of [repair,review,normalization,featureState,...baselines])assert(result.some(reference=>reference.path===item.path));
 assertArtifactStringReferences({configReceiptPaths:['.harness/report/receipts.json']},[{path:'.harness/report/receipts.json'}],'.harness/report');
 assert.throws(()=>assertArtifactStringReferences({configReceiptPaths:['.harness/report/missing.json']},[{path:'.harness/report/receipts.json'}],'.harness/report'));
});

test('helper review validation rejects invalid identity, schema, times, and bytes before freeze creation',()=>{
 const helpers=helperPaths.map(file=>({path:file,bytes:1,sha256:sha('x')}));
 const freeze={version:1,featureId,createdAt:'2026-10-16T12:00:01.000Z',actor:{source:'CODEX_THREAD_ID',id:'worker'},review:{path:helperReviewPath,bytes:1,sha256:sha('x')},helpers};
 const review={version:1,featureId,reviewedAt:'2026-10-16T12:00:00.000Z',reviewer:{source:'CODEX_THREAD_ID',id:'reviewer',readOnly:true},outcome:'clean',findings:[],helpers};
 assertHelperReview(review,freeze,'2026-10-16T12:00:02.000Z');
 for(const mutate of [r=>r.reviewer.id='',r=>r.reviewer.id=4,r=>r.reviewer.id='worker',r=>r.reviewer.extra=true,r=>r.reviewer.source='manual',r=>r.reviewer.readOnly=1,r=>r.version=2,r=>r.featureId='other',r=>r.reviewedAt='garbage',r=>r.reviewedAt='2099-01-01T00:00:00.000Z',r=>r.helpers=[r.helpers[0],...r.helpers.slice(0,-1)]]){
  const bad=structuredClone(review);mutate(bad);assert.throws(()=>assertHelperReview(bad,freeze,'2026-10-16T12:00:02.000Z'));
 }
});

function configFixture(){
 const report={projectKey:'fixture',definitions:[{key:'hook'}]},filePath=path.join(process.env.USERPROFILE,'.codex/config.toml'),trusted='sha256:'+sha('hook');
 const config=trust=>({projects:{fixture:{trust_level:trust}},hooks:{state:{hook:{trusted_hash:trusted}}}}),receipts=[];
 const read=(id,trust,version,raw)=>{
  receipts.push(configReceiptProjection(report,{stage:'request',id,method:'config/read',params:{includeLayers:true}}));
  receipts.push(configReceiptProjection(report,{stage:'response',id,method:'config/read',result:{layers:[{name:{type:'user',file:filePath},version,config:config(trust)}]}}));
  receipts.push({stage:'raw-boundary',id,method:'config/read',beforeSha256:raw,afterSha256:raw,readStable:true});
 };
 const rawBefore=sha('before'),rawAfter=sha('after');read(1,'untrusted','v1',rawBefore);
 receipts.push(configReceiptProjection(report,{stage:'request',id:2,method:'config/batchWrite',params:{filePath,expectedVersion:'v1',edits:[{keyPath:'projects',mergeStrategy:'replace',value:config('trusted').projects}]}}));
 receipts.push(configReceiptProjection(report,{stage:'response',id:2,method:'config/batchWrite',result:{status:'ok'}}));
 receipts.push({stage:'raw-boundary',id:2,method:'config/batchWrite',beforeSha256:rawBefore,afterSha256:rawAfter,readStable:null});read(3,'trusted','v2',rawAfter);
 const events=receipts.flatMap(receipt=>receipt.stage==='request'?[{kind:'request',id:receipt.id,method:receipt.method},{kind:'configRpcReceipt',at:'now',...receipt}]:receipt.stage==='response'?[{kind:'configRpcReceipt',at:'now',...receipt}]:[]);
 return {receipts,events,trusted};
}

test('fixed successor selection rejects redirection and binds exact manifest, freeze, and recovery bytes',()=>{
 const ref=file=>({path:file,bytes:1,sha256:sha('x')}),freeze=ref(helperFreezePath);
 const selection={version:1,featureId,createdAt:'2026-10-16T12:00:00.000Z',originalReport,originalAcceptanceCommand:acceptanceCommand,reportSelection:selectedReport,helperFreeze:freeze,predecessorArchive:archivePin};
 assertSuccessorSelection(selection,freeze);
 for(const mutate of [s=>s.reportSelection=originalReport,s=>s.reportSelection='.harness/other.json',s=>s.originalReport=selectedReport,s=>s.originalAcceptanceCommand+=' --bypass',s=>s.predecessorArchive.sha256='0'.repeat(64),s=>s.helperFreeze.bytes++,s=>s.next=selectedReport,s=>s.createdAt='garbage']){
  const bad=structuredClone(selection);mutate(bad);assert.throws(()=>assertSuccessorSelection(bad,freeze));
 }
 const bindings={selection:ref(selectionPath),freeze,recovery:ref(recoveryPath)};
 const report={reportSelection:selectedReport,successorSelection:bindings.selection,helperFreeze:freeze,predecessorRecovery:bindings.recovery};
 assertSelectedReportBindings(report,bindings);
 for(const key of ['successorSelection','helperFreeze','predecessorRecovery'])for(const field of ['bytes','sha256','path']){
  const bad=structuredClone(report);bad[key][field]=field==='bytes'?2:field==='sha256'?'0'.repeat(64):'.harness/other.json';assert.throws(()=>assertSelectedReportBindings(bad,bindings));
 }
});

test('phase arguments authorize only original preparing recovery and explicit successor native phases',()=>{
 for(const phase of ['prepare','native','cleanup'])assert.equal(parsePhaseArguments(['--phase',phase,'--report',selectedReport]),phase);
 assert.equal(parsePhaseArguments(['--report',originalReport,'--phase','recover-preparing']),'recover-preparing');
 for(const args of [[],['--phase','prepare'],['--phase','native','--report',originalReport],['--phase','recover-preparing','--report',selectedReport],['--phase','cleanup','--report','.harness/other.json'],['--phase','prepare','--phase','prepare'],['--phase','prepare','--bypass','true'],['--phase','prepare','--report',selectedReport,'--force','true']])assert.throws(()=>parsePhaseArguments(args));
});

test('preparing recovery fails closed on partial lifecycle, unknown write, policy drift, and present or reused PIDs',async()=>{
 const archiveBytes=await readFile(path.join(sourceRoot,archivePin.path));assert.equal(archiveBytes.length,archivePin.bytes);assert.equal(sha(archiveBytes),archivePin.sha256);
 const archive=JSON.parse(archiveBytes),copy=archive.archived.find(entry=>entry.original.path===originalReport).archive;
 const bytes=await readFile(path.join(sourceRoot,copy.path));assert.equal(sha(bytes),copy.sha256);const report=JSON.parse(bytes);
 assertPreparingRecoveryShape(report);
 for(const mutate of [r=>r.status='prepared',r=>r.pending={kind:'config/batchWrite'},r=>r.reportSelection=selectedReport,r=>r.policy.baselineAbsent=false,r=>r.policy.currentHash='drift',r=>r.trustBypass=true,...['definitions','installedInventory','workerA','workerB','transfer','lifecycle','cleanup'].map(key=>r=>r[key]=null)]){
  const bad=structuredClone(report);mutate(bad);assert.throws(()=>assertPreparingRecoveryShape(bad));
 }
 const proof=assertRecoveryProcessesAbsent([{ProcessId:1,CommandLine:'unrelated process'}],report);assert.equal(proof.priorPidsAbsent,true);assert.equal(proof.fixtureProcessesAbsent,true);
 for(const pid of report.terminations[0].treePids)assert.throws(()=>assertRecoveryProcessesAbsent([{ProcessId:pid,CommandLine:'unrelated reused PID'}],report));
 assert.throws(()=>assertRecoveryProcessesAbsent([{ProcessId:1,CommandLine:report.fixture.toUpperCase()}],report));
});

test('recovery removes only exact owned approvals and fixture trust while preserving sibling config',()=>{
 const definitions=Array.from({length:6},(_,i)=>({key:'owned-'+i,currentHash:'sha256:'+sha('owned-'+i),trustStatus:'trusted',enabled:true}));
 const report={projectKey:'fixture',definitions},config={model:'kept',hooks:{other:'kept',state:Object.fromEntries(definitions.map(d=>[d.key,{trusted_hash:d.currentHash,sibling:'kept'}]))},projects:{fixture:{trust_level:'trusted',sibling:'kept'},other:{trust_level:'trusted'}}};
 config.hooks.state.unrelated={trusted_hash:'unrelated'};const before=structuredClone(config),expected=structuredClone(config);
 for(const d of definitions)delete expected.hooks.state[d.key].trusted_hash;delete expected.projects.fixture.trust_level;
 assert.deepEqual(planRecoveryConfig(config,report),expected);assert.deepEqual(config,before);
 for(const mutate of [c=>c.hooks.state['owned-0'].trusted_hash='drift',c=>delete c.hooks.state['owned-1'],c=>c.projects.fixture.trust_level='untrusted']){const bad=structuredClone(config);mutate(bad);assert.throws(()=>planRecoveryConfig(bad,report));}
 for(const mutate of [r=>r.definitions.pop(),r=>r.definitions[1].key=r.definitions[0].key,r=>r.definitions[0].enabled=false,r=>r.definitions[0].trustStatus='untrusted']){const bad=structuredClone(report);mutate(bad);assert.throws(()=>planRecoveryConfig(config,bad));}
});

test('recovery observation boundaries follow one ordered discovery and config session through confirmed termination',()=>{
 const at=second=>`2026-10-16T12:00:${String(second).padStart(2,'0')}.000Z`;
 const fixture={ledger:{createdAt:at(1),finishedAt:at(9)},before:{observedAt:at(0)},after:{observedAt:at(8)},events:[{kind:'invocation',at:at(2)},...['initialize','hooks/list','config/read','config/batchWrite','config/read'].map((method,index)=>({kind:'request',method,at:at(2+index)})),{kind:'confirmedTermination',at:at(7)}]};
 const check=f=>assertRecoveryObservationOrder(f.ledger,f.events,f.before,f.after);check(fixture);
 for(const mutate of [
  f=>{[f.before,f.after]=[f.after,f.before];},f=>f.after.observedAt=at(6),f=>f.before.observedAt=at(2),f=>f.ledger.createdAt=at(3),f=>f.ledger.finishedAt=at(7),
  f=>f.after.observedAt='invalid',f=>f.ledger.createdAt='2026-10-16T12:00:01Z',f=>delete f.ledger.finishedAt,f=>f.events[0].at='invalid',f=>f.events.at(-1).at=at(10),
  f=>f.events.splice(0,1),f=>f.events.push({...f.events.at(-1)}),f=>f.events.splice(2,0,{kind:'request',method:'hooks/list',at:at(3)}),f=>{[f.events[2],f.events[3]]=[f.events[3],f.events[2]];},
  f=>f.events[4].at=at(2),f=>f.events[3].at='2026-10-16T12:00:04Z',f=>{[f.events[0],f.events[1]]=[f.events[1],f.events[0]];},f=>f.events.splice(6,0,{kind:'request',method:'turn/start',at:at(6)})
 ]){const bad=structuredClone(fixture);mutate(bad);assert.throws(()=>check(bad));}
});

test('pinned predecessor closure follows all eight archived helpers alongside current helper bytes',async()=>{
 const archive=JSON.parse(await readFile(path.join(sourceRoot,archivePin.path))),roots=[archivePin];
 for(const file of helperPaths){const bytes=await readFile(path.join(sourceRoot,file));roots.push({path:file,bytes:bytes.length,sha256:sha(bytes)});}
 const closure=await authorityClosure(roots,{containers:new Set([archivePin.path])}),paths=new Set(closure.map(ref=>ref.path));
 for(const file of helperPaths){assert(paths.has(file));const entry=archive.archived.find(item=>item.original.path===file);assert(entry);assert(paths.has(entry.archive.path));}
 await assert.rejects(authorityClosure([{...archivePin,sha256:'0'.repeat(64)}],{containers:new Set([archivePin.path])}));
});
test('native config receipts preserve real hash prefixes and bind ordered reads, writes, raw boundaries, and event logs',()=>{
 const {receipts,events,trusted}=configFixture();assert.equal(receipts[1].userLayers[0].owned.hooks.hook,trusted);assertConfigReceiptBindings({receipts},events);
 for(const mutate of [r=>r.splice(0),r=>r.reverse(),r=>r.push({...r[0],id:9}),r=>r[1].stage='error',r=>r[3].expectedVersion='wrong',r=>r[7].userLayers[0].owned.projectTrust='untrusted',r=>r[5].beforeSha256=sha('drift')]){
  const bad=structuredClone(receipts);mutate(bad);assert.throws(()=>assertConfigReceiptBindings({receipts:bad},events));
 }
 assert.throws(()=>assertConfigReceiptBindings({receipts},events.slice(1)));
 assert.throws(()=>configReceiptProjection({definitions:[{key:'hook'}]},{stage:'response',id:1,method:'config/read',result:{layers:[{name:{type:'user',file:path.join(process.env.USERPROFILE,'.codex/config.toml')},config:{hooks:{state:{hook:{trusted_hash:'bad'}}}}}]}}));
});

function phaseConfigFixture(){
 const fixture=path.join(os.tmpdir(),'agent-harness-v2-live-config-test'),projectKey=fixture.toLowerCase(),filePath=path.join(process.env.USERPROFILE,'.codex/config.toml');
 const definitions=Array.from({length:6},(_,index)=>({key:'hook-'+index,currentHash:'sha256:'+sha('hook-'+index)}));
 const report={fixture,projectKey,definitions,projectTrustPersisted:true};
 const initial={projects:{},hooks:{state:{}}},enrolled={...initial,projects:{[projectKey]:{trust_level:'trusted'}}},trusted={...enrolled,hooks:{state:Object.fromEntries(definitions.map(({key,currentHash})=>[key,{trusted_hash:currentHash}]))}};
 const raw={initial:sha('initial'),enrolled:sha('enrolled'),trusted:sha('trusted'),removed:sha('removed')};
 const records={};
 function capture(label,projectionReport,before,after,beforeRaw,afterRaw,editPaths){
  const receipts=[];
  const read=(id,config,version,rawHash)=>{
   receipts.push(configReceiptProjection(projectionReport,{stage:'request',id,method:'config/read',params:{includeLayers:true}}));
   receipts.push(configReceiptProjection(projectionReport,{stage:'response',id,method:'config/read',result:{layers:[{name:{type:'user',file:filePath},version,config}]}}));
   receipts.push({stage:'raw-boundary',id,method:'config/read',beforeSha256:rawHash,afterSha256:rawHash,readStable:true});
  };
  read(1,before,'v1',beforeRaw);
  if(editPaths){
   const edits=editPaths.map(keyPath=>({keyPath,mergeStrategy:'replace',value:keyPath==='projects'?(after.projects??{}):(after.hooks?.state??{})}));
   receipts.push(configReceiptProjection(projectionReport,{stage:'request',id:2,method:'config/batchWrite',params:{filePath,expectedVersion:'v1',reloadUserConfig:true,edits}}));
   receipts.push(configReceiptProjection(projectionReport,{stage:'response',id:2,method:'config/batchWrite',result:{status:'ok'}}));
   receipts.push({stage:'raw-boundary',id:2,method:'config/batchWrite',beforeSha256:beforeRaw,afterSha256:afterRaw,readStable:null});read(3,after,'v2',afterRaw);
  }
  records[label]={receipts};return receipts.filter(receipt=>receipt.stage==='response'&&receipt.method==='config/read').map(receipt=>receipt.userLayers[0]);
 }
 const enrollment=capture('before-enrollment',{...report,definitions:[]},initial,enrolled,raw.initial,raw.enrolled,['projects']);
 const review=capture('reviewed-readback',report,trusted,null,raw.trusted,null);
 const cleanup=capture('cleanup-readback',report,trusted,initial,raw.trusted,raw.removed,['hooks.state','projects']);
 report.nativeConfigBeforeHash=enrollment[0].semanticSha256;report.unrelatedBeforeHash=enrollment[0].unrelatedSha256;report.unrelatedEnrolledHash=review[0].unrelatedSha256;
 report.cleanup={nativeOwnedChangesRemoved:true,freshReadback:true,unrelatedBeforeHash:cleanup[0].unrelatedSha256,unrelatedAfterHash:cleanup[1].unrelatedSha256,finalConfigHash:cleanup[1].semanticSha256};
 report.fixtureSyncConfigObservation={beforeRawSha256:raw.enrolled,afterRawSha256:raw.trusted,internalExpectedVersionObserved:false,internalWriteReceiptObserved:false};
 return {report,records};
}

test('native config phase plans bind enrollment, all six reviewed hashes, and removal readbacks',()=>{
 const fixture=phaseConfigFixture();assertConfigPhaseBindings(fixture.report,fixture.records);
 const unrelatedChange=structuredClone(fixture),changed=sha('current unrelated state');
 for(const index of [1,7])unrelatedChange.records['cleanup-readback'].receipts[index].userLayers[0].unrelatedSha256=changed;
 unrelatedChange.report.cleanup.unrelatedBeforeHash=changed;unrelatedChange.report.cleanup.unrelatedAfterHash=changed;assertConfigPhaseBindings(unrelatedChange.report,unrelatedChange.records);
 for(const mutate of [
  f=>f.records['before-enrollment'].receipts=f.records['before-enrollment'].receipts.slice(0,3),
  f=>f.records['reviewed-readback'].receipts[1].userLayers[0].owned.hooks['hook-0']=null,
  f=>f.records['reviewed-readback'].receipts[1].userLayers[0].owned.projectTrust=null,
  f=>f.records['cleanup-readback'].receipts=f.records['cleanup-readback'].receipts.slice(0,3),
  f=>{const receipts=f.records['cleanup-readback'].receipts;receipts[3].edits.reverse();},
  f=>{const receipts=f.records['cleanup-readback'].receipts;receipts[3].edits[0].owned.hooks['hook-0']=f.report.definitions[0].currentHash;receipts[7].userLayers[0].owned.hooks['hook-0']=f.report.definitions[0].currentHash;},
  f=>f.report.definitions[0].currentHash='sha256:'+sha('changed'),
  f=>f.report.cleanup.finalConfigHash=sha('wrong final semantic state'),
  f=>f.report.unrelatedEnrolledHash=sha('unrelated drift'),
  f=>f.report.projectKey='wrong fixture'
 ]){const bad=structuredClone(fixture);mutate(bad);assert.throws(()=>assertConfigPhaseBindings(bad.report,bad.records));}
});

test('native hooks require complete canonical pairs and Stop for the exact completed turn',()=>{
 const fixture=path.join(os.tmpdir(),'agent-harness-v2-live-test'),worker={threadId:'worker',turn:{id:'turn',status:'completed'}},definitions=['userPromptSubmit','preToolUse','postToolUse','stop'].map((eventName,displayOrder)=>({eventName,displayOrder}));
 const stream=[];
 for(const definition of definitions){const name=definition.eventName.replace(/[A-Z]/g,char=>'-'+char.toLowerCase()),run={id:`${name}:${definition.displayOrder}:${path.join(fixture,'.codex/hooks.json')}`,eventName:definition.eventName,sourcePath:path.join(fixture,'.codex/hooks.json'),status:'completed'};for(const method of ['hook/started','hook/completed'])stream.push({kind:'notification',method,eventIndex:stream.length,threadId:worker.threadId,turnId:worker.turn.id,run:{...run}});}
 stream.push({kind:'notification',method:'turn/completed',eventIndex:stream.length,threadId:worker.threadId,turn:worker.turn});assert.equal(assertNativeHookPairs(worker,stream,definitions,fixture).length,4);
 for(const mutate of [s=>s[7].turnId='wrong',s=>s[7].run.id='unreviewed',s=>s.splice(6,1),s=>s.push({...s[7],eventIndex:9}),s=>s[1].eventIndex=0,s=>s.forEach((event,index)=>event.eventIndex=String(index%2)),s=>delete s[0].eventIndex,s=>{delete s[0].kind;delete s[0].eventIndex;},s=>s[0].eventIndex='invalid',s=>s[0].eventIndex=-1]){const bad=structuredClone(stream);mutate(bad);assert.throws(()=>assertNativeHookPairs(worker,bad,definitions,fixture));}
 const proof={code:0,signal:null,treePids:[1,2],treeAbsent:true},event={kind:'confirmedTermination',at:'now',providerEnvironmentSanitized:true,...proof},report={terminations:[{label:'worker-a',...proof}]};
 assertConfirmedTermination(report,'worker-a',[event]);assert.throws(()=>assertConfirmedTermination({...report,terminations:[...report.terminations,...report.terminations]},'worker-a',[event]));assert.throws(()=>assertConfirmedTermination(report,'worker-a',[{...event,treePids:[1]}]));
});

test('pinned Windows SOURCE authority remains genuine after root helper creation and LIVE003 plan has eleven commands',async()=>{
  const authority=await verifyWindowsContainmentGate();
  assert.equal(authority.sourceDigest,'c2a5be3544cb1b7da9444c589f05b6e9dfe22103349e25e1ae223a2eb9278877');
  assert.equal(sha(stable(await snapshot(sourceRoot))),authority.sourceDigest);
  const config=JSON.parse(await readFile(path.join(sourceRoot,'.harness/config.json'),'utf8'));
  const shape=futureShapes['native-hook-v2-live-003'];
  const plan=expectedPlan({config,feature:{shape,contract:{scopeBaselineHash:'fixture'}},bindings:{configHash:sha(stable(config))},attempts:0});
  assert.equal(plan.executions.length,11);
  assert.deepEqual(plan.requiredLayers.map(item=>item.id),['quick','architecture','full']);
  assert.deepEqual(plan.executions.filter(item=>item.kind==='acceptance').map(item=>item.command),shape.acceptance.map(item=>item.command));
  assert.equal(plan.executionPolicy.attemptBudget.globalMaxAttempts,5);
});

// Test-only loader probes retain the real ESM import graph. They stop at the
// former self-import boundary before any native session, ledger, or config write.
const entrypointProbeLoader = String.raw`
export async function load(url,context,nextLoad) {
  const loaded=await nextLoad(url,context);
  if(!url.endsWith('/scripts/live003-windows-containment-e2e.mjs')&&!url.endsWith('/scripts/verify-live003-windows-containment-e2e.mjs')&&!url.endsWith('/scripts/live003-windows-containment-gate.mjs'))return loaded;
  let source=String(loaded.source);
  const marker='LIVE003_IMPORT_BOUNDARY_REACHED';
  const stop="process.stdout.write('"+marker+"\\n');throw new Error('"+marker+"');";
  if(url.endsWith('/scripts/live003-windows-containment-e2e.mjs')) {
    if(process.env.LIVE003_TEST_PROBE==='render') {
      const discovery=source.match(/const fixtureCanonical=await (canonicalCodexHooks\([^)]*\))/);
      const recovery=source.match(/const canonical=await (canonicalCodexHooks\([^)]*\));\s*assert.deepEqual\(await json\(path.join\(ledger.fixture/);
      if(!discovery||!recovery)throw new Error('Missing actual recovery render callsites');
      source+='\nexport async function probeRecoveryRenderRoots(ledger){return Promise.all(['+discovery[1]+','+recovery[1]+']);}\n';
    } else {
      const boundary="assertConfirmedTermination(report,'before-enrollment',events);";
      if(!source.includes(boundary))throw new Error('Missing actual recovery import boundary');
      const cycle=process.env.LIVE003_TEST_PROBE==='old-recovery'?"await import('./verify-live003-windows-containment-e2e.mjs');":'';
      source=source.replace(boundary,boundary+cycle+stop);
    }
  } else if(url.endsWith('/scripts/verify-live003-windows-containment-e2e.mjs')) {
    const boundary='await authenticateSuccessorSelection();';
    const position=source.lastIndexOf(boundary);
    if(position<0)throw new Error('Missing verifier dispatch preflight');
    // Drive the real recovery boundary from the direct verifier's TLA dispatch.
    source=source.slice(0,position)+"await (await import('./live003-windows-containment-e2e.mjs')).runPhase('recover-preparing');"+source.slice(position+boundary.length);
  } else {
    for(const signature of ['export async function runSourceGate() {','export async function verifySourceGate(relative = gatePath, reportSelection) {']) {
      if(!source.includes(signature))throw new Error('Missing actual gate dispatch');
      source=source.replace(signature,signature+'\n await nativeVerifier();'+stop);
    }
    if(process.env.LIVE003_TEST_PROBE==='old-gate') {
      const start=source.lastIndexOf('async function runCli() {');
      const tail=source.slice(start),branch=tail.indexOf('if (process.argv[1]');
      if(start<0||branch<0)throw new Error('Missing cycle-safe gate CLI dispatch');
      const body=tail.slice('async function runCli() {'.length,branch).trim();
      const condition=tail.slice(branch,tail.indexOf('{',branch));
      source=source.slice(0,start)+condition+'{\n'+body.slice(0,-1)+'\n}\n';
    }
  }
  return {...loaded,source};
}
`;

const probeEnvironment = mode => Object.fromEntries(
  ['PATH','PATHEXT','SystemRoot','SYSTEMROOT','WINDIR','USERPROFILE','HOME','APPDATA','LOCALAPPDATA','TEMP','TMP','CODEX_THREAD_ID']
    .filter(name=>process.env[name]!==undefined).map(name=>[name,process.env[name]])
    .concat([['LIVE003_TEST_PROBE',mode]]));

function runEntrypointProbe(loader,args,mode='current') {
  const started=Date.now();
  const result=spawnSync(process.execPath,['--experimental-loader',pathToFileURL(loader).href,...args],
    {cwd:sourceRoot,env:probeEnvironment(mode),encoding:'utf8',timeout:20000,windowsHide:true});
  return {args,mode,status:result.status,signal:result.signal,error:result.error?.code??null,
    elapsedMs:Date.now()-started,stdout:result.stdout??'',stderr:result.stderr??''};
}

test('actual direct recovery, verifier, and both gate entrypoints reach their former import boundary before native writes',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'live003-entrypoint-probe-'));
  try {
    const loader=path.join(root,'probe-loader.mjs');await writeFile(loader,entrypointProbeLoader);
    const cases=[
      ['scripts/live003-windows-containment-e2e.mjs','--phase','recover-preparing','--report',originalReport],
      ['scripts/verify-live003-windows-containment-e2e.mjs','--report',originalReport],
      ['scripts/live003-windows-containment-gate.mjs','run','--report',selectedReport],
      ['scripts/live003-windows-containment-gate.mjs','authenticate','--report',selectedReport]
    ];
    for(const args of cases) {
      const result=runEntrypointProbe(loader,args);t.diagnostic(JSON.stringify(result));
      assert.equal(result.error,null);assert.equal(result.signal,null);assert.equal(result.status,1);
      assert.match(result.stdout,/LIVE003_IMPORT_BOUNDARY_REACHED/);
      assert.doesNotMatch(result.stderr,/unsettled top-level await/i);
    }
    // These controls show that the probes catch each original self-wait, rather
    // than passing merely because a preflight rejects argv or missing pins.
    for(const [args,mode] of [[cases[0],'old-recovery'],[cases[2],'old-gate']]) {
      const result=runEntrypointProbe(loader,args,mode);t.diagnostic(JSON.stringify(result));
      assert.equal(result.error,null);assert.equal(result.status,13);
      assert.doesNotMatch(result.stdout,/LIVE003_IMPORT_BOUNDARY_REACHED/);
      assert.match(result.stderr,/unsettled top-level await/i);
    }
  } finally {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    await rm(root,{recursive:true,force:true});
  }
});

test('both actual recovery rendering expressions use the source kit while discovery retains the initialized fixture',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'live003-render-root-probe-'));
  try {
    const loader=path.join(root,'probe-loader.mjs');await writeFile(loader,entrypointProbeLoader);
    const program=`import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import path from 'node:path';
      import {probeRecoveryRenderRoots,sourceRoot} from './scripts/live003-windows-containment-e2e.mjs';
      import {canonicalCodexHooks} from './skill/codex-harness/scripts/lib/hook-policy.mjs';
      const report=JSON.parse(await readFile(${JSON.stringify(originalReport)},'utf8'));
      await assert.rejects(()=>canonicalCodexHooks(report.fixture),error=>error.code==='ENOENT');
      const expected=JSON.parse(await readFile(path.join(report.fixture,'.codex/hooks.json'),'utf8'));
      const rendered=await probeRecoveryRenderRoots({fixture:report.fixture});
      assert.equal(rendered.length,2);for(const actual of rendered)assert.deepEqual(actual,expected);
      console.log(JSON.stringify({status:'canonical-recovery-roots-proven',rendered:rendered.length,fixture:report.fixture,sourceRoot}));`;
    const result=runEntrypointProbe(loader,['--input-type=module','--eval',program],'render');t.diagnostic(JSON.stringify(result));
    assert.equal(result.error,null);assert.equal(result.status,0);assert.match(result.stdout,/canonical-recovery-roots-proven/);
  } finally {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    await rm(root,{recursive:true,force:true});
  }
});
