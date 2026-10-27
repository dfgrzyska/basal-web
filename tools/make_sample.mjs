// The sample file of the many-rows section in two forms: examples/zgloszenia.csv rewritten as UTF-8 with a BOM (so
// Excel shows the Polish letters) and examples/zgloszenia.xlsx with the same rows.
//   node tools/make_sample.mjs
import { readFileSync, writeFileSync } from 'node:fs';

import writeExcelFile from 'write-excel-file/node';

import { readTable, toCsv } from '../src/table.js';

const csvUrl = new URL('../examples/zgloszenia.csv', import.meta.url);
const { columns, rows } = readTable('zgloszenia.csv', readFileSync(csvUrl, 'utf8'));
writeFileSync(csvUrl, toCsv(columns, rows));
const sheet = [columns, ...rows.map((r) => r.map((v, i) => (columns[i] === 'id' ? Number(v) : v)))];
await writeExcelFile(sheet, { columns: [{ width: 6 }, { width: 100 }, { width: 14 }] })
  .toFile(new URL('../examples/zgloszenia.xlsx', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
console.log(`examples/zgloszenia.csv and .xlsx: ${rows.length} rows, columns ${columns.join(', ')}`);
