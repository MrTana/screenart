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
  assert.deepStrictEqual(Array.from(home.querySelectorAll('.hcard b')).map(b => b.textContent), ['Escaneo de obra', 'Galería de arte', 'Colecciones']);
  // Galería de arte: se ve la galería; «Inicio» del menú vuelve
  home.querySelector('[data-act=home-gallery]').click();
  assert.ok(home.hidden && !S.menu, 'Galería de arte abre la galería');
  A.openMenu(); assert.ok(!d.getElementById('homeBtn').hidden, 'en el menú hay botón «Inicio»');
  d.getElementById('homeBtn').click(); await wait(20);
  assert.ok(!home.hidden && !S.menu, '«Inicio» vuelve a la pantalla de inicio');
  // Colecciones: abre el menú (de momento, en «Colección rápida»)
  home.querySelector('[data-act=home-collections]').click();
  assert.ok(home.hidden && S.menu, 'Colecciones abre el menú'); A.onAct('home'); await wait(20);
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
  console.log('INICIO OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
