# basal-web

[basal-2.0-mini](https://huggingface.co/Remek/basal-2.0-mini-GGUF) typed decisions running entirely on the user's
device: a static page, no backend. The model (GGUF Q5_K_M, 1.17 GB) is downloaded from Hugging Face at runtime and
cached by the browser; inference is llama.cpp compiled to WebAssembly ([wllama](https://github.com/ngxson/wllama)),
on the CPU.

```
request JSON ──► src/basal.js ──► prompts ──► src/engine.js (wllama) ──► code log-probabilities
                 (prompt format 2)            one token, top-k at the        │
answers ◄── calibration + typed answers ◄──── answer position ◄──────────────┘
```

## Layout

| path | what |
|---|---|
| `index.html`, `src/app.js`, `src/app.css` | the page |
| `src/builder.js` | the question form (choice, yes/no, score, labels), kept in sync with the request JSON; `tool` and `act` stay in the JSON tab |
| `src/charts.js` | the answer charts, drawn with Apache ECharts |
| `src/i18n.js` | the page's English and Polish texts |
| `src/presets.js`, `src/example-result.json` | the examples, and one real run of the first one (shown before the model is loaded) |
| `src/basal.js` | port of the basal engine's prompt format 2: request → prompts, readout → calibrated typed answers (`choice`, `noul`, `score`, `multi`, `tool`, `act`) |
| `src/sets.js` | `multi` set selection (threshold, exact, expected IoU / F1), port of `basal/sets.py` |
| `src/ojson.js` | JSON with Python semantics: key order kept (JS objects reorder keys like `"10"`, `"2"`), `1.0` ≠ `1`, `json.dumps` formatting |
| `src/engine.js` | the readout on wllama |
| `calibration/CALIBRATION.llamacpp.json` | temperatures and certified thresholds for llama.cpp readouts (from the model repo) |
| `vendor/`, `coi-serviceworker.js` | vendored wllama, ECharts and the two fonts (`npm run vendor` refreshes them from `node_modules`) |
| `test/` | Node tests; the engine's format-2 test vectors and bundled examples; reference answers from basal-serve |
| `dev/validate.html`, `tools/` | browser validation page, dev server, reference and comparison scripts |

The model and calibration are pinned to revision `594d115` of `Remek/basal-2.0-mini-GGUF`.

## The page

- **Hero.** The end of a real prompt and the model's next-token distribution over the option codes, from the example
  run. That one token is the decision.
- **Workbench.** On the left, the request, written in the form or as JSON (both stay in sync). On the right, the
  answers:
  - the run's totals and a "where the time went" chart (tokens reused from the cache vs computed, per prompt);
  - for each question, a chart for its type: bars for choice and tool, a meter for yes/no, columns with the expected
    level for score, P(applies) per label for labels, and expected cost per action for act. Certified thresholds and
    the labels' selection threshold are drawn as markers.
- **Details.** Each answer opens its table (the model's softmax over the codes and the calibrated probabilities, with
  the temperature), its exact prompts (with the text shared with the previous prompt highlighted) and its JSON.
- **Pipeline.** The seven steps from request to answer, annotated with the figures of the last run.
- **Before the model is loaded** the page shows a saved real run of the first example, labelled as such.

Fonts are self-hosted, so the page makes no requests other than for the model and its own files.

**Polish and English.** The page follows the browser's language (Polish for any `pl-*`, otherwise English); the PL/EN
switch in the top bar overrides it and is remembered in that browser (`src/i18n.js`, numbers and plurals in each
language's own form). Separately, every question shows the language its prompt is written in. basal picks Polish
when the state or the question contains Polish letters; the form's "Prompt language" switch (Auto / Polish / English)
sets the request's `lang` to force one for every question.

## How the readout works

wllama 3 runs llama-server's request handling inside the worker and has **no logits or tokenizer API** any more
(`getLogits`, `tokenize`, `decode` were removed in 3.0). The readout is therefore the one `basal-serve --mode llamacpp`
uses: a completion of one token with `n_probs = max(20, k + 10)` log-probabilities of the raw logits
(`post_sampling_probs: false`) at the answer position. The response gives token ids, so the codes are read by id.
A softmax over the k codes' log-probabilities equals the softmax over their logits. A code outside the top list
counts as probability 0, as in basal-serve.

The prompt is sent as text and tokenized by llama.cpp with the GGUF vocabulary. The basal `-GGUF` files carry a
tokenizer fix (merge-rank scores, `add_space_prefix = false`, control-typed special tokens) that makes this equal to
the Hugging Face tokenizer the model was trained with. The leading `<s>` of the rendered template is dropped because
the GGUF sets `add_bos_token` and llama.cpp adds BOS itself (sending both would give two BOS tokens).

One slot (`n_parallel: 1`) with `cache_prompt` means consecutive prompts reuse the KV cache of their shared prefix:
the system prompt across requests, the state across the questions of one request.

The built-in `createSystemOne()` of wllama 3.8 is not usable: it needs llama.cpp "decision model" metadata
(`<arch>.decision.*`, scorer tensors) that the basal GGUF does not have, and it implements a different prompt.

## Validation

`npm test` (Node 22, no dependencies; 360 tests):

- **Prompts**: all 43 requests / 74 prompts of the engine's `docs/format2_vectors.jsonl` are rendered byte for byte,
  including Polish, structured states, 255 options, two option orders, `multi`, `tool` and `act`.
- **Code ids**: the 255 code ids equal the FORMAT2.md table and the vectors.
- **Answers**: 258 requests (the vectors, six random readouts each) through basal v2.0.0's own functions and through
  `decide()`, with the same readouts and calibration file: every field of every answer agrees within 2e-6 (float32
  in basal, float64 here), across all six types, `multi` objectives with exclusive / fallback / empty outcomes, tool
  ranking and `max_error` deferral. Fixtures: `tools/make_assembly_fixtures.py`.
- **Form**: every example and all 43 vector requests go JSON → form → JSON with byte-identical prompts.

In the browser (`dev/validate.html`, Chromium 152, Windows, 20 logical cores):

- **Tokenization**: llama.cpp's tokens of all 74 text prompts have exactly the reference length; for every prompt up
  to 1,300 tokens and the 4,100-token Polish state, the text prompt and the reference token ids give bit-identical
  hidden states (the embedding API takes ids, the completion API does not).
- **Readout**: at all 74 answer positions the most likely token is an option code.
- **Answers against basal-serve v2.0.0** (`--mode ollama`, same Q5_K_M file, same `CALIBRATION.llamacpp.json`), on
  the 49 bundled example requests (58 questions, 44 with gold labels):

  | comparison | same top answer | mean TV | max \|Δp\| | gold accuracy |
  |---|---|---|---|---|
  | browser vs basal-serve on Ollama, CUDA | 57/58 | 0.0195 | 0.107 | 34 vs 33 of 44 |
  | browser vs basal-serve on Ollama, CPU | 56/58 | 0.0182 | 0.150 | 34 vs 35 of 44 |
  | *reference vs reference (CUDA vs CPU)* | *55/58* | *0.0216* | *0.129* | *33 vs 35 of 44* |

  The browser differs from either reference no more than the two references (same engine, different kernels) differ
  from each other; every flip is a near-tie (top probability 0.39–0.55). This is the numeric noise floor of the
  Q5_K_M port, consistent with its model card (agreement with bf16 0.934 on options 2–10).

`node tools/compare.mjs test/data/reference.ollama.json test/data/browser.wllama.json` reproduces the table rows.

## Speed

CPU, WebAssembly SIMD, multi-threaded through cross-origin isolation. Prompt processing on a 20-thread desktop CPU
(Chromium 152, Windows; `test/data/speed.wllama.json`), cold, no prompt cache:

| threads | 223-token prompt | 1,197-token prompt |
|---|---|---|
| 4 | 11.4 tokens/s | 11.2 tokens/s |
| 8 | 22.1 | 22.1 |
| 10 (wllama's default, half the logical cores) | 28.3 | 27.6 |
| **16** (this page's default: all but four) | **39.7** | **38.6** |
| 20 | 39.3 | 38.1 |

So a decision costs seconds, not milliseconds: about 5–6 s for a question over a 200-token state, 30 s for a
1,200-token prompt, 2 minutes at the 4,000-token end. Questions after the first over the same state compute only their
own tokens (the state's KV cache is reused), typically 1–2 s each. Loading the cached model takes about 2 s.

WebGPU (wllama 3.1+) was slower in a quick test (105 tokens: 9.6 s against 3.6 s on 10 CPU threads) and did not
finish a 2,600-token prompt in 6 minutes, so it is off (`gpuLayers: 0`).

## Run locally

```bash
npm install
npm run vendor
npm run serve
```

`npm run serve` (port 8642) sends real COOP/COEP headers; `node tools/serve.mjs --no-coi` leaves them out to test the
service worker as on GitHub Pages.

## Deploy (GitHub Pages)

Serve the repository root from a branch (`Settings → Pages → Deploy from a branch`). `.nojekyll` turns off Jekyll.
GitHub Pages cannot set headers, so `coi-serviceworker.js` (credentialless mode) adds COOP/COEP: on the first visit
the page registers it and reloads once; afterwards `crossOriginIsolated` is true and wllama runs multi-threaded.
Live at https://dfgrzyska.github.io/basal-web/. Checked there in Chromium 152: the service worker isolates the page
(`crossOriginIsolated === true`), the model downloads from Hugging Face through it (1.17 GB in about 25 s), wllama runs
on 16 threads, and the ticket example gives the validated answers in about 7 s.

Fallback if the service worker causes problems: Cloudflare Pages or Netlify, which read the `_headers` file in the
repository root and send the same headers for real (the service worker then sees an isolated page and does nothing).

## Limits

- Context: 8,192 tokens per prompt (the mini's limit); longer prompts are refused, not truncated.
- `"facts": "auto"` (computed calendar and VAT facts) is not ported.
- Option orders: 1 (the format-2 default, and the order the calibration was fitted for). `orders: 2` works but marks
  answers `"calibration": "unvalidated"` and drops the certified thresholds, as basal-serve does.
- `CALIBRATION.llamacpp.json` was fitted on llama.cpp readouts of the Q8_0 file; this page serves Q5_K_M with it.
  Treat its `max_error` thresholds as approximate.
- Safari: wllama's compatibility build is loaded from its CDN, slower; Safari also lacks credentialless COEP.
- A small model's decisions need validation on your own data before they are relied on.

## Licenses

Third-party parts: model, calibration, test vectors and examples are Apache-2.0, basal by Remigiusz Kinas (fine-tuned
from speakleash/Bielik-1.5B-v3.0-Instruct; `test/data/LICENSE.basal`); wllama MIT (`vendor/wllama/LICENCE`); Apache
ECharts 6.1.0, Apache-2.0 (`vendor/echarts/LICENSE`, `NOTICE`); Schibsted Grotesk and JetBrains Mono, SIL Open Font
License 1.1 (`vendor/fonts/*.LICENSE`); coi-serviceworker MIT. No license has been chosen yet for the code of this repository.
