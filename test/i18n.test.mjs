// Both page languages have every text, and Polish plurals and numbers follow Polish rules.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DICTS, getLang, pct, setLang, t } from '../src/i18n.js';

test('English and Polish have the same keys and the same placeholders', () => {
  assert.deepEqual(Object.keys(DICTS.pl).sort(), Object.keys(DICTS.en).sort());
  const holes = (s) => [...[s].flat().join(' ').matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of Object.keys(DICTS.en)) {
    assert.deepEqual([...new Set(holes(DICTS.pl[k]))], [...new Set(holes(DICTS.en[k]))], k);
  }
});

test('plurals and number notation', () => {
  const before = getLang();
  setLang('pl');
  assert.equal(t('fig.questions', { n: 1 }), '1 pytanie');
  assert.equal(t('fig.questions', { n: 3 }), '3 pytania');
  assert.equal(t('fig.questions', { n: 5 }), '5 pytań');
  assert.equal(t('fig.questions', { n: 12 }), '12 pytań');
  assert.equal(t('fig.questions', { n: 22 }), '22 pytania');
  assert.equal(t('env.tokens', { n: 32000 }), '32 000 tokenów');
  assert.equal(pct(0.948), '94,8%');
  setLang('en');
  assert.equal(t('fig.questions', { n: 1 }), '1 question');
  assert.equal(t('fig.questions', { n: 3 }), '3 questions');
  assert.equal(t('env.tokens', { n: 32000 }), '32,000 tokens');
  assert.equal(pct(0.948), '94.8%');
  assert.equal(pct(0.0004), '<0.1%');
  setLang(before);
});
