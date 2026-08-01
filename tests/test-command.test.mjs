import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('supported test commands use Node-native discovery without shell wildcards', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const harnessConfig = JSON.parse(await readFile(new URL('.harness/config.json', root), 'utf8'));
  const commands = [packageJson.scripts?.test, ...(harnessConfig.verification?.full ?? [])];

  assert.deepEqual(commands, ['node --test', 'node --test']);
  for (const command of commands) assert.doesNotMatch(command, /[*?]/);
});
