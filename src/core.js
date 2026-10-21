/* Núcleo: catálogos de filtros, utilidades y adaptadores de museos.
   Sin acceso al DOM, para poder probarlo en Node. */
(function (root) {
'use strict';

/* ───────── utilidades ───────── */
const rand = n => Math.floor(Math.random() * n);
const pick = a => a[rand(a.length)];
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function sampleN(a, n) { return shuffle(a.slice()).slice(0, n); }
const norm = s => (s == null ? '' : String(s)).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };

async function getJSON(url, init, timeout) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout || 14000);
  try {
    const r = await fetch(url, Object.assign({}, init || {}, { signal: ctl.signal }));
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return await r.json();
  } catch (e) {
    if (e && e.name === 'AbortError') { const x = new Error('Tiempo de espera agotado'); x.timeout = true; throw x; }
    throw e;
  } finally { clearTimeout(t); }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = null; } }
  });
  await Promise.all(workers);
  return out;
}

const memoMap = new Map();
async function memo(key, fn) {
  if (memoMap.has(key)) return memoMap.get(key);
  const p = fn().catch(e => { memoMap.delete(key); throw e; });
  memoMap.set(key, p);
  if (memoMap.size > 400) memoMap.delete(memoMap.keys().next().value);
  return p;
}

function parseYear(s) {
  if (s == null) return null;
  if (typeof s === 'number') return s;
  const str = String(s);
  const bc = /\b(b\.?\s?c\.?e?|a\.?\s?c\.?|av\.?\s?j)/i.test(str) || /^\s*-\s*\d/.test(str);
  const m = str.match(/(\d{3,4})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  return bc ? -y : y;
}

function flipName(n) {
  if (!n) return '';
  const s = String(n).trim();
  const m = s.match(/^([^,]+),\s*([^,]+)$/);
  if (m && !/\d/.test(s)) return m[2].trim() + ' ' + m[1].trim();
  return s;
}

function classifyType(text) {
  const t = norm(text);
  if (!t) return null;
  if (/photograph|daguerre|albumen|gelatin silver|fotograf|chromogenic/.test(t)) return 'photo';
  if (/\bprints?\b|etching|engraving|lithograph|woodcut|woodblock|aquatint|mezzotint|screenprint|serigraph|grabado|ukiyo|grafik|drypoint/.test(t)) return 'print';
  if (/sculpt|escultur|\bbust\b|statue|\brelief\b|bronze|marble|skulptur|terracotta/.test(t)) return 'sculpture';
  if (/ceramic|porcelain|\bvase\b|textile|tapestry|\bglass\b|furniture|jewel|silver|enamel|earthenware|fabric|\bfan\b|costume|metalwork/.test(t)) return 'decorative';
  if (/painting|\boil\b|tempera|acrylic|canvas|\bpanel\b|fresco|gouache|maleri|olieverf|pintura/.test(t)) return 'painting';
  if (/drawing|watercolo|pastel|charcoal|\bink\b|sketch|tegning|chalk|graphite|pencil|dibujo/.test(t)) return 'drawing';
  return null;
}

/* ───────── catálogos ───────── */
const ERAS = [
  { id: 'antigua', es: 'Antigüedad', r: [-3000, 500] },
  { id: 'medieval', es: 'Edad Media', r: [500, 1400] },
  { id: 'renac', es: 'Renacimiento', r: [1400, 1600] },
  { id: 'barroco', es: 'Siglo XVII', r: [1600, 1750] },
  { id: 'ilustr', es: 'Ilustración', r: [1750, 1830] },
  { id: 's19a', es: 'Romanticismo y realismo', r: [1830, 1870] },
  { id: 's19b', es: 'Fin del siglo XIX', r: [1870, 1900] },
  { id: 'mod', es: 'Modernidad', r: [1900, 1950] },
  { id: 'cont', es: 'Contemporáneo', r: [1950, 2030] }
];

const STYLES = [
  { id: 'renaissance', es: 'Renacimiento', q: 'Renaissance', range: [1400, 1620], wd: 'Renaissance', artists: ['Leonardo da Vinci', 'Raphael', 'Titian', 'Botticelli', 'Bellini', 'Dürer', 'Holbein', 'Bruegel', 'Giorgione'] },
  { id: 'mannerism', es: 'Manierismo', q: 'Mannerism', range: [1520, 1610], wd: 'Mannerism', artists: ['Pontormo', 'Bronzino', 'Parmigianino', 'Tintoretto', 'El Greco'] },
  { id: 'baroque', es: 'Barroco', q: 'Baroque', range: [1600, 1750], wd: 'Baroque', artists: ['Caravaggio', 'Rubens', 'Velázquez', 'Rembrandt', 'Poussin', 'Murillo', 'Zurbarán', 'Van Dyck', 'Claude Lorrain'] },
  { id: 'dutch', es: 'Siglo de Oro holandés', q: 'Dutch', range: [1590, 1710], wd: 'Dutch Golden Age painting', artists: ['Rembrandt', 'Vermeer', 'Frans Hals', 'Jan Steen', 'Ruisdael', 'Hobbema', 'Cuyp', 'de Hooch', 'van Goyen'] },
  { id: 'rococo', es: 'Rococó', q: 'Rococo', range: [1720, 1790], wd: 'Rococo', artists: ['Watteau', 'Boucher', 'Fragonard', 'Tiepolo', 'Canaletto', 'Guardi', 'Chardin', 'Gainsborough'] },
  { id: 'neoclassicism', es: 'Neoclasicismo', q: 'Neoclassical', range: [1760, 1850], wd: 'Neoclassicism', artists: ['David', 'Ingres', 'Canova', 'Vigée Le Brun', 'Kauffman', 'Greuze'] },
  { id: 'romanticism', es: 'Romanticismo', q: 'Romanticism', range: [1790, 1870], wd: 'Romanticism', artists: ['Delacroix', 'Géricault', 'Turner', 'Constable', 'Friedrich', 'Goya', 'Blake'] },
  { id: 'hudson', es: 'Escuela del río Hudson', q: 'Hudson River', range: [1825, 1885], wd: 'Hudson River School', artists: ['Thomas Cole', 'Frederic Church', 'Albert Bierstadt', 'Cropsey', 'Kensett'] },
  { id: 'realism', es: 'Realismo', q: 'Realism', range: [1840, 1900], wd: 'Realism', artists: ['Courbet', 'Millet', 'Daumier', 'Manet', 'Eakins', 'Winslow Homer', 'Repin'] },
  { id: 'barbizon', es: 'Escuela de Barbizon', q: 'Barbizon', range: [1830, 1885], wd: 'Barbizon school', artists: ['Corot', 'Millet', 'Théodore Rousseau', 'Daubigny', 'Diaz', 'Troyon'] },
  { id: 'prer', es: 'Prerrafaelitas', q: 'Pre-Raphaelite', range: [1848, 1910], wd: 'Pre-Raphaelite Brotherhood', artists: ['Rossetti', 'Millais', 'Burne-Jones', 'Waterhouse', 'William Holman Hunt'] },
  { id: 'impressionism', es: 'Impresionismo', q: 'Impressionism', range: [1860, 1925], wd: 'Impressionism', artists: ['Monet', 'Renoir', 'Degas', 'Pissarro', 'Sisley', 'Morisot', 'Cassatt', 'Caillebotte', 'Manet'] },
  { id: 'postimpressionism', es: 'Postimpresionismo', q: 'Post-Impressionism', range: [1880, 1915], wd: 'Post-Impressionism', artists: ['Van Gogh', 'Cézanne', 'Gauguin', 'Seurat', 'Toulouse-Lautrec', 'Signac', 'Bonnard'] },
  { id: 'symbolism', es: 'Simbolismo', q: 'Symbolism', range: [1880, 1915], wd: 'Symbolism', artists: ['Gustave Moreau', 'Odilon Redon', 'Puvis de Chavannes', 'Böcklin', 'Khnopff', 'Hodler'] },
  { id: 'artnouveau', es: 'Art nouveau', q: 'Art Nouveau', range: [1885, 1920], wd: 'Art Nouveau', artists: ['Mucha', 'Klimt', 'Tiffany', 'Beardsley', 'Gallé', 'Lalique'] },
  { id: 'expressionism', es: 'Expresionismo', q: 'Expressionism', range: [1900, 1940], wd: 'Expressionism', artists: ['Munch', 'Kirchner', 'Kandinsky', 'Nolde', 'Schiele', 'Kokoschka', 'Franz Marc'] },
  { id: 'fauvism', es: 'Fauvismo', q: 'Fauvism', range: [1898, 1915], wd: 'Fauvism', artists: ['Matisse', 'Derain', 'Vlaminck', 'Dufy', 'Braque'] },
  { id: 'cubism', es: 'Cubismo', q: 'Cubism', range: [1905, 1930], wd: 'Cubism', artists: ['Picasso', 'Braque', 'Juan Gris', 'Léger', 'Delaunay'] },
  { id: 'surrealism', es: 'Surrealismo', q: 'Surrealism', range: [1920, 1970], wd: 'Surrealism', artists: ['Dalí', 'Magritte', 'Miró', 'Max Ernst', 'Delvaux', 'Tanguy'] },
  { id: 'abstract', es: 'Arte abstracto', q: 'Abstract', range: [1910, 1975], wd: 'Abstract art', artists: ['Kandinsky', 'Mondrian', 'Malevich', 'Paul Klee', 'Albers'] },
  { id: 'abstractexp', es: 'Expresionismo abstracto', q: 'Abstract Expressionism', range: [1940, 1970], wd: 'Abstract expressionism', artists: ['Pollock', 'Rothko', 'de Kooning', 'Motherwell', 'Newman', 'Kline'] },
  { id: 'pop', es: 'Arte pop', q: 'Pop Art', range: [1955, 1990], wd: 'Pop art', artists: ['Warhol', 'Lichtenstein', 'Hockney', 'Rauschenberg', 'Jasper Johns'] },
  { id: 'ukiyoe', es: 'Ukiyo-e (Japón)', q: 'Ukiyo-e', range: [1600, 1915], wd: 'Ukiyo-e', artists: ['Hokusai', 'Hiroshige', 'Utamaro', 'Kuniyoshi', 'Sharaku', 'Kunisada'] }
];

/* Categoría de Wikimedia Commons y nombre del estilo en WikiArt (si existe). */
const STYLE_EXTRA = {
  renaissance: { cat: 'Renaissance paintings', wa: 'high-renaissance' },
  mannerism: { cat: 'Mannerist paintings', wa: 'mannerism-late-renaissance' },
  baroque: { cat: 'Baroque paintings', wa: 'baroque' },
  dutch: { cat: 'Dutch Golden Age paintings', wa: 'baroque' },
  rococo: { cat: 'Rococo paintings', wa: 'rococo' },
  neoclassicism: { cat: 'Neoclassical paintings', wa: 'neoclassicism' },
  romanticism: { cat: 'Romantic paintings', wa: 'romanticism' },
  hudson: { cat: 'Hudson River School paintings', wa: 'hudson-river-school' },
  realism: { cat: 'Realist paintings', wa: 'realism' },
  barbizon: { cat: 'Barbizon school paintings', wa: 'barbizon-school' },
  prer: { cat: 'Pre-Raphaelite paintings', wa: 'pre-raphaelite-brotherhood' },
  impressionism: { cat: 'Impressionist paintings', wa: 'impressionism' },
  postimpressionism: { cat: 'Post-Impressionist paintings', wa: 'post-impressionism' },
  symbolism: { cat: 'Symbolist paintings', wa: 'symbolism' },
  artnouveau: { cat: 'Art Nouveau paintings', wa: 'art-nouveau-modern' },
  expressionism: { cat: 'Expressionist paintings', wa: 'expressionism' },
  fauvism: { cat: 'Fauvist paintings', wa: 'fauvism' },
  cubism: { cat: 'Cubist paintings', wa: 'cubism' },
  surrealism: { cat: 'Surrealist paintings', wa: 'surrealism' },
  abstract: { cat: 'Abstract paintings', wa: 'abstract-art' },
  abstractexp: { cat: 'Abstract expressionist paintings', wa: 'abstract-expressionism' },
  pop: { cat: 'Pop art paintings', wa: 'pop-art' },
  ukiyoe: { cat: 'Ukiyo-e', wa: 'ukiyo-e' }
};
STYLES.forEach(s => Object.assign(s, STYLE_EXTRA[s.id] || {}));

const TYPES = [
  { id: 'painting', es: 'Pintura' },
  { id: 'drawing', es: 'Dibujo y acuarela' },
  { id: 'print', es: 'Grabado y estampa' },
  { id: 'photo', es: 'Fotografía' },
  { id: 'sculpture', es: 'Escultura' },
  { id: 'decorative', es: 'Artes decorativas' }
];

const KEYWORDS = [
  { q: 'landscape', es: 'Paisaje' }, { q: 'portrait', es: 'Retrato' }, { q: 'still life', es: 'Naturaleza muerta' },
  { q: 'sea', es: 'Marinas' }, { q: 'flowers', es: 'Flores' }, { q: 'garden', es: 'Jardines' },
  { q: 'Paris', es: 'París' }, { q: 'city', es: 'Ciudad' }, { q: 'mountains', es: 'Montañas' },
  { q: 'winter', es: 'Invierno' }, { q: 'night', es: 'Noche' }, { q: 'animals', es: 'Animales' },
  { q: 'mythology', es: 'Mitología' }
];

const ARTIST_SUGGESTIONS = ['Monet', 'Van Gogh', 'Rembrandt', 'Vermeer', 'Hokusai', 'Hiroshige', 'Turner', 'Cézanne', 'Renoir', 'Degas', 'Goya', 'Velázquez', 'Caravaggio', 'Klimt', 'Picasso', 'Kandinsky', 'Hopper', 'Whistler', 'Sargent', 'Friedrich', 'Constable', 'Gauguin', 'Seurat', 'Manet', 'Pissarro', 'Sisley', 'Matisse', 'Dalí', 'Miró', 'Mucha', 'Botticelli', 'Tiziano', 'El Greco', 'Rubens', 'Canaletto', 'Munch', 'Cassatt', 'Morisot', 'Sorolla', 'Zorn'];

const ES_EN = { paisaje: 'landscape', paisajes: 'landscape', retrato: 'portrait', retratos: 'portrait', flores: 'flowers', flor: 'flower', mar: 'sea', marina: 'sea', jardin: 'garden', jardines: 'garden', ciudad: 'city', montana: 'mountains', montanas: 'mountains', invierno: 'winter', noche: 'night', animales: 'animals', caballo: 'horse', caballos: 'horse', gato: 'cat', gatos: 'cat', perro: 'dog', mujer: 'woman', madre: 'mother', barco: 'ship', barcos: 'ship', puente: 'bridge', rio: 'river', bosque: 'forest', cielo: 'sky', nieve: 'snow', frutas: 'fruit', danza: 'dance', bailarinas: 'dancers', musica: 'music', 'naturaleza muerta': 'still life', mitologia: 'mythology', paris: 'Paris', venecia: 'Venice', espana: 'Spain', japon: 'Japan', puerto: 'harbor', playa: 'beach', iglesia: 'church', catedral: 'cathedral', verano: 'summer', otono: 'autumn', primavera: 'spring' };
function keywordToQuery(text) { const n = norm(text); return ES_EN[n] || text.trim(); }

/* ───────── filtros ───────── */
const DEFAULT_MUSEUMS = ['louvre', 'orsay', 'versailles', 'orangerie', 'marmottan', 'petitpalais', 'carnavalet', 'prado', 'thyssen', 'uffizi', 'hermitage', 'nationalgallery', 'vangogh', 'mauritshuis', 'kunsthistorisches',
  'met', 'aic', 'cma', 'rijks', 'vam', 'smk', 'mia', 'open'];
const SOURCE_DEFAULTS = {};
DEFAULT_MUSEUMS.forEach(id => { SOURCE_DEFAULTS['m:' + id] = true; });

function defaultFilters() {
  return {
    sources: Object.assign({}, SOURCE_DEFAULTS),
    eras: [], yearFrom: '', yearTo: '',
    styles: [], types: [], artists: [], keywords: [],
    orientation: 'any', soloPD: false, onlyFavs: false
  };
}

function allowedRanges(f) {
  const r = [];
  (f.eras || []).forEach(id => { const e = ERAS.find(x => x.id === id); if (e) r.push(e.r); });
  const a = parseInt(f.yearFrom, 10), b = parseInt(f.yearTo, 10);
  if (!isNaN(a) || !isNaN(b)) r.push([isNaN(a) ? -5000 : a, isNaN(b) ? 2100 : b]);
  return r.length ? r : null;
}
const intersect = (a, b) => { const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]); return lo <= hi ? [lo, hi] : null; };

