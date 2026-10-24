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
  A.present(Object.assign(mkw('v1'), { url: 'https://img.test/v1.jpg' }));
  assert.deepStrictEqual(Array.from(S.viewed, x => x.uid), ['wiki:v1', 'wiki:v2'], 'pinturas vistas: la última primero y sin repetir');
  Object.defineProperty(w, 'innerWidth', { value: 390, configurable: true });
  await wait(1700); assert.strictEqual(JSON.parse(w.localStorage.getItem('galeria-arte-v1:viewed')).length, 2, 'las vistas se guardan en el dispositivo');
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
    if (/query\.wikidata\.org/.test(u)) { assert.ok(/wd:Q5582/.test(decodeURIComponent(u)) && /windmill/.test(decodeURIComponent(u)), 'consulta por artista: ' + decodeURIComponent(u)); return J({ results: { bindings: [{ w: { value: 'http://www.wikidata.org/entity/Q777' }, l: { value: 'Windmills near Dordrecht', 'xml:lang': 'en' } }, { w: { value: 'http://www.wikidata.org/entity/Q778' }, l: { value: 'Windmill on Montmartre' } }] } }); }
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
  sc.querySelector('[data-act=scan-name]').click(); d.getElementById('scanTitleIn').value = 'noche estrellada';
  w.fetch = async u => { u = String(u);
    if (/wbsearchentities/.test(u)) return J({ search: /language=es/.test(u) ? [{ id: 'Q45585', label: 'La noche estrellada', description: 'pintura de Vincent van Gogh' }] : [] });
    if (/props=claims/.test(u)) return J({ entities: { Q45585: { id: 'Q45585', labels: { es: { value: 'La noche estrellada' } }, descriptions: { es: { value: 'pintura de Vincent van Gogh' } }, claims: { P18: [{ mainsnak: { datavalue: { value: 'Starry.jpg' } } }] } } } });
    throw new TypeError('Failed to fetch'); };
  A.onAct('scan-name-go'); await wait(300);
  // elegir el resultado: se cierra la cámara y se ve la obra en la galería
  d.querySelector('#scanRes .tres').click(); await wait(100);
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
