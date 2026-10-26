// "Many rows": the workbench's questions asked about every row of a file (CSV, TSV, JSONL, XLSX), with progress that
// survives a reload (IndexedDB), the answers as a table to download, and, given a column of correct answers, accuracy,
// a confusion matrix, calibration and how much could be automated at which error.
import { decide, promptsOf, text, toItems } from './basal.js';
import { confusionChart, countChart, coverageChart, histChart, mount, reliabilityChart, unmountWithin } from './charts.js';
import { isAbort } from './engine.js';
import { num, pct, t } from './i18n.js';
import { parse } from './ojson.js';
import { accuracy, confidenceOf, confusion, coverageCurve, goldOf, histogram, optionText, predictedOf, reliability, same } from './stats.js';
import { clearJob, loadJob, saveJob, saveRow, updateJob } from './store.js';
import { cellText, readTable, tableFromRows, toCsv, toJsonl } from './table.js';

const PAGE = 50;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const lcp = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

export function duration(seconds) {
  const s = Math.max(1, Math.round(seconds));
  if (s < 90) return t('dur.s', { n: s });
  if (s < 90 * 60) return t('dur.min', { n: Math.round(s / 60) });
  return t('dur.h', { h: Math.floor(s / 3600), m: Math.round((s % 3600) / 60) });
}

const scripts = new Map();
function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error(`could not load ${src}`));
      document.head.append(el);
    }));
  }
  return scripts.get(src);
}

const xlsxCell = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? '' : v);

