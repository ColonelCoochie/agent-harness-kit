import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign} from 'node:crypto';
import {pilotIndex,pilotDirectory,validatePilotOwner,validatePilotPlan,pilotNativeState,validatePilotNative,
  validatePilotAudit,pilotClearanceBody} from './fix-nine-rollout-pilot.mjs';
import {targets,featureId} from './fix-nine-rollout-preflight.mjs';
import {canonicalHash} from './fix-nine-rollout-evidence.mjs';
import {reviewPayload,validateReview} from './fix-nine-rollout-deployment.mjs';
import {auditHarness} from '../skill/codex-harness/scripts/lib/core.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));

function fixture() {
  const feature={id:featureId,title:'pilot',description:'bounded',dependencies:[],scope:['scripts/**'],acceptance:['pass'],
    status:'active',attempts:0,contract:{hash:'immutable'},scopeBaselineRef:{sha256:'baseline'}};
  const authority={targets:targets.map((root,index)=>({root,index,planHash:'plan',lifecycle:{features:{features:[clone(feature)]}}})),
    nativeTransitions:[],nativeTrustRows:{},nativeBaseline:{version:'v1',raw:{path:'config.toml',bytes:1,sha256:'a'.repeat(64)},
      unrelatedSha256:'unrelated',semanticSha256:'before',trust:{},definitions:[]},nativeStages:[{completed:-1,semanticSha256:'before'}]};
  for(let index=0;index<11;index++)for(let hook=0;hook<6;hook++) {
    const key=`${index}/${hook}`,before=`before-${key}`,after=`after-${key}`;
    const raw={key,currentHash:after,trustStatus:'trusted',command:{command:key}};
    const definition={root:targets[index],key,currentHash:before,trustStatus:'trusted',enabled:true,definitionSha256:'old'};
    const afterDefinition={...definition,currentHash:after,definitionSha256:canonicalHash(raw)};
    authority.nativeTransitions.push({index,key,before,after,beforeDefinition:definition,afterDefinition,afterRaw:raw});
    authority.nativeTrustRows[key]={trusted_hash:before,retained:'metadata'};
    authority.nativeBaseline.trust[key]=before;authority.nativeBaseline.definitions.push(definition);
  }
  for(let n=0;n<18;n++) {authority.nativeTrustRows[`unrelated-${n}`]={trusted_hash:'keep',retained:'metadata'};authority.nativeBaseline.trust[`unrelated-${n}`]='keep';}
  const state={continuity:{phase:'working',owner:{id:'worker-A'},retiredWorkerIds:[]},features:{features:[clone(feature)]},
    config:{policies:{maxAttempts:5,maxRepeatedFailures:2}}};
  return {authority,state};
}

test('only original Exo index4 is a genuine eight-write pilot and drift fails closed',()=>{
  assert.equal(pilotIndex,4);assert(pilotDirectory.endsWith('/pilot-exo'));
  const {authority}=fixture();const plan={target:targets[4],planHash:'plan',blocked:false,
    operations:Array.from({length:8},(_,n)=>({path:`file-${n}`,action:'write',afterHash:`hash-${n}`}))};
  validatePilotPlan(authority,plan,clone(plan));
  const drift=clone(plan);drift.operations[0].afterHash='changed';assert.throws(()=>validatePilotPlan(authority,plan,drift));
  const noop={...plan,operations:plan.operations.map(row=>({...row,action:'preserve'}))};assert.throws(()=>validatePilotPlan(authority,noop,noop));
});

test('material seal survives authentic owner transfer while live authorization and contracts remain enforced',()=>{
  const {authority,state}=fixture();validatePilotOwner(state,authority,'worker-A');
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');const body={authority:'immutable',scope:'exo-index-4-only'};
  const seal={version:1,kind:'execution-authority',body,verdict:'CONTINUE',signature:sign(null,reviewPayload('execution-authority',body),privateKey).toString('base64')};
  state.continuity.owner={id:'worker-B'};state.continuity.retiredWorkerIds=['worker-A'];
  validateReview(seal,'execution-authority',body,publicKey);validatePilotOwner(state,authority,'worker-B');
  assert.throws(()=>validatePilotOwner(state,authority,'worker-A'));
  for(const mutate of [s=>s.continuity.phase='awaiting_resume',s=>s.features.features[0].contract.hash='drift',
    s=>s.config.policies.maxAttempts=6,s=>s.features.features[0].attempts=5]) {
    const bad=clone(state);mutate(bad);assert.throws(()=>validatePilotOwner(bad,authority,'worker-B'));
  }
  assert.throws(()=>validateReview(seal,'execution-authority',{...body,scope:'all'},publicKey));
});

test('native pilot changes only six Exo rows, preserving 78 rows and full metadata',()=>{
  const {authority}=fixture(),config={hooks:{state:clone(authority.nativeTrustRows)}};
  const state=pilotNativeState(authority,config);
  assert.equal(Object.keys(state).filter(key=>state[key].trusted_hash!==config.hooks.state[key].trusted_hash).length,6);
  for(const [key,row]of Object.entries(state))assert.equal(row.retained,'metadata');
  const before={...clone(authority.nativeBaseline)};validatePilotNative(before,authority,'before');
  const observed=clone(before);observed.definitions=authority.nativeTransitions.map(row=>row.index!==4?row.beforeDefinition:
    {...row.afterDefinition,trustStatus:'modified',definitionSha256:canonicalHash({...row.afterRaw,trustStatus:'modified'})});
  validatePilotNative(observed,authority,'observed','before');
  const after={...clone(before),version:'v2',semanticSha256:'after',trust:Object.fromEntries(Object.entries(state).map(([key,row])=>[key,row.trusted_hash])),
    definitions:authority.nativeTransitions.map(row=>row.index===4?row.afterDefinition:row.beforeDefinition)};
  validatePilotNative(after,authority,'after','after');
  for(const mutate of [x=>x.trust['0/0']='changed',x=>x.definitions[0].enabled=false,x=>x.unrelatedSha256='changed',
    x=>x.semanticSha256='drift',x=>x.definitions.pop()]) {const bad=clone(after);mutate(bad);assert.throws(()=>validatePilotNative(bad,authority,'after','after'));}
  config.hooks.state['unrelated-0'].retained='changed';assert.throws(()=>pilotNativeState(authority,config));
});

test('structural verification uses actual auditHarness result fields',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'exo-pilot-audit-'));
  try {const actual=await auditHarness(root);assert.equal(typeof actual.overall,'number');
    assert.equal(typeof actual.criticalFailures,'number');validatePilotAudit({...actual,overall:95,criticalFailures:0});
    assert.throws(()=>validatePilotAudit({...actual,overall:94,criticalFailures:0}));
    assert.throws(()=>validatePilotAudit({...actual,overall:100,criticalFailures:1}));
  } finally {await rm(root,{recursive:true,force:true});}
});

test('pilot clearance requires a confirmed Exo receipt and independent reviewer',()=>{
  const receipt={confirmed:true,index:4,root:targets[4],holdCleared:false,actor:'executor',originalAuthority:{sha256:'authority'},review:{sha256:'review'}};
  assert.equal(pilotClearanceBody({sha256:'receipt'},receipt,'reviewer').scope,'exo-index-4-only-after-confirmed-pilot-and-current-startup');
  assert.throws(()=>pilotClearanceBody({},receipt,'executor'));
  assert.throws(()=>pilotClearanceBody({},{...receipt,confirmed:false},'reviewer'));
  assert.throws(()=>pilotClearanceBody({},{...receipt,index:2},'reviewer'));
});
