"""把 core.js、scen.js、region.js 拆成“页面打开时必需的精简文件 + 按需加载的分块”。

在 build_data.py → build_calibrated.py → build_scenarios.py 之后最后执行（纯 Python，几秒钟）：
    python tools/split_data.py

输出（assets/data/）
    core.js / scen.js / region.js   精简版：年份信息、省级逐年统计、情景省级统计与官方口径、措施来源等，页面打开即加载
    year/k_YYYY.js                  该年全部县区 KPI（风险指数、荒漠化占比、重度以上占比、置信度）；2026 年起为 SSP2-4.5
    year/k_ssp126_YYYY.js 等        另两种情景 2026–2050 年的县区 KPI
    prov/p_省代码.js                该省县区、市州的逐年等级面积、置信度、90% 区间与 KPI（三种情景）
    prov/r_省代码.js                该省县区的气象、驱动归因、情景曲线和防护措施表（仅地区预测页）

首页按所看年份加载 year/，打开县区卡片时加载该省 p_；地区预测页按所选地区加载该省 p_ 与 r_。
完整版另存于 tools/data_full/（网页不读取）。build_scenarios.py 需要完整的 core.js 与 region.js，
发现 assets/data 下已是精简版时会自动改读 tools/data_full/ 中的完整版。
"""
import json, pathlib, shutil

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE.parent / 'assets' / 'data'
FULL = HERE / 'data_full'
PCODE = {'新疆': '650000', '甘肃': '620000', '青海': '630000', '宁夏': '640000', '陕西': '610000'}
CFIELDS = ['county', 'countyConf', 'countyLo', 'countyHi', 'kpiCounty']      # 按县区排列
TFIELDS = ['kpiCity']                                                        # 按市州排列
SCODES = ['ssp126', 'ssp585']


def readjs(p):
    s = p.read_text(encoding='utf-8'); i = s.index('=')
    return s[:i].strip().replace('window.', ''), json.loads(s[i + 1:].rstrip().rstrip(';'))


def tidy(o):   # 整数值的浮点数写成整数（数值不变，文件更小）
    if isinstance(o, float): return int(o) if o.is_integer() and abs(o) < 1e15 else o
    if isinstance(o, list): return [tidy(v) for v in o]
    if isinstance(o, dict): return {k: tidy(v) for k, v in o.items()}
    return o


def dump(o): return json.dumps(tidy(o), ensure_ascii=False, separators=(',', ':'))


def write(rel, text):
    p = DATA / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(text, encoding='utf-8'); return p.stat().st_size


def full(name, test):
    """返回完整数据：assets/data 下若仍是完整版则先备份到 tools/data_full/"""
    p = DATA / name; var, d = readjs(p)
    if test(d):
        FULL.mkdir(exist_ok=True); shutil.copyfile(p, FULL / name); return var, d
    q = FULL / name
    if not q.exists(): raise SystemExit(f'{name} 已是精简版，且 tools/data_full/{name} 不存在；请先重新运行生成脚本')
    return readjs(q)


_, GEO = readjs(DATA / 'geo.js')
_, CORE = full('core.js', lambda d: 'kpiCounty' in d)
_, SCN = full('scen.js', lambda d: 'county' in d['chart'])
_, RG = full('region.js', lambda d: 'measures' in d)

years, base = CORE['years'], SCN['base']; nh = years.index(base) + 1     # 2000–2025 共 26 年为三情景共用历史
cty, cit = GEO['county'], GEO['city']
sizes = {}

# ---------- 逐年县区 KPI ----------
for k, y in enumerate(years):
    sizes[f'year/k_{y}.js'] = write(f'year/k_{y}.js', f'NW_PUT("k_{y}",{dump([r[k] for r in CORE["kpiCounty"]])});')
