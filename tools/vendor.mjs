// Copies the runtime dependencies from node_modules into the static site: wllama and Apache ECharts into vendor/, the
// two variable fonts into vendor/fonts/ (Latin and Latin Extended, which covers Polish), and coi-serviceworker to the
// site root (the service worker must sit at the root so that its scope covers every page).
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';

const nm = (p) => new URL(`../node_modules/${p}`, import.meta.url);
const site = (p) => new URL(`../${p}`, import.meta.url);

const copies = [
  ['@wllama/wllama/esm/index.js', 'vendor/wllama/index.js'],
  ['@wllama/wllama/esm/wasm/wllama.wasm', 'vendor/wllama/wllama.wasm'],
  ['@wllama/wllama/LICENCE', 'vendor/wllama/LICENCE'],
  ['echarts/dist/echarts.esm.min.js', 'vendor/echarts/echarts.esm.min.js'],
  ['echarts/LICENSE', 'vendor/echarts/LICENSE'],
  ['echarts/NOTICE', 'vendor/echarts/NOTICE'],
  ['coi-serviceworker/coi-serviceworker.min.js', 'coi-serviceworker.js'],
];
for (const font of ['schibsted-grotesk', 'jetbrains-mono']) {
  for (const subset of ['latin', 'latin-ext']) {
    copies.push([`@fontsource-variable/${font}/files/${font}-${subset}-wght-normal.woff2`,
      `vendor/fonts/${font}-${subset}.woff2`]);
  }
  copies.push([`@fontsource-variable/${font}/LICENSE`, `vendor/fonts/${font}.LICENSE`]);
}
for (const [from, to] of copies) {
  mkdirSync(new URL('.', site(to)), { recursive: true });
  copyFileSync(nm(from), site(to));
}
const version = (p) => JSON.parse(readFileSync(nm(`${p}/package.json`))).version;
console.log(['@wllama/wllama', 'echarts', 'coi-serviceworker', '@fontsource-variable/schibsted-grotesk',
  '@fontsource-variable/jetbrains-mono'].map((p) => `${p} ${version(p)}`).join(', '));
