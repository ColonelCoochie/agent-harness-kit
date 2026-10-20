import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

// Exercise the actual collector without starting one OS process per byte split.
// End-to-end command, log, and evidence coverage lives in hardening tests.
const source = await readFile(new URL('../skill/codex-harness/assets/project-runtime.mjs', import.meta.url), 'utf8');
const redaction = source.slice(source.indexOf('function* quotedSecretSpans('), source.indexOf('\nfunction platformCommand('));
const capture = source.slice(source.indexOf('function redactedCapture('), source.indexOf('\nfunction printRun('));
const createCapture = new Function('StringDecoder', `${redaction}\n${capture}\nreturn redactedCapture;`)(StringDecoder);

function collect(chunks, { secrets = [], maximum = 30000, enabled = true } = {}) {
  let saved = '';
  const collector = createCapture(enabled, secrets, maximum, value => { saved += value; });
  for (const chunk of chunks) collector.append(chunk);
  return { output: collector.finish(), saved, truncated: collector.truncated };
}

const fixtures = [
  '{"password":"ALPHA BRAVO"}',
  '{"token":"ALPHA \\"BRAVO\\" CHARLIE"}',
  '{"api_key":"ALPHA \\\\ BRAVO"}',
  '{"private-key":"ALPHA é雪🔒 BRAVO"}',
  '{"CrEdEnTiAl" : "ALPHA\\n BRAVO\\t CHARLIE"}',
  "secret='ALPHA BRAVO'",
  'password="ALPHA BRAVO"',
  'Authorization: Bearer "ALPHA BRAVO"',
  '{"password":"ALPHA BRAVO',
];

test('runtime redaction: quoted values survive every byte split and flush boundary', () => {
  for (const fixture of fixtures) {
    // Position a flush cut inside the value's first space, as in the report.
    const cut = fixture.indexOf('ALPHA ') + 'ALPHA '.length;
    const input = Buffer.from(fixture + 'x'.repeat(4096 + cut - fixture.length));
    for (let split = 0; split <= input.length; split++) {
      const result = collect([input.subarray(0, split), input.subarray(split), Buffer.from('\n')]);
      for (const actual of [result.saved, result.output]) {
        assert.doesNotMatch(actual, /ALPHA|BRAVO|CHARLIE|é|雪|🔒/, `leak at byte ${split} of ${fixture}`);
        assert.match(actual, /REDACTED/);
      }
    }
  }
});

test('runtime redaction: UTF-8, escapes, adjacent fields, and ordinary output remain intact', () => {
  const input = Buffer.from('before é雪🔒 {"password":"ALPHA \\"BRAVO\\"", "public":"VISIBLE", "token":"CHARLIE \\\\"} after\n');
  const result = collect([...input].map(byte => Buffer.from([byte])));
  assert.equal(result.saved, 'before é雪🔒 {"password":"[REDACTED]", "public":"VISIBLE", "token":"[REDACTED]"} after\n');
  assert.equal(result.output, result.saved);
  assert.equal(result.truncated, false);
});

test('runtime redaction: incomplete quotes and trailing escapes redact at EOF', () => {
  for (const suffix of ['', '\\', '\\"', '\\\\', '\nBRAVO']) {
    const result = collect([Buffer.from('{"password":"ALPHA ' + suffix)]);
    assert.equal(result.saved, '{"password":"[REDACTED]');
  }
});

test('runtime redaction: escaped environment forms and overlapping spans remain whole', () => {
  for (const secret of ['ALPHA "BRAVO" CHARLIE', 'ALPHA \\ BRAVO', 'ALPHA {"password":"BRAVO CHARLIE"} DELTA']) {
    for (const value of [secret, JSON.stringify(secret).slice(1, -1)]) {
      const input = Buffer.from(value + ' '.repeat(5000));
      for (let split = 0; split <= Buffer.byteLength(value); split++) {
        const result = collect([input.subarray(0, split), input.subarray(split)], { secrets: [secret] });
        assert.doesNotMatch(result.saved, /ALPHA|BRAVO|CHARLIE|DELTA/);
        assert.match(result.saved, /REDACTED_ENV/);
      }
    }
  }
});

