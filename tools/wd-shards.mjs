#!/usr/bin/env node
/* Colecciones precargadas: para cada museo de WD_SHARDS (src/core.js) descarga de Wikidata sus pinturas, dibujos y estampas
   con imagen en Commons y las guarda en data/<museo>/ (mismo formato que MoMA, NGA y Tate).
   Fila: [QID (número), título, artista, año o null, archivo de Commons].
   El museo se toma con todos sus departamentos (P195/P361*): el Louvre, por ejemplo, registra casi todo por departamento.
   Si el museo no trae identificador, se busca por sus nombres (el que tenga más obras con imagen).
   Uso: node tools/wd-shards.mjs [museo …]   (lo ejecuta cada lunes la acción «Colecciones precargadas») */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const C = createRequire(import.meta.url)('../src/core.js');
const OUT = path.join(here, '..', 'data');
const TYPES = { painting: ['Q3305213'], drawing: ['Q93184', 'Q18761202', 'Q22669857'], print: ['Q11060274', 'Q18218093', 'Q1373111'] };
const CHUNK = 2500, PAGE = 8000, MIN = 20;
const UA = 'galeria-de-arte/1.0 (colecciones precargadas; https://github.com/MrTana/screenart)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function sparql(q, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 95000);
      const r = await fetch('https://query.wikidata.org/sparql', { method: 'POST', signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'query=' + encodeURIComponent(q) });
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return (await r.json()).results.bindings;
    } catch (e) { console.error('  reintento', i + 1, e.message); await sleep(8000 * (i + 1)); }
  }
  throw new Error('Wikidata no responde');
}

async function resolve(m) {
  if (m.ids && m.ids.length) return m.ids;
  const vals = m.labels.map(([l, lang]) => '"' + esc(l) + '"@' + lang).join(' ');
  const rows = await sparql('SELECT ?c (COUNT(DISTINCT ?item) AS ?n) WHERE { VALUES ?l { ' + vals + ' } ?c rdfs:label ?l. ?item wdt:P195 ?c; wdt:P18 ?img. } GROUP BY ?c ORDER BY DESC(?n) LIMIT 1');
  const top = rows[0];
  if (!top || +top.n.value < MIN) return [];
  return [top.c.value.split('/').pop()];
}

const query = (coll, classes, off) => 'SELECT ?item ?itemLabel ?creatorLabel ?inc ?image WHERE { VALUES ?cls { ' + classes.map(c => 'wd:' + c).join(' ') + ' } ' +
  '?item wdt:P195/wdt:P361* wd:' + coll + '; wdt:P31 ?cls; wdt:P18 ?image. OPTIONAL { ?item wdt:P170 ?creator. } OPTIONAL { ?item wdt:P571 ?inc. } ' +
  'SERVICE wikibase:label { bd:serviceParam wikibase:language "es,fr,en,de,it". } } ORDER BY ?item LIMIT ' + PAGE + ' OFFSET ' + off;

function row(b) {
  const m = /Special:FilePath\/(.+)$/.exec(b.image.value); if (!m) return null;
  const name = decodeURIComponent(m[1]).replace(/ /g, '_');
  if (!/\.(jpe?g|png)$/i.test(name)) return null;
  const qid = b.item.value.split('/').pop();
  let title = (b.itemLabel || {}).value || ''; if (/^Q\d+$/.test(title)) title = '';
  let artist = (b.creatorLabel || {}).value || ''; if (/^Q\d+$/.test(artist) || /^https?:/.test(artist)) artist = '';
  const ym = /^(-?)0*(\d+)-/.exec((b.inc || {}).value || '');
  return [+qid.slice(1), title.trim().slice(0, 90), artist.trim().slice(0, 60), ym ? +ym[2] * (ym[1] ? -1 : 1) : null, name];
}

async function build(m) {
  const qids = await resolve(m);
  if (!qids.length) throw new Error('no encuentro el museo en Wikidata');
  const by = {};
  for (const [t, classes] of Object.entries(TYPES)) {
    const seen = new Set(), rows = [];
    for (const q of qids) {
      for (let off = 0; ; off += PAGE) {
        const bs = await sparql(query(q, classes, off));
        bs.forEach(b => { const r = row(b); if (r && !seen.has(r[0])) { seen.add(r[0]); rows.push(r); } });
        if (bs.length < PAGE) break;
        await sleep(1500);
      }
    }
    by[t] = rows; await sleep(1000);
  }
  return { qids, by };
}

function write(key, { qids, by }) {
  const out = path.join(OUT, key);
  fs.mkdirSync(out, { recursive: true });
  fs.readdirSync(out).forEach(f => fs.unlinkSync(path.join(out, f)));
  const index = { _q: qids };
  for (const [t, rows] of Object.entries(by)) {
    if (!rows.length) continue;
    rows.sort((a, b) => (a[3] == null) - (b[3] == null) || (a[3] || 0) - (b[3] || 0));
    index[t] = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK), name = t + '-' + (i / CHUNK) + '.json';
      fs.writeFileSync(path.join(out, name), JSON.stringify(part));
      const ys = part.map(x => x[3]).filter(y => y != null);
      index[t].push({ f: name, n: part.length, y0: ys.length ? Math.min(...ys) : null, y1: ys.length ? Math.max(...ys) : null });
    }
  }
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index));
}

const keys = process.argv.slice(2).length ? process.argv.slice(2) : C.WD_SHARDS;
const summary = {}, failed = [];
for (const k of keys) {
  const m = C.MUSEUMS.find(x => x.id === k);
  try {
    const res = await build(m);
    const total = Object.values(res.by).reduce((s, r) => s + r.length, 0);
    if (total < MIN) throw new Error('muy pocas obras (' + total + '): no se sobrescribe');
    write(k, res);
    summary[k] = Object.fromEntries(Object.entries(res.by).map(([t, r]) => [t, r.length]).concat([['q', res.qids.join(',')]]));
    console.log(k, JSON.stringify(summary[k]));
  } catch (e) { failed.push(k); summary[k] = { error: e.message }; console.error('ERROR', k, e.message); } // se conservan los datos anteriores
  await sleep(1500);
}
fs.writeFileSync(path.join(OUT, 'wd-summary.json'), JSON.stringify({ at: new Date().toISOString().slice(0, 10), museums: summary }, null, 1));
if (failed.length === keys.length) process.exit(1);
