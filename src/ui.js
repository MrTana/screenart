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
function lsSet(k, v) { if (REMOTE && !['rskin', 'upd', 'rc', 'idkeys', 'keys', 'keysent', 'favs', 'favdel', 'keyt', 'cloudv', 'cloudsent'].includes(k)) return; // el mando solo guarda su código y lo que comparte con la versión móvil (claves y favoritas)
   try { localStorage.setItem(KEY + ':' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }

/* ───────── estado ───────── */
function loadFilters() { return normFilters(lsGet('f', {})); }
function normFilters(s) {
  const d = C.defaultFilters(), dsrc = Object.assign({}, d.sources);
  s = s && typeof s === 'object' ? s : {};
  const f = Object.assign(d, s);
  f.sources = Object.assign({}, dsrc, s.sources || {});
  ['eras', 'styles', 'types', 'artists', 'keywords', 'exclude', 'noWords'].forEach(k => { if (!Array.isArray(f[k])) f[k] = []; });
  f.types = []; // ya no hay selector de tipo: nunca se filtra por él (las esculturas y objetos 3D se descartan siempre)
  return f;
}
const S = {
  f: loadFilters(),
  st: Object.assign({ interval: 30, mode: 'gallery', quality: 'normal', kenburns: false, caption: 'def', skin: 'm3-dark' }, lsGet('st', {})),
  keys: Object.assign({ europeana: 'api2demo', si: 'DEMO_KEY', harvard: '' }, lsGet('keys', {})),
  favs: lsGet('favs', []),
  pool: [], seen: new Set(), seenKey: new Set(), hist: [], hi: -1,
  paused: false, menu: false, epoch: 0, refilling: 0, adv: false, advAt: 0, flight: new Map(), cool: {}, streak: {}, warned: false, recycleAfter: 6000, artGroup: 'impressionism', mfilter: '', detail: {}, acc: null,
  status: {}, counts: {}, layer: 0, nextP: null, nextEpoch: -1,
  timer: null, capT: null, idleT: null, waiters: [], current: null, shown: 0
};
function saveAll() { if (REMOTE) { remoteSetSoon(); return; } lsSet('f', S.f); lsSet('st', S.st); lsSet('keys', S.keys); lsSet('favs', S.favs.slice(0, 300)); }

if (S.st.capv !== 2) { S.st.capv = 2; if (S.st.caption === 'auto') S.st.caption = 'def'; } // la ficha ahora es «predeterminada» (móvil: siempre; TV: al inicio)
S.custom = lsGet('custom', []);
S.custom.forEach(m => { try { C.addMuseum(m); } catch (e) { /* museo dañado */ } });
const slides = [$('#slideA'), $('#slideB')];
const wkey = w => C.norm(w.title) + '|' + C.norm(w.artist);

/* ───────── avisos ───────── */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }
/* «Buscando obras…»: solo con el menú abierto y en el mando; sobre la obra no aparece nunca (no estorba al ver la pintura).
   En el mando se sabe por el estado de los museos que manda la TV. */
function busy() {
  const loading = REMOTE ? Object.keys(S.status).some(k => S.status[k].state === 'loading') : S.refilling > 0;
  const el = $('#busy'); el.textContent = 'Buscando obras…'; el.classList.toggle('on', loading && (S.menu || !!REMOTE));
}
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
/* Ancho de imagen a pedir: el lado largo de la pantalla en píxeles reales, redondeado a 1280 o 1920 (3840 en alta calidad). */
function screenPx() {
  if (S.st.quality === 'high') return 3840;
  let need = 1920;
  try { const sc = window.screen || {}; need = Math.max(sc.width || 0, sc.height || 0, window.innerWidth || 0, window.innerHeight || 0) * (window.devicePixelRatio || 1); } catch (e) { /* sin datos de pantalla */ }
  return need && need <= 1280 ? 1280 : 1920;
}
function ctx() { return { hq: S.st.quality === 'high', px: screenPx(), keys: S.keys, anyRights: !S.f.soloPD }; }
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
  updateSrc(id); scheduleResort(); tvSrcsSoon(); sweepInfoSoon();
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
  // Los que aún no se consultaron van en el orden del barrido (el mismo en que se precalcularon sus conteos); luego, al azar.
  const fresh0 = byOrder(others.filter(s => !S.status[s.id])), tried = C.sampleN(others.filter(s => S.status[s.id]), room);
  wa.slice(0, room).concat(fresh0.concat(tried).slice(0, Math.max(0, room - wa.length))).forEach(s => launch(s, epoch));
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
  setTimeout(() => { if (epoch === S.epoch) sweep(); }, 500);
}
/* Barrido: aunque ya haya obras de sobra, cada museo seleccionado se consulta al menos una vez (4 a la vez), para que todos
   aporten variedad y su color de estado sea real. Después solo se rellena cuando la cola baja. */
/* Orden del barrido: se fija al empezar (al azar) y con él se precalculan en lote los conteos de Wikidata, en el mismo
   orden en que se van a consultar los museos: el primer lote sirve a los primeros museos. */
function planSweep() {
  if (REMOTE || S.f.onlyFavs) return;
  const list = C.shuffle(C.SOURCE_LIST.filter(s => S.f.sources[s.id]));
  S.sweepOrder = new Map(list.map((s, i) => [s.id, i]));
  C.primeWikidataCounts(list, S.f, ctx()).catch(() => {});
}
function byOrder(l) { const o = S.sweepOrder || new Map(), p = s => (o.has(s.id) ? o.get(s.id) : 1e9); return l.slice().sort((a, b) => p(a) - p(b)); }
function sweep() {
  if (S.f.onlyFavs) return;
  const room = Math.max(0, 4 - S.flight.size); if (!room) return;
  const todo = C.SOURCE_LIST.filter(s => S.f.sources[s.id] && !S.status[s.id] && !S.flight.has(s.id));
  byOrder(todo).slice(0, room).forEach(s => launch(s, S.epoch));
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
      const t = setTimeout(() => { im.onload = im.onerror = null; fin(false); }, 9000); // una imagen que no responde en 9 s se salta
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

async function pullNext(maxMs) {
  const epoch = S.epoch, t0 = Date.now();
  let idleSince = 0;
  while (Date.now() - t0 < (maxMs || 40000)) {
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
      const good = r && r.w >= 300 && r.h >= 300 && orientOK(r.w, r.h);
      if (!good) S.seen.add(w.uid); // imagen rota o que no encaja: cuenta como vista en esta vuelta y no se reintenta sin fin
      return good ? { w, r } : null;
    }));
    if (epoch !== S.epoch) return null;
    const ok = res.filter(Boolean);
    if (!ok.length) continue;
    ok.slice(1).reverse().forEach(x => S.pool.unshift(x.w));
    const w = ok[0].w, r = ok[0].r;
    S.seen.add(w.uid); S.seenKey.add(wkey(w));
    if (S.seen.size > 3000) { S.seen.clear(); S.seenKey.clear(); }
    return Object.assign({}, w, { url: r.url, url_page: w.url, iw: r.w, ih: r.h });
  }
  return null;
}

/* ───────── escenario ───────── */
function isFav(w) { return !!w && S.favs.some(x => x.uid === w.uid); }
/* Ficha «predeterminada»: en un móvil/tableta (sin TV conectada) siempre visible; en la TV, al inicio de cada obra. */
function capMode() { const c = S.st.caption; return c === 'def' || !c ? (touchLayout() ? 'always' : 'auto') : c; }
function captionMs() { const s = +S.st.interval || 30; return (s >= 1800 ? 300 : s * 0.25) * 1000; }
function setCaption(w) {
  const c = $('#caption');
  c.querySelector('.t').textContent = w.title;
  c.querySelector('.m').textContent = [C.cleanName(w.artist), w.date || w.year].filter(Boolean).join(' · ');
  c.querySelector('.s').textContent = w.museum || '';
  clearTimeout(S.capT);
  const cm = capMode();
  if (cm === 'never') { c.classList.remove('show'); return; }
  c.classList.add('show');
  // La ficha dura el 25 % del tiempo de la obra; con 30 min o más, 5 min como máximo.
  if (cm === 'auto') S.capT = setTimeout(() => c.classList.remove('show'), captionMs());
}
/* Con cartela: si la obra no es claramente horizontal (menos de 1,25:1) se cuelga a un lado con su cartela al otro, alternando lados. */
function isTall(item, img) { const w = item.iw || (img && img.naturalWidth), h = item.ih || (img && img.naturalHeight); return !!(w && h && w / h < 1.25); }
function layoutSlide(s, item) {
  const img = s.querySelector('img'), plate = s.querySelector('.plate');
  plate.querySelector('.pt').textContent = item.title || '';
  plate.querySelector('.pm').textContent = [C.cleanName(item.artist), item.date || item.year].filter(Boolean).join(' · ');
  plate.querySelector('.ps').textContent = item.museum || '';
  S.side = !S.side;
  const apply = () => {
    const tall = S.st.mode === 'plate' && isTall(item, img) && (window.innerWidth || 0) > (window.innerHeight || 0) * 1.1; // en pantallas verticales (móvil) no hay sitio al lado
    s.classList.toggle('tall', tall); s.classList.toggle('alt', tall && S.side); s.classList.toggle('noplate', capMode() === 'never');
    if (s === slides[S.layer]) document.body.classList.toggle('plate-on', tall && capMode() !== 'never');
  };
  apply();
  if (!item.iw) img.onload = () => { img.onload = null; apply(); };
}
function present(item, fromHist) {
  const nxt = 1 - S.layer, s = slides[nxt];
  s.querySelector('img').src = item.url;
  s.querySelector('img').alt = item.title + (item.artist ? ', ' + item.artist : '');
  s.querySelector('.bg').style.backgroundImage = 'url("' + item.url.replace(/"/g, '%22') + '")';
  layoutSlide(s, item);
  s.classList.remove('on'); void s.offsetWidth; s.classList.add('on');
  slides[S.layer].classList.remove('on'); S.layer = nxt;
  document.body.classList.toggle('plate-on', s.classList.contains('tall') && !s.classList.contains('noplate'));
  $('#loader').hidden = true;
  if (!fromHist) { S.hist.push(item); if (S.hist.length > 120) S.hist.shift(); S.hi = S.hist.length - 1; }
  S.current = item; S.shown++; saveStashSoon();
  setCaption(item); updateFavBtn();
  tvNowSoon();
}
function schedule() {
  clearTimeout(S.timer);
  document.documentElement.style.setProperty('--dur', S.st.interval + 's');
  if (S.paused || S.menu) return;
  S.timer = setTimeout(() => { if (!applyUpdate()) next(); }, S.st.interval * 1000);
}
async function advance() {
  if (S.adv && Date.now() - S.advAt < 90000) return;
  const epoch = S.epoch;
  S.adv = true; S.advAt = Date.now(); clearTimeout(S.timer);
  try {
    let item = null;
    let waited = false;
    if (S.nextP && S.nextEpoch === S.epoch) { item = await S.nextP; waited = true; }
    S.nextP = null; S.ready = null;
    if (epoch !== S.epoch) return;
    if (!item) item = await pullNext(waited ? 8000 : 40000); // si la precarga ya esperó, no se espera otros 40 s
    if (epoch !== S.epoch) return;
    if (!item) {
      // Sin obras nuevas: se repite una ya vista para que la pantalla nunca se quede parada.
      const old = S.hist.filter(w => !S.current || w.uid !== S.current.uid);
      if (old.length) { present(C.pick(old), true); toast('Repitiendo obras ya vistas: las fuentes no dan más por ahora'); prefetch(); return; }
      showEmpty(); return;
    }
    present(item, false);
    prefetch();
  } finally { if (epoch === S.epoch) { S.adv = false; schedule(); } }
}
/* Arranque instantáneo: se guardan en el dispositivo la próxima obra ya comprobada, la cola de obras pendientes y lo ya visto.
   Al abrir con los mismos filtros, la primera obra sale de ahí (y su imagen suele estar en la caché del navegador) mientras los
   museos se consultan en segundo plano. Con otros filtros, o pasada una semana, se ignora. */
