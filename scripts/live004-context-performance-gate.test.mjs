import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {parseGateArguments,selectedReport} from './live004-context-performance-gate.mjs';
import {parsePhaseArguments,recordedGit,sha,artifactDirectory,preserveFailedPrepare,authenticateRecoveryHistory,assertRecoverablePrepare,authenticateCorrectionLineage,originalFreezePin,nativeReportPin,correctionPredecessorPin} from './live004-context-performance-e2e.mjs';
import {assertConfigPhaseBindings} from './verify-live004-context-performance-e2e.mjs';

test('correction lineage authenticates immutable native proof and every original archive',async()=>{
 const bytes=Buffer.from('original reviewed helper');const original={path:'scripts/live004-context-performance-gate.mjs',bytes:bytes.length,sha256:sha(bytes)};
 const archive={...original,path:'.harness/native-hook-v2-live-004-original-helpers/live004-context-performance-gate.mjs'};
 const predecessor={kind:'independent-context-performance-successor-helper-freeze',outcome:'clean',independentActualCode:true,findings:[],helpers:[original]};
 const report={status:'passed',pending:null,cleanup:{nativeOwnedChangesRemoved:true,freshReadback:true},helperFreeze:originalFreezePin};
 const correctionArchive={...original,path:'.harness/native-hook-v2-live-004-correction-v1-helpers/live004-context-performance-gate.mjs'};
 const correctionProvenance={path:'.harness/correction-provenance.json',bytes:1,sha256:'a'.repeat(64)};
 const freeze={predecessor:originalFreezePin,nativeReport:nativeReportPin,historicalHelpers:[{original,archive}],correctionPredecessor:correctionPredecessorPin,correctionProvenance};
 const correction={...predecessor,predecessor:originalFreezePin,nativeReport:nativeReportPin,historicalHelpers:freeze.historicalHelpers};
 const provenance={kind:'authenticated-correction-predecessor-helper-archives',predecessor:correctionPredecessorPin,historicalHelpers:[{original,archive:correctionArchive}]};
 const read=async ref=>{if(ref.path===correctionPredecessorPin.path){assert.deepEqual(ref,correctionPredecessorPin);return JSON.stringify(correction);}if(ref.path===correctionProvenance.path){assert.deepEqual(ref,correctionProvenance);return JSON.stringify(provenance);}if(ref.path===originalFreezePin.path){assert.deepEqual(ref,originalFreezePin);return JSON.stringify(predecessor);}if(ref.path===nativeReportPin.path){assert.deepEqual(ref,nativeReportPin);return JSON.stringify(report);}assert.deepEqual(ref,ref.path===archive.path?archive:correctionArchive);assert.equal(sha(bytes),ref.sha256);return bytes;};
 assert.deepEqual(await authenticateCorrectionLineage(freeze,{read}),originalFreezePin);
 for(const change of [f=>f.predecessor.sha256='0'.repeat(64),f=>f.nativeReport.bytes++,f=>f.historicalHelpers[0].original.sha256='1'.repeat(64),f=>f.historicalHelpers[0].archive.sha256='2'.repeat(64),f=>f.historicalHelpers[0].archive.path='scripts/elsewhere.mjs',f=>f.historicalHelpers=[]]){const altered=structuredClone(freeze);change(altered);await assert.rejects(authenticateCorrectionLineage(altered,{read}));}
 await assert.rejects(authenticateCorrectionLineage(freeze,{read:async ref=>ref.path===archive.path?Buffer.from('tampered archive'):read(ref)}));
 await assert.rejects(authenticateCorrectionLineage(freeze,{read:async ref=>ref.path===correctionArchive.path?Buffer.from('tampered correction archive'):read(ref)}));
 const altered=structuredClone(freeze);altered.correctionPredecessor.sha256='0'.repeat(64);await assert.rejects(authenticateCorrectionLineage(altered,{read}));
 correction.outcome='unreviewed';await assert.rejects(authenticateCorrectionLineage(freeze,{read}));correction.outcome='clean';
 report.status='native-passed';await assert.rejects(authenticateCorrectionLineage(freeze,{read}));report.status='passed';report.cleanup.freshReadback=false;await assert.rejects(authenticateCorrectionLineage(freeze,{read}));
});

