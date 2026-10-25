// The basal readout on wllama (llama.cpp in WebAssembly).
//
// wllama 3 has no logits API: it runs llama-server's own request handling. So the readout is the one basal-serve
// uses with `--mode llamacpp`: a completion of one token with the top log-probabilities at the answer position,
// computed from the raw logits, and the softmax over the option codes' log-probabilities. The prompt is sent as text
// and tokenized by llama.cpp with the GGUF vocabulary (the basal -GGUF files carry the tokenizer fix that makes it
// equal to the Hugging Face tokenizer); its leading "<s>" is dropped because llama.cpp adds BOS itself.
import { Wllama } from '../vendor/wllama/index.js';
import { BOS, CHAT_TEMPLATE, CODE_IDS, CODES } from './basal.js';

export const MODEL = {
  repo: 'Remek/basal-2.0-mini-GGUF',
  revision: '594d115f7d5e9f7c7858b39d023c78574c2fe77a', // pinned: weights and calibration of one release
  file: 'basal-2.0-mini-Q5_K_M.gguf',
  size: 1168136320,
  context: 8192,
};

export const modelUrl = (m = MODEL) => `https://huggingface.co/${m.repo}/resolve/${m.revision}/${m.file}`;

const TOP = 20; // log-probabilities asked per readout: max(TOP, k + 10), as basal-serve's llama.cpp backend

// wllama's default is half the logical cores. Prompt processing kept scaling past that on a 20-thread desktop CPU
// (10 threads 28 tokens/s, 16 threads 40, 20 threads 39), so take all but four, and never fewer than half.
export function defaultThreads(cores = globalThis.navigator?.hardwareConcurrency || 4) {
  return Math.max(1, Math.floor(cores / 2), cores - 4);
}

// llama.cpp's completion response -> {id: logprob} of the top tokens at the first generated position, also checking
// that each code's id has the code's text.
function topLogprobs(res) {
  const lp = res?.choices?.[0]?.logprobs;
  const first = lp?.content?.[0];
  if (first?.top_logprobs) {
    const got = new Map();
    for (const t of first.top_logprobs) got.set(t.id, { logprob: t.logprob, token: t.token });
    if (!got.has(first.id)) got.set(first.id, { logprob: first.logprob, token: first.token });
    return got;
  }
  throw new Error('no log-probabilities in the completion response: ' + JSON.stringify(res).slice(0, 300));
}

export class BasalEngine {
  constructor({ wasmPath, logger } = {}) {
    this.wllama = new Wllama(
      { default: wasmPath || new URL('../vendor/wllama/wllama.wasm', import.meta.url).href },
      { logger: logger || { debug() {}, log: console.log, warn: console.warn, error: console.error },
        parallelDownloads: 3 },
    );
    this.wllama.setCompat('default'); // Safari only: wllama's compat build from its CDN
    this.log = []; // one entry per readout: tokens, timings, the top token (validation and speed measurements)
  }

  get loaded() {
    return this.wllama.isModelLoaded();
  }

  async load({ url = modelUrl(), nThreads = defaultThreads(), gpuLayers = 0, nCtx = MODEL.context, onProgress } = {}) {
    await this.wllama.loadModelFromUrl(url, {
      n_ctx: nCtx,
      n_batch: 512,
      n_parallel: 1, // one slot: consecutive prompts reuse its KV cache for their shared prefix (the state)
      n_gpu_layers: gpuLayers,
      n_threads: nThreads,
      progressCallback: onProgress,
    });
    this.checks = this.check();
    return this.checks;
  }

  // What can be checked of the model without a tokenizer API.
  check() {
    const w = this.wllama;
    const meta = w.getModelMetadata();
    const out = {
      threads: w.getNumThreads(),
      multithread: w.isMultithread(),
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      webgpu: w.isSupportWebGPU(),
      bos: w.getBOS(),
      addsBos: w.mustAddBosToken(),
      chatTemplate: w.getChatTemplate() === CHAT_TEMPLATE,
      vocab: meta.hparams.nVocab,
      ctxTrain: meta.hparams.nCtxTrain,
      name: meta.meta['general.name'],
    };
    out.ok = out.bos === 1 && out.addsBos && out.chatTemplate && out.vocab === 32000;
    return out;
  }

  // One prompt -> the raw log-probabilities of the first k option codes (-1e9 for a code outside the top list).
  async codeLogprobs(prompt, k, { cache = true } = {}) {
    const text = prompt.startsWith(BOS) ? prompt.slice(BOS.length) : prompt;
    const t0 = performance.now();
    const res = await this.wllama.createCompletion({
      prompt: text,
      max_tokens: 1,
      temperature: 0,
      n_probs: Math.max(TOP, k + 10),
      logprobs: Math.max(TOP, k + 10),
      post_sampling_probs: false,
      cache_prompt: cache,
    });
    const got = topLogprobs(res);
    for (let i = 0; i < k; i++) {
      const t = got.get(CODE_IDS[i]);
      if (t && t.token !== CODES[i]) throw new Error(`token ${CODE_IDS[i]} is '${t.token}', expected code '${CODES[i]}'`);
    }
    const top = [...got].sort((a, b) => b[1].logprob - a[1].logprob)[0];
    this.log.push({
      k,
      promptTokens: res.usage?.prompt_tokens,
      cached: res.timings?.cache_n,
      evaluated: res.timings?.prompt_n,
      promptMs: res.timings?.prompt_ms,
      ms: performance.now() - t0,
      top: { id: top[0], token: top[1].token, logprob: top[1].logprob },
      codeMass: CODE_IDS.slice(0, k).reduce((s, id) => s + (got.has(id) ? Math.exp(got.get(id).logprob) : 0), 0),
    });
    return CODE_IDS.slice(0, k).map((id) => (got.has(id) ? got.get(id).logprob : -1e9));
  }

  // The readout of basal.decide(): softmax over the code log-probabilities of every prompt.
  readout = async (prompts) => {
    const out = [];
    for (const { prompt, k } of prompts) out.push(softmax(await this.codeLogprobs(prompt, k)));
    return out;
  };

  async unload() {
    await this.wllama.exit();
  }
}

export function softmax(z) {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}
