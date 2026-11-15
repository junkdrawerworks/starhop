#!/usr/bin/env python3
"""Build Starhop's data files from d3-celestial (BSD-3) and city-timezones (MIT).

Coordinates come out as J2000 right ascension and declination in degrees (RA 0..360). Star names are checked
against the IAU Working Group on Star Names' list in tools/wgsn.tsv.

    mkdir -p tools/src && cd tools/src
    npm pack d3-celestial@0.7.35 city-timezones@1.3.4
    for f in *.tgz; do mkdir -p "${f%.tgz}" && tar xzf "$f" -C "${f%.tgz}"; done
    cd ../.. && python3 tools/build_data.py
"""
import json, math, re, sys, unicodedata
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
D = HERE / 'src/d3-celestial-0.7.35/package/data'
CITIES = HERE / 'src/city-timezones-1.3.4/package/data/cityMap.json'
OUT = HERE.parent / 'data'
OUT.mkdir(exist_ok=True)


def ra_of(lon):
    return lon + 360 if lon < 0 else lon


def r(x, n=2):
    return round(float(x), n)


def dump(name, obj):
    s = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
    (OUT / name).write_text(s, encoding='utf-8')
    print(f'{name}: {len(s) / 1024:.0f} KB')


# ---------- stars ----------
stars = json.load(open(D / 'stars.6.json'))['features']
names = json.load(open(D / 'starnames.json'))


def name_key(s):
    return re.sub(r'[^a-z]', '', unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower())


# d3-celestial gives some traditional names to several stars (Markab to α Peg and κ1 Pup, Tarazed to γ and η Aql),
# so finder charts and star-hops could name the wrong one. A name the IAU Working Group on Star Names has adopted
# stays only on the star the WGSN gives it to; a name it hasn't stays where it is unless several stars share it.
# A star that loses its name falls back to its Bayer or Flamsteed label.
wgsn = defaultdict(set)  # name -> the HIP numbers the WGSN gives it to
for line in open(HERE / 'wgsn.tsv', encoding='utf-8'):
    if line.strip() and not line.startswith('#'):
        hip, nm = line.split('\t')[:2]
        wgsn[name_key(nm)].add(hip)
shared = Counter(name_key(n['name']) for n in names.values() if n.get('name'))


def proper_name(hip, n):
    nm = n.get('name') or ''
    k = name_key(nm)
    if not nm or (k in wgsn and hip not in wgsn[k]) or (k not in wgsn and shared[k] > 1):
        return ''
    return nm


rows = []
for f in stars:
    p = f['properties']
    lon, lat = f['geometry']['coordinates']
    bv = p.get('bv')
    try:
        bv = r(bv)
    except (TypeError, ValueError):
        bv = None
    rows.append((float(p['mag']), f['id'], r(ra_of(lon)), r(lat), bv))
rows.sort()
flat, idx_of_hip, labels = [], {}, {}
for i, (mag, hip, ra, dec, bv) in enumerate(rows):
    flat += [ra, dec, r(mag), bv if bv is not None else 0.6]
    idx_of_hip[str(hip)] = i
    n = names.get(str(hip))
    if not n:
        continue
    proper = proper_name(str(hip), n)
    bayer = n.get('bayer') or ''
    if bayer.startswith('undefined'):  # d3-celestial lost one Greek letter: HIP 20535 (43 Eri) is upsilon-3 Eridani
        bayer = 'υ' + bayer[len('undefined'):]
    flam = n.get('flam') or ''
    con = n.get('c') or ''
    if hip == 78727 and not bayer:  # d3-celestial gives xi Scorpii only "Grafias", which it also gives zeta-2 Sco, and no letter or constellation
        bayer, con = 'ξ', 'Sco'
    lab = (bayer or flam) + (' ' + con if con else '') if (bayer or flam) else ''
    if proper or (lab and (n.get('name') or (bayer and mag <= 4.5) or (flam and mag <= 4.0))):
        labels[i] = [proper, lab, con]
dump('stars.json', {'s': flat, 'n': labels})

# ---------- famous double stars, found by designation ----------
def find(bayer=None, flam=None, con=None, proper=None):
    for hip, n in names.items():
        if con and n.get('c') != con:
            continue
        if proper and n.get('name') == proper:
            return hip
        if bayer and n.get('bayer') == bayer:
            return hip
        if flam and n.get('flam') == flam:
            return hip
    return None