test('scoped enrollment binds its two baseline reads and exact write order',async()=>{
 const report=JSON.parse(await readFile(new URL('../.harness/native-hook-v2-live-004-e2e-report.json',import.meta.url),'utf8'));const records={};
 for(const label of ['before-enrollment','scoped-enrollment','reviewed-readback','cleanup-readback']){const ref=report.artifacts.find(item=>item.path.endsWith('/'+label+'-config-receipts.json'));records[label]=JSON.parse(await readFile(new URL('../'+ref.path,import.meta.url),'utf8'));}
 assert.doesNotThrow(()=>assertConfigPhaseBindings(report,records));
 for(const mutate of [r=>r['scoped-enrollment'].receipts.splice(0,3),r=>r['scoped-enrollment'].receipts[4].userLayers[0].semanticSha256='0'.repeat(64),r=>r['scoped-enrollment'].receipts[4].userLayers[0].version+='-drift',r=>r['scoped-enrollment'].receipts[6].edits[0].keyPath='projects']){const changed=structuredClone(records);mutate(changed);assert.throws(()=>assertConfigPhaseBindings(report,changed));}
});

test('phase parsers require an explicit exclusive LIVE004 report',()=>{
 assert.deepEqual(parseGateArguments(['--phase','verify','--report',selectedReport]),{phase:'verify',report:selectedReport});
 for(const args of [[],['--phase','run','--report','other.json'],['--phase','run','--phase','run'],['--phase','retry','--report',selectedReport]])assert.throws(()=>parseGateArguments(args));
 assert.doesNotThrow(()=>parsePhaseArguments(['--phase','prepare','--report',selectedReport]));assert.throws(()=>parsePhaseArguments(['--phase','prepare','--report','other.json']));
});

test('Git intent and child PID persist before a durable unconfirmed result and assertion',async()=>{
 const report={pending:null,gitControllers:[]},events=[];
 await assert.rejects(recordedGit(report,'git-init',['init'],'fixture',{persist:async value=>events.push({kind:'save',value:structuredClone(value)}),record:async(value,name,proof)=>{events.push({kind:'result',name,proof});return {path:name,bytes:1,sha256:'a'.repeat(64)};},execute:async(command,cwd,env,timeout,{onSpawn})=>{assert.equal(report.pending.pid,null);await onSpawn(123);assert.equal(report.pending.pid,123);return {pid:123,confirmed:false,exitCode:null,timedOut:false,stdout:'',stderr:'controller unavailable',stdoutSha256:sha(''),stderrSha256:sha('controller unavailable'),elapsedMs:12,overflow:false};}}),/unknown/);
 assert.equal(events[0].value.pending.kind,'git');assert.equal(events[1].value.pending.pid,123);assert.equal(events[2].kind,'result');assert.equal(events[2].proof.confirmed,false);assert.equal(report.unknownOutcome,true);assert.equal(report.pending.pid,123);assert.equal(report.gitControllers.length,1);
});

