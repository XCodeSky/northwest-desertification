# 西北荒漠化灾害预测及防护平台

离线运行：
用浏览器直接打开 `index.html`即可，不需要服务器，推荐使用 Chrome 或 Edge。
只有地图底图（天地图）需要联网和密钥，见下文“地图底图”；离线时地图改用简化示意底图，其余功能不受影响。

在线部署：
当前网站发布版本为 `1.0.0`（模型版本为 `NW-DESERT-1K v1.1`）。发布前运行 `python tools/validate_site.py --root .` 检查页面资源、年度数据完整性和 JavaScript 语法。Ubuntu 24.04 部署见 [`DEPLOYMENT.md`](DEPLOYMENT.md)，发布包可在 Windows PowerShell 中运行 `tools/package_release.ps1` 生成。

## 目录

```
website/
├─ index.html                   首页：西北五省区 1 km 逐年等级图、双时相对比、三种气候情景切换
├─ region.html                  地区预测：省 / 市州 / 县区三级
├─ history.html                 历史记录 · 沙海长路：西北荒漠化的历史脉络（六章长文 + 8 幅档案影像 + 6 幅内嵌 SVG 示意图）
├─ heroes.html                  历史记录 · 漠上群英：五组治沙人与无名者的故事（每则附依据，配 10 幅照片）
├─ data.html                    数据来源：A—E 五层数据、官方锚点、模型派生数据、署名与免责声明
├─ model.html                   模型说明：NW-DESERT-1K v1.1 的路径、参数、验证、情景设置与限制（15 节）
├─ about.html                   关于项目：参赛信息（AI4Climate 赛道 06）、问题、用户、AI 任务、验证计划与评审对照
├─ assets/css/site.css          共用样式
├─ assets/css/region.css        地区预测页样式
├─ assets/js/nav.js             各页共用：页面切换过渡、提示条
├─ assets/js/history.js         历史记录页交互（章节时间带、滚动出现、影像对比滑块）
├─ assets/css/history.css       历史记录页样式
├─ assets/img/                  历史记录影像（已压缩，出处见数据来源页第 10 节）
├─ assets/video/demo.mp4        使用演示视频（2 分 35 秒，电脑端与手机端），在“关于项目”第 09 节链接
├─ assets/js/data.js            数据来源页交互（目录高亮、复制署名）
├─ assets/js/model.js           模型说明页交互（目录高亮、示意图、Markov 矩阵与气候修正演示）
├─ assets/css/model.css         模型说明页样式（在 data.css 之后加载）
├─ assets/js/about.js           关于项目页交互（目录高亮、入场动画）
├─ assets/css/about.css         关于项目页样式（在 model.css 之后加载）
├─ assets/js/config.js          站点配置：天地图密钥、审图号、底图来源（只需改这里）
├─ assets/js/mapcore.js         共用地图引擎（Web 墨卡托投影、天地图底图、栅格按需加载、重投影绘制）
├─ assets/js/home.js            首页交互
├─ assets/js/region.js          地区预测页交互
├─ assets/data/                 由模型输出打包的数据（勿手改）。页面打开时只加载精简文件，县区逐年数据按需加载
│  ├─ geo.js                    省 / 市州 / 县区边界与中文名、底图
│  ├─ core.js                   精简版：年份信息、省级逐年等级面积 / 区间 / 置信度 / KPI、回测指标
│  ├─ region.js                 精简版：措施来源与案例、归因因子名称、说明（地区预测页）
│  ├─ calib.js                  按 2019 年官方调查校准的逐年荒漠化面积与 SSP2-4.5 综合风险（五省 + 合计）
│  ├─ scen.js                   精简版：SSP1-2.6、SSP5-8.5 的省级逐年统计、校准面积、气候距平、省级情景曲线
│  ├─ validation.js             2020→2025 时序验证：六种做法的总体指标与五级混淆矩阵（逐类别指标在页面上由混淆矩阵算出）
│  ├─ year/                     按年份：k_YYYY.js 为该年全部县区 KPI（2026 年起为 SSP2-4.5），k_ssp126_YYYY.js、k_ssp585_YYYY.js 为另两种情景；每个约 9 KB
│  ├─ prov/                     按省：p_省代码.js 为该省县区、市州逐年等级面积 / 置信度 / 区间 / KPI（三情景），
│  │                            r_省代码.js 为该省县区气象、驱动归因、情景曲线与防护措施表（仅地区预测页）
│  └─ scs.js                    首页“研究区位置”图中的南海诸岛示意（华南沿海、南海诸岛、十段线）
├─ assets/tiles/                逐年等级与置信度栅格（按需加载）：cls_YYYY / conf_YYYY 为共同历史与 SSP2-4.5，
│                               cls_ssp126_YYYY、cls_ssp585_YYYY 等为另两种情景的 2026–2050 年
├─ assets/downloads/            11 个五年锚点等级 GeoTIFF（导航栏“下载”按钮）；模型说明、参数配置与两份验证指标工作簿
├─ tools/build_data.py          从模型工程重新生成 assets/data 与 assets/tiles
├─ tools/build_calibrated.py    重新生成 assets/data/calib.js
├─ tools/build_scenarios.py     重新生成 assets/data/scen.js 与两种新增情景的栅格
├─ tools/build_validation.py     重新生成 assets/data/validation.js（模型说明页 05 节的对比表、混淆矩阵与逐类别指标）
├─ tools/split_data.py          把 core.js、scen.js、region.js 拆成精简文件与 year/、prov/ 分块（最后执行）
├─ tools/data_full/             上述三个文件的完整版（网页不读取；build_scenarios.py 会用到）
└─ tools/build_scs.py           重新生成 assets/data/scs.js
```