const STASH_MAX = 40, STASH_TTL = 7 * 864e5;
function filterSig(f) { // firma estable (claves ordenadas): la misma en la TV y en el mando
  const st = v => Array.isArray(v) ? '[' + v.map(st).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + st(v[k])).join(',') + '}' : JSON.stringify(v === undefined ? null : v);
  return st(slimF(f));
}
function prefetch() {
  const ep = S.epoch; S.nextEpoch = ep; S.ready = null;
  S.nextP = pullNext().then(it => { if (ep === S.epoch) { S.ready = it; saveStashSoon(); } return it; });
}
function saveStash() {
  if (REMOTE || S.f.onlyFavs) return;
  clearTimeout(S.stashT); S.stashT = 0;
  const r = S.ready, first = r ? [Object.assign({}, r, { imgs: [r.url].concat((r.imgs || []).filter(u => u !== r.url)), url: r.url_page || r.url })] : [];
  const works = first.concat(S.pool.slice(0, STASH_MAX)).map(slimWork).filter(okWork).slice(0, STASH_MAX);
  const pending = new Set(works.map(w => w.uid)); // la próxima obra ya cuenta como vista en memoria, pero aún no se ha mostrado
  const seen = Array.from(S.seen).filter(u => !pending.has(u)).slice(-500).concat(S.current && !S.seen.has(S.current.uid) ? [S.current.uid] : []);
  if (works.length) lsSet('stash', { sig: filterSig(S.f), at: Date.now(), works, seen });
}
function saveStashSoon() { if (!S.stashT) S.stashT = setTimeout(saveStash, 3000); }
function loadStash() {
  if (REMOTE || S.f.onlyFavs) return 0;
  const st = lsGet('stash', null);
  if (!st || st.sig !== filterSig(S.f) || !(Date.now() - st.at < STASH_TTL)) return 0;
  (Array.isArray(st.seen) ? st.seen : []).forEach(u => { if (typeof u === 'string') S.seen.add(u); });
  const list = (Array.isArray(st.works) ? st.works : []).filter(okWork).filter(w => !S.seen.has(w.uid));
  list.forEach(w => S.seenKey.delete(wkey(w)));
  S.pool = list.concat(S.pool);
  return list.length;
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
  if (isFav(w)) { S.favs = S.favs.filter(x => x.uid !== w.uid); favDel(w.uid); toast('Quitada de favoritas'); }
  else { S.favs.unshift({ ft: Date.now(), uid: w.uid, src: w.src, museum: w.museum, title: w.title, artist: w.artist, date: w.date, year: w.year, imgs: [w.url].concat(w.imgs.filter(u => u !== w.url)), thumb: w.thumb, url: w.url_page || w.url, type: w.type, pd: w.pd, license: w.license, w: w.w, h: w.h }); toast('Guardada en favoritas'); }
  saveAll(); updateFavBtn(); render('presets'); render('opts'); tvNowSoon(true);
  tvFavPush(w, isFav(w)); cloudSyncSoon();
}
function updateFavBtn() { $('#favBtn').textContent = (REMOTE ? !!S.nowFav : isFav(S.current)) ? 'Quitar favorita' : 'Guardar favorita'; }
function toggleFS() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => toast('Este navegador no permite pantalla completa'));
  } catch (e) { toast('Este navegador no permite pantalla completa'); }
}
function applyLook() {
  $('#stage').className = 'mode-' + S.st.mode + (S.st.kenburns ? ' kb' : '');
  document.body.dataset.mode = S.st.mode;
  const sk = SKIN_BAR[S.st.skin] ? S.st.skin : 'm3-dark';
  document.documentElement.dataset.skin = sk;
  try { const m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', SKIN_BAR[sk]); } catch (e) { /* sin meta */ }
  document.documentElement.style.setProperty('--dur', S.st.interval + 's');
}


/* ───────── diagnóstico ───────── */
function describeFilters() {
  const f = S.f, nm = (list, arr, k) => arr.map(id => { const x = list.find(y => y.id === id); return x ? x.es : id; }).join(', ');
  const parts = [];
  if (f.styles.length) parts.push('estilo: ' + nm(C.STYLES, f.styles));
  if (f.eras.length) parts.push('época: ' + nm(C.ERAS, f.eras));
  if (f.yearFrom || f.yearTo) parts.push('años: ' + (f.yearFrom || '…') + ' a ' + (f.yearTo || '…'));
  if (f.artists.length) parts.push('artistas: ' + f.artists.join(', '));
  if (f.keywords.length) parts.push('tema: ' + f.keywords.join(', '));
  if (f.exclude.length || f.noWords.length) parts.push('sin: ' + f.exclude.concat(f.noWords).join(', '));
  if (f.orientation !== 'any') parts.push('formato: ' + f.orientation);
  if (f.soloPD) parts.push('solo dominio público');
  return parts.length ? parts.join(' · ') : 'sin filtros';
}
let diagRun = 0;
async function diagnose(quiet) {
  const run = ++diagRun, f = S.f, box = $('#diag'), out = $('#diagOut');
  box.hidden = !!quiet; // desde el mando la TV no tapa la obra: el informe viaja al móvil
  const srcs = C.SOURCE_LIST.filter(s => f.sources[s.id]);
  const lines = {};
  let health = '';
  fetch('data/health.json?v=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(h => {
    if (!h || !h.results) return;
    const bad = Object.keys(h.results).filter(k => !h.results[k].ok);
    health = 'Prueba diaria de fuentes (' + h.at + '): ' + h.ok + ' de ' + h.total + ' funcionan' + (bad.length ? ' · fallan: ' + bad.map(k => k + ' (' + (h.results[k].err || 'error') + ')').join(', ') : '') + '\n';
    draw(lastDone);
  }).catch(() => { /* sin informe diario */ });
  let lastDone = false;
  const draw = (done) => {
    lastDone = done;
    out.textContent = health + 'Filtros: ' + describeFilters() + '\n' + (done ? 'Listo.' : 'Probando ' + srcs.length + ' museos (Wikidata tarda; puede llevar un par de minutos)…') + '\n\n' +
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
  saveAll(); render('presets');
  if (REMOTE) return;
  clearTimeout(applyT);
  applyT = setTimeout(() => {
    S.epoch++; S.pool = []; S.nextP = null; S.ready = null; S.flight = new Map(); S.cool = {}; S.streak = {}; S.warned = false; S.adv = false; S.counts = {}; S.status = {};
    renderSrcs(); planSweep();
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
    case 'artistas': return f.artists.length ? j(f.artists) : 'Todos los artistas';
    case 'titulo': return S.tres && S.tres.length ? S.tres.length + ' resultados' : 'Escribe el nombre de una pintura';
    case 'skin': return (SKINS.find(x => x[0] === S.st.skin) || SKINS[0])[1];
    case 'noquiero': { const n = f.exclude.map(id => (C.EXCLUDES.find(x => x.id === id) || { es: id }).es).concat(f.noWords); return n.length ? j(n) : 'Nada excluido'; }
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
/* Colecciones rápidas: una por país con museos («Museos de México», «Museos de España»…), generadas a partir de los museos que
   hay (incluidos los que se añaden desde el menú), más «Museos de París». */
/* Colecciones por estilo o movimiento según las pinturas favoritas: p. ej. con una favorita surrealista aparece «Surrealismo». Al elegirla se
   activan todos los museos y las colecciones abiertas, y solo cambia el filtro de estilo (los demás filtros se quedan como están). */
const hasKey = k => REMOTE ? !!(S.tvKeyset || {})[k] : !!S.keys[k]; // en el mando, las claves están en la TV
function favStyleIds() {
  if (REMOTE) return S.tvFavStyles || [];
  const ids = []; S.favs.forEach(w => C.styleIdsOf(w).forEach(id => { if (!ids.includes(id)) ids.push(id); }));
  return ids;
}
function currentPreset() { return S.st.preset && S.st.presetSig === filterSig(S.f) ? S.st.preset : ''; }
function presetList() {
  return [{ key: 'todo', es: 'Todo el arte' }, { key: 'favs', es: 'Mis favoritas (' + S.favs.length + ')', favs: true }].concat(C.QUICK_COLLECTIONS);
}
const ORIENT = [['any', 'Cualquiera'], ['landscape', 'Horizontal'], ['portrait', 'Vertical'], ['square', 'Cuadrada']];
const MODES = [['gallery', 'Obra completa'], ['plate', 'Con cartela (verticales a un lado)'], ['frame', 'Con marco'], ['fill', 'Llenar (recorta)']];
const INTERVALS = [[10, '10 s'], [15, '15 s'], [30, '30 s'], [60, '1 min'], [300, '5 min'], [900, '15 min'], [3600, '1 h']];
const SKINS = [['m3-dark', 'Material 3 oscuro'], ['m3-light', 'Material 3 claro'], ['m3e-dark', 'Material 3 Expressive oscuro'], ['m3e-light', 'Material 3 Expressive claro']];
const SKIN_BAR = { 'm3-dark': '#141218', 'm3-light': '#FEF7FF', 'm3e-dark': '#15101C', 'm3e-light': '#FFF7FF' };
const CAPTIONS = [['def', 'Predeterminada (móvil: siempre visible; con TV: al inicio)'], ['auto', 'Al inicio de cada obra'], ['always', 'Siempre visible'], ['never', 'Oculta']];

const chip = (act, id, label, on, cls) => '<button class="chip' + (cls ? ' ' + cls : '') + '" data-act="' + act + '" data-id="' + esc(id) + '" aria-pressed="' + !!on + '">' + esc(label) + '</button>';
const opts = (list, cur) => list.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
const R = {
  // La colección elegida sigue marcada mientras no se toque ningún filtro; si se cambia alguno, pasa a «Filtros a tu gusto».
  presets: () => { const cur = currentPreset(); return '<option value=""' + (cur ? '' : ' selected') + '>' + (S.st.preset && !cur ? 'Filtros a tu gusto' : 'Elegir una colección…') + '</option>' + presetList().map((p, i, l) => { const g = i < 2 ? '' : (p.g || 'Movimientos'), pg = i < 3 ? '' : (l[i - 1].g || 'Movimientos'); return (g && g !== pg ? (i > 2 ? '</optgroup>' : '') + '<optgroup label="' + esc(g) + '">' : '') + '<option value="' + esc(p.key) + '"' + (p.key === cur ? ' selected' : '') + '>' + esc(p.es) + '</option>' + (i === l.length - 1 && g ? '</optgroup>' : ''); }).join(''); },
  eras: () => C.ERAS.map(e => chip('era', e.id, e.es, S.f.eras.includes(e.id))).join(''),
  styles: () => C.STYLES.map(s => chip('style', s.id, s.es, S.f.styles.includes(s.id))).join(''),
  artists: () => S.f.artists.map(a => chip('rm-artist', a, a, true, 'rm')).join('') || '<span class="hint" style="font-size:14px;color:var(--muted)">Ninguno. Se muestran todos los artistas.</span>',
  artgroup: () => opts(C.ARTIST_GROUPS.map(g => [g.id, g.es + ' (' + g.names.length + ')']), S.artGroup),
  artistsug: () => ((C.ARTIST_GROUPS.find(g => g.id === S.artGroup) || C.ARTIST_GROUPS[0]).names).filter(a => !S.f.artists.some(x => C.norm(x) === C.norm(a))).map(a => chip('add-sug', a, a, false)).join('') || '<span class="hint" style="font-size:14px;color:var(--muted)">Ya elegiste todos los de este grupo.</span>',
  excl: () => C.EXCLUDES.map(e => chip('ex', e.id, e.es, S.f.exclude.includes(e.id))).join(''),
  exwords: () => S.f.noWords.map(w => chip('rm-exw', w, w, true, 'rm')).join(''),
  kws: () => C.KEYWORDS.map(k => chip('kw', k.q, k.es, S.f.keywords.includes(k.q))).join('') +
    S.f.keywords.filter(q => !C.KEYWORDS.some(k => k.q === q)).map(q => chip('kw', q, q, true, 'rm')).join(''),
  orient: () => opts(ORIENT, S.f.orientation),
  mode: () => opts(MODES, S.st.mode),
  interval: () => opts(INTERVALS, S.st.interval),
  caption: () => opts(CAPTIONS, S.st.caption),
  skin: () => opts(SKINS, S.st.skin),
  opts: () => chip('opt', 'kb', 'Zoom lento', S.st.kenburns) + chip('opt', 'hq', 'Imágenes en alta calidad', S.st.quality === 'high') +
    chip('opt', 'pd', 'Solo dominio público', S.f.soloPD) + chip('opt', 'favs', 'Solo mis favoritas (' + S.favs.length + ')', S.f.onlyFavs)
};
const BOX = { presets: 'c-presets', eras: 'c-eras', styles: 'c-styles', artists: 'c-artists', artgroup: 'c-artgroup', artistsug: 'c-artist-sug', kws: 'c-kws', excl: 'c-excl', exwords: 'c-exwords', orient: 'c-orient', mode: 'c-mode', interval: 'c-interval', caption: 'c-caption', skin: 'c-skin', opts: 'c-opts' };

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
/* Orden de la lista de museos: primero los que ya respondieron (verde), luego los que están buscando o vacíos (amarillo), después los que
   no están seleccionados y al final los que fallaron (rojo). El orden se congela y solo se recalcula al abrir el menú, al cambiar de colección
   o cuando pasa un momento sin que la persona toque la lista (para que las filas no salten bajo el dedo o el mando). */
function srcRank(s) {
  if (!S.f.sources[s.id]) return 2;
  const st = S.status[s.id] && S.status[s.id].state;
  return st === 'ok' ? 0 : (st === 'error' || st === 'nokey') ? 3 : 1;
}
function resortMuseums() {
  const l = C.SOURCE_LIST.map((s, i) => ({ id: s.id, i, r: srcRank(s) })).sort((a, b) => a.r - b.r || a.i - b.i);
  S.order = new Map(l.map((x, k) => [x.id, k]));
}
function visibleMuseums() {
  const q = C.norm(S.mfilter); if (!S.order) resortMuseums();
  const pos = s => S.order.has(s.id) ? S.order.get(s.id) : -1; // un museo recién añadido va arriba
  return C.SOURCE_LIST.filter(s => !q || C.norm(s.name + ' ' + s.place + ' ' + (s.tags || '')).includes(q)).sort((a, b) => pos(a) - pos(b));
}
let touchAt = 0, resortTimer = 0;
function scheduleResort() {
  if (!S.menu) { S.order = null; return; }
  if (resortTimer) return; // como máximo un reordenamiento cada ~1,2 s mientras llegan resultados
  resortTimer = setTimeout(function tick() {
    resortTimer = 0;
    if (!S.menu) { S.order = null; return; }
    if (Date.now() - touchAt < 1500) { resortTimer = setTimeout(tick, 800); return; }
    const before = S.order ? Array.from(S.order.keys()).join() : '';
    resortMuseums();
    if (Array.from(S.order.keys()).join() !== before) renderSrcs();
  }, 1200);
}
/* Lista ligera: se pintan 40 museos y el resto bajo demanda (al llegar al final con el dedo o el mando, o con el botón). */
const SRC_PAGE = 40;
let srcIO = null;
function renderSrcs(reset) {
  if (reset || !S.srcShown) S.srcShown = SRC_PAGE;
  const l = visibleMuseums(), n = Math.min(l.length, S.srcShown), rest = l.length - n;
  $('#c-msrcs').innerHTML = (l.slice(0, n).map(srcRow).join('') || '<p class="hint">Ningún museo coincide. Puedes añadirlo con su nombre aquí abajo.</p>') +
    (rest > 0 ? '<button class="btn out more" data-act="src-more" style="width:100%;margin-top:6px">Mostrar ' + Math.min(SRC_PAGE, rest) + ' museos más (quedan ' + rest + ')</button>' : '');
  sweepInfo();
  try {
    if (srcIO) srcIO.disconnect();
    const more = $('#c-msrcs .more');
    if (more && typeof IntersectionObserver === 'function') { srcIO = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) moreSrcs(false); }, { rootMargin: '200px' }); srcIO.observe(more); }
  } catch (e) { /* sin IntersectionObserver: queda el botón */ }
}
function moreSrcs(focus) {
  const before = S.srcShown || SRC_PAGE; S.srcShown = before + SRC_PAGE; renderSrcs();
  if (focus) { const r = $('#c-msrcs').querySelectorAll('.src')[before]; if (r) r.focus({ preventScroll: false }); }
}
/* Progreso de la búsqueda: cuántos museos seleccionados ya respondieron, cuántos buscan y cuántas obras van. */
function sweepInfoSoon() { if (!S.siT) S.siT = setTimeout(() => { S.siT = 0; sweepInfo(); }, 400); }
function sweepInfo() {
  const el = $('#sweepInfo'); if (!el) return;
  const sel = C.SOURCE_LIST.filter(s => S.f.sources[s.id]), st = id => S.status[id] && S.status[id].state;
  if (!sel.length || S.f.onlyFavs) { el.textContent = ''; return; }
  const done = sel.filter(s => st(s.id) && st(s.id) !== 'loading').length, busy = sel.filter(s => st(s.id) === 'loading').length;
  const ok = sel.filter(s => st(s.id) === 'ok').length, bad = sel.filter(s => st(s.id) === 'error' || st(s.id) === 'nokey').length;
  const works = Object.keys(S.counts).reduce((a, k) => a + (S.counts[k] || 0), 0);
  el.textContent = (done < sel.length ? 'Buscando: ' + done + ' de ' + sel.length + ' museos consultados' + (busy ? ' (' + busy + ' en curso)' : '') : 'Todos los museos consultados (' + sel.length + ')') +
    ' · ' + ok + ' con obras' + (bad ? ' · ' + bad + ' sin respuesta' : '') + (works ? ' · ' + works + ' obras' : '');
  if (!$('#loader').hidden && !S.current) $('#loaderSub').textContent = el.textContent;
}
/* ───────── buscar por título ───────── */
const slimWork = w => ({ ft: w.ft, uid: w.uid, src: w.src, museum: w.museum, title: w.title, artist: w.artist, date: w.date, year: w.year, imgs: (w.imgs || []).slice(0, 2), thumb: w.thumb, url: w.url, type: w.type, pd: w.pd, license: w.license });
function okWork(w) { // lo que llega por el relé se valida: solo imágenes https
  return w && typeof w === 'object' && typeof w.title === 'string' && Array.isArray(w.imgs) && w.imgs.length && w.imgs.every(u => typeof u === 'string' && /^https:\/\//i.test(u));
}
async function showFound(w) {
  const item = C.mk({ src: String(w.src || 'wiki'), id: String(w.uid || '').replace(/^[^:]*:/, '') || String(Date.now()), museum: w.museum, title: w.title, artist: w.artist, date: w.date, year: w.year, imgs: w.imgs, thumb: w.thumb || w.imgs[0], url: w.url, type: w.type, pd: w.pd, license: w.license });
  item.uid = w.uid || item.uid;
  toast('Cargando «' + item.title + '»…');
  const r = await loadImage(item.imgs); // la ficha trae la página y las imágenes: se muestra la primera imagen que carga, nunca la página
  if (!r) { toast('No se pudo cargar la imagen de «' + item.title + '»'); return; }
  S.seen.add(item.uid);
  present(Object.assign({}, item, { url: r.url, url_page: item.url, iw: r.w, ih: r.h })); schedule();
}
function renderTres() {
  $('#c-tres').innerHTML = $('#scanRes').innerHTML = (S.tres || []).map((w, i) => '<button class="tres" data-act="title-show" data-id="' + i + '"><img alt="" loading="lazy" src="' + esc(w.thumb) + '"><span><b>' + esc(w.title) + '</b>' + esc([C.cleanName(w.artist), w.date || w.year, w.museum].filter(Boolean).join(' · ')) + '</span></button>').join('');
  updateSums();
}
// Los mensajes de la búsqueda salen a la vez en el menú y en la hoja del escáner.
const tmsg = t => { $('#titleMsg').textContent = t; $('#scanMsg').textContent = t; };
async function searchTitle(text) {
  const q = (typeof text === 'string' ? text : $('#titleIn').value).trim();
  if (!q) return;
  tmsg('Buscando «' + q + '» en Wikidata y en los museos…'); S.tres = []; renderTres();
  const mine = S.titleQ = (S.titleQ || 0) + 1;
  try {
    const res = await C.searchPaintings(q, ctx(), list => { if (mine === S.titleQ) { S.tres = list; renderTres(); tmsg('Buscando… ' + list.length + ' encontradas'); } });
    if (mine !== S.titleQ) return;
    S.tres = res;
    tmsg(S.tres.length ? 'Toca una obra para verla ahora.' : 'No encuentro obras con ese título y con imagen. Prueba con el nombre en inglés o en el idioma original.');
    renderTres();
  } catch (e) { tmsg(e && e.message && !e.status && !(e instanceof TypeError) ? e.message : 'No pude buscar: ' + errText(e)); }
}
const idKeys = () => { try { return Object.assign({ gemini: '', anthropic: '' }, lsGet('idkeys', {})); } catch (e) { return { gemini: '', anthropic: '' }; } };
/* Reduce la foto (máx. 1280 px, JPEG) para que el envío sea ligero; si el navegador no puede, se manda tal cual (hasta 4 MB). */
function photoToB64(file) {
  const raw = () => new Promise((res, rej) => { if (file.size > 4e6) return rej(new Error('La foto pesa demasiado; prueba con una más pequeña')); const fr = new FileReader(); fr.onload = () => res({ b64: String(fr.result).split(',')[1], mime: file.type || 'image/jpeg' }); fr.onerror = () => rej(new Error('No pude leer la foto')); fr.readAsDataURL(file); });
  return new Promise(resolve => {
    try {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        try {
          const k = Math.min(1, 1024 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          const d = c.toDataURL('image/jpeg', 0.8); URL.revokeObjectURL(url);
          if (!/^data:image\/jpeg;base64,/.test(d)) throw new Error('sin canvas');
          resolve({ b64: d.split(',')[1], mime: 'image/jpeg' });
        } catch (e) { resolve(raw()); }
      };
      im.onerror = () => resolve(raw());
      im.src = url;
    } catch (e) { resolve(raw()); }
  });
}
async function searchByPhoto(file, pre) { // pre: imagen ya preparada { b64, mime } (la del escáner)
  const keys = idKeys();
  if (!file && !pre) return;
  if (scanOpen()) sheetOpen('res');
  if (!keys.gemini && !keys.anthropic) { askKey(); return; }
  const mine = S.titleQ = (S.titleQ || 0) + 1;
  tmsg('Reconociendo la obra…'); S.tres = []; renderTres();
  try {
    const { b64, mime } = pre || await photoToB64(file);
    const id = await C.identifyArtwork(b64, mime, keys);
    if (mine !== S.titleQ) return;
    if (!id) { tmsg('No reconozco la obra. Prueba con otra foto más recta, con buena luz y sin reflejos, o búscala por su nombre.'); return; }
    const label = '«' + (id.title || id.title_en) + '»' + (id.artist ? ', ' + id.artist : '') + (id.year ? ' (' + id.year + ')' : '');
    tmsg('Parece ser ' + label + '. Buscándola…');
    const done = list => { if (mine === S.titleQ) { S.tres = rankFound(list, id); renderTres(); } };
    let res = await C.searchPaintings(id.title_en || id.title, ctx(), done, id.artist);
    if (id.title && id.title_en && C.norm(id.title) !== C.norm(id.title_en)) {
      try { const more = await C.searchPaintings(id.title, ctx(), null, id.artist); res = res.concat(more.filter(m => !res.some(r => r.uid === m.uid))); } catch (e) { /* con la primera búsqueda basta */ }
    }
    if (mine !== S.titleQ) return;
    S.tres = rankFound(res, id); renderTres();
    tmsg(S.tres.length ? 'Parece ser ' + label + '. Toca una para verla ahora.' : 'Parece ser ' + label + ', pero no encuentro esa obra con imagen. Prueba a buscarla por su nombre.');
  } catch (e) {
    tmsg(e && e.noKey ? 'Falta la clave para reconocer fotos.' : e && (e.status === 400 || e.status === 401 || e.status === 403) ? 'La clave no es válida o no tiene permiso para reconocer imágenes (' + e.status + ').' : e && (e.status === 503 || e.status === 500 || e.status === 502 || e.status === 504 || e.status === 529) ? 'El servicio de reconocimiento está saturado (' + e.status + '). Espera unos segundos y vuelve a intentarlo.' : e && e.status === 429 ? 'Se acabó la cuota de la clave por ahora; prueba más tarde.' : e && e.timeout ? 'No pude reconocer la foto: ' + e.message + '. Prueba de nuevo; si sigue igual, usa la otra clave o una foto más pequeña.' : 'No pude reconocer la foto: ' + errText(e));
  }
}
/* Sin clave para reconocer: se dice dónde ponerla (en el escáner, en la propia hoja; en el menú, abajo del todo). */
function askKey() {
  if (scanOpen()) { sheetOpen('key'); tmsg('Para reconocer obras hace falta una clave (aquí debajo). La de Gemini es gratuita.'); return; }
  tmsg('Para reconocer fotos pon antes una clave (abajo, «Clave para reconocer fotos»). La de Gemini es gratuita.');
  try { document.querySelector('[data-acc=titulo] details.adv').open = true; } catch (e) { /* sin detalles */ }
}
/* ───────── escáner con la cámara ─────────
   Funciona como la app de cámara: zoom (con los dedos o con 1× 2× 3×), el círculo escanea lo que hay dentro del marco,
   el cuadrado izquierdo busca por nombre y el derecho por una foto de la galería. Mientras la imagen está quieta y nítida el
   marco se pone verde. Al escanear, la imagen se congela y los resultados salen en una hoja desde abajo; al cerrarla, sigue la cámara.
   Sin cámara disponible, el círculo abre la cámara del sistema. */
const SC = { stream: null, timer: 0, prev: null, still: 0, busy: false, zoom: 1, zmin: 1, zmax: 4, hw: null, pinch: null };
const scanOpen = () => !$('#scanner').hidden;
async function openScanner() {
  const md = navigator.mediaDevices;
  SC.prev = null; SC.still = 0; SC.busy = false; SC.hw = null; SC.zoom = 1; SC.zmin = 1; SC.zmax = 4;
  $('#scanner').hidden = false; $('#scanner').classList.remove('frozen'); sheetClose(true);
  $('#scanFrame').classList.remove('ok'); $('#scanVideo').style.transform = '';
  { const ik = idKeys(); $('#idk-gemini-s').value = ik.gemini || ''; $('#idk-anthropic-s').value = ik.anthropic || ''; }
  let stream = null;
  if (md && typeof md.getUserMedia === 'function') {
    $('#scanHint').textContent = 'Abriendo la cámara…';
    try { stream = await md.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }); }
    catch (e) { $('#scanHint').textContent = e && e.name === 'NotAllowedError' ? 'Sin permiso para la cámara: pulsa el círculo para usar la del sistema' : 'No pude abrir la cámara: pulsa el círculo para usar la del sistema'; }
  } else $('#scanHint').textContent = 'Pulsa el círculo para hacer la foto con la cámara del sistema';
  if (!scanOpen()) { if (stream) try { stream.getTracks().forEach(tr => tr.stop()); } catch (e) { /* ya parada */ } return; } // se cerró mientras pedía permiso
  SC.stream = stream;
  if (stream) {
    const v = $('#scanVideo'); v.srcObject = stream; try { await v.play(); } catch (e) { /* algunos navegadores ya reproducen solos */ }
    try { // zoom de la propia cámara si lo tiene (más nítido); si no, se amplía la imagen
      const tr = stream.getVideoTracks()[0], cz = tr.getCapabilities && tr.getCapabilities().zoom;
      if (cz && cz.max > cz.min) { SC.hw = tr; SC.zmin = Math.max(1, cz.min); SC.zmax = Math.min(10, cz.max); SC.zoom = Math.max(SC.zmin, (tr.getSettings && tr.getSettings().zoom) || SC.zmin); }
    } catch (e) { /* sin datos de la cámara */ }
    $('#scanHint').textContent = 'Encuadra la obra dentro del marco';
    clearInterval(SC.timer); SC.timer = setInterval(scanTick, 250);
  }
  renderZoom();
}
function scanFallback() { const i = $('#photoIn'); i.setAttribute('capture', 'environment'); i.click(); setTimeout(() => i.removeAttribute('capture'), 1000); }
function closeScanner() {
  clearInterval(SC.timer); SC.timer = 0; SC.busy = false; SC.pinch = null;
  if (SC.stream) { try { SC.stream.getTracks().forEach(tr => tr.stop()); } catch (e) { /* ya parada */ } }
  SC.stream = null; SC.hw = null; const v = $('#scanVideo'); try { v.srcObject = null; } catch (e) { /* nada */ }
  const was = scanOpen(); $('#scanner').hidden = true; sheetClose(true);
  if (was && HOME && history.state && history.state.ga === 'scan') try { history.back(); } catch (e) { /* sin historial */ }
}
/* Zoom: botones 1× 2× 3× (el que está más cerca muestra el valor real, como en la cámara) y pellizco con dos dedos. */
function renderZoom() {
  const box = $('#scanZoom'), steps = [1, 2, 3, 5].filter(z => z >= SC.zmin && z <= SC.zmax);
  if (!SC.stream || steps.length < 2) { box.hidden = true; return; }
  box.hidden = false;
  const near = steps.reduce((a, z) => (Math.abs(z - SC.zoom) < Math.abs(a - SC.zoom) ? z : a), steps[0]);
  const fmt = z => (Math.round(z * 10) / 10).toString().replace('.', ',') + '×';
  box.innerHTML = steps.map(z => '<button data-act="scan-zoom" data-id="' + z + '" aria-pressed="' + (z === near) + '">' + (z === near ? fmt(SC.zoom) : fmt(z)) + '</button>').join('');
}
function setZoom(z) {
  z = Math.max(SC.zmin, Math.min(SC.zmax, +z || 1)); if (Math.abs(z - SC.zoom) < 0.01 && SC.zoom === z) { renderZoom(); return; }
  SC.zoom = z; SC.prev = null;
  if (SC.hw) { try { const p = SC.hw.applyConstraints({ advanced: [{ zoom: z }] }); if (p && p.catch) p.catch(() => {}); } catch (e) { /* la cámara no aceptó el zoom */ } }
  else $('#scanVideo').style.transform = z > 1.001 ? 'scale(' + z + ')' : '';
  renderZoom();
}
/* Hoja de resultados: «res» (escaneo o foto), «name» (buscar por nombre) o «key» (falta la clave). */
function sheetOpen(mode) {
  const sh = $('#scanSheet'); sh.hidden = false; $('#scanner').classList.add('sheet');
  $('#scanSheetT').textContent = mode === 'name' ? 'Buscar por nombre' : mode === 'key' ? 'Falta una clave' : 'Resultados';
  $('#scanNameRow').hidden = mode !== 'name'; $('#scanKeys').hidden = mode !== 'key'; if (mode === 'key') $('#scanKeys').open = true;
  if (mode === 'name') { tmsg(''); S.tres = []; renderTres(); setTimeout(() => { try { $('#scanTitleIn').focus(); } catch (e) { /* nada */ } }, 50); }
}
function sheetClose(quiet) {
  $('#scanSheet').hidden = true; $('#scanner').classList.remove('frozen', 'sheet');
  if (quiet) return;
  S.titleQ = (S.titleQ || 0) + 1; SC.busy = false; // lo que aún llegue de una búsqueda anterior ya no se pinta
  const v = $('#scanVideo'); if (SC.stream) { try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* nada */ } clearInterval(SC.timer); SC.timer = setInterval(scanTick, 250); }
}
/* Zona del vídeo que corresponde al marco (el vídeo se muestra recortado para llenar la pantalla y, con zoom sin cámara que lo tenga, ampliado:
   getBoundingClientRect ya da el tamaño ampliado, así que el recorte sale bien en los dos casos). */
