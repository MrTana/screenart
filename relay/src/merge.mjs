/* Estado compartido de una TV (por su código): favoritas y claves de API, con «gana el más reciente» por elemento.
   Las bajas se guardan como lápidas para que una favorita quitada en un dispositivo no vuelva desde otro. */
export const MAX_FAVS = 400, MAX_TOMBS = 1000;
const KEY_NAMES = ['europeana', 'si', 'harvard'];
const isStr = (v, n) => typeof v === 'string' && v.length <= n;
function cleanWork(w) {
  if (!w || typeof w !== 'object' || !isStr(w.uid, 120) || !isStr(w.title, 400) || !Array.isArray(w.imgs)) return null;
  const imgs = w.imgs.filter(u => isStr(u, 1000) && /^https:\/\//.test(u)).slice(0, 3);
  if (!imgs.length) return null;
  const o = { uid: w.uid, title: w.title, imgs };
  ['src', 'museum', 'artist', 'date', 'thumb', 'url', 'type', 'license'].forEach(k => { if (isStr(w[k], 1000)) o[k] = w[k]; });
  if (typeof w.year === 'number' && isFinite(w.year)) o.year = w.year;
  if (typeof w.pd === 'boolean') o.pd = w.pd;
  return o;
}
export function emptyState() { return { v: 0, favs: {}, keys: {} }; }
/* ops: [{ uid, t, w } (alta) | { uid, t, del: true } (baja) | { key, t, value } (clave)] */
export function applyOps(state, ops) {
  let changed = false;
  (Array.isArray(ops) ? ops.slice(0, 600) : []).forEach(op => {
    if (!op || typeof op !== 'object' || typeof op.t !== 'number' || !isFinite(op.t)) return;
    if (isStr(op.key, 20) && KEY_NAMES.includes(op.key) && isStr(op.value, 300)) {
      const cur = state.keys[op.key];
      if (!cur || op.t > cur.t) { state.keys[op.key] = { value: op.value, t: op.t }; changed = true; }
      return;
    }
    if (!isStr(op.uid, 120)) return;
    const cur = state.favs[op.uid];
    if (cur && op.t <= cur.t) return;
    if (op.del) { state.favs[op.uid] = { t: op.t, del: true }; changed = true; return; }
    const w = cleanWork(op.w); if (!w || w.uid !== op.uid) return;
    state.favs[op.uid] = { t: op.t, w }; changed = true;
  });
  if (changed) { state.v++; prune(state); }
  return changed;
}
function prune(state) {
  const all = Object.entries(state.favs);
  const live = all.filter(([, x]) => !x.del).sort((a, b) => b[1].t - a[1].t), dead = all.filter(([, x]) => x.del).sort((a, b) => b[1].t - a[1].t);
  if (live.length <= MAX_FAVS && dead.length <= MAX_TOMBS) return;
  const keep = {}; live.slice(0, MAX_FAVS).concat(dead.slice(0, MAX_TOMBS)).forEach(([k, x]) => { keep[k] = x; });
  state.favs = keep;
}
