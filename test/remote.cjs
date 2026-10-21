// Mando desde el móvil: dos páginas (TV y móvil) hablan por un relé simulado de ntfy.
const assert = require('assert');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const scripts = Array.from(html.matchAll(/<script>\n([\s\S]*?)<\/script>/g), m => m[1]).join('\n');
const J = o => ({ ok: true, status: 200, json: async () => o });
const subs = {}; let posts = 0;
function make(url) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url });
  const w = dom.window; w.__ART_TUNING = { sparqlPause: 5 };
  w.fetch = async (u, init) => {
    u = String(u);
    const m = /^https:\/\/ntfy\.sh\/([\w-]+)$/.exec(u);
    if (m && init && init.method === 'POST') {
      posts++; assert.ok(init.body.length < 3100 && !/[^\x00-\x7f]/.test(init.body), 'mensaje ASCII y pequeño');
      (subs[m[1]] || []).forEach(es => setTimeout(() => es.onmessage && es.onmessage({ data: JSON.stringify({ event: 'message', message: init.body }) }), 3));
      return { ok: true, status: 200 };
    }
    if (u.includes('metmuseum') && u.includes('/search')) return J({ total: 3, objectIDs: [1, 2, 3] });
    if (u.includes('metmuseum') && u.includes('/objects/')) { const id = +u.split('/').pop(); return J({ objectID: id, isPublicDomain: true, primaryImage: 'https://img/met' + id + '.jpg', primaryImageSmall: 'https://img/s' + id + '.jpg', title: 'Obra á' + id, artistDisplayName: 'Artista ñ', objectDate: '1880', objectBeginDate: 1880, objectEndDate: 1880, department: 'Paintings', classification: 'Paintings', objectName: 'Painting', objectURL: 'https://met/' + id, medium: 'oil', creditLine: 'x', tags: [] }); }
    throw new TypeError('Failed to fetch');
  };
  w.EventSource = function (u) { const t = String(u).replace(/^https:\/\/ntfy\.sh\//, '').replace(/\/sse$/, ''); (subs[t] = subs[t] || []).push(this); setTimeout(() => this.onopen && this.onopen(), 2); };
  w.Image = function () { const o = { set src(v) { this._s = v; setTimeout(() => { o.naturalWidth = 1600; o.naturalHeight = 1000; o.onload && o.onload(); }, 5); }, get src() { return this._s; } }; return o; };
  w.AbortController = AbortController;
  w.eval(scripts);
  return w;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const tv = make('https://example.test/');
  await wait(2300);
  const d = tv.document;
  assert.ok(!d.getElementById('pair').hidden, 'la TV muestra el código QR sin tocar nada');
  assert.ok(d.querySelector('#pairQR svg'), 'hay un QR dibujado');
  const link = d.getElementById('pairUrl').textContent; assert.ok(/^example\.test\/\?c=[a-z0-9]{12}$/.test(link), 'enlace: ' + link);
  fs.writeFileSync(process.env.QR_SVG || '/tmp/qr-test.svg', d.getElementById('pairQR').innerHTML);
  const code = link.split('=')[1];
  const tvA = tv.ArtApp, shownTv = tvA.S.shown; assert.ok(shownTv >= 1, 'la TV ya muestra obras');

  const ph = make('https://example.test/?c=' + code);
  await wait(300);
  const p = ph.document;
  assert.ok(p.body.classList.contains('rc'), 'modo mando');
  assert.ok(!p.getElementById('drawer').hidden, 'menú siempre abierto en el móvil');
  assert.strictEqual(ph.ArtApp.S.shown, 0, 'el móvil no carga obras');
  assert.ok(/Conectado/.test(p.getElementById('rcstat').textContent), 'conectado: ' + p.getElementById('rcstat').textContent);
  assert.ok(p.getElementById('rcT').textContent.includes('Obra'), 'el móvil ve la obra actual');
  assert.ok(tv.document.getElementById('pair').hidden, 'la TV oculta el QR al emparejar');
  assert.strictEqual(ph.localStorage.length, 1, 'el móvil solo guarda el código (no pisa filtros)');

  // órdenes
  const h0 = tvA.S.hist.length;
  ph.ArtApp.onAct('next'); await wait(400);
  assert.ok(tvA.S.hist.length > h0 || tvA.S.hi < tvA.S.hist.length, 'siguiente llega a la TV');
  assert.ok(tvA.S.shown > shownTv, 'la TV cambió de obra: ' + tvA.S.shown);
  ph.ArtApp.onAct('play'); await wait(300);
  assert.strictEqual(tvA.S.paused, true, 'pausa llega a la TV');
  assert.ok(/Reanudar/.test(p.getElementById('playBtn').textContent), 'el móvil refleja la pausa');
  ph.ArtApp.onAct('play'); await wait(300); assert.strictEqual(tvA.S.paused, false);
  ph.ArtApp.onAct('fav'); await wait(300);
  assert.strictEqual(tvA.S.favs.length, 1, 'favorita en la TV');
  assert.ok(/Quitar/.test(p.getElementById('favBtn').textContent), 'el móvil refleja la favorita');

  // filtros desde el móvil
  p.querySelector('#c-styles [data-id=impressionism]').click();
  ph.ArtApp.onAct('interval', '60');
  const e0 = tvA.S.epoch;
  await wait(1700);
  assert.deepStrictEqual(Array.from(tvA.S.f.styles), ['impressionism'], 'filtro de estilo aplicado en la TV');
  assert.strictEqual(tvA.S.st.interval, 60, 'intervalo aplicado en la TV');
  assert.ok(tvA.S.epoch > e0, 'la TV relanzó la búsqueda');
  // clave de API desde el móvil
  const ke = p.getElementById('k-europeana'); ke.value = 'clave-prueba-é'; ke.dispatchEvent(new ph.Event('change'));
  await wait(1700);
  assert.strictEqual(tvA.S.keys.europeana, 'clave-prueba-é', 'la clave llega a la TV');
  // «Probar fuentes» se ejecuta en la TV y el informe vuelve al móvil
  Object.keys(tvA.S.f.sources).forEach(k => { tvA.S.f.sources[k] = k === 'm:met'; });
  ph.ArtApp.onAct('diag');
  assert.ok(!p.getElementById('diag').hidden, 'el móvil abre el informe');
  assert.ok(tv.document.getElementById('diag').hidden, 'la TV no se tapa con el informe');
  for (let i = 0; i < 40 && !/Filtros:/.test(p.getElementById('diagOut').textContent); i++) await wait(250);
  assert.ok(/Filtros:/.test(p.getElementById('diagOut').textContent) && /Metropolitan|Met/.test(p.getElementById('diagOut').textContent), 'informe de la TV en el móvil: ' + p.getElementById('diagOut').textContent.slice(0, 120));
  assert.ok(p.querySelector('.foot [data-act=reset]') && !p.getElementById('drawer').querySelector('[data-acc=claves]').hidden, 'el móvil conserva restablecer y claves');
  // nombres con tildes viajan bien
  assert.ok(posts > 4, 'mensajes enviados: ' + posts);

  assert.ok(!p.getElementById('rcfoot').hidden && /Buscar actualización/.test(p.getElementById('rcfoot').textContent), 'botón de actualización al final del mando');
  assert.ok(/Versión de la TV/.test(p.getElementById('rcver').textContent), 'versiones visibles');
  // en el móvil nada cierra el menú
  ph.ArtApp.closeMenu(); assert.ok(!p.getElementById('drawer').hidden, 'el menú del móvil no se cierra');
  console.log('mando OK · mensajes:', posts);
  process.exit(0);
})().catch(e => { console.error('FALLO mando:', e); process.exit(1); });
