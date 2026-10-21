#!/usr/bin/env python3
"""Genera data/tate/*.json a partir de los datos abiertos de Tate (github.com/tategallery/collection, artwork_data.csv).
Fila: [id, título, artista, año, clave de imagen, ruta de la ficha]. Uso: python3 tools/tate-shards.py ruta/a/artwork_data.csv"""
import csv, json, os, re, sys
SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'tate')
CHUNK = 2500
def kind(m, acc):
    m = (m or '').lower()
    if re.search(r'photograph|gelatin silver|c-print|chromogenic|daguerre|albumen', m): return 'photo'
    if re.search(r'screenprint|lithograph|etching|woodcut|engraving|linocut|aquatint|mezzotint|drypoint|relief print|collotype|monotype|print', m): return 'print'
    if re.search(r'oil|acrylic|tempera|encaustic|emulsion|enamel|gloss paint|household paint|spray paint|egg', m): return 'painting'
    if re.search(r'bronze|marble|plaster|stone|wood|steel|aluminium|terracotta|clay|resin|fibreglass|granite|lead|iron|ceramic|glass|plastic', m): return 'sculpture'
    if re.search(r'graphite|chalk|charcoal|ink|pencil|pastel|watercolour|gouache|crayon|pen|brush|wash|drawing|collage', m):
        # los cuadernos de bocetos de Turner (D...) son miles de páginas a lápiz: se dejan fuera
        if acc.startswith('D') and re.match(r'graphite( on paper)?$', m.split('.')[0].strip()): return None
        return 'drawing'
    return None
def name(a):
    if ',' in a:
        l, f = a.split(',', 1); return (f.strip() + ' ' + l.strip()).strip()
    return a.strip()
def year(r):
    if r['year'].isdigit(): return int(r['year'])
    m = re.search(r'\b(1[0-9]{3}|20[0-9]{2})\b', r['dateText'] or ''); return int(m.group(1)) if m else None
by = {k: [] for k in ('painting', 'drawing', 'print', 'photo', 'sculpture')}
for r in csv.DictReader(open(SRC, encoding='utf-8-sig')):
    u = r['thumbnailUrl']
    m = re.match(r'https?://www\.tate\.org\.uk/art/images/work/(\w/\w+/\w+)_8\.jpg$', u)
    k = kind(r['medium'], r['accession_number'])
    if not m or not k or not r['url'].startswith('http://www.tate.org.uk/art/artworks/'): continue
    by[k].append([int(r['id']), r['title'].strip()[:90], name(r['artist'])[:60], year(r), m.group(1), r['url'].split('/artworks/')[1]])
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT): os.remove(os.path.join(OUT, f))
index = {}
for t, rows in by.items():
    rows.sort(key=lambda x: (x[3] is None, x[3] or 0))
    index[t] = []
    for i in range(0, len(rows), CHUNK):
        part = rows[i:i + CHUNK]; nm = '%s-%d.json' % (t, i // CHUNK)
        json.dump(part, open(os.path.join(OUT, nm), 'w'), ensure_ascii=False, separators=(',', ':'))
        ys = [x[3] for x in part if x[3] is not None]
        index[t].append({'f': nm, 'n': len(part), 'y0': min(ys) if ys else None, 'y1': max(ys) if ys else None})
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), separators=(',', ':'))
print({t: len(r) for t, r in by.items()})
