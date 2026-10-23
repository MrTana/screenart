/* La web habla con el relé propio en su misma dirección: /api/relay/<código>/… se pasa a la sala (Durable Object)
   del Worker «screenart-relay». El enlace ROOMS se añade en Cloudflare Pages → Configuración → Enlaces. Sin él, la app
   sigue con los relés públicos. */
export async function onRequest({ request, env }) {
  if (!env.ROOMS) return new Response(JSON.stringify({ error: 'Relé sin configurar' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  const parts = new URL(request.url).pathname.split('/');
  if (!/^[a-z0-9]{6,24}$/.test(parts[3] || '')) return new Response('Código no válido', { status: 400 });
  return env.ROOMS.get(env.ROOMS.idFromName(parts[3])).fetch(request);
}
