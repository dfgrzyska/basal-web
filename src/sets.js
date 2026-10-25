// Set selection for `multi` questions, ported from basal/sets.py (basal engine v2.0.0).
//
//   threshold  labels with p >= threshold (default 0.5), at most `max`, at least `min`
//   exact      labels with p >= 0.5: the most probable set
//   iou        the set with the highest expected IoU with the true set
//   f1         the set with the highest expected F1 with the true set
//
// Under independent labels the best set of each size is the top-k labels by probability, so every prefix of the
// sorted labels is scored. The IoU / F1 expectations are polynomial integrals of the Poisson-binomial generating
// function, evaluated exactly by Gauss-Legendre quadrature (see sets.py for the derivation).
import { dumps } from './ojson.js';

export const OBJECTIVES = ['threshold', 'exact', 'iou', 'f1'];

const nodeCache = new Map();

// Gauss-Legendre quadrature on [0, 1] with m nodes: t, and the weighted powers w * t^j for j = 0..256.
function nodes(m) {
  if (nodeCache.has(m)) return nodeCache.get(m);
  const x = new Float64Array(m);
  const w = new Float64Array(m);
  for (let i = 0; i < Math.ceil(m / 2); i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (m + 0.5));
    let pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1;
      let p2 = 0;
      for (let j = 1; j <= m; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
      }
      pp = (m * (z * p1 - p2)) / (z * z - 1);
      const dz = p1 / pp;
      z -= dz;
      if (Math.abs(dz) < 1e-16) break;
    }
    x[i] = -z;
    x[m - 1 - i] = z;
    w[i] = w[m - 1 - i] = 2 / ((1 - z * z) * pp * pp);
  }
  const t = Array.from(x, (v) => (v + 1) / 2);
  const wt = [];
  let pow = Array.from(w, (v) => v / 2);
  for (let j = 0; j <= 256; j++) {
    wt.push(pow);
    pow = pow.map((v, k) => v * t[k]);
  }
  const out = { t, wt };
  nodeCache.set(m, out);
  return out;
}

const dot = (a, b) => a.reduce((s, v, k) => s + v * b[k], 0);

// p: probabilities sorted in descending order -> the expected score of every prefix k = 0..n (n + 1 values).
export function expectedScores(probs, objective) {
  const p = probs.map((v) => Math.min(1, Math.max(0, v)));
  const n = p.length;
  if (objective === 'exact') {
    const lp = p.map(Math.log);
    const lq = p.map((v) => Math.log1p(-v));
    const out = [];
    for (let k = 0; k <= n; k++) {
      let s = 0;
      for (let i = 0; i < k; i++) s += lp[i];
      for (let i = k; i < n; i++) s += lq[i];
      out.push(Math.exp(s));
    }
    return out;
  }
  if (objective !== 'iou' && objective !== 'f1') throw new Error(`unknown objective '${objective}'`);
  if (n === 0) return [1];
  if (n > 256) throw new Error(`${n} labels (at most 256)`);
  let m = 8;
  while (2 * m - 1 < (objective === 'iou' ? n - 1 : 2 * n - 1)) m *= 2;
  const { t, wt } = nodes(m);
  const f = p.map((pi) => t.map((tk) => 1 + pi * (tk - 1)));
  const scores = [];
  if (objective === 'iou') {
    const suf = new Array(n);
    for (let i = n - 1; i >= 0; i--) suf[i] = i === n - 1 ? f[i].slice() : f[i].map((v, k) => v * suf[i + 1][k]);
    const ones = new Array(m).fill(1);
    let cum = 0;
    for (let r = 0; r < n; r++) {
      cum += p[r];
      scores.push(cum * dot(wt[r], r + 1 < n ? suf[r + 1] : ones));
    }
  } else {
    const all = t.map((_, k) => f.reduce((s, fi) => s * fi[k], 1));
    const run = new Array(m).fill(0);
    for (let r = 0; r < n; r++) {
      for (let k = 0; k < m; k++) run[k] += (p[r] / f[r][k]) * all[k];
      scores.push(2 * dot(wt[r + 1], run));
    }
  }
  return [p.reduce((s, v) => s * (1 - v), 1), ...scores.map((v) => Math.min(v, 1))];
}

function alone(probs, key, objective) {
  const rest = [...probs].filter(([k]) => k !== key).map(([, v]) => v);
  return expectedScores([probs.get(key), ...rest], objective)[1];
}

const argmaxBy = (keys, score) => keys.reduce((best, k) => (score(k) > score(best) ? k : best));

