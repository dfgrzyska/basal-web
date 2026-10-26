// The many-rows section and "Why?": reading tables, grading answers, and the explanation's prompts and deltas.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decide, promptsOf, toItems } from '../src/basal.js';
import { estimateTokens, explain, partsOf, plan, without } from '../src/explain.js';
import { fromPlain } from '../src/ojson.js';
import { accuracy, confusion, coverageCurve, goldOf, histogram, predictedOf, reliability } from '../src/stats.js';
import { detectDelimiter, parseDelimited, parseJsonl, readTable, tableFromRows, toCsv } from '../src/table.js';

test('CSV: quotes, delimiters inside quotes, line breaks, BOM, CRLF', () => {
  const text = '﻿id;treść;kategoria\r\n1;"Paczka; uszkodzona";complaint\r\n2;"Pierwsza linia\nDruga ""cytat""";other\r\n';
  assert.equal(detectDelimiter(text), ';');
  const t = tableFromRows(parseDelimited(text, ';'));
  assert.deepEqual(t.columns, ['id', 'treść', 'kategoria']);
  assert.deepEqual(t.rows, [['1', 'Paczka; uszkodzona', 'complaint'], ['2', 'Pierwsza linia\nDruga "cytat"', 'other']]);
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');
  assert.deepEqual(readTable('x.tsv', 'a\tb\n1\t2\n').rows, [['1', '2']]);
});

test('empty and repeated header names, short rows', () => {
  const t = tableFromRows([['a', '', 'a'], ['1'], ['1', '2', '3', '4']]);
  assert.deepEqual(t.columns, ['a', 'column 2', 'a (2)', 'column 4']);
  assert.deepEqual(t.rows[0], ['1', '', '', '']);
});

test('JSONL keeps the key order of first appearance', () => {
  const t = parseJsonl('{"b": 1, "a": "x"}\n\n{"a": "y", "c": true}\n');
  assert.deepEqual(t.columns, ['b', 'a', 'c']);
  assert.deepEqual(t.rows, [[1, 'x', ''], ['', 'y', true]]);
  assert.throws(() => parseJsonl('[1]'), /line 1/);
});

test('CSV out reads back the same', () => {
  const rows = [['Paczka, uszkodzona', 'a "b"', 'x\ny'], [' lead', 3, null]];
  const csv = toCsv(['c1', 'c2', 'c3'], rows);
  assert.ok(csv.startsWith('﻿'));
  assert.deepEqual(tableFromRows(parseDelimited(csv, ',')).rows, [['Paczka, uszkodzona', 'a "b"', 'x\ny'], [' lead', '3', '']]);
});

const choiceDetail = { keys: ['complaint', 'delivery'], texts: ['complaint: Reklamacja towaru', 'delivery: Opóźniona dostawa'],
  calibrated: [0.8, 0.2] };

test('correct answers read from a cell', () => {
  assert.equal(goldOf('choice', choiceDetail, 'complaint'), 'complaint');
  assert.equal(goldOf('choice', choiceDetail, ' Opóźniona dostawa '), 'delivery'); // the option text
  assert.equal(goldOf('choice', choiceDetail, 'COMPLAINT'), 'complaint');
  assert.equal(goldOf('choice', choiceDetail, 'faktura'), null);
  assert.equal(goldOf('choice', choiceDetail, ''), null);
  const yn = { keys: ['true', 'false'], texts: ['Tak', 'Nie'] };
  for (const v of ['tak', 'Yes', 'TRUE', '1']) assert.equal(goldOf('noul', yn, v), 'true');
  for (const v of ['nie', 'no', 'false', '0']) assert.equal(goldOf('noul', yn, v), 'false');
  const sc = { keys: ['0', '1', '2'], texts: ['niska', 'średnia', 'wysoka'] };
  assert.equal(goldOf('score', sc, 'średnia'), '1');
  assert.equal(goldOf('score', sc, '2'), '2');
  const ml = { keys: ['damage', 'refund', 'delivery'], texts: ['Damaged goods', 'Refund request', 'Delivery problem'] };
  assert.deepEqual(goldOf('multi', ml, 'refund; Damaged goods'), ['damage', 'refund']);
  assert.equal(goldOf('multi', ml, 'refund, nothing'), null);
});

test('accuracy, confusion, calibration bins, coverage', () => {
  const pts = [
    { gold: 'a', predicted: 'a', confidence: 0.95 },
    { gold: 'a', predicted: 'b', confidence: 0.55 },
    { gold: 'b', predicted: 'b', confidence: 0.9 },
    { gold: null, predicted: 'b', confidence: 0.6 },
  ];
  assert.deepEqual(accuracy(pts), { n: 3, right: 2, accuracy: 2 / 3 });
  assert.deepEqual(confusion(['a', 'b'], pts), [[1, 1], [0, 1]]);
  const bins = reliability(pts);
  assert.deepEqual(bins.map((b) => [b.lo, b.n, b.acc]), [[0.5, 1, 0], [0.9, 2, 1]]);
  assert.deepEqual(coverageCurve(pts).map((c) => [c.threshold, c.coverage, c.error]),
    [[0.95, 1 / 3, 0], [0.9, 2 / 3, 0], [0.55, 1, 1 / 3]]);
  assert.deepEqual(histogram([0, 0.05, 0.5, 1], 4), [2, 0, 1, 1]);
  assert.equal(predictedOf({ type: 'noul', noul: 0.4 }, {}), 'false');
  assert.equal(predictedOf({ type: 'score', score: 1.2 }, { keys: ['0', '1', '2'], calibrated: [0.2, 0.5, 0.3] }), '1');
});

