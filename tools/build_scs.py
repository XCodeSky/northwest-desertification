"""生成首页“研究区位置”中的南海诸岛示意数据 assets/data/scs.js（纯 Python，无第三方依赖）
数据：DataV GeoAtlas 全国边界（100000_full），取华南沿海省区、南海诸岛与十段线，裁剪、简化后保存。
用法：python tools/build_scs.py path/to/china.json"""
import json, sys, math, pathlib
SRC = sys.argv[1]
OUT = pathlib.Path(__file__).resolve().parent.parent / 'assets/data/scs.js'
X0, Y0, X1, Y1 = 104.5, 2.0, 125.5, 25.6

def clip(ring):  # Sutherland–Hodgman，矩形裁剪
    def cut(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            if inside(b):
                if not inside(a): out.append(inter(a, b))
                out.append(b)
            elif inside(a): out.append(inter(a, b))
        return out
    def ix(x): return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))
    def iy(y): return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y)
    p = ring
    for ins, it in ((lambda q: q[0] >= X0, ix(X0)), (lambda q: q[0] <= X1, ix(X1)), (lambda q: q[1] >= Y0, iy(Y0)), (lambda q: q[1] <= Y1, iy(Y1))):
        if not p: break
        p = cut(p, ins, it)
    return p

def rdp(pts, eps):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1e-12
    dmax, k = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / L
        if d > dmax: dmax, k = d, i
    if dmax <= eps: return [a, b]
    return rdp(pts[:k + 1], eps)[:-1] + rdp(pts[k:], eps)

def area(p): return abs(sum(p[i - 1][0] * p[i][1] - p[i][0] * p[i - 1][1] for i in range(len(p)))) / 2
d = json.load(open(SRC, encoding='utf-8'))
land, jd = [], []
for f in d['features']:
    pr = f['properties']; g = f['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    if pr.get('adchar') == 'JD':
        for poly in polys: jd.append([round(v, 3) for xy in poly[0] for v in xy])
        continue
    for poly in polys:
        r = [tuple(c[:2]) for c in poly[0]]
        if max(c[0] for c in r) < X0 or min(c[0] for c in r) > X1 or max(c[1] for c in r) < Y0 or min(c[1] for c in r) > Y1: continue
        r = clip(r)
        if len(r) < 3: continue
        big = area(r) > 0.5
        if big:  # 闭合环首尾重合，分两半分别简化
            m = len(r) // 2; s = rdp(r[:m + 1], 0.04)[:-1] + rdp(r[m:] + [r[0]], 0.04)[:-1]
        else: s = r
        if len(s) < 3: continue
        land.append([round(v, 3) for xy in s for v in xy])
out = {'land': land, 'jd': jd, 'bbox': [X0, Y0, X1, Y1], 'src': 'DataV GeoAtlas 全国边界（含南海诸岛与十段线）'}
OUT.write_text('window.NW_SCS=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';', encoding='utf-8')
print('land rings', len(land), 'jd', len(jd), 'bytes', OUT.stat().st_size)
