// The question builder round-trips requests without changing a single prompt.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { promptsOf, toItems } from '../src/basal.js';
import { fromRequest, keyFrom, toRequest } from '../src/builder.js';
import { fromPlain, parse } from '../src/ojson.js';
import { PRESETS } from '../src/presets.js';

const prompts = (req) => promptsOf(toItems(req.get('state'), req.get('questions'), req.get('lang') ?? null))
  .map((j) => j.prompt);

const vectors = readFileSync(new URL('./data/format2_vectors.jsonl', import.meta.url), 'utf8').split('\n')
  .filter(Boolean).map(parse);

const cases = [
  ...PRESETS.map((p) => [`example "${p.name}"`, fromPlain(p.request)]),
  ...vectors.map((v) => [`vector ${v.get('id')}`, v.get('request')]),
];

for (const [name, req] of cases) {
  test(`${name}: JSON -> builder -> JSON keeps every prompt`, () => {
    const model = fromRequest(req);
    const back = toRequest(model);
    assert.deepEqual(prompts(back), prompts(req));
    // questions the form cannot show are passed through as the same objects
    for (const q of model.questions.filter((x) => x.kind === 'raw')) {
      assert.equal(back.get('questions').get(q.name), req.get('questions').get(q.name));
    }
  });
}

test('the form covers the common types and leaves tool / act to the JSON tab', () => {
  const kinds = (req) => fromRequest(req).questions.map((q) => q.kind);
  assert.deepEqual(kinds(fromPlain(PRESETS[0].request)), ['choice', 'noul', 'score']);
  assert.deepEqual(kinds(fromPlain(PRESETS[3].request)), ['multi']);
  assert.deepEqual(kinds(fromPlain(PRESETS[4].request)), ['raw']); // tool
  assert.deepEqual(kinds(fromPlain(PRESETS[5].request)), ['raw']); // act
});

test('a question written in the form', () => {
  const model = fromRequest(fromPlain({ state: 'Zamówienie przyszło uszkodzone.', questions: {} }));
  model.questions.push({ name: 'kind', kind: 'choice', instructions: 'Co to za zgłoszenie?', showKeys: false,
    rows: [{ key: '', text: 'Reklamacja' }, { key: '', text: 'Zwrot' }, { key: '', text: 'Reklamacja' }],
    yes: '', no: '', threshold: 0.5, named: false });
  const req = toRequest(model);
  const q = req.get('questions').get('kind');
  assert.deepEqual([...q.get('criteria').keys()], ['reklamacja', 'zwrot', 'reklamacja_2']); // made-up keys stay unique
  assert.equal(q.get('option_keys'), 'hide');
  // hidden keys, but a repeated text keeps its key so the options stay apart (basal's rule)
  assert.match(prompts(req)[0], /Opcje:\nA\. reklamacja: Reklamacja\nB\. Zwrot\nC\. reklamacja_2: Reklamacja<\|im_end\|>/);
});

test('keys made from Polish texts', () => {
  assert.equal(keyFrom('Opóźniona dostawa', new Set()), 'opozniona_dostawa');
  assert.equal(keyFrom('Łódź', new Set(['lodz'])), 'lodz_2');
  assert.equal(keyFrom('!!!', new Set()), 'option');
});
