const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const J = o => ({ ok: true, status: 200, json: async () => o });
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.test/' });
const w = dom.window;
const errors = [];
w.addEventListener('error', e => errors.push(e.message));
// Mocks: fetch y Image
w.fetch = async (url, init) => {
  url = String(url);
  if (url.includes('metmuseum') && url.includes('/search')) return J({ objectIDs: [1, 2, 3] });
  if (url.includes('metmuseum') && url.includes('/objects/')) { const id = +url.split('/').pop(); return J({ objectID: id, isPublicDomain: true, primaryImage: 'https://img/met' + id + '.jpg', primaryImageSmall: 'https://img/met' + id + 's.jpg', title: 'Obra ' + id, artistDisplayName: 'Claude Monet', objectDate: '1880', objectBeginDate: 1880, objectEndDate: 1880, classification: 'Paintings', objectURL: 'https://m/' + id }); }
  throw new TypeError('Failed to fetch');
};
w.Image = function () { const o = { set src(v) { this._s = v; setTimeout(() => { o.naturalWidth = 1600; o.naturalHeight = 1000; o.onload && o.onload(); }, 5); }, get src() { return this._s; } }; return o; };
w.AbortController = AbortController;
w.eval(fs.readFileSync(__dirname + '/../src/core.js', 'utf8').replace(/^[\s\S]*$/, m => m)); // sanity: core evaluates alone
w.eval(html.match(/<script>\n([\s\S]*?)<\/script>\s*<script>\n([\s\S]*?)<\/script>/).slice(1, 3).join('\n'));
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await wait(600);
  const A = w.ArtApp, S = A.S;
  console.log('mostradas:', S.shown, '| pool:', S.pool.length, '| cargador oculto:', w.document.getElementById('loader').hidden);
  console.log('ficha:', w.document.querySelector('#caption .t').textContent, '|', w.document.querySelector('#caption .m').textContent, '|', w.document.querySelector('#caption .s').textContent);
  console.log('estado fuentes:', JSON.stringify(Object.fromEntries(Object.entries(S.status).map(([k, v]) => [k, v.state]))));
  A.openMenu();
  const d = w.document; function d0(){return d;}
  console.log('chips museos:', d0().querySelectorAll('#c-museums .chip').length, '| activos:', d0().querySelectorAll('#c-museums .chip[aria-pressed=true]').length);
  console.log('menu abierto:', !d.getElementById('drawer').hidden, '| chips estilos:', d.querySelectorAll('#c-styles .chip').length, '| museos:', d.querySelectorAll('#c-srcs .src').length);
  // clic en estilo Impresionismo y en una fuente
  d.querySelector('#c-styles [data-id=impressionism]').click();
  d.querySelector('#c-presets [data-id="2"]').click(); // Maestros holandeses
  console.log('filtros tras preset:', JSON.stringify({ styles: S.f.styles, types: S.f.types }));
  d.querySelector('#c-artist-sug [data-act=add-sug]').click();
  console.log('artistas:', JSON.stringify(S.f.artists), '| chips artista:', d.querySelectorAll('#c-artists .chip').length);
  d.getElementById('kwIn').value = 'caballos'; d.querySelector('[data-act=add-kw]').click();
  console.log('temas:', JSON.stringify(S.f.keywords));
  A.onAct('interval', '10'); A.onAct('mode', 'frame'); A.onAct('opt', 'kb'); A.onAct('fav', '');
  console.log('modo:', d.getElementById('stage').className, '| favoritas:', S.favs.length);
  d.querySelector('#c-museums [data-id=louvre]').click();
  console.log('Louvre desmarcado:', !S.f.museums.includes('louvre'));
  d.querySelector('[data-act=mus-none]').click(); console.log('ninguno:', S.f.museums.length);
  d.querySelector('[data-act=mus-all]').click(); console.log('todos:', S.f.museums.length);
  const pi = Array.from(d.querySelectorAll('#c-presets .chip')).findIndex(c => c.textContent === 'Museos de París'); d.querySelectorAll('#c-presets .chip')[pi].click();
  console.log('preset Museos de París -> fuentes activas:', Object.keys(S.f.sources).filter(k => S.f.sources[k]).join(','), '| museos:', S.f.museums.join(','));
  A.closeMenu();
  await wait(1500);
  console.log('tras filtros -> mostradas:', S.shown, '| estados:', JSON.stringify(Object.fromEntries(Object.entries(S.status).map(([k, v]) => [k, v.state + (v.msg ? ':' + v.msg : '')]))));
  A.next(); await wait(100); A.prev();
  console.log('historial:', S.hist.length, 'idx', S.hi);
  console.log('errores JS:', errors.length ? errors : 'ninguno');
  process.exit(0);
})();
