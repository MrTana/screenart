// Mando desde el móvil: dos páginas (TV y móvil) hablan por un broker MQTT simulado (y, como reserva, ntfy).
const assert = require('assert');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const scripts = Array.from(html.matchAll(/<script>\n([\s\S]*?)<\/script>/g), m => m[1]).join('\n');
const J = o => ({ ok: true, status: 200, json: async () => o });
const subs = {}; let posts = 0;
// Broker MQTT simulado: entiende CONNECT, SUBSCRIBE, PUBLISH y PINGREQ y reparte entre todas las páginas.
const mq = {};
const enc = t => Array.from(Buffer.from(t, 'utf8'));
const lenB = n => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); o.push(n > 0 ? d | 128 : d); } while (n > 0); return o; };
function FakeWS(url) {
  const ws = this; ws.url = url; ws.subs = []; ws.readyState = 0;
  ws.send = data => {
    const a = Array.from(new Uint8Array(data)); const type = a[0] >> 4; let i = 1, mul = 1, len = 0, b;
    do { b = a[i++]; len += (b & 127) * mul; mul *= 128; } while (b & 128);
    const body = a.slice(i, i + len), reply = bytes => setTimeout(() => ws.onmessage && ws.onmessage({ data: new Uint8Array(bytes).buffer }), 1);
    if (type === 1) reply([0x20, 2, 0, 0]);
    else if (type === 8) { const tl = body[2] * 256 + body[3]; ws.subs.push(Buffer.from(body.slice(4, 4 + tl)).toString()); (mq[url] = mq[url] || []).push(ws); reply([0x90, 3, body[0], body[1], 0]); }
    else if (type === 3) {
      const tl = body[0] * 256 + body[1], topic = Buffer.from(body.slice(2, 2 + tl)).toString(), payload = body.slice(2 + tl);
      if (/emqx/.test(url)) { posts++; assert.ok(payload.every(c => c < 128), 'carga ASCII'); }
      (mq[url] || []).filter(w => w.subs.includes(topic)).forEach(w => { const inner = [0, topic.length].concat(enc(topic), payload); setTimeout(() => w.onmessage && w.onmessage({ data: new Uint8Array([0x30].concat(lenB(inner.length), inner)).buffer }), 2); });
    }
  };
  ws.close = () => {};
  setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); }, 2);
}
function DeadWS() { const ws = this; ws.close = () => {}; setTimeout(() => { ws.onerror && ws.onerror(); }, 2); }
const queue = {};
function make(url, opt) {
  opt = opt || {};
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url });
  const w = dom.window; w.__ART_TUNING = { sparqlPause: 5 };
  w.fetch = async (u, init) => {
    u = String(u);
    const m = /^https:\/\/ntfy\.sh\/([\w-]+)$/.exec(u);
    if (m && init && init.method === 'POST') {
      (queue[m[1]] = queue[m[1]] || []).push({ id: 'n' + Math.random(), event: 'message', message: init.body });
      posts++; assert.ok(init.body.length < 3100 && !/[^\x00-\x7f]/.test(init.body), 'mensaje ASCII y pequeño');
      (subs[m[1]] || []).forEach(es => setTimeout(() => es.onmessage && es.onmessage({ data: JSON.stringify({ event: 'message', message: init.body }) }), 3));
      return { ok: true, status: 200 };
    }
    const pm = /^https:\/\/ntfy\.sh\/([\w-]+)\/json\?poll=1/.exec(u);
    if (pm) { const q = (queue[pm[1]] || []).splice(0); return { ok: true, status: 200, text: async () => q.map(x => JSON.stringify(x)).join('\n') }; }
    if (u.includes('metmuseum') && u.includes('/search')) return J({ total: 3, objectIDs: [1, 2, 3] });
    if (u.includes('metmuseum') && u.includes('/objects/')) { const id = +u.split('/').pop(); return J({ objectID: id, isPublicDomain: true, primaryImage: 'https://img/met' + id + '.jpg', primaryImageSmall: 'https://img/s' + id + '.jpg', title: 'Obra á' + id, artistDisplayName: 'Artista ñ', objectDate: '1880', objectBeginDate: 1880, objectEndDate: 1880, department: 'Paintings', classification: 'Paintings', objectName: 'Painting', objectURL: 'https://met/' + id, medium: 'oil', creditLine: 'x', tags: [] }); }
    throw new TypeError('Failed to fetch');
  };
  w.WebSocket = opt.noMQTT ? DeadWS : FakeWS;
  if (opt.noSSE) w.EventSource = function () { /* nunca abre: simula un navegador de TV que corta SSE */ }; else w.EventSource = function (u) { const t = String(u).replace(/^https:\/\/ntfy\.sh\//, '').replace(/\/sse$/, ''); (subs[t] = subs[t] || []).push(this); setTimeout(() => this.onopen && this.onopen(), 2); };
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
  assert.ok(!tv.document.getElementById('pair').hidden, 'el QR sigue hasta que el móvil manda una orden');
  assert.ok(posts <= 3, 'hello y estado caben en pocos mensajes: ' + posts);
  assert.ok(/Relé 3 de 3 brokers/.test(tv.document.getElementById('pairSt').textContent), 'la TV muestra el estado del relé: ' + tv.document.getElementById('pairSt').textContent);
  assert.strictEqual(ph.localStorage.length, 1, 'el móvil solo guarda el código (no pisa filtros)');

  // órdenes
  const h0 = tvA.S.hist.length;
  ph.ArtApp.onAct('next'); await wait(400);
  assert.ok(tvA.S.hist.length > h0 || tvA.S.hi < tvA.S.hist.length, 'siguiente llega a la TV');
  assert.ok(tvA.S.shown > shownTv, 'la TV cambió de obra: ' + tvA.S.shown);
  assert.ok(tv.document.getElementById('pair').hidden, 'la TV oculta el QR al emparejar');
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
  ph.ArtApp.onAct('ex', 'portraits');
  const e0 = tvA.S.epoch;
  await wait(1700);
  assert.deepStrictEqual(Array.from(tvA.S.f.styles), ['impressionism'], 'filtro de estilo aplicado en la TV');
  assert.strictEqual(tvA.S.st.interval, 60, 'intervalo aplicado en la TV');
  assert.deepStrictEqual(Array.from(tvA.S.f.exclude), ['portraits'], '«No quiero ver» llega a la TV');
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
  assert.ok(/Código: [a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/.test(d.getElementById('pairCode').textContent), 'la TV muestra el código en texto');
  // el móvil en modo normal conecta a la TV con el código
  const ph2 = make('https://example.test/');
  await wait(300);
  assert.strictEqual(ph2.ArtApp.parseCode('ABCD-efgh jkmn'), 'abcdefghjkmn');
  assert.strictEqual(ph2.ArtApp.parseCode('https://x.test/?c=abcdefghjkmn'), 'abcdefghjkmn');
  assert.strictEqual(ph2.ArtApp.parseCode('abc'), '');
  ph2.ArtApp.onAct('tv-connect'); assert.ok(!ph2.document.getElementById('tvRow').hidden, 'aparece el campo del código');
  ph2.ArtApp.onAct('tv-go'); assert.ok(/no es válido/.test(ph2.document.getElementById('tvMsg').textContent), 'rechaza un código vacío');
  // móvil que reaparece tras actualizar: la TV conserva todos los museos
  assert.ok(Object.keys(tvA.S.f.sources).length > 100, 'la TV conserva la lista completa de museos');
  // sin brokers MQTT y sin SSE (TV y móvil): reserva ntfy por sondeo
  const tv2 = make('https://example.test/?tv=1', { noSSE: true, noMQTT: true });
  await wait(2200);
  const code2 = tv2.document.getElementById('pairUrl').textContent.split('=')[1];
  const ph3 = make('https://example.test/?c=' + code2, { noMQTT: true });
  for (let i = 0; i < 160 && !/Conectado/.test(ph3.document.getElementById('rcstat').textContent); i++) await wait(250);
  assert.ok(/Conectado/.test(ph3.document.getElementById('rcstat').textContent), 'conecta por sondeo: ' + ph3.document.getElementById('rcstat').textContent);
  // en el móvil nada cierra el menú
  ph.ArtApp.closeMenu(); assert.ok(!p.getElementById('drawer').hidden, 'el menú del móvil no se cierra');
  console.log('mando OK · mensajes:', posts);
  process.exit(0);
})().catch(e => { console.error('FALLO mando:', e); process.exit(1); });
