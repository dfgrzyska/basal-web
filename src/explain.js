// "Why?": how much each part of the state moved one answer. Every sentence of a text state (and every field of a
// structured one, sentence by sentence for text fields) is left out in turn and the question asked again; the change
// of the answer's probability is that part's influence. It shows what moves this model's answer, not a cause.
import { decide, promptsOf, toItems } from './basal.js';
import { dumps, fromPlain } from './ojson.js';

export const MAX_PARTS = 30; // more sentences are grouped, so a long state costs at most 31 prompts

export function sentences(s, lang) {
  if (typeof Intl.Segmenter !== 'function') return s.split(/(?<=[.!?…])\s+/).map((x, i, a) => (i < a.length - 1 ? `${x} ` : x));
  const out = [...new Intl.Segmenter(lang === 'pl' ? 'pl' : 'en', { granularity: 'sentence' }).segment(s)].map((x) => x.segment);
  return out.length ? out : [s];
}

// Neighbouring sentences of the same field joined in groups of `size`
function group(parts, size) {
  const out = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && !p.whole && !last.whole && last.field === p.field && last.count < size) {
      last.text += p.text;
      last.count++;
    } else out.push({ ...p, count: 1 });
  }
  return out;
}

/**
 * The parts of a state that can be left out: [{field, text, whole}]. field is null for a text state; a field that
 * is not text is one part (whole: true). Joining the texts of a field gives that field back exactly.
 */
export function partsOf(state, lang) {
  let parts;
  if (typeof state === 'string') parts = sentences(state, lang).map((text) => ({ field: null, text, whole: false }));
  else if (state instanceof Map) {
    parts = [];
    for (const [k, v] of state) {
      if (typeof v === 'string' && v.trim()) for (const text of sentences(v, lang)) parts.push({ field: k, text, whole: false });
      else parts.push({ field: k, text: typeof v === 'string' ? v : dumps(v), whole: true });
    }
  } else parts = [{ field: null, text: typeof state === 'string' ? state : dumps(state), whole: true }];
  let grouped = parts;
  for (let size = 2; grouped.length > MAX_PARTS && size <= parts.length; size++) grouped = group(parts, size);
  return grouped.map(({ field, text, whole }) => ({ field, text, whole }));
}

/** The state without part i. */
export function without(state, parts, i) {
  const drop = parts[i];
  if (typeof state === 'string' || drop.field === null) {
    if (typeof state !== 'string') return '';
    return parts.filter((_, j) => j !== i).map((p) => p.text).join('').trim();
  }
  const out = new Map();
  for (const [k, v] of state) {
    if (k !== drop.field) out.set(k, v);
    else if (!drop.whole) {
      const rest = parts.filter((p, j) => p.field === k && j !== i).map((p) => p.text).join('').trim();
      if (rest) out.set(k, rest);
    }
  }
  return out;
}

/**
 * The requests of an explanation of question `name`: the full state first, then the state without each part from the
 * last part to the first. Each prompt then shares everything before the removed part with the previous one, which
 * llama.cpp keeps in its cache. The language of the prompts stays that of the original question.
 * label: for labels (multi) and tool sets, the index of the label to explain.
 */
export function plan(request, name, { label = 0 } = {}) {
  const req = fromPlain(request);
  const items = toItems(req.get('state'), req.get('questions'), req.get('lang') ?? null);
  const item = items.find((q) => q.name === name);
  if (!item) throw new Error(`no question '${name}'`);
  const perLabel = item.type === 'multi' || item.multi;
  // a label of a multi question is asked as its own yes/no prompt: the same prompt as a noul question with that text
  const question = perLabel ? new Map([['type', 'noul'], ['instructions', item.branches[label][0]]]) : req.get('questions').get(name);
  const state = req.get('state');
  const parts = partsOf(state, item.lang);
  const rest = [...req].filter(([k]) => !['state', 'questions', 'lang'].includes(k));
  const make = (s) => new Map([['state', s], ['questions', new Map([[name, question]])], ['lang', item.lang], ...rest]);
  const runs = [{ part: null, request: make(state) }];
  for (let i = parts.length - 1; i >= 0; i--) runs.push({ part: i, request: make(without(state, parts, i)) });
  return { item, parts, runs, kind: perLabel ? 'label' : item.type === 'score' ? 'level' : 'prob', label };
}

const lcp = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

/** Tokens the plan computes, estimated from its prompts: each prompt costs what it doesn't share with the previous. */
export function estimateTokens(p) {
  let prev = '';
  let chars = 0;
  for (const run of p.runs) {
    const r = run.request;
    for (const job of promptsOf(toItems(r.get('state'), r.get('questions'), r.get('lang')))) {
      chars += job.prompt.length - lcp(prev, job.prompt);
      prev = job.prompt;
    }
  }
  return Math.round(chars / 3.2);
}

/** The value an explanation follows: the probability of the full answer's choice, or the expected level of a score. */
export function valueOf(kind, full, answer) {
  if (kind === 'label') return answer.noul; // P(the label applies)
  switch (answer.type) {
    case 'noul': return full.noul >= 0.5 ? answer.noul : 1 - answer.noul;
    case 'score': return answer.score;
    case 'act': return answer.probabilities[String(full.answer)];
    case 'tool': return answer.probabilities[String(full.refused ?? full.tool)];
    default: return answer.probabilities[String(full.choice)];
  }
}

/**
 * Run an explanation. readout(prompts) as for decide(); onProgress(done, total) after every run.
 * -> {parts, kind, full (the answer to the full state), value, values (without each part), deltas (value - values)}
 */
export async function explain(request, name, { readout, calibration = null, label = 0, onProgress, signal } = {}) {
  const p = plan(request, name, { label });
  const values = new Array(p.parts.length);
  let full = null;
  let value = null;
  for (const [n, run] of p.runs.entries()) {
    if (signal?.aborted) {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }
    const res = await decide(run.request, { readout, calibration });
    const a = res.answers[name];
    if (run.part === null) {
      full = a;
      value = valueOf(p.kind, a, a);
    } else values[run.part] = valueOf(p.kind, full, a);
    onProgress?.(n + 1, p.runs.length);
  }
  return { parts: p.parts, kind: p.kind, lang: p.item.lang, label: p.label, full, value, values,
    deltas: values.map((v) => value - v) };
}
