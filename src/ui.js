/* Interfaz: escenario, rotación, menú de filtros, favoritas y ajustes. */
(function () {
'use strict';
const C = ArtCore;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'galeria-arte-v1';
function lsGet(k, def) { try { const v = localStorage.getItem(KEY + ':' + k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
function lsSet(k, v) { try { localStorage.setItem(KEY + ':' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }

/* ───────── estado ───────── */
function loadFilters() {
  const d = C.defaultFilters(), s = lsGet('f', {});
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
  paused: false, menu: false, epoch: 0, refilling: 0, adv: false, advAt: 0, flight: new Map(), cool: {}, streak: {}, warned: false, recycleAfter: 6000, mfilter: '', detail: {},
  status: {}, counts: {}, layer: 0, nextP: null, nextEpoch: -1,
  timer: null, capT: null, idleT: null, waiters: [], current: null, shown: 0
};
function saveAll() { lsSet('f', S.f); lsSet('st', S.st); lsSet('keys', S.keys); lsSet('favs', S.favs.slice(0, 300)); }

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
  C.sampleN(ready, Math.max(0, 4 - S.flight.size)).forEach(s => launch(s, epoch));
}

async function launch(s, epoch) {
  const f = S.f;
  S.flight.set(s.id, epoch); S.refilling++; busy(); setStatus(s.id, 'loading');
  let added = 0, fail = null;
  try {
    const d = S.detail[s.id] = {};
    const cx = Object.assign(ctx(), { report: (name, n, err) => { d[name] = err ? '✖ ' + errText(err) : n; } });
    let list = await C.runSource(s, f, cx);
    if (epoch === S.epoch) {
      list = list.filter(w => C.accept(w, f) && !S.seen.has(w.uid) && !S.seenKey.has(wkey(w)) && !S.pool.some(x => x.uid === w.uid));
      added = list.length;
      if (added) insertRandom(list);
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
function setCaption(w) {
  const c = $('#caption');
  c.querySelector('.t').textContent = w.title;
  c.querySelector('.m').textContent = [w.artist, w.date].filter(Boolean).join(' · ');
  c.querySelector('.s').textContent = [w.museum, w.license].filter(Boolean).join(' · ') + (isFav(w) ? ' · ♥ favorita' : '');
  clearTimeout(S.capT);
  if (S.st.caption === 'never') { c.classList.remove('show'); return; }
  c.classList.add('show');
  if (S.st.caption === 'auto') S.capT = setTimeout(() => c.classList.remove('show'), 9000);
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
function togglePlay() { S.paused = !S.paused; $('#playBtn').textContent = S.paused ? 'Reanudar' : 'Pausar'; toast(S.paused ? 'En pausa' : 'Reproduciendo'); schedule(); }
function toggleFav() {
  const w = S.current; if (!w) return;
  if (isFav(w)) { S.favs = S.favs.filter(x => x.uid !== w.uid); toast('Quitada de favoritas'); }
  else { S.favs.unshift({ uid: w.uid, src: w.src, museum: w.museum, title: w.title, artist: w.artist, date: w.date, year: w.year, imgs: [w.url].concat(w.imgs.filter(u => u !== w.url)), thumb: w.thumb, url: w.url_page || w.url, type: w.type, pd: w.pd, license: w.license, w: w.w, h: w.h }); toast('Guardada en favoritas'); }
  saveAll(); updateFavBtn(); setCaption(w);
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
  clearTimeout(applyT);
  applyT = setTimeout(() => {
    S.epoch++; S.pool = []; S.nextP = null; S.flight = new Map(); S.cool = {}; S.streak = {}; S.warned = false; S.adv = false; S.counts = {}; S.status = {};
    renderSrcs();
    if (S.f.onlyFavs && !S.favs.length) toast('Aún no tienes favoritas');
    advance();
  }, 700);
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
  { es: 'Museos de México', only: C.museumIdsByTag('mx'), patch: {} },
  { es: 'Museos de Bélgica', only: C.museumIdsByTag('be'), patch: {} },
  { es: 'Surrealismo en museos', only: C.museumIdsByTag('surreal').concat(['m:open']), patch: { styles: ['surrealism'] } },
  { es: 'Museos de París', only: ['m:louvre', 'm:orsay', 'm:orangerie', 'm:versailles', 'm:marmottan', 'm:petitpalais', 'm:carnavalet'], patch: {} },
  { es: 'Grandes museos de Europa', only: ['m:louvre', 'm:orsay', 'm:prado', 'm:uffizi', 'm:hermitage', 'm:nationalgallery', 'm:vangogh', 'm:mauritshuis', 'm:kunsthistorisches', 'm:versailles'], patch: {} }
];
const ORIENT = [['any', 'Cualquiera'], ['landscape', 'Horizontal'], ['portrait', 'Vertical'], ['square', 'Cuadrada']];
const MODES = [['gallery', 'Galería con fondo difuminado'], ['frame', 'Marco y paspartú'], ['fill', 'Llenar la pantalla (recorta)']];
const INTERVALS = [[10, '10 s'], [15, '15 s'], [30, '30 s'], [60, '1 min'], [300, '5 min'], [900, '15 min'], [3600, '1 h']];
const CAPTIONS = [['auto', 'Al cambiar de obra'], ['always', 'Siempre visible'], ['never', 'Oculta']];

const chip = (act, id, label, on, cls) => '<button class="chip' + (cls ? ' ' + cls : '') + '" data-act="' + act + '" data-id="' + esc(id) + '" aria-pressed="' + !!on + '">' + esc(label) + '</button>';
const R = {
  presets: () => PRESETS.map((p, i) => chip('preset', i, p.es, false)).join(''),
  eras: () => C.ERAS.map(e => chip('era', e.id, e.es, S.f.eras.includes(e.id))).join(''),
  styles: () => C.STYLES.map(s => chip('style', s.id, s.es, S.f.styles.includes(s.id))).join(''),
  types: () => C.TYPES.map(t => chip('type', t.id, t.es, S.f.types.includes(t.id))).join(''),
  artists: () => S.f.artists.map(a => chip('rm-artist', a, a, true, 'rm')).join('') || '<span class="hint" style="font-size:14px;color:var(--muted)">Ninguno. Se muestran todos los artistas.</span>',
  artistsug: () => C.ARTIST_SUGGESTIONS.filter(a => !S.f.artists.includes(a)).slice(0, 14).map(a => chip('add-sug', a, a, false)).join(''),
  kws: () => C.KEYWORDS.map(k => chip('kw', k.q, k.es, S.f.keywords.includes(k.q))).join('') +
    S.f.keywords.filter(q => !C.KEYWORDS.some(k => k.q === q)).map(q => chip('kw', q, q, true, 'rm')).join(''),
  orient: () => ORIENT.map(o => chip('orient', o[0], o[1], S.f.orientation === o[0])).join(''),
  mode: () => MODES.map(o => chip('mode', o[0], o[1], S.st.mode === o[0])).join(''),
  interval: () => INTERVALS.map(o => chip('interval', o[0], o[1], S.st.interval === o[0])).join(''),
  caption: () => CAPTIONS.map(o => chip('caption', o[0], o[1], S.st.caption === o[0])).join(''),
  opts: () => chip('opt', 'kb', 'Zoom lento', S.st.kenburns) + chip('opt', 'hq', 'Imágenes en alta calidad', S.st.quality === 'high') +
    chip('opt', 'pd', 'Solo dominio público', S.f.soloPD) + chip('opt', 'favs', 'Solo mis favoritas (' + S.favs.length + ')', S.f.onlyFavs)
};
const BOX = { presets: 'c-presets', eras: 'c-eras', styles: 'c-styles', types: 'c-types', artists: 'c-artists', artistsug: 'c-artist-sug', kws: 'c-kws', orient: 'c-orient', mode: 'c-mode', interval: 'c-interval', caption: 'c-caption', opts: 'c-opts' };

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
  if (key) { const el = Array.prototype.find.call(d.querySelectorAll('[data-act]'), e => e.dataset.act + '|' + e.dataset.id === key); if (el) el.focus({ preventScroll: true }); }
}
function renderAll() {
  Object.keys(BOX).forEach(k => { $('#' + BOX[k]).innerHTML = R[k](); });
  renderSrcs();
  $('#artistList').innerHTML = C.ARTIST_SUGGESTIONS.map(a => '<option value="' + esc(a) + '">').join('');
  $('#yFrom').value = S.f.yearFrom; $('#yTo').value = S.f.yearTo;
  ['europeana', 'si', 'harvard'].forEach(k => { $('#k-' + k).value = S.keys[k] || ''; });
  $('#playBtn').textContent = S.paused ? 'Reanudar' : 'Pausar'; updateFavBtn();
}
function openMenu() { if (S.menu) return; S.menu = true; clearTimeout(S.timer); renderAll(); $('#drawer').hidden = false; const b = $('#drawer [data-act=next]'); if (b) b.focus({ preventScroll: true }); }
function closeMenu() { if (!S.menu) return; S.menu = false; $('#drawer').hidden = true; schedule(); try { document.activeElement.blur(); } catch (e) { /* nada */ } }
const toggleArr = (arr, v) => { const i = arr.indexOf(v); i < 0 ? arr.push(v) : arr.splice(i, 1); };

function addArtist(name) { name = (name || '').trim(); if (!name || S.f.artists.some(a => C.norm(a) === C.norm(name))) return; S.f.artists.push(name); render('artists'); render('artistsug'); applyChange(); }
function addKeyword(text) { const q = C.keywordToQuery(text || ''); if (!q || S.f.keywords.includes(q)) return; S.f.keywords.push(q); render('kws'); applyChange(); }

function onAct(act, id) {
  const f = S.f;
  switch (act) {
    case 'close': closeMenu(); break;
    case 'diag': diagnose(); break;
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
});
$('#museumFilter').addEventListener('input', e => { S.mfilter = e.target.value; renderSrcs(); });
$('#yFrom').addEventListener('change', e => { S.f.yearFrom = e.target.value; S.f.eras = []; render('eras'); applyChange(); });
$('#yTo').addEventListener('change', e => { S.f.yearTo = e.target.value; S.f.eras = []; render('eras'); applyChange(); });
['europeana', 'si', 'harvard'].forEach(k => {
  $('#k-' + k).addEventListener('change', e => { S.keys[k] = e.target.value.trim(); saveAll(); if (S.f.sources[k]) applyChange(); });
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
let lock = null;
async function keepAwake() { try { if ('wakeLock' in navigator) lock = await navigator.wakeLock.request('screen'); } catch (e) { /* no disponible */ } }

/* ───────── inicio ───────── */
function init() {
  applyLook(); renderAll(); activity(); keepAwake();
  document.body.classList.add('active');
  if (touchLayout() && !lsGet('tapHint', false)) { lsSet('tapHint', true); setTimeout(() => toast('Toca el borde derecho: siguiente · el izquierdo: anterior · el centro: menú'), 2500); }
  showLoader('Buscando obras en los museos…', 'Pulsa Intro o toca la pantalla para abrir los filtros.', false);
  advance();
}
window.ArtApp = { S, next, prev, advance, openMenu, closeMenu, refill, onAct, render, renderAll, applyChange, present, pullNext };
init();
})();
