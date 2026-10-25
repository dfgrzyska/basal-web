// decide() against the basal engine's own answer assembly: the same readouts, the same calibration file, every field
// of every answer (fixtures from tools/make_assembly_fixtures.py, run with basal v2.0.0).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { decide } from '../src/basal.js';
import { parse } from '../src/ojson.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const calibration = JSON.parse(read('../calibration/CALIBRATION.llamacpp.json'));
const requests = new Map(read('./data/format2_vectors.jsonl').split('\n').filter(Boolean).map(parse)
  .map((v) => [v.get('id'), v.get('request')]));
const fixtures = JSON.parse(read('./data/assembly_fixtures.json'));

// basal computes the temperature in float32 (torch), this port in float64
function close(got, want, path) {
  if (typeof want === 'number') {
    assert.equal(typeof got, 'number', path);
    assert.ok(Math.abs(got - want) <= 2e-6 + 2e-6 * Math.abs(want), `${path}: ${got} != ${want}`);
  } else if (Array.isArray(want)) {
    assert.ok(Array.isArray(got), path);
    assert.equal(got.length, want.length, path);
    want.forEach((w, i) => close(got[i], w, `${path}[${i}]`));
  } else if (want && typeof want === 'object') {
    assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort(), path);
    for (const k of Object.keys(want)) close(got[k], want[k], `${path}.${k}`);
  } else assert.equal(got, want, path);
}

test('fixtures cover every question type', () => {
  const types = new Set(fixtures.flatMap((f) => Object.values(f.answers).map((a) => a.type)));
  assert.deepEqual([...types].sort(), ['act', 'choice', 'multi', 'noul', 'score', 'tool']);
});

for (const f of fixtures) {
  test(`answers of ${f.case}`, async () => {
    let n = 0;
    const readout = async (prompts) => prompts.map(() => f.readouts[n++]);
    const { answers } = await decide(requests.get(f.id), { readout, calibration });
    assert.equal(n, f.readouts.length, 'number of prompts');
    close(answers, f.answers, f.id);
  });
}
