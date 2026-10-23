#!/usr/bin/env python3
"""Genera data/<museo>/*.json con las obras de museos sin API propia (Louvre, Orsay, Prado…) a partir de Wikidata.
Cada fila: [QID (número), título, artista, año o null, archivo de Commons]. Solo obras con imagen en Commons (jpg/png).
Lo ejecuta cada semana la acción de GitHub «Colecciones precargadas». Uso: python3 tools/wd-shards.py [museo ...]"""
import json, os, re, sys, time, urllib.parse, urllib.request

MUSEUMS = {'louvre': 'Q19675', 'orsay': 'Q23402', 'prado': 'Q160112'}
# Colección: el museo o cualquiera de sus departamentos (el Louvre registra casi todo por departamento: P195 → P361).
# tipo de la app → clases de Wikidata
TYPES = {
    'painting': ['Q3305213'],                                   # pintura
    'drawing': ['Q93184', 'Q18761202', 'Q22669857'],             # dibujo, acuarela, pastel
    'print': ['Q11060274', 'Q18218093', 'Q1373111'],             # estampa, grabado, aguafuerte
}
CHUNK, PAGE = 2500, 8000
ENDPOINT = 'https://query.wikidata.org/sparql'
UA = 'galeria-de-arte/1.0 (colecciones precargadas; https://github.com/MrTana/screenart)'
OUT_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')

def sparql(q, tries=4):
    body = urllib.parse.urlencode({'query': q, 'format': 'json'}).encode()
    for i in range(tries):
        try:
            req = urllib.request.Request(ENDPOINT, data=body, headers={'User-Agent': UA, 'Accept': 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded'})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)['results']['bindings']
        except Exception as e:  # 429/503/tiempo de espera: se espera y se reintenta
            print('  reintento', i + 1, e, file=sys.stderr); time.sleep(10 * (i + 1))
    raise RuntimeError('Wikidata no responde')

def query(coll, classes, offset):
    return ('SELECT ?item ?itemLabel ?creatorLabel ?inc ?image WHERE { '
            'VALUES ?cls { ' + ' '.join('wd:' + c for c in classes) + ' } '
            '?item wdt:P195/wdt:P361* wd:' + coll + '; wdt:P31 ?cls; wdt:P18 ?image. '
            'OPTIONAL { ?item wdt:P170 ?creator. } OPTIONAL { ?item wdt:P571 ?inc. } '
            'SERVICE wikibase:label { bd:serviceParam wikibase:language "es,fr,en". } '
            '} ORDER BY ?item LIMIT ' + str(PAGE) + ' OFFSET ' + str(offset))

FILE = re.compile(r'Special:FilePath/(.+)$')
def row(b):
    m = FILE.search(b['image']['value'])
    if not m: return None
    name = urllib.parse.unquote(m.group(1)).replace(' ', '_')
    if not re.search(r'\.(jpe?g|png)$', name, re.I): return None
    qid = b['item']['value'].rsplit('/', 1)[-1]
    title = (b.get('itemLabel') or {}).get('value', '')
    if re.fullmatch(r'Q\d+', title): title = ''
    artist = (b.get('creatorLabel') or {}).get('value', '')
    if re.fullmatch(r'Q\d+', artist) or artist.startswith('http'): artist = ''
    y = None
    inc = (b.get('inc') or {}).get('value', '')
    mm = re.match(r'^(-?)0*(\d+)-', inc)
    if mm: y = int(mm.group(2)) * (-1 if mm.group(1) else 1)
    return [int(qid[1:]), title.strip()[:90], artist.strip()[:60], y, name]

def build(key, coll):
    by = {}
    for t, classes in TYPES.items():
        seen, rows, off = set(), [], 0
        while True:
            bs = sparql(query(coll, classes, off))
            for b in bs:
                r = row(b)
                if r and r[0] not in seen: seen.add(r[0]); rows.append(r)
            print(' ', key, t, 'página', off // PAGE, len(bs), 'filas →', len(rows))
            if len(bs) < PAGE: break
            off += PAGE; time.sleep(2)
        by[t] = rows
        time.sleep(2)
    return by

def write(key, by):
    out = os.path.join(OUT_ROOT, key)
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out): os.remove(os.path.join(out, f))
    index = {}
    for t, rows in by.items():
        if not rows: continue
        rows.sort(key=lambda x: (x[3] is None, x[3] or 0))
        index[t] = []
        for i in range(0, len(rows), CHUNK):
            part = rows[i:i + CHUNK]; name = '%s-%d.json' % (t, i // CHUNK)
            with open(os.path.join(out, name), 'w', encoding='utf-8') as fh: json.dump(part, fh, ensure_ascii=False, separators=(',', ':'))
            ys = [x[3] for x in part if x[3] is not None]
            index[t].append({'f': name, 'n': len(part), 'y0': min(ys) if ys else None, 'y1': max(ys) if ys else None})
    with open(os.path.join(out, 'index.json'), 'w') as fh: json.dump(index, fh, separators=(',', ':'))

if __name__ == '__main__':
    keys = sys.argv[1:] or list(MUSEUMS)
    failed = []
    for k in keys:
        try:
            by = build(k, MUSEUMS[k])
            if sum(len(r) for r in by.values()) < 50: raise RuntimeError('muy pocas obras: no se sobrescribe')
            write(k, by); print(k, {t: len(r) for t, r in by.items()})
        except Exception as e:
            failed.append(k); print('ERROR', k, e, file=sys.stderr)  # se conservan los datos de la semana anterior
    if len(failed) == len(keys): sys.exit(1)
