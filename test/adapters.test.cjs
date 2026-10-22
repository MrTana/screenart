const C = require('../src/core.js');
const assert = require('assert');
const calls = []; const sparqlLog = []; let aicBodies = []; let sparqlActive = 0, sparqlMax = 0;
const commonsLog = []; let commonsEmpty = [];
const J = o => ({ ok: true, status: 200, json: async () => o });

// Fixtures con la forma de las respuestas reales observadas
const fx = {
  metSearch: { total: 3, objectIDs: [436535, 1, 2] },
  metObj: id => id === 436535 ? { objectID: 436535, isPublicDomain: true, primaryImage: 'http://images.metmuseum.org/a.jpg', primaryImageSmall: 'https://images.metmuseum.org/a_s.jpg', title: 'Wheat Field with Cypresses', artistDisplayName: 'Vincent van Gogh', objectDate: '1889', objectBeginDate: 1889, objectEndDate: 1889, classification: 'Paintings', objectName: 'Painting', medium: 'Oil on canvas', objectURL: 'https://www.metmuseum.org/art/collection/search/436535' } : id === 2 ? { objectID: 2, isPublicDomain: false, primaryImage: '', primaryImageSmall: 'https://i/protegida.jpg', title: 'Obra protegida', artistDisplayName: 'Alguien', objectDate: '1960', objectBeginDate: 1960, objectEndDate: 1960, classification: 'Paintings', objectURL: 'https://m/2' } : { objectID: id, isPublicDomain: false, primaryImage: '' },
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
  wpPages: [
    { pageid: 5, title: 'Water Lilies (Monet)', description: '1906 painting by Claude Monet', original: { source: 'https://upload.wikimedia.org/x/Nympheas.jpg', width: 3000, height: 2000 }, thumbnail: { source: 'https://upload.wikimedia.org/t/1600px-N.jpg', width: 1600, height: 1067 } },
    { pageid: 6, title: "Musée d'Orsay", description: 'art museum in Paris', original: { source: 'https://upload.wikimedia.org/x/Orsay.jpg', width: 3000, height: 2000 } },
    { pageid: 7, title: 'Un político', description: 'French politician', original: { source: 'https://upload.wikimedia.org/x/P.jpg', width: 3000, height: 2000 } },
    { pageid: 8, title: 'Sin imagen', description: 'painting by Nobody' }
  ],
  commonsPages: [
    { pageid: 11, title: 'File:La persistencia de la memoria.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/thumb/a/1800px-m.jpg', url: 'https://upload.wikimedia.org/a/m.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:m.jpg', width: 3000, height: 2000, mime: 'image/jpeg', extmetadata: { ObjectName: { value: 'The Persistence of Memory' }, Artist: { value: '<a href="x">Salvador Dalí</a>' }, DateTimeOriginal: { value: '1931' }, LicenseShortName: { value: 'Public domain' } } }] },
    { pageid: 12, title: 'File:Tiny.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/t.jpg', url: 'https://upload.wikimedia.org/t.jpg', width: 200, height: 100, mime: 'image/jpeg', extmetadata: {} }] },
    { pageid: 13, title: 'File:Doc.pdf', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/d.jpg', url: 'https://upload.wikimedia.org/d.pdf', width: 3000, height: 2000, mime: 'application/pdf', extmetadata: {} }] },
    { pageid: 14, title: 'File:Golconda.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/thumb/g.jpg', url: 'https://upload.wikimedia.org/g.jpg', width: 2400, height: 3000, mime: 'image/jpeg', extmetadata: { Artist: { value: 'René Magritte' }, DateTimeOriginal: { value: '<time>1953</time>' }, LicenseShortName: { value: 'All rights reserved' } } }] }
  ],
  wikiart: { Paintings: [{ id: 'a1', title: 'The Big Wheel', year: '1911-1912', width: 901, height: 599, artistName: 'Marc Chagall', image: 'https://uploads5.wikiart.org/images/marc-chagall/the-big-wheel.jpg', paintingUrl: '/en/marc-chagall/the-big-wheel' }], AllPaintingsCount: 2400, PageSize: 60 },
  wdRows: [
    { item: { value: 'http://www.wikidata.org/entity/Q1' }, itemLabel: { value: 'La Gioconda' }, creatorLabel: { value: 'Leonardo da Vinci' }, clsLabel: { value: 'pintura' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Mona%20Lisa.jpg' }, inc: { value: '1503-01-01T00:00:00Z' } },
    { item: { value: 'http://www.wikidata.org/entity/Q2' }, itemLabel: { value: 'Venus de Milo' }, clsLabel: { value: 'escultura' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Venus.JPG' }, inc: { value: '-0150-01-01T00:00:00Z' } },
    { item: { value: 'http://www.wikidata.org/entity/Q3' }, itemLabel: { value: 'Obra moderna' }, creatorLabel: { value: 'Pintor Vivo' }, clsLabel: { value: 'pintura' }, image: { value: 'https://museo.example/img/obra.jpg' }, inc: { value: '1985-01-01T00:00:00Z' } },
    { item: { value: 'http://www.wikidata.org/entity/Q4' }, itemLabel: { value: 'Escaneo' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Scan.tif' } },
    { item: { value: 'http://www.wikidata.org/entity/Q5' }, itemLabel: { value: 'Vídeo' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Clip.webm' } }
  ],
  wd: { results: { bindings: Array.from({ length: 10 }, (_, i) => ({ item: { value: 'http://www.wikidata.org/entity/Q' + (100 + i) }, itemLabel: { value: 'Impression ' + i }, creatorLabel: { value: 'Claude Monet' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Monet%20' + i + '.jpg' }, inc: { value: '1872-01-01T00:00:00Z' }, collLabel: { value: 'Musée Marmottan Monet' } })) } }
};
globalThis.fetch = async (url, init) => {
  url = String(url); calls.push(url);
  if (url.includes('metmuseum.org') && url.includes('/search')) return J(fx.metSearch);
  if (url.includes('metmuseum.org') && url.includes('/objects/')) return J(fx.metObj(+url.split('/').pop()));
  if (url.includes('api.artic.edu')) { aicBodies.push(url); if (init && init.method === 'POST') throw new TypeError('Failed to fetch'); if (/[?&](fields|page)=/.test(url)) throw new TypeError('Failed to fetch'); return J(fx.aicData); }
  if (url.includes('clevelandart')) return J(fx.cma);
  if (url.includes('smk.dk')) return J(fx.smk);
  if (url.includes('vam.ac.uk')) return J(fx.vam);
  if (url.includes('artsmia')) return J(fx.mia);
  if (url.includes('europeana')) return J(fx.eu);
  if (url.includes('data.rijksmuseum.nl/search')) return J(fx.rijksSearch);
  if (url.includes('data.rijksmuseum.nl/200100988')) return J(fx.rijksObj);
  if (url.includes('data.rijksmuseum.nl/202100988')) return J(fx.rijksVis);
  if (url.includes('data.rijksmuseum.nl/5008910398567010810098')) return J(fx.rijksDig);
  if (url.includes('www.wikidata.org/w/api.php')) {
    const term = decodeURIComponent(url.split('search=')[1].split('&')[0]);
    return J({ search: /^zzz/.test(term) ? [] : [{ id: 'Q999', label: term, description: 'museo de arte en Ciudad' }, { id: 'Q1000', label: term + ' (desambiguación)', description: 'página de desambiguación' }] });
  }
  if (url.includes('en.wikipedia.org/w/api.php')) {
    if (url.includes('list=search')) return J({ query: { searchinfo: { totalhits: 77 } } });
    return J({ query: { pages: fx.wpPages } });
  }
  if (url.includes('commons.wikimedia.org/w/api.php')) {
    const u = new URL(url), sr = decodeURIComponent(u.searchParams.get('srsearch') || u.searchParams.get('gsrsearch') || '');
    commonsLog.push(sr);
    const empty = commonsEmpty.some(e => sr.includes(e));
    if (u.searchParams.get('list') === 'search') return J({ query: { searchinfo: { totalhits: empty ? 0 : 321 } } });
    return J({ query: { pages: fx.commonsPages } });
  }
  if (url.includes('wikiart.org')) return J(fx.wikiart);
  if (url.includes('wikidata')) {
    const q = decodeURIComponent(url.split('query=')[1]); sparqlLog.push(q);
    sparqlActive++; sparqlMax = Math.max(sparqlMax, sparqlActive); await new Promise(r => setTimeout(r, 15)); sparqlActive--;
    return J(/COUNT\(/.test(q) ? { results: { bindings: [{ n: { value: '4200' } }] } } : { results: { bindings: fx.wdRows } });
  }
  throw new Error('URL no simulada: ' + url);
};

(async () => {
  // utilidades
  assert.strictEqual(C.cleanTitle('French: Rochers dans le bois Rocks in the Wood title QS:P1476,fr:"Rochers dans le bois " label QS:Lfr,"Rochers dans le bois " label QS:Len,"Rocks in the Wood" label QS:Lde,"Wald mit Felsblöcken"'), 'Rocks in the Wood');
  assert.strictEqual(C.cleanTitle('Rochers dans le bois title QS:P1476,fr:"Rochers dans le bois"'), 'Rochers dans le bois');
  assert.strictEqual(C.cleanTitle('German: Wald mit Felsblöcken'), 'Wald mit Felsblöcken');
  assert.strictEqual(C.cleanTitle('English: Rocks in the Wood French: Rochers dans le bois'), 'Rocks in the Wood');
  assert.strictEqual(C.cleanTitle('<b>La Gioconda</b>'), 'La Gioconda');
  assert.strictEqual(C.cleanDate('1840 date QS:P571,+1840-00-00T00:00:00Z/'), '1840');
  assert.strictEqual(C.cleanDate('c. 1503–1519'), 'c. 1503–1519'); assert.strictEqual(C.cleanDate(1880), 1880);
  const mkd = C.mk({ src: 't', id: 1, title: 'x', date: '1840 date QS:P571,+1840-00-00T00:00:00Z/', imgs: ['https://a/b.jpg'] }); assert.strictEqual(mkd.date, '1840'); assert.strictEqual(mkd.year, 1840);
  assert.strictEqual(C.cleanTitle('Water Lilies: Morning'), 'Water Lilies: Morning');
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
    if (s.id === 'm:si' || s.id === 'm:harvard') continue;
    const list = await s.fetch(plan, C.defaultFilters(), ctx);
    assert.ok(list.length >= 1, s.id + ' sin resultados');
    const w = list[0];
    assert.ok(w.uid && w.imgs.length && /^https:/.test(w.imgs[0]), s.id + ' img: ' + w.imgs[0]);
    assert.ok(w.title && w.museum, s.id + ' ficha');
    if (!s.museum.direct) continue;
    console.log(s.id.padEnd(9), '|', w.title.slice(0, 32).padEnd(32), '|', (w.artist || '-').padEnd(16), '|', w.year, '|', w.type, '|', w.imgs[0].slice(0, 70));
  }
  // derechos: sin anyRights solo dominio público, con anyRights entra todo
  const anyCtx = Object.assign({}, ctx, { anyRights: true });
  const pdOnly = await C.adapters.metFetch(plan, C.defaultFilters(), ctx);
  const allMet = await C.adapters.metFetch(plan, C.defaultFilters(), anyCtx);
  assert.ok(!pdOnly.some(w => w.title === 'Obra protegida'), 'Met: la protegida no debe entrar');
  const prot = allMet.find(w => w.title === 'Obra protegida'); assert.ok(prot && prot.pd === false && /derechos/.test(prot.license), 'Met: debe entrar con anyRights');
  // AIC: solo q + limit (con fields, page o POST la API no devuelve cabeceras CORS); lo protegido se filtra en el cliente
  aicBodies = []; const aicPD = await C.adapters.aicFetch(plan, C.defaultFilters(), ctx); const aicAll = await C.adapters.aicFetch(plan, C.defaultFilters(), anyCtx);
  assert.ok(aicBodies.length >= 1 && aicBodies.every(u => /\/artworks\/search\?/.test(u) && !/[?&](fields|page)=/.test(u) && /limit=100/.test(u)), 'AIC: solo consulta simple: ' + aicBodies[0]);
  assert.ok(aicPD.length >= 1 && aicAll.length >= aicPD.length, 'AIC devuelve obras');
  assert.ok(calls.filter(u => u.includes('metmuseum.org') && u.includes('/search')).every(u => u.includes('/v1.1/search') && /limit=/.test(u) && /offset=/.test(u)), 'Met: búsqueda v1.1 con límite y desplazamiento');
  const urlsBefore = calls.length;
  await C.adapters.cmaFetch(plan, C.defaultFilters(), ctx); await C.adapters.cmaFetch(plan, C.defaultFilters(), anyCtx);
  const cmaCalls = calls.slice(urlsBefore).filter(u => u.includes('clevelandart')); assert.ok(cmaCalls.some(u => u.includes('cc0=1')) && cmaCalls.some(u => !u.includes('cc0=1')), 'CMA: cc0');
  const m0 = calls.length; await C.adapters.smkFetch(plan, C.defaultFilters(), anyCtx); assert.ok(!decodeURIComponent(calls.slice(m0).join(' ')).includes('public_domain:true'), 'SMK: sin filtro');
  const m1 = calls.length; await C.adapters.europeanaFetch(plan, C.defaultFilters(), Object.assign({}, anyCtx, { keys: { europeana: 'k' } })); assert.ok(!calls.slice(m1).join(' ').includes('reusability'), 'Europeana: sin reusability');
  const mia = await C.adapters.miaFetch(plan, C.defaultFilters(), anyCtx); assert.ok(mia.some(w => w.pd === false), 'MIA: incluye obras con derechos');
  console.log('derechos | OK en Met, AIC, Cleveland, SMK, Europeana y MIA');

  // un Wikidata por museo
  const museumSrcs = C.SOURCE_LIST.filter(x => x.group === 'museum');
  assert.strictEqual(museumSrcs.length, C.MUSEUMS.length, 'una fuente por museo');
  assert.ok(C.MUSEUMS.every(m => !!C.SOURCE_DEFAULTS['m:' + m.id] === C.DEFAULT_MUSEUMS.includes(m.id)));
  const louvre = museumSrcs.find(x => x.id === 'm:louvre');
  const f1 = C.defaultFilters();
  sparqlLog.length = 0;
  let ws = await C.runSource(louvre, f1, anyCtx);
  const sel = sparqlLog.filter(q => !/COUNT\(/.test(q)).pop();
  assert.ok(/wd:Q19675/.test(sel) && /"Musée du Louvre"@fr/.test(sel), 'Louvre: código y nombre');
  assert.ok(/UNION/.test(sel) && /P6500/.test(sel), 'incluye imágenes de obras con derechos');
  assert.ok(!/wdt:P31 wd:/.test(sel) && /OPTIONAL \{ \?item wdt:P31 \?cls/.test(sel), 'sin restringir el tipo de obra');
  assert.ok(!/YEAR\(\?inc\) <= 1930/.test(sel), 'sin filtro de dominio público');
  const wsAll = ws; ws = ws.filter(w => w.src === 'wiki');
  assert.strictEqual(ws.length, 3, 'filas de Wikidata: se descartan tif y webm -> ' + ws.length);
  assert.ok(wsAll.some(w => w.src === 'commons') && wsAll.some(w => w.src === 'wikipedia'), 'el Louvre también trae Commons y Wikipedia');
  const gio = ws.find(w => w.title === 'La Gioconda'); assert.strictEqual(gio.type, 'painting'); assert.ok(gio.museum === 'Louvre (París)');
  assert.ok(gio.imgs[0].startsWith('https://commons.wikimedia.org/wiki/Special:FilePath/Mona%20Lisa.jpg?width='), gio.imgs[0]);
  assert.strictEqual(ws.find(w => w.title === 'Venus de Milo').type, 'sculpture');
  const ext = ws.find(w => w.title === 'Obra moderna'); assert.deepStrictEqual(ext.imgs, ['https://museo.example/img/obra.jpg']); assert.ok(/derechos/.test(ext.license));
  assert.ok(C.accept(ext, f1) && C.accept(gio, f1), 'accept: pasan con derechos');
  const f2 = C.defaultFilters(); f2.soloPD = true;
  assert.ok(!C.accept(ext, f2), 'solo PD descarta pd null');
  sparqlLog.length = 0; await C.runSource(louvre, f2, ctx);
  const sel2 = sparqlLog.filter(q => !/COUNT\(/.test(q)).pop();
  assert.ok(/YEAR\(\?inc\) <= 1930/.test(sel2) && !/P6500/.test(sel2), 'con solo PD vuelve el filtro');
  const f3 = C.defaultFilters(); f3.types = ['painting']; sparqlLog.length = 0; await C.runSource(louvre, f3, anyCtx);
  assert.ok(/wdt:P31 wd:Q3305213/.test(sparqlLog.filter(q => !/COUNT\(/.test(q)).pop()), 'con tipo elegido se restringe');
  const f4 = C.defaultFilters(); f4.styles = ['impressionism']; f4.eras = ['s19b']; sparqlLog.length = 0;
  await C.runSource(museumSrcs.find(x => x.id === 'm:orsay'), f4, anyCtx);
  const q4 = sparqlLog.filter(q => !/COUNT\(/.test(q)).pop(); assert.ok(/P135/.test(q4) && /YEAR\(\?inc\) >= 18[67]/.test(q4) && /wd:Q23402/.test(q4), 'estilo, época y museo juntos');
  const noQ = museumSrcs.find(x => x.id === 'm:orangerie'); sparqlLog.length = 0; await C.runSource(noQ, f1, anyCtx);
  assert.ok(/VALUES \?lbl/.test(sparqlLog.pop()) && !/VALUES \?coll/.test(sparqlLog[0] || ''), 'museo sin código: solo por nombre');
  sparqlMax = 0; await Promise.all(museumSrcs.slice(0, 8).map(x => C.runSource(x, f1, anyCtx)));
  assert.ok(sparqlMax <= 2, 'concurrencia SPARQL: ' + sparqlMax);
  console.log('museos   |', museumSrcs.length, 'fuentes, Louvre ->', ws.map(w => w.title).join(', '), '| máx. consultas simultáneas:', sparqlMax);


  // México, Bélgica y surrealismo
  const mx = C.museumIdsByTag('mx'), be = C.museumIdsByTag('be'), su = C.museumIdsByTag('surreal');
  assert.ok(mx.length >= 15 && mx.includes('m:munal') && mx.includes('m:soumaya') && mx.includes('m:kahlo'), 'México');
  assert.ok(be.length >= 25 && be.includes('m:magritte') && be.includes('m:groeninge') && be.includes('m:kmskb'), 'Bélgica');
  assert.ok(su.length >= 50 && ['m:moma', 'm:dalifigueres', 'm:peggy', 'm:magritte', 'm:menil', 'm:reinasofia'].every(id => su.includes(id)), 'surrealismo');
  [mx, be, su].forEach(l => l.forEach(id => assert.ok(C.SOURCE_LIST.some(x => x.id === id) && C.SOURCE_DEFAULTS[id], 'existe y está activo: ' + id)));
  const mg = C.SOURCE_LIST.find(x => x.id === 'm:magritte'); assert.ok(/Bélgica/.test(mg.place) && /surrealismo/.test(mg.tags) && /Bélgica/.test(mg.tags));
  sparqlLog.length = 0; await C.runSource(mg, C.defaultFilters(), anyCtx);
  assert.ok(/"Musée Magritte"@fr/.test(sparqlLog.filter(q => !/COUNT\(/.test(q)).pop()), 'Magritte: nombre en francés');
  // Un museo, varias fuentes
  const orsay = museumSrcs.find(x => x.id === 'm:orsay'); const rp = {}; commonsLog.length = 0;
  const fo = C.defaultFilters();
  const ow = await C.runSource(orsay, fo, Object.assign({}, anyCtx, { report: (n, c, e) => { rp[n] = e ? 'x' : c; } }));
  assert.deepStrictEqual(Object.keys(rp).sort(), ['Commons', 'Wikidata', 'Wikipedia'], 'Orsay: ' + JSON.stringify(rp));
  assert.ok(commonsLog.some(x => x.includes("Musée d'Orsay")), 'Commons busca por el nombre del museo');
  const wpw = ow.find(w => w.src === 'wikipedia'); assert.ok(wpw && wpw.title === 'Water Lilies (Monet)' && wpw.artist === 'Claude Monet' && wpw.year === 1906 && wpw.museum === 'Orsay', 'Wikipedia: ' + JSON.stringify(wpw));
  assert.ok(!ow.some(w => w.title === "Musée d'Orsay" || w.title === 'Un político' || w.title === 'Sin imagen'), 'Wikipedia descarta el museo, personas y artículos sin imagen');
  const met = museumSrcs.find(x => x.id === 'm:met'); const rpm = {};
  const mw = await C.runSource(met, fo, Object.assign({}, anyCtx, { report: (n, c) => { rpm[n] = c; } }));
  assert.ok(rpm.Directa >= 1 && mw.some(w => w.src === 'met') && mw.some(w => w.src === 'wiki'), 'Met: directa + Wikidata ' + JSON.stringify(rpm));
  // si falla la directa o no hay clave, el museo sigue con las demás fuentes
  const hv = museumSrcs.find(x => x.id === 'm:harvard'); const rph = {};
  const hw = await C.runSource(hv, fo, Object.assign({}, anyCtx, { keys: { harvard: '' }, report: (n, c, e) => { rph[n] = e ? 'x' : c; } }));
  assert.strictEqual(rph.Directa, 'x'); assert.ok(hw.length >= 1, 'Harvard sin clave sigue con Wikidata y Commons');
  // si todo falla, el error llega arriba
  const realFetch = globalThis.fetch; globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try { await C.runSource(museumSrcs.find(x => x.id === 'm:lyon'), C.defaultFilters(), anyCtx); assert.fail('debía fallar'); } catch (e) { assert.ok(e instanceof TypeError, 'error de red visible'); }
  globalThis.fetch = realFetch;
  // colecciones abiertas
  const op = museumSrcs.find(x => x.id === 'm:open'); const rpo = {}; const fsx = C.defaultFilters(); fsx.styles = ['surrealism'];
  await C.runSource(op, fsx, Object.assign({}, anyCtx, { keys: { europeana: 'k' }, report: (n, c, e) => { rpo[n] = e ? 'x' : c; } }));
  assert.deepStrictEqual(Object.keys(rpo).sort(), ['Commons', 'Commons destacadas', 'Europeana', 'Google Art Project', 'WikiArt', 'Wikidata'], JSON.stringify(rpo));
  // museos añadidos por nombre
  const rm = await C.resolveMuseum('Museo de Ejemplo'); assert.strictEqual(rm.ids[0], 'Q999'); assert.strictEqual(rm.id, 'cQ999');
  const cs = C.addMuseum(rm); assert.ok(C.SOURCE_LIST.includes(cs) && cs.id === 'm:cQ999'); assert.strictEqual(C.addMuseum(rm), cs, 'no se duplica');
  sparqlLog.length = 0; await C.runSource(cs, fo, anyCtx);
  assert.ok(/wd:Q999/.test(sparqlLog.filter(q => !/COUNT\(/.test(q)).pop()), 'museo añadido: se busca por su código');
  try { await C.resolveMuseum('zzz no existe'); assert.fail('debía fallar'); } catch (e) { assert.ok(/No encuentro/.test(e.message)); }
  console.log('museos   | varias fuentes por museo, añadir por nombre y errores: OK (' + C.SOURCE_LIST.length + ' museos)');
  // Surrealismo: Commons por categoría, con respaldo por texto
  const sur = C.STYLES.find(x => x.id === 'surrealism'); assert.strictEqual(sur.cat, 'Surrealist paintings'); assert.strictEqual(sur.wa, 'surrealism');
  const fs = C.defaultFilters(); fs.styles = ['surrealism'];
  commonsLog.length = 0;
  const cm = await C.adapters.commonsFetch(C.makePlan(fs), fs, anyCtx);
  assert.ok(commonsLog.some(x => x.includes('deepcategory:"Surrealist paintings"')), 'Commons: usa la categoría');
  assert.deepStrictEqual(cm.map(w => w.title), ['The Persistence of Memory', 'Golconda'], 'se descartan miniaturas y pdf');
  assert.strictEqual(cm[0].artist, 'Salvador Dalí'); assert.strictEqual(cm[0].year, 1931); assert.strictEqual(cm[0].pd, true); assert.strictEqual(cm[1].pd, false); assert.strictEqual(cm[1].year, 1953);
  assert.ok(cm.every(w => C.accept(w, fs)), 'accept deja pasar el Surrealismo');
  commonsEmpty = ['deepcategory:']; commonsLog.length = 0;
  const fs2 = C.defaultFilters(); fs2.styles = ['surrealism']; fs2.keywords = ['landscape'];
  const cm2 = await C.adapters.commonsFetch(C.makePlan(fs2), fs2, anyCtx); commonsEmpty = [];
  assert.ok(cm2.length === 2 && commonsLog.some(x => /^Surrealism \w+ landscape/.test(x)), 'Commons: sin categoría usa el texto');
  const wa = await C.adapters.wikiartFetch(C.makePlan(fs), fs, anyCtx);
  assert.ok(wa.length === 1 && wa[0].year === 1911 && wa[0].url === 'https://www.wikiart.org/en/marc-chagall/the-big-wheel' && wa[0].imgs[0].endsWith('.jpg'), 'WikiArt');
  const fa = C.defaultFilters(); fa.artists = ['Dalí']; const wda = await C.adapters.wikiartFetch(C.makePlan(fa), fa, anyCtx); assert.ok(Array.isArray(wda), 'WikiArt con artista usa la página del artista');
  const fk = C.defaultFilters(); fk.keywords = ['sea']; assert.deepStrictEqual(await C.adapters.wikiartFetch(C.makePlan(fk), fk, anyCtx), [], 'WikiArt no sirve para palabras clave');
  // Wikidata: el movimiento vale por la obra o por su autor, y las obras sin fecha entran
  sparqlLog.length = 0; await C.runSource(museumSrcs.find(x => x.id === 'm:orsay'), fs, anyCtx);
  const qs = sparqlLog.filter(q => !/COUNT\(/.test(q)).pop();
  assert.ok(/"Surrealism"@en/.test(qs) && /wdt:P135 \?mv\. \} UNION \{ \?item wdt:P170 \?cr0\. \?cr0 wdt:P135 \?mv/.test(qs), 'movimiento por obra o por autor');
  assert.ok(/FILTER\(!BOUND\(\?inc\) \|\|/.test(qs), 'con estilo, entran obras sin fecha');
  assert.ok(!/EntitySearch/.test(qs), 'sin búsqueda de artista en museos');
  // relajación progresiva: si nada responde con el rango del estilo, se prueba sin rango
  const seenPlans = [];
  const fake = { id: 'x', fetch: async p => { seenPlans.push(p); return p.range ? [] : [C.mk({ src: 'x', id: 1, title: 'Sí', imgs: ['https://a/b.jpg'] })]; } };
  const rr = await C.runSource(fake, fs, anyCtx);
  assert.strictEqual(rr.length, 1); assert.ok(seenPlans.length >= 2 && seenPlans[seenPlans.length - 1].range === null, 'relajó el rango');
  const fe = C.defaultFilters(); fe.styles = ['surrealism']; fe.eras = ['mod']; seenPlans.length = 0;
  assert.strictEqual((await C.runSource(fake, fe, anyCtx)).length, 0); assert.ok(seenPlans.every(p => p.range), 'con época elegida no se quita el rango');
  console.log('surrealismo | Commons', cm.length, '· WikiArt', wa.length, '· SPARQL con autor y sin fecha: OK');
  // runSource con relajación
  const r = await C.runSource(C.SOURCE_LIST.find(x => x.id === 'm:met'), C.defaultFilters(), ctx);
  assert.ok(r.length);
  // Smithsonian y Harvard: respuesta mínima
  fx.si = { response: { rowCount: 3, rows: [{ content: { descriptiveNonRepeating: { title: { content: 'Sunset' }, record_ID: 'saam_1', data_source: 'Smithsonian American Art Museum', record_link: 'https://x', online_media: { media: [{ type: 'Images', content: 'https://ids.si.edu/ids/deliveryService?id=SAAM-1', usage: { access: 'CC0' } }] } }, freetext: { name: [{ content: 'Church, Frederic Edwin' }], date: [{ content: '1860' }] } } }] } };
  fx.hv = { info: { totalrecords: 4 }, records: [{ id: 9, title: 'Study', people: [{ displayname: 'Winslow Homer' }], dated: '1880', datebegin: 1880, dateend: 1880, primaryimageurl: 'https://nrs.harvard.edu/urn-3:HUAM:1', classification: 'Paintings', url: 'https://harvardartmuseums.org/collections/object/9' }] };
  const prev = globalThis.fetch;
  globalThis.fetch = async (u, i) => { u = String(u); if (u.includes('api.si.edu')) return J(fx.si); if (u.includes('harvardartmuseums')) return J(fx.hv); return prev(u, i); };
  for (const id of ['si', 'harvard']) { const l = await C.adapters[id + 'Fetch'](plan, C.defaultFilters(), ctx); assert.ok(l.length === 1, id); console.log(id.padEnd(9), '|', l[0].title, '|', l[0].artist, '|', l[0].imgs[0]); }
  // clave ausente
  try { await C.adapters.harvardFetch(plan, {}, { keys: {} }); assert.fail('debía fallar'); } catch (e) { assert.ok(e.noKey); }
  console.log('Peticiones de ejemplo:'); [0, 1, 3].forEach(i => console.log(' ', calls[i].slice(0, 150)));
  { const prev = globalThis.fetch; const wdMock = (prev2) => async (u, i) => { u = String(u);
  const J = o => ({ ok: true, status: 200, json: async () => o });
  if (u.includes('wikiart.org/en/search/')) return J({ Paintings: [{ id: 'wa1', title: 'The Starry Night', artistName: 'Vincent van Gogh', year: '1888', image: 'https://uploads8.wikiart.org/images/vincent-van-gogh/the-starry-night-1888.jpg', paintingUrl: '/en/vincent-van-gogh/the-starry-night-1888' }, { id: 'wa2', title: 'Café Terrace', artistName: 'Vincent van Gogh', year: '1888', image: 'https://uploads8.wikiart.org/x.jpg', paintingUrl: '/x' }] });
  if (u.includes('wikidata.org/w/api.php') && /wbsearchentities/.test(u)) return J({ search: /language=es/.test(u) ? [{ id: 'Q45585', label: 'La noche estrellada', description: 'pintura de Vincent van Gogh' }, { id: 'Q1', label: 'Noche', description: 'escultura de alguien' }] : [] });
  if (u.includes('wikidata.org/w/api.php') && /props=claims/.test(u) && /Q45585/.test(u)) return J({ entities: { Q45585: { id: 'Q45585', labels: { es: { value: 'La noche estrellada' }, en: { value: 'The Starry Night' } }, descriptions: { es: { value: 'pintura de Vincent van Gogh' } }, claims: { P18: [{ mainsnak: { datavalue: { value: 'Van Gogh - Starry Night.jpg' } } }], P571: [{ mainsnak: { datavalue: { value: { time: '+1889-06-00T00:00:00Z' } } } }], P170: [{ mainsnak: { datavalue: { value: { id: 'Q5582' } } } }], P195: [{ mainsnak: { datavalue: { value: { id: 'Q188740' } } } }] } }, Q1: { id: 'Q1', labels: { es: { value: 'Noche' } }, descriptions: { es: { value: 'escultura de alguien' } }, claims: {} } } });
  if (u.includes('wikidata.org/w/api.php') && /props=labels/.test(u) && /Q5582/.test(u)) return J({ entities: { Q5582: { labels: { es: { value: 'Vincent van Gogh' } } }, Q188740: { labels: { es: { value: 'Museo de Arte Moderno de Nueva York' } } } } });
  return prev2(u, i); };
    globalThis.fetch = wdMock(prev);
    const r = await C.searchPaintings('la noche estrellada', {});
    assert.strictEqual(r.length, 1, 'una obra con imagen'); assert.strictEqual(r[0].title, 'La noche estrellada'); assert.strictEqual(r[0].artist, 'Vincent van Gogh'); assert.strictEqual(r[0].year, 1889); assert.strictEqual(r[0].museum, 'Museo de Arte Moderno de Nueva York');
    assert.ok(/^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/Van_Gogh_-_Starry_Night\.jpg\?width=2000/.test(r[0].imgs[0]), r[0].imgs[0]); assert.strictEqual(r[0].type, 'painting');
    assert.ok(calls.some(u => /metmuseum\.org.*title=true/.test(String(u))), 'la búsqueda por título también consulta al Met (por título)');
    assert.ok(calls.some(u => /data\.rijksmuseum\.nl\/search\/collection\?.*title=/.test(String(u))), 'y al Rijksmuseum');
    { const parts = []; await C.searchPaintings('la noche estrellada', {}, l => parts.push(l.length)); assert.ok(parts.length >= 2, 'los resultados llegan por partes: ' + parts); }
    { const rr = await C.searchPaintings('starry night', {}); assert.ok(rr.some(x => x.src === 'wikiart' && x.title === 'The Starry Night'), 'WikiArt aporta resultados: ' + rr.map(x => x.src + ':' + x.title)); assert.ok(!rr.some(x => x.title === 'Café Terrace'), 'solo los que coinciden con el título'); }
    await assert.rejects(() => C.searchPaintings('a', {}), /dos letras/);
    globalThis.fetch = prev; }
  { const prev = globalThis.fetch, urls = [], J = o => ({ ok: true, status: 200, json: async () => o });
    const answer = '{"title":"La noche estrellada","title_en":"The Starry Night","artist":"Vincent van Gogh","year":"1889","museum":"MoMA","confidence":0.97}';
    globalThis.fetch = async (u, i) => { u = String(u); urls.push([u, i]);
      if (u.includes('generativelanguage.googleapis.com')) { if (/gemini-3\.8-flash/.test(u)) return { ok: false, status: 404, json: async () => ({}) }; return J({ candidates: [{ content: { parts: [{ text: answer }] } }] }); }
      if (u.includes('api.anthropic.com')) return J({ content: [{ type: 'text', text: 'Aquí está: ```json\n' + answer + '\n```' }] });
      return prev(u, i); };
    let id = await C.identifyArtwork('QUJD', 'image/jpeg', { gemini: 'k1' });
    assert.strictEqual(id.title_en, 'The Starry Night'); assert.strictEqual(id.artist, 'Vincent van Gogh'); assert.strictEqual(id.confidence, 0.97);
    assert.ok(urls.some(x => /gemini-3\.6-flash/.test(x[0])), 'si un modelo ya no existe, prueba el siguiente'); assert.ok(/inline_data/.test(urls[urls.length - 1][1].body) && /QUJD/.test(urls[urls.length - 1][1].body), 'manda la imagen');
    id = await C.identifyArtwork('QUJD', 'image/jpeg', { anthropic: 'sk-ant-x' });
    assert.strictEqual(id.title, 'La noche estrellada'); { const c = urls[urls.length - 1][1]; assert.strictEqual(c.headers['x-api-key'], 'sk-ant-x'); assert.strictEqual(c.headers['anthropic-dangerous-direct-browser-access'], 'true'); assert.ok(/"type":"image"/.test(c.body)); }
    await assert.rejects(() => C.identifyArtwork('QUJD', 'image/jpeg', {}), e => e.noKey);
    globalThis.fetch = async (u) => u.includes('anthropic') ? J({ content: [{ type: 'text', text: '{"unknown":true}' }] }) : prev(u);
    assert.strictEqual(await C.identifyArtwork('QUJD', 'image/jpeg', { anthropic: 'k' }), null, 'obra no reconocida');
    globalThis.fetch = prev; }
  { const sin = C.SOURCE_LIST.filter(s => s.museum && !s.museum.open && !s.museum.custom && !C.museumCountry(s.museum)).map(s => s.id); assert.deepStrictEqual(sin, [], 'todo museo debe tener país (así tiene su colección «Museos de …»): ' + sin);
    assert.ok(C.countryCollections().some(c => c.es === 'Museos de España' && c.ids.length >= 10), 'Museos de España'); assert.strictEqual(C.countryCollectionName('Reino Unido'), 'Museos del Reino Unido'); }
  console.log('TODO OK');
})().catch(e => { console.error('FALLO', e); process.exit(1); });