## 数据来源

全部来自 `desertification_model_v1/outputs`：

| 内容 | 文件 |
|---|---|
| 1 km 逐年等级、置信度、90% 区间 | `model_1km_full/annual_2000_2050/rasters/` |
| 年份状态、全区面积 | `model_1km_full/annual_2000_2050/year_index_2000_2050.csv`、`annual_statistics_2000_2050.csv` |
| 回测指标、特征重要性 | `model_1km_full/` 下的 `temporal_validation_metrics.json`、`feature_importance_1km.csv`、`training_report.json` |
| 模型对比、五级混淆矩阵、逐类别指标 | `model_comparison_1km/` 下的 `model_comparison_summary.csv`、`model_comparison_confusion_matrix_long.csv`；两份 xlsx 复制到 `assets/downloads/` |
| 防护措施、来源文件 | `protection_measures/protection_measures_5year.csv`、`protection_sources.csv` |
| 县区气象、驱动归因 | `county_dashboard_annual/` 下的 `county_annual_meteorology.csv`、`county_annual_risk_attribution_wide.csv` |
| SSP1-2.6、SSP5-8.5 逐年栅格与三情景汇总 | `model_1km_full/scenarios/` 下的 `ssp126_annual_2000_2050/`、`ssp585_annual_2000_2050/`、`comparison_2026_2050/`；气候场为 `data/processed/cmip6_ssp{126,245,585}_climate.npz` |
| 官方口径校准面积、综合风险、官方调查资料 | `northwest_annual_area_risk_ssp245/` 下的 `northwest_annual_desertification_area_risk_2000_2050.csv`、`metadata.json`、`sources.csv` |
| 边界 | `data/raw/boundaries/china_northwest_adm2_zh.geojson`、`data/processed/northwest_provinces.geojson` |

## 统计口径

- **面积**：按 0.01° 格网中心落入县界统计，采用等积球半径 6371.0072 km。全区各等级面积与 `annual_statistics` 一致。
- **县区与市州 KPI**：风险指数、荒漠化占比、重度以上占比、置信度以防护措施表为准。五年锚点年份直接取表中数值；其余年份由 1 km 栅格逐年计算，再按相邻锚点的偏差线性校准。省级 KPI 直接由栅格计算。
- **市州与省级的气象、归因**：按县区面积加权。
- **三情景**：县区、市州 KPI 在 1 km 栅格结果上叠加 SSP2-4.5 的措施表校准偏差；省级直接由栅格汇总。官方口径面积和气候距平采用差值法：SSP2-4.5 校准表 +（本情景 − SSP2-4.5）的模型差值。
- **地图叠加对比**：变化面积为 1 km 栅格逐像元统计，可能与措施表口径的占比略有差异。

- **官方口径面积**：首页概览与时间轴中的荒漠化面积、重度以上面积，以及地区页省级的“官方口径”面积，按 2019 年各省官方荒漠化调查面积校准（五省合计 150.43 万km²），时间轴上用红色菱形标出该锚点。图例中的分等级面积仍为 1 km 格网直接统计，未校准。除 2019 年外，逐年数值是模型年度化或预测结果，不是官方逐年调查值。
- **综合风险指数**：首页 2025 年起显示所选情景的综合风险，计算式为 0.65×土地风险 + 0.20×降水亏缺风险 + 0.15×增温风险；2025 年以前没有气候分量，显示土地风险指数。官方调查资料在网页中编号为 O01–O08，以免和防护措施来源 S01–S19 重号。

## 代理字段与情景说明

