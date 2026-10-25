// The question builder: a form for the common question types, kept in sync with the request JSON.
//
// fromRequest() / toRequest() convert between a request (the Map form of ojson.parse) and the builder's model; they
// are pure and tested (test/builder.test.mjs). A question the form cannot show without losing something (tool, act,
// multi constraints, structured option texts...) stays in the model as `raw` and is emitted unchanged.
import { CODES, langOf, text } from './basal.js';
import { t } from './i18n.js';

export const TYPES = ['choice', 'noul', 'score', 'multi']; // the types the form edits; their names are in i18n.js

const isMap = (x) => x instanceof Map;
const isStr = (x) => typeof x === 'string';
const only = (q, keys) => [...q.keys()].every((k) => keys.includes(k));

// criteria as {key: text or null} or a list of keys -> rows, or null when a text is not a plain string
function rowsOf(crit) {
  if (Array.isArray(crit)) return crit.every(isStr) ? crit.map((k) => ({ key: k, text: '' })) : null;
  if (isMap(crit)) {
    const rows = [...crit].map(([k, v]) => ({ key: k, text: v === null ? '' : v }));
    return rows.every((r) => isStr(r.text)) ? rows : null;
  }
  return null;
}

function questionOf(name, q) {
  const raw = { name, kind: 'raw', raw: q };
  if (!isMap(q)) return raw;
  const type = q.get('type') ?? 'choice';
  const instructions = q.get('instructions') ?? '';
  if (!isStr(instructions)) return raw;
  const base = { name, kind: type, instructions, rows: [], showKeys: true, named: false, yes: '', no: '', threshold: 0.5 };
  if (type === 'choice') {
    if (!only(q, ['type', 'instructions', 'criteria', 'option_keys'])) return raw;
    const rows = rowsOf(q.get('criteria') ?? new Map());
    if (!rows) return raw;
    return { ...base, rows, showKeys: q.get('option_keys') !== 'hide' };
  }
  if (type === 'noul') {
    if (!only(q, ['type', 'instructions', 'criteria'])) return raw;
    const c = q.get('criteria') ?? new Map();
    if (!isMap(c) || !only(c, ['true', 'false'])) return raw;
    const t = c.get('true') ?? '';
    const f = c.get('false') ?? '';
    if (!isStr(t) || !isStr(f)) return raw;
    return { ...base, yes: t, no: f };
  }
  if (type === 'score') {
    if (!only(q, ['type', 'instructions', 'criteria', 'levels', 'option_keys'])) return raw;
    const levels = q.get('criteria') ?? q.get('levels') ?? [];
    if (Array.isArray(levels)) return levels.every(isStr) ? { ...base, rows: levels.map((t) => ({ key: '', text: t })) } : raw;
    const rows = rowsOf(levels);
    return rows ? { ...base, rows, named: true, showKeys: q.get('option_keys') !== 'hide' } : raw;
  }
  if (type === 'multi') {
    if (!only(q, ['type', 'instructions', 'criteria', 'threshold', 'objective'])) return raw;
    if ((q.get('objective') ?? 'threshold') !== 'threshold') return raw;
    const rows = rowsOf(q.get('criteria') ?? new Map());
    const th = q.has('threshold') ? +q.get('threshold') : 0.5;
    if (!rows || !(th >= 0 && th <= 1)) return raw;
    return { ...base, rows, threshold: th };
  }
  return raw;
}

/** A request Map -> the builder model {state, stateValue, questions, rest}. */
export function fromRequest(req) {
  const stateValue = req.get('state') ?? '';
  const questions = [...(req.get('questions') ?? new Map())].map(([name, q]) => questionOf(name, q));
  const rest = new Map([...req].filter(([k]) => k !== 'state' && k !== 'questions'));
  return { state: text(stateValue), stateValue, questions, rest };
}

// A short key from an option text, unique among `taken`.
export function keyFrom(textValue, taken) {
  const base = textValue.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'option';
  let k = base;
  for (let n = 2; taken.has(k); n++) k = `${base}_${n}`;
  return k;
}

