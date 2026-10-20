import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {initHarness,planSync} from '../skill/codex-harness/scripts/lib/core.mjs';
import {documentReviews,reviewedPlan} from './native-hook-rollout-v2-doc-review.mjs';
import {runtimeFiles} from './native-hook-rollout-v2.mjs';
import {sourceRoot,sha,stable,helperPaths,previousHelperFreeze,selectedHelperFreeze,verifyHelperFreeze,sourceDigest,featureId,targets,helperRepairTestPaths,helperRepairProjectionScript,helperRepairEvidencePaths,helperRepairSyntaxCommands} from './native-hook-rollout-v2-authority.mjs';
const permitted=new Set([...Object.keys(runtimeFiles),'.harness/managed-files.json','.harness/repair-source.json','.codex/hooks.json','.claude/settings.json','.harness/codex-hooks.addition.json','.harness/claude-hooks.addition.json']);
let root;
before(async()=>{
  const parent=path.join(sourceRoot,'.harness/native-hook-v2-rollout-002/doc-review-fixtures');await mkdir(parent,{recursive:true});
  root=await mkdtemp(path.join(parent,'fixture-'));await initHarness(root,{name:'Reviewed fixture $&',purpose:'Canonical docs sidecar constraints.'});
  for(const {target} of Object.values(documentReviews))await writeFile(path.join(root,target),'# Customized project guidance\n');
});
after(async()=>{if(root){assert(root.startsWith(path.join(sourceRoot,'.harness/native-hook-v2-rollout-002/doc-review-fixtures')+path.sep));await rm(root,{recursive:true,force:true});}});
const plan=()=>planSync(root);
const sidecar=value=>value.operations.find(item=>item.path==='.harness/docs-map.v6.addition.md');
for(const [file,{target}] of Object.entries(documentReviews))test(`accepts canonical create-only ${file} with original preserved`,async()=>{
  const value=await plan(),before=await readFile(path.join(root,target));await reviewedPlan(value,permitted);
  assert.deepEqual(await readFile(path.join(root,target)),before);assert.equal(value.operations.find(item=>item.path===file).action,'write');
});
const rejects=(name,change)=>test(name,async()=>{const value=await plan();await change(value);await assert.rejects(()=>reviewedPlan(value,permitted));});
rejects('rejects arbitrary documentation additions',value=>sidecar(value).path='.harness/arbitrary.v6.addition.md');
rejects('rejects arbitrary executable additions',value=>sidecar(value).path='.harness/hooks/extra.v6.addition.mjs');
rejects('rejects original documentation writes',value=>{const op=value.operations.find(item=>item.path==='.harness/docs-map.md');op.action='write';});
rejects('rejects sidecar overwrites',value=>sidecar(value).beforeHash=sha('existing'));
rejects('rejects sidecar removals',value=>sidecar(value).action='remove');
rejects('rejects noncanonical proposed bytes with matching digest',value=>{const op=sidecar(value);const fake={...op};fake.bytes=Buffer.from('proposed but unreviewed');fake.afterHash=sha(fake.bytes);value.operations[value.operations.indexOf(op)]=fake;});
rejects('rejects proposed bytes without their hash',value=>sidecar(value).afterHash=sha('wrong'));
rejects('rejects missing proposed bytes',value=>{const op=sidecar(value);value.operations[value.operations.indexOf(op)]={...op};});
rejects('rejects original content hash drift',value=>{value.operations.find(item=>item.path==='.harness/docs-map.md').afterHash=sha('changed');});
rejects('rejects wrong canonical asset classification',value=>value.canonicalAssetResults[0].status='migrated');
rejects('rejects duplicate canonical review rows',value=>value.canonicalAssetResults.push({...value.canonicalAssetResults[0]}));
rejects('rejects historical state migrations',value=>value.migrations.push({path:'.harness/features.json'}));
rejects('rejects executable blockers',value=>value.blocked=true);
rejects('rejects unbound project-name input',value=>value.readSet.find(item=>item.path==='.harness/config.json').hash=sha('wrong'));
rejects('rejects a sidecar classified as existing',value=>value.readSet.find(item=>item.path==='.harness/docs-map.v6.addition.md').kind='file');
test('rejects original file changed after planning',async()=>{const value=await plan(),file=path.join(root,'.harness/docs-map.md'),original=await readFile(file);try{await writeFile(file,'Changed after planning');await assert.rejects(()=>reviewedPlan(value,permitted));}finally{await writeFile(file,original);}});
test('preserved existing sidecars grant no writes',async()=>{const value=await plan();for(const op of value.operations.filter(item=>Object.hasOwn(documentReviews,item.path)))op.action='preserve';await reviewedPlan(value,permitted);});

