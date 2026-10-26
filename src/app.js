// The page: load the model, build a request (form or JSON), decide, and draw the answers. Polish and English: the
// page language comes from i18n.js and every text below goes through t(); a change of language redraws in place.
import { CODES, decide, promptsOf, text, toItems } from './basal.js';
import { createBuilder } from './builder.js';
import {
  barsChart, costChart, meterChart, mount, readoutChart, runChart, scoreChart, unmountWithin,
} from './charts.js';
import { BasalEngine, MODEL, modelUrl } from './engine.js';
import { apply, bind, getLang, num, pct, setLang, t } from './i18n.js';
import { dumps, fromPlain, parse, PyFloat } from './ojson.js';
import { PRESETS } from './presets.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const engine = new BasalEngine();
const calibration = fetch(new URL('../calibration/CALIBRATION.llamacpp.json', import.meta.url)).then((r) => r.json());
const typeName = (type) => t(`type.${type}`);
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

window.basal = { engine, decide }; // for the console

// ---------------------------------------------------------------------------------------------------------------
// JSON in the request's own key order

function pretty(x, ind = '') {
  const next = `${ind}  `;
  if (x instanceof Map) {
    if (!x.size) return '{}';
    return `{\n${[...x].map(([k, v]) => `${next}${dumps(String(k))}: ${pretty(v, next)}`).join(',\n')}\n${ind}}`;
  }
  if (Array.isArray(x)) {
    if (!x.length) return '[]';
    const flat = x.every((v) => v === null || typeof v !== 'object' || v instanceof PyFloat);
    const one = `[${x.map((v) => pretty(v)).join(', ')}]`;
    if (flat && one.length + ind.length < 100) return one;
    return `[\n${x.map((v) => `${next}${pretty(v, next)}`).join(',\n')}\n${ind}]`;
  }
  return dumps(x);
}

// ---------------------------------------------------------------------------------------------------------------
// Request editor: form and JSON tabs

let tab = 'form';
let jsonError = null;
const builder = createBuilder($('builder'), { onChange: () => markEdited() });

function setRequest(req) {
  builder.set(req);
  $('request-json').value = pretty(req);
  jsonNote();
}

function jsonNote(error = null) {
  jsonError = error;
  const note = $('json-note');
  note.classList.toggle('error', Boolean(error));
  if (error) bind(note, 'json.error', { error });
  else bind(note, 'json.note', {}, { html: true });
}

function currentRequest() {
  if (tab === 'json') return parse($('request-json').value);
  return builder.get();
}

function selectTab(next) {
  if (next === tab) return;
  if (next === 'json') $('request-json').value = pretty(builder.get());
  else {
    try {
      builder.set(parse($('request-json').value));
    } catch (e) {
      jsonNote(e.message);
      return;
    }
  }
  tab = next;
  for (const [id, panel] of [['tab-form', 'builder'], ['tab-json', 'json-panel']]) {
    const on = id === `tab-${next}`;
    $(id).setAttribute('aria-selected', String(on));
    $(panel).hidden = !on;
  }
}

$('tab-form').onclick = () => selectTab('form');
$('tab-json').onclick = () => selectTab('json');
$('request-json').addEventListener('input', () => {
  markEdited();
  try {
    parse($('request-json').value);
    jsonNote();
  } catch (e) {
    jsonNote(e.message);
  }
});

let activeExample = 0;

function markEdited() {
  activeExample = null;
  for (const c of document.querySelectorAll('.chip')) c.setAttribute('aria-pressed', 'false');
}

function renderChips() {
  $('examples').innerHTML = PRESETS.map((p, i) => `<button type="button" class="chip" data-i="${i}"
    aria-pressed="${i === activeExample}" title="${esc(p.name)}">${esc(p.short[getLang()] ?? p.short.en)}</button>`).join('');
}

$('examples').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  setRequest(fromPlain(PRESETS[+chip.dataset.i].request));
  activeExample = +chip.dataset.i;
  for (const c of document.querySelectorAll('.chip')) c.setAttribute('aria-pressed', String(c === chip));
});