function scanRect() {
  const v = $('#scanVideo'), fr = $('#scanFrame').getBoundingClientRect(), vr = v.getBoundingClientRect();
  const vw = v.videoWidth, vh = v.videoHeight; if (!vw || !vh || !vr.width) return null;
  const k = Math.max(vr.width / vw, vr.height / vh), ox = (vr.width - vw * k) / 2, oy = (vr.height - vh * k) / 2;
  const x = Math.max(0, (fr.left - vr.left - ox) / k), y = Math.max(0, (fr.top - vr.top - oy) / k);
  return { x, y, w: Math.min(vw - x, fr.width / k), h: Math.min(vh - y, fr.height / k) };
}
function scanTick() {
  if (SC.busy || !$('#scanSheet').hidden) return;
  const v = $('#scanVideo'), r = scanRect(); if (!r) return;
  try {
    const c = SC.small || (SC.small = document.createElement('canvas')); c.width = 48; c.height = 36;
    const g = c.getContext('2d'); g.drawImage(v, r.x, r.y, r.w, r.h, 0, 0, 48, 36);
    const px = g.getImageData(0, 0, 48, 36).data, lum = new Float32Array(48 * 36);
    for (let i = 0; i < lum.length; i++) lum[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11;
    let diff = 0, edge = 0; const had = !!SC.prev;
    for (let i = 0; i < lum.length; i++) { if (SC.prev) diff += Math.abs(lum[i] - SC.prev[i]); if (i % 48 < 47) edge += Math.abs(lum[i] - lum[i + 1]); }
    diff /= lum.length; edge /= lum.length; SC.prev = lum;
    const quiet = had && diff < 4.5, detail = edge > 1.2; // quieto y con detalle (no una pared lisa ni desenfocado)
    SC.still = quiet && detail ? SC.still + 1 : 0;
    $('#scanFrame').classList.toggle('ok', SC.still >= 2);
    $('#scanHint').textContent = !detail ? 'Acércate a la obra: no veo bastante detalle' : SC.still >= 2 ? 'Listo: pulsa el círculo para escanear' : 'Encuadra la obra dentro del marco';
  } catch (e) { /* el vídeo aún no está listo */ }
}
function scanCapture() {
  if (SC.busy) return;
  if (!SC.stream) { scanFallback(); return; } // sin cámara en la página: la del sistema
  const k0 = idKeys(); if (!k0.gemini && !k0.anthropic) { askKey(); return; }
  const v = $('#scanVideo'), r = scanRect();
  if (!r) { toast('La cámara aún no está lista'); return; }
  SC.busy = true;
  try {
    const k = Math.min(1, 1024 / Math.max(r.w, r.h)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w * k)); c.height = Math.max(1, Math.round(r.h * k));
    c.getContext('2d').drawImage(v, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    const d = c.toDataURL('image/jpeg', 0.85);
    if (!/^data:image\/jpeg;base64,/.test(d)) throw new Error('sin imagen');
    if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) { /* sin vibración */ }
    try { v.pause(); } catch (e) { /* nada */ } clearInterval(SC.timer); $('#scanner').classList.add('frozen'); // la imagen se queda congelada mientras se reconoce
    searchByPhoto(null, { b64: d.split(',')[1], mime: 'image/jpeg' });
  } catch (e) { SC.busy = false; toast('No pude leer la imagen de la cámara'); }
}
// Pellizcar con dos dedos amplía; la rueda del ratón también (en el ordenador).
(function () {
  const sc = $('#scanner'), dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  sc.addEventListener('touchstart', e => { if (e.touches.length === 2 && SC.stream && $('#scanSheet').hidden) SC.pinch = { d: dist(e.touches) || 1, z: SC.zoom }; }, { passive: true });
  sc.addEventListener('touchmove', e => { if (SC.pinch && e.touches.length === 2) { e.preventDefault(); setZoom(SC.pinch.z * dist(e.touches) / SC.pinch.d); } }, { passive: false });
  sc.addEventListener('touchend', e => { if (e.touches.length < 2) SC.pinch = null; }, { passive: true });
  sc.addEventListener('wheel', e => { if (!SC.stream || !$('#scanSheet').hidden) return; e.preventDefault(); setZoom(SC.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }, { passive: false });
})();

/* ───────── pantalla de inicio (solo en el móvil, no en la TV ni en el mando) ─────────
   Escaneo de obra, Galería de arte y Colecciones. El botón Atrás del móvil vuelve de la galería o de la cámara al inicio. */
const HOME = !REMOTE && (() => {
  if (Q.get('home') === '1') return true;
  if (Q.get('home') === '0' || Q.get('tv') === '1') return false;
  try {
    const wv = window.innerWidth || 1024, hv = window.innerHeight || 768;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return Math.min(wv, hv) <= 600 && (coarse || wv <= 600);
  } catch (e) { return false; }
})();
const homeOpen = () => !$('#home').hidden;
function navPush(k) { if (HOME) try { history.pushState({ ga: k }, ''); } catch (e) { /* sin historial */ } }
function showHome() { if (!HOME) return; if (S.menu) closeMenu(); if (scanOpen()) closeScanner(); $('#home').hidden = false; }
function leaveHome() {
  if (!homeOpen()) return;
  $('#home').hidden = true; navPush('gallery');
  if (touchLayout() && !lsGet('tapHint', false)) { lsSet('tapHint', true); setTimeout(() => toast('Toca el borde derecho: siguiente · el izquierdo: anterior · el centro: menú'), 2500); }
}
function homeAct(act) {
  if (act === 'home-scan') { navPush('scan'); openScanner(); return; }
  if (act === 'home-gallery') { leaveHome(); return; }
  if (act === 'home-collections') { // de momento abre el menú en «Colección rápida»
    leaveHome(); openMenu();
    const sel = $('#c-presets'); try { sel.scrollIntoView({ block: 'center' }); sel.focus({ preventScroll: true }); if (sel.showPicker) sel.showPicker(); } catch (e) { /* el navegador no abre la lista solo */ }
    return;
  }
  if (act === 'home') { showHome(); if (history.state && history.state.ga) try { history.back(); } catch (e) { /* sin historial */ } }
}
window.addEventListener('popstate', e => {
  if (!HOME) return;
  const k = e.state && e.state.ga;
  if (k !== 'scan' && scanOpen()) closeScanner();
  if (!k) showHome();
});
/* Ordena lo encontrado según lo que reconoció la foto: primero las del mismo artista y con más palabras del título.
   Si alguna es del artista reconocido, se quitan las de otros artistas (antes salían obras con títulos parecidos de cualquiera). */
function rankFound(list, id) {
  const words = t => C.norm(t || '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(x => x.length > 2 && !/^(the|del|las|los|una|les|des|and|with|con|por|para|sur|von|van|der|het)$/.test(x));
  const a = words(id.artist).pop(), tw = [words(id.title), words(id.title_en)].filter(x => x.length);
  const sc = w => {
    const t = C.norm(w.title), byA = !!a && C.norm(w.artist).includes(a);
    const tit = tw.length ? Math.max.apply(null, tw.map(ws => ws.filter(x => t.includes(x)).length / ws.length)) : 0;
    return { w, byA, tit, s: (byA ? 2 : 0) + tit };
  };
  let rows = list.map(sc);
  if (rows.some(r => r.byA)) rows = rows.filter(r => r.byA);
  else if (rows.some(r => r.tit >= 0.5)) rows = rows.filter(r => r.tit >= 0.5);
  return rows.sort((x, y) => y.s - x.s).map(r => r.w);
}
function showTitleResult(i) {
  const w = (S.tres || [])[+i]; if (!w) return;
  if (REMOTE) { if (!RC.gotState) { toast('Todavía no hay conexión con la TV'); return; } relaySend({ t: 'cmd', c: 'show', w: slimWork(w) }); toast('Enviada a la TV: ' + w.title); if (scanOpen()) closeScanner(); return; }
  if (scanOpen()) { // desde la cámara: se cierra y se ve la obra en la galería
    const fromHome = homeOpen();
    if (fromHome && HOME && history.state && history.state.ga === 'scan') { try { history.replaceState({ ga: 'gallery' }, ''); } catch (e) { /* sin historial */ } }
    closeScanner(); if (fromHome) { $('#home').hidden = true; }
  }
  closeMenu(); showFound(w);
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
    renderSrcs(); render('presets'); applyChange();
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
  resortMuseums(); S.srcShown = 0;
  Object.keys(BOX).forEach(k => { $('#' + BOX[k]).innerHTML = R[k](); });
  renderSrcs();
  $('#artistList').innerHTML = C.ARTIST_SUGGESTIONS.map(a => '<option value="' + esc(a) + '">').join('');
  $('#yFrom').value = S.f.yearFrom; $('#yTo').value = S.f.yearTo;
  ['europeana', 'si', 'harvard'].forEach(k => { $('#k-' + k).value = S.keys[k] || ''; });
  { const ik = idKeys(); $('#idk-gemini').value = ik.gemini || ''; $('#idk-anthropic').value = ik.anthropic || ''; }
  $('#playBtn').textContent = S.paused ? 'Reanudar' : 'Pausar'; updateFavBtn(); updateSums();
}
function openMenu() { if (S.menu) return; S.menu = true; clearTimeout(S.timer); renderAll(); $('#drawer').hidden = false; busy(); const b = $('#drawer [data-act=next]'); if (b) b.focus({ preventScroll: true }); }
function closeMenu() { if (REMOTE || !S.menu) return; S.menu = false; $('#drawer').hidden = true; busy(); schedule(); try { document.activeElement.blur(); } catch (e) { /* nada */ } }
const toggleArr = (arr, v) => { const i = arr.indexOf(v); i < 0 ? arr.push(v) : arr.splice(i, 1); };

function addArtist(name) { name = (name || '').trim(); if (!name || S.f.artists.some(a => C.norm(a) === C.norm(name))) return; S.f.artists.push(name); render('artists'); render('artistsug'); applyChange(); }
function addExWord(text) { text = (text || '').trim().slice(0, 40); if (!text || S.f.noWords.some(x => C.norm(x) === C.norm(text))) return; S.f.noWords.push(text); render('exwords'); applyChange(); }
async function testKey(name) {
  const msg = $('#keyMsg'), el = $('#k-' + name), key = (el.value || S.keys[name] || '').trim();
  if (!key) { msg.textContent = REMOTE ? 'Escribe la clave aquí para probarla (la guardada está en la TV).' : 'Escribe primero la clave.'; return; }
  const urls = {
    europeana: 'https://api.europeana.eu/record/v2/search.json?wskey=' + encodeURIComponent(key) + '&query=painting&rows=1&media=true',
    si: 'https://api.si.edu/openaccess/api/v1.0/search?api_key=' + encodeURIComponent(key) + '&q=painting&rows=1',
    harvard: 'https://api.harvardartmuseums.org/object?apikey=' + encodeURIComponent(key) + '&size=1'
  };
  const label = { europeana: 'Europeana', si: 'Smithsonian', harvard: 'Harvard' }[name];
  msg.textContent = 'Probando la clave de ' + label + '…';
  try {
    const r = await fetch(urls[name]); let j = null; try { j = await r.json(); } catch (e) { /* sin JSON */ }
    const n = j && (j.totalResults != null ? j.totalResults : j.response ? j.response.rowCount : j.info ? j.info.totalrecords : null);
    if (r.ok && n != null && !(j && j.success === false)) msg.textContent = '✔ La clave de ' + label + ' funciona (' + n + ' resultados de prueba).';
    else msg.textContent = '✖ ' + label + ' la rechaza' + (r.status ? ' (HTTP ' + r.status + ')' : '') + (j && (j.error || j.message) ? ': ' + String(j.error || j.message).slice(0, 120) : '') + '. Revisa que esté bien copiada.';
  } catch (e) { msg.textContent = '✖ No pude conectar con ' + label + ': ' + errText(e); }
}
function addKeyword(text) { const q = C.keywordToQuery(text || ''); if (!q || S.f.keywords.includes(q)) return; S.f.keywords.push(q); render('kws'); applyChange(); }

function onAct(act, id) {
  const f = S.f;
  if (REMOTE && (act === 'prev' || act === 'next' || act === 'play' || act === 'fav')) { remoteCmd(act); return; }
  if (REMOTE && act === 'diag') { remoteDiag(); return; }
  switch (act) {
    case 'close': if (!REMOTE) closeMenu(); break;
    case 'qr': showPair(true); closeMenu(); break;
    case 'qr-close': hidePair(); break;
    case 'rc-retry': remoteHello(true); break;
    case 'rc-update': remoteUpdate(); break;
    case 'tv-connect': { $('#tvRow').hidden = false; $('#tvCode').value = lsGet('tvcode', ''); $('#tvCode').focus(); break; }
    case 'tv-go': {
      const c = parseCode($('#tvCode').value);
      if (!c) { $('#tvMsg').textContent = 'El código no es válido: son 12 letras y números y salen bajo el QR de la TV.'; break; }
      lsSet('tvcode', c); $('#tvMsg').textContent = 'Abriendo el mando…'; location.href = location.pathname + '?c=' + c; break;
    }
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
      const p = presetList().find(x => x.key === id || x.es === id); if (!p) break;
      const nf = C.defaultFilters(); // todo a cero
      C.SOURCE_LIST.forEach(s => { const nk = s.museum && s.museum.needsKey; nf.sources[s.id] = !(nk && !hasKey(nk)); }); // todos los museos (salvo los que piden una clave que no hay)
      if (p.favs) { nf.onlyFavs = true; if (!S.favs.length) toast('Aún no tienes favoritas'); }
      if (p.s || p.a || p.y) Object.assign(nf, C.quickFilters(p));
      S.f = nf; S.st.preset = p.key; S.st.presetSig = filterSig(nf); S.mfilter = ''; try { $('#museumFilter').value = ''; } catch (e) { /* sin campo */ }
      renderAll(); applyChange(); break;
    }
    case 'src': f.sources[id] = !f.sources[id]; render('srcs'); applyChange(); break;
    case 'src-more': moreSrcs(true); break;
    case 'mus-all': case 'mus-none': visibleMuseums().forEach(x => { f.sources[x.id] = act === 'mus-all'; }); render('srcs'); applyChange(); break;
    case 'add-museum': addMuseumByName(); break;
    case 'title-search': searchTitle(); break;
    case 'photo': $('#photoIn').removeAttribute('capture'); $('#photoIn').click(); break;
    case 'scan': navPush('scan'); openScanner(); break;
    case 'scan-close': closeScanner(); break;
    case 'scan-now': scanCapture(); break;
    case 'scan-photo': $('#photoIn').removeAttribute('capture'); $('#photoIn').click(); break;
    case 'scan-name': sheetOpen('name'); break;
    case 'scan-name-go': searchTitle($('#scanTitleIn').value); break;
    case 'scan-zoom': setZoom(+id); break;
    case 'sheet-close': sheetClose(); break;
    case 'home-scan': case 'home-gallery': case 'home-collections': case 'home': homeAct(act); break;
    case 'title-show': showTitleResult(id); break;
    case 'era': toggleArr(f.eras, id); f.yearFrom = f.yearTo = ''; $('#yFrom').value = $('#yTo').value = ''; render('eras'); applyChange(); break;
    case 'style': toggleArr(f.styles, id); render('styles'); applyChange(); break;
    case 'kw': toggleArr(f.keywords, id); render('kws'); applyChange(); break;
    case 'orient': f.orientation = id; render('orient'); applyChange(); break;
    case 'add-artist': addArtist($('#artistIn').value); $('#artistIn').value = ''; break;
    case 'add-sug': addArtist(id); break;
    case 'artgroup': S.artGroup = id; render('artistsug'); break;
    case 'rm-artist': f.artists = f.artists.filter(a => a !== id); render('artists'); render('artistsug'); applyChange(); break;
    case 'add-kw': addKeyword($('#kwIn').value); $('#kwIn').value = ''; break;
    case 'ex': toggleArr(f.exclude, id); render('excl'); applyChange(); break;
    case 'add-exw': addExWord($('#exwIn').value); $('#exwIn').value = ''; break;
    case 'rm-exw': f.noWords = f.noWords.filter(x => x !== id); render('exwords'); applyChange(); break;
    case 'key-test': testKey(id); break;
    case 'mode': S.st.mode = id; applyLook(); saveAll(); render('mode'); if (S.current) { S.side = !S.side; layoutSlide(slides[S.layer], S.current); } break;
    case 'interval': S.st.interval = +id; saveAll(); render('interval'); schedule(); break;
    case 'skin': S.st.skin = SKIN_BAR[id] ? id : 'm3-dark'; applyLook(); if (REMOTE) lsSet('rskin', S.st.skin); saveAll(); render('skin'); updateSums(); break;
    case 'caption': S.st.caption = id; saveAll(); render('caption'); if (S.current) { setCaption(S.current); S.side = !S.side; layoutSlide(slides[S.layer], S.current); } break;
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
document.addEventListener('touchstart', e => { const t = e.touches[0]; swipe = e.touches.length === 1 && !S.menu && !scanOpen() && !homeOpen() ? { x: t.clientX, y: t.clientY } : null; }, { passive: true });
document.addEventListener('touchend', e => {
  if (!swipe || S.menu) return;
  const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y; swipe = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) { dx < 0 ? next() : prev(); }
}, { passive: true });
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el) { onAct(el.dataset.act, el.dataset.id); return; }
  if (e.target.id === 'loaderMenu') { openMenu(); return; }
  if (e.target.id === 'loaderDiag') { diagnose(); return; }
  if (e.target.closest('#pair')) { hidePair(); return; }
  if (e.target.closest('#scanner') || e.target.closest('#home')) return;
  if (REMOTE) return;
  if (e.target.closest('#drawer') || e.target.closest('#diag')) return;
  if (S.menu) { closeMenu(); return; }
  if (touchLayout() && e.clientX != null) {
    // Sin botones ni flechas en pantalla: borde derecho = siguiente, borde izquierdo = anterior, centro = menú.
    const x = e.clientX / (window.innerWidth || 1);
    if (x > EDGE_R) { next(); return; }
    if (x < EDGE_L) { prev(); return; }
  }
  openMenu();
});
['mousemove', 'touchstart', 'pointerdown'].forEach(ev => document.addEventListener(ev, activity, { passive: true }));
document.addEventListener('change', e => {
  if (e.target.id === 'photoIn') { const f = e.target.files && e.target.files[0]; e.target.value = ''; searchByPhoto(f); }
  else if (/^idk-(gemini|anthropic)(-s)?$/.test(e.target.id)) {
    const name = e.target.id.split('-')[1], k = idKeys(); k[name] = e.target.value.trim(); lsSet('idkeys', k);
    $('#idk-' + name).value = $('#idk-' + name + '-s').value = k[name]; toast('Clave guardada en este dispositivo');
    if (scanOpen() && (k.gemini || k.anthropic)) tmsg('Clave guardada. Ya puedes escanear: cierra esta hoja y pulsa el círculo.');
  }
});
document.addEventListener('keydown', e => {
  activity();
  if (scanOpen()) {
    const inField = /^(input|textarea)$/i.test(e.target.tagName || '');
    if (inField && e.key === 'Enter' && e.target.id === 'scanTitleIn') { e.preventDefault(); searchTitle(e.target.value); return; }
    if (e.key === 'Escape' || e.key === 'GoBack' || (e.key === 'Backspace' && !inField)) { e.preventDefault(); if (!$('#scanSheet').hidden) sheetClose(); else closeScanner(); }
    return;
  }
  if (homeOpen()) return;
  const tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea';
  if (typing) {
    if (e.key === 'Enter') { if (e.target.id === 'artistIn') { addArtist(e.target.value); e.target.value = ''; } if (e.target.id === 'kwIn') { addKeyword(e.target.value); e.target.value = ''; } if (e.target.id === 'museumIn') addMuseumByName(); if (e.target.id === 'titleIn') searchTitle(); if (e.target.id === 'tvCode') onAct('tv-go'); if (e.target.id === 'exwIn') { addExWord(e.target.value); e.target.value = ''; } }
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
[['presets', 'preset'], ['artgroup', 'artgroup'], ['orient', 'orient'], ['mode', 'mode'], ['interval', 'interval'], ['caption', 'caption'], ['skin', 'skin']].forEach(([box, act]) => {
  $('#' + BOX[box]).addEventListener('change', e => {
    const v = e.target.value;
    if (act === 'preset') { if (v === '') return; onAct('preset', v); return; } // queda marcada la elegida
    onAct(act, v);
  });
});
['pointerdown', 'touchstart', 'wheel', 'keydown', 'scroll'].forEach(ev => $('#drawer').addEventListener(ev, () => { touchAt = Date.now(); }, { passive: true, capture: true }));
$('#museumFilter').addEventListener('input', e => { S.mfilter = e.target.value; renderSrcs(true); });
$('#yFrom').addEventListener('change', e => { S.f.yearFrom = e.target.value; S.f.eras = []; render('eras'); applyChange(); });
$('#yTo').addEventListener('change', e => { S.f.yearTo = e.target.value; S.f.eras = []; render('eras'); applyChange(); });
['europeana', 'si', 'harvard'].forEach(k => {
  $('#k-' + k).addEventListener('change', e => {
    S.keys[k] = e.target.value.trim(); lsSet('keyt', Object.assign({}, lsGet('keyt', {}), { [k]: Date.now() })); cloudSyncSoon();
    if (REMOTE) { // también queda en este móvil (para la versión móvil) y no se reenvía de más
      const def = { europeana: 'api2demo', si: 'DEMO_KEY', harvard: '' };
      lsSet('keys', Object.assign({}, def, lsGet('keys', {}), { [k]: S.keys[k] || def[k] })); lsSet('keysent', Object.assign({}, lsGet('keysent', {}), { [k]: S.keys[k] }));
    }
    saveAll(); updateSums(); if (S.f.sources[k]) applyChange(); });
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); cloudSyncSoon(); checkUpdate(); } else saveStash(); });
window.addEventListener('pagehide', saveStash);
let lock = null;
async function keepAwake() { try { if ('wakeLock' in navigator) lock = await navigator.wakeLock.request('screen'); } catch (e) { /* no disponible */ } }

/* ───────── app instalable (PWA) ───────── */
/* Borra copias guardadas y service worker, y recarga la página desde internet. */
/* Actualización automática: cada 5 min (y al volver a la app) se mira la versión publicada (sw.js lleva la huella de la
   compilación). Si cambió, la TV se recarga sola justo al pasar a la siguiente obra (nunca con el menú abierto ni en pausa);
   gracias al arranque instantáneo sigue con la obra que tocaba. El mando se recarga cuando nadie lo está tocando. */
async function checkUpdate() {
  if (!/^https?:$/.test(location.protocol)) return false;
  try {
    const r = await fetch('sw.js?v=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return false;
    const m = /VERSION\s*=\s*'([0-9a-f]{6,})'/.exec(await r.text()), cur = buildVer();
    if (!m || !cur || m[1] === cur) return false;
    const last = lsGet('upd', {}); if (last.to === m[1] && Date.now() - last.at < 1800000) return false; // ya se intentó: no entrar en bucle
    S.updateTo = m[1]; S.updatePending = true;
    if (REMOTE) remoteUpdateSoon();
    return true;
  } catch (e) { return false; }
}
function reloadNow() {
  lsSet('upd', { to: S.updateTo, at: Date.now() }); saveStash();
  const u = location.pathname + '?' + (REMOTE ? 'c=' + REMOTE + '&' : '') + (Q.get('tv') ? 'tv=' + Q.get('tv') + '&' : '') + 'r=' + Date.now();
  (S.reloadHook || (x => location.replace(x)))(u);
}
function applyUpdate() {
  if (!S.updatePending || S.menu || S.paused || REMOTE) return false;
  S.updatePending = false; reloadNow(); return true;
}
function remoteUpdateSoon() {
  clearTimeout(S.updT);
  S.updT = setTimeout(function tick() {
    if (Date.now() - touchAt < 15000 || (document.activeElement && /input|textarea|select/i.test(document.activeElement.tagName))) { S.updT = setTimeout(tick, 5000); return; }
    S.updatePending = false; reloadNow();
  }, 3000);
}
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
const RC = { code: '', links: [], ntfyOn: false, ntfyOk: false, es: null, poll: null, buf: {}, listening: false, lastPhone: 0, lastNow: 0, pingT: null, helloT: null, helloN: 0, connected: false, setT: null, forceNow: false, nowT: null, sent: 0, err: 0, seen: {}, polled: false, lastState: 0, hellos: 0 };
const asciiJSON = o => JSON.stringify(o).replace(/[\u0080-￿]/g, c => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4));
const BROKERS = Q.get('broker') ? [Q.get('broker')] : ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/'];
const topicOf = side => 'galeria-arte/' + RC.code + '/' + side;
const ntfyTopic = side => 'galeria-arte-' + RC.code + '-' + side;
function newCode() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = '';
  try { const r = new Uint8Array(12); crypto.getRandomValues(r); r.forEach(n => { s += a[n % a.length]; }); } catch (e) { for (let i = 0; i < 12; i++) s += a[Math.floor(Math.random() * a.length)]; }
  return s;
}

