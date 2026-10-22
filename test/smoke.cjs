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
  if (url.includes('www.wikidata.org/w/api.php') && /wbgetentities/.test(url)) return J(/props=claims/.test(url) ? { entities: { Q4242: { claims: { P17: [{ mainsnak: { datavalue: { value: { id: 'Q298' } } } }] } } } } : { entities: { Q298: { labels: { es: { value: 'Chile' } } } } });
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
  assert.ok(w.document.querySelector('#caption .s'), 'la ficha tiene línea de museo'); assert.strictEqual(S.st.caption, 'def'); assert.strictEqual(A.capMode(), 'auto', 'TV (sin táctil): la ficha sale al inicio');
  assert.ok(!w.document.getElementById('menuBtn') && !w.document.querySelector('.edge'), 'sin botón de menú ni flechas');
  assert.strictEqual(w.document.querySelector('#c-types'), null, 'ya no existe la sección «Tipo de obra»');
  { const C = w.ArtCore, df = C.defaultFilters(), mkw = (type) => ({ imgs: ['x'], type, year: 1700 });
    assert.ok(!C.accept(mkw('sculpture'), df) && !C.accept(mkw('decorative'), df), 'se descartan esculturas y objetos 3D');
    for (const ty of ['painting', 'drawing', 'print', 'photo', 'tapestry']) assert.ok(C.accept(mkw(ty), df), ty + ' se acepta');
    assert.strictEqual(C.classifyType('Tapestry, wool and silk'), 'tapestry'); assert.strictEqual(C.classifyType('Marble statue of a youth'), 'sculpture');
    assert.ok(!C.makePlan(df).type || C.makePlan(df).type !== 'sculpture'); for (let i = 0; i < 60; i++) assert.notStrictEqual(C.makePlan(df).type, 'sculpture'); }
  assert.strictEqual(w.document.querySelector('#c-bg'), null, 'el selector de fondo ya no existe (lo marca el skin)');
  { const dd = w.document, de = dd.documentElement;
    assert.strictEqual(de.dataset.skin, 'm3-dark', 'skin por defecto');
    assert.strictEqual(dd.querySelectorAll('#c-skin option').length, 4, 'cuatro skins');
    for (const sk of ['m3-light', 'm3e-dark', 'm3e-light']) { A.onAct('skin', sk); assert.strictEqual(de.dataset.skin, sk); assert.strictEqual(S.st.skin, sk); }
    assert.ok(/Expressive claro/.test(dd.querySelector('[data-sum=skin]').textContent), 'resumen del skin');
    assert.strictEqual(dd.querySelector('meta[name=theme-color]').getAttribute('content'), '#FFF7FF');
    A.onAct('skin', 'inventado'); assert.strictEqual(de.dataset.skin, 'm3-dark', 'skin desconocido vuelve al predeterminado'); }
  A.openMenu();
  { const d0 = w.document; assert.ok(d0.querySelectorAll('#c-excl .chip').length >= 10, 'chips de «No quiero ver»');
    A.onAct('ex', 'portraits'); assert.deepStrictEqual(Array.from(S.f.exclude), ['portraits']);
    d0.getElementById('exwIn').value = 'caballos'; A.onAct('add-exw'); assert.deepStrictEqual(Array.from(S.f.noWords), ['caballos']);
    assert.ok(/Retratos/.test(d0.querySelector('[data-sum=noquiero]').textContent), 'resumen: ' + d0.querySelector('[data-sum=noquiero]').textContent);
    A.onAct('rm-exw', 'caballos'); A.onAct('ex', 'portraits'); assert.strictEqual(S.f.exclude.length + S.f.noWords.length, 0);
    d0.getElementById('k-europeana').value = 'api2demo'; w.fetch = (u0 => async (u, i) => /europeana/.test(String(u)) ? { ok: true, status: 200, json: async () => ({ success: true, totalResults: 12 }) } : u0(u, i))(w.fetch);
    A.onAct('key-test', 'europeana'); await wait(50); assert.ok(/funciona/.test(d0.getElementById('keyMsg').textContent), d0.getElementById('keyMsg').textContent); }
  const d = w.document; function d0(){return d;}
  console.log('filas de museos:', d0().querySelectorAll('#c-msrcs .src').length, '| activas:', d0().querySelectorAll('#c-msrcs .src[aria-pressed=true]').length);
  console.log('menu abierto:', !d.getElementById('drawer').hidden, '| chips estilos:', d.querySelectorAll('#c-styles .chip').length, '| filas:', d.querySelectorAll('#c-msrcs .src').length, '| sección antigua:', !!d.getElementById('c-srcs'));
  // clic en estilo Impresionismo y en una fuente
  d.querySelector('#c-styles [data-id=impressionism]').click();
  const pick = name => { const sel = d.getElementById('c-presets'); const o = Array.from(sel.options).find(x => x.textContent === name || x.textContent.startsWith(name + ' (')); sel.value = o.value; sel.dispatchEvent(new w.Event('change')); return !!o; };
  assert.ok(pick('Museos de Francia'), 'colección por país');
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
  { const J2 = o => ({ ok: true, status: 200, json: async () => o }), f0 = w.fetch;
    w.fetch = async (u, i) => { u = String(u);
      if (/wbsearchentities/.test(u)) return J2({ search: /language=es/.test(u) ? [{ id: 'Q45585', label: 'La noche estrellada', description: 'pintura de Vincent van Gogh' }] : [] });
      if (/props=claims/.test(u)) return J2({ entities: { Q45585: { id: 'Q45585', labels: { es: { value: 'La noche estrellada' } }, descriptions: { es: { value: 'pintura de Vincent van Gogh' } }, claims: { P18: [{ mainsnak: { datavalue: { value: 'Starry.jpg' } } }], P571: [{ mainsnak: { datavalue: { value: { time: '+1889-06-00T00:00:00Z' } } } }] } } } });
      return f0(u, i); };
    A.openMenu(); d.getElementById('titleIn').value = 'noche estrellada'; d.querySelector('[data-act=title-search]').click(); await wait(300);
    assert.strictEqual(d.querySelectorAll('#c-tres .tres').length, 1, 'resultado de la búsqueda por título');
    d.querySelector('#c-tres .tres').click(); await wait(100);
    assert.strictEqual(S.current.title, 'La noche estrellada', 'la obra elegida se muestra'); assert.ok(!S.menu, 'el menú se cierra al elegirla'); assert.ok(/Special:FilePath\/Starry\.jpg/.test(d.querySelector('.slide.on img').getAttribute('src')), 'se muestra la imagen, no la página: ' + d.querySelector('.slide.on img').getAttribute('src')); assert.strictEqual(d.querySelector('#caption .t').textContent, 'La noche estrellada');
    // buscar por foto
    d.getElementById('photoIn').dispatchEvent(new w.Event('change')); // sin archivo no pasa nada
    const fotoMsg = () => d.getElementById('titleMsg').textContent;
    const subir = async () => { const inp = d.getElementById('photoIn'); Object.defineProperty(inp, 'files', { value: [new w.File([new Uint8Array([255, 216, 255, 224])], 'cuadro.jpg', { type: 'image/jpeg' })], configurable: true }); inp.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(500); };
    A.openMenu(); S.tres = []; await subir();
    assert.ok(/clave/i.test(fotoMsg()), 'sin clave avisa: ' + fotoMsg());
    d.getElementById('idk-gemini').value = 'clave-gemini'; d.getElementById('idk-gemini').dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.strictEqual(JSON.parse(w.localStorage.getItem('galeria-arte-v1:idkeys')).gemini, 'clave-gemini', 'la clave se guarda en el dispositivo');
    w.fetch = async (u, i) => { u = String(u);
      if (/generativelanguage/.test(u)) return J2({ candidates: [{ content: { parts: [{ text: '{"title":"La noche estrellada","title_en":"The Starry Night","artist":"Vincent van Gogh","year":"1889","confidence":0.9}' }] } }] });
      if (/wbsearchentities/.test(u)) return J2({ search: /language=es/.test(u) ? [{ id: 'Q45585', label: 'La noche estrellada', description: 'pintura de Vincent van Gogh' }] : [] });
      if (/props=claims/.test(u)) return J2({ entities: { Q45585: { id: 'Q45585', labels: { es: { value: 'La noche estrellada' } }, descriptions: { es: { value: 'pintura de Vincent van Gogh' } }, claims: { P18: [{ mainsnak: { datavalue: { value: 'Starry.jpg' } } }], P571: [{ mainsnak: { datavalue: { value: { time: '+1889-06-00T00:00:00Z' } } } }] } } } });
      return f0(u, i); };
    S.tres = []; await subir();
    assert.strictEqual(d.querySelectorAll('#c-tres .tres').length, 1, 'la foto se reconoce y se busca: ' + fotoMsg()); assert.ok(/Parece ser «La noche estrellada», Vincent van Gogh \(1889\)/.test(fotoMsg()), fotoMsg());
    d.querySelector('#c-tres .tres').click(); await wait(100); assert.strictEqual(S.current.title, 'La noche estrellada', 'se muestra la obra reconocida');
    w.fetch = f0; }
  const C0 = () => w.ArtCore; const favs0 = S.favs; S.favs = []; A.render('presets');
  { const opts = Array.from(d.querySelectorAll('#c-presets option')).map(o => o.textContent);
    for (const n of ['Museos de España (12)', 'Museos de México (18)', 'Museos del Reino Unido (8)', 'Museos de los Países Bajos (5)', 'Museos de Chile (1)', 'Museos de París (13)']) assert.ok(opts.includes(n), 'falta la colección ' + n + ' en ' + opts.join(' | '));
    for (const old of ['Impresionismo', 'Retratos', 'Mujeres artistas', 'Surrealismo en museos', 'Museos de un solo artista']) assert.ok(!opts.some(o => o.startsWith(old)), 'se quitaron las colecciones antiguas: ' + old);
    assert.strictEqual(opts[1], 'Todo el arte'); assert.ok(opts.slice(2).every(o => /^Museos de/.test(o)), 'las demás son «Museos de …»'); }
  { S.favs = [{ uid: 'f1', artist: 'Salvador Dalí', year: 1931 }, { uid: 'f2', artist: 'Claude Monet', year: 1890 }, { uid: 'f3', artist: 'Anónimo', year: 1500 }]; A.render('presets');
    const opts = Array.from(d.querySelectorAll('#c-presets option')).map(o => o.textContent);
    assert.ok(opts.includes('Surrealismo') && opts.includes('Impresionismo'), 'colecciones por estilo de las favoritas: ' + opts.join(' | '));
    assert.ok(!opts.includes('Renacimiento'), 'una obra sin artista conocido no crea colección');
    A.onAct('era', 'mod'); S.f.orientation = 'landscape'; S.f.artists = ['Monet']; S.f.exclude = ['portraits']; S.f.soloPD = true; Object.keys(S.f.sources).forEach(k => { S.f.sources[k] = k === 'm:met'; });
    pick('Surrealismo'); { const on = Object.keys(S.f.sources).filter(k => S.f.sources[k]), off = Object.keys(S.f.sources).filter(k => !S.f.sources[k]);
      assert.strictEqual(JSON.stringify(S.f.styles), '[\"surrealism\"]'); assert.ok(on.includes('m:open') && on.includes('m:louvre') && on.includes('m:magritte') && on.length > 150, 'Surrealismo: todos los museos'); assert.strictEqual(off.join(), 'm:harvard', 'solo falta el que pide clave: ' + off);
      assert.ok(S.f.eras.join() === 'mod' && S.f.orientation === 'landscape' && S.f.artists.join() === 'Monet' && S.f.exclude.join() === 'portraits' && S.f.soloPD, 'los demás filtros no cambian'); }
    pick('Impresionismo'); assert.strictEqual(JSON.stringify(S.f.styles), '[\"impressionism\"]', 'solo cambia el estilo');
    assert.strictEqual(C0().styleIdsOf({ artist: 'Vincent van Gogh', year: 1888 }).join(), 'postimpressionism'); assert.strictEqual(C0().styleIdsOf({ artist: 'Vermeer', year: 1660 }).join(), 'dutch');
    S.favs = favs0; A.render('presets'); }
  { A.onAct('era', 'mod'); S.f.orientation = 'landscape'; S.f.soloPD = true; S.f.artists = ['Monet']; pick('Todo el arte');
    const f = S.f, off = Object.keys(f.sources).filter(k => !f.sources[k]);
    assert.ok(!f.eras.length && !f.styles.length && !f.artists.length && !f.keywords.length && !f.exclude.length && !f.noWords.length && f.orientation === 'any' && !f.soloPD, 'Todo el arte: sin ningún filtro');
    assert.deepStrictEqual(off, ['m:harvard'], 'Todo el arte: todos los museos salvo los que piden clave y no hay: ' + off); }
  for (const [name, n] of [['Museos de México', 18], ['Museos de Bélgica', 28], ['Museos de España', 12], ['Museos de Chile', 1]]) {
    pick(name);
    const act = Object.keys(S.f.sources).filter(k => S.f.sources[k]).length;
    console.log('preset', name, '->', act, 'museos activos', '');
    if (act !== n) { console.error('FALLO preset', name, act, 'esperaba', n); process.exit(1); }
  }
  pick('Museos de París');
  { const rows = () => Array.from(d.querySelectorAll('#c-msrcs .src')), on = r => r.getAttribute('aria-pressed') === 'true';
    const rank = r => !on(r) ? 2 : (st => st === 'ok' ? 0 : st === 'error' || st === 'nokey' ? 3 : 1)(r.querySelector('.dot').className.replace('dot', '').trim());
    const sorted = () => rows().map(rank).every((x, i, a) => !i || a[i - 1] <= x);
    const sel = Object.keys(S.f.sources).filter(k => S.f.sources[k]);
    sel.forEach((id, k) => { S.status[id] = { state: ['error', 'ok', 'loading', 'empty'][k % 4], msg: '' }; });
    A.renderAll(); assert.ok(sorted(), 'verdes arriba, luego amarillos, luego sin seleccionar y rojos al final');
    assert.strictEqual(rank(rows()[rows().length - 1]), 3, 'el último es rojo');
    assert.strictEqual(rank(rows()[0]), 0, 'el primero es verde');
    const ids0 = rows().map(r => r.dataset.id).join(); const freeId = rows().find(r => !on(r)).dataset.id; d.querySelector('#c-msrcs [data-id="' + freeId + '"]').click(); assert.strictEqual(rows().map(r => r.dataset.id).join(), ids0, 'al marcar un museo suelto las filas no se reordenan');
    A.renderAll(); assert.ok(sorted(), 'al reabrir/renderizar el orden vuelve a seguir los colores'); d.querySelector('#c-msrcs [data-id="' + freeId + '"]').click(); }
  console.log('preset Museos de París -> fuentes activas:', Object.keys(S.f.sources).filter(k => S.f.sources[k]).join(','), );
  A.closeMenu();
  await wait(1500);
  console.log('tras filtros -> mostradas:', S.shown, '| estados:', JSON.stringify(Object.fromEntries(Object.entries(S.status).map(([k, v]) => [k, v.state + (v.msg ? ':' + v.msg : '')]))));
  { const on = Object.keys(S.f.sources).filter(k => S.f.sources[k]); const keep = S.pool; S.pool = Array.from({ length: 30 }, (_, i) => ({ uid: 'x' + i, src: 'x', title: 'Relleno ' + i, artist: 'A', museum: 'M', imgs: ['https://upload.wikimedia.org/x' + i + '.jpg'], url: 'https://upload.wikimedia.org/x' + i + '.jpg', type: 'painting' })); S.status = {}; S.flight = new Map(); S.cool = {}; S.streak = {}; A.refill(); await wait(5000); S.pool = keep;
    const tried = on.filter(k => S.status[k]).length; assert.strictEqual(tried, on.length, 'el barrido consulta todos los museos seleccionados, no solo 4 (' + tried + '/' + on.length + ')'); }
  A.next(); await wait(100); A.prev();
  console.log('historial:', S.hist.length, 'idx', S.hi);
  assert.ok(S.current && S.current.museum, 'la obra trae museo'); assert.strictEqual(w.document.querySelector('#caption .s').textContent, S.current.museum, 'la ficha lleva el museo');
  // Toques como en un libro electrónico (pantalla de 500 px)
  Object.defineProperty(w, 'innerWidth', { value: 500, configurable: true });
  S.st.caption = 'def'; assert.strictEqual(A.capMode(), 'always', 'móvil sin TV: la ficha siempre visible'); S.st.caption = 'auto'; assert.strictEqual(A.capMode(), 'auto'); S.st.caption = 'def';
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