const ticket = fromPlain({
  state: 'Zamówiłam czajnik. Przyszedł z pękniętą obudową. Proszę o wymianę.',
  questions: {
    category: { type: 'choice', instructions: 'Jaki jest rodzaj zgłoszenia?',
      criteria: { complaint: 'Reklamacja towaru', delivery: 'Opóźniona dostawa', other: 'Inne' } },
    tone: { type: 'score', instructions: 'Jak zdenerwowana jest klientka?', criteria: ['spokojna', 'zła'] },
  },
});

test('parts of a text state and of a structured state', () => {
  const parts = partsOf(ticket.get('state'), 'pl');
  assert.deepEqual(parts.map((p) => p.text), ['Zamówiłam czajnik. ', 'Przyszedł z pękniętą obudową. ', 'Proszę o wymianę.']);
  assert.equal(without(ticket.get('state'), parts, 1), 'Zamówiłam czajnik. Proszę o wymianę.');
  const s = fromPlain({ ticket: 'Raz. Dwa.', customer: { segment: 'VIP' } });
  const sp = partsOf(s, 'pl');
  assert.deepEqual(sp.map((p) => [p.field, p.text, p.whole]),
    [['ticket', 'Raz. ', false], ['ticket', 'Dwa.', false], ['customer', '{"segment": "VIP"}', true]]);
  assert.deepEqual([...without(s, sp, 2).keys()], ['ticket']);
  assert.equal(without(s, sp, 0).get('ticket'), 'Dwa.');
  const long = Array.from({ length: 70 }, (_, i) => `Zdanie ${i}.`).join(' ');
  const lp = partsOf(long, 'pl');
  assert.ok(lp.length <= 30);
  assert.equal(lp.map((p) => p.text).join(''), long);
});

test('the plan: one question, full state first, then parts from the last to the first', () => {
  const p = plan(ticket, 'category');
  assert.deepEqual(p.runs.map((r) => r.part), [null, 2, 1, 0]);
  for (const r of p.runs) assert.deepEqual([...r.request.get('questions').keys()], ['category']);
  assert.equal(p.runs[2].request.get('state'), 'Zamówiłam czajnik. Proszę o wymianę.');
  assert.equal(p.runs[0].request.get('lang'), 'pl');
  // the prompt without a part is exactly the prompt of the state without it
  const r = p.runs[2].request;
  const direct = promptsOf(toItems('Zamówiłam czajnik. Proszę o wymianę.', ticket.get('questions'), 'pl'))[0].prompt;
  assert.equal(promptsOf(toItems(r.get('state'), r.get('questions'), r.get('lang')))[0].prompt, direct);
  assert.ok(estimateTokens(p) > 100);
});

test('a label of a multi question is explained with exactly its own prompt', async () => {
  const req = fromPlain({ state: 'Paczka zgubiona. Chcę zwrotu.', questions: { tags: { type: 'multi', instructions: 'Co porusza?',
    criteria: { lost: 'Zgubiona przesyłka', refund: 'Zwrot pieniędzy' } } } });
  const full = await decide(req, { readout: async (ps) => ps.map(({ k }) => new Array(k).fill(1 / k)) });
  const labelPrompt = full.prompts[1].prompt; // the prompt of the second label
  const p = plan(req, 'tags', { label: 1 });
  const r = p.runs[0].request;
  assert.equal(promptsOf(toItems(r.get('state'), r.get('questions'), r.get('lang')))[0].prompt, labelPrompt);
  assert.equal(p.kind, 'label');
});

test('explain: the part that carries the decision has the largest delta', async () => {
  // a fake model: "complaint" is likely only while the cracked case is in the prompt
  const readout = async (ps) => ps.map(({ prompt, k }) => {
    const p = prompt.includes('pękniętą') ? 0.9 : 0.3;
    return [p, ...new Array(k - 1).fill((1 - p) / (k - 1))];
  });
  const seen = [];
  const r = await explain(ticket, 'category', { readout, onProgress: (d, n) => seen.push(`${d}/${n}`) });
  assert.equal(r.kind, 'prob');
  assert.equal(r.full.choice, 'complaint');
  assert.deepEqual(seen, ['1/4', '2/4', '3/4', '4/4']);
  const top = r.deltas.indexOf(Math.max(...r.deltas));
  assert.equal(top, 1);
  assert.ok(Math.abs(r.deltas[0]) < 1e-12 && Math.abs(r.deltas[2]) < 1e-12);
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(explain(ticket, 'category', { readout, signal: ctrl.signal }), { name: 'AbortError' });
});