/* Canal principal: brokers MQTT públicos por WebSocket (sin límites de mensajes y en tiempo real).
   ntfy.sh queda de reserva si ningún broker responde. Todo se manda por todos los canales abiertos y se descarta lo repetido. */
const u8 = s => Array.from(unescape(encodeURIComponent(s)), c => c.charCodeAt(0));
const mqStr = s => { const b = u8(s); return [b.length >> 8, b.length & 255].concat(b); };
function mqPkt(first, body) { const o = []; let n = body.length; do { let d = n % 128; n = Math.floor(n / 128); o.push(n > 0 ? d | 128 : d); } while (n > 0); return new Uint8Array([first].concat(o, body)); }
function mqttOpen(url, topic, onText, onChange) {
  const L = { url, ok: false, ws: null, dead: false, tries: 0, ping: null };
  L.send = (t, text) => { if (!L.ok) return false; try { L.ws.send(mqPkt(0x30, mqStr(t).concat(u8(text)))); return true; } catch (e) { return false; } };
  const later = () => { L.ok = false; clearInterval(L.ping); onChange(); if (!L.dead) setTimeout(connect, Math.min(30000, 2000 * Math.pow(2, Math.min(L.tries++, 4)))); };
  function connect() {
    let ws; try { ws = new WebSocket(url, 'mqtt'); } catch (e) { later(); return; }
    L.ws = ws; ws.binaryType = 'arraybuffer';
    let buf = [], closed = false;
    const gone = () => { if (closed) return; closed = true; later(); };
    ws.onopen = () => { ws.send(mqPkt(0x10, [0, 4, 77, 81, 84, 84, 4, 2, 0, 30].concat(mqStr('ga' + Math.random().toString(36).slice(2, 10))))); };
    ws.onmessage = e => {
      buf = buf.concat(Array.from(new Uint8Array(e.data)));
      while (buf.length >= 2) {
        let mul = 1, len = 0, i = 1, b;
        do { if (i >= buf.length) return; b = buf[i++]; len += (b & 127) * mul; mul *= 128; } while (b & 128);
        if (buf.length < i + len) return;
        const type = buf[0] >> 4, flags = buf[0] & 15, body = buf.slice(i, i + len); buf = buf.slice(i + len);
        if (type === 2) { if (body[1] === 0) ws.send(mqPkt(0x82, [0, 1].concat(mqStr(topic), [0]))); else ws.close(); }
        else if (type === 9) { L.ok = true; L.tries = 0; clearInterval(L.ping); L.ping = setInterval(() => { try { ws.send(new Uint8Array([0xC0, 0])); } catch (er) { /* se reconecta */ } }, 20000); onChange(); }
        else if (type === 3) { let p = 2 + body[0] * 256 + body[1]; if ((flags >> 1) & 3) p += 2; onText(String.fromCharCode.apply(null, body.slice(p))); }
      }
    };
    ws.onerror = gone; ws.onclose = gone;
  }
  connect();
  return L;
}
/* ───────── relé propio (Cloudflare) ─────────
   Misma web, /api/relay/<código>/…: un WebSocket por tema (TV o móvil) y el estado compartido (favoritas y claves).
   Si no está configurado o no responde, la app sigue con los relés públicos (MQTT y ntfy). */
