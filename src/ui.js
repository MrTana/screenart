/* Interfaz: escenario, rotación, menú de filtros, favoritas y ajustes. */
(function () {
'use strict';
const C = ArtCore;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'galeria-arte-v1';
const Q = (() => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(''); } })();
// Con «?c=código» la página es el mando del móvil: no muestra obras, controla la TV.
const REMOTE = /^[a-z0-9]{6,24}$/i.test(Q.get('c') || '') ? Q.get('c').toLowerCase() : '';
function lsGet(k, def) { try { const v = localStorage.getItem(KEY + ':' + k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
function lsSet(k, v) { if (REMOTE && k !== 'rc') return; try { localStorage.setItem(KEY + ':' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }

/* ───────── estado ───────── */
function loadFilters() { return normFilters(lsGet('f', {})); }
function normFilters(s) {
  const d = C.defaultFilters();
  s = s && typeof s === 'object' ? s : {};
  const f = Object.assign(d, s);
  f.sources = Object.assign({}, d.sources, s.sources || {});
  ['eras', 'styles', 'types', 'artists', 'keywords'].forEach(k => { if (!Array.isArray(f[k])) f[k] = []; });
  return f;
}
const S = {
  f: loadFilters(),
  st: Object.assign({ interval: 30, mode: 'gallery', quality: 'normal', kenburns: false, caption: 'auto' }, lsGet('st', {})),
  keys: Object.assign({ europeana: 'api2demo', si: 'DEMO_KEY', harvard: '' }, lsGet('keys', {})),
  favs: lsGet('favs', []),
  pool: [], seen: new Set(), seenKey: new Set(), hist: [], hi: -1,
  paused: false, menu: false, epoch: 0, refilling: 0, adv: false, advAt: 0, flight: new Map(), cool: {}, streak: {}, warned: false, recycleAfter: 6000, artGroup: 'impressionism', mfilter: '', detail: {}, acc: null,
  status: {}, counts: {}, layer: 0, nextP: null, nextEpoch: -1,
  timer: null, capT: null, idleT: null, waiters: [], current: null, shown: 0
};
function saveAll() { if (REMOTE) { remoteSetSoon(); return; } lsSet('f', S.f); lsSet('st', S.st); lsSet('keys', S.keys); lsSet('favs', S.favs.slice(0, 300)); }

S.custom = lsGet('custom', []);
S.custom.forEach(m => { try { C.addMuseum(m); } catch (e) { /* museo dañado */ } });
const slides = [$('#slideA'), $('#slideB')];
const wkey = w => C.norm(w.title) + '|' + C.norm(w.artist);

/* ───────── avisos ───────── */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }
function busy() { $('#busy').textContent = 'Buscando obras…'; $('#busy').classList.toggle('on', S.refilling > 0); }
function showLoader(text, sub, btn) {
  $('#loaderText').textContent = text; $('#loaderSub').textContent = sub || ''; $('#loaderMenu').hidden = !btn; $('#loaderDiag').hidden = !btn;
  $('#loader').hidden = false;
}
function errText(e) {
  if (!e) return 'error';
  if (e.noKey) return 'falta la clave';
  if (e.timeout) return 'tiempo de espera agotado';
  if (e.status) return 'respuesta ' + e.status;
  if (e instanceof TypeError) return 'sin conexión o bloqueada por el navegador';
  return e.message || 'error';
}

/* ───────── fuentes y cola de obras ───────── */
function ctx() { return { hq: S.st.quality === 'high', keys: S.keys, anyRights: !S.f.soloPD }; }
function wake() { S.waiters.splice(0).forEach(r => r()); }
function waitPool(ms) { return new Promise(res => { let d = false; const fin = () => { if (!d) { d = true; res(); } }; S.waiters.push(fin); setTimeout(fin, ms); }); }
function insertRandom(list) { list.forEach(w => S.pool.splice(C.rand(S.pool.length + 1), 0, w)); wake(); }
/* WikiArt tiene prioridad: sus obras se ponen al principio de la cola (mezcladas entre sí) y el resto entra al azar. */
function insertPriority(list) {
  const wa = C.shuffle(list.filter(w => w.src === 'wikiart')), rest = list.filter(w => w.src !== 'wikiart');
  if (wa.length) S.pool.unshift(...wa);
  insertRandom(rest);
}
const fresh = (w, f) => C.accept(w, f) && !S.seen.has(w.uid) && !S.seenKey.has(wkey(w)) && !S.pool.some(x => x.uid === w.uid);

function setStatus(id, state, msg) {
  S.status[id] = { state, msg: msg || '' };
  updateSrc(id);
}

function ensureRefill() { if (S.pool.length < 8) refill(); }

/* Cada fuente va por su cuenta: una lenta no frena a las demás, y las que fallan o vienen vacías descansan un rato (nunca se rinden del todo). */
function refill() {
  const epoch = S.epoch, f = S.f;
  if (f.onlyFavs) {
    let list = S.favs.filter(w => !S.seen.has(w.uid));
    if (!list.length && S.favs.length) { S.favs.forEach(w => S.seen.delete(w.uid)); list = S.favs.slice(); }
    if (!list.length) { if (!S.warned) { S.warned = true; toast('Aún no tienes favoritas'); } return; }
    insertRandom(C.shuffle(list.slice()).filter(w => !S.pool.some(x => x.uid === w.uid)));
    return;
  }
  const now = Date.now();
  const enabled = C.SOURCE_LIST.filter(s => f.sources[s.id]);
  if (!enabled.length) { if (!S.warned) { S.warned = true; toast('Activa al menos un museo'); } return; }
  const ready = enabled.filter(s => !S.flight.has(s.id) && (S.cool[s.id] || 0) <= now);
  // Cada museo lanza varias consultas (y Wikidata aguanta pocas a la vez): nunca más de 4 museos en marcha.
  // La fila que incluye WikiArt (colecciones abiertas) sale siempre la primera.
  const wa = ready.filter(s => s.id === 'm:open'), others = ready.filter(s => s.id !== 'm:open');
  const room = Math.max(0, 4 - S.flight.size);
  wa.slice(0, room).concat(C.sampleN(others, Math.max(0, room - wa.length))).forEach(s => launch(s, epoch));
}

async function launch(s, epoch) {
  const f = S.f;
  S.flight.set(s.id, epoch); S.refilling++; busy(); setStatus(s.id, 'loading');
  let added = 0, fail = null;
  try {
    const d = S.detail[s.id] = {};
    const cx = Object.assign(ctx(), {
      report: (name, n, err) => { d[name] = err ? '✖ ' + errText(err) : n; },
      early: l => { if (epoch === S.epoch) { const x = l.filter(w => fresh(w, f)); if (x.length) { insertPriority(x); wake(); } } }
    });
    let list = await C.runSource(s, f, cx);
    if (epoch === S.epoch) {
      list = list.filter(w => fresh(w, f));
      added = list.length;
      if (added) insertPriority(list);
    }
  } catch (e) { fail = e; }
  S.refilling--; busy();
  if (S.flight.get(s.id) === epoch) S.flight.delete(s.id);
  if (epoch !== S.epoch) return;
  if (fail) {
    const n = S.streak[s.id] = (S.streak[s.id] || 0) + 1;
    S.cool[s.id] = Date.now() + (fail.noKey ? 1e12 : Math.min(120000, 15000 * Math.pow(2, n - 1)));
    setStatus(s.id, fail.noKey ? 'nokey' : 'error', errText(fail));
  } else if (!added) {
    const n = S.streak[s.id] = (S.streak[s.id] || 0) + 1;
    S.cool[s.id] = Date.now() + Math.min(60000, 3000 * n);
    setStatus(s.id, S.counts[s.id] ? 'ok' : 'empty');
  } else {
    S.streak[s.id] = 0; S.cool[s.id] = 0;
    S.counts[s.id] = (S.counts[s.id] || 0) + added;
    setStatus(s.id, 'ok');
  }
  if (added) wake();
  if (S.pool.length < 6) ensureRefill();
}

/* Cuando las fuentes no dan más obras nuevas, se vuelven a mostrar las ya vistas en lugar de quedarse parado. */
function recycle() {
  if (S.hist.length < 2) return false;
  S.seen.clear(); S.seenKey.clear();
  let list = C.shuffle(S.hist.map(w => Object.assign({}, w, { imgs: [w.url].concat((w.imgs || []).filter(u => u !== w.url)) })));
  if (S.current && list.length > 1) list = list.filter(w => w.uid !== S.current.uid);
  S.pool = list; wake();
  return true;
}

function loadImage(urls) {
  return new Promise(resolve => {
    let i = 0;
    const next = () => {
      if (i >= urls.length) return resolve(null);
      const url = urls[i++], im = new Image();
      let done = false;
      const fin = ok => { if (done) return; done = true; clearTimeout(t); ok ? resolve({ url, w: im.naturalWidth, h: im.naturalHeight }) : next(); };
      const t = setTimeout(() => { im.onload = im.onerror = null; fin(false); }, 15000);
      im.onload = () => fin(true); im.onerror = () => fin(false);
      im.referrerPolicy = 'no-referrer'; im.src = url;
    };
    next();
  });
}

function orientOK(w, h) {
  const o = S.f.orientation, r = w / h;
  if (o === 'landscape') return r >= 1.15;
  if (o === 'portrait') return r <= 0.87;
  if (o === 'square') return r > 0.87 && r < 1.15;
  return true;
}

async function pullNext() {
  const epoch = S.epoch, t0 = Date.now();
  let idleSince = 0;
  while (Date.now() - t0 < 40000) {
    if (epoch !== S.epoch) return null;
    if (!S.pool.length) {
      ensureRefill();
      if (!S.flight.size) {
        idleSince = idleSince || Date.now();
        if (Date.now() - idleSince > S.recycleAfter && recycle()) { idleSince = 0; continue; }
      } else idleSince = 0;
      await waitPool(2500);
      continue;
    }
    const batch = S.pool.splice(0, 3); ensureRefill();
    // Se prueban 3 imágenes a la vez: las que no cargan (bloqueadas o rotas) no frenan el cambio.
    const res = await Promise.all(batch.map(async w => {
      if (S.seen.has(w.uid) || (S.current && w.uid === S.current.uid)) return null;
      const r = await loadImage(w.imgs);
      return r && r.w >= 300 && r.h >= 300 && orientOK(r.w, r.h) ? { w, r } : null;
    }));
    if (epoch !== S.epoch) return null;
    const ok = res.filter(Boolean);
    if (!ok.length) continue;
    ok.slice(1).reverse().forEach(x => S.pool.unshift(x.w));
    const w = ok[0].w, r = ok[0].r;
    S.seen.add(w.uid); S.seenKey.add(wkey(w));
    if (S.seen.size > 3000) { S.seen.clear(); S.seenKey.clear(); }
    return Object.assign({}, w, { url: r.url, url_page: w.url });
  }
  return null;
}

/* ───────── escenario ───────── */
function isFav(w) { return !!w && S.favs.some(x => x.uid === w.uid); }
function captionMs() { const s = +S.st.interval || 30; return (s >= 1800 ? 300 : s * 0.25) * 1000; }
function setCaption(w) {
  const c = $('#caption');
  c.querySelector('.t').textContent = w.title;
  c.querySelector('.m').textContent = [w.artist, w.date || w.year].filter(Boolean).join(' · ');
  clearTimeout(S.capT);
  if (S.st.caption === 'never') { c.classList.remove('show'); return; }
  c.classList.add('show');
  // La ficha dura el 25 % del tiempo de la obra; con 30 min o más, 5 min como máximo.
  if (S.st.caption === 'auto') S.capT = setTimeout(() => c.classList.remove('show'), captionMs());
}
function present(item, fromHist) {
  const nxt = 1 - S.layer, s = slides[nxt];
  s.querySelector('img').src = item.url;
  s.querySelector('img').alt = item.title + (item.artist ? ', ' + item.artist : '');
  s.querySelector('.bg').style.backgroundImage = 'url("' + item.url.replace(/"/g, '%22') + '")';
  s.classList.remove('on'); void s.offsetWidth; s.classList.add('on');
  slides[S.layer].classList.remove('on'); S.layer = nxt;
  $('#loader').hidden = true;
  if (!fromHist) { S.hist.push(item); if (S.hist.length > 120) S.hist.shift(); S.hi = S.hist.length - 1; }
  S.current = item; S.shown++;
  setCaption(item); updateFavBtn();
  tvNowSoon();
}
function schedule() {
  clearTimeout(S.timer);
  document.documentElement.style.setProperty('--dur', S.st.interval + 's');
  if (S.paused || S.menu) return;
  S.timer = setTimeout(next, S.st.interval * 1000);
}
async function advance() {
  if (S.adv && Date.now() - S.advAt < 90000) return;
  const epoch = S.epoch;
  S.adv = true; S.advAt = Date.now(); clearTimeout(S.timer);
  try {
    let item = null;
    if (S.nextP && S.nextEpoch === S.epoch) { item = await S.nextP; }
    S.nextP = null;
    if (epoch !== S.epoch) return;
    if (!item) item = await pullNext();
    if (epoch !== S.epoch) return;
    if (!item) {
      // Sin obras nuevas: se repite una ya vista para que la pantalla nunca se quede parada.
      const old = S.hist.filter(w => !S.current || w.uid !== S.current.uid);
      if (old.length) { present(C.pick(old), true); toast('Repitiendo obras ya vistas: las fuentes no dan más por ahora'); S.nextEpoch = S.epoch; S.nextP = pullNext(); return; }
      showEmpty(); return;
    }
    present(item, false);
    S.nextEpoch = S.epoch; S.nextP = pullNext();
  } finally { if (epoch === S.epoch) { S.adv = false; schedule(); } }
}
function showEmpty() {
  const states = Object.keys(S.status).map(k => S.status[k].state);
  const allBad = states.length && states.every(x => x === 'error' || x === 'nokey');
  if (S.current) { toast('No encuentro más obras con estos filtros'); return; }
  showLoader(allBad ? 'Ningún museo ha respondido' : 'No encontré obras con estos filtros',
    allBad ? 'Revisa la conexión. Si abriste el archivo desde el disco, súbelo a un alojamiento https o ábrelo en otro navegador.' : 'Amplía la época o el estilo, o activa más museos. El diagnóstico muestra qué responde cada fuente.', true);
}
function next() {
  if (S.hi < S.hist.length - 1) { S.hi++; present(S.hist[S.hi], true); schedule(); }
  else advance();
}
function prev() {
  if (S.hi > 0) { S.hi--; present(S.hist[S.hi], true); schedule(); }
  else toast('No hay obra anterior');
}
function togglePlay() { S.paused = !S.paused; $('#playBtn').textContent = S.paused ? 'Reanudar' : 'Pausar'; toast(S.paused ? 'En pausa' : 'Reproduciendo'); schedule(); tvNowSoon(true); }
function toggleFav() {
  const w = S.current; if (!w) return;
  if (isFav(w)) { S.favs = S.favs.filter(x => x.uid !== w.uid); toast('Quitada de favoritas'); }
  else { S.favs.unshift({ uid: w.uid, src: w.src, museum: w.museum, title: w.title, artist: w.artist, date: w.date, year: w.year, imgs: [w.url].concat(w.imgs.filter(u => u !== w.url)), thumb: w.thumb, url: w.url_page || w.url, type: w.type, pd: w.pd, license: w.license, w: w.w, h: w.h }); toast('Guardada en favoritas'); }
  saveAll(); updateFavBtn(); tvNowSoon(true);
}
function updateFavBtn() { $('#favBtn').textContent = isFav(S.current) ? 'Quitar favorita' : 'Guardar favorita'; }
function toggleFS() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => toast('Este navegador no permite pantalla completa'));
  } catch (e) { toast('Este navegador no permite pantalla completa'); }
}
function applyLook() {
  $('#stage').className = 'mode-' + S.st.mode + (S.st.kenburns ? ' kb' : '');
  document.body.dataset.mode = S.st.mode;
  document.documentElement.style.setProperty('--dur', S.st.interval + 's');
}


/* ───────── diagnóstico ───────── */
function describeFilters() {
  const f = S.f, nm = (list, arr, k) => arr.map(id => { const x = list.find(y => y.id === id); return x ? x.es : id; }).join(', ');
  const parts = [];
  if (f.styles.length) parts.push('estilo: ' + nm(C.STYLES, f.styles));
  if (f.eras.length) parts.push('época: ' + nm(C.ERAS, f.eras));
  if (f.yearFrom || f.yearTo) parts.push('años: ' + (f.yearFrom || '…') + ' a ' + (f.yearTo || '…'));
  if (f.types.length) parts.push('tipo: ' + nm(C.TYPES, f.types));
  if (f.artists.length) parts.push('artistas: ' + f.artists.join(', '));
  if (f.keywords.length) parts.push('tema: ' + f.keywords.join(', '));
  if (f.orientation !== 'any') parts.push('formato: ' + f.orientation);
  if (f.soloPD) parts.push('solo dominio público');
  return parts.length ? parts.join(' · ') : 'sin filtros';
}
let diagRun = 0;
async function diagnose() {
  const run = ++diagRun, f = S.f, box = $('#diag'), out = $('#diagOut');
  box.hidden = false;
  const srcs = C.SOURCE_LIST.filter(s => f.sources[s.id]);
  const lines = {};
  const draw = (done) => {
    out.textContent = 'Filtros: ' + describeFilters() + '\n' + (done ? 'Listo.' : 'Probando ' + srcs.length + ' museos (Wikidata tarda; puede llevar un par de minutos)…') + '\n\n' +
      srcs.map(s => lines[s.id] || ('… ' + s.name)).join('\n');
  };
  draw(false);
  await C.mapLimit(srcs, 4, async s => {
    const t0 = Date.now(); let line;
    try {
      const d = {};
      const list = await C.runSource(s, f, Object.assign(ctx(), { report: (n, c, err) => { d[n] = err ? '✖ ' + errText(err) : c; } }));
      const ok = list.filter(w => C.accept(w, f));
      let img = '';
      if (ok.length) { const r = await loadImage(C.shuffle(ok.slice())[0].imgs); img = r ? ' · imagen carga bien (' + r.w + '×' + r.h + ')' : ' · la imagen NO carga (bloqueada o rota)'; }
      line = (ok.length ? '✔ ' : '✖ ') + s.name + ': ' + list.length + ' obras, ' + ok.length + ' válidas con tus filtros' + img + (ok[0] ? ' · «' + ok[0].title.slice(0, 50) + '»' : '') + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s\n     ' + Object.keys(d).map(k => k + ': ' + d[k]).join(' · ');
    } catch (e) { line = '✖ ' + s.name + ': ERROR ' + errText(e) + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s'; }
    if (run !== diagRun) return;
    lines[s.id] = line; draw(false);
  });
  if (run === diagRun) draw(true);
}

/* ───────── cambio de filtros ───────── */
let applyT;
function applyChange() {
  saveAll();
  if (REMOTE) return;
  clearTimeout(applyT);
  applyT = setTimeout(() => {
    S.epoch++; S.pool = []; S.nextP = null; S.flight = new Map(); S.cool = {}; S.streak = {}; S.warned = false; S.adv = false; S.counts = {}; S.status = {};
    renderSrcs();
    if (S.f.onlyFavs && !S.favs.length) toast('Aún no tienes favoritas');
    advance();
  }, 700);
}


/* ───────── secciones plegables ───────── */
const names = (list, ids) => ids.map(id => { const x = list.find(y => y.id === id); return x ? x.es : id; });
function accSummary(id) {
  const f = S.f, j = a => a.join(', ');
  switch (id) {
    case 'museos': { const n = C.SOURCE_LIST.filter(s => f.sources[s.id]).length; return n + ' de ' + C.SOURCE_LIST.length + ' activos'; }
    case 'epoca': return f.yearFrom || f.yearTo ? (f.yearFrom || '…') + ' a ' + (f.yearTo || '…') : f.eras.length ? j(names(C.ERAS, f.eras)) : 'Todas las épocas';
    case 'estilo': return f.styles.length ? j(names(C.STYLES, f.styles)) : 'Todos los estilos';
    case 'tipo': return f.types.length ? j(names(C.TYPES, f.types)) : 'Todos los tipos';
    case 'artistas': return f.artists.length ? j(f.artists) : 'Todos los artistas';
    case 'tema': return f.keywords.length ? j(f.keywords.map(q => { const k = C.KEYWORDS.find(x => x.q === q); return k ? k.es : q; })) : 'Cualquier tema';
    case 'opciones': { const o = []; if (S.st.kenburns) o.push('zoom lento'); if (S.st.quality === 'high') o.push('alta calidad'); if (f.soloPD) o.push('solo dominio público'); if (f.onlyFavs) o.push('solo favoritas'); return o.length ? j(o) : 'Ninguna activada'; }
    case 'claves': { const n = ['europeana', 'si', 'harvard'].filter(k => S.keys[k] && !/^(api2demo|DEMO_KEY)$/.test(S.keys[k])).length; return n ? n + ' configuradas' : 'Opcional'; }
  }
  return '';
}
function updateSums() { document.querySelectorAll('[data-sum]').forEach(el => { el.textContent = accSummary(el.dataset.sum); }); }
function toggleAcc(id) {
  S.acc = S.acc === id ? null : id;
  document.querySelectorAll('section.acc').forEach(s => {
    const on = s.dataset.acc === S.acc; s.classList.toggle('open', on);
    const h = s.querySelector('.acch'); if (h) h.setAttribute('aria-expanded', on ? 'true' : 'false');
  });
  if (S.acc) { const h = document.querySelector('section.acc.open .acch'); if (h && h.scrollIntoView) h.scrollIntoView({ block: 'start' }); }
}

/* ───────── menú ───────── */
const PRESETS = [
  { es: 'Todo el arte', patch: {} },
  { es: 'Impresionismo', patch: { styles: ['impressionism', 'postimpressionism'] } },
  { es: 'Maestros holandeses', patch: { styles: ['dutch'], types: ['painting'] } },
  { es: 'Japón: ukiyo-e', patch: { styles: ['ukiyoe'] } },
  { es: 'Barroco', patch: { styles: ['baroque'], types: ['painting'] } },
  { es: 'Arte moderno', patch: { eras: ['mod'], types: ['painting'] } },
  { es: 'Siglo XIX', patch: { eras: ['s19a', 's19b'], types: ['painting'] } },
  { es: 'Paisajes', patch: { keywords: ['landscape'], types: ['painting'] } },
  { es: 'Retratos', patch: { keywords: ['portrait'], types: ['painting'] } },
  { es: 'París', patch: { keywords: ['Paris'] } },
  { es: 'Remedios Varo', patch: { artists: ['Remedios Varo'] } },
  { es: 'Surrealistas de Latinoamérica', patch: { artists: ['Remedios Varo', 'Leonora Carrington', 'Frida Kahlo', 'Wifredo Lam', 'Roberto Matta', 'Maruja Mallo', 'Alice Rahon', 'Óscar Domínguez'] } },
  { es: 'Mujeres artistas', patch: { artists: ['Artemisia Gentileschi', 'Sofonisba Anguissola', 'Judith Leyster', 'Rachel Ruysch', 'Clara Peeters', 'Angelica Kauffman', 'Élisabeth Vigée Le Brun', 'Rosa Bonheur', 'Berthe Morisot', 'Mary Cassatt', 'Suzanne Valadon', 'Hilma af Klint', 'Paula Modersohn-Becker', 'Gabriele Münter', 'Tamara de Lempicka', 'Marie Laurencin', 'Georgia O\'Keeffe', 'Frida Kahlo', 'Remedios Varo', 'Leonora Carrington', 'Lee Krasner', 'Joan Mitchell', 'Helen Frankenthaler', 'Louise Bourgeois', 'Yayoi Kusama', 'Agnes Martin'] } },
  { es: 'Los grandes maestros (cientos de artistas)', patch: { artists: [].concat(...C.ARTIST_GROUPS.map(g => g.names)).filter((n, i, a) => a.indexOf(n) === i) } },
  { es: 'Museos de un solo artista', only: C.museumIdsByTag('artist'), patch: {} },
  { es: 'Museos de México', only: C.museumIdsByTag('mx'), patch: {} },
  { es: 'Museos de Bélgica', only: C.museumIdsByTag('be'), patch: {} },
  { es: 'Surrealismo en museos', only: C.museumIdsByTag('surreal').concat(['m:open']), patch: { styles: ['surrealism'] } },
  { es: 'Museos de París', only: ['m:louvre', 'm:orsay', 'm:orangerie', 'm:versailles', 'm:marmottan', 'm:petitpalais', 'm:carnavalet'], patch: {} },
  { es: 'Grandes museos de Europa', only: ['m:louvre', 'm:orsay', 'm:prado', 'm:uffizi', 'm:hermitage', 'm:nationalgallery', 'm:vangogh', 'm:mauritshuis', 'm:kunsthistorisches', 'm:versailles'], patch: {} }
];
const ORIENT = [['any', 'Cualquiera'], ['landscape', 'Horizontal'], ['portrait', 'Vertical'], ['square', 'Cuadrada']];
const MODES = [['gallery', 'Blanco, obra lo más ancha'], ['frame', 'Con marco'], ['fill', 'Llenar (recorta)']];
const INTERVALS = [[10, '10 s'], [15, '15 s'], [30, '30 s'], [60, '1 min'], [300, '5 min'], [900, '15 min'], [3600, '1 h']];
const CAPTIONS = [['auto', 'Al cambiar de obra (25 % del tiempo)'], ['always', 'Siempre visible'], ['never', 'Oculta']];

const chip = (act, id, label, on, cls) => '<button class="chip' + (cls ? ' ' + cls : '') + '" data-act="' + act + '" data-id="' + esc(id) + '" aria-pressed="' + !!on + '">' + esc(label) + '</button>';
const opts = (list, cur) => list.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
const R = {
  presets: () => '<option value="">Elegir una colección…</option>' + PRESETS.map((p, i) => '<option value="' + i + '">' + esc(p.es) + '</option>').join(''),
  eras: () => C.ERAS.map(e => chip('era', e.id, e.es, S.f.eras.includes(e.id))).join(''),
  styles: () => C.STYLES.map(s => chip('style', s.id, s.es, S.f.styles.includes(s.id))).join(''),
  types: () => C.TYPES.map(t => chip('type', t.id, t.es, S.f.types.includes(t.id))).join(''),
  artists: () => S.f.artists.map(a => chip('rm-artist', a, a, true, 'rm')).join('') || '<span class="hint" style="font-size:14px;color:var(--muted)">Ninguno. Se muestran todos los artistas.</span>',
  artgroup: () => opts(C.ARTIST_GROUPS.map(g => [g.id, g.es + ' (' + g.names.length + ')']), S.artGroup),
  artistsug: () => ((C.ARTIST_GROUPS.find(g => g.id === S.artGroup) || C.ARTIST_GROUPS[0]).names).filter(a => !S.f.artists.some(x => C.norm(x) === C.norm(a))).map(a => chip('add-sug', a, a, false)).join('') || '<span class="hint" style="font-size:14px;color:var(--muted)">Ya elegiste todos los de este grupo.</span>',
  kws: () => C.KEYWORDS.map(k => chip('kw', k.q, k.es, S.f.keywords.includes(k.q))).join('') +
    S.f.keywords.filter(q => !C.KEYWORDS.some(k => k.q === q)).map(q => chip('kw', q, q, true, 'rm')).join(''),
  orient: () => opts(ORIENT, S.f.orientation),
  mode: () => opts(MODES, S.st.mode),
  interval: () => opts(INTERVALS, S.st.interval),
  caption: () => opts(CAPTIONS, S.st.caption),
  opts: () => chip('opt', 'kb', 'Zoom lento', S.st.kenburns) + chip('opt', 'hq', 'Imágenes en alta calidad', S.st.quality === 'high') +
    chip('opt', 'pd', 'Solo dominio público', S.f.soloPD) + chip('opt', 'favs', 'Solo mis favoritas (' + S.favs.length + ')', S.f.onlyFavs)
};
const BOX = { presets: 'c-presets', eras: 'c-eras', styles: 'c-styles', types: 'c-types', artists: 'c-artists', artgroup: 'c-artgroup', artistsug: 'c-artist-sug', kws: 'c-kws', orient: 'c-orient', mode: 'c-mode', interval: 'c-interval', caption: 'c-caption', opts: 'c-opts' };

function srcNote(s) {
  const st = S.status[s.id], base = s.place + ' · ' + s.note;
  if (!st) return base;
  if (st.state === 'error') return s.name + ' no responde: ' + st.msg + (S.detail[s.id] ? ' · ' + Object.keys(S.detail[s.id]).map(k => k + ' ' + S.detail[s.id][k]).join(' · ') : '');
  if (st.state === 'nokey') return 'Añade una clave en «Claves de API»';
  const det = S.detail[s.id] ? ' · ' + Object.keys(S.detail[s.id]).map(k => k + ' ' + S.detail[s.id][k]).join(' · ') : '';
  if (st.state === 'ok') return s.place + ' · ' + (S.counts[s.id] || 0) + ' obras cargadas' + det;
  if (st.state === 'loading') return s.place + ' · buscando…';
  if (st.state === 'empty') return s.place + ' · sin resultados con estos filtros' + det;
  return base;
}
function srcRow(s) {
  return '<button class="src" data-act="src" data-id="' + esc(s.id) + '" aria-pressed="' + !!S.f.sources[s.id] + '"><span class="box"></span><span class="nm"><b>' + esc(s.name) + '</b><span data-sn="' + esc(s.id) + '">' + esc(srcNote(s)) + '</span></span><span class="dot ' + ((S.status[s.id] && S.status[s.id].state) || '') + '" data-dot="' + esc(s.id) + '"></span></button>';
}
function visibleMuseums() { const q = C.norm(S.mfilter); return C.SOURCE_LIST.filter(s => !q || C.norm(s.name + ' ' + s.place + ' ' + (s.tags || '')).includes(q)); }
function renderSrcs() {
  $('#c-msrcs').innerHTML = visibleMuseums().map(srcRow).join('') || '<p class="hint">Ningún museo coincide. Puedes añadirlo con su nombre aquí abajo.</p>';
}
async function addMuseumByName() {
  const el = $('#museumIn'), msg = $('#museumMsg'), name = el.value.trim();
  if (!name) return;
  msg.textContent = 'Buscando «' + name + '» en Wikidata…';
  try {
    const m = await C.resolveMuseum(name), src = C.addMuseum(m);
    S.custom = S.custom.filter(x => x.id !== m.id).concat([m]); lsSet('custom', S.custom);
    S.f.sources[src.id] = true; S.mfilter = ''; $('#museumFilter').value = ''; el.value = '';
    msg.textContent = 'Añadido: ' + m.es + ' (' + m.city + ')';
    renderSrcs(); applyChange();
  } catch (e) { msg.textContent = e && e.message && !e.status ? e.message : 'No pude buscar el museo: ' + errText(e); }
}
function updateSrc(id) {
  const s = C.SOURCE_LIST.find(x => x.id === id), dot = document.querySelector('[data-dot="' + id + '"]'), sn = document.querySelector('[data-sn="' + id + '"]');
  if (dot) dot.className = 'dot ' + ((S.status[id] && S.status[id].state) || '');
  if (sn && s) sn.textContent = srcNote(s);
}
function render(name) {
  const d = $('#drawer'), a = document.activeElement;
  const key = a && a.dataset && a.dataset.act ? a.dataset.act + '|' + a.dataset.id : null;
  if (name === 'srcs') renderSrcs(); else $('#' + BOX[name]).innerHTML = R[name]();
  updateSums();
  if (key) { const el = Array.prototype.find.call(d.querySelectorAll('[data-act]'), e => e.dataset.act + '|' + e.dataset.id === key); if (el) el.focus({ preventScroll: true }); }
}
function renderAll() {
  Object.keys(BOX).forEach(k => { $('#' + BOX[k]).innerHTML = R[k](); });
  renderSrcs();
  $('#artistList').innerHTML = C.ARTIST_SUGGESTIONS.map(a => '<option value="' + esc(a) + '">').join('');
  $('#yFrom').value = S.f.yearFrom; $('#yTo').value = S.f.yearTo;
  ['europeana', 'si', 'harvard'].forEach(k => { $('#k-' + k).value = S.keys[k] || ''; });
  $('#playBtn').textContent = S.paused ? 'Reanudar' : 'Pausar'; updateFavBtn(); updateSums();
}
function openMenu() { if (S.menu) return; S.menu = true; clearTimeout(S.timer); renderAll(); $('#drawer').hidden = false; const b = $('#drawer [data-act=next]'); if (b) b.focus({ preventScroll: true }); }
function closeMenu() { if (REMOTE || !S.menu) return; S.menu = false; $('#drawer').hidden = true; schedule(); try { document.activeElement.blur(); } catch (e) { /* nada */ } }
const toggleArr = (arr, v) => { const i = arr.indexOf(v); i < 0 ? arr.push(v) : arr.splice(i, 1); };

function addArtist(name) { name = (name || '').trim(); if (!name || S.f.artists.some(a => C.norm(a) === C.norm(name))) return; S.f.artists.push(name); render('artists'); render('artistsug'); applyChange(); }
function addKeyword(text) { const q = C.keywordToQuery(text || ''); if (!q || S.f.keywords.includes(q)) return; S.f.keywords.push(q); render('kws'); applyChange(); }

function onAct(act, id) {
  const f = S.f;
  if (REMOTE && (act === 'prev' || act === 'next' || act === 'play' || act === 'fav')) { remoteCmd(act); return; }
  switch (act) {
    case 'close': if (!REMOTE) closeMenu(); break;
    case 'qr': showPair(true); closeMenu(); break;
    case 'qr-close': hidePair(); break;
    case 'rc-retry': remoteHello(true); break;
    case 'rc-update': remoteUpdate(); break;
    case 'acc': toggleAcc(id); break;
    case 'diag': diagnose(); break;
    case 'install': installApp(); break;
    case 'update': forceUpdate(); break;
    case 'diag-close': $('#diag').hidden = true; diagRun++; break;
    case 'prev': prev(); break;
    case 'next': next(); break;
    case 'play': togglePlay(); break;
    case 'fav': toggleFav(); render('opts'); break;
    case 'fs': toggleFS(); break;
    case 'reset': {
      const keep = { sources: f.sources }; S.f = Object.assign(C.defaultFilters(), keep); renderAll(); applyChange(); toast('Filtros restablecidos'); break;
    }
    case 'preset': {
      const p = PRESETS[+id]; const keep = { sources: f.sources, orientation: f.orientation, soloPD: f.soloPD };
      if (p.only) { keep.sources = {}; Object.keys(f.sources).forEach(k => { keep.sources[k] = p.only.includes(k); }); }
      S.f = Object.assign(C.defaultFilters(), keep, JSON.parse(JSON.stringify(p.patch)));
      renderAll(); applyChange(); break;
    }
    case 'src': f.sources[id] = !f.sources[id]; render('srcs'); applyChange(); break;
    case 'mus-all': case 'mus-none': visibleMuseums().forEach(x => { f.sources[x.id] = act === 'mus-all'; }); render('srcs'); applyChange(); break;
    case 'add-museum': addMuseumByName(); break;
    case 'era': toggleArr(f.eras, id); f.yearFrom = f.yearTo = ''; $('#yFrom').value = $('#yTo').value = ''; render('eras'); applyChange(); break;
    case 'style': toggleArr(f.styles, id); render('styles'); applyChange(); break;
    case 'type': toggleArr(f.types, id); render('types'); applyChange(); break;
    case 'kw': toggleArr(f.keywords, id); render('kws'); applyChange(); break;
    case 'orient': f.orientation = id; render('orient'); applyChange(); break;
    case 'add-artist': addArtist($('#artistIn').value); $('#artistIn').value = ''; break;
    case 'add-sug': addArtist(id); break;
    case 'artgroup': S.artGroup = id; render('artistsug'); break;
    case 'rm-artist': f.artists = f.artists.filter(a => a !== id); render('artists'); render('artistsug'); applyChange(); break;
    case 'add-kw': addKeyword($('#kwIn').value); $('#kwIn').value = ''; break;
    case 'mode': S.st.mode = id; applyLook(); saveAll(); render('mode'); break;
    case 'interval': S.st.interval = +id; saveAll(); render('interval'); schedule(); break;
    case 'caption': S.st.caption = id; saveAll(); render('caption'); if (S.current) setCaption(S.current); break;
    case 'opt':
      if (id === 'kb') { S.st.kenburns = !S.st.kenburns; applyLook(); saveAll(); render('opts'); }
      else if (id === 'hq') { S.st.quality = S.st.quality === 'high' ? 'normal' : 'high'; saveAll(); render('opts'); toast('Se aplicará a las próximas obras'); }
      else if (id === 'pd') { f.soloPD = !f.soloPD; render('opts'); applyChange(); }
      else if (id === 'favs') { f.onlyFavs = !f.onlyFavs; render('opts'); applyChange(); }
      break;
  }
}

/* ───────── eventos ───────── */
function activity() {
  document.body.classList.add('active'); document.body.classList.remove('idle');
  clearTimeout(S.idleT);
  S.idleT = setTimeout(() => { if (!S.menu) { document.body.classList.remove('active'); document.body.classList.add('idle'); } }, 4500);
}
const EDGE_L = 0.28, EDGE_R = 0.72;
function touchLayout() {
  try { return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || (window.innerWidth || 1024) <= 820; } catch (err) { return false; }
}
// Deslizar el dedo también cambia de obra.
let swipe = null;
document.addEventListener('touchstart', e => { const t = e.touches[0]; swipe = e.touches.length === 1 && !S.menu ? { x: t.clientX, y: t.clientY } : null; }, { passive: true });
document.addEventListener('touchend', e => {
  if (!swipe || S.menu) return;
  const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y; swipe = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) { dx < 0 ? next() : prev(); }
}, { passive: true });
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el) { onAct(el.dataset.act, el.dataset.id); return; }
  if (e.target.id === 'menuBtn') { openMenu(); return; }
  if (e.target.id === 'loaderMenu') { openMenu(); return; }
  if (e.target.id === 'loaderDiag') { diagnose(); return; }
  if (e.target.closest('#pair')) { hidePair(); return; }
  if (REMOTE) return;
  if (e.target.closest('#drawer') || e.target.closest('#diag')) return;
  if (!S.menu && touchLayout() && e.clientX != null) {
    // Como en un libro electrónico: borde derecho = siguiente, borde izquierdo = anterior, centro = menú.
    const x = e.clientX / (window.innerWidth || 1);
    if (x > EDGE_R) { next(); return; }
    if (x < EDGE_L) { prev(); return; }
  }
  S.menu ? closeMenu() : openMenu();
});
['mousemove', 'touchstart', 'pointerdown'].forEach(ev => document.addEventListener(ev, activity, { passive: true }));
document.addEventListener('keydown', e => {
  activity();
  const tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea';
  if (typing) {
    if (e.key === 'Enter') { if (e.target.id === 'artistIn') { addArtist(e.target.value); e.target.value = ''; } if (e.target.id === 'kwIn') { addKeyword(e.target.value); e.target.value = ''; } if (e.target.id === 'museumIn') addMuseumByName(); }
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  const k = e.key;
  if (!$('#diag').hidden) { if (k === 'Escape' || k === 'Backspace' || k === 'GoBack') { e.preventDefault(); onAct('diag-close'); } return; }
  if (S.menu) { if (k === 'Escape' || k === 'Backspace' || k === 'GoBack') { e.preventDefault(); closeMenu(); } return; }
  if (k === 'ArrowRight' || k === 'MediaTrackNext' || k === 'MediaFastForward') { e.preventDefault(); next(); }
  else if (k === 'ArrowLeft' || k === 'MediaTrackPrevious' || k === 'MediaRewind') { e.preventDefault(); prev(); }
  else if (k === ' ' || k === 'MediaPlayPause' || k === 'MediaPlay' || k === 'MediaPause') { e.preventDefault(); togglePlay(); }
  else if (k === 'Enter' || k === 'm' || k === 'M' || k === 'ContextMenu' || k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); openMenu(); }
  else if (k === 'f' || k === 'F') toggleFS();
  else if (k === 'i' || k === 'I') { const c = $('#caption'); c.classList.toggle('show'); clearTimeout(S.capT); }
  else if (k === 'l' || k === 'L') toggleFav();
  else if (k === 'q' || k === 'Q') showPair(true);
});
[['presets', 'preset'], ['artgroup', 'artgroup'], ['orient', 'orient'], ['mode', 'mode'], ['interval', 'interval'], ['caption', 'caption']].forEach(([box, act]) => {
  $('#' + BOX[box]).addEventListener('change', e => {
    const v = e.target.value;
    if (act === 'preset') { if (v === '') return; onAct('preset', v); e.target.value = ''; return; }
    onAct(act, v);
  });
});
$('#museumFilter').addEventListener('input', e => { S.mfilter = e.target.value; renderSrcs(); });
$('#yFrom').addEventListener('change', e => { S.f.yearFrom = e.target.value; S.f.eras = []; render('eras'); applyChange(); });
$('#yTo').addEventListener('change', e => { S.f.yearTo = e.target.value; S.f.eras = []; render('eras'); applyChange(); });
['europeana', 'si', 'harvard'].forEach(k => {
  $('#k-' + k).addEventListener('change', e => { S.keys[k] = e.target.value.trim(); saveAll(); updateSums(); if (S.f.sources[k]) applyChange(); });
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
let lock = null;
async function keepAwake() { try { if ('wakeLock' in navigator) lock = await navigator.wakeLock.request('screen'); } catch (e) { /* no disponible */ } }

/* ───────── app instalable (PWA) ───────── */
/* Borra copias guardadas y service worker, y recarga la página desde internet. */
async function forceUpdate() {
  toast('Buscando la versión más reciente…');
  try {
    if ('serviceWorker' in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); }
    if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); }
  } catch (e) { /* se recarga igualmente */ }
  location.replace(location.pathname + '?' + (REMOTE ? 'c=' + REMOTE + '&' : '') + 'r=' + Date.now());
}
let installEv = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; $('#installBtn').hidden = false; });
window.addEventListener('appinstalled', () => { installEv = null; $('#installBtn').hidden = true; toast('App instalada'); });
async function installApp() {
  if (!installEv) { toast('En iPhone: Compartir y «Añadir a pantalla de inicio»'); return; }
  installEv.prompt();
  try { await installEv.userChoice; } catch (e) { /* nada */ }
  installEv = null; $('#installBtn').hidden = true;
}
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* sin service worker la app funciona igual */ }); });
}

