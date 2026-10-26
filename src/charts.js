// Charts of the answers, drawn with Apache ECharts (vendor/echarts, SVG renderer).
//
// Every chart is a function of (data, theme, width) -> ECharts option, mounted with mount(): it is drawn after the page
// fonts have loaded (SVG text is measured once), redrawn when the color theme changes and when its box resizes.
// Colors come from CSS custom properties (--chart-* and the ink tokens in app.css), so both themes stay in one place.
import * as echarts from '../vendor/echarts/echarts.esm.min.js';
import { CODES } from './basal.js';
import { num, pct, t as tr } from './i18n.js';

export { pct };

const MAX_BARS = 12; // a question with more options shows its most probable 12; the table lists all

let fontsReady = null;
function fonts() {
  fontsReady ??= Promise.all([
    document.fonts.load('500 13px "Schibsted Grotesk"', 'AĄz'),
    document.fonts.load('500 12px "JetBrains Mono"', 'A1'),
  ]).catch(() => {});
  return fontsReady;
}

function theme() {
  const css = getComputedStyle(document.documentElement);
  const t = (n) => css.getPropertyValue(n).trim();
  return {
    accent: t('--chart-accent'), context: t('--chart-context'), ink: t('--ink'), ink2: t('--ink-2'), muted: t('--muted'),
    second: t('--chart-2'), neg: t('--div-neg'), seqLo: t('--seq-lo'), seqHi: t('--seq-hi'),
    line: t('--line'), axis: t('--axis'), surface: t('--surface'),
    sans: '"Schibsted Grotesk", system-ui, sans-serif', mono: '"JetBrains Mono", ui-monospace, monospace',
    motion: !matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

const mounted = new Set(); // {el, chart, draw}

function redrawAll() {
  for (const m of mounted) m.draw();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawAll);
new MutationObserver(redrawAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/** Draw `build(theme, width)` into `el`; returns a function that removes the chart. */
export async function mount(el, build) {
  await fonts();
  const chart = echarts.init(el, null, { renderer: 'svg' });
  const m = {
    el,
    chart,
    draw() {
      const opt = build(theme(), el.clientWidth);
      el.style.height = `${opt.height}px`;
      delete opt.height;
      chart.resize();
      chart.setOption(opt, true);
    },
  };
  let frame = 0;
  let width = el.clientWidth;
  m.ro = new ResizeObserver(() => {
    if (el.clientWidth === width) return;
    width = el.clientWidth;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => m.draw());
  });
  m.ro.observe(el);
  mounted.add(m);
  m.draw();
  return () => {
    m.ro.disconnect();
    chart.dispose();
    mounted.delete(m);
  };
}

/** Remove every chart inside `root`. */
export function unmountWithin(root) {
  for (const m of [...mounted]) {
    if (root.contains(m.el)) {
      m.ro.disconnect();
      m.chart.dispose();
      mounted.delete(m);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------

function base(t) {
  return {
    animation: t.motion,
    animationDuration: 450,
    aria: { enabled: true },
    textStyle: { fontFamily: t.sans, color: t.ink2, fontSize: 12 },
    tooltip: {
      backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, padding: [8, 10],
      textStyle: { color: t.ink, fontFamily: t.sans, fontSize: 12 }, extraCssText: 'box-shadow:none;border-radius:6px;',
    },
  };
}

const valueAxis = (t, extra = {}) => ({
  type: 'value', min: 0, max: 1, interval: 0.25,
  axisLabel: { formatter: (v) => `${Math.round(v * 100)}%`, color: t.muted, fontFamily: t.mono, fontSize: 11 },
  splitLine: { lineStyle: { color: t.line } }, axisLine: { show: false }, axisTick: { show: false }, ...extra,
});

function thresholdLine(t, value, label, axis = 'xAxis') {
  return {
    symbol: 'none', silent: true, animation: false,
    lineStyle: { color: t.ink2, type: [4, 3], width: 1 },
    label: { formatter: label, color: t.ink2, fontSize: 11, position: 'end', distance: 4 },
    data: [{ [axis]: value }],
  };
}

/**
 * Options of one question as horizontal bars: probability per option, the chosen one(s) in the accent.
 * rows: [{code, key, text, p}], chosen: Set of keys; threshold: a value to mark (or null) with its label.
 */
export function barsChart({ rows, chosen, threshold = null, thresholdLabel = '', valueLabel = pct }) {
  return (t, width) => {
    let shown = rows;
    if (rows.length > MAX_BARS) shown = [...rows].sort((a, b) => b.p - a.p).slice(0, MAX_BARS);
    const twoLine = shown.some((r) => r.text && r.text !== r.key);
    const left = Math.max(120, Math.min(300, Math.round(width * 0.42)));
    const rowH = twoLine ? 46 : 32;
    return {
      ...base(t),
      height: shown.length * rowH + (threshold !== null ? 46 : 30),
      grid: { left, right: 58, top: threshold !== null ? 22 : 6, bottom: 24 },
      tooltip: { ...base(t).tooltip, trigger: 'item',
        formatter: ({ dataIndex }) => {
          const r = shown[dataIndex];
          return `<b style="font-family:${t.mono}">${r.code}</b> ${esc(r.key)}${r.text && r.text !== r.key ? `<br>${esc(r.text)}` : ''}` +
            `<br><b>${pct(r.p)}</b>`;
        } },
      xAxis: valueAxis(t),
      yAxis: {
        type: 'category', inverse: true, data: shown.map((r) => r.code),
        axisTick: { show: false }, axisLine: { lineStyle: { color: t.axis } },
        axisLabel: {
          width: left - 14, overflow: 'truncate', margin: 12, align: 'right', lineHeight: 16,
          formatter: (code, i) => {
            const r = shown[i];
            const head = `{c|${code}} {k|${r.key}}`;
            return twoLine && r.text && r.text !== r.key ? `${head}\n{m|${r.text}}` : head;
          },
          rich: {
            c: { fontFamily: t.mono, color: t.muted, fontSize: 11 },
            k: { color: t.ink, fontSize: 12, fontWeight: 500 },
            m: { color: t.muted, fontSize: 11, width: left - 14, overflow: 'truncate' },
          },
        },
      },
      series: [{
        type: 'bar', barMaxWidth: 16, barMinHeight: 2,
        data: shown.map((r) => ({ value: r.p, itemStyle: {
          color: chosen.has(r.key) ? t.accent : t.context, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', distance: 6, color: t.ink, fontFamily: t.mono, fontSize: 11,
          formatter: ({ value }) => valueLabel(value) },
        markLine: threshold !== null ? thresholdLine(t, threshold, thresholdLabel) : undefined,
      }],
    };
  };
}

/** A meter for one probability (P(yes)), with a marker at 50% or at the certified threshold. */
export function meterChart({ p, marker = 0.5, markerLabel = '50%' }) {
  return (t) => ({
    ...base(t),
    height: 78,
    grid: { left: 4, right: 4, top: 26, bottom: 24 },
    tooltip: { show: false },
    xAxis: valueAxis(t, { splitLine: { show: false } }),
    yAxis: { type: 'category', data: ['P(yes)'], show: false },
    series: [{
      type: 'bar', barWidth: 12, data: [p], showBackground: true,
      backgroundStyle: { color: t.line, borderRadius: 6 }, itemStyle: { color: t.accent, borderRadius: 6 },
      markLine: thresholdLine(t, marker, markerLabel),
    }],
  });
}

/** Ordered levels as columns, with the expected level marked. */
export function scoreChart({ rows, expected }) {
  return (t, width) => ({
    ...base(t),
    height: 210,
    grid: { left: 44, right: 16, top: 30, bottom: 44 },
    tooltip: { ...base(t).tooltip, trigger: 'item',
      formatter: ({ dataIndex }) => `<b style="font-family:${t.mono}">${rows[dataIndex].code}</b> ${esc(rows[dataIndex].text)}<br><b>${pct(rows[dataIndex].p)}</b>` },
    xAxis: [
      { type: 'category', data: rows.map((r) => r.text), axisTick: { show: false }, axisLine: { lineStyle: { color: t.axis } },
        axisLabel: { color: t.ink, fontSize: 12, interval: 0, width: Math.max(60, (width - 70) / rows.length - 8), overflow: 'truncate' } },
      { type: 'value', min: -0.5, max: rows.length - 0.5, show: false },
    ],
    yAxis: valueAxis(t),
    series: [{
      type: 'bar', barMaxWidth: 28, xAxisIndex: 0,
      data: rows.map((r) => ({ value: r.p, itemStyle: { color: t.accent, borderRadius: [4, 4, 0, 0] } })),
      label: { show: true, position: 'top', color: t.ink, fontFamily: t.mono, fontSize: 11, formatter: ({ value }) => pct(value) },
    }, {
      type: 'line', xAxisIndex: 1, data: [], silent: true,
      markLine: { ...thresholdLine(t, expected, tr('chart.expected', { x: num(expected, 2) })),
        lineStyle: { color: t.ink, width: 1.5, type: 'solid' },
        label: { formatter: tr('chart.expected', { x: num(expected, 2) }), color: t.ink, fontSize: 11, position: 'end' } },
    }],
  });
}

/** Expected cost per action (act): lower is better, the chosen action in the accent. */
export function costChart({ rows, chosen }) {
  return (t, width) => {
    const left = Math.max(90, Math.min(200, Math.round(width * 0.3)));
    const max = Math.max(...rows.map((r) => r.cost), 1e-9);
    return {
      ...base(t),
      height: rows.length * 32 + 30,
      grid: { left, right: 58, top: 6, bottom: 24 },
      tooltip: { ...base(t).tooltip, trigger: 'item', formatter: ({ dataIndex }) => `${esc(rows[dataIndex].action)}<br>${tr('chart.cost')} <b>${num(rows[dataIndex].cost, 2)}</b>` },
      xAxis: { type: 'value', max: max * 1.08, splitNumber: 4, axisLabel: { color: t.muted, fontFamily: t.mono, fontSize: 11 },
        splitLine: { lineStyle: { color: t.line } }, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.action), axisTick: { show: false },
        axisLine: { lineStyle: { color: t.axis } }, axisLabel: { color: t.ink, width: left - 14, overflow: 'truncate' } },
      series: [{ type: 'bar', barMaxWidth: 16, barMinHeight: 2,
        data: rows.map((r) => ({ value: r.cost, itemStyle: { color: r.action === chosen ? t.accent : t.context, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: t.ink, fontFamily: t.mono, fontSize: 11, formatter: ({ value }) => num(value, 2) } }],
    };
  };
}

/** Where the time went: per prompt, tokens reused from the cache and tokens computed, seconds at the tip. */
export function runChart({ rows }) {
  return (t, width) => {
    const left = Math.max(90, Math.min(190, Math.round(width * 0.3)));
    return {
      ...base(t),
      height: rows.length * 30 + 58,
      legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, itemGap: 14, icon: 'roundRect',
        textStyle: { color: t.ink2, fontSize: 12 }, data: [tr('legend.reused'), tr('legend.computed')] },
      grid: { left, right: 52, top: 30, bottom: 24 },
      tooltip: { ...base(t).tooltip, trigger: 'axis', axisPointer: { type: 'none' },
        formatter: (ps) => {
          const r = rows[ps[0].dataIndex];
          return `${esc(r.label)}<br>${tr('tip.run', { c: num(r.computed), r: num(r.reused) })}<br><b>${num(r.ms / 1000, 1)} s</b>`;
        } },
      xAxis: { type: 'value', splitNumber: 4, axisLabel: { color: t.muted, fontFamily: t.mono, fontSize: 11 },
        splitLine: { lineStyle: { color: t.line } }, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.label), axisTick: { show: false },
        axisLine: { lineStyle: { color: t.axis } }, axisLabel: { color: t.ink, width: left - 14, overflow: 'truncate' } },
      series: [
        { name: tr('legend.reused'), type: 'bar', stack: 'tokens', barMaxWidth: 14,
          itemStyle: { color: t.context, borderColor: t.surface, borderWidth: 1 }, data: rows.map((r) => r.reused) },
        { name: tr('legend.computed'), type: 'bar', stack: 'tokens', barMaxWidth: 14,
          itemStyle: { color: t.accent, borderColor: t.surface, borderWidth: 1, borderRadius: [0, 4, 4, 0] },
          data: rows.map((r) => r.computed),
          label: { show: true, position: 'right', color: t.ink, fontFamily: t.mono, fontSize: 11,
            formatter: ({ dataIndex }) => `${num(rows[dataIndex].ms / 1000, 1)} s` } },
      ],
    };
  };
}

/** The hero readout: the next-token distribution over the first option codes. */
export function readoutChart({ rows }) {
  return (t) => ({
    ...base(t),
    animationDuration: 900,
    animationEasing: 'cubicOut',
    height: 180,
    grid: { left: 8, right: 8, top: 26, bottom: 26 },
    tooltip: { ...base(t).tooltip, trigger: 'item', formatter: ({ dataIndex }) => `<b style="font-family:${t.mono}">${rows[dataIndex].code}</b> ${esc(rows[dataIndex].text)}<br><b>${pct(rows[dataIndex].p)}</b>` },
    xAxis: { type: 'category', data: rows.map((r) => r.code), axisTick: { show: false }, axisLine: { lineStyle: { color: t.axis } },
      axisLabel: { color: t.ink, fontFamily: t.mono, fontSize: 13, fontWeight: 600 } },
    yAxis: { type: 'value', max: 1, show: false },
    series: [{ type: 'bar', barMaxWidth: 34,
      data: rows.map((r) => ({ value: r.p, itemStyle: { color: r.top ? t.accent : t.context, borderRadius: [4, 4, 0, 0] } })),
      label: { show: true, position: 'top', color: t.ink, fontFamily: t.mono, fontSize: 12, formatter: ({ value }) => pct(value) } }],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Many rows

const pctAxis = (t, extra = {}) => ({
  type: 'value', min: 0, max: 1, interval: 0.25, axisLabel: { formatter: (v) => `${Math.round(v * 100)}%`, color: t.muted,
    fontFamily: t.mono, fontSize: 11 }, splitLine: { lineStyle: { color: t.line } }, axisLine: { show: false },
  axisTick: { show: false }, ...extra,
});

/** How often each answer was given: rows [{label, count}], one bar per answer. */
export function countChart({ rows }) {
  return (t, width) => {
    const left = Math.max(90, Math.min(240, Math.round(width * 0.38)));
    return {
      ...base(t),
      height: rows.length * 28 + 30,
      grid: { left, right: 44, top: 6, bottom: 24 },
      tooltip: { ...base(t).tooltip, trigger: 'item', formatter: ({ dataIndex }) => `${esc(rows[dataIndex].label)}<br><b>${num(rows[dataIndex].count)}</b>` },
      xAxis: { type: 'value', minInterval: 1, axisLabel: { color: t.muted, fontFamily: t.mono, fontSize: 11 },
        splitLine: { lineStyle: { color: t.line } }, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.label), axisTick: { show: false },
        axisLine: { lineStyle: { color: t.axis } }, axisLabel: { color: t.ink, width: left - 14, overflow: 'truncate' } },
      series: [{ type: 'bar', barMaxWidth: 14, barMinHeight: 2, data: rows.map((r) => r.count),
        itemStyle: { color: t.accent, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: t.ink, fontFamily: t.mono, fontSize: 11, formatter: ({ value }) => num(value) } }],
    };
  };
}

/** Confidence of the answers in ten bins, with the certified threshold marked when there is one. */
export function histChart({ counts, threshold = null, thresholdLabel = '' }) {
  return (t) => ({
    ...base(t),
    height: 190,
    grid: { left: 36, right: 16, top: threshold !== null ? 26 : 12, bottom: 28 },
    tooltip: { ...base(t).tooltip, trigger: 'item', formatter: ({ dataIndex }) =>
      `${dataIndex * 10}–${dataIndex * 10 + 10}%<br><b>${num(counts[dataIndex])}</b>` },
    xAxis: pctAxis(t, { splitLine: { show: false } }),
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: t.muted, fontFamily: t.mono, fontSize: 11 },
      splitLine: { lineStyle: { color: t.line } }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{ type: 'bar', barWidth: '80%', data: counts.map((c, i) => [i / 10 + 0.05, c]),
      itemStyle: { color: t.accent, borderRadius: [3, 3, 0, 0] },
      markLine: threshold !== null ? thresholdLine(t, threshold, thresholdLabel) : undefined }],
  });
}

/** Confusion matrix: rows the correct answers, columns the model's, counts as cell labels on one blue ramp. */
export function confusionChart({ keys, matrix }) {
  return (t, width) => {
    const max = Math.max(1, ...matrix.flat());
    const left = Math.max(80, Math.min(200, Math.round(width * 0.3)));
    const cell = Math.max(26, Math.min(44, Math.round((width - left - 20) / keys.length)));
    return {
      ...base(t),
      height: keys.length * cell + 70,
      grid: { left, right: 12, top: 8, bottom: 56 },
      tooltip: { ...base(t).tooltip, trigger: 'item', formatter: ({ value }) =>
        `${esc(tr('chart.gold'))}: <b>${esc(keys[value[1]])}</b><br>${esc(tr('chart.pred'))}: <b>${esc(keys[value[0]])}</b><br>${num(value[2])}` },
      xAxis: { type: 'category', data: keys, name: tr('chart.pred'), nameLocation: 'middle', nameGap: 34,
        nameTextStyle: { color: t.muted, fontSize: 11 }, axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { color: t.ink, interval: 0, width: cell - 4, overflow: 'truncate' } },
      yAxis: { type: 'category', data: keys, inverse: true, axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { color: t.ink, width: left - 14, overflow: 'truncate' } },
      visualMap: { show: false, min: 0, max, inRange: { color: [t.seqLo, t.seqHi] } },
      // a count on a dark cell is written in the surface color, on a light one in ink (both themes)
      series: [{ type: 'heatmap', data: matrix.flatMap((row, g) => row.map((c, p) => ({ value: [p, g, c],
          label: { color: c / max > 0.55 ? t.surface : t.ink } }))),
        itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
        label: { show: true, fontFamily: t.mono, fontSize: 11, formatter: ({ value }) => (value[2] ? num(value[2]) : '') } }],
    };
  };
}

/** Calibration: accuracy against mean confidence per bin; on the diagonal the confidence can be taken at face value. */
export function reliabilityChart({ bins }) {
  return (t) => {
    const maxN = Math.max(1, ...bins.map((b) => b.n));
    return {
      ...base(t),
      height: 240,
      grid: { left: 44, right: 16, top: 30, bottom: 40 },
      legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: t.ink2, fontSize: 12 },
        data: [tr('chart.bins'), tr('chart.diagonal')] },
      tooltip: { ...base(t).tooltip, trigger: 'item', formatter: ({ seriesIndex, dataIndex }) => {
        if (seriesIndex !== 0) return '';
        const b = bins[dataIndex];
        return `${esc(tr('chart.meanConf'))}: <b>${pct(b.conf)}</b><br>${esc(tr('chart.accuracy'))}: <b>${pct(b.acc)}</b><br>${esc(tr('chart.count'))}: ${num(b.n)}`;
      } },
      xAxis: pctAxis(t, { name: tr('chart.meanConf'), nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: t.muted, fontSize: 11 } }),
      yAxis: pctAxis(t),
      series: [
        { name: tr('chart.bins'), type: 'scatter', data: bins.map((b) => [b.conf, b.acc]),
          symbolSize: (_, p) => 8 + 14 * Math.sqrt(bins[p.dataIndex].n / maxN),
          itemStyle: { color: t.accent, borderColor: t.surface, borderWidth: 2 }, z: 3 },
        { name: tr('chart.diagonal'), type: 'line', data: [[0, 0], [1, 1]], symbol: 'none', silent: true,
          lineStyle: { color: t.muted, width: 1, type: [4, 3] }, itemStyle: { color: t.muted } },
      ],
    };
  };
}

/** Automate only answers at least this confident: the share automated and the error among them, by threshold. */
export function coverageChart({ curve, threshold = null, thresholdLabel = '' }) {
  return (t) => {
    const lo = Math.max(0, Math.floor((Math.min(...curve.map((c) => c.threshold)) - 0.02) * 20) / 20);
    return {
      ...base(t),
      height: 240,
      grid: { left: 44, right: 16, top: 30, bottom: 40 },
      legend: { top: 0, right: 0, itemWidth: 14, itemHeight: 3, textStyle: { color: t.ink2, fontSize: 12 },
        data: [tr('chart.coverage'), tr('chart.error')] },
      tooltip: { ...base(t).tooltip, trigger: 'axis', formatter: (ps) => {
        const c = curve[ps[0].dataIndex];
        return `${esc(tr('chart.atLeast', { p: pct(c.threshold) }))}<br>${esc(tr('chart.coverage'))}: <b>${pct(c.coverage)}</b><br>${esc(tr('chart.error'))}: <b>${pct(c.error)}</b>`;
      } },
      xAxis: { type: 'value', min: lo, max: 1, inverse: true, name: tr('chart.threshold'), nameLocation: 'middle', nameGap: 26,
        nameTextStyle: { color: t.muted, fontSize: 11 }, axisLabel: { formatter: (v) => `${Math.round(v * 100)}%`, color: t.muted,
          fontFamily: t.mono, fontSize: 11 }, splitLine: { show: false }, axisLine: { lineStyle: { color: t.axis } } },
      yAxis: pctAxis(t),
      series: [
        { name: tr('chart.coverage'), type: 'line', step: 'end', symbol: 'none', data: curve.map((c) => [c.threshold, c.coverage]),
          lineStyle: { color: t.accent, width: 2 }, itemStyle: { color: t.accent },
          markLine: threshold !== null ? thresholdLine(t, threshold, thresholdLabel) : undefined },
        { name: tr('chart.error'), type: 'line', step: 'end', symbol: 'none', data: curve.map((c) => [c.threshold, c.error]),
          lineStyle: { color: t.second, width: 2 }, itemStyle: { color: t.second } },
      ],
    };
  };
}

// ---------------------------------------------------------------------------------------------------------------
// "Why?"

/** The parts that moved the answer most: bars to the right support it, to the left argue against it. */
export function deltaChart({ rows, kind }) {
  return (t, width) => {
    const m = Math.max(1e-6, ...rows.map((r) => Math.abs(r.delta)));
    const left = Math.max(110, Math.min(300, Math.round(width * 0.45)));
    const fmt = (d) => (kind === 'level' ? `${d >= 0 ? '+' : '−'}${num(Math.abs(d), 2)}`
      : tr('chart.pp', { x: `${d >= 0 ? '+' : '−'}${num(Math.abs(d) * 100, 1)}` }));
    return {
      ...base(t),
      height: rows.length * 30 + 34,
      grid: { left: left + 56, right: 70, top: 6, bottom: 24 },
      tooltip: { ...base(t).tooltip, trigger: 'item', formatter: ({ dataIndex }) => `${esc(rows[dataIndex].full)}<br><b>${fmt(rows[dataIndex].delta)}</b>` },
      xAxis: { type: 'value', min: -m * 1.05, max: m * 1.05, splitNumber: 4, axisLabel: { show: false },
        splitLine: { lineStyle: { color: t.line } }, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.label), axisTick: { show: false },
        axisLine: { show: false }, axisLabel: { color: t.ink, width: left - 14, overflow: 'truncate' } },
      series: [{ type: 'bar', barMaxWidth: 14, barMinHeight: 2,
        data: rows.map((r) => ({ value: r.delta, itemStyle: { color: r.delta >= 0 ? t.accent : t.neg,
          borderRadius: r.delta >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] }, label: { position: r.delta >= 0 ? 'right' : 'left' } })),
        label: { show: true, color: t.ink, fontFamily: t.mono, fontSize: 11, formatter: ({ value }) => fmt(value) },
        markLine: { symbol: 'none', silent: true, lineStyle: { color: t.axis, width: 1, type: 'solid' }, label: { show: false },
          data: [{ xAxis: 0 }] } }],
    };
  };
}

export const codeOf = (i) => CODES[i] ?? '?';

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
