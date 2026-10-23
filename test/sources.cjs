/* Pruebas de MoMA (datos abiertos), Commons especial, con red simulada. */
const assert = require('assert'), fs = require('fs'), path = require('path');
const C = require('../src/core.js');
const J = o => ({ ok: true, status: 200, json: async () => o });
const log = [];
const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/moma/index.json'), 'utf8'));
const WDFX = { 'index.json': { painting: [{ f: 'painting-0.json', n: 3, y0: 1503, y1: 1950 }] },
  'painting-0.json': [[12418, 'La Gioconda', 'Leonardo da Vinci', 1503, 'Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg'], [1, 'Otra', 'Pintor', 1870, 'Otra_obra.jpg'], [2, 'Moderna', 'Pintor moderno', 1950, 'Moderna.png']] };
(async () => {
  // token: reconstruir y decodificar
  const rows0 = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/moma', idx.painting[0].f), 'utf8'));
  globalThis.fetch = async u => {
    u = String(u); log.push(u);
    const wm = u.match(/data\/(louvre|orsay|prado)\/(.+)$/);
    if (wm) { if (!u.startsWith('http')) throw new Error('relativa'); if (wm[1] === 'prado') return { ok: false, status: 404, json: async () => ({}) }; const fx = WDFX[wm[2]]; return fx ? J(fx) : { ok: false, status: 404, json: async () => ({}) }; }
    const dm = u.match(/data\/(moma|nga|tate)\/(.+)$/); if (dm) { if (!u.startsWith('http')) throw new Error('relativa'); return J(JSON.parse(fs.readFileSync(path.join(__dirname, '../data', dm[1], dm[2]), 'utf8'))); }
    if (false) return J({ meta: { pages: { total_pages: 3 } }, data: [
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
  // Commons especial: consultas
  log.length = 0;
  await C.adapters.commonsSpecial('gap', Object.assign({}, plan, { artist: 'Claude Monet' }), C.defaultFilters(), ctx);
  await C.adapters.commonsSpecial('fp', plan, C.defaultFilters(), ctx);
  const dec2 = log.map(decodeURIComponent).join('\n');
  assert.ok(/Google Art Project/.test(dec2) && /Featured pictures of paintings/.test(dec2), 'consultas especiales');
  // NGA y Tate: mismas piezas, imágenes IIIF / de Tate con alternativas
  const ng = await C.adapters.ngaFetch(plan, C.defaultFilters(), ctx);
  assert.ok(ng.length > 5 && /^https:\/\/api\.nga\.gov\/iiif\/[0-9a-f-]{36}\/full\/!1920,1920\/0\/default\.jpg$/.test(ng[0].imgs[0]) && ng[0].imgs.length === 2, 'NGA ' + ng[0].imgs);
  assert.ok(/^https:\/\/www\.nga\.gov\/artworks\/\d+$/.test(ng[0].url));
  const ta = await C.adapters.tateFetch(plan, C.defaultFilters(), ctx);
  assert.ok(ta.length > 5 && /^https:\/\/media\.tate\.org\.uk\/art\/images\/work\/\w\/\w+\/\w+_10\.jpg$/.test(ta[0].imgs[0]) && ta[0].imgs.length === 3, 'Tate ' + ta[0].imgs);
  assert.ok(/^https:\/\/www\.tate\.org\.uk\/art\/artworks\/[\w-]+$/.test(ta[0].url));
  // con artista se revisan todos los trozos: «Van Gogh» aparece en MoMA y en NGA aunque estén en trozos distintos
  const pg = Object.assign({}, plan, { artist: 'Vincent van Gogh' });
  const vg = (await C.adapters.ngaFetch(pg, C.defaultFilters(), ctx)).concat(await C.adapters.momaFetch(pg, C.defaultFilters(), ctx));
  assert.ok(vg.length > 3 && vg.every(x => /gogh/i.test(x.artist)), 'Van Gogh en NGA/MoMA: ' + vg.length);
  { // colecciones precargadas desde Wikidata (Louvre, Orsay, Prado)
    const louvre = C.SOURCE_LIST.find(s => s.id === 'm:louvre'), prado = C.SOURCE_LIST.find(s => s.id === 'm:prado');
    assert.ok(/^Directa/.test(louvre.note), 'el Louvre tiene lista directa: ' + louvre.note);
    const rep = {};
    const out = await C.runSource(louvre, C.defaultFilters(), Object.assign({}, ctx, { report: (n, c, e) => { rep[n] = e ? 'x' : c; } }));
    assert.strictEqual(rep.Directa, 3, 'la lista del Louvre aporta sus obras (aunque se pida otro tipo): ' + JSON.stringify(rep));
    const gi = out.find(x => x.src === 'louvre' && x.title === 'La Gioconda');
    assert.ok(gi && gi.museum === 'Louvre (París)' && gi.url === 'https://www.wikidata.org/wiki/Q12418' && gi.pd === true, 'ficha: ' + JSON.stringify(gi));
    assert.strictEqual(gi.imgs[0], 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg/1920px-Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg');
    assert.ok(out.find(x => x.title === 'Moderna').pd === null, 'obra moderna: sin marcar como dominio público');
    const rp = {}; await C.runSource(prado, C.defaultFilters(), Object.assign({}, ctx, { report: (n, c, e) => { rp[n] = e ? 'x' : c; } }));
    assert.strictEqual(rp.Directa, 0, 'sin lista todavía: no es un error, el museo sigue con sus otras fuentes');
  }
  { const ko = await C.adapters.momaFetch(Object.assign({}, plan, { style: C.STYLES.find(x => x.id === 'korean') }), C.defaultFilters(), ctx); assert.strictEqual(ko.length, 0, 'las listas de museos no inventan pintura coreana'); }
  // catálogo de artistas y estilos
  const names = [].concat(...C.ARTIST_GROUPS.map(g => g.names));
  assert.ok(new Set(names).size >= 200 && names.includes('Remedios Varo'), 'al menos 200 artistas');
  assert.ok(C.STYLES.length >= 55 && C.STYLES.every(x => x.range && x.range[0] < x.range[1]), 'estilos');
  // WikiArt de un artista y estilo sin WikiArt no recurre a otro estilo
  globalThis.fetch = async u => { u = String(u); log.push(u); if (u.includes('wikiart.org')) return J({ AllPaintingsCount: 3, PageSize: 60, Paintings: [{ id: 'a', title: 'La tierra', artistName: 'Remedios Varo', year: 1943, image: 'https://uploads.wikiart.org/x/la.jpg!Large.jpg', paintingUrl: '/en/remedios-varo/la' }] }); throw new Error('no'); };
  log.length = 0;
  const wv = await C.adapters.wikiartFetch(Object.assign({}, plan, { artist: 'Remedios Varo' }), Object.assign(C.defaultFilters(), { artists: ['Remedios Varo'] }), ctx);
  assert.ok(wv.length === 1 && log[0].includes('/en/remedios-varo/mode/all-paintings'), log[0]);
  const none = C.STYLES.find(x => !x.wa);
  log.length = 0; assert.deepStrictEqual(await C.adapters.wikiartFetch(Object.assign({}, plan, { style: none }), C.defaultFilters(), ctx), []); assert.strictEqual(log.length, 0, 'sin WikiArt para ese estilo');
  // Wikidata: la consulta con artista usa «.» entre los parámetros del servicio (con «;» el servidor responde 400)
  const sq = [];
  globalThis.fetch = async u => { u = String(u); if (u.includes('query.wikidata.org')) sq.push(decodeURIComponent(u.split('query=')[1])); return J({ results: { bindings: [{ n: { value: '0' } }] } }); };
  const fv = Object.assign(C.defaultFilters(), { artists: ['Remedios Varo'] });
  await C.runSource(C.SOURCE_LIST.find(x => x.id === 'm:orsay'), fv, Object.assign({}, ctx, { anyRights: true }));
  const aq = sq.find(q => /mwapi/.test(q));
  assert.ok(aq && /wikibase:api "EntitySearch" \. bd:serviceParam mwapi:search "Remedios Varo" \./.test(aq) && !/"; bd:serviceParam/.test(aq), 'servicio mwapi bien formado');
  assert.ok(!sq.filter(q => /COUNT/.test(q)).some(q => /wdt:P31 \?cls/.test(q)), 'el conteo no arrastra uniones innecesarias');
  // Colecciones sin CORS: si la petición directa falla, se repite por /api/p
  globalThis.location = { protocol: 'https:', hostname: 'screenart.test' };
  const prox = [];
  globalThis.fetch = async u => { u = String(u); if (u.startsWith('/api/p?u=')) { prox.push(decodeURIComponent(u.slice(9))); return J({ AllPaintingsCount: 1, PageSize: 60, Paintings: [{ id: 'w', title: 'Casa', artistName: 'Remedios Varo', year: 1940, image: 'https://uploads.wikiart.org/a.jpg!Large.jpg', paintingUrl: '/en/x/y' }] }); } throw new TypeError('Failed to fetch'); };
  const viaWa = await C.adapters.wikiartFetch(Object.assign({}, plan, { artist: 'Leonora Carrington' }), Object.assign(C.defaultFilters(), { artists: ['Leonora Carrington'] }), ctx);
  assert.ok(viaWa.length === 1 && /wikiart\.org\/en\/leonora-carrington\/mode\/all-paintings\?json=2/.test(prox[0]), 'WikiArt por el intermediario');
  delete globalThis.location;
  // WikiArt primero: la fila de colecciones abiertas entrega sus obras en cuanto llegan
  globalThis.fetch = async u => { u = String(u); if (u.includes('wikiart.org')) return J({ AllPaintingsCount: 1, PageSize: 60, Paintings: [{ id: 'z', title: 'Prioridad', artistName: 'X', year: 1950, image: 'https://uploads.wikiart.org/p.jpg!Large.jpg', paintingUrl: '/en/x/p' }] }); await new Promise(r => setTimeout(r, 60)); return J({ query: { pages: [] } }); };
  const earlyGot = []; const fsw = Object.assign(C.defaultFilters(), { styles: ['surrealism'] });
  const t0 = Date.now(); await C.runSource(C.SOURCE_LIST.find(x => x.id === 'm:open'), fsw, Object.assign({}, ctx, { early: l => earlyGot.push(l.length) }));
  assert.ok(earlyGot.length >= 1 && earlyGot[0] >= 1, 'WikiArt entrega antes de terminar la fila');
  const ids = C.MUSEUMS.map(m => m.id); assert.strictEqual(new Set(ids).size, ids.length, 'ids de museo únicos');
  assert.ok(C.museumIdsByTag('artist').length >= 20, 'museos de un solo artista');
  console.log('MoMA', l.length, '· Commons especial OK');
})().catch(e => { console.error('FALLO', e); process.exit(1); });