// rows -> the criteria the request carries: a list of bare keys, or {key: text or null}; a row without a key gets
// one made from its text
function criteriaOf(rows) {
  const filled = rows.filter((r) => r.key.trim() || r.text.trim());
  const taken = new Set(filled.map((r) => r.key.trim()).filter(Boolean));
  const keyed = filled.map((r) => {
    let key = r.key.trim();
    if (!key) {
      key = keyFrom(r.text, taken);
      taken.add(key);
    }
    return { key, text: r.text };
  });
  if (keyed.every((r) => !r.text.trim())) return keyed.map((r) => r.key);
  return new Map(keyed.map((r) => [r.key, r.text.trim() ? r.text : null]));
}

function questionMap(q) {
  if (q.kind === 'raw') return q.raw;
  const m = new Map([['type', q.kind], ['instructions', q.instructions]]);
  if (q.kind === 'choice' || q.kind === 'multi') {
    m.set('criteria', criteriaOf(q.rows));
    if (q.kind === 'choice' && !q.showKeys) m.set('option_keys', 'hide');
    if (q.kind === 'multi' && q.threshold !== 0.5) m.set('threshold', q.threshold);
  } else if (q.kind === 'noul') {
    const c = new Map();
    if (q.yes.trim()) c.set('true', q.yes);
    if (q.no.trim()) c.set('false', q.no);
    if (c.size) m.set('criteria', c);
  } else if (q.kind === 'score') {
    if (q.named) {
      m.set('criteria', criteriaOf(q.rows));
      if (!q.showKeys) m.set('option_keys', 'hide');
    } else m.set('criteria', q.rows.map((r) => r.text).filter((t) => t.trim()));
  }
  return m;
}

/** The builder model -> a request Map (structured states and untouched raw questions are kept as they were). */
export function toRequest(model) {
  const state = model.state === text(model.stateValue) ? model.stateValue : model.state;
  const questions = new Map(model.questions.map((q) => [q.name, questionMap(q)]));
  return new Map([['state', state], ['questions', questions], ...model.rest]);
}

export const approxTokens = (s) => Math.round(s.length / 3.2);

// ---------------------------------------------------------------------------------------------------------------
// DOM

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function newQuestion(questions) {
  const names = new Set(questions.map((q) => q.name));
  let n = questions.length + 1;
  while (names.has(`q${n}`)) n++;
  return { name: `q${n}`, kind: 'choice', instructions: '', rows: [{ key: '', text: '' }, { key: '', text: '' }],
    showKeys: false, named: false, yes: '', no: '', threshold: 0.5 };
}

/**
 * Render the builder into `root`; onChange() runs after every edit. Returns {set(request), get(): request}.
 */
