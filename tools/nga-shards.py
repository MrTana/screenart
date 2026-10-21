#!/usr/bin/env python3
"""Genera data/nga/*.json a partir de los datos abiertos de la National Gallery of Art (github.com/NationalGalleryOfArt/opendata).
Solo obras con imagen de acceso abierto (IIIF a gran tamaño). Uso: python3 tools/nga-shards.py ruta/a/opendata/data"""
import csv, json, os, re, sys
csv.field_size_limit(10**9)
SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'nga')
TYPES = {'Painting': 'painting', 'Drawing': 'drawing', 'Index of American Design': 'drawing', 'Print': 'print', 'Photograph': 'photo', 'Sculpture': 'sculpture', 'Decorative Art': 'decorative'}
CHUNK = 2500
img = {}
for r in csv.DictReader(open(os.path.join(SRC, 'published_images.csv'), encoding='utf-8')):
    if r['viewtype'] != 'primary' or r['openaccess'] != '1' or not r['depictstmsobjectid']: continue
    m = re.match(r'https://api\.nga\.gov/iiif/([0-9a-f-]{36})$', r['iiifurl'])
    if m: img[r['depictstmsobjectid']] = m.group(1)
def year(disp, begin):
    m = re.search(r'\b(1[0-9]{3}|20[0-9]{2})\b', disp or '')
    if m: return int(m.group(1))
    m = re.search(r'(\d{1,2})(?:st|nd|rd|th) century', disp or '')
    if m: return (int(m.group(1)) - 1) * 100 + 50
    try:
        b = int(begin)
        return b if abs(b) >= 100 else None
    except (TypeError, ValueError): return None
by = {v: [] for v in set(TYPES.values())}
for r in csv.DictReader(open(os.path.join(SRC, 'objects.csv'), encoding='utf-8')):
    t = TYPES.get(r['classification']); u = img.get(r['objectid'])
    if not t or not u: continue
    y = year(r['displaydate'], r['beginyear'])
    by[t].append([int(r['objectid']), r['title'].strip()[:90], (r['attribution'] or r['attributioninverted']).strip()[:60], y, u])
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
print({t: len(r) for t, r in by.items()})
