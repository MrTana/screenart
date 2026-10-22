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
  if (opt.ls) Object.keys(opt.ls).forEach(k => w.localStorage.setItem('galeria-arte-v1:' + k, JSON.stringify(opt.ls[k])));
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
  assert.ok(/Reanudar/.test(p.getElementById('playBtn').textContent), 'el móvil refleja la pausa: ' + p.getElementById('playBtn').textContent);
  ph.ArtApp.onAct('play'); await wait(300); assert.strictEqual(tvA.S.paused, false);
  ph.ArtApp.onAct('fav'); await wait(300);
  assert.strictEqual(tvA.S.favs.length, 1, 'favorita en la TV');
  assert.ok(/Quitar/.test(p.getElementById('favBtn').textContent), 'el móvil refleja la favorita');
  { // buscar por título en el móvil → la TV muestra la obra
    ph.ArtApp.S.tres = [{ uid: 'wiki:Q45585', src: 'wiki', museum: 'MoMA', title: 'La noche estrellada', artist: 'Vincent van Gogh', year: 1889, date: '1889', imgs: ['https://example.org/s.jpg'], thumb: 'https://example.org/t.jpg', url: 'https://www.wikidata.org/wiki/Q45585' }];
    ph.ArtApp.onAct('title-show', '0'); await wait(600);
    assert.strictEqual(tvA.S.current.title, 'La noche estrellada', 'la TV muestra la obra buscada desde el móvil'); assert.strictEqual(tvA.S.current.museum, 'MoMA'); }
  { // la favorita de la TV crea su colección por estilo también en el mando
    tvA.S.favs = []; Object.assign(tvA.S.current, { artist: 'Salvador Dalí', year: 1931 });
    ph.ArtApp.onAct('fav'); await wait(600);
    const opts = Array.from(p.querySelectorAll('#c-presets option')).map(o => o.textContent);
    assert.ok(opts.includes('Surrealismo'), 'el mando muestra «Surrealismo» por las favoritas de la TV: ' + opts.join(' | ')); }

  { // el menú del mando pinta el estado de cada museo como la TV
    await wait(1500);
    const ids = Object.keys(tvA.S.status); assert.ok(ids.length >= 1, 'la TV tiene estados de museos');
    const ps = ph.ArtApp.S.status; assert.ok(Object.keys(ps).length >= 1, 'el mando recibe los estados de museos: ' + JSON.stringify(ps));
    const id = Object.keys(ps)[0]; assert.strictEqual(ps[id].state, tvA.S.status[id].state, 'mismo estado en mando y TV (' + id + ')');
    assert.ok(p.querySelector('#c-msrcs .dot.ok, #c-msrcs .dot.empty, #c-msrcs .dot.loading, #c-msrcs .dot.error'), 'el mando muestra los puntos de color');
    const rk = r => !r.getAttribute('aria-pressed') || r.getAttribute('aria-pressed') === 'false' ? 2 : (c => /ok/.test(c) ? 0 : /error|nokey/.test(c) ? 3 : 1)(r.querySelector('.dot').className);
    ph.ArtApp.S.order = null; ph.ArtApp.renderAll(); const rr = Array.from(p.querySelectorAll('#c-msrcs .src')).map(rk); assert.ok(rr.every((x, i) => !i || rr[i - 1] <= x), 'el mando ordena los museos por color'); }
  { const g = p.getElementById('idk-gemini'); g.value = 'AIza-prueba'; g.dispatchEvent(new ph.Event('change', { bubbles: true })); assert.ok(/AIza-prueba/.test(ph.localStorage.getItem('galeria-arte-v1:idkeys') || ''), 'el mando guarda su clave de reconocimiento de fotos'); }

  // filtros desde el móvil
  p.querySelector('#c-styles [data-id=impressionism]').click();
  ph.ArtApp.onAct('interval', '60');
  ph.ArtApp.onAct('ex', 'portraits');
  ph.ArtApp.onAct('skin', 'm3e-dark');
  const e0 = tvA.S.epoch;
  await wait(1700);
  assert.deepStrictEqual(Array.from(tvA.S.f.styles), ['impressionism'], 'filtro de estilo aplicado en la TV');
  assert.strictEqual(tvA.S.st.interval, 60, 'intervalo aplicado en la TV');
  assert.deepStrictEqual(Array.from(tvA.S.f.exclude), ['portraits'], '«No quiero ver» llega a la TV');
  assert.strictEqual(tvA.S.st.skin, 'm3e-dark', 'el skin elegido en el mando llega a la TV');
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
  { // favoritas y claves de la versión móvil llegan a la TV y al mando; las de la TV llegan al móvil
    const mkFav = (n, t) => ({ uid: 'mv:' + n, src: 'mv', museum: 'Museo ' + n, title: t, artist: 'Pintor ' + n, date: '1900', year: 1900, imgs: ['https://example.org/f' + n + '.jpg'], thumb: 'https://example.org/t' + n + '.jpg', url: 'https://example.org/p' + n, type: 'painting', pd: true, license: 'PD' });
    const tvFavs0 = tvA.S.favs.map(f => f.uid);
    const ph4 = make('https://example.test/?c=' + code, { ls: { favs: [mkFav(1, 'Del móvil uno'), mkFav(2, 'Del móvil dos')], keys: { europeana: 'api2demo', si: 'DEMO_KEY', harvard: 'HARV-123' } } });
    await wait(4000);
    const tu = tvA.S.favs.map(f => f.uid);
    assert.ok(tu.includes('mv:1') && tu.includes('mv:2'), 'las favoritas del móvil llegan a la TV: ' + tu.join());
    assert.strictEqual(tvA.S.keys.harvard, 'HARV-123', 'la clave de Harvard del móvil llega a la TV');
    assert.strictEqual(ph4.document.getElementById('k-harvard').value, 'HARV-123', 'el mando muestra la clave guardada en el móvil');
    const pu = ph4.ArtApp.S.favs.map(f => f.uid); tvFavs0.forEach(u => assert.ok(pu.includes(u), 'la favorita de la TV llega al móvil: ' + u + ' en ' + pu.join()));
    assert.ok(ph4.localStorage.getItem('galeria-arte-v1:favs').includes('mv:1') && ph4.localStorage.getItem('galeria-arte-v1:favs').length > 100, 'el móvil las guarda');
    assert.ok(/Solo mis favoritas \(\d+\)/.test(ph4.document.getElementById('c-opts').textContent) && ph4.ArtApp.S.favs.length >= 3, 'el mando cuenta las favoritas');
    // alta en la TV (desde otro mando) → llega al móvil sin reconectar
    const cur = tvA.S.current.uid, hadCur = tvA.S.favs.some(f => f.uid === cur);
    ph.ArtApp.onAct('fav'); await wait(1500);
    assert.strictEqual(ph4.ArtApp.S.favs.some(f => f.uid === cur), !hadCur, 'el cambio de favorita en la TV llega a los móviles');
  }
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
