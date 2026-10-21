const C = require('../src/core.js');
const assert = require('assert');
const calls = []; const sparqlLog = [];
const J = o => ({ ok: true, status: 200, json: async () => o });

// Fixtures con la forma de las respuestas reales observadas
const fx = {
  metSearch: { total: 3, objectIDs: [436535, 1, 2] },
  metObj: id => id === 436535 ? { objectID: 436535, isPublicDomain: true, primaryImage: 'http://images.metmuseum.org/a.jpg', primaryImageSmall: 'https://images.metmuseum.org/a_s.jpg', title: 'Wheat Field with Cypresses', artistDisplayName: 'Vincent van Gogh', objectDate: '1889', objectBeginDate: 1889, objectEndDate: 1889, classification: 'Paintings', objectName: 'Painting', medium: 'Oil on canvas', objectURL: 'https://www.metmuseum.org/art/collection/search/436535' } : { objectID: id, isPublicDomain: false, primaryImage: '' },
  aicCount: { pagination: { total: 62119 }, data: [{ id: 1 }] },
  aicData: { pagination: { total: 62119 }, data: [{ id: 27992, title: 'A Sunday on La Grande Jatte — 1884', artist_title: 'Georges Seurat', date_display: '1884–86', date_start: 1884, date_end: 1886, image_id: 'abc-123', thumbnail: { width: 9310, height: 6237 }, artwork_type_title: 'Painting', classification_title: 'oil on canvas', is_public_domain: true }], config: { iiif_url: 'https://www.artic.edu/iiif/2' } },
  cma: { info: { total: 47 }, data: [{ id: 320778, title: 'Banks of the Oise at Dawn', creation_date: '1888', creation_date_earliest: 1887, creation_date_latest: 1888, type: 'Painting', technique: 'Oil on canvas', share_license_status: 'CC0', url: 'https://clevelandart.org/art/2019.18', creators: [{ description: 'Louis Hayet (French, 1864–1940)' }], images: { web: { url: 'https://openaccess-cdn.clevelandart.org/2019.18/2019.18_web.jpg', width: '900', height: '643' }, print: { url: 'https://openaccess-cdn.clevelandart.org/2019.18/2019.18_print.jpg', width: '3400', height: '2430' } } }] },
  smk: { found: 23, items: [{ object_number: 'KMS3427', has_image: true, public_domain: true, titles: [{ title: 'The Blue Kitchen', language: 'engelsk' }, { title: 'Det blå køkken', language: 'dansk' }], artist: ['Ludvig Karsten'], production_date: [{ start: '1913-01-01T00:00:00.000Z', period: '1913' }], object_names: [{ name: 'Painting' }], techniques: ['Oil on canvas'], image_iiif_id: 'https://iip.smk.dk/iiif/jp2/x.tif.jp2', image_thumbnail: 'https://api.smk.dk/api/v1/thumbnail/0fcaa449.jpg', image_width: 1087, image_height: 1600, frontend_url: 'https://open.smk.dk/artwork/image/KMS3427' }] },
  vam: { info: { record_count: 56 }, records: [{ systemNumber: 'O134546', objectType: 'Oil painting', _primaryTitle: 'Composition with Tulips and Hat', _primaryMaker: { name: 'Grant, Duncan' }, _primaryDate: '1925', _primaryImageId: '2007BP0758' }] },
  mia: { hits: { total: { value: 18 }, hits: [{ _source: { id: 1272, title: 'Port-en-Bessin', artist: 'Georges Seurat', dated: '1888', classification: 'Paintings', medium: 'Oil on canvas', rights_type: 'Public Domain', image: 'valid', image_width: 6328, image_height: 5017 } }, { _source: { id: 5, title: 'X', rights_type: 'In Copyright', image: 'valid', image_width: 10, image_height: 10 } }] } },
  eu: { totalResults: 1297, items: [{ id: '/1/a', title: ['Post-Impressionism'], edmIsShownBy: ['http://x.org/a.jpg'], edmPreview: ['https://api.europeana.eu/thumbnail/v2/url.json?uri=x'], dataProvider: ['Bauhaus'], rights: ['http://creativecommons.org/publicdomain/mark/1.0/'], guid: 'https://www.europeana.eu/item/1/a' }] },
  rijksSearch: { orderedItems: [{ id: 'https://id.rijksmuseum.nl/200100988' }] },
  rijksObj: { id: 'https://id.rijksmuseum.nl/200100988', identified_by: [{ type: 'Name', content: 'Misty Sea', language: [{ id: 'http://vocab.getty.edu/aat/300388277' }] }], produced_by: { timespan: { identified_by: [{ content: '1899' }], begin_of_the_begin: '1899-01-01T00:00:00Z' }, part: [{ carried_out_by: [{ notation: [{ '@language': 'en', '@value': 'Jan Toorop' }] }] }] }, shows: [{ id: 'https://id.rijksmuseum.nl/202100988' }], classified_as: [{ notation: [{ '@language': 'en', '@value': 'painting' }] }] },
  rijksVis: { digitally_shown_by: [{ id: 'https://id.rijksmuseum.nl/5008910398567010810098' }] },
  rijksDig: { access_point: [{ id: 'https://iiif.micr.io/RFwqO' }] },
  wd: { results: { bindings: Array.from({ length: 10 }, (_, i) => ({ item: { value: 'http://www.wikidata.org/entity/Q' + (100 + i) }, itemLabel: { value: 'Impression ' + i }, creatorLabel: { value: 'Claude Monet' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Monet%20' + i + '.jpg' }, inc: { value: '1872-01-01T00:00:00Z' }, collLabel: { value: 'Musée Marmottan Monet' } })) } }
};
globalThis.fetch = async (url, init) => {
  url = String(url); calls.push(url);
  if (url.includes('metmuseum.org') && url.includes('/search')) return J(fx.metSearch);
  if (url.includes('metmuseum.org') && url.includes('/objects/')) return J(fx.metObj(+url.split('/').pop()));
  if (url.includes('api.artic.edu')) { const b = init && init.body ? JSON.parse(init.body) : null; return J(b && b.limit === 1 ? fx.aicCount : fx.aicData); }
  if (url.includes('clevelandart')) return J(fx.cma);
  if (url.includes('smk.dk')) return J(fx.smk);
  if (url.includes('vam.ac.uk')) return J(fx.vam);
  if (url.includes('artsmia')) return J(fx.mia);
  if (url.includes('europeana')) return J(fx.eu);
  if (url.includes('data.rijksmuseum.nl/search')) return J(fx.rijksSearch);
  if (url.includes('data.rijksmuseum.nl/200100988')) return J(fx.rijksObj);
  if (url.includes('data.rijksmuseum.nl/202100988')) return J(fx.rijksVis);
  if (url.includes('data.rijksmuseum.nl/5008910398567010810098')) return J(fx.rijksDig);
  if (url.includes('wikidata')) { const q = decodeURIComponent(url.split('query=')[1]); sparqlLog.push(q); return J(/COUNT\(/.test(q) ? { results: { bindings: [{ n: { value: '4200' } }] } } : fx.wd); }
  throw new Error('URL no simulada: ' + url);
};

(async () => {
  // utilidades
  assert.strictEqual(C.parseYear('c. 1895'), 1895);
  assert.strictEqual(C.parseYear('400 B.C.'), -400);
  assert.strictEqual(C.parseYear('1600–1650'), 1600);
  assert.strictEqual(C.flipName('Grant, Duncan'), 'Duncan Grant');
  assert.strictEqual(C.classifyType('Oil on canvas'), 'painting');
  assert.strictEqual(C.classifyType('Color woodblock print'), 'print');
  assert.strictEqual(C.classifyType('Albumen silver print'), 'photo');
  assert.strictEqual(C.classifyType('Watercolor on paper'), 'drawing');
  assert.strictEqual(C.keywordToQuery('Caballos'), 'horse');

  // planes y filtros
  const f = C.defaultFilters();
  f.styles = ['impressionism']; f.eras = ['barroco'];
  assert.strictEqual(C.makePlan(f).empty, true, 'estilo fuera de época debe vaciar el plan');
  f.eras = ['s19b'];
  const p = C.makePlan(f); assert.ok(p.range[0] >= 1870 && p.range[1] <= 1900, JSON.stringify(p.range));
  const mkw = o => C.mk(Object.assign({ src: 't', museum: 'T', id: Math.random(), title: 'T', imgs: ['https://x/y.jpg'] }, o));
  assert.ok(C.accept(mkw({ year: 1880, type: 'painting' }), f));
  assert.ok(!C.accept(mkw({ year: 1700 }), f));
  assert.ok(!C.accept(mkw({ year: null }), f));
  const g = C.defaultFilters(); g.artists = ['Van Gogh'];
  assert.ok(C.accept(mkw({ artist: 'Vincent van Gogh' }), g));
  assert.ok(!C.accept(mkw({ artist: 'Monet' }), g));
  assert.ok(!C.accept(mkw({ type: 'decorative' }), C.defaultFilters()));
  const h = C.defaultFilters(); h.orientation = 'landscape';
  assert.ok(!C.accept(mkw({ w: 100, h: 200 }), h)); assert.ok(C.accept(mkw({ w: 200, h: 100 }), h));
  const q = C.defaultFilters(); q.soloPD = true;
  assert.ok(!C.accept(mkw({ pd: null }), q)); assert.ok(C.accept(mkw({ pd: true }), q));

  // adaptadores
  const ctx = { hq: false, keys: { europeana: 'k', si: 'k', harvard: 'k' } };
  const plan = { style: C.STYLES.find(s => s.id === 'impressionism'), range: [1860, 1925], artist: null, keyword: null, type: 'painting', hintArtist: 'Monet' };
  for (const s of C.SOURCE_LIST) {
    if (s.id === 'si' || s.id === 'harvard') continue;
    const list = await s.fetch(plan, C.defaultFilters(), ctx);
    assert.ok(list.length >= 1, s.id + ' sin resultados');
    const w = list[0];
    assert.ok(w.uid && w.imgs.length && /^https:/.test(w.imgs[0]), s.id + ' img: ' + w.imgs[0]);
    assert.ok(w.title && w.museum, s.id + ' ficha');
    console.log(s.id.padEnd(9), '|', w.title.slice(0, 32).padEnd(32), '|', (w.artist || '-').padEnd(16), '|', w.year, '|', w.type, '|', w.imgs[0].slice(0, 70));
  }
  // museos famosos
  const ff = C.defaultFilters(); ff.museums = ['louvre', 'orsay'];
  const fam = await C.runSource(C.SOURCE_LIST.find(x => x.id === 'famous'), ff, ctx);
  assert.ok(fam.length >= 1, 'famous vacío');
  const museos = new Set(fam.map(x => x.museum)); console.log('famous  |', [...museos].join(' + '), '|', fam.length, 'obras');
  assert.ok([...museos].every(m => /Louvre|Orsay/.test(m)));
  const sel = sparqlLog.filter(q => !/COUNT\(/.test(q)).pop();
  assert.ok(/VALUES \?lbl \{[^}]*"Musée du Louvre"@fr|VALUES \?lbl \{[^}]*"Musée d'Orsay"@fr/.test(sel), 'falta unión por etiqueta del museo');
  assert.ok(/OFFSET (\d+)/.test(sel) && +sel.match(/OFFSET (\d+)/)[1] <= 4141, 'offset fuera de rango');
  console.log('SPARQL museo:', sel.slice(0, 260).replace(/\s+/g, ' '), '…');
  const none = C.defaultFilters(); none.museums = [];
  assert.deepStrictEqual(await C.runSource(C.SOURCE_LIST.find(x => x.id === 'famous'), none, ctx), []);
  // con estilo y época
  const fe = C.defaultFilters(); fe.museums = ['orsay']; fe.styles = ['impressionism']; fe.eras = ['s19b'];
  await C.runSource(C.SOURCE_LIST.find(x => x.id === 'famous'), fe, ctx);
  const q2 = sparqlLog[sparqlLog.length - 1]; assert.ok(/P135/.test(q2) && /YEAR\(\?inc\) >= 18[67]/.test(q2), 'filtros de estilo/época no llegan');
  // runSource con relajación
  const r = await C.runSource(C.SOURCE_LIST[0], C.defaultFilters(), ctx);
  assert.ok(r.length);
  // Smithsonian y Harvard: respuesta mínima
  fx.si = { response: { rowCount: 3, rows: [{ content: { descriptiveNonRepeating: { title: { content: 'Sunset' }, record_ID: 'saam_1', data_source: 'Smithsonian American Art Museum', record_link: 'https://x', online_media: { media: [{ type: 'Images', content: 'https://ids.si.edu/ids/deliveryService?id=SAAM-1', usage: { access: 'CC0' } }] } }, freetext: { name: [{ content: 'Church, Frederic Edwin' }], date: [{ content: '1860' }] } } }] } };
  fx.hv = { info: { totalrecords: 4 }, records: [{ id: 9, title: 'Study', people: [{ displayname: 'Winslow Homer' }], dated: '1880', datebegin: 1880, dateend: 1880, primaryimageurl: 'https://nrs.harvard.edu/urn-3:HUAM:1', classification: 'Paintings', url: 'https://harvardartmuseums.org/collections/object/9' }] };
  const prev = globalThis.fetch;
  globalThis.fetch = async (u, i) => { u = String(u); if (u.includes('api.si.edu')) return J(fx.si); if (u.includes('harvardartmuseums')) return J(fx.hv); return prev(u, i); };
  for (const id of ['si', 'harvard']) { const l = await C.SOURCE_LIST.find(x => x.id === id).fetch(plan, C.defaultFilters(), ctx); assert.ok(l.length === 1, id); console.log(id.padEnd(9), '|', l[0].title, '|', l[0].artist, '|', l[0].imgs[0]); }
  // clave ausente
  try { await C.adapters.harvardFetch(plan, {}, { keys: {} }); assert.fail('debía fallar'); } catch (e) { assert.ok(e.noKey); }
  console.log('Peticiones de ejemplo:'); [0, 1, 3].forEach(i => console.log(' ', calls[i].slice(0, 150)));
  console.log('TODO OK');
})().catch(e => { console.error('FALLO', e); process.exit(1); });
