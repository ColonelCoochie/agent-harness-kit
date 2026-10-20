// Filesystem boundary shared by the report and real outer gate. No CLI or writes
// occur on import. Paths in evidence are repository relative, regular files.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, open, readdir, realpath} from 'node:fs/promises';
import path from 'node:path';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function checkPin(ref) {
  assert.deepEqual(Object.keys(ref).sort(), ['bytes', 'path', 'sha256']);
  referencePath(ref.path);
  assert(Number.isSafeInteger(ref.bytes) && ref.bytes >= 0); assert.match(ref.sha256, /^[a-f0-9]{64}$/);
}
export function referencePath(relative) {
  assert.equal(typeof relative, 'string');
  assert(!/[\\:\x00-\x1f]/.test(relative), 'Invalid reference characters');
  const parts = relative.split('/');
  assert(parts.every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), 'Invalid reference path');
  return parts;
}

export async function regularPath(root, relative, {directory = false, absent = false} = {}) {
  const base = path.resolve(root), parts = referencePath(relative);
  // Include the root's own ancestors: a junction above the repository is also
  // an indirection, even if the final file itself is regular.
  let current = path.parse(base).root;
  const ancestors = path.relative(current, base).split(path.sep).filter(Boolean);
  const all = [...ancestors, ...parts];
  for (const [index, part] of all.entries()) {
    current = path.join(current, part);
    const final = index === all.length - 1;
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if (error.code === 'ENOENT' && final && absent) return current;
      throw error;
    }
    assert(!info.isSymbolicLink(), 'References reject symlink and junction parents');
    assert(!final || !absent, 'Exclusive artifact already exists');
    assert(final && !directory ? info.isFile() : info.isDirectory(), 'Wrong reference file type');
  }
  const resolved = await realpath(current);
  const same = process.platform === 'win32' ? resolved.toLowerCase() === current.toLowerCase() : resolved === current;
  assert(same, 'Reference resolves through filesystem indirection');
  return current;
}

export async function readRegular(root, relative) {
  const file = await regularPath(root, relative);
  const handle = await open(file, 'r');
  try {
    const initial = await handle.stat(); assert(initial.isFile());
    const bytes = await handle.readFile();
    const final = await handle.stat();
    assert.equal(initial.size, final.size); assert.equal(initial.mtimeMs, final.mtimeMs);
    // Recheck path after reading; this is cooperative sole-worker protection,
    // not an adversarial lock against arbitrary simultaneous filesystem edits.
    await regularPath(root, relative);
    return bytes;
  } finally { await handle.close(); }
}
export async function pinFile(root, relative) {
  const bytes = await readRegular(root, relative);
  return {path: relative, bytes: bytes.length, sha256: sha(bytes)};
}
export async function authenticateFile(root, ref) {
  checkPin(ref);
  const bytes = await readRegular(root, ref.path);
  assert.equal(bytes.length, ref.bytes, `Reference size changed: ${ref.path}`);
  assert.equal(sha(bytes), ref.sha256, `Reference bytes changed: ${ref.path}`);
  return bytes;
}
export async function authenticatePrefix(root, ref) {
  checkPin(ref);
  const bytes = await readRegular(root, ref.path);
  assert(bytes.length >= ref.bytes, 'History prefix was truncated');
  assert.equal(sha(bytes.subarray(0, ref.bytes)), ref.sha256, 'History prefix changed');
  return bytes;
}
export async function readJson(root, relative) { return JSON.parse(await readRegular(root, relative)); }

// Enumerate contained regular files without reading in-flight command output.
// Only the frozen inventory and completed output are hashed.
export async function regularInventoryPaths(root, relative) {
  const directory = await regularPath(root, relative, {directory:true});
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    const name = `${relative}/${entry.name}`;
    assert(!entry.isSymbolicLink(), 'Inventory refuses filesystem links');
    if (entry.isDirectory()) result.push(...await regularInventoryPaths(root, name));
    else { assert(entry.isFile()); await regularPath(root, name); result.push(name); }
  }
  return result.sort();
}
export async function freezeInventory(root, relative) {
  return Promise.all((await regularInventoryPaths(root, relative)).map(name => pinFile(root, name)));
}
export async function inventoryAdditions(root, relative, frozen) {
  assert(Array.isArray(frozen));
  const names = frozen.map(ref => ref.path);
  assert.equal(new Set(names).size, names.length, 'Duplicate frozen inventory path');
  assert.deepEqual(names, [...names].sort());
  for (const ref of frozen) {
    assert(ref.path.startsWith(`${relative}/`));
    await authenticateFile(root, ref);
  }
  const current = await regularInventoryPaths(root, relative);
  assert(names.every(name => current.includes(name)), 'Frozen inventory file disappeared');
  return current.filter(name => !names.includes(name));
}
export async function exclusiveJson(root, relative, value) {
  const file = await regularPath(root, relative, {absent: true});
  const handle = await open(file, 'wx');
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  return pinFile(root, relative);
}
