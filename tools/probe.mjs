#!/usr/bin/env node
/* Prueba diaria contra los servicios reales: cada fuente hace una búsqueda de verdad y se comprueba que la primera imagen carga.
   Resultado en data/health.json (la app lo muestra en «Probar fuentes»). Sale con error si alguna falla, para que GitHub avise. */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const C = createRequire(import.meta.url)('../src/core.js');
const A = C.adapters, f = C.defaultFilters();
const ctx = { hq: false, px: 1280, anyRights: true, keys: { europeana: 'api2demo', si: 'DEMO_KEY', harvard: process.env.HARVARD_KEY || '' }, report() {} };
const mus = id => C.MUSEUMS.find(m => m.id === id);
const plan = () => Object.assign(C.makePlan(f), { type: 'painting', range: null, artist: null, keyword: null, style: null });
const CHECKS = {
  'The Met': () => A.metFetch(plan(), f, ctx),
  'Art Institute of Chicago': () => A.aicFetch(plan(), f, ctx),
  'Cleveland Museum of Art': () => A.cmaFetch(plan(), f, ctx),
  'Rijksmuseum': () => A.rijksFetch(plan(), f, ctx),
  'Victoria and Albert': () => A.vamFetch(plan(), f, ctx),
  'SMK': () => A.smkFetch(plan(), f, ctx),
  'Minneapolis': () => A.miaFetch(plan(), f, ctx),
  'Smithsonian': () => A.siFetch(plan(), f, ctx),
  'Europeana': () => A.europeanaFetch(plan(), f, ctx),
  'Wikidata (museo)': () => A.wikidataMuseum(mus('uffizi'), plan(), f, ctx),
  'Wikidata (general)': () => A.wikiFetch(plan(), f, ctx),
  'Commons': () => A.commonsFetch(plan(), f, ctx, mus('nationalgallery')),
  'Google Art Project': () => A.commonsSpecial('gap', plan(), f, ctx),
  'Wikipedia': () => A.wikipediaFetch(plan(), f, ctx, null),
  'WikiArt': () => A.wikiartFetch(Object.assign(plan(), { style: C.STYLES.find(s => s.id === 'impressionism') }), f, ctx),
  'MoMA (lista)': () => A.momaFetch(plan(), f, ctx),
  'NGA (lista)': () => A.ngaFetch(plan(), f, ctx),
  'Tate (lista)': () => A.tateFetch(plan(), f, ctx),
  'Louvre (lista precargada)': () => A.shardFetch('louvre', plan(), ctx),
  'Prado (lista precargada)': () => A.shardFetch('prado', plan(), ctx)
};
if (ctx.keys.harvard) CHECKS.Harvard = () => A.harvardFetch(plan(), f, ctx);

async function imageOK(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'galeria-de-arte/1.0 (prueba diaria)' } });
    const ct = r.headers.get('content-type') || ''; try { await r.body.cancel(); } catch (e) { /* nada */ }
    return r.ok && /^image\//.test(ct) ? 'ok' : 'HTTP ' + r.status + ' ' + ct;
  } catch (e) { return e.name === 'AbortError' ? 'imagen: tiempo agotado' : 'imagen: ' + e.message; } finally { clearTimeout(t); }
}

// Los listados de MoMA/NGA/Tate y los precargados se leen desde GitHub (en la web se leen del propio sitio).
const results = {};
for (const [name, fn] of Object.entries(CHECKS)) {
  const t0 = Date.now();
  let res;
  try {
    const list = (await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo agotado')), 90000))])) || [];
    const w = list.find(x => x && x.imgs && x.imgs.length);
    if (!w) res = { ok: false, n: list.length, err: 'sin obras' };
    else {
      let img = 'sin probar';
      for (const u of w.imgs.slice(0, 3)) { img = await imageOK(u); if (img === 'ok') break; }
      res = { ok: img === 'ok', n: list.length, err: img === 'ok' ? undefined : img, sample: (w.title || '').slice(0, 60) };
    }
  } catch (e) { res = { ok: false, n: 0, err: String(e && e.message || e).slice(0, 120) }; }
  res.ms = Date.now() - t0; results[name] = res;
  console.log((res.ok ? 'OK   ' : 'FALLA') + ' ' + name + ' · ' + res.n + ' obras · ' + res.ms + ' ms' + (res.err ? ' · ' + res.err : ''));
}
const out = { at: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', ok: Object.values(results).filter(r => r.ok).length, total: Object.keys(results).length, results };
fs.writeFileSync(path.join(here, '..', 'data', 'health.json'), JSON.stringify(out, null, 1));
if (out.ok < out.total) process.exit(1);
