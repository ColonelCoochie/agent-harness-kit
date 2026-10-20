import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {authenticateBindings, sourceRoot} from './fix-nine-rollout-continuation-auth.mjs';
import {canonicalHash, rolloutReport} from './fix-nine-rollout-evidence.mjs';
import {cleanEnvironment} from './fix-nine-rollout-gate.mjs';
import {readJson} from './fix-nine-rollout-files.mjs';

export async function runFocusedTests() {
  const config = await readJson(sourceRoot, '.harness/config.json');
  const child = spawn(process.execPath, ['--test', 'tests/fix-nine-rollout.test.mjs', 'scripts/fix-nine-rollout-continuation.test.mjs'],
    {cwd: sourceRoot, env: cleanEnvironment(config), stdio: 'inherit', windowsHide: true});
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({code, signal}));
  });
  assert.equal(result.code, 0, 'Focused rollout tests failed'); assert.equal(result.signal, null);
}
// Narrow fixture seam proves ordering without recursively launching this file's
// own tests. The guarded CLI always uses these production implementations.
export async function runAcceptance({tests = runFocusedTests, authenticate = authenticateBindings} = {}) {
  await tests();
  const bindings = await authenticate();
  return {pass: true, featureId: 'fix-nine-rollout-001', report: bindings.deployment.report,
    bindingsHash: canonicalHash(bindings)};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.deepEqual(process.argv.slice(2), ['--report', rolloutReport]);
    console.log(JSON.stringify(await runAcceptance()));
  } catch (error) {
    console.error(JSON.stringify({status: 'stopped-safely', errorSha256: canonicalHash(String(error))}));
    process.exitCode = 1;
  }
}
