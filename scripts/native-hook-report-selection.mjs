import assert from 'node:assert/strict';
import path from 'node:path';
import {lstat} from 'node:fs/promises';

export const defaultAutoUpdateReport = '.harness/native-hook-auto-update-e2e-report.json';

// Reports live inside the development control plane. Reject ambiguous paths
// before a caller loads or saves anything, including on non-Windows hosts.
function validateLocationPath(relative) {
  assert.equal(typeof relative, 'string', 'Report path is required');
  assert(relative.startsWith('.harness/'), 'Report must be relative to .harness/');
  assert(!path.isAbsolute(relative) && !/^[A-Za-z]:/.test(relative), 'Report must be relative');
  assert(!relative.includes('\\') && !relative.includes('\0'), 'Report path must use forward slashes');
  const segments = relative.split('/');
  assert(segments.every(segment => segment && segment !== '.' && segment !== '..'), 'Report path must be canonical');
  return relative;
}

export function validateReportPath(relative) {
  validateLocationPath(relative);
  assert(relative.endsWith('.json'), 'Report must be JSON');
  return relative;
}

export function selectReport(argv = process.argv.slice(2), fallback = defaultAutoUpdateReport, flag = '--report') {
  assert(!argv.some(arg => arg.startsWith(`${flag}=`)), `Use ${flag} followed by a relative path`);
  const positions = argv.flatMap((arg, index) => arg === flag ? [index] : []);
  assert(positions.length <= 1, `Select ${flag} exactly once`);
  const value = positions.length ? argv[positions[0] + 1] : fallback;
  assert(value && !value.startsWith('--'), `${flag} requires a relative path`);
  return validateReportPath(value);
}

export function reportArtifactDirectory(relative) {
  validateReportPath(relative);
  const parsed = path.posix.parse(relative);
  return path.posix.join(parsed.dir, parsed.name.replace(/-report$/, ''));
}

export async function inspectReportLocation(root, relative, {kind = 'file', absent = false} = {}) {
  validateLocationPath(relative);
  const segments = relative.split('/');
  let destination = root;
  for (const [index, segment] of segments.entries()) {
    destination = path.join(destination, segment);
    const info = await lstat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!info) { assert(absent, 'Selected report/artifact location is missing'); continue; }
    assert(!info.isSymbolicLink(), 'Selected report/artifact paths must reject symlinks');
    if (index < segments.length - 1) assert(info.isDirectory(), 'Selected namespace parent must be a directory');
    else { assert(!absent, 'Selected report/artifact target already exists'); assert(kind === 'directory' ? info.isDirectory() : info.isFile(), 'Selected target has wrong type'); }
  }
  return destination;
}
