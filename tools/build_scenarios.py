"""把 SSP1-2.6 / SSP5-8.5 多情景 1 km 逐年预测打包为网站数据（在 build_data.py、build_calibrated.py 之后运行）。

用法（在 website 目录）：
    python tools/build_scenarios.py --model ..\\..\\desertification_model_v1

依赖：numpy、pillow、scipy、matplotlib。
输入：
    outputs/model_1km_full/annual_2000_2050/rasters/                    SSP2-4.5（含 2000–2025 共同历史）
    outputs/model_1km_full/scenarios/ssp126_annual_2000_2050/rasters_2026_2050/
    outputs/model_1km_full/scenarios/ssp585_annual_2000_2050/rasters_2026_2050/
    outputs/model_1km_full/scenarios/comparison_2026_2050/              三情景汇总与两两差异
    data/processed/cmip6_ssp{126,245,585}_climate.npz                    0.25° 降水、气温锚点场
    assets/data/core.js、calib.js、region.js                             （由前两个脚本生成）
输出：
    assets/tiles/cls_ssp126_YYYY.js 等                                   2026–2050 逐年等级图与置信度图
    assets/data/scen.js（NW_SCN）                                       情景统计、KPI、官方口径面积与综合风险、情景曲线
"""
import argparse, base64, csv, io, json, math, pathlib, time
import numpy as np
from PIL import Image
from scipy import ndimage
from matplotlib.path import Path

HERE = pathlib.Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument('--model', default=str(HERE.parent.parent.parent / 'desertification_model_v1'))
ap.add_argument('--cache', default='', help='调试用：栅格统计缓存 .npz（存在则跳过读栅格与写瓦片）')
args = ap.parse_args()
SRC = pathlib.Path(args.model)
OUT = HERE.parent / 'assets'
MK = SRC / 'outputs/model_1km_full'
RAS = {'ssp245': MK / 'annual_2000_2050/rasters',
       'ssp126': MK / 'scenarios/ssp126_annual_2000_2050/rasters_2026_2050',
       'ssp585': MK / 'scenarios/ssp585_annual_2000_2050/rasters_2026_2050'}
CODES = ['ssp126', 'ssp245', 'ssp585']; NAMES = ['SSP1-2.6', 'SSP2-4.5', 'SSP5-8.5']; NEW = ['ssp126', 'ssp585']
YEARS = list(range(2000, 2051)); FY = list(range(2026, 2051)); NF = len(FY); BASE = 2025
COL = ['#D3DEC8', '#F0DC9C', '#E2AE52', '#C4702F', '#7E3420']
CONF_COL = ['#F1E3BE', '#CFD3BC', '#97B4B6', '#5A8794', '#1A3441']
PROV_SHORT = {'新疆维吾尔自治区': '新疆', '甘肃省': '甘肃', '青海省': '青海', '宁夏回族自治区': '宁夏', '陕西省': '陕西'}
PROVS = ['新疆', '甘肃', '青海', '宁夏', '陕西']
t0 = time.time()
def log(*a): print(f'[{time.time() - t0:6.1f}s]', *a, flush=True)
def rows(p):
    with open(p, encoding='utf-8-sig') as f: return list(csv.DictReader(f))
def readjs(name):
    s = (OUT / 'data' / name).read_text(encoding='utf-8'); d = json.loads(s[s.index('=') + 1:s.rstrip().rstrip(';').__len__()])
    if (name == 'core.js' and 'kpiCounty' not in d) or (name == 'region.js' and 'met' not in d):   # 已被 split_data.py 精简，改读完整版
        return readjs_full(name)
    return d
def readjs_full(name):
    p = HERE / 'data_full' / name
    if not p.exists(): raise SystemExit(f'assets/data/{name} 是精简版，且找不到 tools/data_full/{name}；请先运行 build_data.py')
    s = p.read_text(encoding='utf-8'); return json.loads(s[s.index('=') + 1:s.rstrip().rstrip(';').__len__()])
CORE, CAL = readjs('core.js'), readjs('calib.js')

