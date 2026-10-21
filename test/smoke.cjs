const assert = require('assert');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const J = o => ({ ok: true, status: 200, json: async () => o });
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.test/' });
const w = dom.window; w.__ART_TUNING = { sparqlPause: 5 };
const errors = [];
w.addEventListener('error', e => errors.push(e.message));
// Mocks: fetch y Image
w.fetch = async (url, init) => {
  url = String(url);
  if (url.includes('metmuseum') && url.includes('/search')) return J({ total: 3, objectIDs: [1, 2, 3] });
  if (url.includes('metmuseum') && url.includes('/objects/')) { const id = +url.split('/').pop(); return J({ objectID: id, isPublicDomain: true, primaryImage: 'https://img/met' + id + '.jpg', primaryImageSmall: 'https://img/met' + id + 's.jpg', title: 'Obra ' + id, artistDisplayName: 'Claude Monet', objectDate: '1880', objectBeginDate: 1880, objectEndDate: 1880, classification: 'Paintings', objectURL: 'https://m/' + id }); }
  if (url.includes('www.wikidata.org/w/api.php')) return J({ search: [{ id: 'Q4242', label: 'Museo de Prueba', description: 'museo de arte' }] });
  throw new TypeError('Failed to fetch');
};
w.Image = function () { const o = { set src(v) { this._s = v; setTimeout(() => { o.naturalWidth = 1600; o.naturalHeight = 1000; o.onload && o.onload(); }, 5); }, get src() { return this._s; } }; return o; };
w.AbortController = AbortController;
w.eval(fs.readFileSync(__dirname + '/../src/core.js', 'utf8').replace(/^[\s\S]*$/, m => m)); // sanity: core evaluates alone
w.eval(Array.from(html.matchAll(/<script>\n([\s\S]*?)<\/script>/g), m => m[1]).join('\n'));
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await wait(600);
  const A = w.ArtApp, S = A.S;
  console.log('mostradas:', S.shown, '| pool:', S.pool.length, '| cargador oculto:', w.document.getElementById('loader').hidden);
  console.log('ficha:', w.document.querySelector('#caption .t').textContent, '|', w.document.querySelector('#caption .m').textContent);
  console.log('estado fuentes:', JSON.stringify(Object.fromEntries(Object.entries(S.status).map(([k, v]) => [k, v.state]))));
  { const k = S.st.interval; const t = (sec) => { S.st.interval = sec; return A.captionMs(); };
    assert.deepStrictEqual([t(10), t(30), t(900), t(1800), t(3600)], [2500, 7500, 225000, 300000, 300000], 'la ficha dura el 25 % (máx. 5 min)'); S.st.interval = k; }
  assert.strictEqual(w.document.querySelector('#caption .s'), null, 'la ficha solo lleva título, autor y año');
  A.openMenu();
  const d = w.document; function d0(){return d;}
  console.log('filas de museos:', d0().querySelectorAll('#c-msrcs .src').length, '| activas:', d0().querySelectorAll('#c-msrcs .src[aria-pressed=true]').length);
  console.log('menu abierto:', !d.getElementById('drawer').hidden, '| chips estilos:', d.querySelectorAll('#c-styles .chip').length, '| filas:', d.querySelectorAll('#c-msrcs .src').length, '| sección antigua:', !!d.getElementById('c-srcs'));
  // clic en estilo Impresionismo y en una fuente
  d.querySelector('#c-styles [data-id=impressionism]').click();
  const pick = name => { const sel = d.getElementById('c-presets'); const o = Array.from(sel.options).find(x => x.textContent === name); sel.value = o.value; sel.dispatchEvent(new w.Event('change')); return !!o; };
  pick('Maestros holandeses');
  console.log('filtros tras preset:', JSON.stringify({ styles: S.f.styles, types: S.f.types }));
  d.querySelector('#c-artist-sug [data-act=add-sug]').click();
  console.log('artistas:', JSON.stringify(S.f.artists), '| chips artista:', d.querySelectorAll('#c-artists .chip').length);
  const ag = d.getElementById('c-artgroup'); assert.ok(ag.options.length >= 12, 'grupos de artistas');
  ag.value = 'surrealism'; ag.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.ok(/Remedios Varo/.test(d.getElementById('c-artist-sug').textContent), 'el grupo Surrealismo muestra a Remedios Varo');
  console.log('grupos de artistas:', ag.options.length, '| presets:', d.querySelectorAll('#c-presets option').length);
  d.getElementById('kwIn').value = 'caballos'; d.querySelector('[data-act=add-kw]').click();
  console.log('temas:', JSON.stringify(S.f.keywords));
  // selectores y secciones plegables
  const sel = (id, v) => { const el = d.getElementById(id); el.value = v; el.dispatchEvent(new w.Event('change')); };
  sel('c-interval', '60'); sel('c-mode', 'fill'); sel('c-orient', 'landscape'); sel('c-caption', 'always');
  console.log('selectores ->', S.st.interval, S.st.mode, S.f.orientation, S.st.caption);
  if (S.st.interval !== 60 || S.st.mode !== 'fill' || S.f.orientation !== 'landscape' || S.st.caption !== 'always') { console.error('FALLO selectores'); process.exit(1); }
  sel('c-orient', 'any'); sel('c-caption', 'auto');
  const open = () => Array.from(d.querySelectorAll('section.acc.open')).map(x => x.dataset.acc);
  console.log('secciones abiertas al inicio:', open().length);
  d.querySelector('[data-id=estilo]').click(); d.querySelector('[data-id=epoca]').click();
  console.log('abierta:', open().join(','), '| resumen estilo:', d.querySelector('[data-sum=estilo]').textContent, '| museos:', d.querySelector('[data-sum=museos]').textContent);
  if (open().join() !== 'epoca' || open().length !== 1) { console.error('FALLO acordeón'); process.exit(1); }
  d.querySelector('[data-id=epoca]').click(); if (open().length) { console.error('FALLO cerrar'); process.exit(1); }
  A.onAct('interval', '10'); A.onAct('mode', 'frame'); A.onAct('opt', 'kb'); A.onAct('fav', '');
  console.log('modo:', d.getElementById('stage').className, '| favoritas:', S.favs.length);
  const on = () => Object.keys(S.f.sources).filter(k => k.startsWith('m:') && S.f.sources[k]).length;
  d.querySelector('#c-msrcs [data-id="m:louvre"]').click(); console.log('Louvre desmarcado:', !S.f.sources['m:louvre'], '| museos activos:', on());
  d.querySelector('[data-act=mus-none]').click(); console.log('ninguno:', on());
  d.querySelector('[data-act=mus-all]').click(); console.log('todos:', on());
  const flt = d.getElementById('museumFilter'); flt.value = 'París'; flt.dispatchEvent(new w.Event('input'));
  console.log('filtro París ->', d.querySelectorAll('#c-msrcs .src').length, 'filas');
  d.querySelector('[data-act=mus-none]').click(); console.log('quitar los de la lista ->', on(), 'museos activos');
  flt.value = ''; flt.dispatchEvent(new w.Event('input'));
  d.getElementById('museumIn').value = 'Museo de Prueba'; d.querySelector('[data-act=add-museum]').click(); await wait(300);
  console.log('museo añadido:', d.getElementById('museumMsg').textContent, '| guardado:', S.custom.length, '| activo:', !!S.f.sources['m:cQ4242'], '| en lista:', /Museo de Prueba/.test(d.getElementById('c-msrcs').textContent));
  for (const [name, n] of [['Museos de México', 18], ['Museos de Bélgica', 28], ['Surrealismo en museos', 64]]) {
    pick(name);
    const act = Object.keys(S.f.sources).filter(k => S.f.sources[k]).length;
    console.log('preset', name, '->', act, 'museos activos', name.startsWith('Surr') ? '| estilo: ' + S.f.styles : '');
    if (act !== n) { console.error('FALLO preset', name, act, 'esperaba', n); process.exit(1); }
  }
  pick('Museos de París');
  console.log('preset Museos de París -> fuentes activas:', Object.keys(S.f.sources).filter(k => S.f.sources[k]).join(','), );
  A.closeMenu();
  await wait(1500);
  console.log('tras filtros -> mostradas:', S.shown, '| estados:', JSON.stringify(Object.fromEntries(Object.entries(S.status).map(([k, v]) => [k, v.state + (v.msg ? ':' + v.msg : '')]))));
  A.next(); await wait(100); A.prev();
  console.log('historial:', S.hist.length, 'idx', S.hi);
  // Toques como en un libro electrónico (pantalla de 500 px)
  Object.defineProperty(w, 'innerWidth', { value: 500, configurable: true });
  const tap = x => d.body.dispatchEvent(new w.MouseEvent('click', { clientX: x, bubbles: true }));
  const sh0 = S.shown, hl0 = S.hist.length;
  tap(480); await wait(400);
  const rightOK = !S.menu && (S.adv || S.hist.length > hl0 || S.shown > sh0 || S.hi < S.hist.length - 1);
  const hi1 = S.hi; tap(15); await wait(100);
  const leftOK = !S.menu && (S.hi < hi1 || S.hi === 0);
  tap(250); const centerOK = S.menu; A.closeMenu();
  console.log('toques -> derecha:', rightOK, '| izquierda:', leftOK, '| centro abre menú:', centerOK);
  if (!rightOK || !leftOK || !centerOK) { console.error('FALLO toques'); process.exit(1); }
  console.log('errores JS:', errors.length ? errors : 'ninguno');
  process.exit(0);
})();
