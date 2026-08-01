#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../RESEARCH-2026-08-01.md', import.meta.url), 'utf8');
const failures = [];
const rows = [...source.matchAll(/^\|\s*(\d+)\s*\|([^\n]+)\|([^\n]+)\|([^\n]+)\|$/gm)]
  .map((match) => ({
    id: Number(match[1]),
    topic: match[2].trim(),
    sources: match[3].trim(),
    decision: match[4].trim()
  }))
  .filter((row) => row.id >= 1 && row.id <= 50);

const ids = new Set(rows.map((row) => row.id));
if (rows.length !== 50 || ids.size !== 50 || [...ids].some((id) => id < 1 || id > 50)) {
  failures.push(`expected exactly one research row for every lane 1-50; found ${rows.length} rows and ${ids.size} unique ids`);
}
for (let id = 1; id <= 50; id += 1) {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) continue;
  if (!/https?:\/\//.test(row.sources)) failures.push(`lane ${id} has no linked primary source`);
  if (/\bpending\b/i.test(`${row.sources} ${row.decision}`)) failures.push(`lane ${id} is still pending`);
  if (!/\b(adopt|defer|reject|keep|retain|measure|test)\b/i.test(row.decision)) {
    failures.push(`lane ${id} lacks an explicit decision or experiment disposition`);
  }
}

const requiredPatterns = [
  [/jstor\.org/i, 'JSTOR source coverage'],
  [/arxiv\.org/i, 'arXiv source coverage'],
  [/google scholar/i, 'Google Scholar search disclosure'],
  [/## Adopted experiment: mutation-lock ownership/, 'adopted lock experiment'],
  [/### Pre-change result[\s\S]*\*\*0\/2 passing\*\*/i, 'failing pre-change result'],
  [/### Post-change result[\s\S]*\*\*2\/2\*\*/i, 'passing post-change result'],
  [/## Outcome-evaluation protocol \(not yet an outcome claim\)/, 'causal claim boundary'],
  [/96 episodes/, 'preregistered pilot size']
];
for (const [pattern, description] of requiredPatterns) {
  if (!pattern.test(source)) failures.push(`missing ${description}`);
}

if (failures.length > 0) {
  console.error('Research verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Research verification passed: 50 sourced lanes with explicit dispositions and measured adopted-change evidence.');
}
