// Comprueba que la app es instalable: manifiesto, iconos, enlaces en la página y lógica del service worker.
const fs = require('fs'); const vm = require('vm'); const assert = require('assert');
const root = __dirname + '/..';
const html = fs.readFileSync(root + '/index.html', 'utf8');
const man = JSON.parse(fs.readFileSync(root + '/manifest.webmanifest', 'utf8'));
assert.ok(man.name && man.short_name && man.start_url === './' && man.scope === './' && /fullscreen|standalone/.test(man.display), 'manifiesto básico');
assert.ok(/^#[0-9a-f]{6}$/i.test(man.theme_color) && /^#[0-9a-f]{6}$/i.test(man.background_color));
const png = f => { const b = fs.readFileSync(root + '/' + f); assert.strictEqual(b.slice(1, 4).toString(), 'PNG', f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
man.icons.forEach(i => { const [w, h] = png(i.src); assert.strictEqual(w + 'x' + h, i.sizes, i.src + ' mide ' + w + 'x' + h); });
assert.ok(man.icons.some(i => i.sizes === '512x512' && i.purpose === 'any') && man.icons.some(i => i.sizes === '192x192') && man.icons.some(i => i.purpose === 'maskable' && i.sizes === '512x512'), 'iconos 192, 512 y maskable');
assert.deepStrictEqual(png('icons/apple-touch-icon.png'), [180, 180]); assert.deepStrictEqual(png('icons/favicon-32.png'), [32, 32]);
['rel="manifest" href="manifest.webmanifest"', 'rel="apple-touch-icon"', 'name="theme-color"', 'apple-mobile-web-app-capable', "serviceWorker.register('sw.js')"].forEach(x => assert.ok(html.includes(x), 'index.html sin ' + x));

assert.ok(/no-cache/.test(fs.readFileSync(root + '/_headers', 'utf8')), '_headers sin no-cache');
assert.ok(/Versión [0-9a-f]{10} · /.test(html) && html.includes('data-act="update"'), 'versión y botón de actualizar');
const sw = fs.readFileSync(root + '/sw.js', 'utf8'); assert.ok(!sw.includes('__VERSION__'), 'versión estampada');
const listeners = {}, store = new Map(); let deleted = [];
const cache = { addAll: async () => {}, put: async (k, v) => { store.set(typeof k === 'string' ? k : k.url, v); }, match: async k => store.get(typeof k === 'string' ? k : k.url) };
const ctx = { self: { addEventListener: (n, f) => { listeners[n] = f; }, skipWaiting: () => {}, clients: { claim: async () => {} }, location: { origin: 'https://screenart.pages.dev' } },
  caches: { open: async () => cache, keys: async () => ['galeria-viejo', 'otra-cosa'], delete: async k => { deleted.push(k); }, match: async k => cache.match(k) },
  URL, fetch: async () => ({ ok: true, clone() { return this; } }), Promise };
vm.createContext(ctx); vm.runInContext(sw, ctx);
(async () => {
  let waited; listeners.install({ waitUntil: p => { waited = p; } }); await waited;
  listeners.activate({ waitUntil: p => { waited = p; } }); await waited;
  assert.deepStrictEqual(deleted, ['galeria-viejo'], 'borra solo cachés antiguas de la app');
  const run = (url, mode, method) => { let got = null; listeners.fetch({ request: { url, mode: mode || 'cors', method: method || 'GET' }, respondWith: p => { got = p; } }); return got; };
  assert.strictEqual(run('https://api.artic.edu/api/v1/artworks/search'), null, 'las APIs de museos no pasan por el service worker');
  assert.strictEqual(run('https://upload.wikimedia.org/a.jpg'), null, 'las imágenes tampoco');
  assert.strictEqual(run('https://screenart.pages.dev/', 'navigate', 'POST'), null, 'solo GET');
  assert.ok(run('https://screenart.pages.dev/', 'navigate'), 'la página sí');
  assert.ok(run('https://screenart.pages.dev/icons/icon-192.png'), 'los iconos sí');
  assert.ok(run('https://fonts.gstatic.com/s/x.woff2'), 'las tipografías sí');
  // sin conexión: la página sale de la copia guardada
  await new Promise(r => setTimeout(r, 20)); store.set('index.html', { cached: true }); ctx.fetch = async () => { throw new TypeError('offline'); };
  const off = await run('https://screenart.pages.dev/', 'navigate'); assert.deepStrictEqual(off, { cached: true });
  console.log('PWA OK · manifiesto, iconos y service worker');
})().catch(e => { console.error('FALLO PWA', e); process.exit(1); });
