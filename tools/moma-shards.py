#!/usr/bin/env python3
"""Genera data/moma/*.json a partir del CSV abierto de MoMA (github.com/MuseumofModernArt/collection).
Solo obras con imagen de las clasificaciones que tienen sentido en una galería. Uso:
  python3 tools/moma-shards.py [ruta/a/Artworks.csv]   (sin ruta, lo descarga)"""
import csv, json, os, re, sys, base64, urllib.request
URL = 'https://media.githubusercontent.com/media/MuseumofModernArt/collection/main/Artworks.csv'
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'moma')
TYPES = {'Painting': 'painting', 'Drawing': 'drawing', 'Print': 'print', 'Photograph': 'photo', 'Sculpture': 'sculpture'}
CHUNK = 2500
path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/moma.csv'
if not os.path.exists(path):
    urllib.request.urlretrieve(URL, path)
TOKEN = re.compile(r'^https://www\.moma\.org/media/([A-Za-z0-9_-]+)\.jpg\?sha=([0-9a-f]+)$')
def token(fid): return base64.urlsafe_b64encode(('[["f","%s"],["p","convert","-resize 1024x1024\\u003e"]]' % fid).encode()).decode().rstrip('=')
def year(s):
    m = re.search(r'(1[0-9]{3}|20[0-9]{2})', s or '')
    return int(m.group(1)) if m else None
by = {v: [] for v in TYPES.values()}
odd = 0
for r in csv.DictReader(open(path, encoding='utf-8-sig')):
    t = TYPES.get(r['Classification']); u = r['ImageURL'].strip()
    if not t or not u: continue
    m = TOKEN.match(u)
    if not m: odd += 1; continue
    fm = re.search(r'\[\["f","(\d+)"\]', base64.urlsafe_b64decode(m.group(1) + '=' * (-len(m.group(1)) % 4)).decode('latin1'))
    if not fm or token(fm.group(1)) != m.group(1): odd += 1; continue
    by[t].append([int(r['ObjectID']), r['Title'].strip()[:90], r['Artist'].strip()[:60], year(r['Date']), int(fm.group(1)), m.group(2)])
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT): os.remove(os.path.join(OUT, f))
index = {}
for t, rows in by.items():
    rows.sort(key=lambda x: (x[3] is None, x[3] or 0))
    index[t] = []
    for i in range(0, len(rows), CHUNK):
        part = rows[i:i + CHUNK]; name = '%s-%d.json' % (t, i // CHUNK)
        json.dump(part, open(os.path.join(OUT, name), 'w'), ensure_ascii=False, separators=(',', ':'))
        ys = [x[3] for x in part if x[3] is not None]
        index[t].append({'f': name, 'n': len(part), 'y0': min(ys) if ys else None, 'y1': max(ys) if ys else None})
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), separators=(',', ':'))
print({t: len(r) for t, r in by.items()}, 'no reconstruibles:', odd)
