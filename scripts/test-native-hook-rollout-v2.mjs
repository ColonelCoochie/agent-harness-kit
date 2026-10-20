import assert from 'node:assert/strict';
import test from 'node:test';
import {assertOwner,configWithoutAttempts,unrelatedConfig,digest,authenticateRef,cleanEnvironment,safeFailure,safeTrust,safeTrustLevel} from './native-hook-rollout-v2.mjs';
import {sourceRoot,targets} from './verify-context-rollout.mjs';

test('fresh authority rejects a pending transfer, foreign source actor and occupied peer',()=>{
  const state={phase:'working',handoffId:null,owner:{id:'legitimate-child'}};
  assert.doesNotThrow(()=>assertOwner(sourceRoot,state,'legitimate-child'));
  assert.throws(()=>assertOwner(sourceRoot,state,'other-child'));
  assert.throws(()=>assertOwner(sourceRoot,{...state,handoffId:'pending'},'legitimate-child'));
  assert.throws(()=>assertOwner(sourceRoot,{...state,phase:'awaiting_resume'},'legitimate-child'));
  assert.throws(()=>assertOwner(targets[4],state,'legitimate-child'));
  assert.doesNotThrow(()=>assertOwner(targets[4],{...state,owner:null},'legitimate-child'));
});

test('only maxAttempts is excluded; repeat limit, timeout, agent and commands remain bound',()=>{
  const original={policies:{maxAttempts:3,maxRepeatedFailures:2,commandTimeoutMs:1500000},agents:{enabled:['custom']},verification:{full:['custom-command']}};
  const next=structuredClone(original);next.policies.maxAttempts=5;
  assert.equal(digest(configWithoutAttempts(original)),digest(configWithoutAttempts(next)));
  for(const change of [value=>value.policies.maxRepeatedFailures++,value=>value.policies.commandTimeoutMs++,value=>value.agents.enabled.push('new'),value=>value.verification.full.push('new')]){
    const changed=structuredClone(next);change(changed);
    assert.notEqual(digest(configWithoutAttempts(original)),digest(configWithoutAttempts(changed)));
  }
  assert.equal(original.policies.maxAttempts,3);
});

test('native projection allows owned hashes while binding custom hook state and global settings',()=>{
  const original={hooks:{state:{owned:{trusted_hash:'old',enabled:true},other:{trusted_hash:'keep'}}},projects:{source:{trust_level:'trusted'}},model:'custom'};
  const next=structuredClone(original);next.hooks.state.owned.trusted_hash='new';
  assert.equal(digest(unrelatedConfig(original,['owned'])),digest(unrelatedConfig(next,['owned'])));
  for(const change of [value=>value.hooks.state.owned.enabled=false,value=>value.hooks.state.other.trusted_hash='changed',value=>value.projects.source.trust_level='untrusted',value=>value.model='changed']){
    const changed=structuredClone(next);change(changed);
    assert.notEqual(digest(unrelatedConfig(original,['owned'])),digest(unrelatedConfig(changed,['owned'])));
  }
  assert.equal(original.hooks.state.owned.trusted_hash,'old');
});

test('evidence traversal fails before file read; native environment excludes credentials and identities',async()=>{
  await assert.rejects(authenticateRef({path:'../../outside',sha256:'0'.repeat(64),bytes:0}));
  await assert.rejects(authenticateRef({path:'.harness/native-hook-rollout-v2/../../outside',sha256:'0'.repeat(64),bytes:0}));
  const env=cleanEnvironment();
  assert(!Object.keys(env).some(key=>/KEY|TOKEN|SECRET|CODEX_THREAD|CODEX_SESSION/i.test(key)));
  assert(env.TEMP||env.TMP);
});

test('outward native failures contain only a fixed message, safe code and digest',()=>{
  const native=new Error('private native config payload');native.code='private-code';native.configWriteErrorCode='private-data';
  const safe=safeFailure(native);
  assert.equal(safe.code,'ROLLOUT_SAFE_FAILURE');assert.equal(safe.message,'Rollout stopped safely; inspect authenticated hash-only receipts.');
  assert.match(safe.errorSha256,/^[a-f0-9]{64}$/);assert.equal(safe.configWriteErrorCode,undefined);
  native.code=-32600;native.configWriteErrorCode='configVersionConflict';
  const conflict=safeFailure(native);assert.equal(conflict.code,-32600);assert.equal(conflict.configWriteErrorCode,'configVersionConflict');
  assert.equal(safeFailure(conflict).errorSha256,conflict.errorSha256);
});

test('owned native receipt trust fields reject raw values with fixed diagnostics',()=>{
  for(const valid of [null,'a'.repeat(64),'sha256:'+'a'.repeat(64)])assert.equal(safeTrust(valid),valid);
  for(const invalid of ['private-value',{},2])assert.throws(()=>safeTrust(invalid),{message:'Invalid native trust digest'});
  for(const valid of [null,'trusted','untrusted'])assert.equal(safeTrustLevel(valid),valid);
  for(const invalid of ['private-value',{},2])assert.throws(()=>safeTrustLevel(invalid),{message:'Invalid native project trust enum'});
});
