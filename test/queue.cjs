// Prueba de la cola: casi todas las fuentes fallan y la única que responde tiene solo 2 obras.
// La pantalla debe seguir cambiando (repitiendo las ya vistas) y nunca quedarse parada.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const J = o => ({ ok: true, status: 200, json: async () => o });
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.test/' });
const w = dom.window; w.__ART_TUNING = { sparqlPause: 5 }; const errors = [];
w.addEventListener('error', e => errors.push(e.message));
let metCalls = 0;
w.fetch = async url => {
  url = String(url);
  if (url.includes('metmuseum') && url.includes('/search')) { metCalls++; return J({ total: 2, objectIDs: [1, 2] }); }
  if (url.includes('metmuseum') && url.includes('/objects/')) { const id = +url.split('/').pop(); return J({ objectID: id, isPublicDomain: true, primaryImage: 'https://img/met' + id + '.jpg', primaryImageSmall: 'https://img/s' + id + '.jpg', title: 'Obra ' + id, artistDisplayName: 'Autor', objectDate: '1890', objectBeginDate: 1890, objectEndDate: 1890, classification: 'Paintings', medium: 'Oil on canvas', objectURL: 'https://m/' + id }); }
  throw new TypeError('Failed to fetch');
};
w.Image = function () { const o = { set src(v) { this._s = v; setTimeout(() => { o.naturalWidth = 1600; o.naturalHeight = 1000; o.onload && o.onload(); }, 5); }, get src() { return this._s; } }; return o; };
w.AbortController = AbortController;
w.eval(Array.from(html.matchAll(/<script>\n([\s\S]*?)<\/script>/g), m => m[1]).join('\n'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms) => { const t = Date.now(); while (!fn() && Date.now() - t < ms) await wait(50); return fn(); };
(async () => {
  const A = w.ArtApp, S = A.S;
  S.st.interval = 3600; S.recycleAfter = 400; // el avance lo hace la prueba
  await until(() => S.current, 5000);
  const seq = [S.current.uid];
  for (let i = 0; i < 5; i++) {
    A.next();
    const prev = S.shown;
    await until(() => S.shown > prev && !S.adv, 30000);
    seq.push(S.current.uid);
  }
  console.log('secuencia:', seq.join(' '));
  if (seq.length !== 6 || new Set(seq).size > 2 || seq.some((u, i) => i && u === seq[i - 1])) { console.error('FALLO: la pantalla no siguió cambiando', seq); process.exit(1); }
  const st = Object.values(S.status).map(x => x.state);
  if (!st.includes('error')) { console.error('FALLO: debía haber fuentes con error'); process.exit(1); }
  // Cambiar de filtros mientras hay búsquedas en marcha no debe dejar la cola bloqueada
  S.f.styles = ['surrealism']; A.applyChange();
  await wait(900);
  console.log('tras cambiar filtros, flight:', S.flight.size, '| adv:', S.adv, '| errores JS:', errors.length ? errors : 'ninguno');
  if (errors.length) process.exit(1);
  console.log('COLA OK');
  process.exit(0);
})();
