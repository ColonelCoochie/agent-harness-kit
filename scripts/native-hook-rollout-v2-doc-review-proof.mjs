import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {planSync} from '../skill/codex-harness/scripts/lib/core.mjs';
import {documentReviews,reviewedPlan} from './native-hook-rollout-v2-doc-review.mjs';
import {runtimeFiles} from './native-hook-rollout-v2.mjs';
import {targets,sourceRoot,sourceDigest,historicalDigest,featureId,baselinePin,previousHelperFreeze,helperPaths,reference,authenticateRef,snapshot,digest,exclusive,helperRepairEvidencePaths,helperRepairProjectionScript,sha} from './native-hook-rollout-v2-authority.mjs';

export async function projectAllPlans(){
  const before=digest(await snapshot());assert.equal(before,sourceDigest);
  await authenticateRef(previousHelperFreeze);
  const historic=JSON.parse(await authenticateRef(baselinePin));assert.equal(historic.sourceDigest,historicalDigest);assert.deepEqual(historic.targets.map(item=>item.root),targets);
  const permitted=new Set([...Object.keys(runtimeFiles),'.harness/managed-files.json','.harness/repair-source.json','.codex/hooks.json','.claude/settings.json','.harness/codex-hooks.addition.json','.harness/claude-hooks.addition.json']);
  const results=[];
  for(const [index,root] of targets.entries()){
    const plain=await planSync(root),old=historic.targets[index];
    for(const blocker of plain.blockers)assert(old.originalPlan.blockers.some(item=>item.path===blocker.path&&item.beforeHash===blocker.beforeHash),'Unreviewed executable replacement');
    const replacements=Object.fromEntries(plain.blockers.map(item=>[item.path,item.beforeHash]));
    const plan=await reviewedPlan(await planSync(root,{replacements}),permitted);
    const originals=[];
    for(const {target} of Object.values(documentReviews)){
      const op=plan.operations.find(item=>item.path===target);assert.equal(op.action,'preserve');assert.equal(op.afterHash,op.beforeHash);
      assert.equal(sha(await readFile(path.join(root,target))),op.beforeHash);originals.push({path:target,sha256:op.beforeHash});
    }
    results.push({index,root,planHash:plan.planHash,blocked:plan.blocked,migrations:plan.migrations.length,originalsPreserved:true,originals,
      executableReplacements:Object.keys(replacements),documentCreates:plan.operations.filter(item=>item.action!=='preserve'&&Object.hasOwn(documentReviews,item.path)).map(({path,beforeHash,afterHash,action})=>({path,beforeHash,afterHash,action})),
      operationCounts:Object.fromEntries(['write','remove','preserve'].map(action=>[action,plan.operations.filter(item=>item.action===action).length]))});
  }
  assert.deepEqual(results.flatMap(item=>item.documentCreates.map(op=>({index:item.index,...op}))),[{index:1,path:'.harness/docs-map.v6.addition.md',beforeHash:null,afterHash:'b875f799147864f2e529709529f221a08bad66c5828c675df428350a7fc4cec4',action:'write'}]);
  assert.equal(digest(await snapshot()),before);
  return {version:1,kind:'production-helper-doc-review-projectedPlans',featureId,createdAt:new Date().toISOString(),sourceDigest,readOnly:true,pass:true,
    helpers:await Promise.all(helperPaths.map(file=>reference(file))),generator:await reference(helperRepairProjectionScript),historicalBaseline:baselinePin,previousHelperFreeze,targets:results};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  assert.equal(process.argv.length,2);const value=await projectAllPlans();const ref=await exclusive(helperRepairEvidencePaths.projectedPlans,value);
  console.log(JSON.stringify({pass:true,targets:value.targets.length,documentCreates:value.targets.reduce((n,item)=>n+item.documentCreates.length,0),evidence:ref}));
}
