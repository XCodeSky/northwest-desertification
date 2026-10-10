"""把 desertification_model_v1 的 1 km 年度产品打包为网站数据。

用法（在 website 目录）：
    python tools/build_data.py --model ..\\..\\desertification_model_v1

依赖：numpy、pillow、scipy。
输出：
    assets/data/geo.js      经纬度边界（县界→地市/省界自动合并）、标注
    assets/data/core.js     年份信息、县区逐年等级面积/置信度/90% 区间、模型指标
    assets/data/region.js   防护措施、案例来源、县区气象/归因/情景（地区预测页）
    assets/tiles/*.js       逐年 1 km 等级图、置信度图（PNG，按需加载）及县区编号图
"""
import argparse, base64, collections, csv, io, json, math, os, pathlib, time
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = pathlib.Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument('--model', default=str(HERE.parent.parent.parent / 'desertification_model_v1'))
args = ap.parse_args()
SRC = pathlib.Path(args.model)
RAS = SRC / 'outputs/model_1km_full/annual_2000_2050/rasters'
OUT = HERE.parent / 'assets'
(OUT / 'data').mkdir(parents=True, exist_ok=True); (OUT / 'tiles').mkdir(parents=True, exist_ok=True)
YEARS = list(range(2000, 2051))
ANCHORS = list(range(2000, 2051, 5))
COL = ['#D3DEC8', '#F0DC9C', '#E2AE52', '#C4702F', '#7E3420']
CONF_COL = ['#F1E3BE', '#CFD3BC', '#97B4B6', '#5A8794', '#1A3441']
PROV_SHORT = {'新疆维吾尔自治区': '新疆', '甘肃省': '甘肃', '青海省': '青海', '宁夏回族自治区': '宁夏', '陕西省': '陕西'}
PROVS = ['新疆', '甘肃', '青海', '宁夏', '陕西']
t0 = time.time()
def log(*a): print(f'[{time.time() - t0:6.1f}s]', *a, flush=True)
def rows(p):
    with open(p, encoding='utf-8-sig') as f: return list(csv.DictReader(f))