// probs: Map key -> P(label applies). Returns { selected, score (null for threshold), applied (constraints or null) }.
export function select(probs, objective = 'threshold', threshold = 0.5, min = null, max = null, exclusive = [],
  fallback = null, fallbackThreshold = null) {
  const excl = [...new Set([...(exclusive || []), ...(fallback !== null ? [fallback] : [])])];
  const alones = excl.filter((e) => e !== fallback);
  const order = [...probs.keys()].filter((k) => !excl.includes(k)).sort((a, b) => probs.get(b) - probs.get(a));
  const n = order.length;
  const oneOk = (min ?? 0) <= 1 && (max === null || max >= 1);
  let chosen = 'labels';
  let sel;
  let score = null;
  if (objective === 'threshold') {
    sel = order.filter((k) => probs.get(k) >= threshold);
    if (max !== null) sel = sel.slice(0, max);
    if (min !== null && sel.length < min) sel = order.slice(0, min);
    const cand = alones.filter((e) => probs.get(e) >= threshold);
    if (cand.length && oneOk) {
      const e = argmaxBy(cand, (k) => probs.get(k));
      if (!sel.length || probs.get(e) > Math.max(...sel.map((k) => probs.get(k)))) {
        sel = [e];
        chosen = 'exclusive';
      }
    }
    if (fallback !== null && !sel.length && oneOk) {
      if (probs.get(fallback) >= (fallbackThreshold === null ? threshold : fallbackThreshold)) {
        sel = [fallback];
        chosen = 'fallback';
      }
    }
  } else {
    const lo = Math.min(min ?? 0, n);
    const hi = max === null ? n : Math.min(max, n);
    const p = order.map((k) => probs.get(k));
    const scores = expectedScores([...p, ...excl.map((e) => probs.get(e))], objective);
    let best;
    if (objective === 'exact') {
      best = Math.min(hi, Math.max(lo, p.filter((x) => x >= 0.5).length));
    } else {
      best = lo;
      for (let k = lo; k <= hi; k++) if (scores[k] > scores[best]) best = k;
    }
    sel = order.slice(0, best);
    score = scores[best];
    if (oneOk) {
      for (const e of alones) {
        const s = alone(probs, e, objective);
        if (s > score) {
          sel = [e];
          score = s;
          chosen = 'exclusive';
        }
      }
      if (fallback !== null && !sel.length) {
        const s = alone(probs, fallback, objective);
        if (fallbackThreshold === null ? s > score : probs.get(fallback) >= fallbackThreshold) {
          sel = [fallback];
          score = s;
          chosen = 'fallback';
        }
      }
    }
  }
  if (!excl.length) return { selected: sel, score, applied: null };
  const applied = { exclusive: alones, fallback, chosen: sel.length ? chosen : 'empty' };
  if (fallback !== null) {
    applied.fallback_threshold = fallbackThreshold === null && objective === 'threshold' ? threshold : fallbackThreshold;
  }
  return { selected: sel, score, applied };
}

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isNum = (v) => typeof v === 'number' || (v !== null && typeof v === 'object' && typeof v.valueOf() === 'number');

// Request checks, as basal/sets.py validate().
export function validate(name, objective, keys, threshold, min, max, exclusive, fallback, fallbackThreshold) {
  const n = keys.length;
  const q = `question '${name}'`;
  if (!OBJECTIVES.includes(objective)) {
    throw new Error(`${q}: objective must be one of ${JSON.stringify(OBJECTIVES)}, got '${objective}'`);
  }
  if (exclusive !== null && exclusive !== undefined) {
    if (!Array.isArray(exclusive) || !exclusive.every((e) => typeof e === 'string')) {
      throw new Error(`${q}: exclusive must be a list of label keys`);
    }
    const bad = exclusive.filter((e) => !keys.includes(e));
    if (bad.length) throw new Error(`${q}: exclusive labels ${JSON.stringify(bad)} are not among the criteria`);
  }
  if (fallback !== null && fallback !== undefined && !keys.includes(fallback)) {
    throw new Error(`${q}: fallback '${fallback}' is not among the criteria`);
  }
  if (fallbackThreshold !== null && fallbackThreshold !== undefined) {
    if (fallback === null || fallback === undefined) throw new Error(`${q}: fallback_threshold needs a fallback label`);
    if (!isNum(fallbackThreshold) || !(+fallbackThreshold >= 0 && +fallbackThreshold <= 1)) {
      throw new Error(`${q}: fallback_threshold must be a number in 0..1`);
    }
  }
  if (objective === 'threshold') return;
  if (threshold !== null && threshold !== undefined) {
    throw new Error(`${q}: threshold applies only to objective "threshold"`);
  }
  for (const [k, v] of [['min', min], ['max', max]]) {
    if (v !== null && v !== undefined && !(isInt(v) && v >= 0)) {
      throw new Error(`${q}: ${k} must be a non-negative integer, got ${dumps(v)}`);
    }
  }
  if (min !== null && min !== undefined && min > n) throw new Error(`${q}: min ${min} is more than the ${n} labels`);
  if (min !== null && min !== undefined && max !== null && max !== undefined && min > max) {
    throw new Error(`${q}: min ${min} > max ${max}`);
  }
}

// Stable id of a label set with its fallback: the key of the calibration file's `multi` section.
export async function labelSetId(keys, labels, fallback) {
  const pairs = keys.map((k, i) => [String(k), String(labels[i])]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const blob = dumps([pairs, fallback], ',', ':');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(blob));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