function freezeFixture(){
  const helpers=helperPaths.map((file,index)=>({path:file,bytes:index+1,sha256:sha(file)}));
  const changed=helpers.filter(item=>['scripts/native-hook-rollout-v2-authority.mjs','scripts/native-hook-rollout-v2.mjs','scripts/native-hook-rollout-v2-doc-review.mjs'].includes(item.path));
  const previous={version:1,kind:'production-helper-freeze',featureId,sourceDigest,authority:{helpers:helpers.filter(item=>!changed.includes(item))},sealedReferences:[]};
  const values=new Map();const make=(file,value)=>{const bytes=Buffer.from(JSON.stringify(value));const ref={path:file,bytes:bytes.length,sha256:sha(bytes)};values.set(file,{bytes,ref});return ref;};
  // Production authenticates the immutable previous pin. This mock tests the
  // selection validator independently of filesystem hashes and old helper IO.
  values.set(previousHelperFreeze.path,{bytes:Buffer.from(JSON.stringify(previous)),ref:previousHelperFreeze});
  const artifact=name=>helperRepairEvidencePaths[name]??`.harness/native-hook-v2-rollout-002/${name}.json`;
  const role=(name,value)=>({version:1,kind:`production-helper-doc-review-${name}`,featureId,sourceDigest,...value});
  const log=make(artifact('log'),{}),testFiles=helperRepairTestPaths.map(file=>make(file,{})),generator=make(helperRepairProjectionScript,{});
  const freeze={version:2,kind:'production-helper-freeze',featureId,sourceDigest,supersedes:previousHelperFreeze,helperPaths,helpers,changedHelpers:changed,sealedReferences:[],
    independentReview:make(artifact('independentReview'),role('independentReview',{verdict:'CLEAR',independentActualCode:true,helpers,changedHelpers:changed,sourceDigest,supersedes:previousHelperFreeze})),
    focusedEvidence:make(artifact('focusedEvidence'),role('focusedEvidence',{exitCode:0,failures:0,tests:40,command:`node --test ${helperRepairTestPaths.join(' ')}`,helpers,testFiles,log})),
    projectedPlans:make(artifact('projectedPlans'),role('projectedPlans',{readOnly:true,pass:true,sourceDigest,helpers,generator,targets:targets.map(root=>({root,blocked:false,migrations:0,originalsPreserved:true}))})),
    fullRegression:make(artifact('fullRegression'),role('fullRegression',{exitCode:0,signal:null,errorCode:null,command:'node --test tests/harness.test.mjs',providerCredentials:false,mocksOnly:true,tempOutsideGit:true,helpers,sourceBefore:sourceDigest,sourceAfter:sourceDigest,summary:['# fail 0','# cancelled 0'],log})),
    validation:make(artifact('validation'),role('validation',{pass:true,helpers,sourceDigest,syntax:helperRepairSyntaxCommands.map(command=>({command,exitCode:0})),audit:{score:98,criticalFindings:0}}))};
  const update=()=>make(selectedHelperFreeze,freeze);update();
  return {helpers,freeze,values,update,io:{ref:async file=>values.get(file).ref,auth:async ref=>{const item=values.get(ref.path);assert(item);assert.deepEqual(ref,item.ref);return item.bytes;}}};
}
test('selected freeze authenticates exact helper closure and old freeze without a self hash',async()=>{const fixture=freezeFixture();assert.deepEqual(await verifyHelperFreeze(fixture.helpers,fixture.io),fixture.values.get(selectedHelperFreeze).ref);});
for(const [name,change] of [
  ['stale helper hash',fixture=>fixture.freeze.helpers=fixture.helpers.map((item,i)=>i?item:{...item,sha256:sha('stale')})],
  ['changed prior freeze pin',fixture=>fixture.freeze.supersedes={...previousHelperFreeze,sha256:sha('changed')}],
  ['extra changed helper',fixture=>fixture.freeze.changedHelpers.push(fixture.helpers[2])],
  ['unreviewed helper closure',fixture=>fixture.freeze.helpers=[]],
  ['wrong source digest',fixture=>fixture.freeze.sourceDigest=sha('wrong')],
  ['missing review',fixture=>fixture.freeze.independentReview=null],
  ['missing projection',fixture=>fixture.freeze.projectedPlans=null]
])test(`selected freeze rejects ${name}`,async()=>{const fixture=freezeFixture();change(fixture);fixture.update();await assert.rejects(()=>verifyHelperFreeze(fixture.helpers,fixture.io));});
