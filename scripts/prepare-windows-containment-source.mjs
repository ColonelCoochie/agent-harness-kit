import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { snapshot, sha, stable, sourceRoot } from './native-hook-auto-update-e2e.mjs';

export const directory = '.harness/windows-command-containment-001';
export const predecessorDigest = '97d64567ecede9787105a0fd9c6535cc15b1a5eab15d0e8ba8d4b42c10ca82e9';
export async function prepare() {
  const before = await snapshot(sourceRoot);
  assert.equal(sha(stable(before)), predecessorDigest, 'Predecessor archive must precede canonical source changes');
  await mkdir(path.join(sourceRoot, directory, 'original-bytes'), { recursive: true });
  const references = [];
  for (const relative of Object.keys(before).sort()) {
    const bytes = await readFile(path.join(sourceRoot, relative));
    assert.equal(sha(bytes), before[relative]);
    const archive = `${directory}/original-bytes/${sha(bytes)}.bin`;
    try { await writeFile(path.join(sourceRoot, archive), bytes, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; assert.deepEqual(await readFile(path.join(sourceRoot, archive)), bytes); }
    references.push({ path: relative, bytes: bytes.length, sha256: sha(bytes), archive });
  }
  const stateBytes = await readFile(path.join(sourceRoot, '.harness/features.json'));
  const statePath = `${directory}/predecessor-features.json`;
  await writeFile(path.join(sourceRoot, statePath), stateBytes, { flag: 'wx' });
  const report = { version: 1, createdAt: new Date().toISOString(), actor: process.env.CODEX_THREAD_ID, sourceDigest: predecessorDigest, sourceFiles: references, featureState: { path: statePath, bytes: stateBytes.length, sha256: sha(stateBytes) } };
  const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  const manifest = `${directory}/predecessor.json`;
  await writeFile(path.join(sourceRoot, manifest), bytes, { flag: 'wx' });
  console.log(JSON.stringify({ path: manifest, bytes: bytes.length, sha256: sha(bytes), sourceDigest: predecessorDigest, sourceFiles: references.length }));
}
await prepare();
