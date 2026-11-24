/* Berta felolvasó – háttérszál (Web Worker), hogy a képernyő ne akadjon */
let sess = null, cfg = null, espeak = null, phonMod = null, base = '', minId = 0, busy = false;
const queue = [];
const PARTS = [['berta-q8-0.txt', 12435088], ['berta-q8-1.txt', 12435092], ['espeak-hu.txt', 1198372]];
function b64bytes(str) { const bin = atob(str), n = bin.length, out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i); return out; }
async function fetchText(url, onBytes) {
  let c = null;
  try { c = await caches.open('berta-v2'); const hit = await c.match(url); if (hit) { const t = await hit.text(); onBytes(t.length); return t; } } catch (e) { c = null; }
  const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status);
  const rd = r.body.getReader(), dec = new TextDecoder(); let t = '';
  for (;;) { const { done, value } = await rd.read(); if (done) break; t += dec.decode(value, { stream: true }); onBytes(value.length); }
  t += dec.decode(); try { if (c) await c.put(url, new Response(t)); } catch (e) {}
  return t;
}
async function load(b) {
  base = b;
  importScripts(base + 'ort.wasm.min.js', base + 'piper_phonemize.js');
  ort.env.wasm.wasmPaths = base; ort.env.wasm.numThreads = 1;
  cfg = await (await fetch(base + 'berta.json')).json();
  phonMod = await WebAssembly.compile(await (await fetch(base + 'piper_phonemize.wasm')).arrayBuffer());
  const tot = PARTS.reduce((a, p) => a + p[1], 0); let got = 0, last = -1;
  const prog = n => { got += n; const p = Math.min(99, Math.round(100 * got / tot)); if (p !== last) { last = p; postMessage({ t: 'prog', p }); } };
  const txt = []; for (const [f] of PARTS) txt.push(await fetchText(base + f, prog));
  espeak = b64bytes(txt[2]).buffer;
  const model = b64bytes(txt[0] + txt[1]); txt.length = 0;
  sess = await ort.InferenceSession.create(model.buffer, { executionProviders: ['wasm'] });
  postMessage({ t: 'ready', sr: cfg.audio.sample_rate });
}
function phonemes(text) {
  return new Promise((ok, no) => {
    let done = false;
    createPiperPhonemize({
      print: d => { if (!done) { done = true; try { ok(JSON.parse(d).phoneme_ids); } catch (e) { no(e); } } },
      printErr: () => {},
      getPreloadedPackage: () => espeak.slice(0),
      instantiateWasm: (imports, cb) => { WebAssembly.instantiate(phonMod, imports).then(inst => cb(inst, phonMod)).catch(no); return {}; },
      locateFile: u => base + u
    }).then(m => m.callMain(['-l', cfg.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data'])).catch(no);
  });
}
async function synth(text, rate) {
  const ids = await phonemes(text), inf = cfg.inference;
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale, inf.length_scale / rate, inf.noise_w]), [3])
  };
  const out = await sess.run(feeds);
  return new Float32Array(out.output.data);
}
async function pump() {
  if (busy) return; busy = true;
  while (queue.length) {
    const j = queue.shift();
    if (j.id < minId) continue;
    try { const t0 = performance.now(); const pcm = await synth(j.text, j.rate); postMessage({ t: 'pcm', id: j.id, pcm, ms: performance.now() - t0 }, [pcm.buffer]); }
    catch (e) { postMessage({ t: 'pcm', id: j.id, err: String(e && e.message || e) }); }
  }
  busy = false;
}
self.onmessage = e => {
  const m = e.data;
  if (m.t === 'load') load(m.base).catch(err => postMessage({ t: 'err', e: String(err && err.message || err) }));
  else if (m.t === 'synth') { queue.push(m); pump(); }
  else if (m.t === 'cancel') { minId = m.before; }
};