const DEFAULT_TYPE_BAG = ['painting', 'painting', 'painting', 'drawing', 'print', 'photo', 'sculpture'];

/* Un plan es una consulta concreta (un estilo, un artista, un tema, un tipo, un rango). */
function makePlan(f) {
  const allowed = allowedRanges(f);
  const styles = (f.styles || []).map(id => STYLES.find(s => s.id === id)).filter(Boolean);
  let style = null, range = null;
  if (styles.length) {
    for (const s of shuffle(styles.slice())) {
      if (!allowed) { style = s; range = s.range; break; }
      const opts = allowed.map(a => intersect(a, s.range)).filter(Boolean);
      if (opts.length) { style = s; range = pick(opts); break; }
    }
    if (!style) return { empty: true };
  } else if (allowed) { range = pick(allowed); }
  const artist = f.artists && f.artists.length ? pick(f.artists) : null;
  const keyword = f.keywords && f.keywords.length ? pick(f.keywords) : null;
  const type = f.types && f.types.length ? pick(f.types) : pick(DEFAULT_TYPE_BAG);
  const hintArtist = !artist && style && style.artists ? pick(style.artists) : null;
  return { style, range, artist, keyword, type, hintArtist };
}

/* Filtro final sobre la obra ya normalizada. */
function accept(w, f) {
  if (!w || !w.imgs || !w.imgs.length) return false;
  const allowed = allowedRanges(f);
  if (allowed) {
    if (w.year == null) return false;
    if (!allowed.some(r => w.year >= r[0] && w.year <= r[1])) return false;
  }
  const styles = (f.styles || []).map(id => STYLES.find(s => s.id === id)).filter(Boolean);
  if (styles.length && w.year != null && !styles.some(s => w.year >= s.range[0] - 15 && w.year <= s.range[1] + 15)) return false;
  if (f.artists && f.artists.length) {
    const a = norm(w.artist);
    if (!f.artists.some(n => norm(n).split(/\s+/).every(t => a.includes(t)))) return false;
  }
  if (f.types && f.types.length) { if (w.type && !f.types.includes(w.type)) return false; }
  else if (w.type === 'decorative') return false;
  if (f.orientation && f.orientation !== 'any' && w.w && w.h) {
    const r = w.w / w.h;
    if (f.orientation === 'landscape' && r < 1.15) return false;
    if (f.orientation === 'portrait' && r > 0.87) return false;
    if (f.orientation === 'square' && (r < 0.87 || r > 1.15)) return false;
  }
  if (f.soloPD && w.pd !== true) return false;
  return true;
}

/* Los títulos de Commons a veces traen restos de QuickStatements o varios idiomas pegados:
   «French: Rochers dans le bois Rocks in the Wood title QS:P1476,fr:"…" label QS:Len,"Rocks in the Wood"». */