# ------------------------------------------------------------------ counties & 1 km ownership（与 build_data.py 相同口径）
gj = json.load(open(SRC / 'data/raw/boundaries/china_northwest_adm2_zh.geojson', encoding='utf-8'))
meas = rows(SRC / 'outputs/protection_measures/protection_measures_5year.csv')
city_of = {r['adcode']: r['city_prefecture'] for r in meas if r['admin_level'] == '县级'}
city_code = {r['area_name']: r['adcode'] for r in meas if r['admin_level'] == '市级'}
C = []
for f in gj['features']:
    p = f['properties']; g = f['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    ad = str(p['adcode']); cn = city_of[ad]
    C.append({'n': p['name'], 'a': ad, 'p': PROV_SHORT[p['province_name']], 'c': cn, 'ca': city_code.get(cn, ad), 'polys': polys})
NC = len(C)
cities = []
for c in C:
    if c['c'] not in [x['n'] for x in cities]: cities.append({'n': c['c'], 'a': c['ca'], 'p': c['p']})
mask = np.array(Image.open(RAS['ssp245'] / 'desertification_2025_1km.tif')) != 255
H, W = mask.shape; X0, Y0, RES = 73.0, 50.0, 0.01
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
cid_strict = cid.copy()
miss = mask & (cid == 65535)
_, (ii, jj) = ndimage.distance_transform_edt(cid == 65535, return_indices=True)
cid[miss] = cid[ii[miss], jj[miss]]
lat = Y0 - RES * (np.arange(H) + .5); lon = X0 + RES * (np.arange(W) + .5)
cellA = (6371.0072 * np.radians(RES)) ** 2 * np.cos(np.radians(lat))
AREA = np.broadcast_to(cellA[:, None], (H, W))
V = mask.ravel(); WA = AREA.ravel()[V].astype(np.float64)
CIDS = cid_strict.ravel()[V]; IN = CIDS != 65535; CID = np.where(IN, CIDS, NC)
PROV_OF = np.array([PROVS.index(c['p']) for c in C] + [0]); PF = PROV_OF[cid.ravel()[V]]
county_area = np.bincount(CID, WA, NC + 1)[:NC]
prov_area = np.bincount(PF, WA, 5)
city_members = [[i for i, c in enumerate(C) if c['c'] == ct['n']] for ct in cities]
city_area = np.array([county_area[m].sum() for m in city_members])
log('geometry', NC, 'counties', len(cities), 'cities')

# ------------------------------------------------------------------ raster statistics
def pal_png(idx, cols):
    img = Image.fromarray(idx.astype(np.uint8), 'P'); pal = []
    for h in cols: pal += [int(h[i:i + 2], 16) for i in (1, 3, 5)]
    img.putpalette(pal + [0, 0, 0] * (256 - len(cols)))
    b = io.BytesIO(); img.save(b, 'PNG', optimize=True, transparency=len(cols)); return b.getvalue()
def tile(name, png):
    (OUT / 'tiles' / name).write_text(f'NW_TILE({json.dumps(name[:-3])},"data:image/png;base64,{base64.b64encode(png).decode()}");')
# 列：0–4 各等级面积，5 置信度×面积，6 下限>0 面积，7 上限>0 面积，8 下限等级×面积，9 上限等级×面积
NS = 10
def stats_for(code, years, tiles):
    cs = np.zeros((NC + 1, len(years), NS)); ps = np.zeros((5, len(years), NS))
    for k, y in enumerate(years):
        d = RAS[code]
        cl = np.array(Image.open(d / f'desertification_{y}_1km.tif')); lo = np.array(Image.open(d / f'prediction_lower90_{y}_1km.tif'))
        hi = np.array(Image.open(d / f'prediction_upper90_{y}_1km.tif')); cf = np.array(Image.open(d / f'confidence_{y}_1km.tif'))
        assert ((cl != 255) == mask).all(), (code, y)
        v = cl.ravel()[V].astype(np.int64); l = lo.ravel()[V].astype(np.int64); h = hi.ravel()[V].astype(np.int64)
        assert (l <= v).all() and (v <= h).all(), (code, y, 'interval')
        cw = WA * np.nan_to_num(cf.ravel()[V])
        for ST, ID, n in ((cs, CID, NC + 1), (ps, PF, 5)):
            for c5 in range(5): ST[:, k, c5] = np.bincount(ID[v == c5], WA[v == c5], n)
            ST[:, k, 5] = np.bincount(ID, cw, n)
            ST[:, k, 6] = np.bincount(ID[l > 0], WA[l > 0], n); ST[:, k, 7] = np.bincount(ID[h > 0], WA[h > 0], n)
            ST[:, k, 8] = np.bincount(ID, WA * l, n); ST[:, k, 9] = np.bincount(ID, WA * h, n)
        if tiles:
            tile(f'cls_{code}_{y}.js', pal_png(np.where(cl == 255, 5, cl), COL))
            q = np.digitize(np.nan_to_num(cf, nan=0), [.6, .7, .8, .9]); tile(f'conf_{code}_{y}.js', pal_png(np.where(cl == 255, 5, q), CONF_COL))
        if k % 10 == 0: log(code, y)
    return cs[:NC], ps
if args.cache and pathlib.Path(args.cache).exists():
    z = np.load(args.cache); ST = {c: (z[c + '_c'], z[c + '_p']) for c in CODES}; log('stats from cache')
else:
    ST = {'ssp245': stats_for('ssp245', YEARS, False)}
    for code in NEW: ST[code] = stats_for(code, FY, True)
    if args.cache: np.savez(args.cache, **{c + '_c': ST[c][0] for c in CODES}, **{c + '_p': ST[c][1] for c in CODES})
# 核对：与模型自带的逐年汇总一致
summ = {(int(r['year']), r['scenario_code']): r for r in rows(MK / 'scenarios/comparison_2026_2050/multi_scenario_annual_summary.csv')}
for code in CODES:
    cs, ps = ST[code]; off = 26 if code == 'ssp245' else 0
    for y in (2026, 2050):
        k = y - 2026 + off; des = ps[:, k, 1:5].sum(); r = summ[(y, code)]
        log('check', code, y, round(des), round(float(r['desertified_area_km2'])), round(ps[:, k, 3:5].sum()), round(float(r['severe_extreme_area_km2'])))

# ------------------------------------------------------------------ KPI（县区、地市沿用 SSP2-4.5 的措施表校正量）
def kpi_raster(st, area):
    ri = (st[..., :5] * np.arange(5)).sum(-1) / area[:, None] / 4
    ds = (area[:, None] - st[..., 0]) / area[:, None] * 100
    ss = (st[..., 3] + st[..., 4]) / area[:, None] * 100
    cf = st[..., 5] / area[:, None] * 100
    return np.stack([ri, ds, ss, cf], -1)
def band(st, area):   # 风险指数 90% 区间（下限、上限等级的面积加权）
    return st[..., 8] / area[:, None] / 4, st[..., 9] / area[:, None] / 4
def clipk(a): a = a.copy(); a[..., 0] = a[..., 0].clip(0, 1); a[..., 1:] = a[..., 1:].clip(0, 100); return a
city_stat = lambda cs: np.stack([cs[m].sum(0) for m in city_members])
U = {}   # level -> dict(code -> (kpi[n,51,4], lo[n,51], hi[n,51]))
cs245, ps245 = ST['ssp245']
lvl = {'county': (cs245, county_area, np.array(CORE['kpiCounty'])), 'city': (city_stat(cs245), city_area, np.array(CORE['kpiCity'])),
       'prov': (ps245, prov_area, np.array(CORE['kpiProv']))}
for L, (st245, area, k245) in lvl.items():
    raw245 = kpi_raster(st245, area); off = k245 - raw245            # 省级 off≈0（栅格直接汇总）
    if L == 'prov': off[:] = 0
    lo245, hi245 = band(st245, area)
    U[L] = {'ssp245': (k245, lo245 + off[..., 0], hi245 + off[..., 0])}
    for code in NEW:
        cs, ps = ST[code]; st = cs if L == 'county' else city_stat(cs) if L == 'city' else ps
        raw = kpi_raster(st, area); lo, hi = band(st, area)
        kk = k245.copy(); kk[:, 26:] = clipk(raw + off[:, 26:])
        bl = U[L]['ssp245'][1].copy(); bh = U[L]['ssp245'][2].copy()
        bl[:, 26:] = lo + off[:, 26:, 0]; bh[:, 26:] = hi + off[:, 26:, 0]
        U[L][code] = (kk, bl, bh)
    log('kpi', L, 'max |off ri|', round(float(np.abs(off[..., 0]).max()), 4))

# ------------------------------------------------------------------ climate（0.25° 锚点场 → 省、县区面积加权；锚点间线性插值）
clim = {c: np.load(SRC / f'data/processed/cmip6_{c}_climate.npz') for c in CODES}
la, lo_ = clim['ssp245']['latitude'], clim['ssp245']['longitude']
gi = np.clip(np.round((lat - la[0]) / (la[1] - la[0])).astype(int), 0, len(la) - 1)
gj_ = np.clip(np.round((lon - lo_[0]) / (lo_[1] - lo_[0])).astype(int), 0, len(lo_) - 1)
NODES = [2025, 2030, 2040, 2050]
def field(code, var, y): return clim[code][f'{var}_{y}'][gi][:, gj_].ravel()[V].astype(np.float64)
def unit_means(code):   # -> pr[unit, node], tas[unit, node] for provinces(5) and counties(NC)
    out = {}
    for name, ID, n in (('prov', PF, 5), ('county', CID, NC + 1)):
        w = np.bincount(ID, WA, n)
        out[name] = (np.array([np.bincount(ID, WA * field(code, 'pr', y), n) / w for y in NODES]).T,
                     np.array([np.bincount(ID, WA * field(code, 'tas', y), n) / w for y in NODES]).T)
    return out
CM = {c: unit_means(c) for c in CODES}
def interp(node_vals):  # [..., 4 nodes] -> [..., 51 years]
    return np.stack([np.interp(YEARS, NODES, v) for v in node_vals.reshape(-1, 4)]).reshape(node_vals.shape[:-1] + (len(YEARS),))
def anomalies(code, L):
    pr, ta = CM[code][L]; return interp((pr / pr[:, :1] - 1) * 100), interp(ta - ta[:, :1])
# SSP2-4.5 以既有官方口径表（calib.js）为准；其余情景 = 表值 + 本平台同一方法计算的情景差（相对各自 2025 年）
pa245, ta245 = anomalies('ssp245', 'prov')
log('my ssp245 prov anomaly 2050 (%, °C)', np.round(pa245[:, 50], 2).tolist(), np.round(ta245[:, 50], 3).tolist())

# ------------------------------------------------------------------ 官方口径面积与综合风险（NW_CAL 同结构）
fac = np.array(CAL['factors']); FIELDS = CAL['fields']
cal245p = np.array(CAL['prov'], dtype=float)    # [5, 51, 9]
cal245n = np.array(CAL['nw'], dtype=float)      # [51, 9]
# 由校准表反推省级降水距平、增温（表中只给风险值时无法唯一反推，故直接取 metadata 的原始列）
ref = rows(SRC / 'outputs/northwest_annual_area_risk_ssp245/northwest_annual_desertification_area_risk_2000_2050.csv')
FULL = ['新疆维吾尔自治区', '甘肃省', '青海省', '宁夏回族自治区', '陕西省']
refA = np.zeros((5, len(YEARS))); refT = np.zeros((5, len(YEARS)))
for r in ref:
    if r['province'] in FULL and int(r['year']) > BASE:
        p = FULL.index(r['province']); k = YEARS.index(int(r['year']))
        refA[p, k] = float(r['precipitation_anomaly_percent_vs_2025']); refT[p, k] = float(r['temperature_anomaly_c_vs_2025'])
# 西北合计的气候风险 = 各省风险按省域面积加权（用 SSP2-4.5 表值核对权重）
wP = prov_area / prov_area.sum()
chk = np.abs((cal245p[:, 26:, 7] * wP[:, None]).sum(0) - cal245n[26:, 7]).max(); log('nw precipRisk weight check (max abs diff)', round(float(chk), 4))
chkL = np.abs((cal245p[:, 26:, 4] * wP[:, None]).sum(0) - cal245n[26:, 4]).max(); log('nw landRisk weight check', round(float(chkL), 4))
def cal_rows(code):   # 本平台按县界省域重算的值（用于求情景差）
    cs, ps = ST[code]; k0 = 26 if code == 'ssp245' else 0; sl = slice(k0, k0 + NF)
    des = ps[:, sl, 1:5].sum(-1); sev = ps[:, sl, 3:5].sum(-1)
    land = (ps[:, sl, :5] * np.arange(5)).sum(-1) / prov_area[:, None] / 4; conf = ps[:, sl, 5] / prov_area[:, None] * 100
    P = np.stack([des * fac[:, None], ps[:, sl, 6] * fac[:, None], ps[:, sl, 7] * fac[:, None], sev * fac[:, None], land, conf], -1)   # [5, NF, 6]
    N = np.zeros((NF, 6)); N[:, :4] = P[:, :, :4].sum(0)
    for j in (4, 5): N[:, j] = (P[:, :, j] * wP[:, None]).sum(0)
    return P, N
MINE = {c: cal_rows(c) for c in CODES}
d = np.abs(MINE['ssp245'][0][..., 0] - cal245p[:, 26:, 0]).max(); log('my prov area vs table (省界口径不同，仅取情景差)', round(float(d)))
def cal_scn(code):   # SSP2-4.5 官方口径表 + 情景差（面积、区间、重度、土地风险、置信度、气候分量）
    P = cal245p[:, 26:].copy(); N = cal245n[26:].copy()
    dP = MINE[code][0] - MINE['ssp245'][0]; dN = MINE[code][1] - MINE['ssp245'][1]
    P[..., :6] += dP; N[:, :6] += dN
    pa_s, ta_s = anomalies(code, 'prov'); pa = refA[:, 26:] + (pa_s - pa245)[:, 26:]; ta_ = refT[:, 26:] + (ta_s - ta245)[:, 26:]
    P[..., 7] = np.clip(-pa / 20, 0, 1); P[..., 8] = np.clip(ta_ / 3, 0, 1)
    for j in (7, 8): N[:, j] = (P[..., j] * wP[:, None]).sum(0)
    P[..., 6] = .65 * P[..., 4] + .2 * P[..., 7] + .15 * P[..., 8]; N[:, 6] = .65 * N[:, 4] + .2 * N[:, 7] + .15 * N[:, 8]
    P[..., 1] = np.minimum(P[..., 1], P[..., 0]); P[..., 2] = np.maximum(P[..., 2], P[..., 0])
    return P, N, pa, ta_
CALS = {c: cal_scn(c) for c in NEW}

# ------------------------------------------------------------------ 县区气候（地区页指标）：SSP2-4.5 县区值 + 情景差
RG = readjs('region.js'); met245 = np.array(RG['met'])[..., :2]          # [NC, 51, 2] 降水 mm、气温 ℃
def county_met(code):
    pr_s, ta_s = CM[code]['county']; pr_b, ta_b = CM['ssp245']['county']
    dfrac = interp((pr_s[:NC] / pr_s[:NC, :1]) - (pr_b[:NC] / pr_b[:NC, :1])); dT = interp((ta_s[:NC] - ta_s[:NC, :1]) - (ta_b[:NC] - ta_b[:NC, :1]))
    out = met245.copy(); out[:, 26:, 0] = met245[:, 26:, 0] * (1 + dfrac[:, 26:]); out[:, 26:, 1] = met245[:, 26:, 1] + dT[:, 26:]
    return out[:, 26:]

# ------------------------------------------------------------------ pairwise differences（模型验证报告）
pair = rows(MK / 'scenarios/comparison_2026_2050/multi_scenario_pairwise_difference.csv')
PAIRS = {}
for r in pair:
    key = r['scenario_a_code'] + '|' + r['scenario_b_code']
    PAIRS.setdefault(key, [None] * NF)[int(r['year']) - 2026] = [round(float(r['different_cells_percent']), 4), int(r['cells_b_more_severe']), int(r['cells_b_less_severe'])]
yidx = {c: {int(r['year']): r for r in rows(MK / f'scenarios/{c}_annual_2000_2050/year_index_2026_2050.csv')} for c in NEW}

# ------------------------------------------------------------------ output
R = lambda a, d: np.round(a, d).tolist()
def chart(L):     # [unit][51][3 scen][ri, lo, hi, conf]
    out = np.stack([np.stack([U[L][c][0][..., 0], U[L][c][1], U[L][c][2], U[L][c][0][..., 3]], -1) for c in CODES], 2)
    out[..., :3] = out[..., :3].clip(0, 1); return R(out, 3)
scn = {'codes': CODES, 'names': NAMES, 'years': FY, 'base': 2025,
       'chart': {'county': chart('county'), 'city': chart('city'), 'prov': chart('prov')}, 'pairs': PAIRS,
       'note': '三情景共用 2000–2025 年历史；2026–2050 年各为 1 km LightGBM + CA-Markov 逐年预测，仅替换 IITM-ESM 降水与气温场。'}
for code in NEW:
    cs, ps = ST[code]; P, N, pa, ta_ = CALS[code]
    scn[code] = {
        'meanConf': [round(float(yidx[code][y]['mean_confidence']) * 100, 2) for y in FY],
        'county': R(cs[:, :, :5], 1), 'countyConf': R(cs[:, :, 5] / county_area[:, None] * 100, 1),
        'countyLo': R(cs[:, :, 6], 1), 'countyHi': R(cs[:, :, 7], 1),
        'prov': R(ps[:, :, :5], 1), 'provConf': R(ps[:, :, 5] / prov_area[:, None] * 100, 2), 'provLo': R(ps[:, :, 6], 1), 'provHi': R(ps[:, :, 7], 1),
        'kpiCounty': R(U['county'][code][0][:, 26:], 4), 'kpiCity': R(U['city'][code][0][:, 26:], 4), 'kpiProv': R(U['prov'][code][0][:, 26:], 4),
        'calProv': R(P, 4), 'calNw': R(N, 4), 'precipAnom': R(pa, 2), 'tempAnom': R(ta_, 3),
        'met': R(county_met(code), 2),
    }
scn['ssp245'] = {'precipAnom': R(refA[:, 26:], 2), 'tempAnom': R(refT[:, 26:], 3)}
s = json.dumps(scn, ensure_ascii=False, separators=(',', ':'))
(OUT / 'data/scen.js').write_text(f'window.NW_SCN={s};', encoding='utf-8')
log('data/scen.js', len(s) // 1024, 'KB'); log('done')