export function createBuilder(root, { onChange }) {
  let model = { state: '', stateValue: '', questions: [], rest: new Map() };
  const forced = () => (['pl', 'en'].includes(model.rest.get('lang')) ? model.rest.get('lang') : null);
  // the prompt language of a question, as basal decides it: the request's "lang", else Polish letters in the state
  // or the question
  const instrOf = (q) => (q.kind === 'raw' ? text(q.raw?.get?.('instructions') ?? '') : q.instructions);
  const lang = (q) => forced() ?? langOf(model.state + instrOf(q));

  function optionRows(q, qi) {
    const keyed = q.kind === 'choice' || q.kind === 'multi' || (q.kind === 'score' && q.named);
    const rows = q.rows.map((r, ri) => `
      <div class="opt" data-ri="${ri}">
        <span class="code" title="${esc(t('b.codeTitle'))}">${CODES[ri] ?? '·'}</span>
        ${keyed ? `<input class="opt-key mono" id="q${qi}-k${ri}" value="${esc(r.key)}" placeholder="${esc(t('b.key'))}"
          aria-label="${esc(t('b.keyAria', { c: CODES[ri] }))}" spellcheck="false">` : ''}
        <input class="opt-text" id="q${qi}-t${ri}" value="${esc(r.text)}"
          placeholder="${esc(q.kind === 'score' ? t(ri === 0 ? 'b.lowest' : 'b.next') : t('b.optPh'))}"
          aria-label="${esc(t('b.textAria', { c: CODES[ri] }))}">
        <button type="button" class="icon-btn" data-act="del-row" aria-label="${esc(t('b.removeOpt', { c: CODES[ri] }))}"
          ${q.rows.length <= 2 ? 'disabled' : ''}>×</button>
      </div>`).join('');
    const addKey = q.kind === 'score' ? 'b.addLevel' : q.kind === 'multi' ? 'b.addLabel' : 'b.addOption';
    const add = `<button type="button" class="link-btn" data-act="add-row">${esc(t(addKey))}</button>`;
    const hint = q.kind === 'score' ? `<p class="hint">${esc(t('b.scoreHint'))}</p>`
      : q.kind === 'multi' ? `<p class="hint">${esc(t('b.multiHint'))}</p>` : '';
    return `<div class="opts">${rows}</div><div class="opts-foot">${add}${hint}</div>`;
  }

  const langTag = (q) => `<span class="tag lang-tag" title="${esc(t('lang.promptTag'))}">${lang(q).toUpperCase()}</span>`;

  function card(q, qi) {
    const head = `
      <div class="q-head">
        <input class="q-name mono" id="q${qi}-name" value="${esc(q.name)}" aria-label="${esc(t('b.qName'))}" spellcheck="false">
        ${q.kind === 'raw' ? `<span class="tag">${esc(q.raw?.get?.('type') ?? 'choice')}</span>` : `
        <div class="seg" role="radiogroup" aria-label="${esc(t('b.qType'))}">
          ${TYPES.map((type) => `<button type="button" role="radio" aria-checked="${q.kind === type}"
            data-act="type" data-type="${type}">${esc(t(`type.${type}`))}</button>`).join('')}
        </div>`}
        <button type="button" class="icon-btn" data-act="del-q" aria-label="${esc(t('b.removeQ', { name: q.name }))}">×</button>
      </div>`;
    if (q.kind === 'raw') {
      const instr = instrOf(q);
      return `<article class="q q-raw" data-qi="${qi}">${head}
        <div class="q-text-row"><p class="q-raw-text">${esc(instr)}</p>${langTag(q)}</div>
        <p class="hint">${esc(t('b.raw'))}</p></article>`;
    }
    const pl = lang(q) === 'pl';
    let body = '';
    if (q.kind === 'noul') {
      body = `<div class="yn">
        <label><span class="code">A</span><input class="yn-yes" id="q${qi}-yes" value="${esc(q.yes)}" placeholder="${pl ? 'Tak' : 'Yes'}" aria-label="${esc(t('b.yesAria'))}"></label>
        <label><span class="code">B</span><input class="yn-no" id="q${qi}-no" value="${esc(q.no)}" placeholder="${pl ? 'Nie' : 'No'}" aria-label="${esc(t('b.noAria'))}"></label>
      </div><p class="hint">${esc(t('b.ynHint'))}</p>`;
    } else body = optionRows(q, qi);
    if (q.kind === 'choice' || (q.kind === 'score' && q.named)) {
      body += `<label class="check"><input type="checkbox" class="show-keys" id="q${qi}-show" ${q.showKeys ? 'checked' : ''}>
        ${esc(t('b.showKeys'))}</label>`;
    }
    if (q.kind === 'multi') {
      body += `<label class="range">${esc(t('b.threshold'))}
        <input type="range" class="threshold" id="q${qi}-th" min="0.05" max="0.95" step="0.05" value="${q.threshold}">
        <output class="mono">${Math.round(q.threshold * 100)}%</output></label>`;
    }
    return `<article class="q" data-qi="${qi}">${head}
      <div class="q-text-row"><input class="q-text" id="q${qi}-text" value="${esc(q.instructions)}"
        placeholder="${esc(t('b.qPh'))}" aria-label="${esc(t('b.qAria'))}">${langTag(q)}</div>${body}</article>`;
  }

  function langSwitch() {
    const cur = forced() ?? '';
    const opts = [['', t('b.auto')], ['pl', t('lang.pl')], ['en', t('lang.en')]];
    return `<div class="prompt-lang">
      <span class="field-label" id="b-lang-l">${esc(t('b.lang'))}</span>
      <div class="seg" role="radiogroup" aria-labelledby="b-lang-l">
        ${opts.map(([v, label]) => `<button type="button" role="radio" aria-checked="${cur === v}" data-act="lang"
          data-lang="${v}">${esc(label)}</button>`).join('')}
      </div>
      <p class="hint">${esc(t('b.langHint'))}</p>
    </div>`;
  }

  function render() {
    root.innerHTML = `
      <label class="field-label" for="b-state">${esc(t('b.state'))} <span class="muted" id="b-state-n">${esc(t('b.tokens', { n: approxTokens(model.state) }))}</span></label>
      <textarea id="b-state" class="state" spellcheck="false" placeholder="${esc(t('b.statePh'))}">${esc(model.state)}</textarea>
      ${langSwitch()}
      <div class="qs">${model.questions.map(card).join('')}</div>
      <button type="button" class="add-q" data-act="add-q">${esc(t('b.addQ'))}</button>`;
  }

  // the language tags follow every edit of the state or a question without redrawing the form (keeps the focus)
  function updateLangTags() {
    for (const el of root.querySelectorAll('[data-qi]')) {
      const tag = el.querySelector('.lang-tag');
      if (tag) tag.textContent = lang(model.questions[+el.dataset.qi]).toUpperCase();
    }
  }

  const changed = () => onChange?.();

  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'b-state') {
      model.state = el.value;
      root.querySelector('#b-state-n').textContent = t('b.tokens', { n: approxTokens(model.state) });
      updateLangTags();
      return changed();
    }
    const card = el.closest('[data-qi]');
    const q = card ? model.questions[+card.dataset.qi] : null;
    if (!q) return;
    if (el.classList.contains('q-name')) {
      const name = el.value.trim();
      if (name && !model.questions.some((o) => o !== q && o.name === name)) q.name = name; // names stay unique
    } else if (el.classList.contains('q-text')) {
      q.instructions = el.value;
      updateLangTags();
    } else if (el.classList.contains('opt-key')) q.rows[+el.closest('[data-ri]').dataset.ri].key = el.value;
    else if (el.classList.contains('opt-text')) q.rows[+el.closest('[data-ri]').dataset.ri].text = el.value;
    else if (el.classList.contains('yn-yes')) q.yes = el.value;
    else if (el.classList.contains('yn-no')) q.no = el.value;
    else if (el.classList.contains('show-keys')) q.showKeys = el.checked;
    else if (el.classList.contains('threshold')) {
      q.threshold = +el.value;
      el.nextElementSibling.textContent = `${Math.round(q.threshold * 100)}%`;
    }
    changed();
  });

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'add-q') model.questions.push(newQuestion(model.questions));
    else if (act === 'lang') {
      if (b.dataset.lang) model.rest.set('lang', b.dataset.lang);
      else model.rest.delete('lang');
    } else {
      const qi = +b.closest('[data-qi]').dataset.qi;
      const q = model.questions[qi];
      if (act === 'del-q') model.questions.splice(qi, 1);
      else if (act === 'add-row') q.rows.push({ key: '', text: '' });
      else if (act === 'del-row') q.rows.splice(+b.closest('[data-ri]').dataset.ri, 1);
      else if (act === 'type') {
        q.kind = b.dataset.type;
        q.named = false;
        if (q.kind === 'score') q.rows = q.rows.map((r) => ({ key: '', text: r.text || r.key })); // levels are texts
        if (q.kind !== 'noul' && q.rows.length < 2) q.rows = [{ key: '', text: '' }, { key: '', text: '' }];
      }
    }
    render();
    changed();
  });

  return {
    set(request) {
      model = fromRequest(request);
      render();
    },
    get: () => toRequest(model),
    refresh: render, // after a change of the page language
  };
}