/* ───────── mando desde el móvil ─────────
   La TV y el móvil se hablan a través de un canal público de ntfy.sh con un código aleatorio
   (sin cuentas ni servidor propio). La TV escucha, muestra un QR con ?c=<código> y obedece. */
const RELAY = (Q.get('relay') || 'https://ntfy.sh').replace(/\/+$/, '');
const RC = { code: '', es: null, poll: null, buf: {}, listening: false, lastPhone: 0, lastNow: 0, pingT: null, helloT: null, helloN: 0, connected: false, setT: null, forceNow: false, nowT: null, sent: 0 };
const asciiJSON = o => JSON.stringify(o).replace(/[\u0080-￿]/g, c => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4));
const myTopic = () => 'galeria-arte-' + RC.code + (REMOTE ? '-ph' : '-tv');
const peerTopic = () => 'galeria-arte-' + RC.code + (REMOTE ? '-tv' : '-ph');
function newCode() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = '';
  try { const r = new Uint8Array(12); crypto.getRandomValues(r); r.forEach(n => { s += a[n % a.length]; }); } catch (e) { for (let i = 0; i < 12; i++) s += a[Math.floor(Math.random() * a.length)]; }
  return s;
}
function relaySend(obj) {
  const s = asciiJSON(obj), id = Math.random().toString(36).slice(2, 7), N = 3000, n = Math.max(1, Math.ceil(s.length / N));
  for (let i = 0; i < n; i++) {
    RC.sent++;
    try { fetch(RELAY + '/' + peerTopic(), { method: 'POST', body: id + '|' + i + '|' + n + '|' + s.slice(i * N, (i + 1) * N) }).catch(() => { /* sin red: se reintenta con la siguiente orden */ }); } catch (e) { /* fetch no disponible */ }
  }
}
function relayRecv(text, fn) {
  const m = /^([a-z0-9]+)\|(\d+)\|(\d+)\|([\s\S]*)$/.exec(text || ''); if (!m) return;
  const id = m[1], i = +m[2], n = +m[3];
  const b = RC.buf[id] || (RC.buf[id] = { n, parts: [], got: 0, t: Date.now() });
  if (b.parts[i] == null) { b.parts[i] = m[4]; b.got++; }
  Object.keys(RC.buf).forEach(k => { if (Date.now() - RC.buf[k].t > 60000) delete RC.buf[k]; });
  if (b.got < b.n) return;
  delete RC.buf[id];
  let o; try { o = JSON.parse(b.parts.join('')); } catch (e) { return; }
  if (o && typeof o === 'object') fn(o);
}
function relayListen(fn) {
  if (RC.listening || !RC.code) return; RC.listening = true;
  const url = RELAY + '/' + myTopic();
  const onData = d => { let m; try { m = typeof d === 'string' ? JSON.parse(d) : d; } catch (e) { return; } if (m && m.event === 'message') relayRecv(m.message, fn); };
  if (typeof EventSource === 'function') {
    const es = RC.es = new EventSource(url + '/sse');
    es.onmessage = e => onData(e.data);
    es.onopen = () => { RC.connected = true; if (REMOTE && !RC.helloN) remoteHello(); };
    es.onerror = () => { RC.connected = false; };
  } else {
    // Navegadores sin EventSource: se consulta cada 3 s.
    let since = String(Math.floor(Date.now() / 1000)); RC.connected = true; if (REMOTE) remoteHello();
    RC.poll = setInterval(async () => {
      try {
        const r = await fetch(url + '/json?poll=1&since=' + since); const t = await r.text();
        t.split('\n').forEach(l => { if (!l.trim()) return; let m; try { m = JSON.parse(l); } catch (e) { return; } if (m.id) since = m.id; onData(m); });
      } catch (e) { /* se reintenta */ }
    }, 3000);
  }
}