def js(name, var, obj):
    s = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
    (OUT / name).write_text(f'window.{var}={s};', encoding='utf-8')
    log(name, len(s) // 1024, 'KB')

# ------------------------------------------------------------------ counties
gj = json.load(open(SRC / 'data/raw/boundaries/china_northwest_adm2_zh.geojson', encoding='utf-8'))
meas = rows(SRC / 'outputs/protection_measures/protection_measures_5year.csv')
city_of = {r['adcode']: r['city_prefecture'] for r in meas if r['admin_level'] == '县级'}
city_code = {r['area_name']: r['adcode'] for r in meas if r['admin_level'] == '市级'}
C = []
for f in gj['features']:
    p = f['properties']; g = f['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    ad = str(p['adcode']); cn = city_of[ad]
    C.append({'n': p['name'], 'a': ad, 'p': PROV_SHORT[p['province_name']], 'c': cn,
              'ca': city_code.get(cn, ad), 'polys': polys, 'cen': p.get('centroid') or p['center']})
NC = len(C)
cities = []
for c in C:
    if c['c'] not in [x['n'] for x in cities]:
        cities.append({'n': c['c'], 'a': c['ca'], 'p': c['p'], 'xpcc': c['ca'] == c['a'] and c['c'] == c['n']})
city_idx = {x['n']: i for i, x in enumerate(cities)}
log('counties', NC, 'cities', len(cities))

# ------------------------------------------------------------------ county id raster (1 km)
mask = np.array(Image.open(RAS / 'desertification_2025_1km.tif')) != 255
H, W = mask.shape
X0, Y0, RES = 73.0, 50.0, 0.01
def ring_area(r):
    a = np.asarray(r); return abs(np.sum(a[:, 0] * np.roll(a[:, 1], -1) - np.roll(a[:, 0], -1) * a[:, 1])) / 2
# 县区归属：格网中心点落入县界（与常见 rasterize 规则一致）；研究区内未落入任何县界的边缘格网就近归属
from matplotlib.path import Path
cid = np.full((H, W), 65535, np.int32)
for i, c in enumerate(C):
    for p in c['polys']:
        ring = np.asarray(p[0]); x0, x1 = ring[:, 0].min(), ring[:, 0].max(); y0, y1 = ring[:, 1].min(), ring[:, 1].max()
        j0 = max(0, int((x0 - X0) / RES)); j1 = min(W, int((x1 - X0) / RES) + 2); i0 = max(0, int((Y0 - y1) / RES)); i1 = min(H, int((Y0 - y0) / RES) + 2)
        jj, ii = np.meshgrid(np.arange(j0, j1), np.arange(i0, i1)); pts = np.c_[X0 + RES * (jj.ravel() + .5), Y0 - RES * (ii.ravel() + .5)]
        inside = Path(ring).contains_points(pts)
        for h in p[1:]: inside &= ~Path(np.asarray(h)).contains_points(pts)
        sub = cid[i0:i1, j0:j1].ravel(); sub[inside] = i; cid[i0:i1, j0:j1] = sub.reshape(i1 - i0, j1 - j0)
cid[~mask] = 65535
cid_strict = cid.copy()                       # 县区统计：仅县界内格网（与措施表口径一致）
miss = mask & (cid == 65535)
_, (ii, jj) = ndimage.distance_transform_edt(cid == 65535, return_indices=True)
cid[miss] = cid[ii[miss], jj[miss]]           # 地图悬停、省级与全区汇总：边缘格网就近归属
log('cid raster done; edge cells filled for totals only', int(miss.sum()))
lat = Y0 - RES * (np.arange(H) + .5)
cellA = (6371.0072 * np.radians(RES)) ** 2 * np.cos(np.radians(lat))   # 与模型统计一致：等积球面半径
AREA = np.broadcast_to(cellA[:, None], (H, W))
V = mask.ravel(); WA = AREA.ravel()[V].astype(np.float64)
CIDS = cid_strict.ravel()[V]; IN = CIDS != 65535; CID = np.where(IN, CIDS, NC)   # NC = 未归属县区
PROV_OF = np.array([PROVS.index(c['p']) for c in C] + [0]); PF = PROV_OF[cid.ravel()[V]]
county_area = np.bincount(CID, WA, NC + 1)[:NC]
prov_area_all = np.bincount(PF, WA, 5)

# ------------------------------------------------------------------ tiles & stats
def pal_png(idx, cols):
    img = Image.fromarray(idx.astype(np.uint8), 'P'); pal = []
    for h in cols: pal += [int(h[i:i + 2], 16) for i in (1, 3, 5)]
    img.putpalette(pal + [0, 0, 0] * (256 - len(cols)))
    b = io.BytesIO(); img.save(b, 'PNG', optimize=True, transparency=len(cols)); return b.getvalue()
def tile(name, png):
    (OUT / 'tiles' / name).write_text(f'NW_TILE({json.dumps(name[:-3])},"data:image/png;base64,{base64.b64encode(png).decode()}");')
yidx = {int(r['year']): r for r in rows(SRC / 'outputs/model_1km_full/annual_2000_2050/year_index_2000_2050.csv')}
cstat = np.zeros((NC + 1, len(YEARS), 8), np.float64)   # cls0..4, conf*area, desLo, desHi（最后一行为未归属县区的边缘格网）
pstat = np.zeros((5, len(YEARS), 8), np.float64)
for k, y in enumerate(YEARS):
    cl = np.array(Image.open(RAS / f'desertification_{y}_1km.tif'))
    lo = np.array(Image.open(RAS / f'prediction_lower90_{y}_1km.tif'))
    hi = np.array(Image.open(RAS / f'prediction_upper90_{y}_1km.tif'))
    cf = np.array(Image.open(RAS / f'confidence_{y}_1km.tif'))
    assert ((cl != 255) == mask).all(), y
    v = cl.ravel()[V].astype(np.int64)
    l = lo.ravel()[V]; h = hi.ravel()[V]; cw = WA * np.nan_to_num(cf.ravel()[V])
    for ST, ID, n in ((cstat, CID, NC + 1), (pstat, PF, 5)):
        for c5 in range(5): ST[:, k, c5] = np.bincount(ID[v == c5], WA[v == c5], n)
        ST[:, k, 5] = np.bincount(ID, cw, n)
        ST[:, k, 6] = np.bincount(ID[l > 0], WA[l > 0], n); ST[:, k, 7] = np.bincount(ID[h > 0], WA[h > 0], n)
    tile(f'cls_{y}.js', pal_png(np.where(cl == 255, 5, cl), COL))
    q = np.digitize(np.nan_to_num(cf, nan=0), [.6, .7, .8, .9]); tile(f'conf_{y}.js', pal_png(np.where(cl == 255, 5, q), CONF_COL))
    if k % 10 == 0: log('year', y)
cstat = cstat[:NC]
# county id tile (R = low byte, G = high byte)
rgba = np.zeros((H, W, 4), np.uint8); rgba[..., 0] = cid & 255; rgba[..., 1] = (cid >> 8) & 255; rgba[..., 3] = np.where(mask, 255, 0)
b = io.BytesIO(); Image.fromarray(rgba, 'RGBA').save(b, 'PNG', optimize=True); tile('cid.js', b.getvalue())
# check vs official annual statistics
ast = rows(SRC / 'outputs/model_1km_full/annual_2000_2050/annual_statistics_2000_2050.csv')
for y in (2000, 2025, 2050):
    mine = pstat[:, YEARS.index(y), :5].sum(0); ref = [float(r['area_km2']) for r in ast if int(r['year']) == y]
    log('check', y, [round(a / 1e4, 2) for a in mine], [round(a / 1e4, 2) for a in ref])

# ------------------------------------------------------------------ geometry (lon/lat, edge-cancel outlines)
def rdp(pts, eps):
    pts = np.asarray(pts, float)
    if len(pts) < 4: return pts
    keep = np.zeros(len(pts), bool); keep[0] = keep[-1] = True; st = [(0, len(pts) - 1)]
    while st:
        a, b = st.pop()
        if b <= a + 1: continue
        p, q = pts[a], pts[b]; seg = pts[a + 1:b]; d = q - p; L = math.hypot(*d)
        dist = np.abs(d[0] * (seg[:, 1] - p[1]) - d[1] * (seg[:, 0] - p[0])) / L if L > 0 else np.hypot(*(seg - p).T)
        i = int(np.argmax(dist))
        if dist[i] > eps: keep[a + 1 + i] = True; st += [(a, a + 1 + i), (a + 1 + i, b)]
    return pts[keep]
def enc(pts, closed):
    q = np.round(np.asarray(pts) * 1000).astype(int)
    if closed and len(q) > 1 and (q[0] == q[-1]).all(): q = q[:-1]
    out = [int(q[0, 0]), int(q[0, 1])]
    for a, b in zip(q[1:], q[:-1]):
        dx, dy = int(a[0] - b[0]), int(a[1] - b[1])
        if dx or dy: out += [dx, dy]
    return out
def outlines(members, eps):
    seg = collections.Counter(); ends = collections.defaultdict(list)
    key = lambda p: (round(p[0], 6), round(p[1], 6))
    for i in members:
        for p in C[i]['polys']:
            for r in p:
                for a, b in zip(r, r[1:]):
                    ka, kb = key(a), key(b)
                    if ka != kb: seg[tuple(sorted([ka, kb]))] += 1
    bnd = [s for s, n in seg.items() if n == 1]
    adj = collections.defaultdict(list)
    for a, b in bnd: adj[a].append(b); adj[b].append(a)
    used = set(); lines = []
    for a, b in bnd:
        if (a, b) in used: continue
        line = [a, b]; used.add((a, b)); used.add((b, a)); cur, prev = b, a
        while True:
            nxt = [n for n in adj[cur] if (cur, n) not in used]
            if not nxt: break
            n = nxt[0]; used.add((cur, n)); used.add((n, cur)); line.append(n); prev, cur = cur, n
            if n == line[0]: break
        lines.append(line)
    out = []
    for l in lines:
        s = rdp(l, eps)
        if len(s) >= 2: out.append(enc(s, l[0] == l[-1]))
    return out
geo = {'county': [], 'city': [], 'prov': [], 'nw': None}
for c in C:
    rings = []
    for p in c['polys']:
        s = rdp(p[0], 0.004)
        if len(s) >= 4 or ring_area(p[0]) > 1e-4: rings.append(enc(s, True))
    geo['county'].append({'n': c['n'], 'a': c['a'], 'p': c['p'], 'c': city_idx[c['c']], 'r': rings,
                          'l': [round(c['cen'][0], 3), round(c['cen'][1], 3)], 'A': round(float(county_area[C.index(c)]), 1)})
for j, ct in enumerate(cities):
    mem = [i for i, c in enumerate(C) if c['c'] == ct['n']]
    yy, xx = None, None
    geo['city'].append({'n': ct['n'], 'a': ct['a'], 'p': ct['p'], 'x': ct['xpcc'], 'm': mem, 'o': outlines(mem, 0.003),
                        'A': round(float(county_area[mem].sum()), 1)})
# 省界与研究区外缘：由 1 km 省区栅格（县界 + 边缘就近归属）追踪等值线，与数据边界严格一致
import contourpy
pid = np.full((H, W), -1, np.int8); pid[mask] = PROV_OF[:NC][cid[mask]]
def trace(binary, eps=0.004):
    z = np.pad(binary.astype(float), 1)
    gen = contourpy.contour_generator(z=z, line_type=contourpy.LineType.Separate)
    out = []
    for ln in gen.lines(0.5):
        if len(ln) < 8: continue
        lon = X0 + RES * (ln[:, 0] - 1 + .5); latv = Y0 - RES * (ln[:, 1] - 1 + .5)
        q = rdp(np.c_[lon, latv], eps)
        if len(q) >= 4: out.append(enc(q, True))
    return out
for k, pv in enumerate(PROVS):
    geo['prov'].append({'n': pv, 'r': trace(pid == k), 'A': round(float(prov_area_all[k]), 1)})
geo['nw'] = trace(mask)
# label points: area-weighted centroid of raster cells
ii, jj = np.nonzero(mask); lon_c = X0 + RES * (jj + .5); lat_c = Y0 - RES * (ii + .5); idc = cid[ii, jj]; wa = AREA[ii, jj]
sx = np.bincount(idc, wa * lon_c, NC); sy = np.bincount(idc, wa * lat_c, NC); sw = np.bincount(idc, wa, NC)
for ct in geo['city']:
    m = ct['m']; ct['l'] = [round(float(sx[m].sum() / sw[m].sum()), 3), round(float(sy[m].sum() / sw[m].sum()), 3)]
geo['provLabel'] = {'新疆': [85.5, 41.6], '青海': [96.3, 35.4], '甘肃': [100.4, 39.0], '宁夏': [106.15, 37.3], '陕西': [108.9, 35.3]}
geo['ctxLabel'] = {'内蒙古': [108.0, 42.6], '西藏': [85.0, 32.4], '四川': [103.0, 31.8]}
geo['desertLabel'] = {'塔克拉玛干沙漠': [82.6, 38.9], '古尔班通古特沙漠': [87.6, 45.55], '库姆塔格沙漠': [91.6, 40.0], '柴达木盆地': [94.2, 37.4],
                      '巴丹吉林沙漠': [101.8, 40.4], '腾格里沙漠': [104.0, 38.5], '毛乌素沙地': [108.6, 38.3]}
# context provinces from ECharts China map (outside study area)
def decode_ring(s, off, scale=1024):
    out = []; px_, py_ = off
    for i in range(0, len(s), 2):
        x = ord(s[i]) - 64; y = ord(s[i + 1]) - 64
        x = (x >> 1) ^ (-(x & 1)); y = (y >> 1) ^ (-(y & 1)); x += px_; y += py_; px_, py_ = x, y
        out.append((x / scale, y / scale))
    return out
ec = json.load(open(HERE / 'china_echarts.json', encoding='utf-8')); ctx = []
for f in ec['features']:
    if f['properties']['name'] in ('新疆', '青海', '甘肃', '宁夏', '陕西'): continue
    g = f['geometry']; eo = g['encodeOffsets']
    polys = [[decode_ring(r, eo[i]) for i, r in enumerate(g['coordinates'])]] if g['type'] == 'Polygon' else \
            [[decode_ring(r, eo[pi][i]) for i, r in enumerate(p)] for pi, p in enumerate(g['coordinates'])]
    for p in polys:
        s = rdp(p[0], 0.02)
        if len(s) >= 4: ctx.append(enc(s, True))
geo['context'] = ctx
geo['grid'] = {'w': W, 'h': H, 'x0': X0, 'y0': Y0, 'res': RES}
js('data/geo.js', 'NW_GEO', geo)

# ------------------------------------------------------------------ calibrated KPIs（以措施表为口径）
# 栅格逐年计算风险指数、荒漠化占比、重度以上占比、置信度；在五年锚点与措施表的差值按年份线性插值后加回，
# 使锚点年份与措施表完全一致、其余年份保留栅格年度变化。
def kpi_raster(st, area):
    ri = (st[..., :5] * np.arange(5)).sum(-1) / area[:, None] / 4
    ds = (area[:, None] - st[..., 0]) / area[:, None] * 100
    ss = (st[..., 3] + st[..., 4]) / area[:, None] * 100
    cf = st[..., 5] / area[:, None] * 100
    return np.stack([ri, ds, ss, cf], -1)
def calibrate(raw, table):  # raw [n,Y,4]; table: dict i -> {year: [ri,ds,ss,cf]}
    out = raw.copy(); yrs = np.array(YEARS)
    for i, t in table.items():
        ay = sorted(t); off = np.array([np.array(t[y]) - raw[i, YEARS.index(y)] for y in ay])
        for k in range(4): out[i, :, k] = raw[i, :, k] + np.interp(yrs, ay, off[:, k])
    out[..., 0] = out[..., 0].clip(0, 1); out[..., 1:] = out[..., 1:].clip(0, 100)
    return out
city_members = [[i for i, c in enumerate(C) if c['c'] == ct['n']] for ct in cities]
city_area = np.array([county_area[m].sum() for m in city_members])
city_stat = np.stack([cstat[m].sum(0) for m in city_members])
prov_members = [[i for i, c in enumerate(C) if c['p'] == pv] for pv in PROVS]
prov_area = prov_area_all
prov_stat = pstat
def tab_of(level):
    t = collections.defaultdict(dict)
    for r in meas:
        if r['admin_level'] != level: continue
        t[r['adcode']][int(r['year'])] = [float(r['risk_index_0_1']), float(r['desertified_share_percent']),
                                          float(r['severe_extreme_share_percent']), float(r['confidence_percent'])]
    return t
tc, tt = tab_of('县级'), tab_of('市级')
kc = calibrate(kpi_raster(cstat, county_area), {i: tc[c['a']] for i, c in enumerate(C)})
kt = calibrate(kpi_raster(city_stat, city_area), {j: (tt.get(ct['a']) or tc[ct['a']]) for j, ct in enumerate(cities)})
kp = kpi_raster(prov_stat, prov_area)
raw_c = kpi_raster(cstat, county_area)
log('calibration offsets |ri| max', round(float(np.abs(kc[..., 0] - raw_c[..., 0]).max()), 4),
    '|des%| max', round(float(np.abs(kc[..., 1] - raw_c[..., 1]).max()), 2))
for nm in ('民勤县', '榆阳区'):
    i = [k for k, c in enumerate(C) if c['n'] == nm][0]; log(nm, '2025 kpi', np.round(kc[i, 25], 3).tolist(), 'table', tc[C[i]['a']][2025])

# ------------------------------------------------------------------ core statistics
vm = json.load(open(SRC / 'outputs/model_1km_full/temporal_validation_metrics.json'))
fi = rows(SRC / 'outputs/model_1km_full/feature_importance_1km.csv')
tr = json.load(open(SRC / 'outputs/model_1km_full/training_report.json'))
core = {
    'years': YEARS, 'anchors': ANCHORS,
    'status': {y: yidx[y]['status'] for y in YEARS},
    'statusZh': {y: yidx[y]['status_zh'] for y in YEARS},
    'meanConf': {y: round(float(yidx[y]['mean_confidence']) * 100, 2) for y in YEARS},
    'county': np.round(cstat[:, :, [0, 1, 2, 3, 4]], 1).tolist(),
    'prov': np.round(pstat[:, :, :5], 1).tolist(), 'provArea': np.round(prov_area_all, 1).tolist(),
    'provConf': np.round(pstat[:, :, 5] / prov_area_all[:, None] * 100, 2).tolist(),
    'provLo': np.round(pstat[:, :, 6], 1).tolist(), 'provHi': np.round(pstat[:, :, 7], 1).tolist(), 'provs': PROVS,
    'countyConf': np.round(cstat[:, :, 5] / county_area[:, None] * 100, 1).tolist(),
    'countyLo': np.round(cstat[:, :, 6], 1).tolist(), 'countyHi': np.round(cstat[:, :, 7], 1).tolist(),
    'kpiCounty': np.round(kc, 4).tolist(), 'kpiCity': np.round(kt, 4).tolist(), 'kpiProv': np.round(kp, 4).tolist(),
    'kpiNote': '县区与地市的风险指数、荒漠化占比、重度以上占比、置信度以防护措施表（1 km 面积加权行政区统计）为口径：五年锚点年份取表中数值，其余年份由 1 km 栅格逐年计算，并按相邻锚点差值线性校正；省级由 1 km 栅格直接汇总。',
    'model': {'name': 'LightGBM + CA-Markov', 'climate': 'IITM-ESM SSP1-2.6 / SSP2-4.5 / SSP5-8.5', 'grid': '0.01°（名义约 1 km）',
              'val': {k: vm[k] for k in ('accuracy', 'balanced_accuracy', 'macro_f1', 'cohen_kappa')},
              'trainSamples': tr['training_samples'], 'valSamples': vm['validation_samples'],
              'meanConf2030': tr['uncertainty']['mean_allocated_class_confidence'],
              'features': [[r['feature'], float(r['importance_gain'])] for r in fi]},
}
js('data/core.js', 'NW_CORE', core)

# ------------------------------------------------------------------ region page data
src = rows(SRC / 'outputs/protection_measures/protection_sources.csv')
CASE_SRC = {'S16', 'S17', 'S18', 'S19'}
texts = []; tix = {}
def T(s):
    if s not in tix: tix[s] = len(texts); texts.append(s)
    return tix[s]
M = collections.defaultdict(dict)
for r in meas:
    y = int(r['year']); hist = r['phase'] == '历史防护措施'; sids = r['source_ids'].split(',')
    rec = {'lv': r['priority_level'], 'rn': int(r['priority_rank_northwest_level']), 'rp': int(r['priority_rank_province_level']),
           'sc': round(float(r['priority_score']), 2), 'sv': r['severity'], 'rt': r['risk_type'], 'ri': round(float(r['risk_index_0_1']), 4),
           'ch': round(float(r['five_year_change']), 4), 'ds': round(float(r['desertified_share_percent']), 2),
           'ss': round(float(r['severe_extreme_share_percent']), 2), 'cf': round(float(r['confidence_percent']), 1)}
    if hist:
        rec['cs'] = [s for s in sids if s in CASE_SRC]           # 仅保留实际案例来源
    else:
        rec['mt'] = r['measure_type']; rec['tx'] = T(r['specific_measures']); rec['src'] = sids
    M[r['adcode']][y] = rec
nw_rank_total = collections.Counter(int(r['year']) for r in meas if r['admin_level'] == '县级')
prov_rank_total = collections.Counter((int(r['year']), r['province']) for r in meas if r['admin_level'] == '县级')
met = rows(SRC / 'outputs/county_dashboard_annual/county_annual_meteorology.csv')
att = rows(SRC / 'outputs/county_dashboard_annual/county_annual_risk_attribution_wide.csv')
FACT = ['降水亏缺', '地下水压力', '大风日数增加', '植被退化与邻域扩散', '降水改善', '植被恢复', '风险回落与治理代理', '低风险邻域稳定']
ai = {c['a']: i for i, c in enumerate(C)}
metA = np.zeros((NC, len(YEARS), 5)); attA = np.zeros((NC, len(YEARS), 8))
for r in met:
    i = ai[r['adcode']]; k = YEARS.index(int(r['year']))
    metA[i, k] = [float(r['annual_precipitation_mm']), float(r['mean_temperature_c']), float(r['groundwater_level_change_m_proxy']),
                  float(r['gale_days_proxy']), float(r['ndvi_proxy'])]
for r in att:
    i = ai[r['adcode']]; k = YEARS.index(int(r['year'])); attA[i, k] = [float(r[f]) for f in FACT]
SC = ['SSP1-2.6', 'SSP2-4.5', 'SSP5-8.5']
# 三情景的逐年 1 km 结果与情景曲线由 tools/build_scenarios.py 生成（assets/data/scen.js）
region = {
    'measures': M, 'texts': texts, 'sources': {r['source_id']: {'t': r['title'], 'p': r['period'], 'k': r['source_type'], 'u': r['url']} for r in src},
    'caseSources': sorted(CASE_SRC), 'rankTotal': {'nw': dict(nw_rank_total), 'prov': {f'{y}|{PROV_SHORT[p]}': n for (y, p), n in prov_rank_total.items()}},
    'factors': FACT, 'factorDir': [1, 1, 1, 1, -1, -1, -1, -1], 'scenarios': SC,
    'met': np.round(metA, 3).tolist(), 'att': np.round(attA, 2).tolist(),
    'notes': {
        'met': '降水与气温：CMIP6 IITM-ESM 县区均值（随所选情景切换），2025/2030/2040/2050 为锚点，其余年份插值，2000–2024 年限幅回推。',
        'proxy': '地下水位变化、大风日数为参数化代理指标，不是监测井或气象站实测。',
        'att': '驱动归因为可复算的代理归因（每年各因子绝对贡献合计 100%），不是因果识别。',
    },
}
js('data/region.js', 'NW_REGION', region)
log('done')