# Separations, position angles (degrees from north through east) and magnitudes are the latest measures in the
# Washington Double Star Catalog's summary (USNO, wdsweb_summ2.txt, fetched November 2026), pair id in each row's comment.
# The colours and notes were written for Starhop.
DOUBLES = [
    # key, name, lookup, separation ("), position angle, mags, note
    ('albireo', 'Albireo', dict(bayer='β1', con='Cyg'), 34.3, 54, '3.2 + 4.7', 'The showpiece double: a gold star and a blue one side by side. Splits at the lowest power.'),  # STFA 43AB, 2025
    ('mizar', 'Mizar and Alcor', dict(bayer='ζ', con='UMa'), 14.4, 153, '2.2 + 3.9', 'Alcor sits beside Mizar to the naked eye; the telescope splits Mizar itself into two white stars.'),  # STF1744AB, 2026
    ('epslyr', 'Epsilon Lyrae', dict(bayer='ε1', con='Lyr'), 209.4, 172, '4.7 + 4.6', 'The Double Double: a wide pair at low power, and each of its stars is itself a close pair.'),  # STFA 37AB,CD, 2021
    # STF 205A,BC: the WDS's latest measure (2025) is 8.3", far off the pair's slow closing from 10.3" in 1830 to 9.6" in
    # 1987, so this is the 1987 measure (9.6" at 63°, as the Bright Star Catalogue's page at alcyone.de gives it).
    ('almach', 'Almach', dict(bayer='γ1', con='And'), 9.6, 63, '2.3 + 5.0', 'An orange star with a small blue companion, like a fainter Albireo.'),
    ('castor', 'Castor', dict(bayer='α', con='Gem'), 5.7, 49, '1.9 + 3.0', 'Two bright white stars close together; more power shows a clean gap between them.'),  # STF1110AB, 2026
    ('corcaroli', 'Cor Caroli', dict(bayer='α2', con='CVn'), 19.2, 229, '2.9 + 5.5', 'An easy pair, white with a faintly tinted companion.'),  # STF1692AB, 2023
    ('polaris', 'Polaris', dict(bayer='α', con='UMi'), 18.4, 236, '2.0 + 9.1', 'The North Star has a faint companion close by; a nice test for a small telescope.'),  # STF 93AB, 2016
    ('rigel', 'Rigel', dict(bayer='β', con='Ori'), 9.4, 204, '0.3 + 6.8', 'A tiny companion almost lost in Rigel’s glare; wait for steady air.'),  # STF 668A,BC, 2023
    ('mesarthim', 'Mesarthim', dict(bayer='γ1', con='Ari'), 7.2, 359, '4.5 + 4.6', 'Two matched white stars, like a pair of headlights.'),  # STF 180AB, 2025
    ('izar', 'Izar', dict(bayer='ε', con='Boo'), 2.9, 345, '2.6 + 4.8', 'A close orange and blue-green pair; needs steady air and high power.'),  # STF1877AB, 2025
    ('61cyg', '61 Cygni', dict(flam='61', con='Cyg'), 32.0, 154, '5.4 + 6.1', 'Two orange dwarfs, among the nearest stars to the Sun.'),  # STF2758AB, 2025
    ('algieba', 'Algieba', dict(bayer='γ1', con='Leo'), 4.8, 127, '2.4 + 3.6', 'A close pair of golden stars.'),  # STF1424AB, 2026
    ('acrux', 'Acrux', dict(bayer='α1', con='Cru'), 3.5, 111, '1.3 + 1.6', 'The brightest star of the Southern Cross splits into two blue-white stars.'),  # DUN 252AB, 2024
]
# Each of Epsilon Lyrae's stars is a close pair: STF2382AB 2.1" (5.15 + 6.10, 2025) and STF2383CD 2.4" (5.25 + 5.38, 2025).
INNER = {'epslyr': [2.1, 2.4]}
doubles = []
for key, nm, look, sep, pa, mags, note in DOUBLES:
    hip = find(**look)
    if hip is None:
        # Some catalogs list the pair under the unnumbered letter.
        l2 = dict(look)
        if 'bayer' in l2:
            l2['bayer'] = l2['bayer'].rstrip('12')
        hip = find(**l2)
    i = idx_of_hip.get(str(hip)) if hip else None
    if i is None:
        sys.exit(f'double {nm}: star not found ({look})')
    ra, dec = flat[i * 4], flat[i * 4 + 1]
    doubles.append({'id': key, 'name': nm, 'type': 'ds', 'ra': ra, 'dec': dec, 'mag': flat[i * 4 + 2], 'sep': sep, 'pa': pa, 'mags': mags, 'note': note, 'star': i})
    if key in INNER:
        doubles[-1]['inner'] = INNER[key]
    print(f'  double {nm}: HIP {hip} mag {flat[i*4+2]}')

