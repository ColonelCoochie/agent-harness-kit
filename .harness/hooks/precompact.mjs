#!/usr/bin/env node
// PreCompact hook (Codex and Claude Code). Records that the host compacted so a
// fresh worker can see it in progress.md. Fail-open: it never blocks compaction
// or tools, and always exits 0 with an empty JSON response.
const done = () => { process.stdout.write('{}'); process.exit(0); };
setTimeout(done, 15000).unref();
try {
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 1048576) break; }
  let trigger = 'unknown';
  try { trigger = JSON.parse(raw || '{}').trigger ?? trigger; } catch {}
  const { recordCompaction } = await import('../run.mjs');
  await recordCompaction(trigger);
} catch (error) {
  process.stderr.write(`agent-harness precompact skipped: ${error.message}\n`);
}
done();
