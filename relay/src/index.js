/* Relé propio de la Galería de arte (Cloudflare Worker + Durable Objects).
   Una «sala» por código de TV: reparte los mensajes entre la TV y los móviles (WebSocket) y guarda las favoritas y
   claves compartidas. Se usa desde la web a través de /api/relay/<código>/… (función de Pages enlazada a este Worker). */
import { DurableObject } from 'cloudflare:workers';
import { emptyState, applyOps } from './merge.mjs';

const CODE = /^[a-z0-9]{6,24}$/;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors) });

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    try { ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); } catch (e) { /* entorno sin respuesta automática */ }
  }
  async load() { return (await this.ctx.storage.get('state')) || emptyState(); }
  async fetch(request) {
    const url = new URL(request.url), rest = url.pathname.split('/').slice(4).join('/'); // /api/relay/<código>/<rest>
    if (rest === 'ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Se espera WebSocket', { status: 426 });
      const sub = (url.searchParams.get('sub') || '').slice(0, 80);
      if (!sub) return new Response('Falta sub', { status: 400 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [sub]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (rest === 'state' && request.method === 'GET') { const s = await this.load(); return json(s); }
    if (rest === 'sync' && request.method === 'POST') {
      let body; try { body = await request.json(); } catch (e) { return json({ error: 'JSON no válido' }, 400); }
      const s = await this.load();
      if (applyOps(s, body.ops)) await this.ctx.storage.put('state', s);
      return json(body.v === s.v ? { v: s.v, same: true } : s);
    }
    return json({ error: 'No encontrado' }, 404);
  }
  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > 20000) return;
    let o; try { o = JSON.parse(msg); } catch (e) { return; }
    if (!o || typeof o.p !== 'string' || typeof o.m !== 'string') return;
    this.ctx.getWebSockets(o.p).forEach(s => { if (s !== ws) { try { s.send(o.m); } catch (e) { /* cerrado */ } } });
  }
  async webSocketClose(ws, code) { try { ws.close(code, 'adiós'); } catch (e) { /* ya cerrado */ } }
}

export async function route(request, ns) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  const parts = new URL(request.url).pathname.split('/'); // ['', 'api', 'relay', código, …]
  if (parts[1] !== 'api' || parts[2] !== 'relay' || !CODE.test(parts[3] || '')) return json({ error: 'Código no válido' }, 400);
  return ns.get(ns.idFromName(parts[3])).fetch(request);
}

export default { fetch: (request, env) => route(request, env.ROOMS) };