# ---------- constellations ----------
cons = json.load(open(D / 'constellations.json'))['features']
lines = {f['id']: f['geometry']['coordinates'] for f in json.load(open(D / 'constellations.lines.json'))['features']}
out = []
for f in cons:
    p = f['properties']
    lon, lat = f['geometry']['coordinates']
    ls = [[[r(ra_of(a)), r(b)] for a, b in seg] for seg in lines.get(f['id'], [])]
    out.append({'a': p['desig'], 'n': p['name'], 'g': p.get('gen', ''), 'rk': int(p.get('rank', 3)), 'l': [r(ra_of(lon)), r(lat)], 'ls': ls})
dump('constellations.json', out)

# ---------- deep sky ----------
TYPE = {'gc': 'Globular cluster', 'oc': 'Open cluster', 's': 'Spiral galaxy', 's0': 'Lenticular galaxy', 'sd': 'Dwarf galaxy',
        'e': 'Elliptical galaxy', 'i': 'Irregular galaxy', 'sfr': 'Nebula', 'en': 'Nebula', 'rn': 'Reflection nebula', 'bn': 'Nebula',
        'pn': 'Planetary nebula', 'snr': 'Supernova remnant', 'pos': 'Star field'}
KIND = {'gc': 'cluster', 'oc': 'cluster', 's': 'galaxy', 's0': 'galaxy', 'sd': 'galaxy', 'e': 'galaxy', 'i': 'galaxy',
        'sfr': 'nebula', 'en': 'nebula', 'rn': 'nebula', 'bn': 'nebula', 'pn': 'nebula', 'snr': 'nebula', 'pos': 'cluster'}
POS = {'M24': 'Star field', 'M73': 'Asterism'}
# Names that read better than d3-celestial's: 'Andromeda' alone reads as the constellation, 'Cetus A' is a radio
# source's name, and M94 shared 'Cat's Eye' with NGC 6543. An empty name shows the catalogue number.
NAMES = {'M31': 'Andromeda Galaxy', 'M33': 'Triangulum Galaxy', 'M24': 'Sagittarius Star Cloud', 'M64': 'Black Eye Galaxy',
         'M44': 'Beehive Cluster', 'M51': 'Whirlpool Galaxy', 'M101': 'Pinwheel Galaxy', 'M104': 'Sombrero Galaxy',
         'M102': 'Spindle Galaxy', 'M73': '', 'M77': '', 'M94': ''}

def dims(s):
    try:
        parts = [float(x) for x in str(s).replace('×', 'x').split('x') if x.strip()]
    except ValueError:
        return [0, 0]
    if not parts:
        return [0, 0]
    return [r(parts[0], 1), r(parts[1] if len(parts) > 1 else parts[0], 1)]

dso = []
for f in json.load(open(D / 'messier.json'))['features']:
    p = f['properties']
    lon, lat = f['geometry']['coordinates']
    t = p['type']
    tn = TYPE.get(t, 'Deep-sky object')
    common = (p.get('alt') or '').replace('´', '’')
    if f['id'] in POS:
        tn = POS[f['id']]
    common = NAMES.get(f['id'], common)
    mag = p.get('mag')
    mag = r(mag, 1) if mag not in (None, '', 999) and float(mag) < 90 else None
    dso.append({'id': f['id'], 'cat': (p.get('desig') or '').replace(' ', ' '), 'name': common, 'type': tn, 'kind': KIND.get(t, 'cluster'),
                'mag': mag, 'dim': dims(p.get('dim')), 'ra': r(ra_of(lon), 3), 'dec': r(lat, 3)})