// ---------------------------------------------------------------------------------------------------------------
// Model

const model = { state: 'idle', cached: false, loadMs: 0, error: '', progress: null };

function envFacts() {
  const coi = globalThis.crossOriginIsolated === true;
  const cores = navigator.hardwareConcurrency || 0;
  const rows = [
    [t('env.device'), cores ? t('env.cores', { n: cores }) : '?', true],
    [t('env.threads'), coi ? (engine.loaded ? String(engine.checks.threads) : t('env.multi')) : t('env.single'), coi],
  ];
  if (engine.loaded) {
    rows.push([t('env.context'), t('env.tokens', { n: engine.checks.ctxTrain }), true],
      [t('env.checks'), t(engine.checks.ok ? 'env.checksOk' : 'env.checksBad'), engine.checks.ok]);
  } else rows.push([t('env.model'), t(model.cached ? 'env.inCache' : 'env.notLoaded'), true]);
  $('env').innerHTML = rows.map(([k, v, ok]) => `<div class="${ok ? '' : 'bad'}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
}

function loadButton() {
  const btn = $('load');
  btn.classList.toggle('is-ready', model.state === 'ready');
  btn.disabled = model.state === 'loading' || model.state === 'ready';
  if (model.state === 'loading') btn.textContent = t('load.loading');
  else if (model.state === 'ready') btn.textContent = t('load.ready');
  else {
    btn.innerHTML = `${esc(t(model.state === 'failed' ? 'load.retry' : 'load.button'))} <span class="btn-note">${esc(t('load.size'))}</span>`;
  }
}

function progressText() {
  const p = model.progress;
  if (!p) return;
  if (p.loaded >= p.total) bind($('model-status'), 'load.reading');
  else bind($('model-status'), 'load.downloading', { a: round(p.loaded / 1e9, 2), b: round(p.total / 1e9, 2) });
}

async function cachedModel() {
  try {
    const entries = await engine.wllama.cacheManager.list();
    return entries.some((e) => e.metadata?.originalURL === modelUrl() && e.size === MODEL.size);
  } catch {
    return false;
  }
}

async function load() {
  const bar = $('progress');
  model.state = 'loading';
  loadButton();
  bar.hidden = false;
  bar.removeAttribute('value');
  const t0 = performance.now();
  try {
    await engine.load({
      onProgress: ({ loaded, total }) => {
        bar.value = loaded / total;
        model.progress = { loaded, total };
        progressText();
      },
    });
    model.state = 'ready';
    model.loadMs = performance.now() - t0;
    bind($('model-status'), 'load.done', { name: engine.checks.name, file: MODEL.file, s: round(model.loadMs / 1000, 1) });
    $('run').disabled = false;
    bind($('run-status'), 'run.ready');
  } catch (e) {
    model.state = 'failed';
    bind($('model-status'), 'load.failed', { error: e.message });
  } finally {
    bar.hidden = true;
    loadButton();
    envFacts();
  }
}
$('load').onclick = load;

// ---------------------------------------------------------------------------------------------------------------
// Answers

// An option's text without the "key: " the prompt shows when keys are visible to the model
function optText(d, i) {
  const s = d.texts[i] ?? '';
  const prefix = `${d.keys[i]}: `;
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

const lcp = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

function verdictOf(a, d) {
  const textOf = (key) => {
    const i = d.keys.indexOf(String(key));
    return i >= 0 && optText(d, i) && optText(d, i) !== String(key) ? ` <small>${esc(optText(d, i))}</small>` : '';
  };
  switch (a.type) {
    case 'noul':
      return `${t(a.noul >= 0.5 ? 'v.yes' : 'v.no')} <span class="num">${pct(a.noul >= 0.5 ? a.noul : 1 - a.noul)}</span>`;
    case 'score':
      return `<span class="num">${num(a.score, 2)}</span> <small>${esc(t('v.scoreOf', { n: d.keys.length - 1,
        level: optText(d, Math.round(a.score)) }))}</small>`;
    case 'multi':
      return a.selected.length ? a.selected.map(esc).join(', ') : `<small>${esc(t('v.noLabel'))}</small>`;
    case 'tool':
      if (a.multi) return a.tools.length ? a.tools.map(esc).join(', ') : `<small>${esc(t('v.noTool'))}</small>`;
      return a.deferred ? `${esc(t('v.deferred'))} <small>${esc(t('v.wouldCall', { tool: a.refused }))}</small>`
        : `${esc(a.tool)} <span class="num">${pct(a.confidence)}</span>`;
    case 'act': {
      const i = d.keys.indexOf(String(a.answer));
      const outcome = i >= 0 && optText(d, i) ? optText(d, i) : String(a.answer);
      return `${esc(a.action)} <small>${esc(t('v.outcome', { outcome, p: pct(a.confidence) }))}</small>`;
    }
    default:
      return `${esc(a.choice)}${textOf(a.choice)} <span class="num">${pct(a.confidence)}</span>`;
  }
}

function pillOf(a, d) {
  if (a.deferred) return `<span class="pill defer">${esc(t('pill.deferred'))}</span>`;
  if (a.type === 'multi' || (a.type === 'tool' && a.multi)) return '';
  const s = [...d.calibrated].sort((x, y) => y - x);
  return s.length > 1 && s[0] - s[1] < 0.1 ? `<span class="pill warn">${esc(t('pill.tie'))}</span>` : '';
}

// The charts of one answer: [[title or '', build]]
function chartsOf(a, d) {
  const rows = d.keys.map((k, i) => ({ code: CODES[i], key: k, text: optText(d, i), p: d.calibrated[i] }));
  const certified = d.threshold !== null && d.threshold !== undefined && a.type !== 'multi' && !a.multi;
  const thLabel = certified ? t('chart.certified', { p: pct(d.threshold) }) : '';
  if (a.type === 'noul') return [['', meterChart({ p: a.noul })]];
  if (a.type === 'score') return [['', scoreChart({ rows, expected: a.score })]];
  if (a.type === 'multi' || (a.type === 'tool' && a.multi)) {
    const chosen = new Set(a.selected ?? a.tools);
    return [[t('chart.labels'), barsChart({ rows, chosen, threshold: d.threshold,
      thresholdLabel: t('chart.selectFrom', { p: pct(d.threshold) }) })]];
  }
  if (a.type === 'act') {
    const out = d.keys.length === 2 && d.keys[0] === 'true'
      ? [t('chart.outcomeYes'), meterChart({ p: d.calibrated[0], marker: certified ? d.threshold : 0.5,
        markerLabel: certified ? thLabel : pct(0.5) })]
      : [t('chart.outcome'), barsChart({ rows, chosen: new Set([String(a.answer)]), threshold: certified ? d.threshold : null,
        thresholdLabel: thLabel })];
    const costs = Object.entries(a.expected_costs).map(([action, cost]) => ({ action, cost }));
    return [out, [t('chart.costs'), costChart({ rows: costs, chosen: a.action })]];
  }
  const chosen = new Set([String(a.type === 'tool' ? (a.refused ?? a.tool) : a.choice)]);
  return [['', barsChart({ rows, chosen, threshold: certified ? d.threshold : null, thresholdLabel: thLabel })]];
}

function tableOf(a, d) {
  const multi = a.type === 'multi' || (a.type === 'tool' && a.multi);
  const rows = d.keys.map((k, i) => `<tr><td class="c">${multi ? '' : CODES[i]}</td><td>${esc(k)}${optText(d, i) && optText(d, i) !== k
    ? `<br><span class="muted">${esc(optText(d, i))}</span>` : ''}</td><td class="n">${pct(d.raw[i])}</td><td class="n">${pct(d.calibrated[i])}</td></tr>`).join('');
  const what = multi ? t('table.labelsWhat') : t('table.options', { n: d.keys.length });
  return `<div class="table-wrap"><table><thead><tr><th></th><th>${esc(t(multi ? 'table.label' : 'table.option'))}</th>
    <th class="n">${esc(t('table.model'))}</th><th class="n">${esc(t('table.calibrated'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="cal-note">${esc(t('table.note', { T: num(d.temperature, 2), type: typeName(a.type), what }))}</p>`;
}

function promptsHtml(res, d) {
  return d.prompts.map((pi) => {
    const cur = res.prompts[pi].prompt;
    const prev = pi > 0 ? res.prompts[pi - 1].prompt : '';
    const shared = prev ? lcp(prev, cur) : 0;
    const label = d.prompts.length > 1
      ? `<p class="prompt-label">${esc(t('prompt.nth', { i: d.prompts.indexOf(pi) + 1, n: d.prompts.length }))}</p>` : '';
    return `${label}<pre class="prompt">${shared ? `<mark>${esc(cur.slice(0, shared))}</mark>` : ''}${esc(cur.slice(shared))}</pre>`;
  }).join('') + `<p class="prompt-label">${esc(t('prompt.shared'))}</p>`;
}

let renderSeq = 0;
let shown = null; // {res, log, meta}: redrawn after a change of language

async function renderResult(res, log, meta) {
  shown = { res, log, meta };
  const root = $('answers');
  unmountWithin(root);
  const seq = ++renderSeq;
  const tokens = log.reduce((s, l) => s + (l.promptTokens || 0), 0);
  const computed = log.reduce((s, l) => s + (l.evaluated || 0), 0);
  const ms = meta.ms ?? log.reduce((s, l) => s + l.ms, 0);
  const questions = meta.request.get('questions');
  // the prompt language of each question, as basal decided it
  const langs = new Map(toItems(meta.request.get('state'), questions, meta.request.get('lang') ?? null).map((q) => [q.name, q.lang]));
  const charts = [];
  const badge = meta.example ? t('ans.exampleBadge', { n: meta.threads })
    : t('ans.badge', { n: meta.threads, time: meta.time.toLocaleTimeString(getLang()) });
  let html = `<div class="ans-head"><h3>${esc(t(meta.example ? 'ans.example' : 'ans.yours'))}</h3><span class="badge">${esc(badge)}</span></div>
    <div class="tiles">
      <div class="tile"><b>${num(ms / 1000, 1)} s</b><span>${esc(t('tile.total'))}</span></div>
      <div class="tile"><b>${res.prompts.length}</b><span>${esc(t('tile.prompts', { n: res.prompts.length }))}</span></div>
      <div class="tile"><b>${num(computed)}</b><span>${esc(t('tile.computed'))}</span></div>
      <div class="tile"><b>${num(tokens - computed)}</b><span>${esc(t('tile.reused'))}</span></div>
    </div>
    <p class="chart-label">${esc(t('ans.where'))}</p><div class="chart run-chart" id="c-run"></div>`;
  charts.push(['c-run', runChart({ rows: res.prompts.map((p, i) => {
    const d = res.details[p.question];
    const perLabel = d.prompts.length > 1 && d.prompts.length === d.keys.length; // multi: one prompt per label
    const branch = perLabel ? ` · ${d.keys[d.prompts.indexOf(i)]}` : '';
    return { label: `${p.question}${branch}`, reused: (log[i]?.promptTokens ?? 0) - (log[i]?.evaluated ?? 0),
      computed: log[i]?.evaluated ?? 0, ms: log[i]?.ms ?? 0 };
  }) })]);
  Object.entries(res.answers).forEach(([name, a], qi) => {
    const d = res.details[name];
    const q = questions.get(name);
    const instr = q instanceof Map && q.has('instructions') ? text(q.get('instructions')) : '';
    const lang = (d.lang ?? langs.get(name) ?? 'en').toUpperCase();
    let chartHtml = '';
    chartsOf(a, d).forEach(([title, build], ci) => {
      const id = `c-${qi}-${ci}`;
      chartHtml += `${title ? `<p class="chart-label">${esc(title)}</p>` : ''}<div class="chart" id="${id}"></div>`;
      charts.push([id, build]);
    });
    if (d.keys.length > 12 && a.type !== 'score') chartHtml += `<p class="more">${esc(t('chart.more', { n: d.keys.length }))}</p>`;
    html += `<section class="answer" aria-label="${esc(name)}">
      <div class="answer-head"><span class="answer-name">${esc(name)}</span><span class="tag">${esc(typeName(a.type))}</span>
        <span class="tag" title="${esc(t('lang.promptTag'))}">${lang}</span>${pillOf(a, d)}</div>
      ${instr ? `<p class="answer-q">${esc(instr)}</p>` : ''}
      <div class="verdict">${verdictOf(a, d)}</div>
      ${chartHtml}
      <div class="disclosures">
        <details><summary>${esc(t('d.table'))}</summary>${tableOf(a, d)}</details>
        <details><summary>${esc(t('d.prompt'))}</summary>${promptsHtml(res, d)}</details>
        <details><summary>${esc(t('d.json'))}</summary><pre class="json">${esc(JSON.stringify(a, null, 2))}</pre></details>
      </div>
    </section>`;
  });
  root.innerHTML = html;
  for (const [id, build] of charts) {
    if (seq !== renderSeq) return;
    await mount($(id), build);
  }
  pipelineFigures(res, log, ms);
}

function pipelineFigures(res, log, ms) {
  const tokens = log.reduce((s, l) => s + (l.promptTokens || 0), 0);
  const computed = log.reduce((s, l) => s + (l.evaluated || 0), 0);
  const first = Object.values(res.details)[0];
  const temps = [...new Set(Object.values(res.details).map((d) => num(d.temperature, 2)))];
  const topRaw = Math.max(...first.raw);
  const nq = Object.keys(res.answers).length;
  const figs = {
    request: t('fig.questions', { n: nq }),
    prompts: t('fig.prompts', { n: res.prompts.length, t: num(tokens) }),
    engine: t('fig.engine', { c: num(computed), r: num(tokens - computed) }),
    top: t('fig.top', { k: Math.max(20, first.keys.length + 10), v: num(32000) }),
    codes: `${CODES[first.raw.indexOf(topRaw)]} = ${pct(topRaw)}`,
    temp: `T = ${temps.join(' · ')}`,
    answers: t('fig.answers', { s: num(ms / 1000, 1) }),
  };
  for (const el of document.querySelectorAll('.pipeline .fig')) el.textContent = figs[el.dataset.fig] ?? '';
}

// ---------------------------------------------------------------------------------------------------------------
// Running a request

function showRunning(i, n, question) {
  $('answers').innerHTML = `<div class="running"><p>${esc(t('run.reading', { i, n }))} · <span class="mono">${esc(question)}</span></p>
    <div class="running-bar"><i style="width:${Math.round((100 * (i - 1)) / n)}%"></i></div></div>`;
}

async function run() {
  let request;
  try {
    request = currentRequest();
  } catch (e) {
    $('answers').innerHTML = `<div class="error-box">${esc(t('run.badJson', { error: e.message }))}</div>`;
    return;
  }
  const btn = $('run');
  btn.disabled = true;
  unmountWithin($('answers'));
  shown = null;
  const n0 = engine.log.length;
  const t0 = performance.now();
  let started = 0;
  const tick = setInterval(() => bind($('run-status'), 'run.deciding', { s: Math.round((performance.now() - t0) / 1000) }), 250);
  try {
    const items = toItems(request.get('state'), request.get('questions'), request.get('lang') ?? null);
    const names = promptsOf(items).map((j) => items[j.item].name);
    const readout = async (prompts) => {
      const out = [];
      for (const p of prompts) {
        showRunning(++started, prompts.length, names[started - 1] ?? '');
        out.push(...(await engine.readout([p])));
      }
      return out;
    };
    const res = await decide(request, { readout, calibration: await calibration });
    const log = engine.log.slice(n0);
    const ms = performance.now() - t0;
    window.lastRun = { requestText: pretty(request), result: res, log, ms, threads: engine.checks.threads,
      date: new Date().toISOString() };
    await renderResult(res, log, { example: false, ms, threads: engine.checks.threads, request, time: new Date() });
    clearInterval(tick);
    bind($('run-status'), 'run.done', { s: round(ms / 1000, 1) });
  } catch (e) {
    clearInterval(tick);
    $('answers').innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
    bind($('run-status'), 'run.fix');
  } finally {
    btn.disabled = false;
  }
}
$('run').onclick = run;

// ---------------------------------------------------------------------------------------------------------------
// Hero readout and the example result

function heroPrompt(prompt) {
  const at = Math.max(prompt.lastIndexOf('\n\nPytanie: '), prompt.lastIndexOf('\n\nQuestion: '));
  const tail = prompt.slice(at + 2);
  const prefill = '{"answer": "';
  const body = esc(tail.slice(0, tail.length - prefill.length))
    .replace(/&lt;\|im_(start|end)\|&gt;/g, (m) => `<span class="tok">${m}</span>`);
  $('readout-prompt').innerHTML = `${body}<span class="prefill">${esc(prefill)}</span><span class="caret" aria-hidden="true"></span>`;
}

async function showExample() {
  let ex = null;
  try {
    const r = await fetch(new URL('./example-result.json', import.meta.url));
    if (r.ok) ex = await r.json();
  } catch {
    ex = null;
  }
  if (!ex) {
    const preset = fromPlain(PRESETS[0].request);
    const items = toItems(preset.get('state'), preset.get('questions'));
    heroPrompt(promptsOf(items)[0].prompt);
    $('readout-chart').hidden = true;
    $('answers').innerHTML = `<p class="empty">${esc(t('ans.empty'))}</p>`;
    return;
  }
  const request = parse(ex.requestText);
  const res = ex.result;
  heroPrompt(res.prompts[0].prompt);
  const d = res.details[res.prompts[0].question];
  const top = d.raw.indexOf(Math.max(...d.raw));
  mount($('readout-chart'), readoutChart({ rows: d.keys.map((k, i) => ({ code: CODES[i], text: optText(d, i) || k, p: d.raw[i], top: i === top })) }));
  if (!shown) await renderResult(res, ex.log, { example: true, ms: ex.ms, threads: ex.threads, request });
}

// ---------------------------------------------------------------------------------------------------------------
// Page language

function langButtons() {
  for (const b of document.querySelectorAll('[data-set-lang]')) b.setAttribute('aria-pressed', String(b.dataset.setLang === getLang()));
}
document.querySelector('.langs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-set-lang]');
  if (b) setLang(b.dataset.setLang);
});
addEventListener('langchange', () => {
  langButtons();
  renderChips();
  builder.refresh();
  if (!jsonError) jsonNote();
  loadButton();
  envFacts();
  if (model.state === 'loading') progressText();
  if (shown) renderResult(shown.res, shown.log, shown.meta);
});

// ---------------------------------------------------------------------------------------------------------------

apply();
langButtons();
// ?example=N opens that example in the workbench (the links of system-one.html)
const linked = Number(new URLSearchParams(location.search).get('example'));
activeExample = Number.isInteger(linked) && PRESETS[linked] ? linked : 0;
renderChips();
setRequest(fromPlain(PRESETS[activeExample].request));
// the browser jumps to #try before the form exists; jump again once it is drawn
if (/^#[\w-]+$/.test(location.hash)) requestAnimationFrame(() => document.querySelector(location.hash)?.scrollIntoView());
loadButton();
envFacts();
showExample();
if (await cachedModel()) {
  model.cached = true;
  envFacts();
  bind($('model-status'), 'load.cached');
  load();
}
