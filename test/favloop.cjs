// Solo favoritas: al terminar de verlas todas, la pantalla sigue repitiéndolas al azar (nunca se queda parada),
// aunque alguna favorita tenga la imagen rota (antes eso dejaba la pantalla parada al acabar la vuelta). Igual con «solo pinturas vistas».
const assert = require('assert');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const N = 6;
const run = kind => new Promise((done, fail) => {
const favs = Array.from({ length: N }, (_, i) => ({ ft: 1000 + i, uid: 'fav:' + i, src: 'wiki', museum: 'M', title: 'Favorita ' + i, artist: 'A', imgs: ['https://img/f' + i + '.jpg'], thumb: 'https://img/t' + i + '.jpg', url: 'https://x/' + i, type: 'painting' }));
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.test/?tv=0' });
const w = dom.window; w.__ART_TUNING = { sparqlPause: 5 }; const errors = [];
w.addEventListener('error', e => errors.push(e.message));
w.localStorage.setItem('galeria-arte-v1:' + kind, JSON.stringify(favs));
const f = kind === 'favs' ? { onlyFavs: true } : { onlyViewed: true };
w.localStorage.setItem('galeria-arte-v1:f', JSON.stringify(f));
w.fetch = async () => { throw new TypeError('Failed to fetch'); };
w.Image = function () { const o = { set src(v) { this._s = v; setTimeout(() => { if (/f3\.jpg/.test(v)) { o.onerror && o.onerror(); return; } o.naturalWidth = 1600; o.naturalHeight = 1000; o.onload && o.onload(); }, 3); }, get src() { return this._s; } }; return o; };
w.AbortController = AbortController;
w.eval(Array.from(html.matchAll(/<script>\n([\s\S]*?)<\/script>/g), m => m[1]).join('\n'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms) => { const t = Date.now(); while (!fn() && Date.now() - t < ms) await wait(30); return fn(); };
(async () => {
  const A = w.ArtApp, S = A.S;
  S.st.interval = 3600;
  assert.ok(kind === 'favs' ? S.f.onlyFavs : S.f.onlyViewed, 'arranca con solo ' + kind);
  assert.ok(await until(() => S.current, 5000), 'muestra la primera favorita');
  const seen = [S.current.uid];
  for (let i = 0; i < N * 3; i++) {
    const before = S.shown;
    A.next();
    const ok = await until(() => S.shown > before && !S.adv, 3000);
    assert.ok(ok, 'se detuvo tras ' + seen.length + ' obras (vueltas: ' + Math.floor(seen.length / N) + ')');
    seen.push(S.current.uid);
  }
  assert.ok(seen.every(u => u.startsWith('fav:')), 'solo favoritas');
  assert.ok(!seen.includes('fav:3'), 'la favorita con la imagen rota se salta');
  assert.strictEqual(new Set(seen.slice(0, N - 1)).size, N - 1, 'la primera vuelta pasa por todas las que cargan, sin repetir: ' + seen.slice(0, N - 1).join());
  assert.strictEqual(new Set(seen).size, N - 1, 'luego las repite');
  assert.ok(!errors.length, 'sin errores JS: ' + errors.join(' | '));
  console.log((kind === 'favs' ? 'FAVORITAS' : 'PINTURAS VISTAS') + ' OK · ' + seen.length + ' obras mostradas en bucle');
  w.close(); done();
})().catch(fail);
});
run('favs').then(() => run('vistas')).then(() => process.exit(0), e => { console.error('FALLO favoritas / vistas:', e.message); process.exit(1); });
