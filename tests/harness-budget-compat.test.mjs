import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile, rm, symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {initHarness, auditHarness} from '../skill/codex-harness/scripts/lib/core.mjs';

const exec = promisify(execFile);
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a.localeCompare(b))) : item);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(stable(value));
const pass = 'node -e "process.exit(0)"';
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
async function fixture(maxAttempts=23) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'budget-compat-'));
  await save(path.join(root,'package.json'), {name:'budget-compat-fixture',scripts:{test:pass,lint:pass}});
  await writeFile(path.join(root,'README.md'),'# Budget compatibility fixture\n');
  await initHarness(root,{name:'budget-compat-fixture',purpose:'Verify immutable historical budgets.'});
  const configPath = path.join(root,'.harness/config.json');
  const config = await json(configPath);
  config.verification = {quick:[],full:[{name:'fixture',command:pass}],architecture:[],e2e:[],clean:[]};
  config.policies.maxAttempts=5; config.policies.maxRepeatedFailures=2;
  await save(configPath,config);
  for (const args of [['init'],['config','user.email','fixture@example.test'],['config','user.name','Fixture'],['add','.'],['commit','-m','fixture']]) await exec('git',args,{cwd:root,windowsHide:true});
  const run = (...args) => exec(process.execPath,[path.join(root,'.harness/run.mjs'),...args],{cwd:root,windowsHide:true,env:{...process.env,CODEX_THREAD_ID:'budget-compat-fixture-worker',CODEX_SESSION_ID:'fixture-root'}});
  await run('claim');
  const add = (id, command=pass) => run('add',id,'--title',id,'--description','Budget integrity fixture.','--criterion','The behavior passes.','--command',command,'--allow','**');
  await add('maintenance'); await run('start','maintenance'); await run('verify','maintenance');
  await add('historical','node -e "process.exit(require(\'node:fs\').existsSync(\'ready\')?0:1)"');
  await run('start','historical'); await assert.rejects(run('verify','historical'));
  const statePath=path.join(root,'.harness/features.json');
  const state=await json(statePath), feature=state.features.find(item=>item.id==='historical'), maintenance=state.features.find(item=>item.id==='maintenance');
  const evidencePath=path.join(root,feature.evidence[0]);
  const record=await json(evidencePath);
  assert.equal(record.schemaVersion,5);assert.equal(record.verificationPlan.schemaVersion,2);
  record.schemaVersion=4;record.verificationPlan.schemaVersion=1;record.verificationPlan.evidenceSchemaVersion=4;
  delete record.verificationPlan.executionPolicy.attemptBudget;delete record.attempt;
  record.verificationHash=hash(record.verificationPlan); await save(evidencePath,record);
  const previousContract=structuredClone(feature.contract);
  feature.verificationBudget={maxAttempts};
  feature.contract.snapshot.verificationBudget={maxAttempts};
  feature.contract.hash=hash({contract:feature.contract.snapshot,scopeBaselineHash:feature.contract.scopeBaselineHash});
  const refs=async refs=>Promise.all(refs.map(async reference=>({reference,hash:sha(await readFile(path.join(root,reference)))})));
  const revision={version:2,at:new Date().toISOString(),actor:'historical-fixture-worker',reason:'Historical authorized budget repair',additionalAttempts:maxAttempts===23?18:1,previousRevisionHash:null,previousContract,scopeBaselineRef:feature.scopeBaselineRef,previousEvidence:await refs(feature.evidence),maintenanceReceipts:[{featureId:'maintenance',evidence:await refs(maintenance.evidence)}],attempts:1,repeatedFailures:1,addedAllow:[],nextContractHash:feature.contract.hash};
  revision.hash=hash(revision);feature.budgetRevisions=[revision];await save(statePath,state);
  return {root,run,statePath,state,feature,evidencePath,record,revision};
}

