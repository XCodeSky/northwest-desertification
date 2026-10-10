"""打包 2020→2025 时序验证的模型对比、五级混淆矩阵与逐类别指标 → assets/data/validation.js（NW_VAL）

数据：desertification_model_v1/outputs/model_comparison_1km/
    model_comparison_summary.csv               6 个模型的总体指标
    model_comparison_confusion_matrix_long.csv 各模型五级混淆矩阵（长表）
逐类别指标（精确率、召回率、特异度、F1、IoU 等）全部由混淆矩阵计算，与“逐类别验证指标_1km_2020-2025.xlsx”口径相同。
用法：python tools/build_validation.py ..\\..\\desertification_model_v1\\outputs\\model_comparison_1km
"""
import csv, json, sys, pathlib

SRC = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '../desertification_model_v1/outputs/model_comparison_1km')
OUT = pathlib.Path(__file__).resolve().parent.parent / 'assets' / 'data' / 'validation.js'
def rd(name): return list(csv.DictReader(open(SRC / name, encoding='utf-8-sig')))
def r4(v): return round(float(v), 6)

summary = rd('model_comparison_summary.csv')
models = [{'id': r['model_id'], 'name': r['model_name_zh'],
           'm': {k: r4(r[k]) for k in ('accuracy', 'balanced_accuracy', 'macro_precision', 'macro_recall', 'macro_f1', 'weighted_f1',
                                       'cohen_kappa', 'ordinal_mae_levels', 'within_one_level_accuracy', 'severe_plus_f1')}}
          for r in summary]
n = int(summary[0]['validation_samples'])
cm = {}
for r in rd('model_comparison_confusion_matrix_long.csv'):
    cm.setdefault(r['model_id'], [[0] * 5 for _ in range(5)])[int(r['actual_class'])][int(r['predicted_class'])] = int(r['count'])
for m in models:
    M = cm[m['id']]; assert sum(map(sum, M)) == n, m['id']
    m['cm'] = M
out = {'period': '2020→2025', 'train': '2000→2020（四个五年转移期）', 'n': n,
       'final': 'lightgbm_ca_markov', 'pixel': 'lightgbm_full', 'baseline': 'persistence', 'models': models,
       'src': 'desertification_model_v1/outputs/model_comparison_1km'}
OUT.write_text('window.NW_VAL=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
print('models', len(models), 'samples', n, 'bytes', OUT.stat().st_size)
