#!/usr/bin/env python3
"""Validate local references and annual runtime assets."""
from __future__ import annotations
import argparse, re, shutil, subprocess, sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

class RefParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.refs=[]; self.ids=set()
    def handle_starttag(self, tag, attrs):
        values=dict(attrs)
        if values.get("id"): self.ids.add(values["id"])
        for attr in ("href","src","poster"):
            if values.get(attr): self.refs.append((attr,values[attr]))

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--root",type=Path,default=Path(__file__).resolve().parents[1]); root=ap.parse_args().root.resolve()
    errors=[]; warnings=[]; html_files=sorted(root.glob("*.html")); parsed={}
    if not html_files: errors.append("No HTML files found")
    for html in html_files:
        p=RefParser()
        try: p.feed(html.read_text(encoding="utf-8")); parsed[html]=p
        except Exception as exc: errors.append(f"{html.name}: HTML parse failed: {exc}")
    ignored={"http","https","mailto","tel","data","javascript"}
    for html,p in parsed.items():
        for attr,raw in p.refs:
            parts=urlsplit(raw)
            if parts.scheme.lower() in ignored or raw.startswith("//"): continue
            target=html if not parts.path else (html.parent/unquote(parts.path)).resolve()
            try: target.relative_to(root)
            except ValueError: errors.append(f"{html.name}: {attr} escapes repository: {raw}"); continue
            if not target.exists(): errors.append(f"{html.name}: missing {attr} target: {raw}"); continue
            frag=unquote(parts.fragment)
            if frag and "=" not in frag and target.suffix.lower()==".html":
                tp=parsed.get(target)
                if tp and frag not in tp.ids: errors.append(f"{html.name}: missing fragment #{frag} in {target.name}")
    css_re=re.compile(r"url\(\s*(['\"]?)([^)'\"]+)\1\s*\)",re.I)
    for css in root.rglob("*.css"):
        for _,raw in css_re.findall(css.read_text(encoding="utf-8")):
            if raw.startswith(("data:","http:","https:","#","//")): continue
            if not (css.parent/urlsplit(raw).path).resolve().exists(): errors.append(f"{css.relative_to(root)}: missing CSS asset: {raw}")
    required=["index.html","region.html","model.html","data.html","about.html","assets/data/core.js","assets/data/geo.js","assets/data/validation.js","assets/downloads/per_class_metrics_1km_2020-2025.xlsx","assets/downloads/model_comparison_1km_2020-2025.xlsx"]
    for item in required:
        if not (root/item).is_file(): errors.append(f"Missing required runtime file: {item}")
    expected={
      "assets/tiles/cls_{year}.js":range(2000,2051),"assets/tiles/conf_{year}.js":range(2000,2051),"assets/data/year/k_{year}.js":range(2000,2051),
      "assets/tiles/cls_ssp126_{year}.js":range(2026,2051),"assets/tiles/conf_ssp126_{year}.js":range(2026,2051),"assets/data/year/k_ssp126_{year}.js":range(2026,2051),
      "assets/tiles/cls_ssp585_{year}.js":range(2026,2051),"assets/tiles/conf_ssp585_{year}.js":range(2026,2051),"assets/data/year/k_ssp585_{year}.js":range(2026,2051)}
    for pattern,years in expected.items():
        missing=[str(y) for y in years if not (root/pattern.format(year=y)).is_file()]
        if missing: errors.append(f"Missing annual assets for {pattern}: {', '.join(missing)}")
    node=shutil.which("node"); js_files=sorted((root/"assets").rglob("*.js"))
    if node:
        for js in js_files:
            run=subprocess.run([node,"--check",str(js)],capture_output=True,text=True)
            if run.returncode: errors.append(f"{js.relative_to(root)}: {run.stderr.strip()}")
    else: warnings.append("Node.js not found; JavaScript syntax check skipped")
    config=root/"assets/js/config.js"
    if config.is_file() and "tk: ''" in config.read_text(encoding="utf-8"): warnings.append("Tianditu key is empty; built-in schematic base map will be used")
    size=sum(p.stat().st_size for p in root.rglob("*") if p.is_file())
    print(f"Checked {len(html_files)} HTML files, {len(js_files)} JavaScript files, {size/1048576:.1f} MiB")
    for x in warnings: print("WARNING:",x)
    for x in errors: print("ERROR:",x,file=sys.stderr)
    if errors: print(f"FAILED: {len(errors)} error(s)",file=sys.stderr); return 1
    print("PASSED: repository and runtime assets are complete"); return 0
if __name__=="__main__": raise SystemExit(main())