/* — lado TV — */
function buildVer() { const v = document.querySelector('.ver'); const m = v && /Versión\s+(\w+)/.exec(v.textContent); return m ? m[1] : ''; }
function tvState() { return { t: 'state', f: S.f, st: S.st, custom: S.custom, paused: S.paused, now: tvNow(), ver: buildVer() }; }
function tvNow() {
  const w = S.current; if (!w) return null;
  return { uid: w.uid, title: w.title, artist: w.artist, date: w.date, museum: w.museum, thumb: w.thumb || w.url, fav: isFav(w), paused: S.paused };
}
// Con un móvil conectado la TV le cuenta cada obra nueva (como mucho una cada 8 s) para no agotar el límite diario de ntfy.
function tvNowSoon(force) {
  if (REMOTE || !RC.code || !RC.lastPhone) return;
  if (force) RC.forceNow = true;
  if (Date.now() - RC.lastPhone > 240000) return;
  clearTimeout(RC.nowT);
  const wait = RC.forceNow ? 120 : Math.max(300, 8000 - (Date.now() - RC.lastNow));
  RC.nowT = setTimeout(() => { RC.forceNow = false; RC.lastNow = Date.now(); relaySend({ t: 'now', now: tvNow() }); }, wait);
}
function tvHandle(m) {
  if (m.t === 'hello' || m.t === 'ping' || m.t === 'cmd' || m.t === 'set') {
    RC.lastPhone = Date.now(); lsSet('paired', true); hidePair();
  }
  if (m.t === 'hello') { relaySend(tvState()); return; }
  if (m.t === 'ping') { RC.forceNow = true; tvNowSoon(); return; }
  if (m.t === 'cmd') {
    RC.forceNow = true;
    if (m.c === 'update') { forceUpdate(); return; }
    if (m.c === 'next') next(); else if (m.c === 'prev') prev(); else if (m.c === 'play') togglePlay(); else if (m.c === 'fav') toggleFav();
    return;
  }
  if (m.t === 'set' && m.f) {
    const before = JSON.stringify(S.f);
    (m.custom || []).forEach(c => { if (c && c.id && !S.custom.some(x => x.id === c.id)) { try { C.addMuseum(c); S.custom.push(c); lsSet('custom', S.custom); } catch (e) { /* museo dañado */ } } });
    S.f = normFilters(m.f);
    if (m.st && typeof m.st === 'object') S.st = Object.assign(S.st, m.st);
    applyLook();
    if (JSON.stringify(S.f) !== before) applyChange(); else { saveAll(); schedule(); }
    if (S.menu) renderAll();
    toast('Ajustes cambiados desde el móvil');
    relaySend(tvState());
  }
}
function pairUrl() { return location.origin + location.pathname + '?c=' + RC.code; }
function showPair(manual) {
  if (REMOTE || !/^https?:$/.test(location.protocol)) { if (manual) toast('El mando necesita abrir la galería desde su dirección https'); return; }
  if (!RC.code) { RC.code = lsGet('rc', '') || newCode(); lsSet('rc', RC.code); }
  relayListen(tvHandle);
  const url = pairUrl();
  try { const q = qrcode(0, 'M'); q.addData(url); q.make(); $('#pairQR').innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { $('#pairQR').textContent = ''; }
  $('#pairUrl').textContent = url.replace(/^https?:\/\//, '');
  $('#pair').hidden = false;
  clearTimeout(RC.hideT); RC.hideT = setTimeout(hidePair, manual ? 120000 : (lsGet('paired', false) ? 20000 : 150000));
}
function hidePair() { const p = $('#pair'); if (p) p.hidden = true; clearTimeout(RC.hideT); }
function initTV() {
  if (Q.get('tv') === '0') return;
  if (Q.get('tv') === '1' || (window.innerWidth || 1024) > 820) setTimeout(() => showPair(false), 1500);
}

/* — lado móvil — */
function remoteStat(text, ok, retry) { const s = $('#rcstat'); s.textContent = text; s.classList.toggle('ok', !!ok); $('#rcRetry').hidden = !retry; }
function remoteNow(n) {
  if (!n) return;
  S.current = { uid: n.uid }; S.favs = n.fav ? [{ uid: n.uid }] : []; S.paused = !!n.paused;
  $('#rcnow').hidden = false; $('#rcT').textContent = n.title || ''; $('#rcA').textContent = [n.artist, n.date].filter(Boolean).join(' · ');
  const im = $('#rcImg'); if (n.thumb && im.dataset.u !== n.thumb) { im.dataset.u = n.thumb; im.src = n.thumb; }
  $('#playBtn').textContent = S.paused ? 'Reanudar' : 'Pausar'; updateFavBtn();
}
function remoteVer(tvVer) { $('#rcver').textContent = 'Versión de la TV: ' + (tvVer || '—') + ' · de este móvil: ' + (buildVer() || '—'); }
function remoteUpdate() {
  if (!RC.gotState) { toast('Todavía no hay conexión con la TV'); return; }
  relaySend({ t: 'cmd', c: 'update' });
  remoteStat('Actualizando la TV… este móvil se actualizará en unos segundos.', true, false);
  setTimeout(forceUpdate, 20000);
}
function remoteHello(again) {
  if (again) RC.helloN = 0;
  clearTimeout(RC.helloT);
  if (RC.gotState) return;
  if (RC.helloN >= 10) { remoteStat('No encuentro la TV. Comprueba que tiene abierta la galería y que ambos tenéis internet.', false, true); return; }
  RC.helloN++; relaySend({ t: 'hello' });
  remoteStat('Conectando con la TV…', false, false);
  RC.helloT = setTimeout(() => remoteHello(false), Math.min(60000, 3000 * Math.pow(2, RC.helloN - 1)));
}
function remoteHandle(m) {
  if (m.t === 'state' && m.f) {
    RC.gotState = true; clearTimeout(RC.helloT);
    (m.custom || []).forEach(c => { try { if (c && c.id) { C.addMuseum(c); if (!S.custom.some(x => x.id === c.id)) S.custom.push(c); } } catch (e) { /* museo dañado */ } });
    S.f = normFilters(m.f); if (m.st) S.st = Object.assign(S.st, m.st);
    renderAll(); remoteNow(m.now); remoteVer(m.ver);
    remoteStat('Conectado a la TV. Lo que cambies aquí se aplica en la pantalla.', true, false);
  } else if (m.t === 'now') { remoteNow(m.now); if (!RC.gotState) remoteHello(true); }
}
function remoteCmd(c) {
  if (!RC.gotState) { toast('Todavía no hay conexión con la TV'); return; }
  relaySend({ t: 'cmd', c });
  toast(c === 'next' ? 'Siguiente obra…' : c === 'prev' ? 'Obra anterior…' : c === 'play' ? 'Pausa / reanudar…' : 'Favorita…');
}
function remoteSetSoon() {
  if (!REMOTE) return;
  clearTimeout(RC.setT);
  RC.setT = setTimeout(() => { relaySend({ t: 'set', f: S.f, st: S.st, custom: S.custom }); toast('Enviado a la TV'); }, 900);
}
function initRemote() {
  RC.code = REMOTE; lsSet('rc', REMOTE);
  document.body.classList.add('rc');
  S.menu = true; applyLook(); renderAll();
  $('#rcinfo').hidden = false; $('#rcfoot').hidden = false; $('#drawer').hidden = false; remoteVer('');
  document.title = 'Mando · Galería de arte';
  remoteStat('Conectando con la TV…', false, false);
  relayListen(remoteHandle);
  RC.pingT = setInterval(() => { if (document.visibilityState === 'visible' && RC.gotState) relaySend({ t: 'ping' }); }, 90000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && RC.gotState) relaySend({ t: 'ping' }); });
}

/* ───────── inicio ───────── */
function init() {
  if (REMOTE) { initRemote(); return; }
  applyLook(); renderAll(); activity(); keepAwake();
  document.body.classList.add('active');
  if (touchLayout() && !lsGet('tapHint', false)) { lsSet('tapHint', true); setTimeout(() => toast('Toca el borde derecho: siguiente · el izquierdo: anterior · el centro: menú'), 2500); }
  showLoader('Buscando obras en los museos…', 'Pulsa Intro o toca la pantalla para abrir los filtros.', false);
  advance();
  initTV();
}
window.ArtApp = { S, next, prev, advance, openMenu, closeMenu, refill, onAct, render, renderAll, applyChange, present, pullNext, captionMs, Remote: () => RC };
init();
})();
