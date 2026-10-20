import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {initHarness} from '../skill/codex-harness/scripts/lib/core.mjs';
import {authenticatePredecessor, closedInputs, digest, directory, exclusive, featureId, file, futureHelperPaths, futureShapes, json, nodeIdentity, normalizedContract, predecessorPin, reference, root, sourceSnapshot, transitionPath} from './source-context-performance-authority.mjs';

if(process.argv.includes('--help')) {console.log('prepare-context-performance-source: capture the verified current-host capability, normalize future 004 contracts through ordinary isolated CLI, then create the SOURCE transition. No native lifecycle or production writes.');process.exit(0);}
const capabilityPath=`${directory}/host-capability.json`;
const logRef={path:'.harness/logs/tool-7fdc6e8c-4f80-4104-97a6-41f3ba20a9d8.log',bytes:6537,sha256:'574d9d4ea98f741e8da40d3ccc9ea595c57d516f95a6a28867f7b48fe46f37c6'};
assert.deepEqual(await reference(logRef.path),logRef);
const beforeRef=await reference(`${directory}/host-probe-before.json`),before=await json(beforeRef.path);
assert.equal(before.actor,'01a14204-396a-7aa3-9e66-5ae10cb38e7b');
const log=await readFile(file(logRef.path),'utf8');assert(log.includes('AHK_PATCHED_HOST_PROBE_20261016_'+ 'Q'.repeat(6500)));
const capability={version:1,kind:'actual-native-codex-delivered-result-probe',pass:true,actor:before.actor,rawChars:6536,expected:289,delta:289,toolCallsDelta:1,deliveredRaw:false,before:beforeRef,log:logRef,observedBy:before.actor,attestation:'Root directly observed the actual nested exec_command result replaced by the completed-tool suppression notice and immediate actor-only accounting delta with no intervening native tool or replay.',recordedAt:new Date().toISOString()};
await exclusive(capabilityPath,capability);

const fixture=await mkdtemp(path.join(os.tmpdir(),'agent-harness-context-grant-'));
let normalization;
try {
  await initHarness(fixture,{name:'Context performance grant normalization',purpose:'Normalize reviewed successor contracts',commands:'node --version',agents:'codex'});
  const env=Object.fromEntries((await json('.harness/config.json')).security.environmentAllow.filter(name=>process.env[name]!==undefined).map(name=>[name,process.env[name]]));
  env.CODEX_THREAD_ID=`context-performance-grant-${process.pid}`;
  const run=argv=>{const result=spawnSync(process.execPath,['.harness/run.mjs',...argv],{cwd:fixture,env,encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:65536});assert.equal(result.status,0,`${argv[0]}: ${result.stderr.slice(-2000)}`);assert.equal(result.signal,null);return result;};
  run(['claim']);
  run(['add',featureId,'--title','SOURCE prerequisite','--description','Isolated normalization prerequisite','--criterion','SOURCE','--command','node --version','--allow','.harness/**']);
  for(const shape of Object.values(futureShapes)) {
    const argv=['add',shape.id,'--title',shape.title,'--description',shape.description];
    for(const value of shape.dependencies) argv.push('--depends',value);
    for(const value of shape.scope.allow) argv.push('--allow',value);
    for(const value of shape.scope.deny) argv.push('--deny',value);
    for(const value of shape.requiredLayers) argv.push('--level',value);
    for(const item of shape.acceptance) argv.push('--criterion',item.description,'--command',item.command);
    run(argv);
  }
  const state=JSON.parse(await readFile(path.join(fixture,'.harness/features.json'),'utf8'));
  const shapes=Object.fromEntries(Object.keys(futureShapes).map(id=>[id,normalizedContract(state.features.find(item=>item.id===id))]));assert.deepEqual(shapes,futureShapes);
  normalization={version:1,kind:'actual-ordinary-cli-contract-normalization',exitCode:0,shapes,createdAt:new Date().toISOString(),fixtureRemoved:true};
} finally {
  const resolved=path.resolve(fixture);assert(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`) && path.basename(resolved).startsWith('agent-harness-context-grant-'));
  await rm(resolved,{recursive:true,force:true});
}
const normalizationProof=await exclusive(`${directory}/successor-normalization.json`,normalization);
const futureGrant=await exclusive(`${directory}/future-grant.json`,{version:1,predecessor:predecessorPin,helperCreation:futureHelperPaths,contracts:Object.fromEntries(Object.entries(futureShapes).map(([id,shape])=>[id,{shape,sha256:digest(shape)}])),normalizationProof});
const {predecessor}=await authenticatePredecessor(),state=await json('.harness/features.json'),feature=state.features.find(item=>item.id===featureId),old=state.features.find(item=>item.id==='native-hook-v2-live-003');
const source=await sourceSnapshot(),changedPaths=[...new Set([...Object.keys(predecessor.source),...Object.keys(source)])].filter(name=>predecessor.source[name]!==source[name]).sort();
const transition=await exclusive(transitionPath,{version:1,featureId,predecessor:predecessorPin,source,sourceDigest:digest(source),changedPaths,reviewedDelta:changedPaths.map(name=>({path:name,before:predecessor.source[name]??null,after:source[name]??null})),closedInputs:await closedInputs(),node:await nodeIdentity(),config:await reference('.harness/config.json'),frozenContract:{shape:normalizedContract(feature),hash:feature.contract.hash,scopeBaselineHash:feature.contract.scopeBaselineHash,baseline:feature.scopeBaselineRef},authorizedHistoricalBlock:{status:old.status,blocker:old.blocker,updatedAt:old.updatedAt},futureGrant,hostCapability:await reference(capabilityPath),cleanup:await reference('.harness/native-hook-v2-live-003-failed-v3-cleanup/receipt.json'),agePolicy:await reference(`${directory}/age-policy.json`),agePolicyDecision:await reference(`${directory}/age-policy-decision.json`),createdAt:new Date().toISOString(),worker:process.env.CODEX_THREAD_ID});
console.log(JSON.stringify({version:1,pass:true,transition,sourceFiles:Object.keys(source).length,changedPaths,closedInputs:Object.keys((await json(transitionPath)).closedInputs).length,futureGrant,hostCapability:await reference(capabilityPath)}));
