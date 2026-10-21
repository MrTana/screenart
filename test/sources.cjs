/* Pruebas de MoMA (datos abiertos), Princeton (DPUL) y Commons especial, con red simulada. */
const assert = require('assert'), fs = require('fs'), path = require('path');
const C = require('../src/core.js');
const J = o => ({ ok: true, status: 200, json: async () => o });
const log = [];
const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/moma/index.json'), 'utf8'));
(async () => {
  // token: reconstruir y decodificar
  const rows0 = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/moma', idx.painting[0].f), 'utf8'));
  globalThis.fetch = async u => {
    u = String(u); log.push(u);
    if (u.includes('data/moma/')) { const n = u.split('data/moma/')[1]; if (!u.startsWith('http')) throw new Error('relativa'); return J(JSON.parse(fs.readFileSync(path.join(__dirname, '../data/moma', n), 'utf8'))); }
    if (u.includes('dpul.princeton.edu')) return J({ meta: { pages: { total_pages: 3 } }, data: [
      { id: 'abc-123', attributes: { title_display: { attributes: { value: 'Flowers' } }, creator_display: 'x' }, links: { iiif: 'https://iiif-cloud.princeton.edu/iiif/2/ab%2Fcd%2Fef%2Fabcdef/full/!200,200/0/default.jpg' } },
      { id: 'no-img', attributes: { title_display: 'Sin imagen' } }] });
    if (u.includes('commons.wikimedia.org')) return J({ query: { pages: [] } });
    throw new Error('inesperada ' + u);
  };
  const ctx = { hq: false, keys: {}, report() {} };
  const plan = Object.assign(C.makePlan(C.defaultFilters()), { type: 'painting', range: null, artist: null, keyword: null, style: null });
  const l = await C.adapters.momaFetch(plan, C.defaultFilters(), ctx);
  assert.ok(l.length > 5, 'MoMA devuelve obras');
  const w = l[0];
  assert.ok(/^https:\/\/www\.moma\.org\/media\/[A-Za-z0-9_-]+\.jpg\?sha=[0-9a-f]{16}$/.test(w.imgs[0]), 'URL de imagen: ' + w.imgs[0]);
  const tok = w.imgs[0].split('/media/')[1].split('.jpg')[0];
  const dec = Buffer.from(tok.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
  assert.ok(/^\[\["f","\d+"\],\["p","convert","-resize 1024x1024\\u003e"\]\]$/.test(dec), 'token: ' + dec);
  assert.ok(w.url.startsWith('https://www.moma.org/collection/works/') && w.museum === 'MoMA (Nueva York)');
  // filtro por artista
  const art = rows0[0][2];
  const l2 = await C.adapters.momaFetch(Object.assign({}, plan, { artist: art }), C.defaultFilters(), ctx);
  assert.ok(l2.length && l2.every(x => x.artist.toLowerCase().includes(art.toLowerCase())), 'filtro por artista');
  // rango: sólo trozos que solapan
  const p3 = Object.assign({}, plan, { range: [1880, 1890] });
  log.length = 0; const l3 = await C.adapters.momaFetch(p3, C.defaultFilters(), ctx);
  assert.ok(l3.every(x => x.year >= 1880 && x.year <= 1890), 'rango respetado');
  // es la fuente directa del museo MoMA
  assert.ok(C.SOURCE_LIST.find(s => s.id === 'm:moma'), 'existe m:moma');
  // DPUL
  const d = await C.adapters.dpulFetch(Object.assign({}, plan, { keyword: 'flowers' }), C.defaultFilters(), ctx);
  assert.strictEqual(d.length, 1, 'DPUL sólo con imagen');
  assert.ok(/^https:\/\/iiif-cloud\.princeton\.edu\/iiif\/2\/ab%2Fcd%2Fef%2Fabcdef\/full\/!2000,2000\/0\/default\.jpg$/.test(d[0].imgs[0]), d[0].imgs[0]);
  // Commons especial: consultas
  log.length = 0;
  await C.adapters.commonsSpecial('gap', Object.assign({}, plan, { artist: 'Claude Monet' }), C.defaultFilters(), ctx);
  await C.adapters.commonsSpecial('fp', plan, C.defaultFilters(), ctx);
  const dec2 = log.map(decodeURIComponent).join('\n');
  assert.ok(/Google Art Project/.test(dec2) && /Featured pictures of paintings/.test(dec2), 'consultas especiales');
  console.log('MoMA', l.length, '· DPUL', d.length, '· Commons especial OK');
})().catch(e => { console.error('FALLO', e); process.exit(1); });