test('signed historical owner objects authenticate only bounded regular-file receipt formats', async t=>{
  const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));
  const maintenance=f.state.features.find(item=>item.id==='maintenance');
  const maintenancePath=path.join(f.root,maintenance.evidence[0]);
  const currentMaintenance=await json(maintenancePath);
  const receipts=[...f.revision.previousEvidence,...f.revision.maintenanceReceipts.flatMap(item=>item.evidence)];
  const modeHash=(bytes,mode='100644')=>createHash('sha256').update(mode+'\0').update(bytes).digest('hex');
  const seal=revision=>{delete revision.hash;revision.hash=hash(revision);};
  const owner={id:'historical-maintenance-worker',source:'CODEX_THREAD_ID',parentSessionId:'historical-parent',generation:21,claimedAt:'2026-10-16T02:50:41.050Z',featureId:'maintenance'};
  f.revision.actor=owner;
  for(const receipt of receipts){
    const file=path.join(f.root,receipt.reference),record=await json(file);
    if(record.schemaVersion===5){
      record.schemaVersion=4;record.verificationPlan.schemaVersion=1;record.verificationPlan.evidenceSchemaVersion=4;
      delete record.verificationPlan.executionPolicy.attemptBudget;delete record.attempt;
      record.verificationHash=hash(record.verificationPlan);await save(file,record);
    }
    receipt.hash=modeHash(await readFile(file));
  }
  seal(f.revision);await save(f.statePath,f.state);
  const pristine=structuredClone(f.state), bytes=new Map(await Promise.all(receipts.map(async item=>[item.reference,await readFile(path.join(f.root,item.reference))])));
  const restore=async()=>{await save(f.statePath,pristine);for(const [reference,content] of bytes)await writeFile(path.join(f.root,reference),content);};
  const check=async(expected,label)=>{
    const doctor=await f.run('doctor').then(()=>true,()=>false),audit=await auditHarness(f.root);
    assert.equal(doctor,expected,`${label}: generated runtime`);assert.equal(audit.criticalFailures===0,expected,`${label}: reusable audit`);
  };
  await t.test('100644 receipts preserve the signed owner and exact evidence bytes',async()=>{
    const before=await readFile(f.statePath);await check(true,'100644');assert.deepEqual(await readFile(f.statePath),before);
    for(const [reference,content] of bytes)assert.deepEqual(await readFile(path.join(f.root,reference)),content);
  });
  const mutate=async(name,change,expected=false)=>t.test(name,async()=>{
    await restore();const state=structuredClone(pristine),feature=state.features.find(item=>item.id==='historical'),revision=feature.budgetRevisions[0];
    await change({state,feature,revision});seal(revision);await save(f.statePath,state);await check(expected,name);
  });
  await mutate('100755 historical regular-file receipts are supported',async({revision})=>{
    for(const ref of [...revision.previousEvidence,...revision.maintenanceReceipts.flatMap(item=>item.evidence)])ref.hash=modeHash(await readFile(path.join(f.root,ref.reference)),'100755');
  },true);
  await mutate('explicit attestation and null metadata retain the exact historical owner union',({revision})=>{revision.actor={...owner,source:'explicit-attestation',parentSessionId:null,featureId:null,generation:0};},true);
  await mutate('raw receipts retain their original authentication',async({revision})=>{
    for(const ref of [...revision.previousEvidence,...revision.maintenanceReceipts.flatMap(item=>item.evidence)])ref.hash=sha(await readFile(path.join(f.root,ref.reference)));
  },true);
  await mutate('string actors do not enable mode-prefixed hashes',({revision})=>{revision.actor='current-string-owner';});
  for(const [field,value] of [['extra',true],['id','bad id'],['source','CODEX_SESSION_ID'],['parentSessionId',''],['generation',-1],['generation',1.5],['claimedAt','invalid'],['featureId','../historical']]){
    await mutate(`owner ${field}=${String(value)} is rejected after rehash`,({revision})=>{revision.actor[field]=value;});
  }
  await mutate('missing owner metadata is rejected after rehash',({revision})=>{delete revision.actor.parentSessionId;});
  await t.test('the original owner object remains part of the signed revision',async()=>{
    await restore();const state=structuredClone(pristine);state.features.find(item=>item.id==='historical').budgetRevisions[0].actor.generation++;
    await save(f.statePath,state);await check(false,'unsigned owner change');
  });
  await mutate('changed evidence bytes fail the stored receipt',async()=>{await writeFile(f.evidencePath,Buffer.concat([bytes.get(f.feature.evidence[0]),Buffer.from('\n')]));});
  await mutate('unsupported file mode is rejected',async({revision})=>{revision.previousEvidence[0].hash=modeHash(await readFile(f.evidencePath),'100600');});
  await mutate('current evidence cannot use the historical mode digest',async({revision})=>{
    await save(maintenancePath,currentMaintenance);revision.maintenanceReceipts[0].evidence[0].hash=modeHash(await readFile(maintenancePath));
  });
  await mutate('authenticated embedded plan changes still fail semantics',async({revision})=>{
    const record=await json(f.evidencePath);record.verificationPlan.feature.id='other';record.verificationHash=hash(record.verificationPlan);await save(f.evidencePath,record);revision.previousEvidence[0].hash=modeHash(await readFile(f.evidencePath));
  });
  await mutate('authenticated evidence with unknown contract fails',async({revision})=>{
    const record=await json(f.evidencePath);record.contractHash='a'.repeat(64);await save(f.evidencePath,record);revision.previousEvidence[0].hash=modeHash(await readFile(f.evidencePath));
  });
  await mutate('schema4 with plan2 cannot use historical digests',async({revision})=>{
    const record=await json(f.evidencePath);record.verificationPlan.schemaVersion=2;record.verificationHash=hash(record.verificationPlan);await save(f.evidencePath,record);revision.previousEvidence[0].hash=modeHash(await readFile(f.evidencePath));
  });
  await mutate('traversal references fail containment',({feature,revision})=>{feature.evidence[0]='.harness/evidence/../evidence/escape.json';revision.previousEvidence[0].reference=feature.evidence[0];});
  await mutate('self maintenance receipts fail',({revision})=>{revision.maintenanceReceipts[0].featureId='historical';});
  await mutate('duplicate maintenance receipts fail',({revision})=>{revision.maintenanceReceipts.push(structuredClone(revision.maintenanceReceipts[0]));});
  await mutate('duplicate historical evidence fails cumulative history',({feature,revision})=>{feature.evidence.push(feature.evidence[0]);revision.previousEvidence.push(structuredClone(revision.previousEvidence[0]));revision.attempts=2;});
  await mutate('a rehashed broken revision chain fails',({revision})=>{revision.previousRevisionHash='b'.repeat(64);});
  await mutate('mode-prefixed baseline hashes are never accepted',async({revision,feature})=>{
    const baselineBytes=await readFile(path.join(f.root,revision.scopeBaselineRef.path));
    revision.scopeBaselineRef.sha256=modeHash(baselineBytes);revision.scopeBaselineRef.path=`.harness/baselines/${revision.scopeBaselineRef.sha256}.json`;
    feature.scopeBaselineRef=structuredClone(revision.scopeBaselineRef);await writeFile(path.join(f.root,revision.scopeBaselineRef.path),baselineBytes);
  });
  await t.test('symbolic-link evidence is rejected',async child=>{
    await restore();const alias='.harness/evidence/legacy-symlink.json';
    try{await symlink(f.evidencePath,path.join(f.root,alias),'file');}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){child.skip(`Host cannot create fixture symlink: ${error.code}`);return;}throw error;}
    const state=structuredClone(pristine),feature=state.features.find(item=>item.id==='historical'),revision=feature.budgetRevisions[0];feature.evidence[0]=alias;revision.previousEvidence[0].reference=alias;seal(revision);await save(f.statePath,state);await check(false,'symlink');
  });
});