# Visual magnitudes and sizes (arcminutes) of all 110 Messier objects from the SEDS Messier Catalog's data table,
# http://www.messier.seds.org/data.html (columns B and D, page last modified April 26, 2013). d3-celestial's own values
# are off for several showpieces: photographic magnitudes for planetary nebulae (M97 11.2 for 9.9) and the whole
# glow for the Omega Nebula (46' x 37' for 11'). Positions and types stay d3-celestial's.
SEDS = {
    'M1': (8.4, '6x4'), 'M2': (6.5, '12.9'), 'M3': (6.2, '16.2'), 'M4': (5.6, '26.3'), 'M5': (5.6, '17.4'),
    'M6': (4.2, '25.0'), 'M7': (3.3, '80.0'), 'M8': (4.6, '90x40'), 'M9': (7.7, '9.3'), 'M10': (6.6, '15.1'),
    'M11': (5.8, '14.0'), 'M12': (6.7, '14.5'), 'M13': (5.8, '16.6'), 'M14': (7.6, '11.7'), 'M15': (6.2, '12.3'),
    'M16': (6.4, '7.0'), 'M17': (7.0, '11.0'), 'M18': (7.5, '9.0'), 'M19': (6.8, '13.5'), 'M20': (6.3, '28.0'),
    'M21': (6.5, '13.0'), 'M22': (5.1, '24.0'), 'M23': (5.5, '27.0'), 'M24': (2.5, '90'), 'M25': (4.6, '32.0'),
    'M26': (8.0, '15.0'), 'M27': (7.4, '8.0x5.7'), 'M28': (6.8, '11.2'), 'M29': (7.1, '7.0'), 'M30': (7.2, '11.0'),
    'M31': (3.4, '178x63'), 'M32': (8.1, '8x6'), 'M33': (5.7, '73x45'), 'M34': (5.5, '35.0'), 'M35': (5.3, '28.0'),
    'M36': (6.3, '12.0'), 'M37': (6.2, '24.0'), 'M38': (7.4, '21.0'), 'M39': (4.6, '32.0'), 'M40': (8.4, '0.8'),
    'M41': (4.6, '38.0'), 'M42': (4.0, '85x60'), 'M43': (9.0, '20x15'), 'M44': (3.7, '95.0'), 'M45': (1.6, '110.0'),
    'M46': (6.0, '27.0'), 'M47': (4.4, '30.0'), 'M48': (5.5, '54.0'), 'M49': (8.4, '9x7.5'), 'M50': (6.3, '16.0'),
    'M51': (8.4, '11x7'), 'M52': (7.3, '13.0'), 'M53': (7.6, '12.6'), 'M54': (7.6, '9.1'), 'M55': (6.3, '19.0'),
    'M56': (8.3, '7.1'), 'M57': (8.8, '1.4x1.0'), 'M58': (9.7, '5.5x4.5'), 'M59': (9.6, '5x3.5'),
    'M60': (8.8, '7x6'), 'M61': (9.7, '6x5.5'), 'M62': (6.5, '14.1'), 'M63': (8.6, '10x6'), 'M64': (8.5, '9.3x5.4'),
    'M65': (9.3, '8x1.5'), 'M66': (8.9, '8x2.5'), 'M67': (6.1, '30.0'), 'M68': (7.8, '12.0'), 'M69': (7.6, '7.1'),
    'M70': (7.9, '7.8'), 'M71': (8.2, '7.2'), 'M72': (9.3, '5.9'), 'M73': (9.0, '2.8'), 'M74': (9.4, '10.2x9.5'),
    'M75': (8.5, '6.0'), 'M76': (10.1, '2.7x1.8'), 'M77': (8.9, '7x6'), 'M78': (8.3, '8x6'), 'M79': (7.7, '8.7'),
    'M80': (7.3, '8.9'), 'M81': (6.9, '21x10'), 'M82': (8.4, '9x4'), 'M83': (7.6, '11x10'), 'M84': (9.1, '5.0'),
    'M85': (9.1, '7.1x5.2'), 'M86': (8.9, '7.5x5.5'), 'M87': (8.6, '7.0'), 'M88': (9.6, '7x4'), 'M89': (9.8, '4.0'),
    'M90': (9.5, '9.5x4.5'), 'M91': (10.2, '5.4x4.4'), 'M92': (6.4, '11.2'), 'M93': (6.0, '22.0'),
    'M94': (8.2, '7x3'), 'M95': (9.7, '4.4x3.3'), 'M96': (9.2, '6x4'), 'M97': (9.9, '3.4x3.3'),
    'M98': (10.1, '9.5x3.2'), 'M99': (9.9, '5.4x4.8'), 'M100': (9.3, '7x6'), 'M101': (7.9, '22.0'),
    'M102': (9.9, '5.2x2.3'), 'M103': (7.4, '6.0'), 'M104': (8.0, '9x4'), 'M105': (9.3, '4.8x5.4'),
    'M106': (8.4, '19x8'), 'M107': (7.9, '10.0'), 'M108': (10.0, '8x1'), 'M109': (9.8, '7x4'),
    'M110': (8.5, '17x10')
}
for d in dso:
    d['mag'], d['dim'] = SEDS[d['id']][0], dims(SEDS[d['id']][1])
