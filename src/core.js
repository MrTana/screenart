/* Núcleo: catálogos de filtros, utilidades y adaptadores de museos.
   Sin acceso al DOM, para poder probarlo en Node. */
(function (root) {
'use strict';

/* ───────── utilidades ───────── */
const rand = n => Math.floor(Math.random() * n);
const pick = a => a[rand(a.length)];
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function sampleN(a, n) { return shuffle(a.slice()).slice(0, n); }
/* En la búsqueda por título (plan.top) los museos devuelven los primeros resultados, no una muestra al azar. */
const rnd = (plan, n) => plan && plan.top ? 0 : rand(n);
const smp = (plan, a, n) => plan && plan.top ? a.slice(0, n) : sampleN(a, n);
const norm = s => (s == null ? '' : String(s)).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };

/* Tamaño de imagen según la pantalla (ctx.px lo calcula la interfaz). Anchos estándar de Wikimedia: 1280, 1920, 3840. */
const PX = ctx => (ctx && ctx.px) || (ctx && ctx.hq ? 3840 : 1920);
/* MD5 (para la dirección directa de las miniaturas de Commons, sin pasar por la redirección de Special:FilePath). */
function md5(str) {
  const s = unescape(encodeURIComponent(str)), n = ((s.length + 8) >> 6) + 1, x = new Array(n * 16).fill(0);
  for (let i = 0; i < s.length; i++) x[i >> 2] |= s.charCodeAt(i) << ((i % 4) * 8);
  x[s.length >> 2] |= 0x80 << ((s.length % 4) * 8); x[n * 16 - 2] = s.length * 8;
  const K = [], R = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  for (let o = 0; o < x.length; o += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; } else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; } else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; } else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d; d = c; c = b; const sum = (a + f + K[i] + x[o + g]) | 0; b = (b + ((sum << R[i]) | (sum >>> (32 - R[i])))) | 0; a = tmp;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  return [a0, b0, c0, d0].map(v => { let h = ''; for (let i = 0; i < 4; i++) h += ((v >>> (i * 8)) & 255).toString(16).padStart(2, '0'); return h; }).join('');
}
/* Imágenes de Commons: primero la miniatura directa del tamaño justo; si el original es más pequeño (no hay miniatura), la
   dirección Special:FilePath sirve el original; al final una de 1280 px. */
function commonsImgs(filePathUrl, px) {
  try { return commonsImgs0(filePathUrl, px); } catch (e) { const b = filePathUrl.replace(/\?.*$/, ''); return [b + '?width=' + px, b + '?width=1280']; } // nombre raro: solo Special:FilePath
}
function commonsImgs0(filePathUrl, px) {
  const name = decodeURIComponent(filePathUrl.replace(/^.*Special:FilePath\//i, '').replace(/\?.*$/, '')).replace(/ /g, '_');
  const h = md5(name), enc = encodeURIComponent(name).replace(/%2C/g, ',').replace(/%28/g, '(').replace(/%29/g, ')');
  const thumb = w => 'https://upload.wikimedia.org/wikipedia/commons/thumb/' + h[0] + '/' + h.slice(0, 2) + '/' + enc + '/' + w + 'px-' + enc;
  const base = filePathUrl.replace(/\?.*$/, '');
  return [thumb(px), base + '?width=' + px, thumb(1280)];
}
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

/* Algunas colecciones no envían CORS: si la petición directa falla por red, se repite por /api/p (función de Cloudflare Pages). */
const canProxy = () => typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
async function getJSONvia(url, init, timeout) {
  try { return await getJSON(url, init, timeout); }
  catch (e) {
    if (!(e instanceof TypeError) || !canProxy()) throw e;
    return await getJSON('/api/p?u=' + encodeURIComponent(url), {}, timeout);
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = null; } }
  });
  await Promise.all(workers);
  return out;
}

/* Los totales (cuántas obras hay para una consulta) se recuerdan en el dispositivo 3 días: así al recargar no se repiten
   las consultas de conteo, que son las más lentas (sobre todo en Wikidata). Solo números; las listas de obras no se guardan. */