for c in SCODES:
    for j, y in enumerate(SCN['years']):
        sizes[f'year/k_{c}_{y}.js'] = write(f'year/k_{c}_{y}.js', f'NW_PUT("k_{c}_{y}",{dump([r[j] for r in SCN[c]["kpiCounty"]])});')

# ---------- 分省：县区 / 市州逐年数据 ----------
ad2prov = {c['a']: c['p'] for c in cty}; ad2prov.update({c['a']: c['p'] for c in cit})
lost = [a for a in RG['measures'] if a not in ad2prov]
if lost: print('提示：措施表中有', len(lost), '个代码不属于任何县区或市州，已忽略：', lost[:5])
for pv, code in PCODE.items():
    ci = [i for i, c in enumerate(cty) if c['p'] == pv]; ti = [i for i, c in enumerate(cit) if c['p'] == pv]
    pick = lambda arr, idx: [arr[i] for i in idx]
    s = {'ssp245': {**{f: pick(CORE[f], ci) for f in CFIELDS}, **{f: pick(CORE[f], ti) for f in TFIELDS}}}
    for c in SCODES: s[c] = {**{f: pick(SCN[c][f], ci) for f in CFIELDS}, **{f: pick(SCN[c][f], ti) for f in TFIELDS}}
    sizes[f'prov/p_{code}.js'] = write(f'prov/p_{code}.js', f'NW_PUT("p_{code}",{dump({"ci": ci, "ti": ti, "s": s})});')
    r = {'ci': ci, 'ti': ti, 'met': pick(RG['met'], ci), 'att': pick(RG['att'], ci),
         'smet': {c: pick(SCN[c]['met'], ci) for c in SCODES},
         'chartCounty': pick(SCN['chart']['county'], ci), 'chartCity': pick(SCN['chart']['city'], ti),
         'measures': {a: v for a, v in RG['measures'].items() if ad2prov.get(a) == pv}}
    sizes[f'prov/r_{code}.js'] = write(f'prov/r_{code}.js', f'NW_PUT("r_{code}",{dump(r)});')

# ---------- 精简版 ----------
core = {k: v for k, v in CORE.items() if k not in CFIELDS + TFIELDS}
scn = {k: v for k, v in SCN.items() if k not in SCODES and k != 'chart'}
scn['chart'] = {'prov': SCN['chart']['prov']}
for c in SCODES: scn[c] = {k: v for k, v in SCN[c].items() if k not in CFIELDS + TFIELDS + ['met']}
rg = {k: v for k, v in RG.items() if k not in ('measures', 'met', 'att')}
rt, city_ad = {}, {c['a']: c for c in cit}; cty_ad = {c['a'] for c in cty}
for a, per in RG['measures'].items():          # 市州措施的排名总数（原先在页面里由全部措施表现算）
    if a in cty_ad or a not in city_ad: continue
    for P, rec in per.items():
        rt['c|' + P] = max(rt.get('c|' + P, 0), rec['rn']); kp = f'c|{P}|{city_ad[a]["p"]}'; rt[kp] = max(rt.get(kp, 0), rec['rp'])
rg['rt'] = rt
sizes['core.js'] = write('core.js', f'window.NW_CORE={dump(core)};')
sizes['scen.js'] = write('scen.js', f'window.NW_SCN={dump(scn)};')
sizes['region.js'] = write('region.js', f'window.NW_REGION={dump(rg)};')

kb = lambda n: f'{n / 1024:,.0f} KB'
print('精简版：', '，'.join(f'{k} {kb(sizes[k])}' for k in ('core.js', 'scen.js', 'region.js')))
yk = [v for k, v in sizes.items() if k.startswith('year/')]
print(f'year/：{len(yk)} 个文件，每个约 {kb(sum(yk) / len(yk))}')
for code in PCODE.values(): print(f'prov/p_{code}.js {kb(sizes[f"prov/p_{code}.js"])}　prov/r_{code}.js {kb(sizes[f"prov/r_{code}.js"])}')