- 地下水位变化、大风日数是参数化代理指标，不是监测井或气象站实测，页面上标有“代理”。
- 驱动因子贡献是可复算的代理归因，不是因果识别。
- SSP1-2.6、SSP2-4.5、SSP5-8.5 都是 1 km 模型的直接结果，共用 2000–2025 年历史，只替换 IITM-ESM 降水与气温场。首页和地区页可切换情景，默认 SSP2-4.5；首页另有“情景差异”图层，标出与 SSP2-4.5 同年等级不同的格网。
- 切换到 SSP1-2.6 或 SSP5-8.5 时，地下水位、大风日数、驱动归因和措施表仍为 SSP2-4.5 口径。
- 代理字段只用于网站原型和模型敏感性展示，不应表述为县级实测气象、水文或因果归因。

## 防护措施

- **2030 年及以后**：展示措施表中的模型建议，包括优先等级、排名、措施类型、具体措施和参考依据。
- **2000–2025 年**：只展示与本地区直接相关的实际案例文件（S16–S19），模板化的历史描述不展示。没有案例的县区显示“暂无实际案例记录”。

## 链接参数

地区页支持通过地址分享当前视图：

- `region.html#a=620621&y=2040`：民勤县，2040 年。
- `region.html#a=620600&y=2040&c=2025-2040`：武威市，2025 与 2040 年叠加对比。
- `region.html#a=620621&y=2050&sc=ssp585`：民勤县，2050 年，SSP5-8.5 情景（`sc` 可取 ssp126、ssp585，省略即 SSP2-4.5；首页同样适用）。

`a` 可以是县区、市州的行政区划代码，也可以是省级代码，例如 620000。

## 模型更新后

在 `website` 目录执行。需要 numpy、pillow、scipy、matplotlib、contourpy，约 2 分钟：

```
python tools/build_data.py --model ..\..\desertification_model_v1
```

官方口径数据更新后，另外执行：

```
python tools/build_calibrated.py --model ..\..\desertification_model_v1
```

然后执行下面一步，重新打包 SSP1-2.6、SSP5-8.5（它读取前两步生成的 core.js、calib.js、region.js，所以前两步任何一步重跑之后都要再跑一次），约 3 分钟：

```
python tools/build_scenarios.py --model ..\..\desertification_model_v1
```

最后把数据拆分为按需加载的分块（几秒钟）：

```
python tools/split_data.py
```

前面任何一步重跑之后都要再执行这一步。

时序验证结果更新后（与上面几步无关），执行：

```
python tools/build_validation.py ..\..\desertification_model_v1\outputs\model_comparison_1km
```

并把该目录下的 `逐类别验证指标_1km_2020-2025.xlsx`、`1km模型对比_2020-2025时序验证.xlsx` 复制到 `assets/downloads/`，分别改名为 `per_class_metrics_1km_2020-2025.xlsx`、`model_comparison_1km_2020-2025.xlsx`。模型说明页 05 节中“逐像元分类”“最终制图链路”两组数字为静态文本，需要同步修改。


## 地图底图

- 首页和地区页以**天地图在线矢量底图**（vec_w 底图 + cva_w 注记，Web 墨卡托）为底图，荒漠化结果作为独立的专题栅格层叠加其上，不透明度可在地图下方调节。
- 地图下方的说明条显示底图名称、审图号和数据来源，并注明“专题内容为本项目模型结果”。名称、审图号、来源和密钥都在 `assets/js/config.js` 中修改。审图号目前填写 GS(2024)0650号，正式发布前请到天地图官网核对当前审图号。
- **密钥**：在 [天地图开发者控制台](https://console.tianditu.gov.cn/) 注册，创建“浏览器端”应用，把密钥填入 `config.js` 的 `tk`。本地以 file:// 打开时没有域名，密钥不要设置域名白名单。
- 未填密钥、离线或密钥无效时，地图自动改用原来的简化示意底图，说明条会注明原因。
- 地图“导出 PNG”仍以简化示意底图为背景，不含天地图瓦片（浏览器跨域限制）。
- 县区统计边界仍为 DataV GeoAtlas。首页“研究区位置”图左下角的南海诸岛示意取自 DataV 全国边界 `100000_full.json`（2022 年版，经 GitHub 项目 lyhmyd1211/GeoMapData_CN 获取）。更新时执行 `python tools/build_scs.py path/to/china.json`。


## 许可协议

本项目的模型结果、图件与网站内容采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)（署名-非商业性使用-相同方式共享 4.0 国际）协议许可。第三方数据与底图（ESA CCI、NASA、geoBoundaries、DataV、天地图等）仍遵循其各自的原始许可。