const MEMO_TTL = 3 * 864e5, MEMO_KEY = 'galeria-arte-v1:memo', MEMO_MAX = 800;
const memoStore = (() => { try { return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null; } catch (e) { return null; } })();
let memoDisk = null, memoSaveT = 0;
function hashKey(s) { let h1 = 0x811c9dc5, h2 = 0x01000193; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13); } return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36); }
function memoLoad() {
  if (memoDisk) return memoDisk;
  memoDisk = {};
  try { const o = memoStore && JSON.parse(memoStore.getItem(MEMO_KEY) || '{}'); if (o && typeof o === 'object') memoDisk = o; } catch (e) { /* caché dañada */ }
  return memoDisk;
}
function memoSave() {
  if (!memoStore || memoSaveT) return;
  memoSaveT = setTimeout(() => {
    memoSaveT = 0;
    const now = Date.now(), d = memoLoad(), ks = Object.keys(d).filter(k => now - d[k][1] < MEMO_TTL).sort((a, b) => d[b][1] - d[a][1]).slice(0, MEMO_MAX);
    const o = {}; ks.forEach(k => { o[k] = d[k]; }); memoDisk = o;
    try { memoStore.setItem(MEMO_KEY, JSON.stringify(o)); } catch (e) { /* almacenamiento lleno */ }
  }, 2000);
}
function memoForget(key) { memoMap.delete(key); const d = memoLoad(), h = hashKey(key); if (d[h]) { delete d[h]; memoSave(); } }
function memoKnown(key) { if (memoMap.has(key)) return true; const hit = memoStore ? memoLoad()[hashKey(key)] : null; return !!(hit && Date.now() - hit[1] < MEMO_TTL); }
function memoPut(key, p) { // un valor que llega de otra consulta (p. ej. un lote): si falla, se olvida y el museo lo pide solo
  const h = hashKey(key);
  const q = p.then(v => { if (typeof v === 'number' && memoStore) { memoLoad()[h] = [v, Date.now()]; memoSave(); } return v; }, e => { memoMap.delete(key); throw e; });
  q.catch(() => {}); memoMap.set(key, q);
}
const memoMap = new Map();
async function memo(key, fn) {
  if (memoMap.has(key)) return memoMap.get(key).catch(e => (memoMap.has(key) ? Promise.reject(e) : memo(key, fn))); // si un lote falló, se cuenta por separado
  const h = hashKey(key), hit = memoStore ? memoLoad()[h] : null;
  if (hit && typeof hit[0] === 'number' && Date.now() - hit[1] < MEMO_TTL) { const v = Promise.resolve(hit[0]); memoMap.set(key, v); return v; }
  const p = fn().then(v => { if (typeof v === 'number' && memoStore) { memoLoad()[h] = [v, Date.now()]; memoSave(); } return v; }, e => { memoMap.delete(key); throw e; });
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
  if (/tapestr|tapiz|tapisserie|gobelin|wandteppich|wandkleed/.test(t)) return 'tapestry';
  if (/sculpt|escultur|estatua|busto|\bbust\b|statue|statuette|figurine|\btorso\b|sarcophag|\bstele\b|kouros|\brelief\b|bronze|marble|skulptur|terracotta/.test(t)) return 'sculpture';
  if (/ceramic|porcelain|\bvase\b|textile|\bglass\b|furniture|jewel|silver|enamel|earthenware|fabric|\bfan\b|costume|metalwork/.test(t)) return 'decorative';
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

/* Más estilos y escuelas. wd = nombre del movimiento en Wikidata (inglés); cat = categoría de Commons; wa = estilo de WikiArt. */
[
  ['byzantine', 'Bizantino e iconos', 'Byzantine icon', [400, 1600], 'Byzantine art', [], 'Byzantine icons', 'byzantine'],
  ['gothic', 'Gótico', 'Gothic', [1200, 1480], 'Gothic art', ['Giotto', 'Duccio', 'Simone Martini', 'Cimabue', 'Lorenzetti', 'Gentile da Fabriano'], 'Gothic paintings', 'international-gothic'],
  ['earlynl', 'Primitivos flamencos', 'Early Netherlandish', [1400, 1570], 'Early Netherlandish painting', ['Jan van Eyck', 'Rogier van der Weyden', 'Hans Memling', 'Hieronymus Bosch', 'Robert Campin', 'Hugo van der Goes', 'Dieric Bouts', 'Gerard David'], 'Early Netherlandish paintings', 'northern-renaissance'],
  ['spanishgolden', 'Siglo de Oro español', 'Spanish Golden Age', [1580, 1700], 'Spanish Golden Age', ['Velázquez', 'Murillo', 'Zurbarán', 'Ribera', 'El Greco', 'Valdés Leal'], 'Spanish Baroque paintings', null],
  ['academic', 'Arte académico', 'Academic art', [1800, 1910], 'Academic art', ['Bouguereau', 'Cabanel', 'Gérôme', 'Alma-Tadema', 'Leighton', 'Meissonier'], 'Academic paintings', 'academicism'],
  ['orientalism', 'Orientalismo', 'Orientalism', [1800, 1910], 'Orientalism', ['Gérôme', 'Delacroix', 'Fromentin', 'John Frederick Lewis', 'Bridgman', 'Decamps'], 'Orientalist paintings', null],
  ['neoimp', 'Puntillismo y neoimpresionismo', 'Neo-Impressionism', [1884, 1935], 'Neo-impressionism', ['Seurat', 'Signac', 'Henri-Edmond Cross', 'Maximilien Luce', 'Van Rysselberghe'], 'Neo-Impressionist paintings', 'neo-impressionism'],
  ['nabis', 'Les Nabis', 'Nabis', [1888, 1905], 'Les Nabis', ['Vuillard', 'Bonnard', 'Maurice Denis', 'Sérusier', 'Vallotton', 'Ranson'], 'Nabis paintings', 'nabis'],
  ['futurism', 'Futurismo', 'Futurism', [1909, 1944], 'Futurism', ['Boccioni', 'Giacomo Balla', 'Severini', 'Carlo Carrà', 'Russolo'], 'Futurist paintings', 'futurism'],
  ['dada', 'Dadaísmo', 'Dada', [1916, 1930], 'Dada', ['Duchamp', 'Hannah Höch', 'Man Ray', 'Kurt Schwitters', 'Francis Picabia', 'Hans Arp'], 'Dada artworks', 'dada'],
  ['constructivism', 'Constructivismo y suprematismo', 'Constructivism', [1913, 1935], 'Constructivism', ['Malevich', 'Rodchenko', 'El Lissitzky', 'Tatlin', 'Popova', 'Stepanova'], 'Constructivist artworks', 'constructivism'],
  ['destijl', 'De Stijl', 'De Stijl', [1917, 1931], 'De Stijl', ['Mondrian', 'Theo van Doesburg', 'Rietveld', 'Bart van der Leck', 'Vilmos Huszár'], 'De Stijl', null],
  ['bauhaus', 'Bauhaus', 'Bauhaus', [1919, 1935], 'Bauhaus', ['Kandinsky', 'Paul Klee', 'Albers', 'Moholy-Nagy', 'Oskar Schlemmer', 'Lyonel Feininger'], 'Bauhaus', null],
  ['artdeco', 'Art déco', 'Art Deco', [1920, 1945], 'Art Deco', ['Tamara de Lempicka', 'Erté', 'Cassandre', 'Jean Dupas', 'Georges Barbier'], 'Art Deco paintings', 'art-deco'],
  ['newobj', 'Nueva objetividad', 'New Objectivity', [1919, 1935], 'New Objectivity', ['Otto Dix', 'George Grosz', 'Christian Schad', 'Max Beckmann', 'Rudolf Schlichter'], 'New Objectivity paintings', null],
  ['magicreal', 'Realismo mágico', 'Magic realism', [1920, 1965], 'Magic realism', ['Frida Kahlo', 'Remedios Varo', 'Leonora Carrington', 'Paul Delvaux', 'Alberto Savinio', 'Edward Hopper'], 'Magic realism paintings', 'magic-realism'],
  ['muralism', 'Muralismo mexicano', 'Mexican muralism', [1920, 1975], 'Mexican muralism', ['Diego Rivera', 'José Clemente Orozco', 'David Alfaro Siqueiros', 'Rufino Tamayo', 'Roberto Montenegro'], 'Mexican muralism', null],
  ['regionalism', 'Regionalismo americano', 'Regionalism', [1925, 1950], 'Regionalism', ['Grant Wood', 'Thomas Hart Benton', 'John Steuart Curry', 'Edward Hopper'], 'American Regionalism', 'regionalism'],
  ['socialrealism', 'Realismo social', 'Social realism', [1925, 1965], 'Social realism', ['Ben Shahn', 'Jacob Lawrence', 'Käthe Kollwitz', 'Diego Rivera', 'Honoré Daumier'], 'Social realist paintings', 'social-realism'],
  ['informel', 'Art informel y abstracción lírica', 'Art Informel', [1943, 1970], 'Art informel', ['Jean Dubuffet', 'Pierre Soulages', 'Hans Hartung', 'Wols', 'Georges Mathieu', 'Fautrier'], 'Art Informel', 'art-informel'],
  ['colorfield', 'Campos de color', 'Color Field', [1948, 1980], 'Color field', ['Rothko', 'Barnett Newman', 'Helen Frankenthaler', 'Morris Louis', 'Kenneth Noland', 'Clyfford Still', 'Ellsworth Kelly'], 'Color Field paintings', 'color-field-painting'],
  ['cobra', 'CoBrA', 'CoBrA', [1948, 1955], 'CoBrA', ['Karel Appel', 'Asger Jorn', 'Corneille', 'Constant', 'Pierre Alechinsky'], 'CoBrA', 'cobra'],
  ['minimalism', 'Minimalismo', 'Minimalism', [1960, 1985], 'Minimalism', ['Donald Judd', 'Dan Flavin', 'Carl Andre', 'Sol LeWitt', 'Frank Stella', 'Agnes Martin'], 'Minimalist art', 'minimalism'],
  ['opart', 'Op art y cinetismo', 'Op art', [1955, 1980], 'Op art', ['Vasarely', 'Bridget Riley', 'Jesús Rafael Soto', 'Carlos Cruz-Diez', 'Yaacov Agam'], 'Op art', 'op-art'],
  ['photorealism', 'Fotorrealismo', 'Photorealism', [1965, 2000], 'Photorealism', ['Chuck Close', 'Richard Estes', 'Audrey Flack', 'Ralph Goings', 'Gerhard Richter'], 'Photorealist paintings', 'photorealism'],
  ['neoexp', 'Neoexpresionismo', 'Neo-expressionism', [1975, 2000], 'Neo-expressionism', ['Basquiat', 'Anselm Kiefer', 'Georg Baselitz', 'Julian Schnabel', 'Francesco Clemente', 'Sandro Chia'], 'Neo-expressionist paintings', 'neo-expressionism'],
  ['streetart', 'Arte urbano y grafiti', 'Street art', [1970, 2030], 'Street art', ['Keith Haring', 'Banksy', 'Basquiat', 'Shepard Fairey', 'Invader'], 'Street art', null],
  ['naive', 'Arte naíf', 'Naïve art', [1880, 1985], 'Naïve art', ['Henri Rousseau', 'Grandma Moses', 'Séraphine Louis', 'Camille Bombois', 'Niko Pirosmani'], 'Naïve art paintings', 'naive-art-primitivism'],
  ['latam', 'Arte latinoamericano moderno', 'Latin American modern art', [1900, 1995], null, ['Joaquín Torres-García', 'Tarsila do Amaral', 'Fernando Botero', 'Wifredo Lam', 'Roberto Matta', 'Rufino Tamayo', 'Xul Solar', 'Frida Kahlo', 'Remedios Varo', 'Carlos Mérida'], 'Latin American paintings', null],
  ['chinese', 'Pintura china', 'Chinese painting', [900, 1950], 'Chinese painting', ['Qi Baishi', 'Zhang Daqian', 'Shen Zhou', 'Bada Shanren', 'Zhao Mengfu', 'Xu Beihong'], 'Chinese paintings', null],
  ['mughal', 'Miniaturas indias y mogolas', 'Mughal painting', [1500, 1900], 'Mughal painting', [], 'Mughal paintings', null],
  ['persian', 'Miniaturas persas', 'Persian miniature', [1200, 1800], 'Persian miniature', [], 'Persian miniatures', null],
  ['nihonga', 'Pintura japonesa (Rinpa y Nihonga)', 'Japanese painting', [1600, 1950], 'Japanese painting', ['Ogata Kōrin', 'Itō Jakuchū', 'Hishida Shunsō', 'Yokoyama Taikan', 'Kawase Hasui'], 'Japanese paintings', null],
  ['egyptian', 'Egipto antiguo', 'Ancient Egyptian', [-3000, -30], 'Ancient Egyptian art', [], 'Ancient Egyptian paintings', null],
  ['roman', 'Frescos y mosaicos romanos', 'Roman fresco mosaic', [-500, 500], 'Roman art', [], 'Roman frescoes', null],
  ['botanical', 'Ilustración botánica y naturaleza', 'botanical illustration', [1500, 1950], null, ['Pierre-Joseph Redouté', 'Maria Sibylla Merian', 'Ernst Haeckel', 'Georg Dionysius Ehret', 'John James Audubon'], 'Botanical illustrations', null]
].forEach(([id, es, q, range, wd, artists, cat, wa]) => { if (STYLES.some(s => s.id === id)) return; STYLES.push({ id, es, q, range, wd, artists }); STYLE_EXTRA[id] = { cat, wa: wa || undefined }; });
STYLES.sort((x, y) => x.range[0] - y.range[0] || x.range[1] - y.range[1]);
STYLES.forEach(s => Object.assign(s, STYLE_EXTRA[s.id] || {}));
/* Más artistas por estilo. Sirven para buscar con más variedad y, sobre todo, para comprobar el estilo de una obra cuando la fuente
   no lo sabe (listas de museos, APIs de museos, Commons): con un estilo elegido, esas obras solo entran si su artista es del estilo. */
const STYLE_MORE = {
  renaissance: ['Rafael', 'Tiziano', 'Fra Angelico', 'Piero della Francesca', 'Mantegna', 'Masaccio', 'Filippo Lippi', 'Filippino Lippi', 'Ghirlandaio', 'Perugino', 'Michelangelo', 'Miguel Ángel', 'Correggio', 'Carpaccio', 'Antonello da Messina', 'Lorenzo Lotto', 'Veronese', 'Andrea del Sarto', 'Cranach', 'Paolo Uccello', 'Gozzoli', 'Pinturicchio', 'Signorelli', 'Sebastiano del Piombo', 'Durero', 'Verrocchio', 'Cima da Conegliano', 'Bronzino', 'Altdorfer'],
  baroque: ['Artemisia Gentileschi', 'Orazio Gentileschi', 'Guido Reni', 'Annibale Carracci', 'Guercino', 'Georges de La Tour', 'Ribera', 'Bernardo Strozzi', 'Luca Giordano', 'Pietro da Cortona', 'Jordaens', 'Frans Snyders', 'Simon Vouet', 'Philippe de Champaigne', 'Domenichino', 'Mattia Preti', 'Valentin de Boulogne', 'Charles Le Brun', 'Salvator Rosa', 'Vermeer', 'Frans Hals', 'Alonso Cano', 'Claudio Coello', 'Le Nain', 'Sassoferrato', 'Carlo Dolci', 'Honthorst', 'ter Brugghen'],
  dutch: ['Jan van der Heyden', 'Pieter Claesz', 'Heda', 'ter Borch', 'Gabriel Metsu', 'Gerrit Dou', 'Frans van Mieris', 'Nicolaes Maes', 'Fabritius', 'Judith Leyster', 'Avercamp', 'van Ostade', 'de Heem', 'Rachel Ruysch', 'van de Velde', 'Philips Koninck', 'Paulus Potter', 'Salomon van Ruysdael', 'Jacob van Ruisdael', 'Pieter de Hooch', 'Saenredam', 'Emanuel de Witte', 'Bosschaert', 'Jan van Huysum', 'Adriaen Coorte'],
  spanishgolden: ['Alonso Cano', 'Claudio Coello', 'Sánchez Cotán', 'van der Hamen', 'Antonio de Pereda', 'Carreño de Miranda', 'Herrera el Viejo', 'Maíno', 'Ribalta'],
  rococo: ['Pater', 'Lancret', 'Nattier', 'Quentin de La Tour', 'Pietro Longhi', 'Rosalba Carriera', 'Liotard', 'Joshua Reynolds', 'Hogarth', 'Bellotto', 'Hubert Robert', 'van Loo', 'Greuze'],
  neoclassicism: ['Jacques-Louis David', 'Mengs', 'Pompeo Batoni', 'Drouais', 'Girodet', 'François Gérard', 'Guérin', 'Angelica Kauffman', 'Benjamin West', 'Antoine-Jean Gros', "Prud'hon", 'Hackert'],
  romanticism: ['Caspar David Friedrich', 'Chassériau', 'Fuseli', 'Füssli', 'John Martin', 'Aivazovsky', 'Carl Blechen', 'Johan Christian Dahl', 'Antoine-Jean Gros', 'Bonington', 'Samuel Palmer', 'Runge', 'Bryullov', 'Carl Gustav Carus', 'Ary Scheffer', 'Paul Delaroche', 'Leonardo Alenza', 'Eugenio Lucas', 'Pérez Villaamil', 'Hayez', 'Thomas Cole'],
  academic: ['Paul Delaroche', 'Thomas Couture', 'Jules Lefebvre', 'Hans Makart', 'Siemiradzki', 'Makovsky', 'Jean-Paul Laurens', 'William Etty', 'Edward Poynter', 'Albert Moore', 'Fortuny', 'Pradilla', 'Gisbert', 'Rosales', 'Carolus-Duran', 'Henner'],
  realism: ['Jules Breton', 'Rosa Bonheur', 'Menzel', 'Wilhelm Leibl', 'Kramskoi', 'Bastien-Lepage', 'Lhermitte', 'Munkácsy', 'Constantin Meunier', 'Fantin-Latour', 'Alfred Stevens', 'Corot', 'Perov', 'Shishkin', 'Savrasov', 'Levitan', 'Surikov', 'Vasnetsov'],
  impressionism: ['Bazille', 'Guillaumin', 'Eva Gonzalès', 'Childe Hassam', 'Liebermann', 'Lovis Corinth', 'Slevogt', 'Sorolla', 'Theodore Robinson', 'Twachtman', 'Marie Bracquemond', 'Zandomeneghi', 'De Nittis', 'Wilson Steer', 'Dora Hitz', 'Korovin', 'Valentin Serov', 'Anders Zorn', 'Krøyer', 'Emil Claus', 'Darío de Regoyos', 'Beruete', 'Singer Sargent', 'Frank Weston Benson', 'Edmund Tarbell', 'Cabot Perry', 'Willard Metcalf'],
  postimpressionism: ['Émile Bernard', 'Sérusier', 'Anquetin', 'Angrand', 'Henri Rousseau', 'Maximilien Luce', 'Henri-Edmond Cross', 'van Rysselberghe', 'Vuillard', 'Maurice Denis', 'Vallotton', 'Suzanne Valadon', 'Armand Seguin', 'Cuno Amiet', "O'Conor"],
  symbolism: ['Jean Delville', 'Carlos Schwabe', 'Burne-Jones', 'Frederic Watts', 'Franz von Stuck', 'Vrubel', 'Jan Toorop', 'Lévy-Dhurmer', 'Alphonse Osbert', 'Félicien Rops', 'Spilliaert', 'Dora Hitz', 'Edvard Munch', 'Gustav Klimt', 'Hugo Simberg', 'Gallen-Kallela', 'Čiurlionis', 'Max Klinger', 'Alfred Kubin', 'Aman-Jean', 'Romero de Torres'],
  artnouveau: ['Koloman Moser', 'Eugène Grasset', 'Privat-Livemont', 'Jan Toorop', 'Steinlen', 'Jules Chéret', 'Ramon Casas', 'de Riquer'],
  fauvism: ['van Dongen', 'Albert Marquet', 'Henri Manguin', 'Charles Camoin', 'Othon Friesz', 'Jean Puy', 'Georges Rouault', 'Louis Valtat'],
  expressionism: ['Pechstein', 'Erich Heckel', 'Schmidt-Rottluff', 'August Macke', 'Modersohn-Becker', 'Jawlensky', 'Gabriele Münter', 'Werefkin', 'James Ensor', 'Chaim Soutine', 'Otto Mueller', 'Ludwig Meidner', 'Max Beckmann', 'Lyonel Feininger', 'Georges Rouault', 'Constant Permeke', 'Gustave De Smet', 'Richard Gerstl'],
  cubism: ['Metzinger', 'Albert Gleizes', 'Marcoussis', 'María Blanchard', 'Diego Rivera', 'La Fresnaye', 'Le Fauconnier', 'Popova', 'Sonia Delaunay', 'Auguste Herbin', 'Jacques Villon', 'Alexandra Exter'],
  abstract: ['Hilma af Klint', 'Kupka', 'Sonia Delaunay', 'Robert Delaunay', 'Ben Nicholson', 'Taeuber-Arp', 'Jean Arp', 'Hans Arp', 'Auguste Herbin', 'Theo van Doesburg', "O'Keeffe", 'Arthur Dove', 'Hans Hofmann', 'Serge Poliakoff', 'Nicolas de Staël'],
  surrealism: ['Yves Tanguy', 'Leonora Carrington', 'Remedios Varo', 'Dorothea Tanning', 'Kay Sage', 'Leonor Fini', 'Wolfgang Paalen', 'Roberto Matta', 'Wifredo Lam', 'Victor Brauner', 'André Masson', 'Óscar Domínguez', 'Paul Nash', 'Roland Penrose', 'Kurt Seligmann', 'Toyen', 'Štyrský', 'Meret Oppenheim', 'Man Ray', 'Hans Bellmer', 'de Chirico', 'Frida Kahlo', 'Jacqueline Lamba', 'Alice Rahon', 'Onslow Ford', 'Esteban Francés', 'Maruja Mallo', 'Ángeles Santos', 'Eileen Agar', 'Ithell Colquhoun', 'Jean Arp'],
  magicreal: ['Antonio Donghi', 'Felice Casorati', 'Ivan Albright', 'Pyke Koch', 'Carel Willink', 'Franz Radziwill', 'Christian Schad', 'María Izquierdo', 'Andrew Wyeth', 'Peter Blume', 'Cagnaccio di San Pietro', 'Ubaldo Oppi', 'Alexander Kanoldt', 'Georg Schrimpf', 'Grant Wood'],
  abstractexp: ['Franz Kline', 'Lee Krasner', 'Joan Mitchell', 'Arshile Gorky', 'Clyfford Still', 'Adolph Gottlieb', 'Hans Hofmann', 'Philip Guston', 'Helen Frankenthaler', 'Sam Francis', 'Elaine de Kooning', 'Grace Hartigan', 'William Baziotes', 'Bradley Walker Tomlin', 'Pousette-Dart'],
  pop: ['James Rosenquist', 'Tom Wesselmann', 'Claes Oldenburg', 'Richard Hamilton', 'Peter Blake', 'Robert Indiana', 'Ed Ruscha', 'Wayne Thiebaud', 'Marisol', 'Evelyne Axell', 'Mimmo Rotella', 'Pauline Boty', 'Equipo Crónica', 'Martial Raysse']
};
STYLE_MORE.latam = ['Anita Malfatti', 'Di Cavalcanti', 'Candido Portinari', 'Lasar Segall', 'Vicente do Rego Monteiro', 'Ismael Nery', 'Alfredo Volpi', 'Tomie Ohtake', 'Djanira', 'Pedro Figari', 'Antonio Berni', 'Emilio Pettoruti', 'Raquel Forner', 'Armando Reverón', 'Oswaldo Guayasamín', 'José Sabogal', 'Amelia Peláez', 'Víctor Manuel', 'Carlos Enríquez', 'Francisco Toledo', 'María Izquierdo', 'Fernando de Szyszlo', 'Alejandro Obregón', 'Débora Arango'];
STYLE_MORE.impressionism.push('William Merritt Chase');
STYLE_MORE.opart = ['Alejandro Otero', 'Gego', 'Julio Le Parc', 'Lygia Clark', 'Hélio Oiticica', 'Mercedes Pardo', 'Omar Rayo', 'Matilde Pérez'];
STYLE_MORE.abstract.push('Carmen Herrera', 'Tomás Maldonado', 'Lidy Prati', 'Mira Schendel', 'Fanny Sanín', 'Loló Soldevilla');
Object.keys(STYLE_MORE).forEach(id => { const s = STYLES.find(x => x.id === id); if (s) STYLE_MORE[id].forEach(n => { if (!s.artists.includes(n)) s.artists.push(n); }); });
/* Estilos definidos por la cultura o el lugar, no por una lista cerrada de artistas: se buscan por nombre y categoría (Commons, Wikidata,
   APIs de museos) y no se filtran por artista; las listas precargadas de los museos no los saben distinguir y no participan. */
[
  { id: 'korean', es: 'Pintura coreana', q: 'Korean painting Joseon', range: [1392, 1910], wd: 'Korean painting', cat: 'Paintings of Korea', artists: ['Kim Hong-do', 'Jeong Seon', 'Shin Yun-bok', 'An Gyeon', 'Kim Jeong-hui', 'Jang Seung-eop', 'Sin Saimdang', 'Gang Se-hwang', 'Yun Du-seo', 'Yi Am'] },
  { id: 'virreinal', es: 'Pintura virreinal', q: 'colonial painting viceroyalty New Spain Peru Cusco School', range: [1550, 1820], wd: 'Cusco School', cat: 'Cusco School', artists: ['Cristóbal de Villalpando', 'Miguel Cabrera', 'Juan Correa', 'Gregorio Vásquez de Arce', 'Melchor Pérez de Holguín', 'Diego Quispe Tito', 'Baltasar de Echave', 'José de Ibarra', 'Nicolás Enríquez', 'Bernardo Bitti', 'Marcos Zapata', 'Basilio Santa Cruz'] }
].forEach(s => { if (!STYLES.some(x => x.id === s.id)) STYLES.push(Object.assign({ loose: true }, s)); });
['chinese', 'persian', 'mughal'].forEach(id => { const s = STYLES.find(x => x.id === id); if (s) s.loose = true; });
STYLES.sort((x, y) => x.range[0] - y.range[0] || x.range[1] - y.range[1]);
const styleArtistMatch = (w, s) => { const a = norm(w.artist || ''); return !!a && (s.artists || []).some(n => { const t = norm(n).split(/\s+/).filter(x => x.length > 1); return t.length && t.every(x => a.includes(x)); }); };

/* Estilos de una obra (para las colecciones rápidas basadas en favoritas): por el artista (los de la lista de cada estilo) y, si hay varios
   estilos posibles, solo los que encajan con el año de la obra. */
function styleIdsOf(w) {
  if (!w) return [];
  const a = norm(w.artist || ''); if (!a) return [];
  const y = w.year != null ? w.year : parseYear(w.date);
  const hits = STYLES.filter(s => (s.artists || []).some(n => { const t = norm(n).split(/\s+/).filter(x => x.length > 1); return t.length && t.every(x => a.includes(x)); }));
  const near = y != null ? hits.filter(s => y >= s.range[0] - 15 && y <= s.range[1] + 15) : [];
  return (near.length ? near : hits).map(s => s.id);
}
const TYPES = [
  { id: 'painting', es: 'Pintura' },
  { id: 'drawing', es: 'Dibujo y acuarela' },
  { id: 'print', es: 'Grabado y estampa' },
  { id: 'photo', es: 'Fotografía' },
  { id: 'tapestry', es: 'Tapiz' },
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

/* «No quiero ver»: temas que se descartan por el título de la obra (en español, inglés, francés, italiano, alemán y neerlandés).
   Los términos van sin tildes y en minúsculas, y se buscan al comienzo de una palabra. */
const EXCLUDES = [
  { id: 'portraits', es: 'Retratos y autorretratos', t: 'portrait|autorretrat|zelfportr|selbstportr|retrat|ritratt|portret|bildnis|autoportrait|self.?portrait|selbstbild|head of|tete de|madame|mademoiselle|monsieur|lady|gentleman|young man|young woman|girl with|boy with|woman with|man with|woman in|man in|portaretrato|mrs\\.|mr\\.|duke|duchess|countess|princess|queen|king|emperor|cardinal' },
  { id: 'stilllife', es: 'Naturalezas muertas', t: 'still.?life|nature morte|naturaleza muerta|stilleven|stillleben|natura morta|bodeg|vanitas|fruit|banquet|breakfast piece|dead game|\\bjug\\b|\\bbottle|\\bskull' },
  { id: 'flowers', es: 'Flores', t: 'flower|bouquet|fleur|flores|\\brose|tulip|sunflower|\\biris|lil(y|ies)|blume|bloem|peon(y|ies)|poppy|poppies|chrysanthem|orchid|wisteria|water lil' },
  { id: 'landscapes', es: 'Paisajes', t: 'landscape|paisaje|paysage|landschap|landschaft|paesaggio|view of|vue de|valley|mountain|forest|\\briver|\\bfields?\\b|meadow|\\btrees?\\b|woods|haystack|sunset|sunrise' },
  { id: 'seascapes', es: 'Marinas y barcos', t: 'seascape|marina|marine|\\bsea\\b|ocean|coast|harbo|\\bport\\b|\\bships?\\b|boats?\\b|\\bbeach|\\bwaves?\\b|sailing|lighthouse|naufrag|shipwreck|mer\\b|\\bmeer\\b|\\bzee' },
  { id: 'cities', es: 'Ciudades y edificios', t: 'city|\\bcity\\b|\\bstreet|\\brue\\b|boulevard|church|cathedral|bridge|\\btown\\b|village|palace|castle|\\bhouse|interior|piazza|canal|ruins?\\b' },
  { id: 'nudes', es: 'Desnudos', t: 'nude|desnud|\\bnu\\b|\\bakt\\b|bather|bathing|baigneuse|naked|odalisque|reclining|venus|\\bbath\\b|bathers' },
  { id: 'religion', es: 'Religión y escenas bíblicas', t: 'madonna|virgin|christ|crucifi|\\bsaint|\\bst\\.? |annunciation|nativity|adoration|\\bholy|pieta|last supper|resurrection|\\bangels?\\b|apostle|\\bmagi\\b|baptism|deposition|ascension|bibl|jesus|\\bmary\\b|altarpiece|saint |martyr|prophet|moses|\\bdavid and|\\bjob\\b|\\bgod\\b|sacra|santo|santa|virgen|cristo|crucifixion' },
  { id: 'mythology', es: 'Mitología y alegorías', t: 'mytholog|\\bvenus\\b|apollo|diana|jupiter|zeus|bacchus|hercules|\\bmars\\b|minerva|cupid|triumph of|nympha?|satyr|centaur|olymp|ariadne|narcissus|orpheus|allegor|alegor|muses?\\b|\\bgods?\\b|\\bgoddess' },
  { id: 'animals', es: 'Animales', t: 'horses?\\b|\\bdogs?\\b|\\bcats?\\b|\\bbirds?\\b|animal|\\bcows?\\b|\\blions?\\b|sheep|cheval|chevaux|pferd|paard|\\bdeer\\b|\\bhounds?\\b|hunting|\\bcaballo|\\bperro|\\bgato\\b|\\bfish\\b|\\bowl\\b|peacock|\\bswans?\\b|\\bducks?\\b|chicken|\\bbull\\b|\\btiger' },
  { id: 'war', es: 'Batallas y guerra', t: 'battle|\\bwar\\b|bataille|siege|soldier|military|execution|massacre|\\barmy\\b|\\bnapoleon|cavalry|victory|surrender|schlacht|slag\\b|batalla|guerra|conquest|invasion' },
  { id: 'people', es: 'Escenas con personas', t: 'dancers?\\b|\\bdance|\\bballet|concert|\\bmusic|musician|\\bplayers?\\b|\\bfarmers?\\b|peasant|\\bworkers?\\b|\\bfamily|\\bchildren|\\bchild\\b|\\bmother|\\bfather|\\bwomen\\b|\\bmen\\b|\\bgirls?\\b|\\bboys?\\b|\\bfigures?\\b|\\bcrowd|\\bwedding|\\bfeast|\\btavern|\\bcafe' }
];
EXCLUDES.forEach(e => { e.re = new RegExp('(?:^|[^a-z])(?:' + e.t + ')', 'i'); });
const exTerm = w => { const a = norm(w), b = norm(keywordToQuery(w)); return Array.from(new Set([a, b])).filter(x => x.length > 2).map(x => (x.length > 4 ? x.replace(/(es|s)$/, '') : x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); };
function excluded(w, f) {
  if (!f || f.onlyFavs || f.onlyViewed) return false;
  const ids = f.exclude || [], words = f.noWords || [];
  if (!ids.length && !words.length) return false;
  const t = norm(w.title);
  if (ids.some(id => { const e = EXCLUDES.find(x => x.id === id); return e && e.re.test(t); })) return true;
  return words.some(x => exTerm(x).some(s => new RegExp('(?:^|[^a-z])' + s, 'i').test(t)));
}

/* Los artistas más importantes, agrupados. Cada nombre se busca en todas las fuentes: datos abiertos de MoMA, NGA y Tate,
   WikiArt (página del artista), Wikimedia Commons (categoría «Paintings by …»), Wikidata y los museos activos. */
const ARTIST_GROUPS = [
  { id: 'gothic', es: 'Edad Media y primitivos', names: ['Giotto', 'Duccio', 'Simone Martini', 'Fra Angelico', 'Jan van Eyck', 'Rogier van der Weyden', 'Hieronymus Bosch', 'Hans Memling', 'Pieter Bruegel the Elder', 'Piero della Francesca'] },
  { id: 'renaissance', es: 'Renacimiento y manierismo', names: ['Leonardo da Vinci', 'Michelangelo', 'Raphael', 'Botticelli', 'Titian', 'Giorgione', 'Tintoretto', 'Paolo Veronese', 'Mantegna', 'Giovanni Bellini', 'Albrecht Dürer', 'Hans Holbein', 'Lucas Cranach', 'El Greco', 'Parmigianino', 'Correggio', 'Sofonisba Anguissola', 'Andrea del Sarto'] },
  { id: 'baroque', es: 'Barroco y Siglo de Oro', names: ['Caravaggio', 'Artemisia Gentileschi', 'Rubens', 'Van Dyck', 'Rembrandt', 'Johannes Vermeer', 'Frans Hals', 'Velázquez', 'Murillo', 'Zurbarán', 'Ribera', 'Nicolas Poussin', 'Claude Lorrain', 'Georges de La Tour', 'Jacob van Ruisdael', 'Judith Leyster', 'Rachel Ruysch', 'Clara Peeters', 'Canaletto', 'Francesco Guardi'] },
  { id: 'rococo', es: 'Rococó y neoclasicismo', names: ['Watteau', 'François Boucher', 'Fragonard', 'Chardin', 'Tiepolo', 'Gainsborough', 'Joshua Reynolds', 'Élisabeth Vigée Le Brun', 'Jacques-Louis David', 'Ingres', 'Angelica Kauffman', 'Canova', 'William Hogarth'] },
  { id: 'romanticism', es: 'Romanticismo y realismo', names: ['Goya', 'Turner', 'John Constable', 'Caspar David Friedrich', 'Delacroix', 'Géricault', 'William Blake', 'Thomas Cole', 'Frederic Church', 'Albert Bierstadt', 'Courbet', 'Millet', 'Corot', 'Daumier', 'Rosa Bonheur', 'Winslow Homer', 'Thomas Eakins', 'Ilya Repin', 'Ivan Aivazovsky', 'Adolph Menzel'] },
  { id: 'impressionism', es: 'Impresionismo y postimpresionismo', names: ['Claude Monet', 'Pierre-Auguste Renoir', 'Edgar Degas', 'Édouard Manet', 'Camille Pissarro', 'Alfred Sisley', 'Berthe Morisot', 'Mary Cassatt', 'Gustave Caillebotte', 'Vincent van Gogh', 'Paul Cézanne', 'Paul Gauguin', 'Georges Seurat', 'Henri de Toulouse-Lautrec', 'Paul Signac', 'Pierre Bonnard', 'Édouard Vuillard', 'John Singer Sargent', 'Joaquín Sorolla', 'James Abbott McNeill Whistler', 'Anders Zorn', 'Suzanne Valadon', 'Eva Gonzalès'] },
  { id: 'symbolism', es: 'Simbolismo y modernismo', names: ['Gustave Moreau', 'Odilon Redon', 'Puvis de Chavannes', 'Arnold Böcklin', 'Gustav Klimt', 'Egon Schiele', 'Alphonse Mucha', 'Edvard Munch', 'Fernand Khnopff', 'Ferdinand Hodler', 'Aubrey Beardsley', 'Dante Gabriel Rossetti', 'John Everett Millais', 'Edward Burne-Jones', 'John William Waterhouse', 'Lawrence Alma-Tadema', 'Hilma af Klint', 'Akseli Gallen-Kallela', 'Ramon Casas', 'Santiago Rusiñol'] },
  { id: 'cubism', es: 'Vanguardias del siglo XX', names: ['Pablo Picasso', 'Georges Braque', 'Juan Gris', 'Fernand Léger', 'Robert Delaunay', 'Sonia Delaunay', 'Henri Matisse', 'André Derain', 'Raoul Dufy', 'Wassily Kandinsky', 'Paul Klee', 'Franz Marc', 'August Macke', 'Ernst Ludwig Kirchner', 'Emil Nolde', 'Oskar Kokoschka', 'Max Beckmann', 'Otto Dix', 'Kazimir Malevich', 'Piet Mondrian', 'Marc Chagall', 'Amedeo Modigliani', 'Giorgio de Chirico', 'Umberto Boccioni', 'Marcel Duchamp', 'Tamara de Lempicka', 'Marie Laurencin', 'Gabriele Münter', 'Paula Modersohn-Becker', 'Natalia Goncharova', 'Josef Albers', 'Henri Rousseau', 'Chaïm Soutine'] },
  { id: 'surrealism', es: 'Surrealismo y realismo mágico', names: ['Salvador Dalí', 'René Magritte', 'Joan Miró', 'Max Ernst', 'Yves Tanguy', 'Paul Delvaux', 'André Masson', 'Man Ray', 'Remedios Varo', 'Leonora Carrington', 'Frida Kahlo', 'Dorothea Tanning', 'Leonor Fini', 'Kay Sage', 'Roberto Matta', 'Wifredo Lam', 'Óscar Domínguez', 'Victor Brauner', 'Maruja Mallo', 'Toyen', 'Meret Oppenheim', 'Alice Rahon', 'Gunther Gerzso', 'Pierre Roy'] },
  { id: 'abstractexp', es: 'Posguerra: expresionismo abstracto y pop', names: ['Jackson Pollock', 'Mark Rothko', 'Willem de Kooning', 'Franz Kline', 'Barnett Newman', 'Clyfford Still', 'Lee Krasner', 'Joan Mitchell', 'Helen Frankenthaler', 'Robert Motherwell', 'Cy Twombly', 'Jean Dubuffet', 'Pierre Soulages', 'Francis Bacon', 'Lucian Freud', 'Andy Warhol', 'Roy Lichtenstein', 'Jasper Johns', 'Robert Rauschenberg', 'David Hockney', 'Jean-Michel Basquiat', 'Keith Haring', 'Gerhard Richter', 'Anselm Kiefer', 'Yayoi Kusama', 'Louise Bourgeois', 'Agnes Martin', 'Ellsworth Kelly', 'Frank Stella', 'Bridget Riley', 'Victor Vasarely'] },
  { id: 'americans', es: 'Estados Unidos', names: ['Edward Hopper', 'Georgia O\'Keeffe', 'Grant Wood', 'Thomas Hart Benton', 'Andrew Wyeth', 'Norman Rockwell', 'Jacob Lawrence', 'Stuart Davis', 'Charles Demuth', 'Arthur Dove', 'Marsden Hartley', 'John Singer Sargent', 'Mary Cassatt', 'Frederic Remington', 'George Bellows', 'Ben Shahn'] },
  { id: 'latam', es: 'España y Latinoamérica', names: ['Diego Rivera', 'José Clemente Orozco', 'David Alfaro Siqueiros', 'Rufino Tamayo', 'Frida Kahlo', 'Remedios Varo', 'María Izquierdo', 'Carlos Mérida', 'Dr. Atl', 'José María Velasco', 'Fernando Botero', 'Joaquín Torres-García', 'Tarsila do Amaral', 'Candido Portinari', 'Xul Solar', 'Antonio Berni', 'Fernando de Szyszlo', 'Oswaldo Guayasamín', 'Armando Reverón', 'Joaquín Sorolla', 'Ignacio Zuloaga', 'Antoni Tàpies', 'Eduardo Chillida', 'Antonio López García', 'Julio Romero de Torres', 'Santiago Rusiñol'] },
  { id: 'ukiyoe', es: 'Asia', names: ['Katsushika Hokusai', 'Utagawa Hiroshige', 'Kitagawa Utamaro', 'Utagawa Kuniyoshi', 'Toshusai Sharaku', 'Suzuki Harunobu', 'Kawase Hasui', 'Ogata Kōrin', 'Itō Jakuchū', 'Yayoi Kusama', 'Takashi Murakami', 'Qi Baishi', 'Zhang Daqian', 'Xu Beihong', 'Zhao Mengfu', 'Bada Shanren', 'Rabindranath Tagore', 'Raja Ravi Varma', 'Amrita Sher-Gil', 'Nandalal Bose'] }
];
const ARTIST_SUGGESTIONS = Array.from(new Set([].concat(...ARTIST_GROUPS.map(g => g.names)).concat(['Monet', 'Van Gogh', 'Rembrandt', 'Vermeer', 'Hokusai', 'Hiroshige', 'Turner', 'Cézanne', 'Renoir', 'Degas', 'Goya', 'Velázquez', 'Caravaggio', 'Klimt', 'Picasso', 'Kandinsky', 'Hopper', 'Whistler', 'Sargent', 'Friedrich', 'Constable', 'Gauguin', 'Seurat', 'Manet', 'Pissarro', 'Sisley', 'Matisse', 'Dalí', 'Miró', 'Mucha', 'Botticelli', 'Tiziano', 'El Greco', 'Rubens', 'Canaletto', 'Munch', 'Cassatt', 'Morisot', 'Sorolla', 'Zorn']))).sort((x, y) => x.localeCompare(y, 'es'));

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
    styles: [], types: [], artists: [], keywords: [], exclude: [], noWords: [],
    orientation: 'any', soloPD: false, onlyFavs: false, onlyViewed: false
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

/* La app es para ver cuadros, dibujos, estampas, grabados, tapices y fotografías; nunca objetos en 3D. */
const DEFAULT_TYPE_BAG = ['painting', 'painting', 'painting', 'drawing', 'print', 'photo'];

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
  // Con estilo elegido, la obra entra si la fuente ya comprobó su estilo o si su artista es de ese estilo; la fecha sola no basta
  // (así no se cuela, por ejemplo, una impresionista de 1925 en «Surrealismo»). Los estilos sin lista de artistas no se filtran así.
  if (styles.length && !(w.sid && styles.some(s => s.id === w.sid)) && styles.some(s => (s.artists || []).length) && !styles.some(s => s.loose) && !styles.some(s => styleArtistMatch(w, s))) return false;
  if (f.artists && f.artists.length) {
    const a = norm(w.artist);
    if (!f.artists.some(n => norm(n).split(/\s+/).every(t => a.includes(t)))) return false;
  }
  if (f.types && f.types.length) { if (w.type && !f.types.includes(w.type)) return false; }
  else if (w.type === 'decorative' || w.type === 'sculpture') return false;
  if (f.orientation && f.orientation !== 'any' && w.w && w.h) {
    const r = w.w / w.h;
    if (f.orientation === 'landscape' && r < 1.15) return false;
    if (f.orientation === 'portrait' && r > 0.87) return false;
    if (f.orientation === 'square' && (r < 0.87 || r > 1.15)) return false;
  }
  if (f.soloPD && w.pd !== true) return false;
  if (excluded(w, f)) return false;
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

function cleanDate(d) {
  if (d == null || typeof d === 'number') return d == null ? '' : d;
  let s = String(d).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const i = s.search(/\bQS:/); if (i >= 0) s = s.slice(0, i);
  return s.replace(/\s+(date|title|label|description)\s*$/i, '').replace(/^(date|fecha):\s*/i, '').trim().slice(0, 40);
}
/* Nombres que no son nombres: Wikidata devuelve una dirección (…/.well-known/genid/…) cuando el autor es «desconocido», y a veces
   llega solo el identificador (Q123). Eso no se muestra nunca. */
function cleanName(s) {
  s = s == null ? '' : String(s).replace(/\s*\bQS:.*$/, '').trim();
  if (!s || /^(https?:\/\/|www\.)/i.test(s) || /\.well-known\/genid\//i.test(s) || /^Q\d+$/.test(s)) return '';
  return s.slice(0, 90);
}
function mk(p) {
  const imgs = [];
  (p.imgs || []).filter(Boolean).forEach(u => { if (/^http:\/\//.test(u)) imgs.push(u.replace(/^http:/, 'https:')); imgs.push(u); });
  return {
    uid: p.src + ':' + p.id,
    src: p.src, museum: p.museum,
    title: cleanTitle(p.title) || 'Sin título',
    artist: cleanName(p.artist),
    date: cleanDate(p.date), year: p.year == null ? parseYear(cleanDate(p.date)) : p.year,
    imgs, thumb: p.thumb || imgs[imgs.length - 1] || '',
    url: p.url || '', w: p.w || null, h: p.h || null,
    type: p.type || null, pd: p.pd === undefined ? null : p.pd, license: p.license || '',
    sid: p.sid || null // estilo que la fuente ya comprobó (WikiArt por estilo, Wikidata por movimiento)
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
  if (plan.top) p.set('title', 'true');
  if (plan.range) { p.set('dateBegin', plan.range[0]); p.set('dateEnd', plan.range[1]); }
  if (MET_MEDIUM[plan.type]) p.set('medium', MET_MEDIUM[plan.type]);
  const search = base.replace('/v1/', '/v1.1/') + 'search?' + p;
  const total = await memo('met:' + p, async () => (await getJSON(search + '&limit=1&offset=0')).total || 0);
  if (!total) return [];
  const ids = (await getJSON(search + '&limit=60&offset=' + rnd(plan, Math.max(1, total - 59)))).objectIDs || [];
  if (!ids.length) return [];
  const chosen = smp(plan, ids, plan.top ? 12 : 30);
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
/* Las fichas sueltas (/artworks/{id}) sí responden con CORS aunque los listados no: se prueban identificadores al azar
   (la mitad existen y buena parte tiene imagen) y se filtra por época, tipo y texto. */
async function aicProbe(plan, ctx) {
  const ids = Array.from({ length: 36 }, () => 1 + rand(240000));
  const want = [plan.artist || plan.hintArtist, plan.keyword].filter(Boolean).map(norm);
  const out = await mapLimit(ids, 8, async id => { try { return (await getJSON('https://api.artic.edu/api/v1/artworks/' + id, {}, 12000)).data; } catch (e) { return null; } });
  const list = out.filter(Boolean);
  const text = o => norm([o.title, o.artist_title, o.style_title, o.subject_titles && o.subject_titles.join(' ')].join(' '));
  const hits = list.filter(o => !want.length || want.some(w => text(o).includes(w)));
  if (!list.length && out.every(x => x === null)) { const e = new TypeError('Failed to fetch'); throw e; }
  return hits;
}
async function aicFetch(plan, f, ctx) {
  const url = 'https://api.artic.edu/api/v1/artworks/search';
  const text = [plan.style && plan.style.q, plan.artist || plan.hintArtist, plan.keyword].filter(Boolean).join(' ');
  /* En navegador, la API de AIC solo responde con CORS a la consulta simple q + limit (con fields, page o POST falla).
     Se pide el máximo (100 resultados) y se filtra aquí. */
  // Sin «fields» la búsqueda no trae image_id (y no habría imágenes). Con «fields» el navegador no recibe CORS: getJSONvia
  // repite la petición por el intermediario /api/p, que sí la acepta.
  const gp = new URLSearchParams({ limit: '100', fields: 'id,title,image_id,artist_title,date_display,date_start,date_end,is_public_domain,artwork_type_title,thumbnail' });
  if (text) gp.set('q', text);
  else gp.set('q', pick(GENERIC));
  let j;
  try { j = await memo('aic:' + gp, () => getJSONvia(url + '?' + gp, {}, 25000)); }
  catch (e) { if (!(e instanceof TypeError)) throw e; j = { data: await aicProbe(plan, ctx) }; }
  const lo = plan.range ? plan.range[0] : -Infinity, hi = plan.range ? plan.range[1] : Infinity, tw = AIC_TYPE[plan.type] ? norm(AIC_TYPE[plan.type]) : null;
  const data = smp(plan, (j.data || []).filter(o => o.image_id && (o.date_start == null || (o.date_start >= lo && o.date_start <= hi)) && (!tw || !o.artwork_type_title || norm(o.artwork_type_title).includes(tw))), 24);
  const iiif = (j.config && j.config.iiif_url) || 'https://www.artic.edu/iiif/2';
  return data.filter(o => o.image_id && (ctx.anyRights || o.is_public_domain !== false)).map(o => {
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
  const skip = rnd(plan, Math.max(1, total - limit + 1));
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
  const offset = rnd(plan, Math.max(1, Math.min(found - rows + 1, 9000)));
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
      imgs: [iiif ? iiif + '/full/!' + PX(ctx) + ',/0/default.jpg' : null, o.image_thumbnail, o.image_native].filter(Boolean),
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
  const j = await getJSON(base + '?' + use + '&page_size=' + size + '&page=' + (1 + rnd(plan, pages)));
  return (j.records || []).filter(o => o._primaryImageId).map(o => {
    const root = 'https://framemark.vam.ac.uk/collections/' + o._primaryImageId + '/full/';
    return mk({
      src: 'vam', museum: 'Victoria and Albert Museum', id: o.systemNumber,
      title: o._primaryTitle || o.objectType, artist: flipName(o._primaryMaker && o._primaryMaker.name),
      date: o._primaryDate, imgs: [root + '!' + PX(ctx) + ',' + PX(ctx) + '/0/default.jpg'],
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
  const from = rnd(plan, Math.max(1, Math.min(total - size + 1, 9000)));
  const j = await getJSON(url(from, size));
  const want = MIA_CLASS[plan.type];
  return ((j.hits && j.hits.hits) || []).map(h => h._source).filter(o => o && o.image === 'valid' && (ctx.anyRights || o.rights_type === 'Public Domain') && o.image_width && o.image_height).map(o => {
    const iiif = 'https://iiif.dx.artsmia.org/' + o.id + '.jpg/full/';
    return mk({
      src: 'mia', museum: 'Minneapolis Institute of Art', id: o.id,
      title: o.title, artist: o.artist || '', date: o.dated,
      imgs: [iiif + '!' + PX(ctx) + ',' + PX(ctx) + '/0/default.jpg', 'https://1.api.artsmia.org/' + o.id + '.jpg'],
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
  if (plan.top) p.set('title', plan.keyword);
  else {
    if (plan.keyword) p.set('description', plan.keyword);
    let y = plan.range ? plan.range[0] + rand(plan.range[1] - plan.range[0] + 1) : 1500 + rand(400);
    y = Math.min(Math.max(y, 1000), 2020);
    p.set('creationDate', Math.floor(y / 10) + '?');
  }
  const j = await getJSON('https://data.rijksmuseum.nl/search/collection?' + p);
  const ids = (j.orderedItems || []).map(x => x.id);
  if (!ids.length) return [];
  const chosen = smp(plan, ids, 8);
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
      imgs: [root + '!' + PX(ctx) + ',' + PX(ctx) + '/0/default.jpg'],
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
  { id: 'open', es: 'Colecciones abiertas', city: 'WikiArt, Google Art Project, Commons, Wikipedia, Wikidata y Europeana', ids: [], open: true, labels: [], q: '', note: 'No distinguen museos: se mezclan con cualquier museo' },
  { id: 'louvre', es: 'Louvre', city: 'París', ids: ['Q19675'], direct: 'louvre', labels: [['Louvre', 'en'], ['Musée du Louvre', 'fr'], ['Louvre Museum', 'en']] },
  { id: 'orsay', es: 'Orsay', city: 'París', ids: ['Q23402'], direct: 'orsay', labels: [["Musée d'Orsay", 'fr'], ["Musée d'Orsay", 'en'], ['Orsay Museum', 'en']] },
  { id: 'versailles', es: 'Versalles', city: 'Versalles', ids: ['Q2946'], labels: [['Palace of Versailles', 'en'], ['Château de Versailles', 'fr'], ['Musée national des châteaux de Versailles et de Trianon', 'fr']] },
  { id: 'orangerie', es: 'Orangerie', city: 'París', ids: [], labels: [["Musée de l'Orangerie", 'fr'], ["Musée de l'Orangerie", 'en'], ['Orangerie Museum', 'en']] },
  { id: 'marmottan', es: 'Marmottan Monet', city: 'París', ids: [], labels: [['Musée Marmottan Monet', 'fr'], ['Musée Marmottan Monet', 'en']] },
  { id: 'petitpalais', es: 'Petit Palais', city: 'París', ids: [], labels: [['Petit Palais', 'fr'], ['Petit Palais', 'en']] },
  { id: 'carnavalet', es: 'Carnavalet', city: 'París', ids: [], labels: [['Musée Carnavalet', 'fr'], ['Musée Carnavalet', 'en'], ['Carnavalet Museum', 'en']] },
  { id: 'lyon', es: 'Bellas Artes de Lyon', city: 'Lyon', ids: [], labels: [['Musée des Beaux-Arts de Lyon', 'fr'], ['Museum of Fine Arts of Lyon', 'en']] },
  { id: 'prado', es: 'Prado', city: 'Madrid', ids: ['Q160112'], direct: 'prado', labels: [['Museo del Prado', 'es'], ['Prado Museum', 'en'], ['Museo Nacional del Prado', 'es']] },
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
  { id: 'nga', es: 'National Gallery of Art', city: 'Washington', ids: [], direct: 'nga', labels: [['National Gallery of Art', 'en']] },
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
  { id: 'moma', es: 'MoMA', city: 'Nueva York', ids: [], direct: 'moma', labels: [['Museum of Modern Art', 'en'], ['Museum of Modern Art', 'es']] },
  { id: 'guggenheim', es: 'Guggenheim Nueva York', city: 'Nueva York', ids: [], labels: [['Solomon R. Guggenheim Museum', 'en'], ['Guggenheim Museum', 'en']] },
  { id: 'whitney', es: 'Whitney', city: 'Nueva York', ids: [], labels: [['Whitney Museum of American Art', 'en']] },
  { id: 'getty', es: 'J. Paul Getty Museum', city: 'Los Ángeles', ids: [], labels: [['J. Paul Getty Museum', 'en'], ['Getty Center', 'en']] },
  { id: 'lacma', es: 'LACMA', city: 'Los Ángeles', ids: [], labels: [['Los Angeles County Museum of Art', 'en']] },
  { id: 'pma', es: 'Philadelphia Museum of Art', city: 'Filadelfia', ids: [], labels: [['Philadelphia Museum of Art', 'en']] },
  { id: 'ngc', es: 'Galería Nacional de Canadá', city: 'Ottawa', ids: [], labels: [['National Gallery of Canada', 'en'], ['Musée des beaux-arts du Canada', 'fr']] },
  { id: 'tate', es: 'Tate', city: 'Londres', ids: [], direct: 'tate', labels: [['Tate Britain', 'en'], ['Tate Modern', 'en'], ['Tate', 'en']], q: 'Tate' },
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

/* Museos por país y con surrealismo. Fila: id, nombre, ciudad, país, etiquetas, nombres en Wikidata (texto@idioma). */
const MORE_MUSEUMS = [
  // México
  ['munal', 'Museo Nacional de Arte (MUNAL)', 'Ciudad de México', 'México', 'mx', ['Museo Nacional de Arte@es', 'National Museum of Art@en']],
  ['mammx', 'Museo de Arte Moderno de México', 'Ciudad de México', 'México', 'mx surreal', ['Museo de Arte Moderno@es', 'Museum of Modern Art@en']],
  ['tamayo', 'Museo Tamayo', 'Ciudad de México', 'México', 'mx', ['Museo Tamayo@es', 'Rufino Tamayo Museum@en']],
  ['kahlo', 'Museo Frida Kahlo (Casa Azul)', 'Ciudad de México', 'México', 'mx surreal', ['Museo Frida Kahlo@es', 'Frida Kahlo Museum@en']],
  ['olmedo', 'Museo Dolores Olmedo', 'Ciudad de México', 'México', 'mx surreal', ['Museo Dolores Olmedo@es', 'Dolores Olmedo Museum@en']],
  ['bellasartesmx', 'Palacio de Bellas Artes', 'Ciudad de México', 'México', 'mx', ['Palacio de Bellas Artes@es', 'Palace of Fine Arts@en']],
  ['jumex', 'Museo Jumex', 'Ciudad de México', 'México', 'mx', ['Museo Jumex@es', 'Jumex Museum@en']],
  ['franzmayer', 'Museo Franz Mayer', 'Ciudad de México', 'México', 'mx', ['Museo Franz Mayer@es', 'Franz Mayer Museum@en']],
  ['carrillogil', 'Museo de Arte Carrillo Gil', 'Ciudad de México', 'México', 'mx', ['Museo de Arte Carrillo Gil@es']],
  ['muac', 'MUAC (Arte Contemporáneo UNAM)', 'Ciudad de México', 'México', 'mx', ['Museo Universitario Arte Contemporáneo@es', 'University Museum of Contemporary Art@en']],
  ['sancarlos', 'Museo Nacional de San Carlos', 'Ciudad de México', 'México', 'mx', ['Museo Nacional de San Carlos@es']],
  ['anahuacalli', 'Museo Anahuacalli', 'Ciudad de México', 'México', 'mx', ['Museo Anahuacalli@es', 'Anahuacalli Museum@en']],
  ['casaestudio', 'Casa Estudio Diego Rivera y Frida Kahlo', 'Ciudad de México', 'México', 'mx', ['Museo Casa Estudio Diego Rivera y Frida Kahlo@es']],
  ['muraldiego', 'Museo Mural Diego Rivera', 'Ciudad de México', 'México', 'mx', ['Museo Mural Diego Rivera@es']],
  ['antropologia', 'Museo Nacional de Antropología', 'Ciudad de México', 'México', 'mx', ['Museo Nacional de Antropología@es', 'National Museum of Anthropology@en']],
  ['cabanas', 'Instituto Cultural Cabañas', 'Guadalajara', 'México', 'mx', ['Hospicio Cabañas@es', 'Instituto Cultural Cabañas@es']],
  ['marco', 'MARCO Monterrey', 'Monterrey', 'México', 'mx', ['Museo de Arte Contemporáneo de Monterrey@es', 'MARCO@es']],
  // Bélgica
  ['kmskb', 'Museos Reales de Bellas Artes de Bélgica', 'Bruselas', 'Bélgica', 'be surreal', ['Royal Museums of Fine Arts of Belgium@en', 'Musées royaux des Beaux-Arts de Belgique@fr', 'Koninklijke Musea voor Schone Kunsten van België@nl']],
  ['magritte', 'Museo Magritte', 'Bruselas', 'Bélgica', 'be surreal', ['Magritte Museum@en', 'Musée Magritte@fr', 'Musée Magritte Museum@fr']],
  ['magrittecasa', 'Casa-museo René Magritte', 'Jette', 'Bélgica', 'be surreal', ['Musée René Magritte@fr', 'René Magritte Museum@en']],
  ['findesiecle', 'Museo Fin-de-Siècle', 'Bruselas', 'Bélgica', 'be', ['Musée Fin-de-Siècle@fr', 'Fin-de-Siècle Museum@en']],
  ['oldmasters', 'Museo Oldmasters', 'Bruselas', 'Bélgica', 'be', ['Oldmasters Museum@en', 'Musée Oldmasters@fr']],
  ['bozar', 'Bozar', 'Bruselas', 'Bélgica', 'be', ['Bozar@fr', 'Centre for Fine Arts, Brussels@en']],
  ['ixelles', "Museo de Ixelles", 'Bruselas', 'Bélgica', 'be', ["Musée d'Ixelles@fr", 'Museum of Ixelles@en']],
  ['horta', 'Museo Horta', 'Bruselas', 'Bélgica', 'be', ['Musée Horta@fr', 'Horta Museum@en']],
  ['groeninge', 'Museo Groeninge', 'Brujas', 'Bélgica', 'be', ['Groeningemuseum@nl', 'Groeninge Museum@en']],
  ['memling', 'Memling en el Sint-Janshospitaal', 'Brujas', 'Bélgica', 'be', ['Sint-Janshospitaal@nl', 'Memling in Sint-Jan@en']],
  ['kmska', 'Real Museo de Bellas Artes de Amberes', 'Amberes', 'Bélgica', 'be', ['Royal Museum of Fine Arts Antwerp@en', 'Koninklijk Museum voor Schone Kunsten Antwerpen@nl']],
  ['rubenshuis', 'Casa de Rubens', 'Amberes', 'Bélgica', 'be', ['Rubenshuis@nl', 'Rubens House@en']],
  ['plantin', 'Museo Plantin-Moretus', 'Amberes', 'Bélgica', 'be', ['Museum Plantin-Moretus@nl', 'Plantin-Moretus Museum@en']],
  ['mayervdb', 'Museo Mayer van den Bergh', 'Amberes', 'Bélgica', 'be', ['Museum Mayer van den Bergh@nl', 'Mayer van den Bergh Museum@en']],
  ['mhka', 'M HKA', 'Amberes', 'Bélgica', 'be', ['M HKA@nl', 'Museum of Contemporary Art Antwerp@en']],
  ['mskgent', 'Museo de Bellas Artes de Gante', 'Gante', 'Bélgica', 'be', ['Museum voor Schone Kunsten Gent@nl', 'Museum of Fine Arts, Ghent@en']],
  ['smak', 'S.M.A.K.', 'Gante', 'Bélgica', 'be', ['S.M.A.K.@nl', 'Stedelijk Museum voor Actuele Kunst@nl']],
  ['mleuven', 'M Leuven', 'Lovaina', 'Bélgica', 'be', ['M – Museum Leuven@nl', 'M Leuven@en']],
  ['muzee', 'Mu.ZEE', 'Ostende', 'Bélgica', 'be surreal', ['Mu.ZEE@nl', 'Mu.ZEE@en']],
  ['dhondt', 'Museum Dhondt-Dhaenens', 'Deurle', 'Bélgica', 'be', ['Museum Dhondt-Dhaenens@nl']],
  ['delvaux', 'Museo Paul Delvaux', 'Saint-Idesbald', 'Bélgica', 'be surreal', ['Paul Delvaux Museum@en', 'Musée Paul Delvaux@fr', 'Paul Delvaux Museum@nl']],
  ['boverie', 'La Boverie (Bellas Artes de Lieja)', 'Lieja', 'Bélgica', 'be', ['La Boverie@fr', 'Musée des Beaux-Arts de Liège@fr']],
  ['bam', 'BAM (Bellas Artes de Mons)', 'Mons', 'Bélgica', 'be', ['Musée des Beaux-Arts de Mons@fr', 'BAM@fr']],
  ['tournai', 'Bellas Artes de Tournai', 'Tournai', 'Bélgica', 'be', ['Musée des Beaux-Arts de Tournai@fr']],
  ['mariemont', 'Museo Real de Mariemont', 'Morlanwelz', 'Bélgica', 'be', ['Musée royal de Mariemont@fr']],
  ['rops', 'Museo Félicien Rops', 'Namur', 'Bélgica', 'be', ['Musée Félicien Rops@fr', 'Félicien Rops Museum@en']],
  ['grandhornu', "MAC's Grand-Hornu", 'Hornu', 'Bélgica', 'be', ["MAC's Grand-Hornu@fr", 'Musée des arts contemporains@fr']],
  ['museel', 'Musée L', 'Lovaina la Nueva', 'Bélgica', 'be', ['Musée L@fr']],
  // Con obras surrealistas
  ['dalifigueres', 'Teatro-Museo Dalí', 'Figueres', 'España', 'surreal', ['Dalí Theatre and Museum@en', 'Teatro-Museo Dalí@es', 'Teatre-Museu Dalí@ca']],
  ['dalifl', 'Museo Dalí de San Petersburgo', 'San Petersburgo (Florida)', 'EE. UU.', 'surreal', ['Salvador Dalí Museum@en', 'Dalí Museum@en']],
  ['miro', 'Fundació Joan Miró', 'Barcelona', 'España', 'surreal', ['Fundació Joan Miró@ca', 'Joan Miró Foundation@en']],
  ['mnac', 'MNAC', 'Barcelona', 'España', 'surreal', ["Museu Nacional d'Art de Catalunya@ca", 'National Art Museum of Catalonia@en']],
  ['guggenheimbilbao', 'Guggenheim Bilbao', 'Bilbao', 'España', 'surreal', ['Guggenheim Museum Bilbao@en', 'Museo Guggenheim Bilbao@es']],
  ['mamparis', 'Museo de Arte Moderno de París', 'París', 'Francia', 'surreal', ["Musée d'Art moderne de Paris@fr", 'Museum of Modern Art of the City of Paris@en']],
  ['grenoble', 'Museo de Grenoble', 'Grenoble', 'Francia', 'surreal', ['Musée de Grenoble@fr']],
  ['k20', 'K20 Düsseldorf', 'Düsseldorf', 'Alemania', 'surreal', ['Kunstsammlung Nordrhein-Westfalen@de', 'K20@de']],
  ['maxernst', 'Museo Max Ernst', 'Brühl', 'Alemania', 'surreal', ['Max Ernst Museum Brühl des LVR@de', 'Max Ernst Museum@en']],
  ['folkwang', 'Museum Folkwang', 'Essen', 'Alemania', 'surreal', ['Museum Folkwang@de', 'Museum Folkwang@en']],
  ['hamburger', 'Hamburger Kunsthalle', 'Hamburgo', 'Alemania', 'surreal', ['Hamburger Kunsthalle@de', 'Hamburger Kunsthalle@en']],
  ['ludwig', 'Museum Ludwig', 'Colonia', 'Alemania', 'surreal', ['Museum Ludwig@de', 'Museum Ludwig@en']],
  ['pinakothekmod', 'Pinakothek der Moderne', 'Múnich', 'Alemania', 'surreal', ['Pinakothek der Moderne@de', 'Pinakothek der Moderne@en']],
  ['brandhorst', 'Museum Brandhorst', 'Múnich', 'Alemania', 'surreal', ['Museum Brandhorst@de']],
  ['beyeler', 'Fondation Beyeler', 'Riehen', 'Suiza', 'surreal', ['Fondation Beyeler@de', 'Fondation Beyeler@en']],
  ['zpk', 'Zentrum Paul Klee', 'Berna', 'Suiza', 'surreal', ['Zentrum Paul Klee@de', 'Zentrum Paul Klee@en']],
  ['moderna', 'Moderna Museet', 'Estocolmo', 'Suecia', 'surreal', ['Moderna Museet@sv', 'Moderna Museet@en']],
  ['louisiana', 'Louisiana Museum of Modern Art', 'Humlebæk', 'Dinamarca', 'surreal', ['Louisiana Museum of Modern Art@en', 'Louisiana Museum of Modern Art@da']],
  ['sngma', 'Scottish National Gallery of Modern Art', 'Edimburgo', 'Reino Unido', 'surreal', ['Scottish National Gallery of Modern Art@en']],
  ['newfields', 'Newfields (Indianapolis Museum of Art)', 'Indianápolis', 'EE. UU.', 'surreal', ['Indianapolis Museum of Art@en', 'Newfields@en']],
  ['picassomalaga', 'Museo Picasso Málaga', 'Málaga', 'España', 'artist', ['Museo Picasso Málaga@es']],
  ['picassobcn', 'Museu Picasso de Barcelona', 'Barcelona', 'España', 'artist', ['Museu Picasso@ca', 'Museu Picasso@en']],
  ['sorolla', 'Museo Sorolla', 'Madrid', 'España', 'artist', ['Museo Sorolla@es']],
  ['romero', 'Museo Julio Romero de Torres', 'Córdoba', 'España', 'artist', ['Museo Julio Romero de Torres@es']],
  ['botero', 'Museo Botero', 'Bogotá', 'Colombia', 'artist', ['Museo Botero@es']],
  ['matisse', 'Musée Matisse', 'Niza', 'Francia', 'artist', ['Musée Matisse@fr']],
  ['chagallnice', 'Musée national Marc Chagall', 'Niza', 'Francia', 'artist', ['Musée national Marc Chagall@fr']],
  ['gmoreau', 'Musée Gustave Moreau', 'París', 'Francia', 'artist', ['Musée Gustave Moreau@fr']],
  ['maeght', 'Fondation Maeght', 'Saint-Paul-de-Vence', 'Francia', 'artist surreal', ['Fondation Maeght@fr']],
  ['kandinskymunich', 'Lenbachhaus (Der Blaue Reiter)', 'Múnich', 'Alemania', 'artist', ['Lenbachhaus@de', 'Städtische Galerie im Lenbachhaus@de']],
  ['hiroshige', 'Museo Hiroshige y Hokusai (Sumida Hokusai)', 'Tokio', 'Japón', 'artist', ['Sumida Hokusai Museum@en']],
  ['hundertwasser', 'Museo Hundertwasser (KunstHausWien)', 'Viena', 'Austria', 'artist', ['Kunst Haus Wien@de', 'Hundertwasser Museum@en']],
  ['leopold', 'Museo Leopold (Klimt y Schiele)', 'Viena', 'Austria', 'artist', ['Leopold Museum@en']],
  ['wyeth', 'Brandywine Museum (Wyeth)', 'Chadds Ford', 'EE. UU.', 'artist', ['Brandywine River Museum of Art@en']],
  ['okeeffe', 'Museo Georgia O\'Keeffe', 'Santa Fe', 'EE. UU.', 'artist', ['Georgia O\'Keeffe Museum@en']],
  ['warhol', 'The Andy Warhol Museum', 'Pittsburgh', 'EE. UU.', 'artist', ['Andy Warhol Museum@en']],
  ['hirshhorn', 'Hirshhorn Museum', 'Washington', 'EE. UU.', 'surreal', ['Hirshhorn Museum and Sculpture Garden@en']],
  ['pinacoteca', 'Pinacoteca de São Paulo', 'São Paulo', 'Brasil', '', ['Pinacoteca do Estado de São Paulo@pt', 'Pinacoteca of the State of São Paulo@en']],
  ['menil', 'Menil Collection', 'Houston', 'EE. UU.', 'surreal', ['Menil Collection@en', 'The Menil Collection@en']],
  ['mfah', 'Museum of Fine Arts, Houston', 'Houston', 'EE. UU.', 'surreal', ['Museum of Fine Arts, Houston@en']],
  ['sfmoma', 'SFMOMA', 'San Francisco', 'EE. UU.', 'surreal', ['San Francisco Museum of Modern Art@en']],
  ['wadsworth', 'Wadsworth Atheneum', 'Hartford', 'EE. UU.', 'surreal', ['Wadsworth Atheneum@en']],
  ['yale', 'Yale University Art Gallery', 'New Haven', 'EE. UU.', 'surreal', ['Yale University Art Gallery@en']],
  ['nortonsimon', 'Norton Simon Museum', 'Pasadena', 'EE. UU.', 'surreal', ['Norton Simon Museum@en']],
  ['dia', 'Detroit Institute of Arts', 'Detroit', 'EE. UU.', 'surreal', ['Detroit Institute of Arts@en']],
  ['brooklyn', 'Brooklyn Museum', 'Nueva York', 'EE. UU.', 'surreal', ['Brooklyn Museum@en']],
  ['carnegie', 'Carnegie Museum of Art', 'Pittsburgh', 'EE. UU.', 'surreal', ['Carnegie Museum of Art@en']],
  ['slam', 'Saint Louis Art Museum', 'San Luis', 'EE. UU.', 'surreal', ['Saint Louis Art Museum@en']],
  ['ago', 'Art Gallery of Ontario', 'Toronto', 'Canadá', 'surreal', ['Art Gallery of Ontario@en']],
  ['mmfa', 'Museo de Bellas Artes de Montreal', 'Montreal', 'Canadá', 'surreal', ['Montreal Museum of Fine Arts@en', 'Musée des beaux-arts de Montréal@fr']],
  ['malba', 'MALBA', 'Buenos Aires', 'Argentina', 'surreal', ['Museo de Arte Latinoamericano de Buenos Aires@es', 'MALBA@es']],
  ['momat', 'Museo Nacional de Arte Moderno de Tokio', 'Tokio', 'Japón', 'surreal', ['National Museum of Modern Art, Tokyo@en', 'MOMAT@en']],
  ['lam', 'Museo Nacional de Bellas Artes de Cuba', 'La Habana', 'Cuba', 'surreal', ['Museo Nacional de Bellas Artes de Cuba@es', 'National Museum of Fine Arts of Cuba@en']],
  // Grandes pinacotecas que faltaban (entre los museos de arte más importantes del mundo)
  ['gemaelde', 'Gemäldegalerie', 'Berlín', 'Alemania', '', ['Gemäldegalerie@de', 'Gemäldegalerie, Berlin@en', 'Gemäldegalerie Berlin@en']],
  ['altenational', 'Alte Nationalgalerie', 'Berlín', 'Alemania', '', ['Alte Nationalgalerie@de', 'Alte Nationalgalerie@en']],
  ['wallraf', 'Wallraf-Richartz', 'Colonia', 'Alemania', '', ['Wallraf-Richartz-Museum@de', 'Wallraf–Richartz Museum@en', 'Wallraf-Richartz Museum@en']],
  ['vaticanos', 'Museos Vaticanos', 'Ciudad del Vaticano', 'Vaticano', '', ['Vatican Museums@en', 'Musei Vaticani@it', 'Pinacoteca Vaticana@it', 'Vatican Pinacotheca@en']],
  ['capodimonte', 'Museo de Capodimonte', 'Nápoles', 'Italia', '', ['Museo di Capodimonte@it', 'Museo e Real Bosco di Capodimonte@it', 'Museo Nazionale di Capodimonte@it', 'Museo di Capodimonte@en']],
  ['pitti', 'Palacio Pitti (Galería Palatina)', 'Florencia', 'Italia', '', ['Galleria Palatina@it', 'Palatine Gallery@en', 'Palazzo Pitti@it', 'Palazzo Pitti@en']],
  ['barberini', 'Galería Nacional de Arte Antiguo (Barberini y Corsini)', 'Roma', 'Italia', '', ["Galleria Nazionale d'Arte Antica@it", "Galleria Nazionale d'Arte Antica@en", 'Palazzo Barberini@it', 'Galleria Corsini@it']],
  ['carrara', 'Accademia Carrara', 'Bérgamo', 'Italia', '', ['Accademia Carrara@it', 'Accademia Carrara@en']],
  ['conde', 'Museo Condé (Chantilly)', 'Chantilly', 'Francia', '', ['Musée Condé@fr', 'Musée Condé@en']],
  ['budapest', 'Museo de Bellas Artes de Budapest', 'Budapest', 'Hungría', '', ['Szépművészeti Múzeum@hu', 'Museum of Fine Arts, Budapest@en', 'Museum of Fine Arts (Budapest)@en']],
  ['varsovia', 'Museo Nacional de Varsovia', 'Varsovia', 'Polonia', '', ['Muzeum Narodowe w Warszawie@pl', 'National Museum in Warsaw@en']],
  ['rusomuseum', 'Museo Ruso', 'San Petersburgo', 'Rusia', '', ['Russian Museum@en', 'State Russian Museum@en', 'Государственный Русский музей@ru', 'Русский музей@ru']],
  ['npglondon', 'National Portrait Gallery (Londres)', 'Londres', 'Reino Unido', '', ['National Portrait Gallery, London@en', 'National Portrait Gallery (London)@en']],
  ['barnes', 'Fundación Barnes', 'Filadelfia', 'Estados Unidos', '', ['Barnes Foundation@en', 'The Barnes Foundation@en']],
  ['phillips', 'Phillips Collection', 'Washington', 'Estados Unidos', '', ['The Phillips Collection@en', 'Phillips Collection@en']],
  ['gardner', 'Isabella Stewart Gardner Museum', 'Boston', 'Estados Unidos', '', ['Isabella Stewart Gardner Museum@en']],
  ['nelson', 'Nelson-Atkins Museum of Art', 'Kansas City', 'Estados Unidos', '', ['Nelson-Atkins Museum of Art@en', 'The Nelson-Atkins Museum of Art@en']],
  ['neuegalerie', 'Neue Galerie (Nueva York)', 'Nueva York', 'Estados Unidos', '', ['Neue Galerie New York@en', 'Neue Galerie@en']],
  ['nmwa', 'Museo Nacional de Arte Occidental', 'Tokio', 'Japón', '', ['National Museum of Western Art@en', '国立西洋美術館@ja']]
];
const TAG_NAMES = { mx: 'México', be: 'Bélgica', surreal: 'surrealismo', artist: 'museos de un solo artista' };
MORE_MUSEUMS.forEach(r => MUSEUMS.push({ id: r[0], es: r[1], city: r[2], country: r[3], tags: r[4].split(' ').filter(Boolean), ids: [], labels: r[5].map(x => { const k = x.lastIndexOf('@'); return [x.slice(0, k), x.slice(k + 1)]; }) }));
// Los museos ya existentes que también tienen surrealismo o son de esos países
const MORE_TAGS = { surreal: ['moma', 'guggenheim', 'peggy', 'pma', 'reinasofia', 'thyssen', 'boijmans', 'zurich', 'pompidou', 'tate', 'aic', 'lacma', 'picassoparis', 'ngc', 'ngv', 'basel', 'staedel', 'nga'], mx: ['soumaya'] };
MORE_TAGS.artist = ['picassoparis', 'picassobcn', 'rodin', 'munch', 'miro', 'zpk', 'maeght', 'dali', 'vangogh', 'kroller', 'magritte', 'kahlo', 'olmedo', 'tamayo', 'anahuacalli', 'casaestudio', 'muraldiego'];
Object.keys(MORE_TAGS).forEach(t => MORE_TAGS[t].forEach(id => { const m = MUSEUMS.find(x => x.id === id); if (m) m.tags = (m.tags || []).concat(t); }));
MUSEUMS.forEach(m => { if (m.tags && m.tags.length && !DEFAULT_MUSEUMS.includes(m.id)) DEFAULT_MUSEUMS.push(m.id); });
DEFAULT_MUSEUMS.forEach(id => { SOURCE_DEFAULTS['m:' + id] = true; });
const museumIdsByTag = tag => MUSEUMS.filter(m => (m.tags || []).includes(tag)).map(m => 'm:' + m.id);

/* País de cada museo → una colección rápida «Museos de <país>» por país. Los museos con país explícito lo usan; el resto, por su ciudad.
   Al añadir un museo de un país nuevo (aquí o desde el menú) aparece sola su colección. */
const COUNTRY_ALIAS = { 'ee. uu.': 'Estados Unidos', 'eeuu': 'Estados Unidos', 'usa': 'Estados Unidos', 'estados unidos de america': 'Estados Unidos', 'united states': 'Estados Unidos', 'united kingdom': 'Reino Unido', 'gran bretana': 'Reino Unido', 'holanda': 'Países Bajos', 'netherlands': 'Países Bajos', 'mexico': 'México', 'spain': 'España', 'france': 'Francia', 'germany': 'Alemania', 'belgium': 'Bélgica', 'italy': 'Italia', 'japan': 'Japón', 'rusia': 'Rusia', 'russia': 'Rusia' };
const CITY_COUNTRY = {
  'Nueva York': 'Estados Unidos', 'Chicago': 'Estados Unidos', 'Cleveland': 'Estados Unidos', 'Minneapolis': 'Estados Unidos', 'Washington': 'Estados Unidos', 'Cambridge (EE. UU.)': 'Estados Unidos', 'Boston': 'Estados Unidos', 'Los Ángeles': 'Estados Unidos', 'Filadelfia': 'Estados Unidos',
  'Ámsterdam': 'Países Bajos', 'La Haya': 'Países Bajos', 'Róterdam': 'Países Bajos', 'Otterlo': 'Países Bajos',
  'Londres': 'Reino Unido', 'Edimburgo': 'Reino Unido', 'Copenhague': 'Dinamarca', 'Estocolmo': 'Suecia', 'Oslo': 'Noruega', 'Helsinki': 'Finlandia', 'Dublín': 'Irlanda', 'Lisboa': 'Portugal',
  'París': 'Francia', 'Versalles': 'Francia', 'Lille': 'Francia', 'Lyon': 'Francia', 'Montpellier': 'Francia', 'Ruan': 'Francia',
  'Florencia': 'Italia', 'Milán': 'Italia', 'Roma': 'Italia', 'Venecia': 'Italia',
  'Madrid': 'España', 'Bilbao': 'España', 'Barcelona': 'España',
  'Fráncfort': 'Alemania', 'Dresde': 'Alemania', 'Múnich': 'Alemania',
  'Basilea': 'Suiza', 'Zúrich': 'Suiza', 'Berna': 'Suiza', 'Viena': 'Austria',
  'Moscú': 'Rusia', 'San Petersburgo': 'Rusia', 'Tokio': 'Japón', 'Melbourne': 'Australia', 'Sídney': 'Australia', 'Ottawa': 'Canadá',
  'Buenos Aires': 'Argentina', 'São Paulo': 'Brasil', 'Ciudad de México': 'México', 'Monterrey': 'México', 'Guadalajara': 'México'
};
function museumCountry(m) {
  const c = m && m.country ? String(m.country).trim() : '';
  if (c) return COUNTRY_ALIAS[norm(c)] || c;
  return (m && CITY_COUNTRY[m.city]) || null;
}
/* «Museos de México», «Museos del Reino Unido», «Museos de los Países Bajos» */
const COUNTRY_ART = { 'Reino Unido': 'del ', 'Países Bajos': 'de los ', 'Vaticano': 'del ' };
const countryCollectionName = c => 'Museos ' + (COUNTRY_ART[c] || 'de ') + c;
function countryCollections() {
  const by = {};
  MUSEUMS.forEach(m => { if (m.open) return; const c = museumCountry(m); if (c) (by[c] = by[c] || []).push('m:' + m.id); });
  return Object.keys(by).sort((a, b) => a.localeCompare(b, 'es')).map(c => ({ country: c, es: countryCollectionName(c), ids: by[c] }));
}

/* Máximo 2 consultas a Wikidata a la vez: el servicio corta a quien abusa. Si responde 429 (o corta la conexión, que es lo mismo
   cuando el 429 no trae cabeceras CORS), todas las consultas esperan unos segundos. */
const TUNING = Object.assign({ sparqlPause: 6000 }, typeof globalThis !== 'undefined' && typeof globalThis.__ART_TUNING === 'object' ? globalThis.__ART_TUNING : {});
let sparqlActive = 0; const sparqlQueue = []; let sparqlPauseUntil = 0;
// prio: la consulta se cuela delante (la búsqueda por foto no espera detrás de los conteos de los museos)
const sparqlSlot = async prio => { await new Promise(res => { if (sparqlActive < (prio ? 3 : 2)) { sparqlActive++; res(); } else if (prio) sparqlQueue.unshift(res); else sparqlQueue.push(res); }); const w = sparqlPauseUntil - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w)); };
const sparqlDone = () => { const n = sparqlQueue.shift(); if (n) n(); else sparqlActive--; };
const sparqlEsc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
async function sparql(q, post, prio) {
  const url = 'https://query.wikidata.org/sparql?format=json' + (post ? '' : '&query=' + encodeURIComponent(q));
  // Las consultas largas (varias a la vez) van por POST: por GET la dirección sería demasiado larga.
  const init = post ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'query=' + encodeURIComponent(q) } : {};
  const go = async () => (await getJSON(url, init, post ? 55000 : 40000)).results.bindings;
  await sparqlSlot(prio);
  try {
    try { return await go(); }
    catch (e) {
      if (!e || !(e.status === 429 || e instanceof TypeError)) throw e;
      sparqlPauseUntil = Date.now() + TUNING.sparqlPause; await new Promise(r => setTimeout(r, TUNING.sparqlPause));
      return await go();
    }
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
  if (style && style.wd) parts.push('?mv rdfs:label "' + sparqlEsc(style.wd) + '"@en. { ?item wdt:P135 ?mv. } UNION { ?item wdt:P170 ?cr0. ?cr0 wdt:P135 ?mv. }');
  if (artist) parts.push('SERVICE wikibase:mwapi { bd:serviceParam wikibase:endpoint "www.wikidata.org" . bd:serviceParam wikibase:api "EntitySearch" . bd:serviceParam mwapi:search "' + sparqlEsc(artist) + '" . bd:serviceParam mwapi:language "en" . ?creator wikibase:apiOutputItem mwapi:item. } ?item wdt:P170 ?creator.');
  else parts.push('OPTIONAL { ?item wdt:P170 ?creator. }');
  parts.push(typeQ ? '?item wdt:P31 wd:' + typeQ + '.' : 'OPTIONAL { ?item wdt:P31 ?cls. }');
  // P18 = imagen en Commons. P6500 = imagen externa de obras con derechos de autor.
  // Ruta alternativa (no UNION): con UNION, Wikidata recorría todas las imágenes antes de cruzar con el museo y se agotaba el tiempo.
  parts.push(opts.anyRights ? '?item wdt:P18|wdt:P6500 ?image.' : '?item wdt:P18 ?image.');
  parts.push('OPTIONAL { ?item wdt:P571 ?inc. } OPTIONAL { ?creator wdt:P570 ?death. }' + (m ? '' : ' OPTIONAL { ?item wdt:P195 ?coll. }'));
  if (plan.range) {
    const yr = 'YEAR(?inc) >= ' + Math.round(plan.range[0]) + ' && YEAR(?inc) <= ' + Math.round(plan.range[1]);
    // Con un estilo elegido, las obras sin fecha en Wikidata también valen.
    parts.push(style ? 'FILTER(!BOUND(?inc) || (' + yr + ')).' : 'FILTER(BOUND(?inc) && ' + yr + ').');
  }
  if (!opts.anyRights) parts.push('FILTER((BOUND(?inc) && YEAR(?inc) <= 1930) || (BOUND(?death) && YEAR(?death) <= 1955)).');
  return { parts, typeQ, sid: style && style.wd ? style.id : null };
}
/* La página de obras se elige en una subconsulta y los nombres se ponen después: así Wikidata solo busca nombres para 60 filas.
   Con el servicio de nombres fuera de la subconsulta la consulta de un museo tardaba más de un minuto y se cortaba (comprobado
   con la prueba diaria: 65 s y error 504 frente a 0,6 s). */
function wdSelect(parts, off, withClass) {
  return 'SELECT ?item ?itemLabel ?creatorLabel ?collLabel ' + (withClass ? '?clsLabel ' : '') + '?image ?inc WHERE { { SELECT ?item ?creator ?coll ?cls ?image ?inc WHERE { ' +
    parts.join(' ') + ' } LIMIT 60 OFFSET ' + off + ' } SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en,fr". } }';
}
const FILEPATH = /commons\.wikimedia\.org\/wiki\/Special:FilePath\//i;
function wdRows(rows, typeQ, ctx, museumName, anyRights, sid) {
  const seen = new Set();
  const w = PX(ctx);
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
      imgs: commons ? commonsImgs(raw, w) : [raw], thumb: commons ? raw + '?width=500' : raw,
      url: 'https://www.wikidata.org/wiki/' + qid,
      type: typeQ ? WD_NAME[typeQ] : classifyType(r.clsLabel && r.clsLabel.value),
      sid: sid || null, pd: anyRights ? null : true, license: commons ? (anyRights ? 'Imagen de Wikimedia Commons' : 'Dominio público (Wikimedia)') : 'Imagen externa, con derechos de autor'
    });
  });
}

async function wikiFetch(plan, f, ctx) {
  const any = !!ctx.anyRights;
  const { parts, typeQ, sid } = wdParts(plan, { anyRights: any, byType: true });
  let rows = await sparql(wdSelect(parts, rand(400), false));
  if (rows.length < 8) rows = await sparql(wdSelect(parts, 0, false));
  return wdRows(rows, typeQ, ctx, null, any, sid);
}

/* Un Wikidata por museo: todas las obras de su colección que tengan imagen. */
function wdMuseumQuery(m, plan, f, ctx) {
  const any = !!ctx.anyRights;
  const { parts, typeQ, sid } = wdParts(plan, { museum: m, anyRights: any, byType: !!(f.types && f.types.length) });
  let body = parts.filter(x => !/^OPTIONAL \{ \?item wdt:P(170|31) \?(creator|cls)\. \}$/.test(x)).join(' ');
  if (any) body = body.replace(' OPTIONAL { ?creator wdt:P570 ?death. }', '');
  return { parts, typeQ, sid, any, body, countQ: 'SELECT (COUNT(DISTINCT ?item) AS ?n) WHERE { ' + body + ' }' };
}
/* Conteos de Wikidata en lote: en vez de una consulta de conteo por museo, una sola para varios museos (UNION + GROUP BY).
   Cada museo encuentra su total ya calculado (o en camino) en la memoria; si el lote falla, cada uno cuenta por su cuenta. */
const WD_BATCH = 6;
async function primeWikidataCounts(sources, f, ctx) {
  const plan = makePlan(f); if (plan.empty) return 0;
  const todo = (sources || []).map(s => s && s.museum).filter(m => m && !m.open && (m.ids.length || m.labels.length))
    .map(m => Object.assign({ m }, wdMuseumQuery(m, plan, f, ctx))).filter(x => !memoKnown('fm:' + x.countQ));
  const uniq = []; todo.forEach(x => { if (!uniq.some(y => y.countQ === x.countQ)) uniq.push(x); });
  let done = 0;
  for (let i = 0; i < uniq.length; i += WD_BATCH) {
    const batch = uniq.slice(i, i + WD_BATCH);
    const q = 'SELECT ?k (COUNT(DISTINCT ?item) AS ?n) WHERE { ' + batch.map((x, k) => '{ ' + x.body + ' BIND(' + k + ' AS ?k) }').join(' UNION ') + ' } GROUP BY ?k';
    const res = sparql(q, true).then(rows => { const o = {}; rows.forEach(r => { o[+r.k.value] = parseInt(r.n.value, 10) || 0; }); return o; });
    batch.forEach((x, k) => memoPut('fm:' + x.countQ, res.then(o => o[k] || 0)));
    try { await res; done += batch.length; } catch (e) { /* ese lote falló: sus museos contarán solos */ }
  }
  return done;
}
async function wikidataMuseum(m, plan, f, ctx) {
  const { parts, typeQ, sid, any, countQ } = wdMuseumQuery(m, plan, f, ctx);
  const total = await memo('fm:' + countQ, async () => { const r = await sparql(countQ); return r[0] && r[0].n ? parseInt(r[0].n.value, 10) : 0; });
  if (!total) return [];
  const rows = await sparql(wdSelect(parts, rand(Math.max(1, total - 59)), !typeQ));
  return wdRows(rows, typeQ, ctx, m.es + ' (' + m.city + ')', any, sid);
}

async function europeanaFetch(plan, f, ctx, m) {
  const key = ctx.keys && ctx.keys.europeana;
  if (!key) { if (m) return []; const e = new Error('Falta clave'); e.noKey = true; throw e; } // por museo, sin clave simplemente no aporta
  const text = [plan.style && plan.style.q, plan.artist || plan.hintArtist, plan.keyword, plan.type === 'painting' ? 'painting' : ''].filter(Boolean).join(' ') || pick(GENERIC);
  const p = new URLSearchParams({ wskey: key, query: text, media: 'true', thumbnail: 'true', rows: '24' });
  if (!ctx.anyRights) p.set('reusability', 'open');
  p.append('qf', 'TYPE:IMAGE');
  if (m) { // un museo = la institución que aporta los registros (DATA_PROVIDER)
    const names = Array.from(new Set([].concat(m.eu || [], m.labels.map(x => x[0]), m.q || []).filter(Boolean)));
    p.append('qf', 'DATA_PROVIDER:(' + names.map(n => '"' + String(n).replace(/"/g, '') + '"').join(' OR ') + ')');
  }
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
      src: 'europeana', museum: (m && m.es) || ((o.dataProvider || [])[0]) || 'Europeana', id: o.id,
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
    imgs: [o.primaryimageurl + '?height=' + PX(ctx) + '&width=' + PX(ctx)], thumb: o.primaryimageurl + '?height=500&width=500',
    url: o.url, type: classifyType(o.classification), pd: false, license: 'Harvard (uso no comercial)'
  }));
}

/* Las API de Wikimedia (Commons, Wikipedia) responden 429 si se les pide demasiado de golpe: cola de 2 y reintento. */
let wmActive = 0; const wmQueue = [];
const wmSlot = () => new Promise(res => { if (wmActive < 2) { wmActive++; res(); } else wmQueue.push(res); });
const wmDone = () => { const n = wmQueue.shift(); if (n) n(); else wmActive--; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function wmJSON(url) {
  await wmSlot();
  try {
    for (let i = 0; ; i++) {
      try { return await getJSON(url, {}, 20000); }
      catch (e) { if (!(e && e.status === 429) || i >= 3) throw e; await sleep(2500 * (i + 1)); }
    }
  } finally { wmDone(); }
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
      if (!plan.style && !kw) q.push('deepcategory:"' + COMMONS_CAT[kind] + ' in the ' + m.q + '"' + tail);
      if (plan.style) q.push(name + ' ' + plan.style.q + ' ' + kind + kw + tail);
      q.push(name + ' ' + kind + kw + tail);
    }
    return q;
  }
  if (plan.artist) {
    const by = { painting: 'Paintings by ', drawing: 'Drawings by ', print: 'Prints by ', photograph: 'Photographs by ', sculpture: 'Sculptures by ' }[kind];
    q.push('deepcategory:"' + by + plan.artist + '"' + (plan.keyword ? ' ' + plan.keyword : '') + tail);
    if (!plan.keyword) q.push('deepcategory:"' + plan.artist + '"' + tail);
    q.push('"' + plan.artist + '" ' + kind + (plan.keyword ? ' ' + plan.keyword : '') + tail);
  } else if (plan.style && plan.style.cat) {
    q.push('deepcategory:"' + plan.style.cat + '"' + (plan.keyword ? ' ' + plan.keyword : '') + tail);
    q.push((plan.style.q) + ' ' + kind + (plan.keyword ? ' ' + plan.keyword : '') + tail);
    if (plan.hintArtist) q.push('"' + plan.hintArtist + '" painting' + tail);
  } else if (plan.style) q.push(plan.style.q + ' ' + kind + tail);
  else q.push((plan.keyword || pick(GENERIC)) + ' ' + kind + ' museum' + tail);
  return q;
}
async function commonsFetch(plan, f, ctx, m) { return commonsSearch(commonsQueries(plan, f, m), plan, ctx, m); }
/* Portada de Commons: imágenes destacadas y las del proyecto Google Art Project (miles de cuadros en alta resolución). */
async function commonsSpecial(kind, plan, f, ctx) {
  const k = COMMONS_KIND[plan.type] || 'painting', artist = plan.artist || plan.hintArtist, kw = plan.keyword ? ' ' + plan.keyword : '';
  const who = plan.artist ? ' "' + plan.artist + '"' : (plan.style ? ' ' + plan.style.q : '');
  const tail = ' filetype:bitmap';
  const qs = kind === 'gap'
    ? ['"Google Art Project"' + who + kw + tail, '"Google Art Project"' + who + tail, '"Google Art Project" ' + k + tail]
    : ['haswbstatement:P6731=Q63348049' + who + kw + ' ' + k + tail, 'deepcategory:"Featured pictures of ' + (k === 'painting' ? 'paintings' : k === 'sculpture' ? 'sculptures' : 'art') + '"' + who + kw + tail, 'deepcategory:"Quality images of paintings"' + who + tail, 'haswbstatement:P6731=Q63348049 ' + k + tail];
  return commonsSearch(qs, plan, ctx, null, kind === 'gap' ? 'Google Art Project' : 'Commons (destacadas)');
}
async function commonsSearch(queries, plan, ctx, m, label) {
  const API = 'https://commons.wikimedia.org/w/api.php?format=json&formatversion=2&origin=*&action=query';
  const W = PX(ctx);
  let pages = [];
  for (const q of queries) {
    const total = await memo('cm:' + q, async () => {
      const j = await wmJSON(API + '&list=search&srnamespace=6&srlimit=1&srprop=&srinfo=totalhits&srsearch=' + encodeURIComponent(q));
      return (j.query && j.query.searchinfo && j.query.searchinfo.totalhits) || 0;
    });
    if (!total) continue;
    const off = rand(Math.max(1, Math.min(total - 40, 9000)));
    const j = await wmJSON(API + '&generator=search&gsrnamespace=6&gsrlimit=40&gsroffset=' + off + '&gsrsearch=' + encodeURIComponent(q) +
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
      src: 'commons', museum: m ? m.es : (label || 'Wikimedia Commons'), id: p.pageid || p.title,
      title, artist: flipName(val('Artist')).slice(0, 80), date: date.slice(0, 40), year: parseYear(cleanDate(date)),
      imgs: [ii.thumburl, ii.url], thumb: ii.thumburl, url: ii.descriptionurl || ('https://commons.wikimedia.org/wiki/' + encodeURIComponent(p.title || '')),
      w: ii.width, h: ii.height, type: classifyType(title) || (plan.type === 'painting' ? 'painting' : null),
      pd: /public domain|pd|cc0/i.test(lic) ? true : (lic ? false : null), license: lic || 'Wikimedia Commons'
    });
  }).filter(Boolean);
}

/* Google Art Project por museo: sus archivos en Commons nombran la institución en la descripción. */
async function gapMuseum(m, plan, f, ctx) {
  const tail = ' filetype:bitmap', kw = plan.keyword ? ' ' + plan.keyword : '', base = '"Google Art Project" "' + m.q + '"', qs = [];
  if (plan.artist) qs.push(base + ' "' + plan.artist + '"' + kw + tail);
  else { if (plan.style) qs.push(base + ' ' + plan.style.q + kw + tail); qs.push(base + kw + tail); }
  return commonsSearch(qs, plan, ctx, m, 'Google Art Project');
}
const EUROPE_COUNTRIES = new Set(['Alemania', 'Austria', 'Bélgica', 'Dinamarca', 'España', 'Finlandia', 'Francia', 'Irlanda', 'Italia', 'Noruega', 'Países Bajos', 'Portugal', 'Reino Unido', 'Rusia', 'Suecia', 'Suiza']);

/* WikiArt: catálogo grande de pintura clasificado por estilo (respuesta JSON de su propia web). */
const wikiSlug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
async function wikiartFetch(plan, f, ctx) {
  if ((f.keywords && f.keywords.length) || (f.types && f.types.length && !f.types.includes('painting'))) return [];
  let st, url;
  if (plan.artist) {
    const slug = wikiSlug(plan.artist);
    st = { wa: 'artist:' + slug };
    url = n => 'https://www.wikiart.org/en/' + slug + '/mode/all-paintings?json=2&page=' + n;
  } else {
    if (f.artists && f.artists.length) return [];
    if (plan.style && !plan.style.wa) return [];
    st = plan.style && plan.style.wa ? plan.style : pick(STYLES.filter(x => x.wa));
    url = n => 'https://www.wikiart.org/en/paintings-by-style/' + st.wa + '?select=featured&json=2&layout=new&resultType=masonry&page=' + n;
  }
  const first = await memo('wa:' + st.wa, () => getJSONvia(url(1)));
  const total = first.AllPaintingsCount || 0, size = first.PageSize || 60;
  const pages = Math.max(1, Math.min(Math.ceil(total / size), 40));
  const n = 1 + rand(pages);
  const j = n === 1 ? first : await getJSONvia(url(n));
  return (Array.isArray(j) ? j : (j.Paintings || [])).filter(p => p.image && p.title).map(p => mk({
    src: 'wikiart', museum: 'WikiArt', id: p.id, title: p.title, artist: p.artistName, date: p.year,
    imgs: [p.image.replace(/!\w+\.jpg$/, ''), p.image], thumb: p.image + '!PinterestSmall.jpg',
    url: 'https://www.wikiart.org' + (p.paintingUrl || ''), w: p.width, h: p.height, type: 'painting', sid: st.id || null,
    pd: null, license: 'WikiArt (obra con o sin derechos de autor)'
  }));
}

/* Wikipedia: artículos de obras que citan al museo; la imagen principal del artículo es la obra. */
const ART_DESC = /painting|sculpture|drawing|print\b|artwork|triptych|fresco|portrait|photograph|statue|relief|mural|watercolou?r|engraving|etching|lithograph|pastel|oil on|panel|altarpiece|still life|landscape/i;
async function wikipediaFetch(plan, f, ctx, m) {
  if (m && !m.q) return [];
  const API = 'https://en.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*&action=query';
  const kind = COMMONS_KIND[plan.type] || 'painting', kw = plan.keyword ? ' ' + plan.keyword : '';
  const qs = [];
  if (!m) { // colección abierta: obras de cualquier museo, por artista, estilo o tema
    const who = plan.artist || plan.hintArtist;
    qs.push([who, plan.style && plan.style.q, plan.keyword, kind].filter(Boolean).join(' ') + (who || plan.style || plan.keyword ? '' : ' ' + pick(GENERIC)));
  } else if (plan.artist) qs.push('"' + m.q + '" "' + plan.artist + '"' + kw);
  else { if (plan.style) qs.push('"' + m.q + '" ' + plan.style.q + ' ' + kind + kw); qs.push('"' + m.q + '" ' + kind + kw); }
  let pages = [];
  for (const q of qs) {
    const total = await memo('wp:' + q, async () => {
      const j = await wmJSON(API + '&list=search&srnamespace=0&srlimit=1&srprop=&srinfo=totalhits&srsearch=' + encodeURIComponent(q));
      return (j.query && j.query.searchinfo && j.query.searchinfo.totalhits) || 0;
    });
    if (!total) continue;
    // Más allá de los primeros resultados la búsqueda de Wikipedia ya no trae cuadros: se elige al azar entre los primeros ~150.
    const off = rand(Math.max(1, Math.min(total - 30, 120)));
    const j = await wmJSON(API + '&generator=search&gsrnamespace=0&gsrlimit=30&gsroffset=' + off + '&gsrsearch=' + encodeURIComponent(q) +
      '&prop=pageimages|description&piprop=original|thumbnail&pithumbsize=' + PX(ctx));
    pages = (j.query && j.query.pages) || [];
    if (pages.length) break;
  }
  if (!Array.isArray(pages)) pages = Object.keys(pages).map(k => pages[k]);
  return pages.map(p => {
    const o = p.original, t = p.thumbnail, desc = p.description || '';
    if (!o || !ART_DESC.test(desc) || (o.width || 0) < 700 || (o.height || 0) < 500) return null;
    // Wikipedia añade «?utm_source=…» a las direcciones de imagen: se quita (y la extensión se mira sin él).
    const clean = u => (u || '').replace(/\?utm_[^#]*$/, '');
    o.source = clean(o.source); if (t) t.source = clean(t.source);
    if (!/\.(jpe?g|png|webp|gif)$/i.test(o.source.replace(/[?#].*$/, ''))) return null;
    if (m && norm(p.title).includes(norm(m.q))) return null;
    const by = /\bby ([^,;(]{3,60})/i.exec(desc);
    return mk({
      src: 'wikipedia', museum: m ? m.es : 'Wikipedia', id: p.pageid, title: p.title, artist: by ? by[1].trim() : '', date: desc.slice(0, 40), year: parseYear(desc),
      imgs: [t && t.source, o.source], thumb: (t && t.source) || o.source, url: 'https://en.wikipedia.org/?curid=' + p.pageid,
      w: o.width, h: o.height, type: classifyType(desc), pd: null, license: 'Wikipedia (imagen del artículo)'
    });
  }).filter(Boolean);
}

/* Un museo = varias fuentes a la vez: su API directa (si tiene), Wikidata, Commons y Wikipedia.
   Las «colecciones abiertas» juntan WikiArt, Commons por estilo, Wikipedia, Wikidata por movimiento y Europeana. */
const DIRECT = {};
function finishMuseum(m) { if (!m.q) m.q = (m.labels[0] || [''])[0]; return m; }
async function museumFetch(m, plan, f, ctx) {
  const rep = (name, n, err) => { if (ctx.report) ctx.report(name, n, err); };
  const jobs = [];
  if (m.open) {
    jobs.push(['WikiArt', () => wikiartFetch(plan, f, ctx)], ['Google Art Project', () => commonsSpecial('gap', plan, f, ctx)], ['Commons destacadas', () => commonsSpecial('fp', plan, f, ctx)], ['Commons', () => commonsFetch(plan, f, ctx)], ['Wikipedia', () => wikipediaFetch(plan, f, ctx)], ['Wikidata', () => wikiFetch(plan, f, ctx)]);
    if (ctx.keys && ctx.keys.europeana) jobs.push(['Europeana', () => europeanaFetch(plan, f, ctx)]);
  } else if (ctx.directOnly && m.direct && DIRECT[m.direct]) {
    jobs.push(['Directa', () => DIRECT[m.direct](plan, f, ctx)]); // búsqueda por título: Wikidata, Commons y Wikipedia ya se consultan aparte
  } else {
    if (m.direct && DIRECT[m.direct]) jobs.push(['Directa', () => DIRECT[m.direct](plan, f, ctx)]);
    jobs.push(['Wikidata', () => wikidataMuseum(m, plan, f, ctx)], ['Commons', () => commonsFetch(plan, f, ctx, m)], ['Wikipedia', () => wikipediaFetch(plan, f, ctx, m)], ['Google Art Project', () => gapMuseum(m, plan, f, ctx)]);
    if (ctx.keys && ctx.keys.europeana && EUROPE_COUNTRIES.has(museumCountry(m))) jobs.push(['Europeana', () => europeanaFetch(plan, f, ctx, m)]);
  }
  // WikiArt va primero: sus obras se entregan en cuanto llegan, sin esperar a las demás fuentes de la fila.
  const res = await Promise.allSettled(jobs.map(j => j[1]().then(v => { if (j[0] === 'WikiArt' && ctx.early && v.length) ctx.early(v); return v; })));
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
  return { id: 'm:' + m.id, group: 'museum', name: m.es, place: m.country ? m.city + ', ' + m.country : m.city, tags: (m.tags || []).map(t => TAG_NAMES[t] || t).join(' '), museum: m, fetch: (plan, f, ctx) => museumFetch(m, plan, f, ctx),
    note: m.note || ((m.direct ? 'Directa · ' : '') + 'Wikidata · Commons · Wikipedia · Google Art Project' + (EUROPE_COUNTRIES.has(museumCountry(m)) ? ' · Europeana' : '')) };
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
  let country = '';
  try { // país del museo (P17), para que aparezca su colección «Museos de <país>»
    const e = await getJSON('https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=claims&ids=' + hit.id);
    const cl = (((e.entities || {})[hit.id] || {}).claims || {}).P17 || [];
    const cq = cl[0] && cl[0].mainsnak && cl[0].mainsnak.datavalue && cl[0].mainsnak.datavalue.value && cl[0].mainsnak.datavalue.value.id;
    if (cq) { const l = await getJSON('https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=labels&languages=es|en&ids=' + cq); const lb = ((l.entities || {})[cq] || {}).labels || {}; country = (lb.es || lb.en || {}).value || ''; }
  } catch (e) { /* sin país: no entra en ninguna colección por país */ }
  return { id: 'c' + hit.id, es: hit.label || text, city: (hit.description || 'Museo añadido').slice(0, 50), country: country || undefined, ids: [hit.id], labels: [[hit.label || text, 'es'], [hit.label || text, 'en']], q: hit.label || text, custom: true };
}
const MUSEUM_DESC = /museum|museo|musée|museu|galler|galería|galerie|pinacoteca|collection|colección|art\b|arte\b/i;

/* ───────── buscar una obra por su título ─────────
   Busca en Wikidata (en español, inglés y francés, así que «La noche estrellada» y «The Starry Night» dan lo mismo) las obras de arte con
   imagen y devuelve hasta 10, ya normalizadas, con su artista, año y museo. */
const WD_ARTWORK = /painting|pintura|peinture|schilderij|gem[aä]lde|dipinto|drawing|dibujo|dessin|print\b|grabado|gravure|estampa|tapestry|tapiz|tapisserie|watercolou?r|acuarela|fresco|mural|triptych|tr[ií]ptico|altarpiece|retablo|artwork|work of art|obra de arte|oeuvre d'art|oil on|aquarelle|pastel|ukiyo/i;
const WD_NOT_ART = /sculpture|escultura|statue|estatua|building|edificio|album|film|pel[ií]cula|song|canci[oó]n|novel|novela|book|libro|museum\b|museo\b|musée|painter\b|pintor\b|peintre|artist\b|artista\b|writer\b|escritor\b|village|pueblo|city\b|ciudad\b|family name|apellido|given name|nombre|tv series|serie de/i;
async function searchWikidataTitle(q, ctx) {
  const api = 'https://www.wikidata.org/w/api.php?format=json&origin=*&';
  const found = [];
  for (const lang of ['es', 'en', 'fr']) {
    try {
      const j = await getJSON(api + 'action=wbsearchentities&type=item&limit=12&language=' + lang + '&uselang=' + lang + '&search=' + encodeURIComponent(q));
      (j.search || []).forEach(r => { if (r.id && !found.some(x => x.id === r.id) && (!r.description || !WD_NOT_ART.test(r.description) || WD_ARTWORK.test(r.description))) found.push(r); });
    } catch (e) { if (lang === 'es') throw e; }
  }
  if (!found.length) return [];
  return wdWorks(found.slice(0, 40).map(r => r.id), ctx);
}
/* Fichas de Wikidata (con imagen) de esos identificadores, como obras listas para mostrar. */
async function wdWorks(ids, ctx) {
  const api = 'https://www.wikidata.org/w/api.php?format=json&origin=*&';
  const ents = {};
  for (let i = 0; i < ids.length; i += 25) {
    const j = await getJSON(api + 'action=wbgetentities&props=claims|labels|descriptions&languages=es|en|fr&ids=' + ids.slice(i, i + 25).join('|'));
    Object.assign(ents, j.entities || {});
  }
  const val = (e, p) => { const c = (e.claims || {})[p], s = c && c[0] && c[0].mainsnak; return s && s.datavalue ? s.datavalue.value : null; };
  const rows = ids.map(id => ents[id]).filter(e => e && e.claims && val(e, 'P18')).map(e => {
    const desc = ((e.descriptions || {}).es || (e.descriptions || {}).en || (e.descriptions || {}).fr || {}).value || '';
    return { e, desc, img: String(val(e, 'P18')), time: val(e, 'P571'), creator: (val(e, 'P170') || {}).id, coll: (val(e, 'P195') || {}).id };
  }).filter(r => /\.(jpe?g|png|webp|gif)$/i.test(r.img) && (WD_ARTWORK.test(r.desc) || r.creator) && !/^(sculpture|decorative)$/.test(classifyType(r.desc) || '')).slice(0, 10);
  const need = Array.from(new Set([].concat(...rows.map(r => [r.creator, r.coll]).filter(Boolean)).filter(Boolean)));
  const names = {};
  if (need.length) {
    try {
      const j = await getJSON(api + 'action=wbgetentities&props=labels&languages=es|en|fr&ids=' + need.slice(0, 50).join('|'));
      Object.keys(j.entities || {}).forEach(k => { const l = j.entities[k].labels || {}; names[k] = (l.es || l.en || l.fr || {}).value || ''; });
    } catch (e) { /* sin nombres de artista o museo: se usa la descripción */ }
  }
  const w = PX(ctx);
  return rows.map(r => {
    const lb = r.e.labels || {}, title = (lb.es || lb.en || lb.fr || {}).value || '';
    const ym = r.time && r.time.time ? String(r.time.time).match(/^([+-])0*(\d+)/) : null;
    const year = ym ? (ym[1] === '-' ? -1 : 1) * parseInt(ym[2], 10) : null;
    const raw = 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(r.img.replace(/ /g, '_'));
    const byDesc = (r.desc.match(/\b(?:by|de|par|door|von)\s+([^,;(]+)/i) || [])[1];
    return mk({
      src: 'wiki', museum: names[r.coll] || 'Wikimedia Commons', id: r.e.id, title,
      artist: names[r.creator] || (byDesc ? byDesc.trim() : ''), date: year != null ? String(year) : '', year,
      imgs: commonsImgs(raw, w), thumb: raw + '?width=300',
      url: 'https://www.wikidata.org/wiki/' + r.e.id, type: classifyType(r.desc) || 'painting', pd: null, license: 'Imagen de Wikimedia Commons'
    });
  });
}

/* Wikipedia (varios idiomas) y Wikimedia Commons: artículos y archivos de obras con imagen, también de museos pequeños o obras poco conocidas. */
const WP_LANGS = ['es', 'en', 'fr', 'de', 'it', 'hu', 'pt', 'nl'];
const WP_ART_EXTRA = /festm[eé]ny|obraz\b|olajfest|gem[aä]lde|bild\b|quadro|dipinto|tableau|schilderij|pintura|painting/i;
async function searchWikipediaTitle(q, hint, ctx) {
  const tok = titleTokens(q);
  const one = async lang => {
    const j = await getJSON('https://' + lang + '.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&generator=search&gsrnamespace=0&gsrlimit=8&prop=pageimages|description&piprop=thumbnail|original&pithumbsize=2000&gsrsearch=' + encodeURIComponent(q + (hint ? ' ' + hint : '')));
    return ((j.query && j.query.pages) || []).filter(p => p.title && (p.thumbnail || p.original)).map(p => {
      const desc = p.description || '', title = p.title.replace(/\s*\([^)]*\)\s*$/, '');
      if (WD_NOT_ART.test(desc) && !WD_ARTWORK.test(desc) && !WP_ART_EXTRA.test(desc)) return null;
      if (!(WD_ARTWORK.test(desc) || WP_ART_EXTRA.test(desc))) return null; // solo artículos de obras de arte
      if (!titleFits(tok, norm(q), title, desc)) return null;
      const src = (p.thumbnail && p.thumbnail.source) || p.original.source, full = p.original && p.original.source;
      if (!/\.(jpe?g|png|webp)(\?|$)/i.test(src) && !/\.(jpe?g|png|webp)(\?|$)/i.test(full || '')) return null;
      const by = (desc.match(/\b(?:by|de|par|von|door|di|van|od)\s+([^,;(]+)/i) || [])[1];
      const ym = desc.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
      return mk({
        src: 'wp' + lang, museum: 'Wikipedia (' + lang + ')', id: String(p.pageid), title, artist: by ? by.trim() : (hint || ''), date: ym ? ym[1] : '', year: ym ? +ym[1] : null,
        imgs: [src].concat(full && full !== src ? [full] : []), thumb: src.replace(/\/(\d+)px-/, '/400px-'),
        url: 'https://' + lang + '.wikipedia.org/?curid=' + p.pageid, type: classifyType(desc) || 'painting', pd: null, license: 'Imagen de Wikipedia / Wikimedia Commons'
      });
    }).filter(Boolean);
  };
  const res = await Promise.allSettled(WP_LANGS.map(one));
  const ok = res.filter(r => r.status === 'fulfilled');
  if (!ok.length) throw res[0].reason;
  return [].concat(...ok.map(r => r.value));
}
async function searchCommonsTitle(q, hint, ctx) {
  const tok = titleTokens(q);
  const j = await getJSON('https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&generator=search&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=2000&iiextmetadatafilter=ObjectName|Artist|DateTimeOriginal&gsrsearch=' + encodeURIComponent(q + (hint ? ' ' + hint : '')));
  const strip = h => String(h || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return ((j.query && j.query.pages) || []).map(p => {
    const ii = (p.imageinfo || [])[0]; if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime || '') || (ii.width || 0) < 600) return null;
    const md = ii.extmetadata || {}, file = p.title.replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
    const title = strip(md.ObjectName && md.ObjectName.value) || file;
    if (!titleFits(tok, norm(q), title + ' ' + file, md.Artist && strip(md.Artist.value))) return null;
    const date = strip(md.DateTimeOriginal && md.DateTimeOriginal.value);
    return mk({
      src: 'commons', museum: 'Wikimedia Commons', id: String(p.pageid), title, artist: strip(md.Artist && md.Artist.value).slice(0, 80) || (hint || ''), date: date.slice(0, 10),
      imgs: [ii.thumburl || ii.url, ii.url].filter(Boolean), thumb: (ii.thumburl || ii.url).replace(/\/(\d+)px-/, '/400px-'),
      url: ii.descriptionurl || 'https://commons.wikimedia.org/?curid=' + p.pageid, w: ii.width, h: ii.height, type: 'painting', pd: null, license: 'Wikimedia Commons'
    });
  }).filter(Boolean);
}
/* WikiArt tiene una búsqueda pública en JSON (título o artista). */
async function searchWikiArtTitle(q) {
  const j = await getJSONvia('https://www.wikiart.org/en/search/' + encodeURIComponent(q) + '?json=2');
  return (Array.isArray(j) ? j : (j.Paintings || [])).filter(p => p.image && p.title).slice(0, 30).map(p => mk({
    src: 'wikiart', museum: 'WikiArt', id: p.id, title: p.title, artist: p.artistName, date: p.year,
    imgs: [p.image.replace(/!\w+\.jpg$/, ''), p.image], thumb: p.image + '!PinterestSmall.jpg',
    url: 'https://www.wikiart.org' + (p.paintingUrl || ''), w: p.width, h: p.height, type: 'painting',
    pd: null, license: 'WikiArt (obra con o sin derechos de autor)'
  }));
}
const TITLE_STOP = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'un', 'una', 'the', 'of', 'a', 'an', 'le', 'les', 'des', 'du', 'and', 'y', 'e', 'et']);
const titleTokens = s => norm(s).split(/[^a-z0-9]+/).filter(x => x && !TITLE_STOP.has(x));
/* ¿Encaja una obra con lo buscado? Todas las palabras deben estar en el título o en el artista (se puede escribir «noche estrellada
   van gogh») y al menos una en el título. */
function titleFits(tok, qn, title, extra) {
  const t = norm(title);
  if (!tok.length) return t.includes(qn);
  const all = t + ' ' + norm(extra || '');
  return tok.every(x => all.includes(x)) && tok.some(x => t.includes(x));
}
const TITLE_SOURCES = ['m:met', 'm:aic', 'm:cma', 'm:rijks', 'm:vam', 'm:smk', 'm:mia', 'm:harvard', 'm:si'];
/* Busca una obra por su título en Wikidata y en las API de los museos grandes, todo a la vez. onPart(lista) se llama cada vez que una fuente
   responde, así los resultados salen según llegan. Devuelve hasta 20, las que mejor coinciden primero. */
async function searchPaintings(text, ctx, onPart, hint) {
  const q = String(text || '').trim();
  if (q.length < 2) throw new Error('Escribe al menos dos letras del título');
  ctx = ctx || {};
  const tok = titleTokens(q), qn = norm(q);
  const all = []; let errors = 0, wikiErr = null;
  const score = w => { const t = norm(w.title); return t === qn ? 0 : t.startsWith(qn) ? 1 : t.includes(qn) ? 2 : 3; };
  const merged = () => {
    const seen = new Set(), out = [];
    all.slice().sort((a, b) => score(a) - score(b) || (a.src === 'wiki') - (b.src === 'wiki')).forEach(w => {
      const k = norm(w.title) + '|' + (norm(w.artist).split(/\s+/).pop() || '');
      if (seen.has(k)) return; seen.add(k); out.push(w);
    });
    return out.slice(0, 20);
  };
  const add = (list, strict) => {
    (list || []).forEach(w => {
      if (!w || !w.imgs || !w.imgs.length) return;
      if (strict && !titleFits(tok, qn, w.title, w.artist)) return;
      if (/^(sculpture|decorative)$/.test(w.type || '')) return;
      all.push(w);
    });
    if (onPart) { try { onPart(merged()); } catch (e) { /* la pantalla ya no escucha */ } }
  };
  const jobs = [searchWikidataTitle(q, ctx).then(l => add(l, false), e => { wikiErr = e; errors++; })];
  jobs.push(searchWikiArtTitle(q).then(l => add(l, true), () => { errors++; }));
  jobs.push(searchWikipediaTitle(q, hint, ctx).then(l => add(l, true), () => { errors++; }));
  jobs.push(searchCommonsTitle(q, hint, ctx).then(l => add(l, true), () => { errors++; }));
  const f = defaultFilters();
  TITLE_SOURCES.map(id => SOURCE_LIST.find(s => s.id === id)).filter(s => s && !(s.museum && s.museum.needsKey && !(ctx.keys && ctx.keys[s.museum.needsKey]))).forEach(s => {
    jobs.push(Promise.race([s.fetch({ keyword: q, top: true, type: null, range: null, style: null, artist: null, hintArtist: null }, f, Object.assign({ anyRights: true, directOnly: true }, ctx)), new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo')), 20000))]).then(l => add(l, true), () => { errors++; }));
  });
  await Promise.all(jobs);
  const out = merged();
  if (!out.length && wikiErr && errors >= jobs.length) throw wikiErr;
  return out;
}

/* ───────── reconocer una obra a partir de una foto ─────────
   Se manda la foto (reducida) a un modelo con visión, con la clave del propio usuario: Gemini (hay nivel gratuito) o Claude. Responde con el
   título, artista, año y museo; luego la app busca la obra por su título y el usuario elige. */
const ID_PROMPT = 'Eres un experto en historia del arte. La imagen es una foto o captura de una obra de arte (por ejemplo una pintura en un museo, en un libro o en una pantalla). Identifica la obra. Responde SOLO con un objeto JSON, sin texto extra: {"title":"título en español","title_en":"título en inglés o en el idioma original","artist":"artista","artist_en":"nombre completo del artista como figura en la Wikipedia en inglés","year":"año o siglo","museum":"museo donde se conserva","wikipedia_en":"título exacto del artículo de la Wikipedia en inglés sobre esta obra (vacío si no lo hay)","wikidata":"identificador Q de Wikidata de la obra si lo sabes con seguridad (vacío si no)","confidence":número de 0 a 1}. Si no reconoces la obra con razonable seguridad, responde {"unknown":true}.';
const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
function parseIdJSON(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No he entendido la respuesta del reconocimiento');
  let o; try { o = JSON.parse(m[0]); } catch (e) { throw new Error('No he entendido la respuesta del reconocimiento'); }
  if (!o || o.unknown || !(o.title || o.title_en)) return null;
  return { title: String(o.title || '').trim(), title_en: String(o.title_en || '').trim(), artist: String(o.artist || '').trim(), artist_en: String(o.artist_en || '').trim(), year: String(o.year || '').trim(), museum: String(o.museum || '').trim(),
    wikipedia_en: String(o.wikipedia_en || '').trim(), wikidata: /^Q\d+$/.test(String(o.wikidata || '').trim()) ? String(o.wikidata).trim() : '', confidence: +o.confidence || null };
}
/* Con lo que reconoció la foto, se va directo a la obra: el artículo de la Wikipedia en inglés (y su ficha de Wikidata) o el identificador
   de Wikidata que dio el modelo, comprobando que el título o el artista encajan (el modelo a veces se inventa el número). */
async function findIdentified(id, ctx) {
  const out = [], qids = []; let trusted = '';
  const words = t => norm(t).split(/[^a-z0-9]+/).filter(x => x.length > 2 && !TITLE_STOP.has(x));
  const tw = words(id.title).concat(words(id.title_en));
  const fits = w => { const t = norm(w.title); return byArtist(w, id) || tw.filter(x => t.includes(x)).length >= Math.min(2, tw.length); };
  if (id.wikipedia_en) {
    try {
      const j = await getJSON('https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&redirects=1&prop=pageimages|description|pageprops&piprop=thumbnail|original&pithumbsize=2000&ppprop=wikibase_item&titles=' + encodeURIComponent(id.wikipedia_en), null, 15000);
      const pg = ((j.query && j.query.pages) || [])[0];
      if (pg && !pg.missing) {
        if (pg.pageprops && pg.pageprops.wikibase_item) qids.push(trusted = pg.pageprops.wikibase_item);
        const src = (pg.thumbnail && pg.thumbnail.source) || (pg.original && pg.original.source), full = pg.original && pg.original.source;
        if (src && /\.(jpe?g|png|webp)(\?|$)/i.test(full || src)) out.push(mk({
          src: 'wpen', museum: id.museum || 'Wikipedia (en)', id: String(pg.pageid), title: id.title || pg.title, artist: id.artist, date: id.year, year: parseInt(id.year, 10) || null,
          imgs: [src].concat(full && full !== src ? [full] : []), thumb: src.replace(/\/(\d+)px-/, '/400px-'),
          url: 'https://en.wikipedia.org/?curid=' + pg.pageid, type: 'painting', pd: null, license: 'Imagen de Wikipedia / Wikimedia Commons'
        }));
      }
    } catch (e) { /* sin Wikipedia: se prueba con Wikidata */ }
  }
  if (id.wikidata && !qids.includes(id.wikidata)) qids.push(id.wikidata);
  if (qids.length) {
    try {
      const ws = await wdWorks(qids, ctx);
      ws.forEach(w => { if (w.uid === 'wiki:' + trusted || fits(w)) { if (!w.artist) w.artist = id.artist; out.unshift(w); } });
    } catch (e) { /* sin Wikidata: queda lo de Wikipedia */ }
  }
  // la ficha de Wikidata (imagen de Commons) y la de Wikipedia son la misma obra: se deja una
  const wd = out.filter(w => w.src === 'wiki');
  return (wd.length ? wd : out).slice(0, 3);
}
/* Obras del artista reconocido en Wikidata (con imagen). Primero se busca al artista y luego, entre sus obras, las del título reconocido:
   así, cuando hay muchas obras con el mismo nombre («El Salvador», «La Piedad»), salen antes las de ese artista. Sin acentos de por medio
   («Niño» = «nino») y con los sinónimos de los títulos religiosos («El Salvador» = «Salvator Mundi» = «The Saviour»).
   Devuelve { match: las del título, other: otras obras suyas } o null si no encuentra al artista. */
const TITLE_SYN = [['salvador', 'saviour', 'savior', 'salvator', 'sauveur', 'salvatore', 'redentor', 'redeemer'], ['virgen', 'virgin', 'madonna', 'vierge', 'vergine', 'maria', 'mary'],
  ['nino', 'child', 'bambino', 'enfant', 'kind'], ['cristo', 'christ', 'jesus', 'cristo', 'christus'], ['piedad', 'pieta', 'lamentation', 'llanto'],
  ['anunciacion', 'annunciation', 'annonciation', 'annunciazione'], ['crucifixion', 'crucifixion', 'crucifixione', 'calvario', 'calvary'],
  ['dolorosa', 'sorrows', 'dolorosa', 'addolorata'], ['magdalena', 'magdalene', 'maddalena', 'madeleine'], ['adoracion', 'adoration', 'adorazione'],
  ['sagrada', 'holy', 'sacra', 'sainte'], ['familia', 'family', 'famiglia', 'famille'], ['santo', 'saint', 'san', 'santa'], ['retrato', 'portrait', 'ritratto']];
const synOf = x => (TITLE_SYN.find(g => g.includes(x)) || [x]);
const ACC = { a: '[aáàâäã]', e: '[eéèêë]', i: '[iíìîï]', o: '[oóòôöõ]', u: '[uúùûü]', n: '[nñ]', c: '[cç]' };
const accRe = k => k.replace(/[^a-z0-9]/g, '').replace(/[aeioucn]/g, ch => ACC[ch]);
async function findArtist(id) {
  const api = 'https://www.wikidata.org/w/api.php?format=json&origin=*&action=wbsearchentities&type=item&limit=7&';
  const painter = /painter|artist|draughts|printmaker|engraver|illustrator|sculptor|pintor|artista|grabador|dibujante|escultor/i;
  const tries = [[id.artist_en, 'en'], [id.artist, 'es'], [id.artist, 'en']].filter((t, i, l) => t[0] && l.findIndex(x => x[0] === t[0] && x[1] === t[1]) === i);
  let first = null;
  for (const [name, lang] of tries) {
    const j = await getJSON(api + 'language=' + lang + '&uselang=' + lang + '&search=' + encodeURIComponent(name));
    const hits = j.search || [], who = hits.find(r => painter.test(r.description || ''));
    if (who) return who;
    first = first || hits[0];
  }
  return first;
}
async function worksByArtist(id, ctx) {
  if (!id.artist && !id.artist_en) return null;
  const who = await findArtist(id); if (!who) return null;
  const stem = x => (x.length > 4 ? x.replace(/(es|s)$/, '') : x);
  const words = t => norm(t).split(/[^a-z0-9]+/).filter(x => x.length > 2 && !TITLE_STOP.has(x) && !/^(near|with|from|des|del|las|los|bei|van|von|the|una|uno|por|con)$/.test(x));
  const sets = [words(id.title_en), words(id.title)].filter(x => x.length);
  const keys = Array.from(new Set([].concat(...sets).map(stem))).sort((x, y) => y.length - x.length).slice(0, 4);
  const pats = Array.from(new Set([].concat(...keys.map(k => synOf(k).map(stem))))).slice(0, 16);
  const base = '?w wdt:P170 wd:' + who.id + '; wdt:P18 ?img. ';
  const [rows, any] = await Promise.all([
    pats.length ? sparql('SELECT ?w ?l WHERE { ' + base + '?w rdfs:label ?l. FILTER(LANG(?l) IN ("en","es","fr","nl","de","it","pt")) FILTER(REGEX(LCASE(?l), "' + pats.map(accRe).join('|') + '")) } LIMIT 400', false, true).catch(() => []) : [],
    sparql('SELECT DISTINCT ?w WHERE { ' + base + '} LIMIT 12', false, true).catch(() => [])
  ]);
  const hit = (l, x) => synOf(x).some(y => l.includes(stem(y)));
  const best = {};
  rows.forEach(r => {
    const q = String(r.w.value).split('/').pop(), l = norm(r.l.value);
    const sc = Math.max.apply(null, sets.map(ws => ws.filter(x => hit(l, x)).length / ws.length));
    if (sc > (best[q] || 0)) best[q] = sc;
  });
  const top = Object.keys(best).filter(q => best[q] >= 0.5).sort((x, y) => best[y] - best[x]).slice(0, 8);
  const rest = any.map(r => String(r.w.value).split('/').pop()).filter(q => !top.includes(q)).slice(0, 8);
  const fill = ws => { ws.forEach(w => { w.artist = w.artist || id.artist; }); return ws; };
  const match = top.length ? fill(await wdWorks(top, ctx)).sort((x, y) => (best[y.uid.split(':')[1]] || 0) - (best[x.uid.split(':')[1]] || 0)) : [];
  let other = []; try { other = rest.length ? fill(await wdWorks(rest, ctx)) : []; } catch (e) { /* sin más obras */ }
  return { who: who.label || id.artist, qid: who.id, q: [rows.length, any.length], match, other };
}
/* ¿Es el mismo artista? Los nombres llegan en idiomas y formas distintas: «Rafael» / «Raphael» / «Raffaello Sanzio», «Pieter Bruegel el Viejo» /
   «Pieter Brueghel the Elder», «Rembrandt van Rijn» / «Rembrandt», «El Bosco» / «Hieronymus Bosch». Se quitan las partículas y los
   apodos de familia («el Viejo», «the Younger»…) y basta con que el apellido de uno esté en el nombre del otro. */
const ARTIST_SAME = [[/\bmiguel angel\b|\bmichelangelo buonarroti\b|\bbuonarroti\b/g, 'michelangelo'], [/\b(rafael|raffaello|raffaelo|sanzio|santi)\b/g, 'raphael'],
  [/\b(tiziano|vecellio|vecelli)\b/g, 'titian'], [/\b(brueghel|breughel|bruegel)\b/g, 'bruegel'], [/\b(bosco|jheronimus|hieronymus|jeroen)\b/g, 'bosch'],
  [/\b(theotokopoulos|theotocopuli)\b/g, 'greco'], [/\b(durero|duerer)\b/g, 'durer'], [/\bvelasquez\b/g, 'velazquez'], [/\b(giorgio barbarelli|zorzi)\b/g, 'giorgione'],
  [/\b(espanoleto|spagnoletto)\b/g, 'ribera'], [/\b(paolo caliari|caliari)\b/g, 'veronese'], [/\bjacopo robusti\b|\brobusti\b/g, 'tintoretto']];
const ARTIST_SKIP = /^(de|da|del|della|delle|dei|di|do|dos|das|van|von|der|den|ten|ter|het|el|la|le|les|lo|il|the|and|y|e|et|und|elder|younger|older|viejo|joven|mozo|ancien|jeune|vecchio|giovane|aine|fils|pere|hijo|padre|son|father|jr|sr|maestro|master|circle|school|escuela|taller|workshop|follower|seguidor|attributed|atribuido|after|copia|copy|style|manner|saint|san|santa|sir|baron|senor|lord)$/;
function artistTokens(s) {
  let n = ' ' + norm(cleanName(s)).replace(/[^a-z0-9]+/g, ' ') + ' ';
  ARTIST_SAME.forEach(([re, to]) => { n = n.replace(re, to); });
  return n.split(' ').filter(x => x.length > 2 && !ARTIST_SKIP.test(x));
}
const artistGen = s => { const n = norm(s); return /\b(elder|older|viejo|ancien|vecchio|aine|senior)\b/.test(n) ? 'e' : /\b(younger|joven|mozo|jeune|giovane|fils|junior)\b/.test(n) ? 'y' : ''; };
function sameArtist(a, b) {
  const x = artistTokens(a), y = artistTokens(b);
  if (!x.length || !y.length) return false;
  const ga = artistGen(a), gb = artistGen(b); if (ga && gb && ga !== gb) return false; // Bruegel el Viejo no es Brueghel el Joven
  return y.includes(x[x.length - 1]) || x.includes(y[y.length - 1]);
}
const byArtist = (w, id) => sameArtist(w.artist, id.artist) || (!!id.artist_en && sameArtist(w.artist, id.artist_en));
/* Ordena lo encontrado según lo que reconoció la foto: primero las del mismo artista y con más palabras del título. Si alguna es del artista
   reconocido, se quitan las de otros artistas (un cuadro de otro con el mismo título es un error); si ninguna lo es (las fuentes escriben el
   nombre de otra forma o no lo dicen), se dejan las que tienen el título entero en vez de no enseñar nada. */
function rankFound(list, id, strict) { // strict: ya se encontró la obra exacta, así que nada de otros artistas
  const words = t => norm(t || '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(x => x.length > 2 && !/^(the|del|las|los|una|les|des|and|with|con|por|para|sur|von|van|der|het)$/.test(x));
  const tw = [words(id.title), words(id.title_en)].filter(x => x.length);
  const rows = list.map(w => {
    const t = norm(w.title), byA = !!id.artist && byArtist(w, id);
    const tit = tw.length ? Math.max.apply(null, tw.map(ws => ws.filter(x => t.includes(x)).length / ws.length)) : 0;
    const copy = /\b(copy|copia|after|apres|nach|workshop|taller|school|escuela|circle|follower|seguidor)\b/.test(t + ' ' + norm(w.artist)); // copias y talleres, detrás
    return { w, byA, tit, s: (byA ? 2 : 0) + tit - (copy ? 0.5 : 0) };
  });
  let keep = rows.filter(r => r.byA ? r.tit >= 0.3 || tw.length === 0 : !cleanName(r.w.artist) && r.tit >= 1);
  if (!id.artist) keep = rows.filter(r => r.tit >= 0.5);
  else if (!strict && !keep.some(r => r.byA)) keep = rows.filter(r => r.tit >= 1);
  return keep.sort((x, y) => y.s - x.s).map(r => r.w);
}
/* Con lo que reconoció la foto, busca la obra. A la vez: la ficha directa (findIdentified), las obras de ese artista (worksByArtist) y la
   búsqueda por título (para otras versiones), como mucho `wait` ms. Orden: la obra exacta, las del artista con ese título, sus otras obras
   y, solo si del artista no sale nada con ese título, las de otros artistas con el título entero. Las otras obras del artista llevan
   `more: nombre` y las de otros artistas `others: true` (la pantalla les pone un rótulo). onPart(lista, cuántas son la obra exacta). */
async function searchIdentified(id, ctx, onPart, wait) {
  let exact = [], art = null, artErr = ''; const parts = {};
  const key = w => norm(w.title) + '|' + (artistTokens(w.artist).pop() || '');
  const merged = () => {
    const uids = new Set(), keys = new Set(), out = [];
    const put = (w, tag) => { if (!w || uids.has(w.uid) || (w.src !== 'wiki' && keys.has(key(w)))) return; uids.add(w.uid); keys.add(key(w)); out.push(Object.assign({}, w, tag)); };
    exact.forEach(w => put(w));
    (art ? art.match : []).forEach(w => put(w));
    const rest = [].concat(...Object.values(parts));
    const strict = out.length > 0;
    const ranked = rankFound(rest, id, strict), mine = ranked.filter(w => byArtist(w, id)), others = ranked.filter(w => !byArtist(w, id));
    mine.forEach(w => put(w));
    const found = out.length;
    (art ? art.other : []).forEach(w => put(w, { more: art.who || id.artist }));
    if (!found) others.forEach(w => put(w, { others: true }));
    return out.slice(0, 24);
  };
  const emit = () => { if (onPart) try { onPart(merged(), exact.length); } catch (e) { /* la pantalla ya no escucha */ } };
  const hint = id.artist_en || id.artist;
  const titles = [id.title_en, id.title].filter((t, i, l) => t && t.trim().length > 1 && l.findIndex(x => x && norm(x) === norm(t)) === i);
  const jobs = [findIdentified(id, ctx).then(l => { exact = l || []; emit(); }, () => {}), worksByArtist(id, ctx).then(a => { art = a; emit(); }, e => { artErr = String(e && e.message || e); })]
    .concat(titles.map((t, i) => searchPaintings(t, ctx, l => { parts[i] = l; emit(); }, hint).then(l => { parts[i] = l; emit(); }, () => {})));
  await Promise.race([Promise.all(jobs), sleep(wait || 25000)]);
  return { list: merged(), exact: exact.length, artist: art ? { who: art.who, qid: art.qid, match: art.match.length, other: art.other.length, q: art.q } : artErr || null };
}
async function identifyArtwork(b64, mime, keys) {
  keys = keys || {};
  const named = (p, e) => { if (e && e.timeout) e.message = 'Tiempo de espera agotado esperando a ' + p; return e; };
  if (keys.gemini) {
    let last;
    const body = think => JSON.stringify({ contents: [{ parts: [{ text: ID_PROMPT }, { inline_data: { mime_type: mime || 'image/jpeg', data: b64 } }] }], generationConfig: Object.assign({ responseMimeType: 'application/json', temperature: 0 }, think ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) });
    for (const model of GEMINI_MODELS) {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(keys.gemini);
      const call = think => getJSON(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(think) }, 60000);
      try {
        let j;
        // Los modelos 3.x «piensan» antes de responder y pueden tardar mucho: se pide poco razonamiento (si el modelo no lo admite, se repite sin eso).
        try { j = await call(true); } catch (e) { if (e && e.status === 400) j = await call(false); else throw e; }
        const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
        return parseIdJSON(parts.map(p => p.text || '').join(''));
      } catch (e) {
        last = named('Gemini (' + model + ')', e);
        // modelo que ya no existe (404), saturado (503, 500, 502, 504), sin cuota (429) o que no responde: se prueba el siguiente
        if (!(e && (e.timeout || [404, 429, 500, 502, 503, 504].includes(e.status)))) throw last;
      }
    }
    if (!keys.anthropic) throw last; // sin otra clave, se devuelve el último error
  }
  if (keys.anthropic) {
    let j;
    try { j = await getJSON('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': keys.anthropic, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 400, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime || 'image/jpeg', data: b64 } }, { type: 'text', text: ID_PROMPT }] }] })
    }, 60000); } catch (e) { throw named('Claude', e); }
    return parseIdJSON((j.content || []).map(p => p.text || '').join(''));
  }
  const e = new Error('Falta la clave para reconocer fotos'); e.noKey = true; throw e;
}

/* Colecciones sin API pública, pero con datos abiertos: MoMA, National Gallery of Art y Tate. Los datos se convirtieron en trozos
   pequeños en data/<museo>/ (ver tools/*-shards.py). Cada fila: [id, título, artista, año, clave de imagen, ...]. */
const momaToken = id => btoa('[["f","' + id + '"],["p","convert","-resize 1024x1024\\u003e"]]').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const SHARDS = {
  moma: {
    museum: 'MoMA (Nueva York)', license: 'MoMA (obra con o sin derechos de autor)',
    img: r => ['https://www.moma.org/media/' + momaToken(r[4]) + '.jpg?sha=' + r[5]], url: r => 'https://www.moma.org/collection/works/' + r[0]
  },
  nga: {
    museum: 'National Gallery of Art (Washington)', license: 'NGA (acceso abierto)',
    img: (r, px) => ['https://api.nga.gov/iiif/' + r[4] + '/full/!' + px + ',' + px + '/0/default.jpg', 'https://api.nga.gov/iiif/' + r[4] + '/full/!1000,1000/0/default.jpg'],
    url: r => 'https://www.nga.gov/artworks/' + r[0]
  },
  tate: {
    museum: 'Tate (Reino Unido)', license: 'Tate (obra con o sin derechos de autor)',
    img: r => ['https://media.tate.org.uk/art/images/work/' + r[4] + '_10.jpg', 'https://media.tate.org.uk/art/images/work/' + r[4] + '_9.jpg', 'https://media.tate.org.uk/art/images/work/' + r[4] + '_8.jpg'],
    url: r => 'https://www.tate.org.uk/art/artworks/' + r[5]
  }
};
/* Colecciones precargadas desde Wikidata (tools/wd-shards.py, cada semana): museos sin API propia. Fila: [QID, título, artista, año, archivo de Commons]. */
const WD_SHARDS = ['louvre', 'orsay', 'prado', 'versailles', 'orangerie', 'marmottan', 'petitpalais', 'lyon', 'lille', 'rouen', 'fabre', 'jacquemart', 'conde',
  'thyssen', 'bilbao', 'uffizi', 'pitti', 'brera', 'borghese', 'accademia', 'capodimonte', 'barberini', 'carrara', 'vaticanos',
  'hermitage', 'rusomuseum', 'tretyakov', 'pushkin', 'nationalgallery', 'npglondon', 'courtauld', 'wallace', 'scotland', 'irelandng',
  'vangogh', 'mauritshuis', 'kroller', 'kmskb', 'kunsthistorisches', 'belvedere', 'altepinakothek', 'dresden', 'gemaelde', 'altenational', 'wallraf', 'staedel',
  'zurich', 'basel', 'nationalmuseum', 'ateneum', 'budapest', 'varsovia', 'mfa', 'frick', 'barnes', 'phillips', 'gardner', 'nelson', 'neuegalerie', 'nmwa'];
/* Identificadores de Wikidata encontrados por el generador semanal (data/wd-summary.json): con ellos las consultas en vivo van
   directas a la colección en vez de buscarla por su nombre. */
const WD_QIDS = {'petitpalais': 'Q59546080', 'npglondon': 'Q238587', 'mfa': 'Q49133', 'lille': 'Q2628596', 'rouen': 'Q3086934', 'conde': 'Q1236032', 'pushkin': 'Q4872', 'marmottan': 'Q1327886', 'lyon': 'Q511', 'fabre': 'Q1519002', 'jacquemart': 'Q1165526', 'thyssen': 'Q176251', 'bilbao': 'Q127064', 'pitti': 'Q866498', 'brera': 'Q150066', 'borghese': 'Q841506', 'accademia': 'Q338330', 'capodimonte': 'Q290549', 'barberini': 'Q2266081', 'carrara': 'Q338367', 'vaticanos': 'Q182955', 'rusomuseum': 'Q211043', 'tretyakov': 'Q183334', 'courtauld': 'Q12110695', 'wallace': 'Q1327919', 'scotland': 'Q942713', 'irelandng': 'Q2018379', 'mauritshuis': 'Q221092', 'kroller': 'Q1051928', 'kmskb': 'Q377500', 'kunsthistorisches': 'Q95569', 'belvedere': 'Q303139', 'altepinakothek': 'Q154568', 'dresden': 'Q1501219', 'gemaelde': 'Q165631', 'altenational': 'Q162111', 'wallraf': 'Q700959', 'staedel': 'Q163804', 'zurich': 'Q685038', 'basel': 'Q194626', 'nationalmuseum': 'Q842858', 'budapest': 'Q840886', 'varsovia': 'Q153306', 'frick': 'Q682827', 'barnes': 'Q808462', 'phillips': 'Q578485', 'gardner': 'Q49135', 'nelson': 'Q1976985', 'nmwa': 'Q1362629'};
Object.keys(WD_QIDS).forEach(k => { const x = MUSEUMS.find(y => y.id === k); if (x && (!x.ids || !x.ids.length)) x.ids = WD_QIDS[k].split(','); });
// Estos museos usan su lista precargada como fuente directa (la crea cada semana tools/wd-shards.mjs)
WD_SHARDS.forEach(k => { const m = MUSEUMS.find(x => x.id === k); if (m && !m.direct) m.direct = k; });
WD_SHARDS.forEach(k => {
  const m = MUSEUMS.find(x => x.id === k);
  SHARDS[k] = {
    wd: true, museum: m ? m.es + ' (' + m.city + ')' : k, license: 'Imagen de Wikimedia Commons',
    img: (r, px) => commonsImgs('https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(r[4]), px), url: r => 'https://www.wikidata.org/wiki/Q' + r[0]
  };
});
const SHARD_RAW = 'https://raw.githubusercontent.com/Mrtana/screenart/main/data/';
async function shardJSON(key, name) {
  return memo('shard:' + key + '/' + name, async () => {
    try { return await getJSON('data/' + key + '/' + name, {}, 25000); }
    catch (e) { return await getJSON(SHARD_RAW + key + '/' + name, {}, 25000); }
  });
}
const nameHas = (hay, who) => { const h = norm(hay); return who.split(/\s+/).every(t => h.includes(t)); };
async function shardFetch(key, plan, ctx) {
  const S = SHARDS[key];
  let index;
  try { index = await shardJSON(key, 'index.json'); }
  catch (e) { if (S.wd && e.status === 404) return []; throw e; } // la lista semanal aún no existe: el museo sigue con sus otras fuentes
  // En las listas de Wikidata solo hay pintura, dibujo y estampa: cualquier otro tipo pedido usa pintura.
  const type = S.wd && !index[plan.type] ? 'painting' : (plan.type || 'painting');
  let parts = index[type] || [];
  if (plan.range) parts = parts.filter(p => p.y1 == null || (p.y1 >= plan.range[0] && p.y0 <= plan.range[1]));
  if (!parts.length) return [];
  const who = plan.artist ? norm(plan.artist) : null, kw = plan.keyword ? norm(plan.keyword) : null;
  /* sin artista ni palabra: un trozo al azar; con ellos hay que mirar todos los del tipo */
  if (plan.style && plan.style.loose && !who) return []; // estilos de una cultura (china, coreana, virreinal…): estas listas no los distinguen
  // Con un estilo elegido, las listas no saben de estilos: se buscan las obras de los artistas de ese estilo.
  const st = !who && plan.style && (plan.style.artists || []).length ? plan.style : null;
  const chosen = who || kw || st ? shuffle(parts.slice()).slice(0, 16) : [pick(parts)];
  const rows = [].concat(...await Promise.all(chosen.map(p => shardJSON(key, p.f))));
  let hits = rows.filter(r => (!plan.range || r[3] == null || (r[3] >= plan.range[0] && r[3] <= plan.range[1])) && (!who || nameHas(r[2], who)) && (!kw || norm(r[1]).includes(kw)) && (!st || styleArtistMatch({ artist: r[2] }, st)));
  if (plan.range) hits = hits.filter(r => r[3] != null);
  return sampleN(hits, 40).map(r => mk({
    src: key, museum: S.museum, id: r[0], title: r[1], artist: r[2], date: r[3] == null ? '' : String(r[3]), year: r[3],
    imgs: S.img(r, PX(ctx)), url: S.url(r), type, pd: S.wd && r[3] != null && r[3] <= 1900 ? true : null, license: S.license
  }));
}
const momaFetch = (plan, f, ctx) => shardFetch('moma', plan, ctx);
const ngaFetch = (plan, f, ctx) => shardFetch('nga', plan, ctx);
const tateFetch = (plan, f, ctx) => shardFetch('tate', plan, ctx);

const GENERIC = ['landscape', 'portrait', 'flowers', 'sea', 'garden', 'still life', 'river', 'mountains', 'figure', 'city', 'harbor', 'winter', 'horse', 'woman', 'sky', 'forest', 'village', 'ship', 'night', 'mother'];

WD_SHARDS.forEach(k => { DIRECT[k] = (plan, f, ctx) => shardFetch(k, plan, ctx); });
DIRECT.moma = momaFetch; DIRECT.nga = ngaFetch; DIRECT.tate = tateFetch; DIRECT.met = metFetch; DIRECT.aic = aicFetch; DIRECT.cma = cmaFetch; DIRECT.rijks = rijksFetch; DIRECT.vam = vamFetch; DIRECT.smk = smkFetch; DIRECT.mia = miaFetch; DIRECT.si = siFetch; DIRECT.harvard = harvardFetch;
const MUSEUM_SOURCES = [];
MUSEUMS.forEach(m => { const src = museumSource(m); SOURCE_LIST.push(src); MUSEUM_SOURCES.push(src); });

/* Colecciones rápidas por movimiento (basadas en historia-arte.com/movimientos). Cada una se aplica sobre los filtros a cero y con
   todos los museos: s = estilos, a = solo esos artistas (basta con que el nombre de la obra contenga todas sus palabras, por eso hay
   variantes como «Bosch»/«Bosco»), y = años desde–hasta. */
const QUICK_COLLECTIONS = [
  { key: 'm:protorenac', es: 'Proto-Renacimiento', s: ['gothic'], y: [1300, 1400] },
  { key: 'm:quattrocento', es: 'Quattrocento', s: ['renaissance'], y: [1400, 1500] },
  { key: 'm:cinquecento', es: 'Cinquecento', s: ['renaissance'], y: [1500, 1600] },
  { key: 'm:manierismo', es: 'Manierismo', s: ['mannerism'], y: [1520, 1610] },
  { key: 'm:renacnorte', es: 'Renacimiento del Norte', a: ['Jan van Eyck', 'Weyden', 'Memling', 'Hieronymus Bosch', 'El Bosco', 'Durer', 'Cranach', 'Holbein', 'Bruegel', 'Brueghel', 'Gerard David', 'Massys', 'Matsys', 'Altdorfer'], y: [1400, 1600] },
  { key: 'm:barroco', es: 'Barroco', s: ['baroque', 'dutch', 'spanishgolden'] },
  { key: 'm:rococo', es: 'Rococó', s: ['rococo'] },
  { key: 'm:neoclasicismo', es: 'Neoclasicismo', s: ['neoclassicism'], y: [1750, 1820] },
  { key: 'm:romanticismo', es: 'Romanticismo', s: ['romanticism', 'hudson'] },
  { key: 'm:realismo', es: 'Realismo', s: ['realism', 'barbizon'], y: [1840, 1880] },
  { key: 'm:impresionismo', es: 'Impresionismo', s: ['impressionism'], y: [1865, 1925] },
  { key: 'm:postimpresionismo', es: 'Postimpresionismo', s: ['postimpressionism', 'neoimp', 'nabis'] },
  { key: 'm:simbolismo', es: 'Simbolismo', s: ['symbolism', 'prer'] },
  { key: 'm:primitivismo', es: 'Primitivismo', a: ['Gauguin', 'Henri Rousseau', 'Modigliani', 'Nolde', 'Pechstein', 'Seraphine Louis'], y: [1885, 1930] },
  { key: 'm:artnouveau', es: 'Art Nouveau', s: ['artnouveau'] },
  { key: 'm:artdeco', es: 'Art Decó', s: ['artdeco'] },
  { key: 'm:orientalismo', es: 'Orientalismo', s: ['orientalism'] },
  { key: 'm:fauvismo', es: 'Fauvismo', s: ['fauvism'] },
  { key: 'm:futurismo', es: 'Futurismo', s: ['futurism'] },
  { key: 'm:expresionismo', es: 'Expresionismo', s: ['expressionism'] },
  { key: 'm:cubismo', es: 'Cubismo', s: ['cubism'] },
  { key: 'm:dada', es: 'Dadaísmo', s: ['dada'] },
  { key: 'm:nuevaobj', es: 'Nueva Objetividad', s: ['newobj'] },
  { key: 'm:suprematismo', es: 'Suprematismo', a: ['Malevich', 'Lissitzky', 'Rozanova', 'Kliun', 'Popova', 'Suetin', 'Chashnik'], y: [1913, 1930] },
  { key: 'm:constructivismo', es: 'Constructivismo', s: ['constructivism'] },
  { key: 'm:abstracto', es: 'Arte Abstracto', s: ['abstract'] },
  { key: 'm:metafisica', es: 'Pintura Metafísica', a: ['Chirico', 'Carlo Carra', 'Morandi', 'Savinio', 'Pisis'], y: [1911, 1930] },
  { key: 'm:surrealismo', es: 'Surrealismo y realismo mágico', s: ['surrealism', 'magicreal'] },
  { key: 'm:orfismo', es: 'Orfismo', a: ['Robert Delaunay', 'Sonia Delaunay', 'Kupka', 'Picabia', 'Morgan Russell', 'Macdonald-Wright'], y: [1910, 1930] },
  { key: 'm:neoplasticismo', es: 'Neoplasticismo', s: ['destijl'] },
  { key: 'm:precisionismo', es: 'Precisionismo', a: ['Charles Sheeler', 'Charles Demuth', "O'Keeffe", 'Niles Spencer', 'Ralston Crawford', 'Lozowick'], y: [1915, 1950] },
  { key: 'm:expabstracto', es: 'Expresionismo Abstracto', s: ['abstractexp', 'colorfield'] },
  { key: 'm:artbrut', es: 'Art Brut', a: ['Dubuffet', 'Wolfli', 'Aloise Corbaz', 'Chaissac', 'Henry Darger', 'Martin Ramirez', 'Augustin Lesage'] },
  { key: 'm:informalismo', es: 'Informalismo', s: ['informel'] },
  { key: 'm:nuevafig', es: 'Nueva Figuración', a: ['Francis Bacon', 'Lucian Freud', 'Jose Luis Cuevas', 'Jorge de la Vega', 'Macció', 'Luis Felipe Noe', 'Ernesto Deira'], y: [1945, 1975] },
  { key: 'm:opart', es: 'Op Art y arte cinético', s: ['opart'] },
  { key: 'm:pop', es: 'Pop Art', s: ['pop'] },
  { key: 'm:realismosocial', es: 'Realismo social', s: ['socialrealism', 'regionalism'] },
  { key: 'm:minimalismo', es: 'Minimalismo', a: ['Agnes Martin', 'Frank Stella', 'Robert Ryman', 'Ellsworth Kelly', 'Brice Marden'], y: [1958, 1990] },
  { key: 'm:hiperrealismo', es: 'Hiperrealismo', s: ['photorealism'] },
  { key: 'm:postmodernidad', es: 'Postmodernidad', s: ['neoexp'], y: [1975, 2000] },
  { key: 'm:streetart', es: 'Street Art', s: ['streetart'] },
  // Asia
  { g: 'Asia', key: 'a:ukiyoe', es: 'Ukiyo-e (Japón)', s: ['ukiyoe'] },
  { g: 'Asia', key: 'a:shinhanga', es: 'Shin-hanga (grabado japonés moderno)', a: ['Kawase Hasui', 'Yoshida Hiroshi', 'Ohara Koson', 'Ito Shinsui', 'Hashiguchi Goyo', 'Torii Kotondo', 'Natori Shunsen', 'Tsuchiya Koitsu', 'Ishiwata Koitsu', 'Takahashi Shotei', 'Takahashi Hiroaki'], y: [1905, 1960] },
  { g: 'Asia', key: 'a:nihonga', es: 'Pintura japonesa: Rinpa y Nihonga', s: ['nihonga'] },
  { g: 'Asia', key: 'a:china', es: 'Pintura china', s: ['chinese'] },
  { g: 'Asia', key: 'a:corea', es: 'Pintura coreana', s: ['korean'] },
  { g: 'Asia', key: 'a:miniaturas', es: 'Miniaturas persas, indias y mogolas', s: ['persian', 'mughal'] },
  // Latinoamérica
  { g: 'Latinoamérica', key: 'l:virreinal', es: 'Pintura virreinal', s: ['virreinal'], y: [1550, 1820] },
  { g: 'Latinoamérica', key: 'l:paisajemx', es: 'Paisaje mexicano del siglo XIX', a: ['José María Velasco', 'Eugenio Landesio', 'Dr. Atl', 'Gerardo Murillo', 'Cleofas Almanza', 'Luis Coto', 'Joaquín Clausell', 'Conrado Tapia', 'Salvador Murillo', 'Gonzalo Argüelles Bringas', 'Johann Moritz Rugendas', 'Daniel Thomas Egerton', 'Casimiro Castro', 'Edouard Pingret', 'Carl Nebel', 'José Jara', 'Francisco Goitia', 'Pedro Gualdi', 'Jean-Baptiste Louis Gros'], y: [1830, 1950] },
  { g: 'Latinoamérica', key: 'l:moderno', es: 'Arte latinoamericano moderno (con el modernismo brasileño)', s: ['latam'] },
  { g: 'Latinoamérica', key: 'l:muralismo', es: 'Muralismo mexicano', s: ['muralism'] },
  { g: 'Latinoamérica', key: 'l:mujeres', es: 'Mujeres artistas de Latinoamérica', a: [
    'Frida Kahlo', 'María Izquierdo', 'Remedios Varo', 'Leonora Carrington', 'Olga Costa', 'Lilia Carrillo', 'Fanny Rabel', 'Aurora Reyes', 'Nahui Olin', 'Rosa Rolanda', 'Lola Cueto', 'Elena Huerta', 'Alice Rahon', 'Cordelia Urueta', 'Isabel Villaseñor', 'Tina Modotti', 'Lola Álvarez Bravo', 'Graciela Iturbide', 'Joy Laville', 'Leticia Tarragó', 'Marysole Wörner Baz', 'Rocío Maldonado', 'Elena Climent',
    'Tarsila do Amaral', 'Anita Malfatti', 'Lygia Clark', 'Lygia Pape', 'Djanira', 'Maria Martins', 'Tomie Ohtake', 'Georgina de Albuquerque', 'Zina Aita', 'Patrícia Galvão', 'Beatriz Milhazes', 'Adriana Varejão', 'Anna Maria Maiolino', 'Maria Leontina', 'Judith Lauand', 'Mira Schendel', 'Abigail de Andrade', 'Noêmia Mourão', 'Anna Bella Geiger',
    'Raquel Forner', 'Norah Borges', 'Lidy Prati', 'Marta Minujín', 'Lola Mora', 'Emilia Bertolé', 'Marta Boto', 'Lía Correa Morales', 'Ana Weiss', 'Leonor Vassena', 'Raquel Rabinovich', 'Liliana Porter',
    'Amalia Nieto', 'Petrona Viera', 'María Freire',
    'Laura Rodig', 'Ana Cortés', 'Inés Puyó', 'Henriette Petit', 'Violeta Parra', 'Rebeca Matte', 'Marta Colvin', 'Delia del Carril',
    'Débora Arango', 'Beatriz González', 'Fanny Sanín', 'Ana Mercedes Hoyos', 'Olga de Amaral', 'Feliza Bursztyn', 'Judith Márquez', 'Lucy Tejada', 'Doris Salcedo',
    'Gego', 'Elsa Gramcko', 'Mercedes Pardo', 'Luisa Richter', 'Tecla Tofano', 'Luisa Palacios', 'Elisa Elvira Zuloaga', 'Marisol Escobar',
    'Amelia Peláez', 'Carmen Herrera', 'Loló Soldevilla', 'Zilia Sánchez', 'Ana Mendieta', 'Antonia Eiriz', 'Belkis Ayón', 'María Magdalena Campos-Pons',
    'Julia Codesido', 'Tilsa Tsuchiya', 'Teresa Burga', 'Araceli Gilbert', 'Margarita Azurdia', 'Myrna Báez', 'Olga Albizu', 'María Luisa Pacheco', 'Marina Núñez del Prado', 'Olga Blinder', 'Edith Jiménez', 'Clara Ledesma'] },
  // Norteamérica
  { g: 'Norteamérica', key: 'n:colonial', es: 'Retrato colonial americano', a: ['John Singleton Copley', 'Gilbert Stuart', 'Charles Willson Peale', 'Benjamin West', 'Ralph Earl', 'John Trumbull', 'Rembrandt Peale', 'Joseph Blackburn', 'John Smibert', 'Robert Feke'], y: [1730, 1830] },
  { g: 'Norteamérica', key: 'n:hudson', es: 'Escuela del río Hudson', s: ['hudson'] },
  { g: 'Norteamérica', key: 'n:luminismo', es: 'Luminismo (americano, español y belga)', a: ['Fitz Henry Lane', 'Martin Johnson Heade', 'Sanford Robinson Gifford', 'John Frederick Kensett', 'Fitz Hugh Lane', 'Joaquín Sorolla', 'Ignacio Pinazo', 'Cecilio Pla', 'Teodoro Andreu', 'Navarro Llorens', 'Emile Claus', 'Anna Boch', 'Jenny Montigny', 'Jan Sluijters', 'Leo Gestel', 'Ferdinand Hart Nibbrig'], y: [1840, 1930] },
  { g: 'Norteamérica', key: 'n:oeste', es: 'El Oeste americano', a: ['Albert Bierstadt', 'Thomas Moran', 'Frederic Remington', 'Charles Marion Russell', 'George Catlin', 'Karl Bodmer', 'Alfred Jacob Miller', 'Charles Schreyvogel', 'Frank Tenney Johnson', 'Seth Eastman'], y: [1830, 1925] },
  { g: 'Norteamérica', key: 'n:ashcan', es: 'Escuela Ashcan', a: ['Robert Henri', 'John Sloan', 'George Bellows', 'George Luks', 'Everett Shinn', 'William Glackens', 'Ernest Lawson', 'Arthur Bowen Davies', 'Maurice Prendergast'], y: [1895, 1935] },
  { g: 'Norteamérica', key: 'n:hopper', es: 'Hopper y la escena americana', s: ['regionalism'] },
  { g: 'Norteamérica', key: 'n:grupo7', es: 'Grupo de los Siete (Canadá)', a: ['Tom Thomson', 'Lawren Harris', 'A. Y. Jackson', 'J. E. H. MacDonald', 'Arthur Lismer', 'Frederick Varley', 'Franklin Carmichael', 'Frank Johnston', 'Emily Carr', 'A. J. Casson', 'Edwin Holgate'], y: [1910, 1945] },
  // Europa
  { g: 'Europa', key: 'e:flamencos', es: 'Primitivos flamencos', s: ['earlynl'] },
  { g: 'Europa', key: 'e:holandes', es: 'Siglo de Oro holandés', s: ['dutch'] },
  { g: 'Europa', key: 'e:espanol', es: 'Siglo de Oro español', s: ['spanishgolden'] },
  { g: 'Europa', key: 'e:prerrafaelitas', es: 'Prerrafaelitas', s: ['prer'] },
  { g: 'Europa', key: 'e:academico', es: 'Arte académico', s: ['academic'] },
  { g: 'Europa', key: 'e:danesa', es: 'Edad de Oro danesa y pintores de Skagen', a: ['Hammershøi', 'Krøyer', 'Anna Ancher', 'Michael Ancher', 'Købke', 'Eckersberg', 'Jens Juel', 'Rørbye', 'Constantin Hansen', 'L. A. Ring', 'Viggo Johansen', 'Laurits Tuxen', 'Wilhelm Bendz', 'Johan Thomas Lundbye'], y: [1790, 1920] },
  { g: 'Europa', key: 'e:nordicos', es: 'Pintores nórdicos', a: ['Anders Zorn', 'Carl Larsson', 'Gallen-Kallela', 'Albert Edelfelt', 'Harald Sohlberg', 'Nikolai Astrup', 'Bruno Liljefors', 'Eugène Jansson', 'Prins Eugen', 'Helene Schjerfbeck', 'Hugo Simberg', 'Peder Balke', 'Frits Thaulow', 'Christian Krohg', 'Theodor Kittelsen', 'Edvard Munch'], y: [1850, 1935] },
  { g: 'Europa', key: 'e:itinerantes', es: 'Itinerantes rusos', a: ['Repin', 'Shishkin', 'Levitan', 'Kramskoi', 'Surikov', 'Vasnetsov', 'Aivazovsky', 'Perov', 'Savrasov', 'Kuindzhi', 'Polenov', 'Nikolai Ge', 'Makovsky', 'Yaroshenko', 'Myasoyedov', 'Vereshchagin'], y: [1860, 1915] },
  { g: 'Europa', key: 'e:bizantino', es: 'Bizantino e iconos', s: ['byzantine'] }
];
function quickFilters(q) { // filtros de una colección rápida sobre una base ya a cero
  return { styles: (q.s || []).slice(), artists: (q.a || []).slice(), yearFrom: q.y ? String(q.y[0]) : '', yearTo: q.y ? String(q.y[1]) : '' };
}

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
  QUICK_COLLECTIONS, quickFilters, cleanName, WD_SHARDS, wdMuseumQuery, wdSelect, md5, commonsImgs, PX, memoForget, primeWikidataCounts, rand, pick, shuffle, sampleN, norm, parseYear, flipName, classifyType, getJSON, mapLimit,
  ERAS, STYLES, TYPES, KEYWORDS, EXCLUDES, excluded, MUSEUMS, DEFAULT_MUSEUMS, MUSEUM_SOURCES, ARTIST_SUGGESTIONS, ARTIST_GROUPS, TUNING, keywordToQuery,
  museumCountry, countryCollections, styleIdsOf, searchPaintings, identifyArtwork, findIdentified, searchIdentified, rankFound, sameArtist, countryCollectionName, defaultFilters, allowedRanges, makePlan, accept, mk, cleanTitle, cleanDate, SOURCE_LIST, SOURCE_DEFAULTS, runSource, addMuseum, resolveMuseum, MUSEUM_DESC, museumIdsByTag,
  adapters: { momaFetch, ngaFetch, tateFetch, shardFetch, commonsSpecial, wikidataMuseum, wikipediaFetch, commonsFetch, wikiartFetch, metFetch, aicFetch, cmaFetch, smkFetch, vamFetch, miaFetch, rijksFetch, wikiFetch, museumFetch, europeanaFetch, siFetch, harvardFetch }
};
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ArtCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