test('historical budget contracts preserve raw hashes, enforce current caps, and authenticate every plan and receipt', async t=>{
  const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));
  const check=async expected=>{
    const doctor=await f.run('doctor').then(()=>true,()=>false);
    const audit=await auditHarness(f.root);
    assert.equal(doctor,expected);assert.equal(audit.criticalFailures===0,expected);
  };
  await t.test('unchanged historical evidence4/plan1 and revision are valid',()=>check(true));
  const pristine=structuredClone(f.state);
  const restore=async()=>{await save(f.statePath,pristine);await save(f.evidencePath,f.record);};
  const mutate=async(name,change)=>t.test(name,async()=>{await restore();const state=structuredClone(pristine);const feature=state.features.find(item=>item.id==='historical');await change(feature,state);await save(f.statePath,state);await check(false);});
  await mutate('extra budget fields fail exact shape',feature=>{feature.verificationBudget.extra=true;});
  for (const value of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'23',null]) await mutate(`invalid budget ${String(value)} fails`,feature=>{feature.verificationBudget={maxAttempts:value};});
  await mutate('missing revision does not authorize a budget',feature=>{delete feature.budgetRevisions;});
  await mutate('revision raw hash mismatch fails',feature=>{feature.budgetRevisions[0].reason='changed';});
  await mutate('revision snapshot tampering fails',feature=>{feature.budgetRevisions[0].previousContract.snapshot.title='changed';});
  await mutate('receipt escape fails even after revision rehash',feature=>{const r=feature.budgetRevisions[0];r.maintenanceReceipts[0].evidence[0].reference='../outside.json';delete r.hash;r.hash=hash(r);});
  await mutate('self receipt fails even after revision rehash',feature=>{const r=feature.budgetRevisions[0];r.maintenanceReceipts[0].featureId=feature.id;delete r.hash;r.hash=hash(r);});
  await mutate('failed historical embedded plan is checked before early returns',async feature=>{const record=structuredClone(f.record);record.verificationPlan.feature.title='changed';record.verificationHash=hash(record.verificationPlan);await save(f.evidencePath,record);const r=feature.budgetRevisions[0];r.previousEvidence[0].hash=sha(await readFile(f.evidencePath));delete r.hash;r.hash=hash(r);});
  await mutate('evidence4 cannot carry a plan2 downgrade',async feature=>{const record=structuredClone(f.record);record.verificationPlan.schemaVersion=2;record.verificationHash=hash(record.verificationPlan);await save(f.evidencePath,record);const r=feature.budgetRevisions[0];r.previousEvidence[0].hash=sha(await readFile(f.evidencePath));delete r.hash;r.hash=hash(r);});
  await restore();await writeFile(path.join(f.root,'ready'),'ready\n');
  await f.run('verify','historical');
  const current=(await json(f.statePath)).features.find(item=>item.id==='historical');
  const record=await json(path.join(f.root,current.evidence.at(-1)));
  assert.equal(record.schemaVersion,5);assert.equal(record.verificationPlan.schemaVersion,2);assert.equal(record.attempt,2);
  assert.deepEqual(record.verificationPlan.executionPolicy.attemptBudget,{version:1,globalMaxAttempts:5,featureMaxAttempts:23,effectiveMaxAttempts:5,attemptsBefore:1});
  assert.equal(current.verificationBudget.maxAttempts,23);assert.equal(current.budgetRevisions[0].hash,f.revision.hash);assert.equal(current.evidence[0],f.feature.evidence[0]);
  await check(true);
  await t.test('second scope-only revision authenticates cumulative evidence by its own frozen contracts',async()=>{
    const state=await json(f.statePath);const target=state.features.find(item=>item.id==='historical');
    const previousContract=structuredClone(target.contract);target.status='active';
    target.contract.snapshot.scope.allow.push('extra/**');target.scope.allow.push('extra/**');
    target.contract.hash=hash({contract:target.contract.snapshot,scopeBaselineHash:target.contract.scopeBaselineHash});
    const revision={...structuredClone(f.revision),additionalAttempts:0,previousRevisionHash:f.revision.hash,previousContract,previousEvidence:await Promise.all(target.evidence.map(async reference=>({reference,hash:sha(await readFile(path.join(f.root,reference)))}))),attempts:2,repeatedFailures:0,addedAllow:['extra/**'],nextContractHash:target.contract.hash};
    delete revision.hash;revision.hash=hash(revision);target.budgetRevisions.push(revision);await save(f.statePath,state);await check(true);await save(f.statePath,{...state,features:state.features.map(item=>item.id==='historical'?current:item)});
  });
  await t.test('scope-only revision rejects already allowed additions without an effective change',async()=>{
    const state=await json(f.statePath);const target=state.features.find(item=>item.id==='historical');target.status='active';
    const revision={...structuredClone(f.revision),additionalAttempts:0,previousRevisionHash:f.revision.hash,previousContract:structuredClone(target.contract),previousEvidence:await Promise.all(target.evidence.map(async reference=>({reference,hash:sha(await readFile(path.join(f.root,reference)))}))),attempts:2,repeatedFailures:0,addedAllow:[target.scope.allow[0]],nextContractHash:target.contract.hash};
    delete revision.hash;revision.hash=hash(revision);target.budgetRevisions.push(revision);await save(f.statePath,state);await check(false);await save(f.statePath,{...state,features:state.features.map(item=>item.id==='historical'?current:item)});
  });
  await t.test('maintenance receipt must include its latest passing evidence',async()=>{
    const state=await json(f.statePath);const maintenance=state.features.find(item=>item.id==='maintenance');
    const file=path.join(f.root,maintenance.evidence[0]),original=await json(file),broken=structuredClone(original);broken.pass=false;await save(file,broken);
    const target=state.features.find(item=>item.id==='historical'),revision=target.budgetRevisions[0];revision.maintenanceReceipts[0].evidence[0].hash=sha(await readFile(file));delete revision.hash;revision.hash=hash(revision);await save(f.statePath,state);await check(false);
    await save(file,original);target.budgetRevisions[0]=structuredClone(f.revision);await save(f.statePath,state);
  });
  const latest=path.join(f.root,current.evidence.at(-1));
  await t.test('schema5 requires exact typed attempt budget',async()=>{const broken=structuredClone(record);broken.verificationPlan.executionPolicy.attemptBudget.attemptsBefore='1';broken.verificationHash=hash(broken.verificationPlan);await save(latest,broken);await check(false);await save(latest,record);});
  await t.test('schema5 rejects stripped attempt budget even after plan rehash',async()=>{const broken=structuredClone(record);delete broken.verificationPlan.executionPolicy.attemptBudget;broken.verificationHash=hash(broken.verificationPlan);await save(latest,broken);await check(false);await save(latest,record);});
  await t.test('schema5 cannot carry historical plan1',async()=>{const broken=structuredClone(record);broken.verificationPlan.schemaVersion=1;broken.verificationHash=hash(broken.verificationPlan);await save(latest,broken);await check(false);await save(latest,record);});
  await t.test('current global cap blocks attempt6 without rewriting history',async()=>{const state=await json(f.statePath);const target=state.features.find(item=>item.id==='historical');target.status='active';target.attempts=5;await save(f.statePath,state);await assert.rejects(f.run('verify','historical'));const after=(await json(f.statePath)).features.find(item=>item.id==='historical');assert.equal(after.attempts,5);assert.deepEqual(after.evidence,target.evidence);assert.equal(after.budgetRevisions[0].hash,f.revision.hash);});
});

test('valid lower legacy cap is enforced independently of current global5',async t=>{
  const f=await fixture(2);t.after(()=>rm(f.root,{recursive:true,force:true}));
  await writeFile(path.join(f.root,'ready'),'ready\n');await f.run('verify','historical');
  const state=await json(f.statePath),feature=state.features.find(item=>item.id==='historical');
  const record=await json(path.join(f.root,feature.evidence.at(-1)));
  assert.deepEqual(record.verificationPlan.executionPolicy.attemptBudget,{version:1,globalMaxAttempts:5,featureMaxAttempts:2,effectiveMaxAttempts:2,attemptsBefore:1});
  feature.status='active';await save(f.statePath,state);await assert.rejects(f.run('verify','historical'));
  const after=(await json(f.statePath)).features.find(item=>item.id==='historical');assert.equal(after.attempts,2);assert.equal(after.evidence.length,2);assert.equal(after.verificationBudget.maxAttempts,2);assert.equal(after.budgetRevisions[0].hash,f.revision.hash);
});