const OWN_OK = /^https?:$/.test(location.protocol) && Q.get('own') !== '0';
const ownBase = code => location.origin + '/api/relay/' + code;
function ownOpen(code, topic, onText, onChange) {
  const L = { own: true, ok: false, ws: null, tries: 0, ping: null };
  L.send = (t, text) => { if (!L.ok) return false; try { L.ws.send(JSON.stringify({ p: t, m: text })); return true; } catch (e) { return false; } };
  const later = () => { L.ok = false; clearInterval(L.ping); onChange(); setTimeout(connect, Math.min(300000, 3000 * Math.pow(2, Math.min(L.tries++, 7)))); };
  function connect() {
    let ws; try { ws = new WebSocket(ownBase(code).replace(/^http/, 'ws') + '/ws?sub=' + encodeURIComponent(topic)); } catch (e) { later(); return; }
    L.ws = ws; let closed = false;
    const gone = () => { if (closed) return; closed = true; later(); };
    ws.onopen = () => { L.ok = true; L.tries = 0; clearInterval(L.ping); L.ping = setInterval(() => { try { ws.send('ping'); } catch (e) { /* se reconecta */ } }, 25000); onChange(); };
    ws.onmessage = e => { if (typeof e.data === 'string' && e.data !== 'pong') onText(e.data); };
    ws.onerror = gone; ws.onclose = gone;
  }
  connect();
  return L;
}
const ownUp = () => RC.links.some(l => l.own && l.ok);
/* Favoritas y claves en la nube, ligadas al código de la TV. Cada alta/baja lleva su hora: gana la más reciente, y las bajas
   quedan apuntadas para que una favorita quitada no vuelva desde otro dispositivo. */
