// The prompts of the 43 format-2 test vectors of the basal engine (docs/format2_vectors.jsonl), byte for byte.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CODE_IDS, decide, promptsOf, temper, temperature, toItems } from '../src/basal.js';
import { dumps, floatRepr, parse } from '../src/ojson.js';

const vectors = readFileSync(new URL('./data/format2_vectors.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(parse);

test('43 vectors, 74 prompts', () => {
  assert.equal(vectors.length, 43);
  assert.equal(vectors.reduce((n, v) => n + v.get('prompts').length, 0), 74);
});

for (const v of vectors) {
  test(`vector ${v.get('id')}`, () => {
    const req = v.get('request');
    const items = toItems(req.get('state'), req.get('questions'), req.get('lang') ?? null);
    const jobs = promptsOf(items, v.get('orders'));
    const want = v.get('prompts');
    assert.equal(jobs.length, want.length, 'number of prompts');
    jobs.forEach((j, n) => {
      const w = want[n];
      assert.equal(items[j.item].name, w.get('question'));
      assert.equal(items[j.item].lang, w.get('lang'));
      assert.deepEqual(j.perm, w.get('option_order'));
      assert.equal(j.prompt, w.get('prompt'), `prompt ${n}`);
      assert.deepEqual(CODE_IDS.slice(0, j.k), w.get('code_ids'), `code ids ${n}`);
    });
  });
}

test('Python float repr', () => {
  const cases = [[0.05, '0.05'], [0.01, '0.01'], [1e-5, '1e-05'], [0.0001, '0.0001'], [1, '1.0'], [1e16, '1e+16'],
    [1e15, '1000000000000000.0'], [-2.5, '-2.5'], [123.456, '123.456'], [1.5e-7, '1.5e-07'], [1e100, '1e+100']];
  for (const [x, s] of cases) assert.equal(floatRepr(x), s);
  assert.equal(dumps(parse('{"a": [1, 2.0, "ż\\n"], "10": null, "2": true}')),
    '{"a": [1, 2.0, "ż\\n"], "10": null, "2": true}');
});

test('temperature lookup and tempering', () => {
  const cal = JSON.parse(readFileSync(new URL('../calibration/CALIBRATION.llamacpp.json', import.meta.url), 'utf8'));
  assert.equal(temperature(cal, 'choice', 2), cal.temperature_per_bucket.choice['2-10']);
  assert.equal(temperature(cal, 'choice', 26), cal.temperature_per_bucket.choice['11-26']);
  assert.equal(temperature(cal, 'choice', 255), cal.temperature_per_bucket.choice['27-255']);
  assert.equal(temperature(cal, 'noul', 2), cal.temperature_per_prim.noul);
  assert.equal(temperature(cal, 'unknown', 2), 1);
  const p = temper([0.9, 0.1], 2);
  assert.ok(Math.abs(p[0] - 3 / 4) < 1e-12); // sqrt(0.9) / (sqrt(0.9) + sqrt(0.1)) = 3 / 4
});

test('decide() assembles typed answers from a readout', async () => {
  const req = parse(JSON.stringify({
    state: 'x',
    questions: {
      yn: { type: 'noul', instructions: 'q?' },
      pick: { type: 'choice', instructions: 'q?', criteria: { b: 'Bee', a: 'Ay', '10': 'Ten', '2': 'Two' } },
      lvl: { type: 'score', instructions: 'q?', criteria: ['low', 'mid', 'high'] },
      tags: { type: 'multi', instructions: 'q?', criteria: ['t1', 't2'] },
    },
  }).replace('"2":"Two","10":"Ten"', '"10":"Ten","2":"Two"'));
  const readout = async (prompts) => prompts.map(({ k }) => Array.from({ length: k }, (_, i) => (i === 0 ? 0.7 : 0.3 / (k - 1))));
  const { answers } = await decide(req, { readout });
  assert.equal(answers.yn.noul, 0.7);
  assert.equal(answers.pick.choice, '10'); // the request's order, not the JS order of integer-like keys
  assert.equal(answers.pick.probabilities['10'], 0.7);
  assert.ok(Math.abs(answers.lvl.score - (0.15 + 2 * 0.15)) < 1e-12);
  assert.deepEqual(answers.tags.selected, ['t1', 't2']);
});
