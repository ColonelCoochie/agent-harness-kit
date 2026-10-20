import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {sourceRoot,sha} from './verify-context-rollout.mjs';

// These are documentation review artifacts, never executable replacement grants.
export const documentReviews=Object.freeze({
  '.harness/docs-map.v6.addition.md':{target:'.harness/docs-map.md',asset:'docs-map.md.template'},
  '.harness/loops/goal.v6.addition.md':{target:'.harness/loops/goal.md',asset:'goal.md'},
  '.harness/loops/maker.v6.addition.md':{target:'.harness/loops/maker.md',asset:'maker.md'},
  '.harness/loops/checker.v6.addition.md':{target:'.harness/loops/checker.md',asset:'checker.md'}
});
const wrapper=(target,canonical)=>`# Canonical runtime v6 addition for \`${target}\`

<!-- agent-harness-managed: canonical-runtime-v6-asset-review -->

\`agent-harness sync\` preserved \`${target}\` because its content is neither the current canonical runtime-v6 asset nor an exact known runtime-v5 predecessor (allowing only CRLF-to-LF normalization).

Review and merge the canonical content between the markers into \`${target}\`. Do not delete customized project guidance. After the target matches the canonical runtime-v6 content, rerun \`sync\`; it removes this generated addition automatically. If you intentionally keep the customization, keep this addition as the explicit pending review.

<!-- BEGIN CANONICAL RUNTIME V6 CONTENT -->
${canonical}<!-- END CANONICAL RUNTIME V6 CONTENT -->
`;

export async function reviewDocumentCreation(plan,operation){
  const spec=Object.hasOwn(documentReviews,operation.path)&&documentReviews[operation.path];
  assert(spec,'Unreviewed documentation path');
  assert.equal(operation.action,'write','Documentation reviews are create-only');
  assert.equal(operation.beforeHash,null,'Existing documentation reviews cannot be overwritten');
  assert.equal(operation.status,'written');
  assert(Buffer.isBuffer(operation.bytes),'Proposed documentation bytes are required');
  const rows=plan.canonicalAssetResults.filter(item=>item.path===spec.target||item.reviewPath===operation.path);
  assert.equal(rows.length,1);assert.deepEqual(rows[0],{path:spec.target,status:'preserved',reviewPath:operation.path,reviewStatus:'written'});
  const originals=plan.operations.filter(item=>item.path===spec.target);
  assert.equal(originals.length,1);const original=originals[0];
  assert.equal(original.action,'preserve','Original customized guidance must remain unchanged');
  assert.equal(original.status,'preserved');assert.match(original.beforeHash,/^[a-f0-9]{64}$/);
  assert.equal(original.afterHash,original.beforeHash);
  const input=plan.readSet.filter(item=>item.path===spec.target);
  assert.equal(input.length,1);assert.deepEqual(input[0],{path:spec.target,kind:'file',hash:original.beforeHash});
  const missing=plan.readSet.filter(item=>item.path===operation.path);
  assert.equal(missing.length,1);assert.deepEqual(missing[0],{path:operation.path,kind:'missing',hash:null});
  assert.equal(sha(await readFile(path.join(plan.target,spec.target))),original.beforeHash,'Original documentation changed after planning');
  let canonical=await readFile(path.join(sourceRoot,'skill/codex-harness/assets',spec.asset),'utf8');
  if(spec.asset==='docs-map.md.template'){
    const configBytes=await readFile(path.join(plan.target,'.harness/config.json'));
    const configInput=plan.readSet.filter(item=>item.path==='.harness/config.json');
    assert.equal(configInput.length,1);assert.deepEqual(configInput[0],{path:'.harness/config.json',kind:'file',hash:sha(configBytes)});
    canonical=canonical.replaceAll('{{PROJECT_NAME}}',JSON.parse(configBytes).project?.name??path.basename(plan.target));
  }
  const expected=Buffer.from(wrapper(spec.target,canonical));
  assert.deepEqual(operation.bytes,expected,'Documentation review must contain the exact canonical proposed content');
  assert.equal(operation.afterHash,sha(expected));
}

export async function reviewedPlan(plan,permitted){
  assert.equal(plan.blocked,false);assert.equal(plan.migrations.length,0,'Historical state migrations are outside this rollout');
  for(const operation of plan.operations.filter(item=>item.action!=='preserve')){
    if(Object.hasOwn(documentReviews,operation.path))await reviewDocumentCreation(plan,operation);
    else{
      assert(permitted.has(operation.path),`Unreviewed rollout operation ${operation.path}`);
      assert(operation.action==='write'||operation.action==='remove');
      if(operation.action==='remove')assert(operation.path.endsWith('-hooks.addition.json'));
    }
  }
  return plan;
}