async function readFile(file) {
  if (/\.xlsx$/i.test(file.name)) {
    await loadScript(new URL('../vendor/xlsx/read-excel-file.min.js', import.meta.url).href);
    const out = await window.readXlsxFile(file);
    const sheets = Array.isArray(out) && out[0] && typeof out[0] === 'object' && 'data' in out[0] ? out : [{ sheet: 'Sheet1', data: out }];
    return sheets.map((s) => ({ name: s.sheet, table: tableFromRows(s.data.map((r) => r.map(xlsxCell))) }));
  }
  return [{ name: '', table: readTable(file.name, await file.text()) }];
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * root: the section's container. engine, calibration (a promise), getRequest() (the workbench request, throws when it
 * can't be read), setExample(i) (load an example into the workbench), renderAnswers(root, res, log, meta) (the answer
 * cards), threads() (the engine's thread count).
 */
export function initBatch(root, { engine, calibration, getRequest, setExample, renderAnswers, threads }) {
  const $ = (sel) => root.querySelector(sel);
  const ui = {
    file: null, // {name, sheets: [{name, table}], sheet}
    stateCols: [], // column indices of the state
    gold: {}, // question name -> column index
    job: null, // {fileName, columns, rows, stateCols, gold, requestText}
    results: new Map(), // row index -> {res, log, ms} or {error, ms}
    run: 'idle', // idle | running | paused | stopped | done
    ctrl: null,
    started: 0,
    page: 0,
    selected: null, // question name shown in the charts
    detail: null, // row index shown in detail
    saved: null, // a saved job not yet restored: {job, results}
    wake: null,
  };

  const table = () => (ui.job ? { columns: ui.job.columns, rows: ui.job.rows } : ui.file?.sheets[ui.file.sheet].table);

  function questions() {
    try {
      const req = getRequest();
      return { req, items: toItems(req.get('state'), req.get('questions'), req.get('lang') ?? null) };
    } catch (e) {
      return { error: e.message };
    }
  }

  function rowRequest(req, columns, row, stateCols) {
    const state = stateCols.length === 1 ? row[stateCols[0]]
      : new Map(stateCols.map((c) => [columns[c], row[c]]));
    return new Map([...req].map(([k, v]) => [k, k === 'state' ? (typeof state === 'string' || state instanceof Map ? state : cellText(state)) : v]));
  }

  // ------------------------------------------------------------------------------------------------- setup

  function defaultMapping(tbl, items) {
    const avg = tbl.columns.map((_, c) => tbl.rows.slice(0, 50).reduce((s, r) => s + cellText(r[c]).length, 0));
    ui.stateCols = [avg.indexOf(Math.max(...avg))];
    ui.gold = {};
    for (const q of items ?? []) {
      const c = tbl.columns.findIndex((name) => name.trim().toLowerCase() === q.name.toLowerCase());
      if (c >= 0 && !ui.stateCols.includes(c)) ui.gold[q.name] = c;
    }
  }

  async function openFile(file) {
    try {
      const sheets = await readFile(file);
      ui.file = { name: file.name, sheets, sheet: 0 };
      ui.job = null;
      ui.results = new Map();
      ui.run = 'idle';
      ui.detail = null;
      defaultMapping(sheets[0].table, questions().items);
      render();
    } catch (e) {
      $('#bt-file-msg').innerHTML = `<span class="error-text">${esc(t('batch.readError', { error: e.message }))}</span>`;
    }
  }

  async function openSample() {
    setExample(0);
    const res = await fetch(new URL('../examples/zgloszenia.csv', import.meta.url));
    await openFile(new File([await res.text()], 'zgloszenia.csv', { type: 'text/csv' }));
    const tbl = table();
    ui.stateCols = [tbl.columns.indexOf('tresc')];
    ui.gold = { category: tbl.columns.indexOf('kategoria') };
    render();
  }

  function renderFile() {
    const f = ui.file;
    const tbl = table();
    const info = f || ui.job ? `<p class="bt-info"><b>${esc(f?.name ?? ui.job.fileName)}</b> · ${esc(t('batch.rows', { n: tbl.rows.length }))} ·
      ${esc(t('batch.cols', { n: tbl.columns.length }))}</p>` : '';
    const sheetSel = f && f.sheets.length > 1 ? `<label class="bt-inline">${esc(t('batch.sheet'))}
      <select id="bt-sheet">${f.sheets.map((s, i) => `<option value="${i}" ${i === f.sheet ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : '';
    const preview = tbl && tbl.rows.length ? `<div class="table-wrap bt-preview"><table><thead><tr>${tbl.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${tbl.rows.slice(0, 5).map((r) => `<tr>${r.map((v) => `<td>${esc(cellText(v).slice(0, 120))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      : tbl ? `<p class="hint">${esc(t('batch.empty'))}</p>` : '';
    $('#bt-file').innerHTML = `
      <label class="drop" id="bt-drop" for="bt-input">
        <input type="file" id="bt-input" accept=".csv,.tsv,.txt,.jsonl,.ndjson,.xlsx" ${ui.run === 'running' ? 'disabled' : ''}>
        <span>${t('batch.drop')}</span>
      </label>
      <div class="bt-sample"><button type="button" class="btn btn-ghost" id="bt-sample" ${ui.run === 'running' ? 'disabled' : ''}>${esc(t('batch.sample'))}</button>
        <span class="hint">${esc(t('batch.sampleNote'))}</span></div>
      <p id="bt-file-msg"></p>${info}${sheetSel}${preview}`;
  }

  function renderMapping() {
    const tbl = table();
    const box = $('#bt-map');
    box.hidden = !tbl || !tbl.rows.length;
    if (box.hidden) return;
    const q = questions();
    const locked = ui.run === 'running' || ui.results.size > 0;
    const stateCols = ui.job?.stateCols ?? ui.stateCols;
    const gold = ui.job?.gold ?? ui.gold;
    const qs = q.error ? `<p class="error-text">${esc(t('batch.badRequest', { error: q.error }))}</p>` : `<div class="bt-gold">
      ${q.items.map((it) => `<label><span><span class="mono">${esc(it.name)}</span> <span class="tag">${esc(t(`type.${it.type}`))}</span></span>
        <select data-gold="${esc(it.name)}" ${locked ? 'disabled' : ''}><option value="">${esc(t('batch.goldNone'))}</option>
        ${tbl.columns.map((c, i) => `<option value="${i}" ${gold[it.name] === i ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>`).join('')}
      </div>`;
    box.innerHTML = `
      <h3><span class="step">2</span>${esc(t('batch.step2'))}</h3>
      <div class="bt-cols"><span class="field-label">${esc(t('batch.stateCols'))}</span>
        <div class="bt-checks">${tbl.columns.map((c, i) => `<label class="check"><input type="checkbox" data-state="${i}"
          ${stateCols.includes(i) ? 'checked' : ''} ${locked ? 'disabled' : ''}> ${esc(c)}</label>`).join('')}</div>
        <p class="hint">${esc(t('batch.stateHint'))}</p></div>
      <div class="bt-cols"><span class="field-label">${esc(t('batch.gold'))} · ${esc(t('batch.questions'))}
        <a href="#try">${esc(t('batch.editQuestions'))}</a></span>${qs}</div>`;
  }

  function estimate() {
    const q = questions();
    const tbl = table();
    if (q.error || !tbl?.rows.length || !ui.stateCols.length) return null;
    const sample = tbl.rows.slice(0, 5);
    let prev = '';
    let chars = 0;
    for (const row of sample) {
      const r = rowRequest(q.req, tbl.columns, row, ui.stateCols);
      for (const job of promptsOf(toItems(r.get('state'), r.get('questions'), r.get('lang') ?? null))) {
        chars += job.prompt.length - lcp(prev, job.prompt);
        prev = job.prompt;
      }
    }
    const left = tbl.rows.length - ui.results.size;
    const tokens = (chars / 3.2 / sample.length) * left;
    const tps = engine.tokensPerSecond() || 35;
    return { seconds: tokens / tps, tps, left };
  }

  function renderRun() {
    const box = $('#bt-run');
    const tbl = table();
    box.hidden = !tbl || !tbl.rows.length;
    if (box.hidden) return;
    const n = tbl.rows.length;
    const done = ui.results.size;
    let status = '';
    if (!engine.loaded) status = t(done ? 'batch.needModel' : 'batch.estimateNoModel');
    else if (ui.run === 'running') {
      const ms = [...ui.results.values()].slice(-10).reduce((s, r) => s + r.ms, 0) / Math.min(10, Math.max(1, ui.results.size));
      status = t('batch.progress', { i: Math.min(done + 1, n), n, left: duration(((n - done) * (ms || 5000)) / 1000) });
    } else if (ui.run === 'paused') status = t(ui.looping ? 'batch.pausing' : 'batch.paused', { i: done, n });
    else if (ui.run === 'stopped') status = t('batch.stopped', { i: done, n });
    else if (ui.run === 'done') status = t('batch.done', { rows: t('batch.rows', { n }), t: duration(totalMs() / 1000) });
    else {
      const e = estimate();
      if (e) status = t('batch.estimate', { t: duration(e.seconds), rows: t('batch.rowsFor', { n: e.left }), tps: Math.round(e.tps) });
    }
    const can = engine.loaded && !questions().error && ui.stateCols.length;
    const buttons = ui.run === 'running'
      ? `<button type="button" class="btn btn-ghost" id="bt-pause">${esc(t('batch.pause'))}</button>
         <button type="button" class="btn btn-ghost" id="bt-stop">${esc(t('batch.stop'))}</button>`
      : done && done < n && ui.run !== 'idle'
        ? `<button type="button" class="btn btn-primary" id="bt-start" ${can ? '' : 'disabled'}>${esc(t('batch.resume'))}</button>`
        : `<button type="button" class="btn btn-primary" id="bt-start" ${can && done < n ? '' : 'disabled'}>${esc(t('batch.start'))}</button>`;
    box.innerHTML = `<h3><span class="step">3</span>${esc(t('batch.step3'))}</h3>
      <div class="run-bar">${buttons}<p class="run-status">${esc(status)}</p></div>
      ${n > 1000 && !done ? `<p class="hint">${esc(t('batch.many'))}</p>` : ''}
      <div class="running-bar" ${done ? '' : 'hidden'}><i style="width:${(100 * done) / n}%"></i></div>`;
  }

  const totalMs = () => [...ui.results.values()].reduce((s, r) => s + (r.ms || 0), 0);

  // ------------------------------------------------------------------------------------------------- running

  async function wakeLock(on) {
    try {
      if (on && !ui.wake && navigator.wakeLock) ui.wake = await navigator.wakeLock.request('screen');
      if (!on && ui.wake) {
        await ui.wake.release();
        ui.wake = null;
      }
    } catch {
      ui.wake = null; // not granted: the run goes on, the screen may sleep
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ui.run === 'running') {
      ui.wake = null;
      wakeLock(true);
    }
  });

  async function start() {
    if (ui.looping) { // paused while a row was still being read: carry on in the same loop
      ui.run = 'running';
      renderRun();
      return;
    }
    const q = questions();
    if (q.error || !engine.loaded) return;
    if (!ui.job) {
      const tbl = table();
      ui.job = { fileName: ui.file.name, columns: tbl.columns, rows: tbl.rows, stateCols: [...ui.stateCols], gold: { ...ui.gold },
        requestText: pretty(q.req), questions: q.items.map((it) => it.name), threads: threads(),
        startedAt: new Date().toISOString() };
      await saveJob(ui.job);
    }
    ui.run = 'running';
    ui.looping = true;
    ui.ctrl = new AbortController();
    wakeLock(true);
    render();
    const req = parse(ui.job.requestText);
    let lastDraw = performance.now();
    for (let i = 0; i < ui.job.rows.length; i++) {
      if (ui.results.has(i)) continue;
      if (ui.run !== 'running') break;
      const r = rowRequest(req, ui.job.columns, ui.job.rows[i], ui.job.stateCols);
      const n0 = engine.log.length;
      const t0 = performance.now();
      let result;
      try {
        const res = await decide(r, { readout: (ps) => engine.readout(ps, { signal: ui.ctrl.signal }), calibration: await calibration });
        result = { res, log: engine.log.slice(n0).map(({ promptTokens, evaluated, ms }) => ({ promptTokens, evaluated, ms })),
          ms: performance.now() - t0 };
      } catch (e) {
        if (isAbort(e)) break;
        result = { error: e.message, ms: performance.now() - t0 };
      }
      ui.results.set(i, result);
      saveRow(i, result);
      renderRun();
      if (performance.now() - lastDraw > 4000 || ui.results.size === 1) {
        renderResults();
        lastDraw = performance.now();
      }
    }
    ui.looping = false;
    if (ui.run === 'running' || ui.results.size >= ui.job.rows.length) ui.run = ui.results.size >= ui.job.rows.length ? 'done' : 'stopped';
    updateJob({ status: ui.run });
    wakeLock(false);
    render();
  }

  // ------------------------------------------------------------------------------------------------- results

  function graded(name) {
    const gcol = ui.job.gold[name];
    const pts = [];
    let unmatched = 0;
    let detail = null;
    let type = null;
    let multi = false;
    for (const [i, r] of ui.results) {
      if (!r.res) continue;
      const a = r.res.answers[name];
      const d = r.res.details[name];
      detail ??= d;
      type ??= a.type;
      multi = multi || Boolean(a.multi);
      const cell = gcol === undefined || gcol === null ? null : ui.job.rows[i][gcol];
      const gold = cell === null ? null : goldOf(a.type, d, cell, { multi: a.multi });
      if (cell !== null && cellText(cell).trim() && gold === null) unmatched++;
      pts.push({ row: i, gold, predicted: predictedOf(a, d), confidence: confidenceOf(a), deferred: Boolean(a.deferred) });
    }
    return { pts, unmatched, detail, type, multi };
  }

  const labelOf = (d, key) => {
    const i = d.keys.indexOf(String(key));
    const txt = i >= 0 ? optionText(d, i) : '';
    return txt && txt !== String(key) ? `${key} · ${txt}` : String(key);
  };

  async function certifiedFor(type, d) {
    const cal = await calibration;
    const kind = type === 'noul' || (type === 'act' && d.keys[0] === 'true') ? 'noul' : type === 'score' ? 'score' : 'choice';
    return cal.thresholds?.['0.05']?.per_type?.[kind]?.confidence ?? null;
  }

  function predictedLabel(a, d) {
    const p = predictedOf(a, d);
    return Array.isArray(p) ? p.join(', ') : labelOf(d, p).split(' · ')[0];
  }

  async function renderResults() {
    const box = $('#bt-results');
    unmountWithin(box);
    if (!ui.job || !ui.results.size) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const names = ui.job.questions;
    if (!names.includes(ui.selected)) ui.selected = names[0];
    const ok = [...ui.results.values()].filter((r) => r.res);
    const errors = ui.results.size - ok.length;
    const anyGold = names.some((n) => ui.job.gold[n] !== undefined && ui.job.gold[n] !== null);
    const allPts = names.flatMap((n) => graded(n).pts);
    const acc = accuracy(allPts);
    const charts = [];
    const g = graded(ui.selected);
    const d = g.detail;
    let qHtml = '';
    if (d) {
      // what the model answered, and how sure it was
      const counts = new Map();
      for (const p of g.pts) for (const k of [p.predicted].flat()) counts.set(k, (counts.get(k) || 0) + 1);
      const keys = g.multi || g.type === 'multi' ? d.keys : d.keys.filter((k) => counts.has(k) || d.keys.length <= 12);
      const rows = keys.map((k) => ({ label: labelOf(d, k), count: counts.get(k) || 0 })).slice(0, 12);
      const cert = await certifiedFor(g.type, d);
      charts.push(['bt-c-count', countChart({ rows })]);
      charts.push(['bt-c-hist', histChart({ counts: histogram(g.pts.map((p) => p.confidence)), threshold: cert,
        thresholdLabel: cert === null ? '' : t('batch.certified', { p: pct(cert) }) })]);
      let goldHtml = `<p class="hint">${esc(t('batch.noGold'))}</p>`;
      const qa = accuracy(g.pts);
      if (qa.n) {
        const single = !(g.multi || g.type === 'multi');
        goldHtml = `<p class="bt-acc">${esc(t('batch.accuracyQ', { p: pct(qa.accuracy), right: qa.right, n: qa.n }))}
          ${g.unmatched ? `<span class="hint"> ${esc(t('batch.unmatched', { n: g.unmatched }))}</span>` : ''}</p>
          <div class="bt-charts">
            ${single && d.keys.length <= 12 ? `<div><p class="chart-label">${esc(t('batch.confusion'))}</p><div class="chart" id="bt-c-conf"></div></div>` : ''}
            <div><p class="chart-label">${esc(t('batch.calibration'))}</p><div class="chart" id="bt-c-rel"></div></div>
            <div><p class="chart-label">${esc(t('batch.coverage'))}</p><div class="chart" id="bt-c-cov"></div></div>
          </div>`;
        if (single && d.keys.length <= 12) charts.push(['bt-c-conf', confusionChart({ keys: d.keys, matrix: confusion(d.keys, g.pts) })]);
        charts.push(['bt-c-rel', reliabilityChart({ bins: reliability(g.pts) })]);
        const curve = coverageCurve(g.pts);
        charts.push(['bt-c-cov', coverageChart({ curve, threshold: cert, thresholdLabel: cert === null ? '' : t('batch.certified', { p: pct(cert) }) })]);
      }
      qHtml = `<div class="bt-charts">
          <div><p class="chart-label">${esc(t('batch.answers'))}</p><div class="chart" id="bt-c-count"></div></div>
          <div><p class="chart-label">${esc(t('batch.confidence'))}</p><div class="chart" id="bt-c-hist"></div></div>
        </div>${goldHtml}`;
    }
    // the table, one page
    const order = [...ui.results.keys()].sort((a, b) => a - b);
    const pages = Math.max(1, Math.ceil(order.length / PAGE));
    ui.page = Math.min(ui.page, pages - 1);
    const req = parse(ui.job.requestText);
    const rowsHtml = order.slice(ui.page * PAGE, (ui.page + 1) * PAGE).map((i) => {
      const r = ui.results.get(i);
      const state = text(rowRequest(req, ui.job.columns, ui.job.rows[i], ui.job.stateCols).get('state'));
      const cells = names.map((n) => {
        if (!r.res) return `<td class="error-text">${esc(t('batch.rowError', { error: r.error }))}</td>`;
        const a = r.res.answers[n];
        const dd = r.res.details[n];
        const gcol = ui.job.gold[n];
        const gold = gcol === undefined || gcol === null ? null : goldOf(a.type, dd, ui.job.rows[i][gcol], { multi: a.multi });
        const mark = gold === null ? '' : same(gold, predictedOf(a, dd)) ? '<span class="ok" aria-label="✓">✓</span>' : '<span class="bad" aria-label="✗">✗</span>';
        const conf = confidenceOf(a);
        return `<td>${mark}${esc(predictedLabel(a, dd))} <span class="muted mono">${conf === null ? '' : pct(conf)}</span>${a.deferred ? ` <span class="pill defer">${esc(t('v.deferred'))}</span>` : ''}</td>`;
      }).join('');
      return `<tr data-row="${i}" tabindex="0" class="${ui.detail === i ? 'is-sel' : ''}"><td class="n">${i + 1}</td><td class="bt-state">${esc(state.slice(0, 90))}${state.length > 90 ? '…' : ''}</td>${cells}</tr>`;
    }).join('');
    const ms = totalMs();
    box.innerHTML = `
      <div class="ans-head"><h3>${esc(t('batch.results'))}</h3>
        <span class="bt-dl">${esc(t('batch.download'))}: <button type="button" class="link-btn" data-dl="csv">CSV</button>
          <button type="button" class="link-btn" data-dl="xlsx">XLSX</button> <button type="button" class="link-btn" data-dl="jsonl">JSONL</button></span></div>
      <div class="tiles">
        <div class="tile"><b>${num(ui.results.size)}</b><span>${esc(t('batch.tileRows', { n: ui.results.size }))}</span></div>
        <div class="tile"><b>${duration(ms / 1000)}</b><span>${esc(t('tile.total'))}</span></div>
        <div class="tile"><b>${num(ms / 1000 / Math.max(1, ui.results.size), 1)} s</b><span>${esc(t('batch.tilePerRow'))}</span></div>
        <div class="tile"><b>${anyGold && acc.n ? pct(acc.accuracy) : errors ? num(errors) : '–'}</b><span>${esc(anyGold && acc.n ? t('batch.tileAccuracy') : errors ? t('batch.tileErrors', { n: errors }) : t('batch.tileAccuracy'))}</span></div>
      </div>
      <div class="examples bt-qs" role="group">${names.map((n) => `<button type="button" class="chip" data-q="${esc(n)}" aria-pressed="${n === ui.selected}">${esc(n)}</button>`).join('')}</div>
      ${qHtml}
      <div class="table-wrap bt-table"><table><thead><tr><th class="n">${esc(t('batch.row'))}</th><th>${esc(t('batch.state'))}</th>
        ${names.map((n) => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table></div>
      <div class="bt-pager">${pages > 1 ? `<button type="button" class="link-btn" data-page="-1" ${ui.page ? '' : 'disabled'}>${esc(t('batch.prev'))}</button>
        <span>${esc(t('batch.page', { i: ui.page + 1, n: pages }))}</span>
        <button type="button" class="link-btn" data-page="1" ${ui.page < pages - 1 ? '' : 'disabled'}>${esc(t('batch.next'))}</button>` : ''}
        <span class="hint">${esc(t('batch.clickRow'))}</span></div>
      <div id="bt-detail" class="bt-detail"></div>`;
    for (const [id, build] of charts) {
      const el = root.querySelector(`#${id}`);
      if (el) await mount(el, build);
    }
    if (ui.detail !== null) showDetail(ui.detail);
  }

  async function showDetail(i) {
    const r = ui.results.get(i);
    const box = $('#bt-detail');
    if (!r?.res || !box) return;
    ui.detail = i;
    for (const tr of root.querySelectorAll('tr[data-row]')) tr.classList.toggle('is-sel', +tr.dataset.row === i);
    const req = rowRequest(parse(ui.job.requestText), ui.job.columns, ui.job.rows[i], ui.job.stateCols);
    box.innerHTML = `<h3>${esc(t('batch.detail', { i: i + 1 }))}</h3><div class="bt-detail-cards"></div>`;
    await renderAnswers(box.querySelector('.bt-detail-cards'), r.res, r.log, { example: false, ms: r.ms,
      threads: ui.job.threads, request: req, time: new Date(ui.job.startedAt) });
  }

  // ------------------------------------------------------------------------------------------------- export

  function exportRows() {
    const names = ui.job.questions;
    const head = [...ui.job.columns];
    for (const n of names) {
      head.push(n, `${n}_confidence`);
      if (ui.job.gold[n] !== undefined && ui.job.gold[n] !== null) head.push(`${n}_correct`);
      head.push(`${n}_deferred`);
    }
    const rows = [...ui.results.keys()].sort((a, b) => a - b).map((i) => {
      const r = ui.results.get(i);
      const out = [...ui.job.rows[i]];
      for (const n of names) {
        const a = r.res?.answers[n];
        const d = r.res?.details[n];
        if (!a) {
          out.push(r.error ?? '', '');
          if (ui.job.gold[n] !== undefined && ui.job.gold[n] !== null) out.push('');
          out.push('');
          continue;
        }
        const p = predictedOf(a, d);
        const conf = confidenceOf(a);
        out.push(Array.isArray(p) ? p.join('; ') : p, conf === null ? '' : Math.round(conf * 1e4) / 1e4);
        if (ui.job.gold[n] !== undefined && ui.job.gold[n] !== null) {
          const gold = goldOf(a.type, d, ui.job.rows[i][ui.job.gold[n]], { multi: a.multi });
          out.push(gold === null ? '' : same(gold, p) ? 1 : 0);
        }
        out.push(a.deferred ? 1 : 0);
      }
      return out;
    });
    return { head, rows };
  }

  async function exportAs(kind) {
    const base = ui.job.fileName.replace(/\.[^.]+$/, '');
    const { head, rows } = exportRows();
    if (kind === 'csv') download(new Blob([toCsv(head, rows)], { type: 'text/csv;charset=utf-8' }), `${base}-basal.csv`);
    else if (kind === 'jsonl') {
      const objects = [...ui.results.keys()].sort((a, b) => a - b).map((i) => {
        const r = ui.results.get(i);
        return { row: i + 1, input: Object.fromEntries(ui.job.columns.map((c, j) => [c, ui.job.rows[i][j]])),
          ...(r.res ? { answers: r.res.answers } : { error: r.error }) };
      });
      download(new Blob([toJsonl(objects)], { type: 'application/x-ndjson' }), `${base}-basal.jsonl`);
    } else {
      await loadScript(new URL('../vendor/xlsx/write-excel-file.min.js', import.meta.url).href);
      const sheet = [head, ...rows].map((r) => r.map((v) => (v === '' || v === null || v === undefined ? null
        : typeof v === 'number' || typeof v === 'boolean' ? v : cellText(v))));
      download(await window.writeXlsxFile(sheet).toBlob(), `${base}-basal.xlsx`);
    }
  }

  // ------------------------------------------------------------------------------------------------- saved job

  function renderSaved() {
    const box = $('#bt-saved');
    const s = ui.saved;
    box.hidden = !s;
    if (!s) return;
    const n = s.job.rows.length;
    const msg = s.results.size < n ? t('batch.unfinished', { done: s.results.size, n, name: s.job.fileName })
      : t('batch.saved', { n, name: s.job.fileName });
    box.innerHTML = `<p>${esc(msg)}</p><button type="button" class="btn btn-primary" id="bt-restore">${esc(t(s.results.size < n ? 'batch.restore' : 'batch.show'))}</button>
      <button type="button" class="btn btn-ghost" id="bt-discard">${esc(t('batch.discard'))}</button>`;
  }

  function restore() {
    const s = ui.saved;
    ui.saved = null;
    ui.job = s.job;
    ui.results = s.results;
    ui.file = null;
    ui.stateCols = s.job.stateCols;
    ui.gold = s.job.gold;
    ui.run = s.results.size >= s.job.rows.length ? 'done' : 'paused';
    render();
  }

  // ------------------------------------------------------------------------------------------------- events

  function render() {
    renderSaved();
    renderFile();
    renderMapping();
    renderRun();
    renderResults();
  }

  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'bt-input' && el.files[0]) openFile(el.files[0]);
    else if (el.id === 'bt-sheet') {
      ui.file.sheet = +el.value;
      defaultMapping(table(), questions().items);
      render();
    } else if (el.dataset.state !== undefined) {
      const c = +el.dataset.state;
      ui.stateCols = el.checked ? [...ui.stateCols, c].sort((a, b) => a - b) : ui.stateCols.filter((x) => x !== c);
      renderRun();
    } else if (el.dataset.gold !== undefined) {
      if (el.value === '') delete ui.gold[el.dataset.gold];
      else ui.gold[el.dataset.gold] = +el.value;
    }
  });

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button, tr[data-row]');
    if (!b) return;
    if (b.id === 'bt-sample') openSample();
    else if (b.id === 'bt-start') start();
    else if (b.id === 'bt-pause') {
      ui.run = 'paused'; // the row being read finishes first
      renderRun();
    } else if (b.id === 'bt-stop') {
      ui.run = 'stopped';
      ui.ctrl?.abort();
      renderRun();
    } else if (b.id === 'bt-restore') restore();
    else if (b.id === 'bt-discard') {
      ui.saved = null;
      clearJob();
      renderSaved();
    } else if (b.dataset.dl) exportAs(b.dataset.dl);
    else if (b.dataset.q) {
      ui.selected = b.dataset.q;
      renderResults();
    } else if (b.dataset.page) {
      ui.page += +b.dataset.page;
      renderResults();
    } else if (b.dataset.row !== undefined) showDetail(+b.dataset.row);
  });
  root.addEventListener('keydown', (e) => {
    const tr = e.target.closest?.('tr[data-row]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      showDetail(+tr.dataset.row);
    }
  });

  // drag and drop onto the drop zone
  root.addEventListener('dragover', (e) => {
    if (!e.target.closest('#bt-drop')) return;
    e.preventDefault();
    e.target.closest('#bt-drop').classList.add('is-over');
  });
  root.addEventListener('dragleave', (e) => e.target.closest?.('#bt-drop')?.classList.remove('is-over'));
  root.addEventListener('drop', (e) => {
    const zone = e.target.closest('#bt-drop');
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove('is-over');
    if (e.dataTransfer.files[0] && ui.run !== 'running') openFile(e.dataTransfer.files[0]);
  });

  let pretty = (req) => JSON.stringify(req);
  render();
  loadJob().then((saved) => {
    if (saved && saved.job?.rows?.length) {
      ui.saved = saved;
      renderSaved();
    }
  });

  return {
    refresh: render, // a change of language
    refreshSetup() { // the model loaded or the questions changed: the mapping and the estimate
      renderMapping();
      renderRun();
    },
    setPretty: (fn) => (pretty = fn),
  };
}