test('runtime redaction: overlapping secrets cannot change quote or label parsing', () => {
  const cases = [
    { secrets: ['KNOWN\\'], value: JSON.stringify({ password: 'FIRST KNOWN" LEAKTAIL' }) },
    { secrets: ['password'], value: '{"password":"ALPHA BRAVO"}' },
    { secrets: ['password'], value: 'password=ALPHA_BRAVO' },
    { secrets: ['KNOWN\\'], value: '{"password":"FIRST KNOWN\\" LEAKTAIL' },
    { secrets: ['ALPHA BRAVO', 'BRAVO CHARLIE'], value: 'ALPHA BRAVO CHARLIE' },
    { secrets: ['ALPHA\nBRAVO'], value: 'ALPHA\nBRAVO' },
    { secrets: ['ALPHA\nBRAVO'], value: JSON.stringify('ALPHA\nBRAVO') },
  ];
  for (const { secrets, value } of cases) {
    const input = Buffer.from(value + ' '.repeat(5000));
    for (let split = 0; split <= Buffer.byteLength(value); split++) {
      const result = collect([input.subarray(0, split), input.subarray(split)], { secrets });
      for (const actual of [result.saved, result.output]) {
        assert.doesNotMatch(actual, /FIRST|KNOWN|LEAKTAIL|ALPHA|BRAVO|CHARLIE/, `leak at byte ${split} of ${value}`);
        assert.match(actual, /REDACTED_ENV/);
      }
    }
  }
});

test('runtime redaction: long known values cross partial, escaped, and multiline boundaries', () => {
  const secret = 'ALPHA "' + 'x'.repeat(70000) + '\nBRAVO\\CHARLIE';
  for (const value of [secret, JSON.stringify(secret).slice(1, -1)]) {
    const input = Buffer.from('PUBLIC ' + value + ' AFTER\n');
    for (const split of [1, 8, 4096, 65535, input.length - 5, input.length - 1]) {
      const result = collect([input.subarray(0, split), input.subarray(split)], { secrets: [secret] });
      assert.equal(result.saved, 'PUBLIC [REDACTED_ENV] AFTER\n');
      assert.equal(result.output, result.saved);
    }
  }
});

test('runtime redaction: oversized multiline quoted values omit the remainder of the stream', () => {
  for (const chunks of [
    [Buffer.from('{"password":"' + 'ALPHA '.repeat(400000) + '\nBRAVO \\" CHARLIE"}\nPUBLIC é雪🔒\n')],
    [Buffer.from('{"token":"'), ...Array.from({ length: 800 }, () => Buffer.from('ALPHA '.repeat(512))), Buffer.from('\nBRAVO \\'), Buffer.from('" CHARLIE"}\nPUBLIC é雪🔒\n')],
  ]) {
    const result = collect(chunks, { maximum: 1000 });
    assert.doesNotMatch(result.saved, /ALPHA|BRAVO|CHARLIE/);
    assert.match(result.saved, /OUTPUT OMITTED/);
    assert.doesNotMatch(result.saved, /PUBLIC/);
    assert.match(result.saved, /remainder of stream suppressed/);
    assert.ok(result.saved.length < 2000);
    assert.ok(result.output.length <= 1000);
    assert.equal(result.truncated, true);
  }
});

test('runtime redaction: oversized whitespace suppresses the unfinished label and stream tail', () => {
  const result = collect([Buffer.from('{"password":' + ' '.repeat(200000)), Buffer.from('"ALPHA\nBRAVO"}\nPUBLIC\n')]);
  assert.doesNotMatch(result.saved, /ALPHA|BRAVO/);
  assert.match(result.saved, /OUTPUT OMITTED/);
  assert.doesNotMatch(result.saved, /PUBLIC/);
  assert.equal(result.truncated, true);
});

test('runtime redaction: oversized prefixes never recover inside later multiline secrets', () => {
  const tails = [
    { value: ' {"password":"ALPHA\nBRAVO"}\nPUBLIC\n', secrets: [] },
    { value: ' ALPHA\nBRAVO\nPUBLIC\n', secrets: ['ALPHA\nBRAVO'] },
    { value: '"}\n{"token":"ALPHA\nBRAVO"}\nPUBLIC\n', secrets: [], prefix: '{"password":"' },
  ];
  for (const { value, secrets, prefix = '' } of tails) {
    for (let split = 0; split <= Buffer.byteLength(value); split++) {
      const tail = Buffer.from(value);
      const result = collect([Buffer.from(prefix + 'x'.repeat(100000)), tail.subarray(0, split), tail.subarray(split)], { secrets });
      for (const actual of [result.saved, result.output]) {
        assert.doesNotMatch(actual, /ALPHA|BRAVO|PUBLIC|xxx/);
        assert.match(actual, /remainder of stream suppressed/);
        assert.ok(actual.length < 200);
      }
      assert.equal(result.truncated, true);
    }
  }
});

test('runtime redaction: truncation follows sanitization and disabled capture keeps Unicode', () => {
  const value = Buffer.from('{"password":"ALPHA BRAVO"}\n' + 'public '.repeat(3000));
  const result = collect([value], { maximum: 32 });
  assert.doesNotMatch(result.saved, /ALPHA|BRAVO/);
  assert.match(result.saved, /REDACTED/);
  assert.equal(result.output.length, 32);
  assert.equal(result.truncated, true);
  const plain = 'x'.repeat(16383) + '🔒 é雪 ' + 'x'.repeat(17000);
  assert.equal(collect([Buffer.from(plain)], { enabled: false, maximum: 40000 }).saved, plain);
});