async function failedFixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'live004-recovery-test-'));t.after(async()=>{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert(path.basename(resolved).startsWith('live004-recovery-test-'));await rm(resolved,{recursive:true,force:true});});
 await mkdir(path.join(root,artifactDirectory),{recursive:true});const put=async(relative,value)=>{const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value));await writeFile(path.join(root,relative),bytes);return {path:relative,bytes:bytes.length,sha256:sha(bytes)};};
 const source=await put('.harness/source.json',{sealed:true});const freezeValue={kind:'independent-context-performance-successor-helper-freeze',outcome:'clean',independentActualCode:true,findings:[],sourceGate:source};const freeze=await put('.harness/native-hook-v2-live-004-helper-freeze.json',freezeValue);await put('.harness/native-hook-v2-live-004-helper-freeze-before-recovery.json',freezeValue);
 const artifact=await put(artifactDirectory+'/original.txt','failed bytes');const report={version:1,featureId:'native-hook-v2-live-004',status:'blocked',reportSelection:selectedReport,artifactDirectory,fixture:path.join(root,'fixture'),helperFreeze:freeze,sourceAuthority:{gate:source,evidence:source,transition:source,futureGrant:source},predecessorCleanup:source,artifacts:[],errors:[{phase:'prepare'}],pending:null,terminations:[],policy:{baselineAbsent:true},trustBypass:false,projectTrustOverride:false,manualCompaction:false};
 const reportRef=await put(selectedReport,report),reconciliation={kind:'pre-native-historical-retirement',report:reportRef,helperFreeze:freeze,artifacts:[artifact],fixture:report.fixture,fixtureGitAbsent:true,nativeSuccess:false,originalControllerConfirmed:false,originalProcess:{confirmedCompleteByHost:true,exitCode:1},priorReconciliation:source,inspection:{completeVisibility:true,querySucceeded:true,queryErrorCount:0,matches:[],descendants:[],rawInventorySha256:sha('inventory'),criteria:['all git.exe','cmd.exe quoted git init regardless of working directory','recursive candidate descendants']}};
 const manifest={kind:'actual-failed-file-manifest',report:reportRef,artifacts:[artifact]},reconciliationRef=await put('.harness/reconciliation.json',reconciliation),manifestRef=await put('.harness/manifest.json',manifest);
 return {root,put,report,reportRef,reconciliation,manifest,options:{root,expectedReportSha256:reportRef.sha256,reconciliationRef,manifestRef}};
}

test('explicit recovery archives stale-report artifact closure and never converts history into native success',async t=>{
 const f=await failedFixture(t),raw=await readFile(path.join(f.root,selectedReport));const correctedFreeze=await f.put('.harness/native-hook-v2-live-004-helper-freeze.json',{correctedActiveBytes:true});assert.notEqual(correctedFreeze.sha256,f.report.helperFreeze.sha256);const recovery=await preserveFailedPrepare(f.options),history=await authenticateRecoveryHistory(recovery,{root:f.root});assert.equal(history.archivedFreeze.sha256,f.report.helperFreeze.sha256);assert.equal(history.nativeSuccess,false);assert.equal(history.originalControllerConfirmed,false);assert.equal(history.artifacts.length,1);assert.deepEqual(await readFile(path.join(f.root,selectedReport)),raw);
 await assert.rejects(preserveFailedPrepare(f.options),/EEXIST/);await writeFile(path.join(f.root,history.archivedReport.path),'tampered');await assert.rejects(authenticateRecoveryHistory(recovery,{root:f.root}));
});

test('recovery refuses report CAS drift, actual artifact drift, native activity and incomplete visibility',async t=>{
 const f=await failedFixture(t);await assert.rejects(preserveFailedPrepare({...f.options,expectedReportSha256:'0'.repeat(64)}),/changed/);
 await f.put(artifactDirectory+'/unexpected.txt','drift');await assert.rejects(preserveFailedPrepare(f.options),/closure changed/);
 for(const field of ['nativeSessions','nativeWrites','configReceiptPaths','terminations','gitControllers'])assert.throws(()=>assertRecoverablePrepare({...f.report,[field]:[{}]},f.reconciliation,f.manifest));
 assert.throws(()=>assertRecoverablePrepare(f.report,{...f.reconciliation,inspection:{...f.reconciliation.inspection,completeVisibility:false}},f.manifest));assert.throws(()=>assertRecoverablePrepare({...f.report,policy:{baselineAbsent:true,attempt:{}}},f.reconciliation,f.manifest));
});

