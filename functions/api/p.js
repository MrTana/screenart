/* Pequeño intermediario para el navegador (Cloudflare Pages Function).
   Algunas colecciones (WikiArt y la búsqueda del Art Institute of Chicago) no envían cabeceras CORS y el navegador
   no deja leerlas. Aquí se piden desde el servidor y se devuelven desde el mismo sitio. Solo GET, solo estas direcciones,
   y solo desde la propia página. */
const ALLOWED = [
  /^https:\/\/www\.wikiart\.org\/en\/[^?#]*\?[^#]*json=2/,
  /^https:\/\/api\.artic\.edu\/api\/v1\/artworks\/search\?/
];
export async function onRequestGet({ request }) {
  const self = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== self.host) return new Response('Origen no permitido', { status: 403 });
  const target = self.searchParams.get('u') || '';
  if (!ALLOWED.some(re => re.test(target))) return new Response('Dirección no permitida', { status: 403 });
  let r;
  try {
    r = await fetch(target, { headers: { Accept: 'application/json', 'User-Agent': 'galeria-de-arte/1.0 (personal art display; https://screenart.pages.dev)' }, cf: { cacheTtl: 3600, cacheEverything: true } });
  } catch (e) {
    return new Response('No se pudo consultar: ' + e.message, { status: 502 });
  }
  const h = new Headers({ 'Content-Type': r.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'public, max-age=900' });
  return new Response(r.body, { status: r.status, headers: h });
}
