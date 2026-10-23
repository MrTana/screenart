#!/usr/bin/env node
/* Se ejecuta también al cambiar este archivo. */
/* Prueba diaria contra los servicios reales: cada fuente hace una búsqueda de verdad y se comprueba que la primera imagen carga.
   Resultado en data/health.json (la app lo muestra en «Probar fuentes»). Sale con error si alguna falla, para que GitHub avise. */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
// Wikidata y Wikipedia rechazan peticiones sin User-Agent (el navegador siempre lo manda): se añade a todas.
const UA = 'galeria-de-arte/1.0 (prueba diaria; https://github.com/MrTana/screenart)';
const rawFetch = globalThis.fetch;
globalThis.fetch = (u, init) => { const i = Object.assign({}, init || {}); i.headers = Object.assign({ 'User-Agent': UA, 'Api-User-Agent': UA }, i.headers || {}); return rawFetch(u, i); };
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
  'Wikidata (general)': () => A.wikiFetch(Object.assign(plan(), { artist: 'Claude Monet' }), f, ctx),
  'Commons': () => A.commonsFetch(plan(), f, ctx, mus('nationalgallery')),
  'Google Art Project': () => A.commonsSpecial('gap', plan(), f, ctx),
  'Wikipedia': () => A.wikipediaFetch(Object.assign(plan(), { artist: 'Claude Monet' }), f, ctx, null),
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
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA } });
    const ct = r.headers.get('content-type') || ''; try { await r.body.cancel(); } catch (e) { /* nada */ }
    // Algunos servidores (Minneapolis) no mandan tipo: vale mientras no sea una página o un JSON de error.
    return r.ok && (/^image\//.test(ct) || !/(text\/html|json|xml)/.test(ct)) ? 'ok' : 'HTTP ' + r.status + ' ' + (ct || 'sin tipo');
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
      // El Art Institute protege sus imágenes contra robots de centros de datos (403 con página de comprobación): desde aquí no se
      // puede verificar la imagen, aunque en el navegador carga. Se da por buena la búsqueda y se anota.
      const shield = /^HTTP 403 text\/html/.test(img) && /artic\.edu/.test(w.imgs[0]);
      res = { ok: img === 'ok' || shield, n: list.length, err: img === 'ok' ? undefined : shield ? 'imagen no comprobable desde GitHub (protección contra robots)' : img, sample: (w.title || '').slice(0, 60) };
    }
  } catch (e) { res = { ok: false, n: 0, err: String(e && e.message || e).slice(0, 120) }; }
  res.ms = Date.now() - t0; results[name] = res;
  console.log((res.ok ? 'OK   ' : 'FALLA') + ' ' + name + ' · ' + res.n + ' obras · ' + res.ms + ' ms' + (res.err ? ' · ' + res.err : ''));
}
// Diagnóstico extra de lo que falle: qué devuelve realmente el servicio.
async function diagJSON(u) { try { const r = await fetch(u); const tx = await r.text(); return { status: r.status, body: tx.slice(0, 1500) }; } catch (e) { return { error: e.message }; } }
if (!results.Wikipedia.ok) {
  const d = await diagJSON('https://en.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*&action=query&generator=search&gsrnamespace=0&gsrlimit=8&gsroffset=0&gsrsearch=' + encodeURIComponent('Claude Monet painting') + '&prop=pageimages|description&piprop=original|thumbnail&pithumbsize=1280');
  try { const j = JSON.parse(d.body.length < 1500 ? d.body : (await (await fetch('https://en.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*&action=query&generator=search&gsrnamespace=0&gsrlimit=8&gsroffset=0&gsrsearch=' + encodeURIComponent('Claude Monet painting') + '&prop=pageimages|description&piprop=original|thumbnail&pithumbsize=1280')).text()));
    results.Wikipedia.diag = (j.query && j.query.pages || []).map(p => [p.title, p.description, p.original && p.original.width, p.original && p.original.source && p.original.source.slice(-40)]); }
  catch (e) { results.Wikipedia.diag = d; }
}
{ // tiempos de la consulta de conteo de un museo tal como la hace la app, con y sin la pista de orden de Wikidata
  const q = C.wdMuseumQuery(mus('uffizi'), plan(), f, ctx).countQ, d = {};
  for (const [name, qq] of [['app', q], ['conPista', q.replace('WHERE { ', 'WHERE { hint:Query hint:optimizer "None". ')]]) {
    const t0 = Date.now(); const r = await diagJSON('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(qq));
    d[name] = { ms: Date.now() - t0, status: r.status, n: ((/"value" : "(\d+)"/.exec(r.body || '') || [])[1]) || null };
  }
  results['Wikidata (museo)'].timing = d; console.log('tiempos Wikidata', JSON.stringify(d));
}
if (!results['Wikidata (museo)'].ok) {
  const t0 = Date.now(); const d = await diagJSON('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent('SELECT (COUNT(*) AS ?n) WHERE { ?item wdt:P195 wd:Q51252; wdt:P18 ?i. }'));
  results['Wikidata (museo)'].diag = { simpleCountMs: Date.now() - t0, status: d.status, body: (d.body || d.error || '').slice(0, 200) };
}
const out = { at: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', ok: Object.values(results).filter(r => r.ok).length, total: Object.keys(results).length, results };
fs.writeFileSync(path.join(here, '..', 'data', 'health.json'), JSON.stringify(out, null, 1));
if (out.ok < out.total) process.exit(1);
