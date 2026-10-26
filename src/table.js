// Tables in and out of the many-rows section: CSV / TSV (RFC 4180, the delimiter detected), JSONL, and CSV / JSONL
// written back. A table is {columns: [names], rows: [[cells]]}: arrays, not objects, so column order stays as in the
// file (JS objects would move columns named like numbers to the front).

const DELIMITERS = [',', ';', '\t'];

/** The delimiter of a CSV-like text: the one that splits the first lines into the most equal, widest rows. */
export function detectDelimiter(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best = ',';
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => parseDelimited(l, d)[0]?.length ?? 1);
    const same = counts.every((c) => c === counts[0]);
    const score = counts[0] > 1 ? counts[0] * (same ? 2 : 1) : 0;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** CSV / TSV text -> rows of cells. Quoted cells may hold delimiters, quotes ("") and line breaks. */
export function parseDelimited(text, delimiter = ',') {
  const s = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

/** Rows whose first row is the header -> a table; empty or repeated header names get a number. */
export function tableFromRows(rows) {
  if (!rows.length) return { columns: [], rows: [] };
  const width = Math.max(...rows.map((r) => r.length));
  const seen = new Map();
  const columns = Array.from({ length: width }, (_, i) => {
    let name = String(rows[0][i] ?? '').trim() || `column ${i + 1}`;
    if (seen.has(name)) {
      seen.set(name, seen.get(name) + 1);
      name = `${name} (${seen.get(name)})`;
    } else seen.set(name, 1);
    return name;
  });
  const body = rows.slice(1).map((r) => Array.from({ length: width }, (_, i) => (r[i] === undefined || r[i] === null ? '' : r[i])));
  return { columns, rows: body };
}

/** JSONL: one JSON object per line -> a table whose columns are the keys in order of first appearance. */
export function parseJsonl(text) {
  const objects = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).map((l, n) => {
    try {
      const o = JSON.parse(l);
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not an object');
      return o;
    } catch (e) {
      throw new Error(`line ${n + 1}: ${e.message}`);
    }
  });
  const columns = [];
  for (const o of objects) for (const k of Object.keys(o)) if (!columns.includes(k)) columns.push(k);
  return { columns, rows: objects.map((o) => columns.map((c) => (c in o ? o[c] : ''))) };
}

/** A text file -> a table, by its extension (.jsonl / .ndjson, .tsv, else CSV with the delimiter detected). */
export function readTable(fileName, text) {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'jsonl' || ext === 'ndjson') return parseJsonl(text);
  return tableFromRows(parseDelimited(text, ext === 'tsv' ? '\t' : detectDelimiter(text)));
}

const cellText = (v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** A table -> CSV for spreadsheets: UTF-8 with a BOM (Excel then reads Polish letters), CRLF, quotes as needed. */
export function toCsv(columns, rows) {
  const q = (v) => {
    const s = cellText(v);
    return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[columns, ...rows].map((r) => r.map(q).join(',')).join('\r\n')}\r\n`;
}

/** Objects -> JSONL. */
export const toJsonl = (objects) => objects.map((o) => JSON.stringify(o)).join('\n') + '\n';

export { cellText };
