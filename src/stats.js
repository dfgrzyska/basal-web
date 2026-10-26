// Answers of many rows against the correct answers of a column: what was predicted, whether it was right, and the
// summaries the charts draw (accuracy, confusion matrix, calibration bins, coverage and error by threshold).

const YES = new Set(['tak', 'yes', 'true', '1', 't', 'y', 'prawda']);
const NO = new Set(['nie', 'no', 'false', '0', 'f', 'n', 'fałsz', 'falsz']);
const norm = (s) => String(s ?? '').trim().toLowerCase();

// An option's text without the "key: " shown when keys are visible to the model
export function optionText(detail, i) {
  const t = detail.texts[i] ?? '';
  const prefix = `${detail.keys[i]}: `;
  return t.startsWith(prefix) ? t.slice(prefix.length) : t;
}

// One correct-answer value -> an option key of the question, or null when it names none of them
function matchKey(detail, value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const exact = detail.keys.indexOf(v);
  if (exact >= 0) return detail.keys[exact];
  const n = norm(v);
  const i = detail.keys.findIndex((k, j) => norm(k) === n || norm(optionText(detail, j)) === n || norm(detail.texts[j]) === n);
  return i >= 0 ? detail.keys[i] : null;
}

/**
 * The correct answer in a cell -> what the answer of `type` should be: an option key (choice, tool, act, score), the
 * key "true" / "false" (yes / no), a sorted list of keys (labels); null when the cell is empty or can't be read.
 */
export function goldOf(type, detail, cell, { multi = false } = {}) {
  if (cell === null || cell === undefined || String(cell).trim() === '') return null;
  if (type === 'multi' || multi) {
    const keys = String(cell).split(/[,;|]/).map((s) => s.trim()).filter(Boolean).map((s) => matchKey(detail, s));
    return keys.includes(null) ? null : [...new Set(keys)].sort();
  }
  if (type === 'noul') {
    const n = norm(cell);
    if (YES.has(n)) return 'true';
    if (NO.has(n)) return 'false';
    return matchKey(detail, cell);
  }
  const key = matchKey(detail, cell);
  if (key !== null) return key;
  if (type === 'score' && /^\d+$/.test(String(cell).trim())) {
    const i = Number(cell);
    return i < detail.keys.length ? detail.keys[i] : null; // a level number, 0 = the first level
  }
  return null;
}

/** What an answer predicts, in the form goldOf() gives. */
export function predictedOf(answer, detail) {
  switch (answer.type) {
    case 'noul': return answer.noul >= 0.5 ? 'true' : 'false';
    case 'score': {
      const p = detail.calibrated;
      return detail.keys[p.indexOf(Math.max(...p))];
    }
    case 'multi': return [...answer.selected].map(String).sort();
    case 'tool': return answer.multi ? [...answer.tools].map(String).sort() : String(answer.refused ?? answer.tool);
    case 'act': return String(answer.answer);
    default: return String(answer.choice);
  }
}

/** The confidence of an answer: of its predicted option, or of the whole set for labels. */
export const confidenceOf = (answer) => answer.confidence ?? answer.set_confidence ?? null;

export function same(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b;
}

/** Points [{gold, predicted, confidence}] (gold may be null) -> accuracy over the rows that have a correct answer. */
export function accuracy(points) {
  const graded = points.filter((p) => p.gold !== null);
  const right = graded.filter((p) => same(p.gold, p.predicted)).length;
  return { n: graded.length, right, accuracy: graded.length ? right / graded.length : null };
}

/** Confusion counts m[gold][predicted] over the option keys (single answers only). */
export function confusion(keys, points) {
  const idx = new Map(keys.map((k, i) => [k, i]));
  const m = keys.map(() => keys.map(() => 0));
  for (const p of points) {
    if (p.gold === null || Array.isArray(p.gold)) continue;
    const g = idx.get(p.gold);
    const q = idx.get(p.predicted);
    if (g !== undefined && q !== undefined) m[g][q]++;
  }
  return m;
}

/** Calibration bins of equal width: mean confidence and accuracy of the graded rows in each non-empty bin. */
export function reliability(points, bins = 10) {
  const out = Array.from({ length: bins }, (_, b) => ({ lo: b / bins, hi: (b + 1) / bins, n: 0, conf: 0, acc: 0 }));
  for (const p of points) {
    if (p.gold === null || p.confidence === null) continue;
    const b = Math.min(bins - 1, Math.floor(p.confidence * bins));
    out[b].n++;
    out[b].conf += p.confidence;
    out[b].acc += same(p.gold, p.predicted) ? 1 : 0;
  }
  return out.filter((b) => b.n).map((b) => ({ ...b, conf: b.conf / b.n, acc: b.acc / b.n }));
}

/**
 * If only answers with confidence >= t were automated: the share automated (coverage) and the share of those that
 * are wrong (error), for every t that changes them, from the most confident answer down.
 */
export function coverageCurve(points) {
  const graded = points.filter((p) => p.gold !== null && p.confidence !== null).sort((a, b) => b.confidence - a.confidence);
  const out = [];
  let wrong = 0;
  graded.forEach((p, i) => {
    if (!same(p.gold, p.predicted)) wrong++;
    const next = graded[i + 1];
    if (!next || next.confidence < p.confidence) {
      out.push({ threshold: p.confidence, coverage: (i + 1) / graded.length, error: wrong / (i + 1) });
    }
  });
  return out;
}

/** Counts of values in equal bins over [0, 1]. */
export function histogram(values, bins = 10) {
  const out = new Array(bins).fill(0);
  for (const v of values) if (v !== null && v !== undefined) out[Math.min(bins - 1, Math.floor(v * bins))]++;
  return out;
}
