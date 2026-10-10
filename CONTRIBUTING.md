# 参与开发

本项目是无构建步骤的静态网站。提交修改前请保持模型结果、统计口径、页面说明和下载文件同步。

## 本地检查

```bash
python tools/validate_site.py --root .
python -m http.server 8000
```

若系统安装了 Node.js，校验器会额外检查所有 JavaScript 文件的语法。浏览器中至少检查首页、地区预测页、模型说明页和数据来源页。

## 数据更新顺序

依次运行 `build_data.py`、`build_calibrated.py`、`build_scenarios.py` 和 `split_data.py`。验证结果变化时再运行 `build_validation.py`。不要手工修改 `assets/data/`、`assets/tiles/` 和 `tools/data_full/` 中的生成数据。

## 提交前

- 基准序列 2000—2050 年的等级、置信度和县区分块各 51 个文件。
- SSP1-2.6 与 SSP5-8.5 的 2026—2050 年对应文件各 25 个。
- `model.html` 的静态验证数字与 `assets/data/validation.js` 一致。
- 下载区工作簿与模型输出目录中的最终版本一致。
- 不提交天地图密钥、服务器私钥、域名证书或其他凭据。