const KEY_DEF = { europeana: 'api2demo', si: 'DEMO_KEY', harvard: '' };
function cloudCode() { return REMOTE || RC.code || lsGet('rc', ''); }
function favDel(uid) { const d = lsGet('favdel', {}); d[uid] = Date.now(); const ks = Object.keys(d); if (ks.length > 1000) ks.sort((a, b) => d[a] - d[b]).slice(0, ks.length - 1000).forEach(k => delete d[k]); lsSet('favdel', d); }
function cloudSyncSoon() { if (!OWN_OK) return; clearTimeout(S.cloudT); S.cloudT = setTimeout(cloudSync, 1500); }
async function cloudSync() {
  const code = cloudCode(); if (!OWN_OK || !code || S.cloudBusy) return;
  S.cloudBusy = true;
  try {
    const sent = lsGet('cloudsent', {}), dels = lsGet('favdel', {}), keyt = lsGet('keyt', {}), ops = [], mark = {};
    S.favs.forEach(w => { const tt = w.ft || 1; if (sent[w.uid] !== tt) { ops.push({ uid: w.uid, t: tt, w: slimWork(w) }); mark[w.uid] = tt; } });
    Object.keys(dels).forEach(u => { if (sent[u] !== -dels[u]) { ops.push({ uid: u, t: dels[u], del: true }); mark[u] = -dels[u]; } });
    Object.keys(KEY_DEF).forEach(k => { const v = S.keys[k]; if (v && v !== KEY_DEF[k] && keyt[k] && sent['key:' + k] !== keyt[k]) { ops.push({ key: k, value: v, t: keyt[k] }); mark['key:' + k] = keyt[k]; } });
    const r = await fetch(ownBase(code) + '/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: lsGet('cloudv', -1), ops }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const st = await r.json();
    lsSet('cloudsent', Object.assign(sent, mark));
    if (st && !st.same && st.favs) cloudApply(st);
    if (st && typeof st.v === 'number') lsSet('cloudv', st.v);
    S.cloudOk = true;
  } catch (e) { S.cloudOk = false; } finally { S.cloudBusy = false; }
}
function cloudApply(st) {
  const entries = Object.keys(st.favs).map(u => [u, st.favs[u]]);
  const live = entries.filter(x => !x[1].del && x[1].w && okWork(x[1].w)).sort((a, b) => b[1].t - a[1].t).map(x => Object.assign({}, x[1].w, { ft: x[1].t }));
  const dels = {}; entries.filter(x => x[1].del).forEach(x => { dels[x[0]] = x[1].t; });
  const sent = lsGet('cloudsent', {}); live.forEach(w => { sent[w.uid] = w.ft; }); Object.keys(dels).forEach(u => { sent[u] = -dels[u]; }); lsSet('cloudsent', sent);
  const before = S.favs.map(w => w.uid).join();
  S.favs = live.slice(0, FAV_MAX); lsSet('favdel', dels);
  let keyChanged = false; const keyt = lsGet('keyt', {});
  Object.keys(st.keys || {}).forEach(k => { const o = st.keys[k]; if (KEY_DEF.hasOwnProperty(k) && o && typeof o.value === 'string' && !(keyt[k] >= o.t)) { keyt[k] = o.t; sent['key:' + k] = o.t; if (S.keys[k] !== o.value) { S.keys[k] = o.value; keyChanged = true; } } });
  lsSet('keyt', keyt); lsSet('cloudsent', sent);
  if (REMOTE) { lsSet('favs', S.favs); if (keyChanged) { lsSet('keys', Object.assign({}, KEY_DEF, lsGet('keys', {}), S.keys)); remoteKeys(S.tvKeyset); } }
  else { saveAll(); if (keyChanged) { updateSums(); applyChange(); } }
  if (before !== S.favs.map(w => w.uid).join()) { updateFavBtn(); render('presets'); render('opts'); if (!REMOTE) tvNowSoon(true); }
}
function relaySend(obj) {
  const s = asciiJSON(obj), id = Math.random().toString(36).slice(2, 7), N = 3000, n = Math.max(1, Math.ceil(s.length / N));
  const peer = REMOTE ? 'tv' : 'ph';
  for (let i = 0; i < n; i++) {
    const text = id + '|' + i + '|' + n + '|' + s.slice(i * N, (i + 1) * N);
    RC.sent++;
    let sent = 0;
    RC.links.forEach(l => { if (l.send(topicOf(peer), text)) sent++; });
    if (RC.ntfyOn && !ownUp()) { // con el relé propio activo no hace falta ntfy (tiene límite diario)
      sent++;
      try { fetch(RELAY + '/' + ntfyTopic(peer), { method: 'POST', body: text }).then(r => { RC.err = r && r.ok === false ? r.status : 0; }).catch(() => { RC.err = -1; }); } catch (e) { RC.err = -1; }
    }
    if (!sent) RC.err = -1;
  }
}
function relayRecv(text, fn) {
  const m = /^([a-z0-9]+)\|(\d+)\|(\d+)\|([\s\S]*)$/.exec(text || ''); if (!m) return;
  const id = m[1], i = +m[2], n = +m[3];
  const seen = id + '|' + i; if (RC.seen[seen]) return; // el mismo mensaje llega por varios canales
  RC.seen[seen] = Date.now();
  const b = RC.buf[id] || (RC.buf[id] = { n, parts: [], got: 0, t: Date.now() });
  if (b.parts[i] == null) { b.parts[i] = m[4]; b.got++; }
  Object.keys(RC.buf).forEach(k => { if (Date.now() - RC.buf[k].t > 60000) delete RC.buf[k]; });
  Object.keys(RC.seen).forEach(k => { if (Date.now() - RC.seen[k] > 120000) delete RC.seen[k]; });
  if (b.got < b.n) return;
  delete RC.buf[id];
  let o; try { o = JSON.parse(b.parts.join('')); } catch (e) { return; }
  if (o && typeof o === 'object') fn(o);
}
function relayListen(fn) {
  if (RC.listening || !RC.code) return; RC.listening = true;
  const onText = t => relayRecv(t, fn);
  const change = () => {
    RC.connected = RC.links.some(l => l.ok) || RC.ntfyOk;
    if (RC.connected && REMOTE && !RC.helloN) remoteHello();
    if (!REMOTE) { const p = $('#pair'); if (p && !p.hidden) pairStatus(); }
  };
  RC.links = (OWN_OK ? [ownOpen(RC.code, topicOf(REMOTE ? 'ph' : 'tv'), onText, change)] : []).concat(BROKERS.map(u => mqttOpen(u, topicOf(REMOTE ? 'ph' : 'tv'), onText, change)));
  // Reserva: si ningún broker responde en 7 s, se usa ntfy.sh (SSE y, si también falla, sondeo cada 5 s).
  setTimeout(() => { if (!RC.links.some(l => l.ok)) ntfyListen(onText, change); }, 7000);
}
function ntfyListen(onText, change) {
  if (RC.ntfyOn) return; RC.ntfyOn = true;
  const url = RELAY + '/' + ntfyTopic(REMOTE ? 'ph' : 'tv');
  const onData = d => { let m; try { m = typeof d === 'string' ? JSON.parse(d) : d; } catch (e) { return; } if (m && m.event === 'message') onText(m.message); };
  let since = String(Math.floor(Date.now() / 1000) - 30), polling = false;
  const startPoll = () => {
    if (polling) return; polling = true;
    RC.poll = setInterval(async () => {
      try {
        const r = await fetch(url + '/json?poll=1&since=' + since); const t = await r.text();
        RC.polled = true; RC.err = r.ok ? RC.err : r.status;
        t.split('\n').forEach(l => { if (!l.trim()) return; let m; try { m = JSON.parse(l); } catch (e) { return; } if (m.id) since = m.id; onData(m); });
      } catch (e) { /* se reintenta */ }
    }, 5000);
  };
  if (typeof EventSource === 'function') {
    const es = RC.es = new EventSource(url + '/sse');
    es.onmessage = e => { RC.ntfyOk = true; onData(e.data); };
    es.onopen = () => { RC.ntfyOk = true; change(); };
    es.onerror = () => { RC.ntfyOk = false; setTimeout(() => { if (!RC.ntfyOk) startPoll(); }, 8000); };
    setTimeout(() => { if (!RC.ntfyOk) startPoll(); }, 6000);
  } else { RC.ntfyOk = true; startPoll(); }
  change();
}
function relayInfo() {
  const mq = RC.links.filter(l => !l.own), n = mq.filter(l => l.ok).length;
  return (ownUp() ? 'Relé propio ✓ · ' : '') + 'Relé ' + (n ? n + ' de ' + mq.length + ' brokers' : RC.ntfyOn ? 'ntfy' + (RC.polled ? ' (sondeo)' : '') : 'sin conexión') + ' · enviados ' + RC.sent + (RC.err ? ' · error ' + (RC.err === -1 ? 'de red' : 'HTTP ' + RC.err) : '');
}

/* — lado TV — */
function buildVer() { const v = document.querySelector('.ver'); const m = v && /Versión\s+(\w+)/.exec(v.textContent); return m ? m[1] : ''; }
// Solo viajan los museos que difieren de los predeterminados: el mensaje cabe en un solo paquete.
function slimF(f) { const d = C.defaultFilters().sources, s = {}; Object.keys(f.sources).forEach(k => { if (!!f.sources[k] !== !!d[k]) s[k] = !!f.sources[k]; }); return Object.assign({}, f, { sources: s }); }
function tvState() { return { t: 'state', f: slimF(S.f), st: S.st, custom: S.custom, paused: S.paused, now: tvNow(), ver: buildVer(), favStyles: favStyleIds(), keyset: { europeana: !!S.keys.europeana, si: !!S.keys.si, harvard: !!S.keys.harvard } }; }
function tvNow() {
  const w = S.current; if (!w) return null;
  return { uid: w.uid, title: w.title, artist: w.artist, date: w.date, museum: w.museum, thumb: w.thumb || w.url, fav: isFav(w), paused: S.paused, favStyles: favStyleIds() };
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
/* Favoritas compartidas entre móvil, mando y TV. Al conectar, el mando manda la lista de identificadores; la TV contesta con las
   obras que le faltan al mando y pide las que le faltan a ella; después cada alta o baja viaja sola. Se unen (nada se borra por sincronizar). */
const FAV_MAX = 300;
function mergeFavs(ws, rm) {
  let n = 0;
  (Array.isArray(rm) ? rm : []).forEach(u => { const l = S.favs.length; S.favs = S.favs.filter(x => x.uid !== u); if (S.favs.length !== l) { n++; favDel(u); } });
  (Array.isArray(ws) ? ws.slice(0, 12) : []).filter(okWork).forEach(w => { if (!S.favs.some(x => x.uid === w.uid)) { S.favs.push(Object.assign(slimWork(w), { ft: typeof w.ft === 'number' ? w.ft : Date.now() })); n++; } });
  if (S.favs.length > FAV_MAX) S.favs = S.favs.slice(0, FAV_MAX);
  if (!n) return 0;
  if (REMOTE) lsSet('favs', S.favs); else saveAll();
  updateFavBtn(); render('presets'); render('opts'); if (!REMOTE) tvNowSoon(true);
  cloudSyncSoon();
  return n;
}
function sendFavBatches(list) { // lotes pequeños y espaciados para no saturar el relé
  const slim = list.slice(0, FAV_MAX).map(slimWork);
  for (let i = 0; i < slim.length; i += 6) setTimeout(() => relaySend({ t: 'favs', w: slim.slice(i, i + 6) }), (i / 6) * 450);
}
function tvFavPush(w, added) {
  if (REMOTE || !RC.code || !RC.lastPhone || Date.now() - RC.lastPhone > 240000) return;
  relaySend(added ? { t: 'favs', w: [slimWork(S.favs.find(x => x.uid === w.uid) || w)] } : { t: 'favs', rm: [w.uid] });
}
const uidList = a => Array.isArray(a) ? a.filter(u => typeof u === 'string' && u.length < 80).slice(0, 400) : [];
/* Estado de cada museo (verde/amarillo/rojo, obras cargadas y detalle por fuente) para que el menú del mando sea igual que el de la TV.
   Va en un mensaje aparte y compacto: «o12» = ok con 12 obras; l = buscando; e = sin resultados; x = error; k = falta clave. */
const SRC_CODE = { ok: 'o', loading: 'l', empty: 'e', error: 'x', nokey: 'k' }, SRC_STATE = { o: 'ok', l: 'loading', e: 'empty', x: 'error', k: 'nokey' };
function tvSrcsMsg() {
  const s = {}, d = {}, m = {};
  Object.keys(S.status).forEach(id => {
    const st = S.status[id], k = id.replace(/^m:/, '');
    s[k] = (SRC_CODE[st.state] || 'l') + (S.counts[id] || '');
    if (st.state === 'error' && st.msg) m[k] = String(st.msg).slice(0, 50);
    if (S.detail[id]) { const o = {}; Object.keys(S.detail[id]).forEach(n => { o[n] = typeof S.detail[id][n] === 'string' ? S.detail[id][n].slice(0, 40) : S.detail[id][n]; }); d[k] = o; }
  });
  const msg = { t: 'srcs', s, d, m };
  if (JSON.stringify(msg).length > 3300) delete msg.d; // el mensaje debe caber en un paquete
  if (JSON.stringify(msg).length > 3300) delete msg.m;
  return msg;
}
function tvSrcsSoon(now) {
  if (REMOTE || !RC.code || !RC.lastPhone || Date.now() - RC.lastPhone > 240000 || RC.srcsT) return;
  RC.srcsT = setTimeout(() => { RC.srcsT = 0; relaySend(tvSrcsMsg()); }, now ? 800 : 6000);
}
function tvHandle(m) {
  if (m.t === 'hello' || m.t === 'ping' || m.t === 'cmd' || m.t === 'set' || m.t === 'fs' || m.t === 'favs') RC.lastPhone = Date.now();
  if (m.t === 'fs') { // el mando cuenta qué favoritas tiene
    const theirs = uidList(m.u), have = new Set(S.favs.map(w => w.uid)), mine = new Set(theirs);
    const need = theirs.filter(u => !have.has(u)); if (need.length) relaySend({ t: 'fneed', u: need });
    sendFavBatches(S.favs.filter(w => !mine.has(w.uid))); return;
  }
  if (m.t === 'favs') { mergeFavs(m.w, m.rm); return; }
  // El QR se oculta solo cuando el móvil ya recibió el estado y manda órdenes (conexión de ida y vuelta).
  if (m.t === 'ping' || m.t === 'cmd' || m.t === 'set') { lsSet('paired', true); hidePair(); }
  if (m.t === 'hello') { RC.hellos++; if (Date.now() - RC.lastState > 2500) { RC.lastState = Date.now(); relaySend(tvState()); tvSrcsSoon(true); } return; }
  if (m.t === 'ping') { RC.forceNow = true; tvNowSoon(); tvSrcsSoon(); return; }
  if (m.t === 'cmd') {
    RC.forceNow = true;
    if (m.c === 'update') { forceUpdate(); return; }
    if (m.c === 'diag') { RC.forceNow = false; diagnose(true).then(() => relaySend({ t: 'diag', text: $('#diagOut').textContent.slice(0, 40000) })); return; }
    if (m.c === 'show') { if (okWork(m.w)) { showFound(m.w); } return; }
    if (m.c === 'next') next(); else if (m.c === 'prev') prev(); else if (m.c === 'play') togglePlay(); else if (m.c === 'fav') toggleFav();
    return;
  }
  if (m.t === 'set' && m.f) {
    const before = JSON.stringify(S.f);
    (m.custom || []).forEach(c => { if (c && c.id && !S.custom.some(x => x.id === c.id)) { try { C.addMuseum(c); S.custom.push(c); lsSet('custom', S.custom); } catch (e) { /* museo dañado */ } } });
    S.f = normFilters(m.f);
    if (m.st && typeof m.st === 'object') S.st = Object.assign(S.st, m.st);
    let keyChanged = false;
    ['europeana', 'si', 'harvard'].forEach(k => { const v = m.keys && typeof m.keys[k] === 'string' ? m.keys[k].trim() : ''; if (v && v !== S.keys[k]) { S.keys[k] = v; keyChanged = true; } });
    applyLook();
    if (keyChanged || JSON.stringify(S.f) !== before) applyChange(); else { saveAll(); schedule(); }
    if (S.menu) renderAll();
    toast('Ajustes cambiados desde el móvil');
    RC.lastState = Date.now(); relaySend(tvState()); tvSrcsSoon(true);
  }
}
// Acepta «abcd-efgh-jkmn», con espacios, en mayúsculas o el enlace completo del QR.
function parseCode(v) { v = String(v || ''); const m = /[?&]c=([a-z0-9]+)/i.exec(v); if (m) v = m[1]; v = v.toLowerCase().replace(/[^a-z0-9]/g, ''); return /^[a-z0-9]{6,24}$/.test(v) ? v : ''; }
function pairUrl() { return location.origin + location.pathname + '?c=' + RC.code; }
function showPair(manual) {
  if (REMOTE || !/^https?:$/.test(location.protocol)) { if (manual) toast('El mando necesita abrir la galería desde su dirección https'); return; }
  if (!RC.code) { RC.code = lsGet('rc', '') || newCode(); lsSet('rc', RC.code); }
  relayListen(tvHandle);
  const url = pairUrl();
  try { const q = qrcode(0, 'M'); q.addData(url); q.make(); $('#pairQR').innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { $('#pairQR').textContent = ''; }
  $('#pairCode').textContent = 'Código: ' + RC.code.replace(/(.{4})(?=.)/g, '$1-');
  $('#pairUrl').textContent = url.replace(/^https?:\/\//, '');
  $('#pair').hidden = false; pairStatus(); clearInterval(RC.stT); RC.stT = setInterval(pairStatus, 2000);
  clearTimeout(RC.hideT); RC.hideT = setTimeout(hidePair, manual ? 120000 : (lsGet('paired', false) ? 20000 : 150000));
}
function pairStatus() {
  const keep = lsGet('rc', '') === RC.code;
  $('#pairSt').textContent = relayInfo() + ' · avisos de móviles: ' + RC.hellos + (keep ? '' : ' · este navegador no guarda el código: cambiará al recargar');
}
function hidePair() { const p = $('#pair'); if (p) p.hidden = true; clearTimeout(RC.hideT); clearInterval(RC.stT); }
function initTV() {
  if (Q.get('tv') === '0') return;
  if (Q.get('tv') === '1' || (window.innerWidth || 1024) > 820) setTimeout(() => showPair(false), 1500);
}

/* — lado móvil — */
function remoteStat(text, ok, retry) { const s = $('#rcstat'); s.textContent = text; s.classList.toggle('ok', !!ok); $('#rcRetry').hidden = !retry; }
function remoteFavStyles(ids) {
  if (!Array.isArray(ids) || JSON.stringify(ids) === JSON.stringify(S.tvFavStyles || [])) return;
  S.tvFavStyles = ids; render('presets');
}
function remoteNow(n) {
  if (!n) return;
  remoteFavStyles(n.favStyles);
  S.current = { uid: n.uid }; S.nowFav = !!n.fav; S.paused = !!n.paused;
  $('#rcnow').hidden = false; $('#rcT').textContent = n.title || ''; $('#rcA').textContent = [C.cleanName(n.artist), n.date].filter(Boolean).join(' · ');
  const im = $('#rcImg'); if (n.thumb && im.dataset.u !== n.thumb) { im.dataset.u = n.thumb; im.src = n.thumb; }
  $('#playBtn').textContent = S.paused ? 'Reanudar' : 'Pausar'; updateFavBtn();
}
function remoteSyncKeys() { // manda a la TV las claves de este móvil que aún no le llegaron
  const sent = lsGet('keysent', {}), todo = ['europeana', 'si', 'harvard'].filter(k => S.keys[k] && sent[k] !== S.keys[k]);
  if (!todo.length) return;
  lsSet('keysent', Object.assign({}, sent, Object.fromEntries(todo.map(k => [k, S.keys[k]])))); remoteSetSoon();
}
function remoteKeys(ks) {
  S.tvKeyset = ks || {};
  ['europeana', 'si', 'harvard'].forEach(k => { const el = $('#k-' + k); el.value = S.keys[k] || ''; el.placeholder = ks && ks[k] ? '•••••• guardada en la TV (escribe para cambiarla)' : 'sin clave en la TV'; });
}
function remoteDiag() {
  if (!RC.gotState) { toast('Todavía no hay conexión con la TV'); return; }
  $('#diagOut').textContent = 'Probando las fuentes desde la TV… puede llevar un par de minutos. El informe aparecerá aquí.'; $('#diag').hidden = false;
  relaySend({ t: 'cmd', c: 'diag' });
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
  if (RC.helloN >= 10) { remoteStat('No encuentro la TV. Comprueba que tiene abierta la galería, que el código es el que muestra ahora (' + relayInfo() + ').', false, true); return; }
  RC.helloN++; relaySend({ t: 'hello' });
  remoteStat('Conectando con la TV…' + (RC.helloN > 1 ? ' (' + relayInfo() + ')' : ''), false, false);
  RC.helloT = setTimeout(() => remoteHello(false), Math.min(60000, 3000 * Math.pow(2, RC.helloN - 1)));
}
function remoteHandle(m) {
  if (m.t === 'state' && m.f) {
    RC.gotState = true; clearTimeout(RC.helloT);
    (m.custom || []).forEach(c => { try { if (c && c.id) { C.addMuseum(c); if (!S.custom.some(x => x.id === c.id)) S.custom.push(c); } } catch (e) { /* museo dañado */ } });
    S.f = normFilters(m.f); if (m.st) S.st = Object.assign(S.st, m.st);
    applyLook(); lsSet('rskin', S.st.skin); // el aspecto del mando es el de la TV (antes solo cambiaba el selector, no los colores)
    S.tvFavStyles = Array.isArray(m.favStyles) ? m.favStyles : (S.tvFavStyles || []);
    renderAll(); remoteNow(m.now); remoteVer(m.ver); remoteKeys(m.keyset);
    if (!RC.synced) { RC.synced = true; relaySend({ t: 'fs', u: S.favs.map(w => w.uid).slice(0, 400) }); remoteSyncKeys(); }
    remoteStat('Conectado a la TV. Lo que cambies aquí se aplica en la pantalla.', true, false);
  } else if (m.t === 'diag') { $('#diagOut').textContent = m.text || ''; $('#diag').hidden = false;
  } else if (m.t === 'srcs') { remoteSrcs(m);
  } else if (m.t === 'favs') { mergeFavs(m.w, m.rm);
  } else if (m.t === 'fneed') { const need = new Set(uidList(m.u)); sendFavBatches(S.favs.filter(w => need.has(w.uid)));
  } else if (m.t === 'now') { remoteNow(m.now); if (!RC.gotState) remoteHello(true); }
}
function remoteSrcs(m) { // la TV cuenta cómo va cada museo; aquí se pinta igual que en la TV
  const s = m.s || {}, changed = [];
  C.SOURCE_LIST.forEach(src => {
    const k = src.id.replace(/^m:/, ''), v = s[k], before = JSON.stringify([S.status[src.id], S.counts[src.id], S.detail[src.id]]);
    if (v == null) { delete S.status[src.id]; delete S.counts[src.id]; delete S.detail[src.id]; }
    else {
      S.status[src.id] = { state: SRC_STATE[String(v)[0]] || 'loading', msg: (m.m && m.m[k]) || '' };
      const n = +String(v).slice(1); if (n) S.counts[src.id] = n; else delete S.counts[src.id];
      if (m.d && m.d[k]) S.detail[src.id] = m.d[k]; else delete S.detail[src.id];
    }
    if (JSON.stringify([S.status[src.id], S.counts[src.id], S.detail[src.id]]) !== before) changed.push(src.id);
  });
  if (!changed.length) return;
  if (changed.length > 6) render('srcs'); else changed.forEach(updateSrc);
  sweepInfo(); busy(); // si cambian muchos, un solo repintado es más barato que fila por fila
  scheduleResort();
}
function remoteCmd(c) {
  if (!RC.gotState) { toast('Todavía no hay conexión con la TV'); return; }
  relaySend({ t: 'cmd', c });
  toast(c === 'next' ? 'Siguiente obra…' : c === 'prev' ? 'Obra anterior…' : c === 'play' ? 'Pausa / reanudar…' : 'Favorita…');
}
function remoteSetSoon() {
  if (!REMOTE) return;
  clearTimeout(RC.setT);
  RC.setT = setTimeout(() => { relaySend({ t: 'set', f: slimF(S.f), st: S.st, custom: S.custom, keys: S.keys }); toast('Enviado a la TV'); }, 900);
}
function initRemote() {
  RC.code = REMOTE; lsSet('rc', REMOTE);
  setTimeout(cloudSync, 1500); setInterval(cloudSync, 600000);
  setTimeout(checkUpdate, 30000); setInterval(checkUpdate, 300000);
  document.body.classList.add('rc');
  { // las claves guardadas en la versión móvil (mismo navegador) viajan a la TV; las de demostración no
    const pk = lsGet('keys', {}), nd = (v, d) => (v && v !== d ? v : '');
    S.keys = { europeana: nd(pk.europeana, 'api2demo'), si: nd(pk.si, 'DEMO_KEY'), harvard: nd(pk.harvard, '') };
  }
  { const rs = lsGet('rskin', ''); if (SKIN_BAR[rs]) S.st.skin = rs; } // hasta que llegue el estado de la TV, el último aspecto usado en el mando
  S.menu = true; applyLook(); renderAll();
  $('#rcinfo').hidden = false; $('#rcfoot').hidden = false; $('#drawer').hidden = false; remoteVer('');
  document.title = 'Mando · Galería de arte';
  remoteStat('Conectando con la TV…', false, false);
  relayListen(remoteHandle);
  setTimeout(() => { if (!RC.helloN) remoteStat('No consigo conectar con el servicio de mensajes (' + relayInfo() + '). Comprueba la conexión a internet del móvil.', false, true); }, 9000);
  RC.pingT = setInterval(() => { if (document.visibilityState === 'visible' && RC.gotState) relaySend({ t: 'ping' }); }, 90000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && RC.gotState) relaySend({ t: 'ping' }); });
}

/* ───────── inicio ───────── */
function init() {
  if (REMOTE) { initRemote(); return; }
  applyLook(); renderAll(); activity(); keepAwake();
  document.body.classList.add('active');
  if (HOME) { $('#home').hidden = false; $('#homeBtn').hidden = false; try { history.replaceState(null, ''); } catch (e) { /* sin historial */ } }
  else if (touchLayout() && !lsGet('tapHint', false)) { lsSet('tapHint', true); setTimeout(() => toast('Toca el borde derecho: siguiente · el izquierdo: anterior · el centro: menú'), 2500); }
  showLoader('Buscando obras en los museos…', 'Pulsa Intro o toca la pantalla para abrir los filtros.', false);
  planSweep();
  if (loadStash()) refill();
  setTimeout(cloudSync, 2500); setInterval(cloudSync, 600000);
  setTimeout(checkUpdate, 30000); setInterval(checkUpdate, 300000); // con obras guardadas se muestran ya y los museos se consultan igual en segundo plano
  advance();
  initTV();
}
window.ArtApp = { openScanner, closeScanner, scanCapture, setZoom, showHome, HOME, cloudSync, checkUpdate, applyUpdate, S, next, prev, advance, openMenu, closeMenu, refill, onAct, render, renderAll, applyChange, present, pullNext, captionMs, capMode, parseCode, Remote: () => RC };
init();
})();