assert len(SEDS) == 110 and {d['id'] for d in dso} == set(SEDS)

# M40 is a double star, Winnecke 4 (WDS 12222+5805 WNC 4: 53.2" apart at 76°, magnitudes 9.74 and 10.18 at the latest
# measure, 2017), so it goes with the doubles, keeping its Messier number. Its stars are fainter than the star catalog
# goes, so it has no catalog star of its own.
m40 = next(d for d in dso if d['id'] == 'M40')
dso.remove(m40)
doubles.append({'id': 'M40', 'name': 'Winnecke 4', 'cat': 'WNC 4', 'type': 'ds', 'ra': r(m40['ra']), 'dec': r(m40['dec']), 'mag': 9.7,
                'sep': 53.2, 'pa': 76, 'mags': '9.7 + 10.2', 'star': None,
                'note': 'A faint pair Messier logged while looking for a nebula Hevelius had reported.'})

# Bright non-Messier showpieces, with their usual names.
EXTRA = {
    'NGC 869': ('Double Cluster (h Persei)', 'C14'), 'NGC 884': ('Double Cluster (χ Persei)', 'C14'),
    'NGC 5139': ('Omega Centauri', 'C80'), 'NGC 104': ('47 Tucanae', 'C106'), 'NGC 3372': ('Carina Nebula', 'C92'),
    'NGC 2264': ('Christmas Tree Cluster', 'C?'), 'NGC 2244': ('Rosette Cluster', 'C50'), 'PGC 17223': ('Large Magellanic Cloud', ''),
    'NGC 292': ('Small Magellanic Cloud', ''), 'IC 2602': ('Southern Pleiades', 'C102'), 'NGC 6231': ('Northern Jewel Box', 'C76'),
    'NGC 2362': ('Tau Canis Majoris Cluster', 'C64'), 'NGC 2451': ('', ''), 'NGC 2516': ('Southern Beehive', 'C96'),
    'NGC 3532': ('Wishing Well Cluster', 'C91'), 'Cr 399': ('Coathanger', ''), 'Cr 256': ('Coma Star Cluster', ''),
    'Cr 39': ('Alpha Persei Cluster', ''), 'IC 2391': ('Omicron Velorum Cluster', 'C85'),
}
# The sky map's label for a name too long for it
SHORT = {'PGC 17223': 'LMC', 'NGC 292': 'SMC'}
seen = {d['cat'] for d in dso}
for f in json.load(open(D / 'dsos.bright.json'))['features']:
    k = f['id']
    if k not in EXTRA:
        continue
    p = f['properties']
    lon, lat = f['geometry']['coordinates']
    nm, _ = EXTRA[k]
    dso.append({'id': k, 'cat': k, 'name': nm or k, 'type': TYPE.get(p['type'], 'Deep-sky object'), 'kind': KIND.get(p['type'], 'cluster'),
                'mag': r(p['mag'], 1), 'dim': dims(p.get('dim')), 'ra': r(ra_of(lon), 3), 'dec': r(lat, 3)})
    if k in SHORT:
        dso[-1]['short'] = SHORT[k]