test('recovery rejects rehashed unrelated intent and replacement-ready semantics',async t=>{
 const f=await failedFixture(t),recovery=await preserveFailedPrepare(f.options),history=await authenticateRecoveryHistory(recovery,{root:f.root}),originalIntent=JSON.parse(await readFile(path.join(f.root,recovery.intent.path),'utf8'));
 const unrelated=await f.put(recovery.intent.path,{...originalIntent,directory:originalIntent.directory+'-other'}),changedHistory=await f.put(recovery.history.path,{...history,intent:unrelated});await assert.rejects(authenticateRecoveryHistory({...recovery,intent:unrelated,history:changedHistory},{root:f.root}));
 recovery.intent=await f.put(recovery.intent.path,originalIntent);recovery.history=await f.put(recovery.history.path,{...history,intent:recovery.intent});const prefix='.harness/native-hook-v2-live-004-recovery',ready={version:1,featureId:'native-hook-v2-live-004',status:'recovery-ready',reportSelection:selectedReport,artifactDirectory:`${artifactDirectory}-recovery-${recovery.failedReportSha256.slice(0,16)}`,recovery:{...recovery},pending:null,artifacts:[]},proofPath=`${prefix}/replacement-proof-${recovery.failedReportSha256}.json`,outcomePath=`${prefix}/outcome-${recovery.failedReportSha256}.json`;
 const proof=await f.put(proofPath,ready),outcome={version:1,kind:'explicit-prepare-recovery-complete',failedReportSha256:recovery.failedReportSha256,history:recovery.history,intent:recovery.intent,selectedReport,selectedReplacement:proof};recovery.outcome=await f.put(outcomePath,outcome);await authenticateRecoveryHistory(recovery,{root:f.root});
 const changedProof=await f.put(proofPath,{...ready,status:'passed'});recovery.outcome=await f.put(outcomePath,{...outcome,selectedReplacement:changedProof});await assert.rejects(authenticateRecoveryHistory(recovery,{root:f.root}));
});

test('interrupted archival preserves the selected report and its exclusive intent blocks replay',async t=>{
 const f=await failedFixture(t),raw=await readFile(path.join(f.root,selectedReport)),directory=`.harness/native-hook-v2-live-004-recovery/${f.reportRef.sha256}`;
 await mkdir(path.join(f.root,directory),{recursive:true});await f.put(directory+'/preexisting.txt','collision remains');
 await assert.rejects(preserveFailedPrepare(f.options),/EEXIST/);const intent=JSON.parse(await readFile(path.join(f.root,`.harness/native-hook-v2-live-004-recovery/intent-${f.reportRef.sha256}.json`)));assert.equal(intent.expectedReportSha256,f.reportRef.sha256);assert.deepEqual(await readFile(path.join(f.root,selectedReport)),raw);
 await assert.rejects(preserveFailedPrepare(f.options),/EEXIST/);assert.equal((await readFile(path.join(f.root,directory+'/preexisting.txt'),'utf8')),'collision remains');
});

test('recovery rejects a symlink report before reading or creating an intent',async t=>{
 const f=await failedFixture(t),target=path.join(f.root,'target.json');await writeFile(target,await readFile(path.join(f.root,selectedReport)));await rm(path.join(f.root,selectedReport));
 try{await symlink(target,path.join(f.root,selectedReport));}catch(error){if(error.code==='EPERM'){t.skip('Host does not grant file symlink creation');return;}throw error;}
 await assert.rejects(preserveFailedPrepare(f.options),/symlink/);
});

test('recovery CLI needs three explicit expected hashes and fixed selected report',()=>{
 const args=['--phase','recover','--report',selectedReport,'--expected-report-sha256','a'.repeat(64),'--reconciliation','.harness/native-hook-v2-live-004-retirement.json','--reconciliation-sha256','b'.repeat(64),'--manifest','.harness/native-hook-v2-live-004-manifest.json','--manifest-sha256','c'.repeat(64)];assert.equal(parsePhaseArguments(args).phase,'recover');assert.throws(()=>parsePhaseArguments(args.slice(0,-2)));assert.throws(()=>parsePhaseArguments([...args,'--phase','prepare']));assert.throws(()=>parsePhaseArguments(args.map(value=>value==='a'.repeat(64)?'invalid':value)));
});
test('actual helper imports and invalid CLI invocations launch no native session',()=>{
 for(const script of ['live004-context-performance-e2e.mjs','verify-live004-context-performance-e2e.mjs','live004-context-performance-gate.mjs']){
  const imported=spawnSync(process.execPath,['--input-type=module','-e',`await import('./scripts/${script}');console.log('import-safe')`],{cwd:process.cwd(),encoding:'utf8',timeout:10000});assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout.trim(),'import-safe');
  const invalid=spawnSync(process.execPath,[`scripts/${script}`,'--invalid'],{cwd:process.cwd(),encoding:'utf8',timeout:10000});assert.equal(invalid.status,1,invalid.stderr);assert.equal(invalid.stdout,'');assert.match(invalid.stderr,/stopped-safely/);
 }
});
