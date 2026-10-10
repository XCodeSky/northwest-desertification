"""打包“官方口径校准面积 + SSP2-4.5 综合风险”逐年数据 → assets/data/calib.js（NW_CAL）

数据来源：desertification_model_v1/outputs/northwest_annual_area_risk_ssp245/
  - northwest_annual_desertification_area_risk_2000_2050.csv（五省 + 西北合计，逐年）
  - metadata.json（2019 官方锚点、校准因子、综合风险公式）
  - sources.csv（官方调查资料 S01–S08；网页中改记为 O01–O08，避免与防护措施来源 S01–S19 重号）

用法（在 website 目录）：
  python tools/build_calibrated.py --model ..\\..\\desertification_model_v1
"""
import argparse, csv, json
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / 'assets' / 'data' / 'calib.js'
SHORT = {'新疆维吾尔自治区': '新疆', '甘肃省': '甘肃', '青海省': '青海', '宁夏回族自治区': '宁夏', '陕西省': '陕西', '西北五省合计': 'NW'}
PROVS = ['新疆', '甘肃', '青海', '宁夏', '陕西']          # 与 core.js 中 provs 顺序一致
FIELDS = ['desertified_area_km2', 'desertified_area_lower90_km2', 'desertified_area_upper90_km2', 'severe_extreme_area_km2',
          'land_risk_index_0_1', 'model_confidence_percent', 'composite_risk_index_0_1', 'precipitation_deficit_risk_0_1', 'warming_risk_0_1']


def num(v, nd):
    return None if v in ('', None) else round(float(v), nd)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--model', required=True); a = ap.parse_args()
    src = Path(a.model) / 'outputs' / 'northwest_annual_area_risk_ssp245'
    rows = list(csv.DictReader(open(src / 'northwest_annual_desertification_area_risk_2000_2050.csv', encoding='utf-8-sig')))
    meta = json.load(open(src / 'metadata.json', encoding='utf-8'))
    years = sorted({int(r['year']) for r in rows})
    ser = {k: [None] * len(years) for k in ['NW'] + PROVS}
    for r in rows:
        k = SHORT[r['province']]; i = years.index(int(r['year']))
        ser[k][i] = [num(r[f], 1 if f.endswith('km2') else 4) for f in FIELDS]
    assert all(all(v is not None for v in s) for s in ser.values()), '有缺失年份'
    srcs = [{'id': 'O' + r['source_id'][1:], 't': r['title'], 'p': r['publisher'], 'y': r['reference_year'], 'v': r['value'], 'u': r['url']}
            for r in csv.DictReader(open(src / 'sources.csv', encoding='utf-8-sig'))]
    out = {
        'years': years, 'fields': ['area', 'lo', 'hi', 'severe', 'landRisk', 'conf', 'composite', 'precipRisk', 'warmRisk'],
        'nw': ser['NW'], 'prov': [ser[p] for p in PROVS],
        'anchorYear': meta['official_anchor_year'], 'anchorTotal': meta['official_anchor_total_km2'],
        'anchorProv': [meta['official_anchor_by_province_km2'][n] for n in ['新疆维吾尔自治区', '甘肃省', '青海省', '宁夏回族自治区', '陕西省']],
        'factors': [meta['calibration_factors'][n] for n in ['新疆维吾尔自治区', '甘肃省', '青海省', '宁夏回族自治区', '陕西省']],
        'formula': meta['composite_risk_formula'], 'precipRule': meta['precipitation_deficit_risk'], 'warmRule': meta['warming_risk'],
        'areaDef': meta['area_definition'], 'warning': meta['warning'], 'sources': srcs,
    }
    OUT.write_text('window.NW_CAL=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    print('wrote', OUT, OUT.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
