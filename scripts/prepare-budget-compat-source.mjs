import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {snapshot} from './native-hook-auto-update-e2e.mjs';
import {sourceRoot, authorityDirectory, predecessorPath, transitionPath, originalSourceDigest, originalReportPath, originalReportHash, originalBaselinePath, originalBaselineHash, archivedPaths, aggregateTestPath, focusedTestImport, sha, stable, relativeFile, authenticate, safeArchive, verifyPredecessor} from './source-budget-compat-authority.mjs';
import {compatibilityChanged, sourceState, normalizedContract} from './verify-source-budget-compat.mjs';
import {reconstructionPath, reconstructionHash, correctionAuthority} from './source-budget-compat-authority.mjs';

async function reference(relative) {
  const bytes = await readFile(relativeFile(relative));
  return {path: relative, bytes: bytes.length, sha256: sha(bytes)};
}
async function exclusive(relative, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  await mkdir(path.dirname(relativeFile(relative)), {recursive: true});
  await writeFile(relativeFile(relative), bytes, {flag: 'wx'});
  return {path: relative, bytes: bytes.length, sha256: sha(bytes)};
}
async function archive(relative) {
  const bytes = await readFile(relativeFile(relative));
  safeArchive(bytes);
  const ref = await reference(relative);
  const archived = {path: `${authorityDirectory}/original-bytes/${ref.sha256}.bin`, bytes: bytes.length, sha256: ref.sha256};
  try { await authenticate(archived); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await exclusive(archived.path, bytes);
  }
  return {...ref, archive: archived};
}
export async function prepare() {
  const sourceSnapshot = await snapshot(sourceRoot);
  assert.equal(sha(stable(sourceSnapshot)), originalSourceDigest, 'Archive must precede every canonical source edit');
  const baselineRef = await reference(originalBaselinePath);
  assert.equal(baselineRef.sha256, originalBaselineHash);
  const baseline = JSON.parse(await authenticate(baselineRef));
  const reportRef = await reference(originalReportPath);
  assert.equal(reportRef.sha256, originalReportHash);
  const report = JSON.parse(await authenticate(reportRef));
  assert.equal(report.artifacts.length, 37);
  for (const ref of report.artifacts) await authenticate(ref);
  const bindings = [];
  for (const [relative, expectedHash] of Object.entries(baseline.bindings)) {
    const ref = await reference(relative);
    assert.equal(ref.sha256, expectedHash);
    bindings.push(ref);
  }
  const sourceFiles = [];
  for (const [sourceIndex, relative] of Object.keys(sourceSnapshot).sort().entries()) {
    const ref = relative === aggregateTestPath
      ? {...await reference(relative), kind: 'original-prefix', extension: {bytes: Buffer.byteLength(focusedTestImport), sha256: sha(focusedTestImport)}}
      : archivedPaths.includes(relative) ? await archive(relative) : await reference(relative);
    assert.equal(ref.sha256, sourceSnapshot[relative]);
    sourceFiles.push({sourceIndex, ...ref});
  }
  const extraArchives = [];
  for (const relative of archivedPaths.filter(item => !(item in sourceSnapshot))) extraArchives.push(await archive(relative));
  return await exclusive(predecessorPath, {version: 1, createdAt: new Date().toISOString(), actor: process.env.CODEX_THREAD_ID, sourceRoot, sourceDigest: originalSourceDigest, baseline: baselineRef, report: reportRef, bindings, artifacts: report.artifacts, sourceFiles, extraArchives});
}
export async function freeze(predecessorHash) {
  const original = await verifyPredecessor(predecessorHash);
  const features=JSON.parse(await readFile(relativeFile('.harness/features.json'))).features;
  assert.equal(features.find(feature=>feature.id==='native-budget-contract-compat-001').status,'active');
  for (const id of ['native-hook-v2-live-002','native-hook-v2-rollout-002']) assert.equal(features.find(feature=>feature.id===id).status,'not_started');
  const sourceSnapshot = await snapshot(sourceRoot);
  const sourceDigest = sha(stable(sourceSnapshot));
  assert.notEqual(sourceDigest, originalSourceDigest, 'Transition requires a real canonical compatibility change');
  const changed = [...new Set([...Object.keys(original.sourceSnapshot), ...Object.keys(sourceSnapshot)])].filter(relative => original.sourceSnapshot[relative] !== sourceSnapshot[relative]).sort();
  assert.deepEqual(changed, compatibilityChanged, 'Canonical changes must match exact bounded compatibility scope');
  const reconstruction = await reference(reconstructionPath); assert.equal(reconstruction.sha256,reconstructionHash);
  await authenticate(reconstruction);
  const sourceFiles = [];
  for (const [sourceIndex, relative] of Object.keys(sourceSnapshot).sort().entries()) sourceFiles.push({sourceIndex, ...await reference(relative)});
  for (const reference of Object.values(correctionAuthority)) await authenticate(reference);
  return await exclusive(transitionPath, {version: 2, featureId: 'native-budget-contract-compat-001', actor: process.env.CODEX_THREAD_ID, createdAt: new Date().toISOString(), sourceRoot, predecessor: {path: predecessorPath, bytes: (await readFile(relativeFile(predecessorPath))).length, sha256: predecessorHash}, reconstruction, correctionAuthority, sourceState:await sourceState(original), previousSourceDigest: originalSourceDigest, sourceDigest, changed, sourceFiles});
}
export async function authorizeFuture(predecessorHash) {
  await verifyPredecessor(predecessorHash);
  const features=JSON.parse(await readFile(relativeFile('.harness/features.json'))).features;
  const contracts={};
  for(const id of ['native-hook-v2-live-002','native-hook-v2-rollout-002']) {
    const matches=features.filter(feature=>feature.id===id);assert.equal(matches.length,1);
    const feature=matches[0];assert.equal(feature.status,'not_started');assert.equal(feature.attempts,0);assert.deepEqual(feature.evidence,[]);assert(!feature.contract);
    const shape=normalizedContract(feature);contracts[id]={shape,sha256:sha(stable(shape))};
  }
  return exclusive(`${authorityDirectory}/future-feature-authorization.json`,{version:1,actor:process.env.CODEX_THREAD_ID,createdAt:new Date().toISOString(),predecessorHash,contracts});
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [operation, hash] = process.argv.slice(2);
    assert(['prepare', 'freeze', 'authorize-future'].includes(operation));
    console.log(JSON.stringify(await (operation === 'prepare' ? prepare() : operation === 'freeze' ? freeze(hash) : authorizeFuture(hash))));
  } catch (error) {
    console.error(JSON.stringify({status: 'stopped-safely', errorSha256: sha(String(error))}));
    process.exitCode = 1;
  }
}