# A few favourite NGC targets from the fuller catalog.
MORE = {'NGC 6543': "Cat's Eye Nebula", 'NGC 7662': 'Blue Snowball', 'NGC 7009': 'Saturn Nebula', 'NGC 457': 'Owl Cluster',
        'NGC 253': 'Sculptor Galaxy', 'NGC 2392': 'Eskimo Nebula', 'NGC 3242': 'Ghost of Jupiter', 'NGC 4565': 'Needle Galaxy',
        'NGC 7293': 'Helix Nebula', 'NGC 6826': 'Blinking Planetary', 'NGC 7000': 'North America Nebula', 'NGC 752': '',
        'NGC 663': '', 'NGC 6633': '', 'NGC 2403': '', 'NGC 5128': 'Centaurus A', 'NGC 55': '', 'NGC 3628': 'Hamburger Galaxy'}
pool = json.load(open(D / 'dsos.14.json'))['features']
for f in pool:
    k = (f['properties'].get('desig') or f['id']).replace(' ', ' ')
    if k in MORE and k not in seen and k not in {d['cat'] for d in dso}:
        p = f['properties']
        lon, lat = f['geometry']['coordinates']
        try:
            mag = r(p['mag'], 1)
            if mag > 90:
                mag = None
        except (TypeError, ValueError):
            mag = None
        dso.append({'id': k, 'cat': k, 'name': MORE[k] or k, 'type': TYPE.get(p['type'], 'Deep-sky object'), 'kind': KIND.get(p['type'], 'cluster'),
                    'mag': mag, 'dim': dims(p.get('dim')), 'ra': r(ra_of(lon), 3), 'dec': r(lat, 3)})
# The Christmas Tree Cluster is a cluster with faint nebula around it, so its sketch should show stars, not a glow.
for d in dso:
    if d['id'] == 'NGC 2264':
        d['type'], d['kind'] = 'Open cluster', 'cluster'
    d['name'] = d['name'].replace("'", '’')
missing = set(MORE) - {d['cat'] for d in dso}
print('  NGC extras not found:', sorted(missing))
dump('dso.json', {'dso': dso, 'doubles': doubles})
print(f'  {len(dso)} deep-sky objects, {len(doubles)} doubles')

# ---------- Milky Way: sample the outlines onto a grid, one soft glow per cell ----------
mw = json.load(open(D / 'milkyway.json'))['features']

def inside(rings, x, y):
    c = False
    for ring in rings:
        n = len(ring)
        for i in range(n):
            x1, y1 = ring[i]; x2, y2 = ring[i - 1]
            if abs(x1 - x2) > 180:
                continue  # an edge jumping across the ±180° seam
            if (y1 > y) != (y2 > y):
                xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
                if x < xi:
                    c = not c
    return c

levels = [f['geometry']['coordinates'] for f in mw]
bbox = []
for rings in levels:
    ys = [p[1] for ring in rings for p in ring]
    bbox.append((min(ys), max(ys)))
step = 1.6
cells = []
dec = -90 + step / 2
while dec < 90:
    n_ra = max(1, int(round(360 * math.cos(math.radians(dec)) / step)))
    for k in range(n_ra):
        ra = (k + 0.5) * 360 / n_ra
        lon = ra - 360 if ra > 180 else ra
        lv = 0
        for li, rings in enumerate(levels):
            if bbox[li][0] <= dec <= bbox[li][1] and inside(rings, lon, dec):
                lv += 1
        if lv:
            cells += [r(ra, 1), r(dec, 1), lv]
    dec += step
dump('milkyway.json', {'step': step, 'c': cells})
print(f'  {len(cells) // 3} Milky Way cells')

# ---------- cities ----------
cities = json.load(open(CITIES))
tzs = sorted({c['timezone'] for c in cities if c.get('timezone')})
tzi = {t: i for i, t in enumerate(tzs)}
rows = []
for c in sorted(cities, key=lambda c: -(c.get('pop') or 0)):
    if not c.get('timezone'):
        continue
    prov = c.get('state_ansi') or c.get('province') or ''
    rows.append([c['city'], prov, c.get('iso2') or '', r(c['lat']), r(c['lng']), int(c.get('pop') or 0), tzi[c['timezone']]])
dump('cities.json', {'tz': tzs, 'c': rows})
# Default place per time zone: its most populous city.
best = {}
for row in rows:
    t = tzs[row[6]]
    if t not in best:
        best[t] = row
dump('tzcity.json', {t: [v[0], v[1], v[2], v[3], v[4]] for t, v in best.items()})
