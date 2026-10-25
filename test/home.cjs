// Pantalla de inicio del móvil (Escaneo de obra, Galería de arte, Colecciones) y escáner tipo cámara:
// zoom, círculo para escanear, cuadrados para buscar por nombre y por foto, resultados en una hoja.
const assert = require('assert');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const J = o => ({ ok: true, status: 200, json: async () => o });
const load = url => {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url });
  const w = dom.window; w.__ART_TUNING = { sparqlPause: 5 };
  w.fetch = async () => { throw new TypeError('Failed to fetch'); };
  w.Image = function () { const o = { set src(v) { this._s = v; setTimeout(() => { o.naturalWidth = 1600; o.naturalHeight = 1000; o.onload && o.onload(); }, 5); }, get src() { return this._s; } }; return o; };
  w.AbortController = AbortController;
  w.HTMLMediaElement.prototype.play = async () => {}; w.HTMLMediaElement.prototype.pause = () => {};
  w.eval(Array.from(html.matchAll(/<script>\n([\s\S]*?)<\/script>/g), m => m[1]).join('\n'));
  return w;
};
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  { // TV (pantalla grande): sin pantalla de inicio
    const w = load('https://example.test/'); await wait(50);
    assert.ok(w.document.getElementById('home').hidden && !w.ArtApp.HOME, 'en la TV no hay pantalla de inicio');
    assert.ok(w.document.getElementById('homeBtn').hidden, 'ni botón «Inicio» en el menú');
  }
  { // mando: tampoco
    const w = load('https://example.test/?c=abcdefgh'); await wait(50);
    assert.ok(w.document.getElementById('home').hidden, 'en el mando no hay pantalla de inicio');
    // en el mando, la obra encontrada también tiene sus botones; las favoritas se guardan y viajan a la TV
    const A = w.ArtApp, d = w.document; w.navigator.mediaDevices = undefined;
    A.openScanner(); await wait(20);
    A.S.tres = [{ uid: 'wd:Q1', src: 'wd', title: 'Obra', artist: 'Pintor', imgs: ['https://img.test/a.jpg'], thumb: 'https://img.test/t.jpg', url: 'https://www.wikidata.org/wiki/Q1' }];
    A.onAct('title-show', '0'); await wait(30);
    assert.ok(!d.getElementById('scanFound').hidden, 'mando: se abre la obra encontrada');
    d.getElementById('foundFav').click();
    assert.ok(JSON.parse(w.localStorage.getItem('galeria-arte-v1:favs')).some(x => x.uid === 'wd:Q1'), 'mando: favorita guardada');
    d.getElementById('foundViewed').click();
    assert.ok(JSON.parse(w.localStorage.getItem('galeria-arte-v1:vistas')).some(x => x.uid === 'wd:Q1'), 'mando: vista guardada');
    A.closeScanner(); assert.ok(d.getElementById('scanFound').hidden, 'al cerrar la cámara se cierra la obra');
  }
  const w = load('https://example.test/?home=1'), d = w.document, A = w.ArtApp, S = A.S;
  await wait(50);
  const home = d.getElementById('home'), sc = d.getElementById('scanner'), sheet = d.getElementById('scanSheet');
  assert.ok(!home.hidden, 'el móvil arranca en la pantalla de inicio');
  assert.deepStrictEqual(Array.from(home.querySelectorAll('.hcard b')).map(b => b.textContent), ['Escaneo de obra', 'Galería de arte', 'Colecciones', 'Conectar a la TV']);
  // Galería de arte: se ve la galería; «Inicio» del menú vuelve
  home.querySelector('[data-act=home-gallery]').click();
  assert.ok(home.hidden && !S.menu, 'Galería de arte abre la galería');
  A.openMenu(); assert.ok(!d.getElementById('homeBtn').hidden, 'en el menú hay botón «Inicio»');
  d.getElementById('homeBtn').click(); await wait(20);
  assert.ok(!home.hidden && !S.menu, '«Inicio» vuelve a la pantalla de inicio');
  // Colecciones: círculos (Favoritas, Pinturas vistas) y cuadrícula masonry que se alarga al bajar
  const colls = d.getElementById('colls'), grid = d.getElementById('collGrid');
  const mkw = (i, extra) => Object.assign({ uid: 'wiki:' + i, src: 'wiki', title: 'Obra ' + i, artist: 'Pintor ' + i, imgs: ['https://img.test/' + i + '.jpg'], thumb: 'https://img.test/t' + i + '.jpg' }, extra);
  S.favs = Array.from({ length: 70 }, (_, i) => mkw(i, { w: 1000, h: 500 + i * 10 }));
  A.present(Object.assign(mkw('v1'), { url: 'https://img.test/v1.jpg', url_page: 'https://page.test/v1' }));
  A.present(Object.assign(mkw('v2'), { url: 'https://img.test/v2.jpg' }));
  assert.strictEqual(S.viewed.length, 0, 'ver una obra no la apunta sola: solo las que marca el usuario');
  const seenBtn = d.getElementById('seenBtn');
  assert.strictEqual(seenBtn.textContent, 'Marcar como vista', 'en el menú, botón para marcarla');
  A.onAct('seen'); assert.strictEqual(seenBtn.textContent, 'Quitar de vistas');
  A.present(Object.assign(mkw('v1'), { url: 'https://img.test/v1.jpg' })); assert.strictEqual(seenBtn.textContent, 'Marcar como vista');
  A.onAct('seen'); A.onAct('seen'); A.onAct('seen'); // marcar, quitar y volver a marcar
  assert.deepStrictEqual(Array.from(S.viewed, x => x.uid), ['wiki:v1', 'wiki:v2'], 'pinturas vistas: la última primero y sin repetir');
  Object.defineProperty(w, 'innerWidth', { value: 390, configurable: true });
  assert.strictEqual(JSON.parse(w.localStorage.getItem('galeria-arte-v1:vistas')).length, 2, 'las vistas se guardan en el dispositivo');
  A.render('presets'); A.render('opts');
  assert.ok(Array.from(d.querySelectorAll('#c-presets option')).some(o => o.textContent === 'Mis pinturas vistas (2)'), 'colección rápida «Mis pinturas vistas»');
  const vchip = d.querySelector('#c-opts [data-id=viewed]');
  assert.ok(vchip && vchip.textContent === 'Solo mis pinturas vistas (2)', 'opción «Solo mis pinturas vistas»');
  A.onAct('opt', 'favs'); A.onAct('opt', 'viewed');
  assert.ok(S.f.onlyViewed && !S.f.onlyFavs, 'solo favoritas o solo vistas, no las dos');
  A.onAct('opt', 'viewed'); assert.ok(!S.f.onlyViewed);
  home.querySelector('[data-act=home-collections]').click();
  assert.ok(home.hidden && !colls.hidden && !S.menu, 'Colecciones abre su pantalla ' + [home.hidden, colls.hidden, S.menu]);
  const rings = () => Array.from(colls.querySelectorAll('.cring'));
  assert.deepStrictEqual(rings().map(b => b.querySelector('b').textContent), ['Favoritas', 'Pinturas vistas'], 'círculos arriba');
  assert.strictEqual(rings()[0].getAttribute('aria-pressed'), 'true', 'Favoritas elegida al empezar');
  assert.strictEqual(rings()[0].querySelector('img').getAttribute('src'), 'https://img.test/t0.jpg', 'el círculo lleva la última obra');
  assert.strictEqual(grid.children.length, 2, 'dos columnas en el móvil');
  const tiles = () => grid.querySelectorAll('.ctile');
  assert.ok(tiles().length >= 30, 'primera página de obras: ' + tiles().length);
  const hs = Array.from(grid.children).map(c => c.children.length); assert.ok(Math.abs(hs[0] - hs[1]) <= 3, 'las columnas quedan parejas: ' + hs);
  for (let i = 0; i < 5; i++) colls.dispatchEvent(new w.Event('scroll'));
  assert.strictEqual(tiles().length, 70, 'al bajar salen todas');
  rings()[1].click();
  assert.strictEqual(rings()[1].getAttribute('aria-pressed'), 'true');
  const srcs = () => Array.from(tiles()).map(t => t.querySelector('img').getAttribute('src'));
  assert.deepStrictEqual(srcs().sort(), ['https://img.test/tv1.jpg', 'https://img.test/tv2.jpg'], 'pinturas vistas en la cuadrícula');
  const order = srcs(), pick = /v2/.test(order[0]) ? 0 : 1;
  tiles()[pick].click(); await wait(60);
  assert.ok(colls.hidden && home.hidden && S.current.uid === 'wiki:v2', 'tocar una obra la muestra en la galería');
  w.history.back(); await wait(60);
  assert.ok(!colls.hidden, 'Atrás vuelve a Colecciones');
  assert.deepStrictEqual(srcs(), order, 'al volver de una obra sigue el mismo orden');
  { // al abrir, orden aleatorio
    const seen = new Set();
    for (let i = 0; i < 8; i++) { A.onAct('coll', 'favs'); seen.add(srcs().slice(0, 30).join()); }
    assert.ok(seen.size > 1, 'cada vez que se abre cambia el orden');
    A.onAct('coll', 'viewed');
  }
  colls.querySelector('[data-act=colls-back]').click(); await wait(60);
  assert.ok(colls.hidden && !home.hidden, 'la flecha vuelve al inicio');
  S.favs = []; home.querySelector('[data-act=home-collections]').click(); rings()[0].click();
  assert.ok(!d.getElementById('collEmpty').hidden && /favoritas/i.test(d.getElementById('collEmpty').textContent), 'colección vacía: dice cómo llenarla');
  // desde la galería (dos pasos), «Inicio» vuelve al inicio sin pasar por Colecciones
  tiles().length; A.onAct('coll', 'viewed'); grid.querySelector('.ctile').click(); await wait(60);
  A.openMenu(); A.onAct('home'); await wait(80);
  assert.ok(!home.hidden && colls.hidden && !S.menu, '«Inicio» desde una obra de Colecciones vuelve al inicio');
  // Escaneo de obra
  let stopped = 0, zoomed = null;
  const track = { stop: () => { stopped++; }, getCapabilities: () => ({}), getSettings: () => ({}) };
  Object.defineProperty(w.navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [track], getVideoTracks: () => [track] }) }, configurable: true });
  home.querySelector('[data-act=home-scan]').click(); await wait(20);
  assert.ok(!sc.hidden, 'Escaneo de obra abre la cámara');
  const bar = Array.from(sc.querySelectorAll('.sbar > button')).map(b => b.dataset.act);
  assert.deepStrictEqual(bar, ['scan-name', 'scan-now', 'scan-photo'], 'nombre a la izquierda, escanear en el centro, foto a la derecha');
  // zoom digital (la cámara no tiene zoom propio)
  const zb = () => Array.from(sc.querySelectorAll('#scanZoom button'));
  assert.deepStrictEqual(zb().map(b => b.dataset.id), ['1', '2', '3'], 'botones de zoom');
  A.onAct('scan-zoom', '2'); assert.strictEqual(d.getElementById('scanVideo').style.transform, 'scale(2)', 'zoom 2×');
  A.setZoom(9); assert.strictEqual(d.getElementById('scanVideo').style.transform, 'scale(4)', 'el zoom tiene tope');
  A.setZoom(1.5); assert.ok(/1,5×/.test(sc.querySelector('#scanZoom [aria-pressed=true]').textContent), 'muestra el zoom real: ' + sc.querySelector('#scanZoom').textContent);
  A.setZoom(1); assert.strictEqual(d.getElementById('scanVideo').style.transform, '');
  // sin clave, el círculo pide la clave en la propia hoja (sin cerrar la cámara)
  sc.querySelector('[data-act=scan-now]').click();
  assert.ok(!sheet.hidden && !d.getElementById('scanKeys').hidden && /clave/i.test(d.getElementById('scanMsg').textContent), 'pide la clave');
  d.getElementById('idk-gemini-s').value = 'k1'; d.getElementById('idk-gemini-s').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.strictEqual(JSON.parse(w.localStorage.getItem('galeria-arte-v1:idkeys')).gemini, 'k1', 'la clave se guarda');
  assert.strictEqual(d.getElementById('idk-gemini').value, 'k1', 'y también aparece en el menú');
  sheet.querySelector('[data-act=sheet-close]').click(); assert.ok(sheet.hidden && !sc.hidden, 'cerrar la hoja vuelve a la cámara');
  // buscar por nombre
  w.fetch = async u => { u = String(u);
    if (/wbsearchentities/.test(u)) return J({ search: /language=es/.test(u) ? [{ id: 'Q45585', label: 'La noche estrellada', description: 'pintura de Vincent van Gogh' }] : [] });
    if (/props=claims/.test(u)) return J({ entities: { Q45585: { id: 'Q45585', labels: { es: { value: 'La noche estrellada' } }, descriptions: { es: { value: 'pintura de Vincent van Gogh' } }, claims: { P18: [{ mainsnak: { datavalue: { value: 'Starry.jpg' } } }] } } } });
    throw new TypeError('Failed to fetch'); };
  sc.querySelector('[data-act=scan-name]').click();
  assert.ok(!sheet.hidden && !d.getElementById('scanNameRow').hidden, 'Nombre abre el buscador');
  d.getElementById('scanTitleIn').value = 'noche estrellada';
  d.getElementById('scanTitleIn').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(300);
  assert.strictEqual(d.querySelectorAll('#scanRes .tres').length, 1, 'resultado en la hoja: ' + d.getElementById('scanMsg').textContent);
  // buscar por foto: abre la galería del móvil (sin forzar la cámara)
  let clicked; const inp = d.getElementById('photoIn'); inp.click = () => { clicked = inp.getAttribute('capture'); };
  sc.querySelector('[data-act=scan-photo]').click(); assert.strictEqual(clicked, null, 'Foto elige una imagen guardada');
  // foto reconocida: va directa a la obra (artículo de la Wikipedia en inglés → Wikidata), aunque la búsqueda por título no dé nada
  w.fetch = async u => { u = String(u);
    if (/generativelanguage/.test(u)) return J({ candidates: [{ content: { parts: [{ text: '{"title":"El jardín de las delicias","title_en":"The Garden of Earthly Delights","artist":"El Bosco","year":"1500","museum":"Museo del Prado","wikipedia_en":"The Garden of Earthly Delights","wikidata":"Q99999","confidence":0.9}' }] } }] });
    if (/en\.wikipedia\.org\/w\/api\.php.*titles=The%20Garden/.test(u)) return J({ query: { pages: [{ pageid: 1, title: 'The Garden of Earthly Delights', pageprops: { wikibase_item: 'Q321303' }, original: { source: 'https://upload.wikimedia.org/x/Garden.jpg' } }] } });
    if (/wbgetentities/.test(u) && /props=claims/.test(u)) return J({ entities: {
      Q321303: { id: 'Q321303', labels: { es: { value: 'El jardín de las delicias' } }, descriptions: { es: { value: 'tríptico de El Bosco' } }, claims: { P18: [{ mainsnak: { datavalue: { value: 'Garden.jpg' } } }], P170: [{ mainsnak: { datavalue: { value: { id: 'Q130531' } } } }] } },
      Q99999: { id: 'Q99999', labels: { es: { value: 'Un puente cualquiera' } }, descriptions: { es: { value: 'pintura de Fulano' } }, claims: { P18: [{ mainsnak: { datavalue: { value: 'Puente.jpg' } } }], P170: [{ mainsnak: { datavalue: { value: { id: 'Q1' } } } }] } } } });
    if (/wbgetentities/.test(u)) return J({ entities: { Q130531: { labels: { es: { value: 'El Bosco' } } }, Q1: { labels: { es: { value: 'Fulano' } } } } });
    throw new TypeError('Failed to fetch'); };
  Object.defineProperty(inp, 'files', { value: [new w.File([new Uint8Array([255, 216, 255, 224])], 'f.jpg', { type: 'image/jpeg' })], configurable: true });
  inp.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(800);
  const titles = Array.from(d.querySelectorAll('#scanRes .tres b')).map(b => b.textContent);
  assert.deepStrictEqual(titles, ['El jardín de las delicias'], 'la obra reconocida, y no la del número inventado: ' + titles + ' · ' + d.getElementById('scanMsg').textContent);
  assert.ok(/^Es «El jardín de las delicias», El Bosco/.test(d.getElementById('scanMsg').textContent), d.getElementById('scanMsg').textContent);
  A.onAct('sheet-close');
  // obra sin artículo propio (un dibujo de Van Gogh): se busca entre las obras del artista; el cuadro de otro con el mismo título no sale
  w.fetch = async u => { u = String(u);
    if (/generativelanguage/.test(u)) return J({ candidates: [{ content: { parts: [{ text: '{"title":"Molinos de viento en los alrededores de Dordrecht","title_en":"Windmills near Dordrecht","artist":"Vincent van Gogh","year":"1881","wikipedia_en":"","wikidata":""}' }] } }] });
    if (/wbsearchentities/.test(u) && /search=Vincent/.test(u)) return J({ search: [{ id: 'Q5582', label: 'Vincent van Gogh', description: 'Dutch painter (1853–1890)' }] });
    if (/query\.wikidata\.org/.test(u)) { const dq = decodeURIComponent(u); if (!/wd:Q5582/.test(dq)) throw new Error('consulta sin el artista: ' + dq); if (/REGEX/.test(dq) && !/w\[i[^\]]*\]\[n/.test(dq)) throw new Error('el título va sin acentos de por medio: ' + dq); return J({ results: { bindings: [{ w: { value: 'http://www.wikidata.org/entity/Q777' }, l: { value: 'Windmills near Dordrecht', 'xml:lang': 'en' } }, { w: { value: 'http://www.wikidata.org/entity/Q778' }, l: { value: 'Windmill on Montmartre' } }] } }); }
    if (/wbsearchentities/.test(u)) return J({ search: [{ id: 'Q500', label: 'Windmills near Dordrecht', description: 'painting by Karl Daubigny' }] });
    if (/wbgetentities/.test(u) && /props=claims/.test(u)) return J({ entities: {
      Q777: { id: 'Q777', labels: { en: { value: 'Windmills near Dordrecht' } }, descriptions: { en: { value: 'drawing by Vincent van Gogh' } }, claims: { P18: [{ mainsnak: { datavalue: { value: 'VG.jpg' } } }], P170: [{ mainsnak: { datavalue: { value: { id: 'Q5582' } } } }] } },
      Q500: { id: 'Q500', labels: { en: { value: 'Windmills near Dordrecht' } }, descriptions: { en: { value: 'painting by Karl Daubigny' } }, claims: { P18: [{ mainsnak: { datavalue: { value: 'KD.jpg' } } }], P170: [{ mainsnak: { datavalue: { value: { id: 'Q501' } } } }] } } } });
    if (/wbgetentities/.test(u)) return J({ entities: { Q5582: { labels: { en: { value: 'Vincent van Gogh' } } }, Q501: { labels: { en: { value: 'Karl Daubigny' } } } } });
    throw new TypeError('Failed to fetch'); };
  inp.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(800);
  const vg = Array.from(d.querySelectorAll('#scanRes .tres span')).map(b => b.textContent);
  assert.deepStrictEqual(vg.map(x => x.split(' · ')[0]).length, 1, 'solo la de Van Gogh: ' + vg + ' · ' + d.getElementById('scanMsg').textContent);
  assert.ok(/Windmills near Dordrecht/.test(vg[0]) && /Vincent van Gogh/.test(vg[0]), vg[0]);
  A.onAct('sheet-close');
  // obra reconocida con el artista en español («el Viejo») y sin ficha directa: las fuentes lo escriben en inglés y aun así sale
  // (antes se descartaba todo y no salía ninguna opción)
  let wikiartQ = [];
  w.fetch = async u => { u = String(u);
    if (/generativelanguage/.test(u)) return J({ candidates: [{ content: { parts: [{ text: '{"title":"Cazadores en la nieve","title_en":"Hunters in the Snow","artist":"Pieter Bruegel el Viejo","year":"1565","wikipedia_en":"","wikidata":""}' }] } }] });
    if (/wikiart/.test(u)) { wikiartQ.push(decodeURIComponent(u)); return J(/Hunters/.test(decodeURIComponent(u)) ? [{ id: 'h1', title: 'The Hunters in the Snow (Winter)', artistName: 'Pieter Bruegel the Elder', image: 'https://uploads.wikiart.org/h.jpg', year: '1565' }, { id: 'h2', title: 'Hunters in the Snow', artistName: 'Pieter de Hooch', image: 'https://uploads.wikiart.org/k.jpg' }] : []); }
    throw new TypeError('Failed to fetch'); };
  inp.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(900);
  const bh = Array.from(d.querySelectorAll("#scanRes .tres span")).map(b => b.textContent);
  assert.strictEqual(bh.length, 1, 'sale la de Bruegel: ' + bh + ' · ' + d.getElementById('scanMsg').textContent + ' · ' + wikiartQ);
  assert.ok(/Hunters in the Snow/.test(bh[0]) && /Bruegel the Elder/.test(bh[0]), bh[0]);
  assert.ok(/Toca una/.test(d.getElementById('scanMsg').textContent), d.getElementById('scanMsg').textContent);
  d.querySelector('#scanRes .tres').click(); await wait(80);
  assert.ok(!d.getElementById('scanFound').hidden && /Hunters/.test(d.getElementById('foundT').textContent), 'y se abre la obra con sus botones');
  d.querySelector('#scanFound [data-act=found-close]').click(); await wait(80);
  A.onAct('sheet-close');
  // muchas obras con el mismo título («El Salvador»): primero las del artista reconocido (Luis de Morales), aunque en Wikidata se llame
  // «Salvator Mundi» y con acentos; las de El Greco y otros con ese título no salen
  let sq = [];
  w.fetch = async u => { u = String(u); const du = decodeURIComponent(u);
    if (/generativelanguage/.test(u)) return J({ candidates: [{ content: { parts: [{ text: '{"title":"El Salvador","title_en":"The Saviour","artist":"Luis de Morales","year":"c. 1560-1570"}' }] } }] });
    if (/wikiart/.test(u)) return J(/Saviour/.test(du) ? [{ id: 's1', title: 'The Saviour', artistName: 'El Greco', image: 'https://uploads.wikiart.org/g.jpg', year: '1594' }, { id: 's2', title: 'The Saviour', artistName: 'Hans Sebald Beham', image: 'https://uploads.wikiart.org/b.jpg' }] : []);
    if (/wbsearchentities/.test(u) && /search=Luis/.test(u)) return J({ search: [{ id: 'Q734211', label: 'Luis de Morales', description: 'pintor español' }] });
    if (/query\.wikidata\.org/.test(u)) { sq.push(du); if (!/wd:Q734211/.test(du)) throw new TypeError('x');
      return J({ results: { bindings: /REGEX/.test(du) ? [{ w: { value: 'http://www.wikidata.org/entity/Q901' }, l: { value: 'Salvator Mundi' } }] : [{ w: { value: 'http://www.wikidata.org/entity/Q901' } }, { w: { value: 'http://www.wikidata.org/entity/Q902' } }] } }); }
    if (/wbgetentities/.test(u) && /props=claims/.test(u)) return J({ entities: {
      Q901: { id: 'Q901', labels: { es: { value: 'Salvator Mundi' } }, descriptions: { es: { value: 'pintura de Luis de Morales' } }, claims: { P18: [{ mainsnak: { datavalue: { value: 'Morales_Salvator.jpg' } } }], P170: [{ mainsnak: { datavalue: { value: { id: 'Q734211' } } } }] } },
      Q902: { id: 'Q902', labels: { es: { value: 'La Virgen del Pajarito' } }, descriptions: { es: { value: 'pintura de Luis de Morales' } }, claims: { P18: [{ mainsnak: { datavalue: { value: 'Morales_Virgen.jpg' } } }], P170: [{ mainsnak: { datavalue: { value: { id: 'Q734211' } } } }] } } } });
    if (/wbgetentities/.test(u)) return J({ entities: { Q734211: { labels: { es: { value: 'Luis de Morales' } } } } });
    throw new TypeError('Failed to fetch'); };
  inp.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(900);
  const ms = Array.from(d.querySelectorAll('#scanRes .tres span')).map(b => b.textContent);
  assert.ok(/Salvator Mundi/.test(ms[0]) && /Luis de Morales/.test(ms[0]), 'primero la del artista: ' + ms + ' · ' + d.getElementById('scanMsg').textContent + ' · ' + sq);
  assert.ok(!ms.some(x => /El Greco|Beham/.test(x)), 'sin las de otros artistas con el mismo título: ' + ms);
  assert.ok(/Otras obras de Luis de Morales/.test(d.getElementById('scanRes').textContent) && ms.some(x => /Pajarito/.test(x)), 'y debajo otras obras suyas');
  assert.ok(sq.some(q => /s\[a[^\]]*\]lv\[a/.test(q) && /s\[a[^\]]*\]v\[i/.test(q)), 'busca el título sin acentos y con sinónimos: ' + sq);
  d.querySelectorAll('#scanRes .tres')[1].click(); await wait(80);
  assert.ok(/Pajarito/.test(d.getElementById('foundT').textContent), 'cada rótulo deja bien el número de cada obra');
  d.querySelector('#scanFound [data-act=found-close]').click(); await wait(80);
  A.onAct('sheet-close');
  // reconocida pero sin nada con imagen: un botón la busca por su nombre (ya escrito en «Buscar por nombre»)
  w.fetch = async u => { u = String(u);
    if (/generativelanguage/.test(u)) return J({ candidates: [{ content: { parts: [{ text: '{"title":"Obra perdida","title_en":"Lost work","artist":"Nadie Conocido"}' }] } }] });
    throw new TypeError('Failed to fetch'); };
  inp.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(600);
  const retry = d.querySelector('#scanRes [data-act=title-retry]');
  assert.ok(retry && /Obra perdida/.test(retry.textContent), 'botón para buscarla por su nombre: ' + d.getElementById('scanRes').innerHTML);
  retry.click(); await wait(50);
  assert.ok(!d.getElementById('scanNameRow').hidden && d.getElementById('scanTitleIn').value === 'Obra perdida', 'abre la búsqueda por nombre con el título escrito');
  await wait(300); A.onAct('sheet-close');
  sc.querySelector('[data-act=scan-name]').click(); d.getElementById('scanTitleIn').value = 'noche estrellada';
  w.fetch = async u => { u = String(u);
    if (/wbsearchentities/.test(u)) return J({ search: /language=es/.test(u) ? [{ id: 'Q45585', label: 'La noche estrellada', description: 'pintura de Vincent van Gogh' }] : [] });
    if (/props=claims/.test(u)) return J({ entities: { Q45585: { id: 'Q45585', labels: { es: { value: 'La noche estrellada' } }, descriptions: { es: { value: 'pintura de Vincent van Gogh' } }, claims: { P18: [{ mainsnak: { datavalue: { value: 'Starry.jpg' } } }] } } } });
    throw new TypeError('Failed to fetch'); };
  A.onAct('scan-name-go'); await wait(300);
  // elegir el resultado: se abre la obra con tres botones redondos (favorita, vista, ver en galería), sin cerrar la cámara
  const found = d.getElementById('scanFound'), fav = d.getElementById('foundFav'), seen = d.getElementById('foundViewed');
  d.querySelector('#scanRes .tres').click(); await wait(100);
  assert.ok(!found.hidden && !sc.hidden && stopped === 0, 'se abre la obra encontrada');
  assert.strictEqual(d.getElementById('foundT').textContent, 'La noche estrellada');
  assert.strictEqual(found.querySelectorAll('.fbar .fbtn').length, 3, 'tres botones');
  assert.ok(/^https:/.test(d.getElementById('foundImg').src), 'con su imagen');
  const nf = S.favs.length, nv = S.viewed.length;
  assert.strictEqual(fav.getAttribute('aria-pressed'), 'false');
  fav.click(); assert.strictEqual(S.favs.length, nf + 1, 'la estrella la guarda en favoritas');
  assert.strictEqual(S.favs[0].title, 'La noche estrellada'); assert.ok(/^https:/.test(S.favs[0].imgs[0]) && !/wikidata\.org\/wiki/.test(S.favs[0].imgs[0]), 'con la imagen, no la ficha: ' + S.favs[0].imgs[0]);
  assert.strictEqual(fav.getAttribute('aria-pressed'), 'true', 'y queda marcada');
  assert.ok(JSON.parse(w.localStorage.getItem('galeria-arte-v1:favs')).some(x => x.title === 'La noche estrellada'), 'guardada en el dispositivo');
  seen.click(); assert.strictEqual(S.viewed.length, nv + 1, 'el ojo la añade a pinturas vistas'); assert.strictEqual(S.viewed[0].title, 'La noche estrellada');
  assert.strictEqual(seen.getAttribute('aria-pressed'), 'true');
  assert.ok(JSON.parse(w.localStorage.getItem('galeria-arte-v1:vistas')).some(x => x.title === 'La noche estrellada'), 'vista guardada en el dispositivo');
  seen.click(); assert.strictEqual(S.viewed.length, nv, 'otra vez el ojo la quita'); assert.strictEqual(seen.getAttribute('aria-pressed'), 'false');
  fav.click(); assert.strictEqual(S.favs.length, nf, 'otra vez la estrella la quita'); fav.click();
  // Atrás vuelve a los resultados
  found.querySelector('[data-act=found-close]').click(); await wait(100);
  assert.ok(found.hidden && !sheet.hidden && !sc.hidden, 'Atrás vuelve a los resultados');
  d.querySelector('#scanRes .tres').click(); await wait(50);
  assert.strictEqual(fav.getAttribute('aria-pressed'), 'true', 'la estrella recuerda que ya es favorita');
  // ver en galería: se cierra la cámara y se ve la obra en la galería
  found.querySelector('[data-act=found-gallery]').click(); await wait(300);
  assert.ok(found.hidden, 'se cierra la obra encontrada');
  assert.ok(sc.hidden && stopped === 1, 'la cámara se apaga'); assert.ok(home.hidden, 'se sale del inicio');
  assert.strictEqual(S.current.title, 'La noche estrellada', 'se ve la obra elegida');
  // Escape en la cámara: primero cierra la hoja, luego la cámara
  A.showHome(); home.querySelector('[data-act=home-scan]').click(); await wait(20);
  sc.querySelector('[data-act=scan-name]').click();
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.ok(sheet.hidden && !sc.hidden, 'Escape cierra la hoja');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.ok(sc.hidden && stopped === 2, 'y luego la cámara');
  assert.ok(!home.hidden, 'y se vuelve al inicio');
  { // Conectar a la TV: sin código, se pide; con código, directo al mando
    const w2 = load('https://example.test/?home=1'), d2 = w2.document; await wait(50);
    assert.ok(/desde el móvil/.test(d2.getElementById('homeTvSub').textContent));
    d2.querySelector('[data-act=home-tv]').click(); assert.ok(!d2.getElementById('homeTv').hidden, 'sin código, pide el código');
    d2.getElementById('homeTvCode').value = 'xx'; d2.querySelector('[data-act=home-tv-go]').click();
    assert.ok(/no es válido/.test(d2.getElementById('homeTvMsg').textContent), 'código no válido');
    w2.localStorage.setItem('galeria-arte-v1:tvcode', JSON.stringify('abcdefghjkmn'));
    w2.ArtApp.showHome(); assert.ok(/abcd-efgh-jkmn/.test(d2.getElementById('homeTvSub').textContent), 'la tarjeta dice el código guardado');
  }
  { // abrir el mando guarda el código de la TV para la próxima vez
    const w3 = load('https://example.test/?c=abcdefghjkmn'); await wait(50);
    assert.strictEqual(JSON.parse(w3.localStorage.getItem('galeria-arte-v1:tvcode')), 'abcdefghjkmn');
  }
  console.log('INICIO OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
