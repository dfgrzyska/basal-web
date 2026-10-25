// Compares the browser port's answers with basal-serve's on the same requests (step 5 of the port).
//   node tools/compare.mjs test/data/reference.ollama.json dev/out/examples.json
import { readFileSync } from 'node:fs';

const [refPath, gotPath] = process.argv.slice(2);
const ref = JSON.parse(readFileSync(refPath, 'utf8'));
const got = JSON.parse(readFileSync(gotPath, 'utf8'));
const gold = new Map(readFileSync(new URL('../test/data/requests.jsonl', import.meta.url), 'utf8').split('\n')
  .filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r.gold]));

const top = (probs) => Object.entries(probs).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
const byId = new Map(got.rows.map((r) => [r.id, r]));
let n = 0, same = 0, tv = 0, maxDiff = 0, refRight = 0, gotRight = 0, graded = 0;
const flips = [];
const diffs = [];
for (const r of ref.rows) {
  const g = byId.get(r.id);
  if (!g || g.error || r.error) {
    console.log(`${r.id}: missing (${g?.error || r.error || 'no browser row'})`);
    continue;
  }
  for (const [name, a] of Object.entries(r.answers)) {
    const b = g.answers[name];
    const pa = a.probabilities;
    const pb = b.probabilities;
    const d = Math.max(...Object.keys(pa).map((k) => Math.abs(pa[k] - pb[k])));
    const t = Object.keys(pa).reduce((s, k) => s + Math.abs(pa[k] - pb[k]), 0) / 2;
    n++;
    tv += t;
    maxDiff = Math.max(maxDiff, d);
    diffs.push(d);
    const ta = top(pa);
    const tb = top(pb);
    if (ta === tb) same++;
    else flips.push(`${r.id}/${name}: basal-serve ${ta} (${pa[ta].toFixed(3)}) vs browser ${tb} (${pb[tb].toFixed(3)})`);
    const gl = gold.get(r.id);
    if (gl !== null && gl !== undefined && name === 'q') {
      graded++;
      // gold is the option text for choice, the level index for score, "true"/"false" for noul
      const key = (ans, k) => (ans.type === 'choice' ? ans.choice : k);
      if (key(a, ta) === gl) refRight++;
      if (key(b, tb) === gl) gotRight++;
    }
  }
}
diffs.sort((x, y) => x - y);
console.log(`questions compared: ${n}`);
console.log(`same top answer: ${same}/${n} (${((100 * same) / n).toFixed(1)}%)`);
console.log(`calibrated probabilities: mean TV ${(tv / n).toFixed(4)}, median max|dp| ${diffs[n >> 1].toFixed(4)}, ` +
  `max |dp| ${maxDiff.toFixed(4)}`);
console.log(`gold accuracy (${graded} graded): basal-serve ${refRight}/${graded}, browser ${gotRight}/${graded}`);
for (const f of flips) console.log('  flip ' + f);