function cleanTitle(t) {
  let s = String(t == null ? '' : t).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (/\bQS:/.test(s)) {
    const lab = s.match(/QS:Len,"([^"]+)"/) || s.match(/QS:P1476,en:"([^"]+)"/) || s.match(/QS:L[a-z-]+,"([^"]+)"/) || s.match(/QS:P1476,[a-z-]+:"([^"]+)"/);
    s = lab ? lab[1] : s.slice(0, s.search(/\bQS:/)).replace(/\s+(title|label)\s*$/i, '');
  }
  const en = s.match(/\bEnglish:\s*(.+?)(?=\s+[A-Z][a-zé]+:\s|$)/);
  if (en) s = en[1];
  else s = s.replace(/^(?:[A-Z][a-zéèñ]+|[a-z]{2,3}):\s+/, '');
  s = s.replace(/\s+(title|label|description)\s*$/i, '').replace(/^["“”']+|["“”']+$/g, '').trim();
  return s.length > 140 ? s.slice(0, 137).trim() + '…' : s;
}

function mk(p) {
  const imgs = [];
  (p.imgs || []).filter(Boolean).forEach(u => { if (/^http:\/\//.test(u)) imgs.push(u.replace(/^http:/, 'https:')); imgs.push(u); });
  return {
    uid: p.src + ':' + p.id,
    src: p.src, museum: p.museum,
    title: cleanTitle(p.title) || 'Sin título',
    artist: (p.artist && String(p.artist).replace(/\s*\bQS:.*$/, '').trim().slice(0, 90)) || '',
    date: p.date || '', year: p.year == null ? parseYear(p.date) : p.year,
    imgs, thumb: p.thumb || imgs[imgs.length - 1] || '',
    url: p.url || '', w: p.w || null, h: p.h || null,
    type: p.type || null, pd: p.pd === undefined ? null : p.pd, license: p.license || ''
  };
}

/* ───────── adaptadores ───────── */
const MET_MEDIUM = { painting: 'Paintings', drawing: 'Drawings', print: 'Prints', photo: 'Photographs', sculpture: 'Sculpture', decorative: 'Ceramics|Glass' };

async function metFetch(plan, f, ctx) {
  const base = 'https://collectionapi.metmuseum.org/public/collection/v1/';
  const p = new URLSearchParams();
  p.set('hasImages', 'true');
  const artist = plan.artist || plan.hintArtist;
  let q;
  if (artist) { p.set('artistOrCulture', 'true'); q = artist; }
  else q = [plan.style && plan.style.q, plan.keyword].filter(Boolean).join(' ') || pick(GENERIC);
  p.set('q', q);
  if (plan.range) { p.set('dateBegin', plan.range[0]); p.set('dateEnd', plan.range[1]); }
  if (MET_MEDIUM[plan.type]) p.set('medium', MET_MEDIUM[plan.type]);
  const ids = await memo('met:' + p, async () => (await getJSON(base + 'search?' + p)).objectIDs || []);
  if (!ids.length) return [];
  const chosen = sampleN(ids, 30);
  const objs = await mapLimit(chosen, 6, id => getJSON(base + 'objects/' + id));
  return objs.filter(o => o && (ctx.anyRights || o.isPublicDomain) && (o.primaryImage || o.primaryImageSmall)).map(o => mk({
    src: 'met', museum: 'The Met', id: o.objectID,
    title: o.title, artist: o.artistDisplayName || o.culture || '',
    date: o.objectDate, year: o.objectBeginDate != null && o.objectEndDate != null && (o.objectBeginDate || o.objectEndDate) ? Math.round((o.objectBeginDate + o.objectEndDate) / 2) : parseYear(o.objectDate),
    imgs: ctx.hq ? [o.primaryImage, o.primaryImageSmall] : [o.primaryImageSmall, o.primaryImage],
    thumb: o.primaryImageSmall, url: o.objectURL,
    type: classifyType([o.classification, o.objectName, o.medium].join(' ')),
    pd: !!o.isPublicDomain, license: o.isPublicDomain ? 'Dominio público (CC0)' : 'Con derechos de autor'
  }));
}

const AIC_TYPE = { painting: 'Painting', drawing: 'Drawing and Watercolor', print: 'Print', photo: 'Photograph', sculpture: 'Sculpture', decorative: 'Ceramics' };
async function aicFetch(plan, f, ctx) {
  const url = 'https://api.artic.edu/api/v1/artworks/search';
  const fields = ['id', 'title', 'artist_title', 'date_display', 'date_start', 'date_end', 'image_id', 'thumbnail', 'style_title', 'artwork_type_title', 'classification_title', 'medium_display', 'is_public_domain'];
  const filter = [{ exists: { field: 'image_id' } }];
  if (!ctx.anyRights) filter.unshift({ term: { is_public_domain: true } });
  if (plan.range) filter.push({ range: { date_start: { gte: plan.range[0], lte: plan.range[1] } } });
  if (AIC_TYPE[plan.type]) filter.push({ match_phrase: { artwork_type_title: AIC_TYPE[plan.type] } });
  const text = [plan.style && plan.style.q, plan.artist || plan.hintArtist, plan.keyword].filter(Boolean).join(' ');
  const must = text ? [{ multi_match: { query: text, type: 'cross_fields', operator: 'and', fields: ['title', 'artist_title', 'style_title', 'style_titles', 'subject_titles', 'term_titles', 'classification_title', 'place_of_origin', 'description'] } }] : [];
  const query = { bool: { must, filter } };
  const post = body => getJSON(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const sig = 'aic:' + JSON.stringify(query);
  const total = await memo(sig, async () => {
    try { return (await post({ query, fields: ['id'], limit: 1, page: 1 })).pagination.total; }
    catch (e) { if (e instanceof TypeError) return -1; throw e; }
  });
  let j;
  if (total === -1) { // sin POST (CORS): consulta simple por GET
    const gp = new URLSearchParams({ limit: '20', fields: fields.join(',') });
    if (!ctx.anyRights) gp.set('query[term][is_public_domain]', 'true');
    if (text) gp.set('q', text);
    j = await getJSON(url + '?' + gp);
  } else {
    if (!total) return [];
    const pages = Math.max(1, Math.min(Math.ceil(total / 20), 500));
    j = await post({ query, fields, limit: 20, page: 1 + rand(pages) });
  }
  const iiif = (j.config && j.config.iiif_url) || 'https://www.artic.edu/iiif/2';
  return (j.data || []).filter(o => o.image_id && (ctx.anyRights || o.is_public_domain !== false)).map(o => {
    const base = iiif + '/' + o.image_id + '/full/';
    return mk({
      src: 'aic', museum: 'Art Institute of Chicago', id: o.id,
      title: o.title, artist: o.artist_title ? String(o.artist_title).split('\n')[0] : '',
      date: o.date_display, year: o.date_start != null && o.date_end != null ? Math.round((o.date_start + o.date_end) / 2) : parseYear(o.date_display),
      imgs: ctx.hq ? [base + '1686,/0/default.jpg', base + '843,/0/default.jpg'] : [base + '843,/0/default.jpg'],
      thumb: base + '400,/0/default.jpg', url: 'https://www.artic.edu/artworks/' + o.id,
      w: o.thumbnail && o.thumbnail.width, h: o.thumbnail && o.thumbnail.height,
      type: classifyType([o.artwork_type_title, o.classification_title, o.medium_display].join(' ')), pd: o.is_public_domain !== false, license: o.is_public_domain !== false ? 'Dominio público (CC0)' : 'Con derechos de autor'
    });
  });
}

const CMA_TYPE = { painting: 'Painting', drawing: 'Drawing', print: 'Print', photo: 'Photograph', sculpture: 'Sculpture', decorative: 'Ceramic' };
async function cmaFetch(plan, f, ctx) {
  const base = 'https://openaccess-api.clevelandart.org/api/artworks/';
  const p = new URLSearchParams({ has_image: '1' });
  if (!ctx.anyRights) p.set('cc0', '1');
  const text = [plan.style && plan.style.q, plan.keyword].filter(Boolean).join(' ');
  if (text) p.set('q', text);
  const artist = plan.artist || plan.hintArtist;
  if (artist) p.set('artists', artist);
  if (CMA_TYPE[plan.type]) p.set('type', CMA_TYPE[plan.type]);
  if (plan.range) { p.set('created_after', plan.range[0]); p.set('created_before', plan.range[1]); }
  const total = await memo('cma:' + p, async () => (await getJSON(base + '?' + p + '&limit=1')).info.total);
  if (!total) return [];
  const limit = 24;
  const skip = rand(Math.max(1, total - limit + 1));
  const j = await getJSON(base + '?' + p + '&limit=' + limit + '&skip=' + skip);
  return (j.data || []).filter(o => o.images && (o.images.print || o.images.web)).map(o => {
    const web = o.images.web, print = o.images.print;
    const creator = o.creators && o.creators[0] ? String(o.creators[0].description || '').replace(/\s*\(.*$/, '') : '';
    return mk({
      src: 'cma', museum: 'Cleveland Museum of Art', id: o.id,
      title: o.title, artist: creator, date: o.creation_date,
      year: o.creation_date_earliest != null && o.creation_date_latest != null ? Math.round((o.creation_date_earliest + o.creation_date_latest) / 2) : parseYear(o.creation_date),
      imgs: [print && print.url, web && web.url], thumb: web && web.url, url: o.url,
      w: web && num(web.width), h: web && num(web.height),
      type: classifyType([o.type, o.technique].join(' ')), pd: o.share_license_status === 'CC0', license: o.share_license_status === 'CC0' ? 'Dominio público (CC0)' : 'Con derechos de autor'
    });
  });
}

const SMK_WORDS = { painting: 'painting', drawing: 'drawing', print: 'print', photo: 'photograph', sculpture: 'sculpture' };
async function smkFetch(plan, f, ctx) {
  const base = 'https://api.smk.dk/api/v1/art/search/';
  const text = [plan.style && plan.style.q, plan.artist || plan.hintArtist, plan.keyword].filter(Boolean).join(' ');
  const filters = ctx.anyRights ? '[has_image:true]' : '[has_image:true],[public_domain:true]';
  const q = (keys, rows, offset) => base + '?' + new URLSearchParams({ keys, filters, rows: String(rows), offset: String(offset), lang: 'en' });
  let keys = text || '*';
  let found;
  try { found = await memo('smk:' + keys, async () => (await getJSON(q(keys, 1, 0))).found); }
  catch (e) { if (keys === '*') { keys = pick(GENERIC); found = await memo('smk:' + keys, async () => (await getJSON(q(keys, 1, 0))).found); } else throw e; }
  if (!found) return [];
  const rows = 40;
  const offset = rand(Math.max(1, Math.min(found - rows + 1, 9000)));
  const j = await getJSON(q(keys, rows, offset));
  const want = SMK_WORDS[plan.type];
  return (j.items || []).filter(o => o.has_image && (ctx.anyRights || o.public_domain !== false)).map(o => {
    const t = (o.titles || []).find(x => /engelsk|english/i.test(x.language || '')) || (o.titles || [])[0];
    const prod = (o.production || [])[0];
    const pd = (o.production_date || [])[0];
    const names = (o.object_names || []).map(x => x.name).join(' ') + ' ' + (o.techniques || []).join(' ') + ' ' + (o.materials || []).join(' ');
    const iiif = o.image_iiif_id;
    return mk({
      src: 'smk', museum: 'SMK, Copenhague', id: o.object_number,
      title: t && t.title, artist: (o.artist && o.artist[0]) || (prod && flipName(prod.creator)) || '',
      date: pd && pd.period, year: pd && pd.start ? parseYear(pd.start.slice(0, 4)) : null,
      imgs: [iiif ? iiif + '/full/!' + (ctx.hq ? 3000 : 2000) + ',/0/default.jpg' : null, o.image_thumbnail, o.image_native].filter(Boolean),
      thumb: o.image_thumbnail, url: o.frontend_url, w: o.image_width, h: o.image_height,
      type: classifyType(names), pd: o.public_domain !== false, license: o.public_domain !== false ? 'Dominio público' : 'Con derechos de autor'
    });
  }).filter(w => !want || !w.type || w.type === plan.type || Math.random() < 0.15);
}

const VAM_CAT = { painting: 'THES48917', print: 'THES48903', photo: 'THES48910' };
const VAM_OBJ = { drawing: 'drawing', sculpture: 'sculpture', decorative: 'ceramic' };
async function vamFetch(plan, f, ctx) {
  const base = 'https://api.vam.ac.uk/v2/objects/search';
  const p = new URLSearchParams({ images_exist: '1' });
  const text = [plan.style && plan.style.q, plan.keyword].filter(Boolean).join(' ');
  if (text) p.set('q', text);
  const artist = plan.artist || plan.hintArtist;
  if (artist) p.set('q_actor', artist);
  if (VAM_CAT[plan.type]) p.set('id_category', VAM_CAT[plan.type]);
  else if (VAM_OBJ[plan.type]) p.set('q_object_type', VAM_OBJ[plan.type]);
  const withDates = new URLSearchParams(p);
  if (plan.range) { withDates.set('year_made_from', plan.range[0]); withDates.set('year_made_to', plan.range[1]); }
  let use = withDates;
  let info;
  try { info = await memo('vam:' + use, async () => (await getJSON(base + '?' + use + '&page_size=1')).info); }
  catch (e) { if (e.status && e.status >= 400 && e.status < 500 && plan.range) { use = p; info = await memo('vam:' + use, async () => (await getJSON(base + '?' + use + '&page_size=1')).info); } else throw e; }
  const total = info && info.record_count;
  if (!total) return [];
  const size = 24;
  const pages = Math.max(1, Math.min(Math.ceil(total / size), 400));
  const j = await getJSON(base + '?' + use + '&page_size=' + size + '&page=' + (1 + rand(pages)));
  return (j.records || []).filter(o => o._primaryImageId).map(o => {
    const root = 'https://framemark.vam.ac.uk/collections/' + o._primaryImageId + '/full/';
    return mk({
      src: 'vam', museum: 'Victoria and Albert Museum', id: o.systemNumber,
      title: o._primaryTitle || o.objectType, artist: flipName(o._primaryMaker && o._primaryMaker.name),
      date: o._primaryDate, imgs: [root + '!' + (ctx.hq ? 3000 : 1800) + ',' + (ctx.hq ? 3000 : 1800) + '/0/default.jpg'],
      thumb: root + '!500,500/0/default.jpg', url: 'https://collections.vam.ac.uk/item/' + o.systemNumber,
      type: classifyType(o.objectType), pd: null, license: 'V&A (uso no comercial)'
    });
  });
}

const MIA_CLASS = { painting: 'Painting', drawing: 'Drawing', print: 'Print', photo: 'Photograph', sculpture: 'Sculpture' };
async function miaFetch(plan, f, ctx) {
  const text = [plan.style && plan.style.q, plan.artist || plan.hintArtist, plan.keyword].filter(Boolean).join(' ') || pick(GENERIC);
  const url = (from, size) => 'https://search.artsmia.org/' + encodeURIComponent(text) + '?size=' + size + '&from=' + from;
  const total = await memo('mia:' + text, async () => { const j = await getJSON(url(0, 1)); return j.hits && j.hits.total ? (j.hits.total.value != null ? j.hits.total.value : j.hits.total) : 0; });
  if (!total) return [];
  const size = 60;
  const from = rand(Math.max(1, Math.min(total - size + 1, 9000)));
  const j = await getJSON(url(from, size));
  const want = MIA_CLASS[plan.type];
  return ((j.hits && j.hits.hits) || []).map(h => h._source).filter(o => o && o.image === 'valid' && (ctx.anyRights || o.rights_type === 'Public Domain') && o.image_width && o.image_height).map(o => {
    const iiif = 'https://iiif.dx.artsmia.org/' + o.id + '.jpg/full/';
    return mk({
      src: 'mia', museum: 'Minneapolis Institute of Art', id: o.id,
      title: o.title, artist: o.artist || '', date: o.dated,
      imgs: [iiif + '!' + (ctx.hq ? 3000 : 1800) + ',' + (ctx.hq ? 3000 : 1800) + '/0/default.jpg', 'https://1.api.artsmia.org/' + o.id + '.jpg'],
      thumb: iiif + '!500,500/0/default.jpg', url: 'https://collections.artsmia.org/art/' + o.id,
      w: o.image_width, h: o.image_height, type: classifyType([o.classification, o.medium].join(' ')), pd: o.rights_type === 'Public Domain', license: o.rights_type === 'Public Domain' ? 'Dominio público' : 'Con derechos de autor'
    });
  }).filter(w => !want || !w.type || w.type === plan.type);
}

const RIJKS_TYPE = { painting: 'painting', drawing: 'drawing', print: 'print', photo: 'photograph', sculpture: 'sculpture', decorative: 'ceramic' };
const RIJKS_EN = '300388277';
function rijksNum(id) { return String(id).split('/').pop(); }
async function rijksLD(id) { return getJSON('https://data.rijksmuseum.nl/' + rijksNum(id), { headers: { Accept: 'application/ld+json' } }); }
function rijksName(o) {
  const names = (o.identified_by || []).filter(x => x.type === 'Name' && x.content);
  const en = names.find(x => JSON.stringify(x.language || []).includes(RIJKS_EN));
  return (en || names[0] || {}).content || '';
}
function rijksArtist(o) {
  const pb = o.produced_by || {};
  const who = pb.part && pb.part[0] && pb.part[0].carried_out_by && pb.part[0].carried_out_by[0];
  if (who && who.notation) { const n = [].concat(who.notation); const en = n.find(x => x['@language'] === 'en') || n[0]; if (en && en['@value']) return en['@value']; }
  const ref = (pb.referred_to_by || [])[0];
  return ref ? ref.content : '';
}
async function rijksFetch(plan, f, ctx) {
  const p = new URLSearchParams({ imageAvailable: 'true' });
  if (RIJKS_TYPE[plan.type]) p.set('type', RIJKS_TYPE[plan.type]);
  const artist = plan.artist || plan.hintArtist;
  if (artist) p.set('creator', artist);
  const d = [plan.style && plan.style.q, plan.keyword].filter(Boolean).join(' ');
  if (d) p.set('description', d);
  let y = plan.range ? plan.range[0] + rand(plan.range[1] - plan.range[0] + 1) : 1500 + rand(400);
  y = Math.min(Math.max(y, 1000), 2020);
  p.set('creationDate', Math.floor(y / 10) + '?');
  const j = await getJSON('https://data.rijksmuseum.nl/search/collection?' + p);
  const ids = (j.orderedItems || []).map(x => x.id);
  if (!ids.length) return [];
  const chosen = sampleN(ids, 8);
  const out = await mapLimit(chosen, 4, async id => {
    const o = await rijksLD(id);
    const vis = (o.shows || [])[0];
    if (!vis) return null;
    const v = await rijksLD(vis.id);
    const dig = (v.digitally_shown_by || [])[0];
    if (!dig) return null;
    const dj = await rijksLD(dig.id);
    const m = JSON.stringify(dj).match(/iiif\.micr\.io\/([A-Za-z0-9_-]+)/);
    if (!m) return null;
    const ts = o.produced_by && o.produced_by.timespan;
    const date = ts && ts.identified_by && ts.identified_by[0] && ts.identified_by[0].content;
    const typeName = ((o.classified_as || [])[0] || {}).notation;
    const page = (JSON.stringify(o).match(/https:\/\/www\.rijksmuseum\.nl\/[^"]*collectie[^"]*|https:\/\/www\.rijksmuseum\.nl\/[^"]*collection[^"]*/) || [])[0];
    const root = 'https://iiif.micr.io/' + m[1] + '/full/';
    return mk({
      src: 'rijks', museum: 'Rijksmuseum', id: rijksNum(id),
      title: rijksName(o), artist: rijksArtist(o), date, year: ts && ts.begin_of_the_begin ? parseInt(ts.begin_of_the_begin.slice(0, 4), 10) : parseYear(date),
      imgs: [root + '!' + (ctx.hq ? 4000 : 2000) + ',' + (ctx.hq ? 4000 : 2000) + '/0/default.jpg'],
      thumb: root + '!500,500/0/default.jpg', url: page || ('https://id.rijksmuseum.nl/' + rijksNum(id)),
      type: classifyType(JSON.stringify(typeName || '')), pd: true, license: 'Dominio público (CC0)'
    });
  });
  return out.filter(Boolean);
}

const WD_TYPE = { painting: 'Q3305213', drawing: 'Q93184', print: 'Q11060274', sculpture: 'Q860861', photo: 'Q125191' };
const WD_NAME = { Q3305213: 'painting', Q93184: 'drawing', Q11060274: 'print', Q860861: 'sculpture', Q125191: 'photo' };

/* Museos famosos. Se localizan por el nombre de su ficha en Wikidata (no por código), y las obras
   se buscan con "colección = ese museo" más imagen en Commons. */
const MUSEUMS = [
  { id: 'met', es: 'The Met', city: 'Nueva York', ids: [], direct: 'met', labels: [['Metropolitan Museum of Art', 'en'], ['The Metropolitan Museum of Art', 'en']], q: 'Metropolitan Museum of Art' },
  { id: 'aic', es: 'Art Institute of Chicago', city: 'Chicago', ids: [], direct: 'aic', labels: [['Art Institute of Chicago', 'en']] },
  { id: 'cma', es: 'Cleveland Museum of Art', city: 'Cleveland', ids: [], direct: 'cma', labels: [['Cleveland Museum of Art', 'en']] },
  { id: 'rijks', es: 'Rijksmuseum', city: 'Ámsterdam', ids: [], direct: 'rijks', labels: [['Rijksmuseum', 'en'], ['Rijksmuseum', 'nl']] },
  { id: 'vam', es: 'Victoria and Albert Museum', city: 'Londres', ids: [], direct: 'vam', labels: [['Victoria and Albert Museum', 'en']] },
  { id: 'smk', es: 'SMK (Copenhague)', city: 'Copenhague', ids: [], direct: 'smk', labels: [['Statens Museum for Kunst', 'en'], ['Statens Museum for Kunst', 'da']] },
  { id: 'mia', es: 'Minneapolis Institute of Art', city: 'Minneapolis', ids: [], direct: 'mia', labels: [['Minneapolis Institute of Art', 'en']] },
  { id: 'si', es: 'Smithsonian (SAAM, Freer, Hirshhorn, NPG)', city: 'Washington', ids: [], direct: 'si', labels: [['Smithsonian American Art Museum', 'en'], ['Freer Gallery of Art', 'en'], ['Hirshhorn Museum and Sculpture Garden', 'en']], q: 'Smithsonian American Art Museum', needsKey: 'si' },
  { id: 'harvard', es: 'Harvard Art Museums', city: 'Cambridge (EE. UU.)', ids: [], direct: 'harvard', labels: [['Harvard Art Museums', 'en']], needsKey: 'harvard' },
  { id: 'open', es: 'Colecciones abiertas', city: 'WikiArt, Commons, Wikidata y Europeana', ids: [], open: true, labels: [], q: '', note: 'No distinguen museos: se mezclan con cualquier museo' },
  { id: 'louvre', es: 'Louvre', city: 'París', ids: ['Q19675'], labels: [['Louvre', 'en'], ['Musée du Louvre', 'fr'], ['Louvre Museum', 'en']] },
  { id: 'orsay', es: 'Orsay', city: 'París', ids: ['Q23402'], labels: [["Musée d'Orsay", 'fr'], ["Musée d'Orsay", 'en'], ['Orsay Museum', 'en']] },
  { id: 'versailles', es: 'Versalles', city: 'Versalles', ids: ['Q2946'], labels: [['Palace of Versailles', 'en'], ['Château de Versailles', 'fr'], ['Musée national des châteaux de Versailles et de Trianon', 'fr']] },
  { id: 'orangerie', es: 'Orangerie', city: 'París', ids: [], labels: [["Musée de l'Orangerie", 'fr'], ["Musée de l'Orangerie", 'en'], ['Orangerie Museum', 'en']] },
  { id: 'marmottan', es: 'Marmottan Monet', city: 'París', ids: [], labels: [['Musée Marmottan Monet', 'fr'], ['Musée Marmottan Monet', 'en']] },
  { id: 'petitpalais', es: 'Petit Palais', city: 'París', ids: [], labels: [['Petit Palais', 'fr'], ['Petit Palais', 'en']] },
  { id: 'carnavalet', es: 'Carnavalet', city: 'París', ids: [], labels: [['Musée Carnavalet', 'fr'], ['Musée Carnavalet', 'en'], ['Carnavalet Museum', 'en']] },
  { id: 'lyon', es: 'Bellas Artes de Lyon', city: 'Lyon', ids: [], labels: [['Musée des Beaux-Arts de Lyon', 'fr'], ['Museum of Fine Arts of Lyon', 'en']] },
  { id: 'prado', es: 'Prado', city: 'Madrid', ids: ['Q160112'], labels: [['Museo del Prado', 'es'], ['Prado Museum', 'en'], ['Museo Nacional del Prado', 'es']] },
  { id: 'thyssen', es: 'Thyssen-Bornemisza', city: 'Madrid', ids: [], labels: [['Museo Thyssen-Bornemisza', 'es'], ['Thyssen-Bornemisza Museum', 'en']] },
  { id: 'uffizi', es: 'Uffizi', city: 'Florencia', ids: ['Q51252'], labels: [['Uffizi Gallery', 'en'], ['Galleria degli Uffizi', 'it'], ['Uffizi', 'en']] },
  { id: 'brera', es: 'Pinacoteca de Brera', city: 'Milán', ids: [], labels: [['Pinacoteca di Brera', 'it'], ['Brera Art Gallery', 'en']] },
  { id: 'hermitage', es: 'Hermitage', city: 'San Petersburgo', ids: ['Q132783'], labels: [['Hermitage Museum', 'en'], ['State Hermitage Museum', 'en'], ["Musée de l'Ermitage", 'fr']] },
  { id: 'tretyakov', es: 'Galería Tretyakov', city: 'Moscú', ids: [], labels: [['Tretyakov Gallery', 'en'], ['State Tretyakov Gallery', 'en']] },
  { id: 'nationalgallery', es: 'National Gallery', city: 'Londres', ids: ['Q180788'], labels: [['National Gallery', 'en']] },
  { id: 'courtauld', es: 'Courtauld', city: 'Londres', ids: [], labels: [['Courtauld Gallery', 'en'], ['Courtauld Institute of Art Gallery', 'en']] },
  { id: 'wallace', es: 'Wallace Collection', city: 'Londres', ids: [], labels: [['Wallace Collection', 'en']] },
  { id: 'vangogh', es: 'Museo Van Gogh', city: 'Ámsterdam', ids: ['Q224124'], labels: [['Van Gogh Museum', 'en'], ['Van Gogh Museum', 'nl']] },
  { id: 'mauritshuis', es: 'Mauritshuis', city: 'La Haya', ids: [], labels: [['Mauritshuis', 'en'], ['Mauritshuis', 'nl']] },
  { id: 'kunsthistorisches', es: 'Kunsthistorisches', city: 'Viena', ids: [], labels: [['Kunsthistorisches Museum', 'de'], ['Kunsthistorisches Museum', 'en']] },
  { id: 'belvedere', es: 'Belvedere', city: 'Viena', ids: [], labels: [['Österreichische Galerie Belvedere', 'de'], ['Belvedere', 'en'], ['Belvedere Museum', 'en']] },
  { id: 'altepinakothek', es: 'Alte Pinakothek', city: 'Múnich', ids: [], labels: [['Alte Pinakothek', 'de'], ['Alte Pinakothek', 'en']] },
  { id: 'dresden', es: 'Pinacoteca de Dresde', city: 'Dresde', ids: [], labels: [['Gemäldegalerie Alte Meister', 'de'], ['Old Masters Picture Gallery', 'en']] },
  { id: 'nationalmuseum', es: 'Nationalmuseum', city: 'Estocolmo', ids: [], labels: [['Nationalmuseum', 'sv'], ['Nationalmuseum', 'en']] },
  { id: 'nga', es: 'National Gallery of Art', city: 'Washington', ids: [], labels: [['National Gallery of Art', 'en']] },
  { id: 'mfa', es: 'Museum of Fine Arts', city: 'Boston', ids: [], labels: [['Museum of Fine Arts, Boston', 'en'], ['Museum of Fine Arts', 'en']] },
  { id: 'frick', es: 'Frick Collection', city: 'Nueva York', ids: [], labels: [['Frick Collection', 'en'], ['The Frick Collection', 'en']] },
  { id: 'pompidou', es: 'Centre Pompidou', city: 'París', ids: [], labels: [['Centre Pompidou', 'fr'], ['Centre Pompidou', 'en'], ["Musée national d'art moderne", 'fr']] },
  { id: 'rodin', es: 'Musée Rodin', city: 'París', ids: [], labels: [['Musée Rodin', 'fr'], ['Rodin Museum', 'en']] },
  { id: 'picassoparis', es: 'Museo Picasso de París', city: 'París', ids: [], labels: [['Musée national Picasso-Paris', 'fr'], ['Musée Picasso', 'fr']] },
  { id: 'jacquemart', es: 'Jacquemart-André', city: 'París', ids: [], labels: [['Musée Jacquemart-André', 'fr'], ['Musée Jacquemart-André', 'en']] },
  { id: 'guimet', es: 'Musée Guimet', city: 'París', ids: [], labels: [['Musée Guimet', 'fr'], ['Guimet Museum', 'en']] },
  { id: 'lille', es: 'Bellas Artes de Lille', city: 'Lille', ids: [], labels: [['Palais des Beaux-Arts de Lille', 'fr']] },
  { id: 'fabre', es: 'Museo Fabre', city: 'Montpellier', ids: [], labels: [['Musée Fabre', 'fr'], ['Musée Fabre', 'en']] },
  { id: 'rouen', es: 'Bellas Artes de Ruan', city: 'Ruan', ids: [], labels: [['Musée des Beaux-Arts de Rouen', 'fr']] },
  { id: 'moma', es: 'MoMA', city: 'Nueva York', ids: [], labels: [['Museum of Modern Art', 'en'], ['Museum of Modern Art', 'es']] },
  { id: 'guggenheim', es: 'Guggenheim Nueva York', city: 'Nueva York', ids: [], labels: [['Solomon R. Guggenheim Museum', 'en'], ['Guggenheim Museum', 'en']] },
  { id: 'whitney', es: 'Whitney', city: 'Nueva York', ids: [], labels: [['Whitney Museum of American Art', 'en']] },
  { id: 'getty', es: 'J. Paul Getty Museum', city: 'Los Ángeles', ids: [], labels: [['J. Paul Getty Museum', 'en'], ['Getty Center', 'en']] },
  { id: 'lacma', es: 'LACMA', city: 'Los Ángeles', ids: [], labels: [['Los Angeles County Museum of Art', 'en']] },
  { id: 'pma', es: 'Philadelphia Museum of Art', city: 'Filadelfia', ids: [], labels: [['Philadelphia Museum of Art', 'en']] },
  { id: 'ngc', es: 'Galería Nacional de Canadá', city: 'Ottawa', ids: [], labels: [['National Gallery of Canada', 'en'], ['Musée des beaux-arts du Canada', 'fr']] },
  { id: 'tate', es: 'Tate', city: 'Londres', ids: [], labels: [['Tate Britain', 'en'], ['Tate Modern', 'en'], ['Tate', 'en']], q: 'Tate' },
  { id: 'britishmuseum', es: 'British Museum', city: 'Londres', ids: [], labels: [['British Museum', 'en']] },
  { id: 'reinasofia', es: 'Reina Sofía', city: 'Madrid', ids: [], labels: [['Museo Nacional Centro de Arte Reina Sofía', 'es'], ['Museo Reina Sofía', 'es'], ['Museo Nacional Centro de Arte Reina Sofía', 'en']] },
  { id: 'bilbao', es: 'Bellas Artes de Bilbao', city: 'Bilbao', ids: [], labels: [['Museo de Bellas Artes de Bilbao', 'es'], ['Bilbao Fine Arts Museum', 'en']] },
  { id: 'gulbenkian', es: 'Gulbenkian', city: 'Lisboa', ids: [], labels: [['Calouste Gulbenkian Museum', 'en'], ['Museu Calouste Gulbenkian', 'pt']] },
  { id: 'borghese', es: 'Galería Borghese', city: 'Roma', ids: [], labels: [['Galleria Borghese', 'it'], ['Galleria Borghese', 'en']] },
  { id: 'accademia', es: 'Gallerie dell’Accademia', city: 'Venecia', ids: [], labels: [["Gallerie dell'Accademia", 'it'], ["Gallerie dell'Accademia", 'en']] },
  { id: 'peggy', es: 'Colección Peggy Guggenheim', city: 'Venecia', ids: [], labels: [['Peggy Guggenheim Collection', 'en'], ['Collezione Peggy Guggenheim', 'it']] },
  { id: 'staedel', es: 'Städel', city: 'Fráncfort', ids: [], labels: [['Städel Museum', 'de'], ['Städel Museum', 'en']] },
  { id: 'zurich', es: 'Kunsthaus Zürich', city: 'Zúrich', ids: [], labels: [['Kunsthaus Zürich', 'de'], ['Kunsthaus Zürich', 'en']] },
  { id: 'basel', es: 'Kunstmuseum Basel', city: 'Basilea', ids: [], labels: [['Kunstmuseum Basel', 'de'], ['Kunstmuseum Basel', 'en']] },
  { id: 'albertina', es: 'Albertina', city: 'Viena', ids: [], labels: [['Albertina', 'de'], ['Albertina', 'en']] },
  { id: 'munch', es: 'Museo Munch', city: 'Oslo', ids: [], labels: [['Munch Museum', 'en'], ['Munchmuseet', 'no']] },
  { id: 'ateneum', es: 'Ateneum', city: 'Helsinki', ids: [], labels: [['Ateneum', 'fi'], ['Ateneum', 'en']] },
  { id: 'boijmans', es: 'Boijmans Van Beuningen', city: 'Róterdam', ids: [], labels: [['Museum Boijmans Van Beuningen', 'nl'], ['Museum Boijmans Van Beuningen', 'en']] },
  { id: 'kroller', es: 'Kröller-Müller', city: 'Otterlo', ids: [], labels: [['Kröller-Müller Museum', 'nl'], ['Kröller-Müller Museum', 'en']] },
  { id: 'pushkin', es: 'Museo Pushkin', city: 'Moscú', ids: [], labels: [['Pushkin State Museum of Fine Arts', 'en'], ['Pushkin Museum', 'en']] },
  { id: 'tokyo', es: 'Museo Nacional de Tokio', city: 'Tokio', ids: [], labels: [['Tokyo National Museum', 'en'], ['Tokyo National Museum', 'ja']] },
  { id: 'soumaya', es: 'Museo Soumaya', city: 'Ciudad de México', ids: [], labels: [['Museo Soumaya', 'es'], ['Museo Soumaya', 'en']] },
  { id: 'masp', es: 'MASP', city: 'São Paulo', ids: [], labels: [['Museu de Arte de São Paulo', 'pt'], ['São Paulo Museum of Art', 'en']] },
  { id: 'mnba', es: 'Bellas Artes de Buenos Aires', city: 'Buenos Aires', ids: [], labels: [['Museo Nacional de Bellas Artes', 'es']] },
  { id: 'ngv', es: 'National Gallery of Victoria', city: 'Melbourne', ids: [], labels: [['National Gallery of Victoria', 'en']] },
  { id: 'agnsw', es: 'Art Gallery of New South Wales', city: 'Sídney', ids: [], labels: [['Art Gallery of New South Wales', 'en']] },
  { id: 'scotland', es: 'National Galleries of Scotland', city: 'Edimburgo', ids: [], labels: [['Scottish National Gallery', 'en'], ['National Galleries of Scotland', 'en']] },
  { id: 'irelandng', es: 'Galería Nacional de Irlanda', city: 'Dublín', ids: [], labels: [['National Gallery of Ireland', 'en']] },
];

/* Máximo 2 consultas a Wikidata a la vez: el servicio corta a quien abusa. */
let sparqlActive = 0; const sparqlQueue = [];
const sparqlSlot = () => new Promise(res => { if (sparqlActive < 2) { sparqlActive++; res(); } else sparqlQueue.push(res); });
const sparqlDone = () => { const n = sparqlQueue.shift(); if (n) n(); else sparqlActive--; };
const sparqlEsc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
async function sparql(q) {
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q);
  const go = async () => (await getJSON(url, {}, 40000)).results.bindings;
  await sparqlSlot();
  try {
    try { return await go(); }
    catch (e) { if (e && e.status === 429) { await new Promise(r => setTimeout(r, 2500)); return await go(); } throw e; }
  } finally { sparqlDone(); }
}

/* Piezas de la consulta. opts: museum (limita a su colección), anyRights (acepta obras con derechos),
   byType (restringe a un tipo de obra; si no, entra todo lo que tenga imagen). */
function wdParts(plan, opts) {
  const typeQ = opts.byType ? (WD_TYPE[plan.type] || 'Q3305213') : null;
  let style = plan.style;
  const m = opts.museum;
  const artist = plan.artist;
  const parts = [];
  if (m) {
    const blocks = [];
    if (m.ids.length) blocks.push('{ VALUES ?coll { ' + m.ids.map(q => 'wd:' + q).join(' ') + ' } }');
    blocks.push('{ VALUES ?lbl { ' + m.labels.map(l => '"' + sparqlEsc(l[0]) + '"@' + l[1]).join(' ') + ' } ?coll rdfs:label ?lbl. }');
    parts.push(blocks.join(' UNION ') + ' ?item wdt:P195 ?coll.');
  } else if (!style && !artist && !plan.hintArtist) style = pick(STYLES);
  // Pocas obras tienen movimiento propio en Wikidata; muchos autores sí: se acepta cualquiera de los dos.
  if (style) parts.push('?mv rdfs:label "' + sparqlEsc(style.wd) + '"@en. { ?item wdt:P135 ?mv. } UNION { ?item wdt:P170 ?cr0. ?cr0 wdt:P135 ?mv. }');
  if (artist) parts.push('SERVICE wikibase:mwapi { bd:serviceParam wikibase:endpoint "www.wikidata.org"; bd:serviceParam wikibase:api "EntitySearch"; bd:serviceParam mwapi:search "' + sparqlEsc(artist) + '"; bd:serviceParam mwapi:language "en"; ?creator wikibase:apiOutputItem mwapi:item. } ?item wdt:P170 ?creator.');
  else parts.push('OPTIONAL { ?item wdt:P170 ?creator. }');
  parts.push(typeQ ? '?item wdt:P31 wd:' + typeQ + '.' : 'OPTIONAL { ?item wdt:P31 ?cls. }');
  // P18 = imagen en Commons. P6500 = imagen externa de obras con derechos de autor.
  parts.push(opts.anyRights ? '{ ?item wdt:P18 ?image. } UNION { ?item wdt:P6500 ?image. }' : '?item wdt:P18 ?image.');
  parts.push('OPTIONAL { ?item wdt:P571 ?inc. } OPTIONAL { ?creator wdt:P570 ?death. }' + (m ? '' : ' OPTIONAL { ?item wdt:P195 ?coll. }'));
  if (plan.range) {
    const yr = 'YEAR(?inc) >= ' + Math.round(plan.range[0]) + ' && YEAR(?inc) <= ' + Math.round(plan.range[1]);
    // Con un estilo elegido, las obras sin fecha en Wikidata también valen.
    parts.push(style ? 'FILTER(!BOUND(?inc) || (' + yr + ')).' : 'FILTER(BOUND(?inc) && ' + yr + ').');
  }
  if (!opts.anyRights) parts.push('FILTER((BOUND(?inc) && YEAR(?inc) <= 1930) || (BOUND(?death) && YEAR(?death) <= 1955)).');
  return { parts, typeQ };
}
function wdSelect(parts, off, withClass) {
  return 'SELECT ?item ?itemLabel ?creatorLabel ?collLabel ' + (withClass ? '?clsLabel ' : '') + '?image ?inc WHERE { ' + parts.join(' ') + ' SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en,fr". } } LIMIT 60 OFFSET ' + off;
}
const FILEPATH = /commons\.wikimedia\.org\/wiki\/Special:FilePath\//i;
function wdRows(rows, typeQ, ctx, museumName, anyRights) {
  const seen = new Set();
  const w = ctx.hq ? 3840 : 2000;
  return rows.filter(r => {
    if (!r.image || !r.item || seen.has(r.item.value)) return false;
    const u = r.image.value;
    if (FILEPATH.test(u) && !/\.(jpe?g|png|webp|gif)$/i.test(u)) return false; // sin tiff, pdf, svg, vídeo ni audio
    seen.add(r.item.value); return true;
  }).map(r => {
    const raw = r.image.value.replace(/^http:/, 'https:');
    const commons = FILEPATH.test(raw);
    const qid = r.item.value.split('/').pop();
    const label = r.itemLabel && r.itemLabel.value;
    return mk({
      src: 'wiki', museum: museumName || (r.collLabel && r.collLabel.value) || 'Wikimedia Commons', id: qid,
      title: /^Q\d+$/.test(label || '') ? '' : label, artist: r.creatorLabel && !/^Q\d+$/.test(r.creatorLabel.value) ? r.creatorLabel.value : '',
      date: r.inc ? r.inc.value.slice(0, 4).replace(/^0+/, '') : '', year: r.inc ? parseInt(r.inc.value, 10) : null,
      imgs: commons ? [raw + '?width=' + w, raw + '?width=1200'] : [raw], thumb: commons ? raw + '?width=500' : raw,
      url: 'https://www.wikidata.org/wiki/' + qid,
      type: typeQ ? WD_NAME[typeQ] : classifyType(r.clsLabel && r.clsLabel.value),
      pd: anyRights ? null : true, license: commons ? (anyRights ? 'Imagen de Wikimedia Commons' : 'Dominio público (Wikimedia)') : 'Imagen externa, con derechos de autor'
    });
  });
}

async function wikiFetch(plan, f, ctx) {
  const any = !!ctx.anyRights;
  const { parts, typeQ } = wdParts(plan, { anyRights: any, byType: true });
  let rows = await sparql(wdSelect(parts, rand(400), false));
  if (rows.length < 8) rows = await sparql(wdSelect(parts, 0, false));
  return wdRows(rows, typeQ, ctx, null, any);
}

/* Un Wikidata por museo: todas las obras de su colección que tengan imagen. */
async function wikidataMuseum(m, plan, f, ctx) {
  const any = !!ctx.anyRights;
  const { parts, typeQ } = wdParts(plan, { museum: m, anyRights: any, byType: !!(f.types && f.types.length) });
  const countQ = 'SELECT (COUNT(DISTINCT ?item) AS ?n) WHERE { ' + parts.join(' ') + ' }';
  const total = await memo('fm:' + countQ, async () => { const r = await sparql(countQ); return r[0] && r[0].n ? parseInt(r[0].n.value, 10) : 0; });
  if (!total) return [];
  const rows = await sparql(wdSelect(parts, rand(Math.max(1, total - 59)), !typeQ));
  return wdRows(rows, typeQ, ctx, m.es + ' (' + m.city + ')', any);
}

async function europeanaFetch(plan, f, ctx) {
  const key = ctx.keys && ctx.keys.europeana;
  if (!key) { const e = new Error('Falta clave'); e.noKey = true; throw e; }
  const text = [plan.style && plan.style.q, plan.artist || plan.hintArtist, plan.keyword, plan.type === 'painting' ? 'painting' : ''].filter(Boolean).join(' ') || pick(GENERIC);
  const p = new URLSearchParams({ wskey: key, query: text, media: 'true', thumbnail: 'true', rows: '24' });
  if (!ctx.anyRights) p.set('reusability', 'open');
  p.append('qf', 'TYPE:IMAGE');
  if (plan.range) p.append('qf', 'YEAR:[' + Math.max(plan.range[0], 0) + ' TO ' + plan.range[1] + ']');
  const base = 'https://api.europeana.eu/record/v2/search.json?' + p;
  const total = await memo('eu:' + p, async () => (await getJSON(base + '&start=1&rows=1')).totalResults);
  if (!total) return [];
  const start = 1 + rand(Math.max(1, Math.min(total - 24, 970)));
  const j = await getJSON(base + '&start=' + start);
  return (j.items || []).filter(o => (o.edmIsShownBy || o.edmPreview) && o.title).map(o => {
    const rights = (o.rights || [])[0] || '';
    const date = (o.year || [])[0];
    return mk({
      src: 'europeana', museum: ((o.dataProvider || [])[0]) || 'Europeana', id: o.id,
      title: o.title[0], artist: (o.dcCreator || [])[0] ? flipName(o.dcCreator[0]) : '', date,
      imgs: [(o.edmIsShownBy || [])[0], (o.edmPreview || [])[0]], thumb: (o.edmPreview || [])[0], url: o.guid,
      type: classifyType(o.title.join(' ')), pd: /publicdomain|zero/.test(rights), license: /publicdomain|zero/.test(rights) ? 'Dominio público' : 'Licencia abierta'
    });
  });
}

async function siFetch(plan, f, ctx) {
  const key = ctx.keys && ctx.keys.si;
  if (!key) { const e = new Error('Falta clave'); e.noKey = true; throw e; }
  const text = [plan.style && plan.style.q, plan.artist || plan.hintArtist, plan.keyword].filter(Boolean).join(' ') || pick(GENERIC);
  const q = text + ' AND online_media_type:"Images" AND (unit_code:"SAAM" OR unit_code:"FSG" OR unit_code:"HMSG" OR unit_code:"NPG")';
  const base = 'https://api.si.edu/openaccess/api/v1.0/search?api_key=' + encodeURIComponent(key) + '&q=' + encodeURIComponent(q);
  const total = await memo('si:' + q, async () => (await getJSON(base + '&rows=1&start=0')).response.rowCount);
  if (!total) return [];
  const j = await getJSON(base + '&rows=24&start=' + rand(Math.max(1, Math.min(total - 24, 9000))));
  return ((j.response && j.response.rows) || []).map(r => r.content).filter(Boolean).map(c => {
    const d = c.descriptiveNonRepeating || {};
    const media = ((d.online_media || {}).media || []).find(m => m.type === 'Images' && m.content);
    if (!media || (!ctx.anyRights && media.usage && media.usage.access && media.usage.access !== 'CC0')) return null;
    const names = (c.freetext || {}).name || [], dates = (c.freetext || {}).date || [];
    return mk({
      src: 'si', museum: d.data_source || 'Smithsonian', id: d.record_ID || d.guid,
      title: d.title && d.title.content, artist: names[0] ? flipName(names[0].content) : '', date: dates[0] && dates[0].content,
      imgs: [media.content], thumb: media.thumbnail || media.content, url: d.record_link || d.guid,
      type: classifyType(JSON.stringify((c.freetext || {}).physicalDescription || '') + ' ' + JSON.stringify(((c.indexedStructured || {}).object_type) || '')),
      pd: !(media.usage && media.usage.access && media.usage.access !== 'CC0'), license: media.usage && media.usage.access && media.usage.access !== 'CC0' ? 'Con derechos de autor' : 'Dominio público (CC0)'
    });
  }).filter(Boolean);
}

const HARVARD_CLASS = { painting: 'Paintings', drawing: 'Drawings', print: 'Prints', photo: 'Photographs', sculpture: 'Sculpture' };
async function harvardFetch(plan, f, ctx) {
  const key = ctx.keys && ctx.keys.harvard;
  if (!key) { const e = new Error('Falta clave'); e.noKey = true; throw e; }
  const text = [plan.style && plan.style.q, plan.artist || plan.hintArtist, plan.keyword].filter(Boolean).join(' ');
  const p = new URLSearchParams({ apikey: key, hasimage: '1', size: '24', fields: 'id,title,people,dated,datebegin,dateend,primaryimageurl,classification,url,imagepermissionlevel' });
  const qs = ctx.anyRights ? [] : ['imagepermissionlevel:0'];
  if (text) p.set('keyword', text);
  if (HARVARD_CLASS[plan.type]) p.set('classification', HARVARD_CLASS[plan.type]);
  if (plan.range) qs.push('datebegin:[' + plan.range[0] + ' TO ' + plan.range[1] + ']');
  if (qs.length) p.set('q', qs.join(' AND '));
  const base = 'https://api.harvardartmuseums.org/object?' + p;
  const total = await memo('hv:' + p, async () => (await getJSON(base + '&size=1')).info.totalrecords);
  if (!total) return [];
  const pages = Math.max(1, Math.min(Math.ceil(total / 24), 300));
  const j = await getJSON(base + '&page=' + (1 + rand(pages)));
  return (j.records || []).filter(o => o.primaryimageurl).map(o => mk({
    src: 'harvard', museum: 'Harvard Art Museums', id: o.id, title: o.title,
    artist: o.people && o.people[0] ? flipName(o.people[0].displayname || o.people[0].name) : '', date: o.dated,
    year: o.datebegin != null && o.dateend != null && o.datebegin ? Math.round((o.datebegin + o.dateend) / 2) : parseYear(o.dated),
    imgs: [o.primaryimageurl + '?height=' + (ctx.hq ? 3000 : 1800) + '&width=' + (ctx.hq ? 3000 : 1800)], thumb: o.primaryimageurl + '?height=500&width=500',
    url: o.url, type: classifyType(o.classification), pd: false, license: 'Harvard (uso no comercial)'
  }));
}

/* Wikimedia Commons: búsqueda de archivos por categoría o texto (estilo, artista, tema). */
const stripTags = h => String(h == null ? '' : h).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const NOT_ART = /facade|façade|fachada|interior|exterior|entrance|entrada|building|edificio|bâtiment|\bhall\b|staircase|escalier|escalera|exhibition|exposition|panorama|street|\bmap\b|plan of|poster|logo|visitors|queue|ticket|banner|sign\b/i;
const COMMONS_KIND = { painting: 'painting', drawing: 'drawing', print: 'print', photo: 'photograph', sculpture: 'sculpture' };
const COMMONS_CAT = { painting: 'Paintings', drawing: 'Drawings', print: 'Prints', photograph: 'Photographs', sculpture: 'Sculptures' };
function commonsQueries(plan, f, m) {
  const q = [];
  const kind = COMMONS_KIND[plan.type] || 'painting';
  const tail = ' filetype:bitmap';
  if (m) {
    const name = '"' + m.q + '"', kw = plan.keyword ? ' ' + plan.keyword : '';
    if (plan.artist) q.push(name + ' "' + plan.artist + '"' + kw + tail);
    else {
      if (!plan.style && !kw) q.push('incategory:"' + COMMONS_CAT[kind] + ' in the ' + m.q + '"' + tail);
      if (plan.style) q.push(name + ' ' + plan.style.q + ' ' + kind + kw + tail);
      q.push(name + ' ' + kind + kw + tail);
    }
    return q;
  }
  if (plan.artist) q.push('"' + plan.artist + '" ' + kind + (plan.keyword ? ' ' + plan.keyword : '') + tail);
  else if (plan.style && plan.style.cat) {
    q.push('incategory:"' + plan.style.cat + '"' + (plan.keyword ? ' ' + plan.keyword : '') + tail);
    q.push((plan.style.q) + ' ' + kind + (plan.keyword ? ' ' + plan.keyword : '') + tail);
    if (plan.hintArtist) q.push('"' + plan.hintArtist + '" painting' + tail);
  } else if (plan.style) q.push(plan.style.q + ' ' + kind + tail);
  else q.push((plan.keyword || pick(GENERIC)) + ' ' + kind + ' museum' + tail);
  return q;
}
async function commonsFetch(plan, f, ctx, m) {
  const API = 'https://commons.wikimedia.org/w/api.php?format=json&formatversion=2&origin=*&action=query';
  const W = ctx.hq ? 3000 : 1800;
  let pages = [];
  for (const q of commonsQueries(plan, f, m)) {
    const total = await memo('cm:' + q, async () => {
      const j = await getJSON(API + '&list=search&srnamespace=6&srlimit=1&srprop=&srinfo=totalhits&srsearch=' + encodeURIComponent(q));
      return (j.query && j.query.searchinfo && j.query.searchinfo.totalhits) || 0;
    });
    if (!total) continue;
    const off = rand(Math.max(1, Math.min(total - 40, 9000)));
    const j = await getJSON(API + '&generator=search&gsrnamespace=6&gsrlimit=40&gsroffset=' + off + '&gsrsearch=' + encodeURIComponent(q) +
      '&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=' + W + '&iiextmetadatafilter=ObjectName|Artist|DateTimeOriginal|LicenseShortName');
    pages = (j.query && j.query.pages) || [];
    if (pages.length) break;
  }
  if (!Array.isArray(pages)) pages = Object.keys(pages).map(k => pages[k]);
  return pages.map(p => {
    const ii = p.imageinfo && p.imageinfo[0];
    if (!ii || !/^image\/(jpeg|png|webp|gif)$/.test(ii.mime || '') || (ii.width || 0) < 700 || (ii.height || 0) < 500) return null;
    const md = ii.extmetadata || {};
    const val = k => stripTags(md[k] && md[k].value);
    const lic = val('LicenseShortName');
    const name = String(p.title || '').replace(/^File:/, '').replace(/\.[a-z]+$/i, '').replace(/_/g, ' ');
    const title = val('ObjectName') || name;
    if (m && NOT_ART.test(name)) return null;
    const date = val('DateTimeOriginal');
    return mk({
      src: 'commons', museum: m ? m.es : 'Wikimedia Commons', id: p.pageid || p.title,
      title, artist: flipName(val('Artist')).slice(0, 80), date: date.slice(0, 40), year: parseYear(date),
      imgs: [ii.thumburl, ii.url], thumb: ii.thumburl, url: ii.descriptionurl || ('https://commons.wikimedia.org/wiki/' + encodeURIComponent(p.title || '')),
      w: ii.width, h: ii.height, type: classifyType(title) || (plan.type === 'painting' ? 'painting' : null),
      pd: /public domain|pd|cc0/i.test(lic) ? true : (lic ? false : null), license: lic || 'Wikimedia Commons'
    });
  }).filter(Boolean);
}

/* WikiArt: catálogo grande de pintura clasificado por estilo (respuesta JSON de su propia web). */
async function wikiartFetch(plan, f, ctx) {
  if ((f.artists && f.artists.length) || (f.keywords && f.keywords.length) || (f.types && f.types.length && !f.types.includes('painting'))) return [];
  const st = plan.style && plan.style.wa ? plan.style : pick(STYLES.filter(x => x.wa));
  const url = n => 'https://www.wikiart.org/en/paintings-by-style/' + st.wa + '?select=featured&json=2&layout=new&resultType=masonry&page=' + n;
  const first = await memo('wa:' + st.wa, () => getJSON(url(1)));
  const total = first.AllPaintingsCount || 0, size = first.PageSize || 60;
  const pages = Math.max(1, Math.min(Math.ceil(total / size), 40));
  const n = 1 + rand(pages);
  const j = n === 1 ? first : await getJSON(url(n));
  return (j.Paintings || []).filter(p => p.image && p.title).map(p => mk({
    src: 'wikiart', museum: 'WikiArt', id: p.id, title: p.title, artist: p.artistName, date: p.year,
    imgs: [p.image.replace(/!\w+\.jpg$/, ''), p.image], thumb: p.image + '!PinterestSmall.jpg',
    url: 'https://www.wikiart.org' + (p.paintingUrl || ''), w: p.width, h: p.height, type: 'painting',
    pd: null, license: 'WikiArt (obra con o sin derechos de autor)'
  }));
}

/* Wikipedia: artículos de obras que citan al museo; la imagen principal del artículo es la obra. */
const ART_DESC = /painting|sculpture|drawing|print\b|artwork|triptych|fresco|portrait|photograph|statue|relief|mural|watercolou?r|engraving|etching|lithograph|pastel|oil on|panel|altarpiece|still life|landscape/i;
async function wikipediaFetch(plan, f, ctx, m) {
  if (!m || !m.q) return [];
  const API = 'https://en.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*&action=query';
  const kind = COMMONS_KIND[plan.type] || 'painting', kw = plan.keyword ? ' ' + plan.keyword : '';
  const qs = [];
  if (plan.artist) qs.push('"' + m.q + '" "' + plan.artist + '"' + kw);
  else { if (plan.style) qs.push('"' + m.q + '" ' + plan.style.q + ' ' + kind + kw); qs.push('"' + m.q + '" ' + kind + kw); }
  let pages = [];
  for (const q of qs) {
    const total = await memo('wp:' + q, async () => {
      const j = await getJSON(API + '&list=search&srnamespace=0&srlimit=1&srprop=&srinfo=totalhits&srsearch=' + encodeURIComponent(q));
      return (j.query && j.query.searchinfo && j.query.searchinfo.totalhits) || 0;
    });
    if (!total) continue;
    const off = rand(Math.max(1, Math.min(total - 30, 900)));
    const j = await getJSON(API + '&generator=search&gsrnamespace=0&gsrlimit=30&gsroffset=' + off + '&gsrsearch=' + encodeURIComponent(q) +
      '&prop=pageimages|description&piprop=original|thumbnail&pithumbsize=' + (ctx.hq ? 2800 : 1600));
    pages = (j.query && j.query.pages) || [];
    if (pages.length) break;
  }
  if (!Array.isArray(pages)) pages = Object.keys(pages).map(k => pages[k]);
  return pages.map(p => {
    const o = p.original, t = p.thumbnail, desc = p.description || '';
    if (!o || !ART_DESC.test(desc) || (o.width || 0) < 700 || (o.height || 0) < 500) return null;
    if (!/\.(jpe?g|png|webp|gif)$/i.test(o.source)) return null;
    if (norm(p.title).includes(norm(m.q))) return null;
    const by = /\bby ([^,;(]{3,60})/i.exec(desc);
    return mk({
      src: 'wikipedia', museum: m.es, id: p.pageid, title: p.title, artist: by ? by[1].trim() : '', date: desc.slice(0, 40), year: parseYear(desc),
      imgs: [t && t.source, o.source], thumb: (t && t.source) || o.source, url: 'https://en.wikipedia.org/?curid=' + p.pageid,
      w: o.width, h: o.height, type: classifyType(desc), pd: null, license: 'Wikipedia (imagen del artículo)'
    });
  }).filter(Boolean);
}

/* Un museo = varias fuentes a la vez: su API directa (si tiene), Wikidata, Commons y Wikipedia.
   Las «colecciones abiertas» juntan WikiArt, Commons por estilo, Wikidata por movimiento y Europeana. */
const DIRECT = {};
function finishMuseum(m) { if (!m.q) m.q = (m.labels[0] || [''])[0]; return m; }
async function museumFetch(m, plan, f, ctx) {
  const rep = (name, n, err) => { if (ctx.report) ctx.report(name, n, err); };
  const jobs = [];
  if (m.open) {
    jobs.push(['WikiArt', () => wikiartFetch(plan, f, ctx)], ['Commons', () => commonsFetch(plan, f, ctx)], ['Wikidata', () => wikiFetch(plan, f, ctx)]);
    if (ctx.keys && ctx.keys.europeana) jobs.push(['Europeana', () => europeanaFetch(plan, f, ctx)]);
  } else {
    if (m.direct && DIRECT[m.direct]) jobs.push(['Directa', () => DIRECT[m.direct](plan, f, ctx)]);
    jobs.push(['Wikidata', () => wikidataMuseum(m, plan, f, ctx)], ['Commons', () => commonsFetch(plan, f, ctx, m)], ['Wikipedia', () => wikipediaFetch(plan, f, ctx, m)]);
  }
  const res = await Promise.allSettled(jobs.map(j => j[1]()));
  const out = [], seen = new Set(); let firstErr = null;
  res.forEach((r, i) => {
    if (r.status === 'rejected') { rep(jobs[i][0], 0, r.reason); if (!firstErr || firstErr.noKey) firstErr = r.reason; return; }
    rep(jobs[i][0], r.value.length);
    r.value.forEach(w => { const k = norm(w.title) + '|' + norm(w.artist); if (!seen.has(k)) { seen.add(k); out.push(w); } });
  });
  if (!out.length && firstErr && res.every(r => r.status === 'rejected')) throw firstErr;
  return out;
}

function museumSource(m) {
  finishMuseum(m);
  return { id: 'm:' + m.id, group: 'museum', name: m.es, place: m.city, museum: m, fetch: (plan, f, ctx) => museumFetch(m, plan, f, ctx),
    note: m.note || ((m.direct ? 'Directa · ' : '') + 'Wikidata · Commons · Wikipedia') };
}
/* Museos añadidos por el usuario: se busca el museo en Wikidata por su nombre. */
const SOURCE_LIST = [];
function addMuseum(m) {
  if (MUSEUMS.some(x => x.id === m.id)) return SOURCE_LIST.find(x => x.id === 'm:' + m.id);
  MUSEUMS.push(m);
  const src = museumSource(m); SOURCE_LIST.push(src); MUSEUM_SOURCES.push(src);
  return src;
}
async function resolveMuseum(name) {
  const text = String(name || '').trim();
  if (text.length < 3) throw new Error('Escribe el nombre del museo');
  const found = [];
  for (const lang of ['es', 'en']) {
    const j = await getJSON('https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*&type=item&limit=8&language=' + lang + '&uselang=' + lang + '&search=' + encodeURIComponent(text));
    (j.search || []).forEach(r => { if (!found.some(x => x.id === r.id)) found.push(r); });
    if (found.some(r => MUSEUM_DESC.test(r.description || ''))) break;
  }
  const hit = found.find(r => MUSEUM_DESC.test(r.description || '')) || found[0];
  if (!hit) throw new Error('No encuentro ese museo en Wikidata');
  return { id: 'c' + hit.id, es: hit.label || text, city: (hit.description || 'Museo añadido').slice(0, 50), ids: [hit.id], labels: [[hit.label || text, 'es'], [hit.label || text, 'en']], q: hit.label || text, custom: true };
}
const MUSEUM_DESC = /museum|museo|musée|museu|galler|galería|galerie|pinacoteca|collection|colección|art\b|arte\b/i;

const GENERIC = ['landscape', 'portrait', 'flowers', 'sea', 'garden', 'still life', 'river', 'mountains', 'figure', 'city', 'harbor', 'winter', 'horse', 'woman', 'sky', 'forest', 'village', 'ship', 'night', 'mother'];

DIRECT.met = metFetch; DIRECT.aic = aicFetch; DIRECT.cma = cmaFetch; DIRECT.rijks = rijksFetch; DIRECT.vam = vamFetch; DIRECT.smk = smkFetch; DIRECT.mia = miaFetch; DIRECT.si = siFetch; DIRECT.harvard = harvardFetch;
const MUSEUM_SOURCES = [];
MUSEUMS.forEach(m => { const src = museumSource(m); SOURCE_LIST.push(src); MUSEUM_SOURCES.push(src); });

/* Ejecuta una fuente: consulta concreta y, si no hay resultados, versiones cada vez más relajadas. */
async function runSource(src, f, ctx) {
  const plan = makePlan(f);
  if (plan.empty) return [];
  const loose = Object.assign({}, plan, { keyword: null, hintArtist: null });
  const tries = [plan];
  if (plan.keyword || plan.hintArtist) tries.push(loose);
  if (plan.style && plan.range && !allowedRanges(f)) tries.push(Object.assign({}, loose, { range: null }));
  for (const p of tries) {
    const w = await src.fetch(p, f, ctx);
    if (w.length) return w;
  }
  return [];
}

const api = {
  rand, pick, shuffle, sampleN, norm, parseYear, flipName, classifyType, getJSON, mapLimit,
  ERAS, STYLES, TYPES, KEYWORDS, MUSEUMS, DEFAULT_MUSEUMS, MUSEUM_SOURCES, ARTIST_SUGGESTIONS, keywordToQuery,
  defaultFilters, allowedRanges, makePlan, accept, mk, cleanTitle, SOURCE_LIST, SOURCE_DEFAULTS, runSource, addMuseum, resolveMuseum, MUSEUM_DESC,
  adapters: { wikidataMuseum, wikipediaFetch, commonsFetch, wikiartFetch, metFetch, aicFetch, cmaFetch, smkFetch, vamFetch, miaFetch, rijksFetch, wikiFetch, museumFetch, europeanaFetch, siFetch, harvardFetch }
};
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ArtCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
