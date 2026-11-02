#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
題庫池同步檢查：比對「工作區 JSON（正本）」與各成品／網站的卷清單，列出缺漏。

比對對象（target）：
  zip      講義專案用題庫 zip（06_打包\講義專案用題庫，容器副本 /mnt/project-files/講義專案用題庫_20261025）
  diff     難度.json（03_JSON\難度.json）
  offline  離線出題系統 題庫資料夾（06_打包\離線出題系統\題庫；用 device_list_dir 存成 offline_listing.json）
  site     網站：段考 chem-exam、模考 chem-exam/mock、化奧 chem-olympiad（index.html 用 gh api 抓）
  catalog  段考目錄 目錄.json（03_JSON\索引）

用法：
  python3 check_sync.py --banks /mnt/project-files --zips /mnt/project-files/講義專案用題庫_20261025 /mnt/project-files/題庫池_寫入/03_JSON \
      --difficulty /mnt/project-files/題庫池_寫入/03_JSON/難度.json --offline offline_listing.json \
      --chem-exam chem-exam.html --mock mock.html --olympiad olympiad.html \
      --catalog /mnt/project-files/題庫池_寫入/03_JSON/索引/目錄.json -o sync.json
輸出 sync.json：{"checked":日期, "ok":bool, "banks":[{name, master, targets:[{target,label,count,missing,extra,status,note}]}]}
"""
import argparse, glob, json, os, re, sys, zipfile, datetime

# 題庫定義：name, 工作區 json 路徑 glob, 離線／zip 資料夾名（前綴）, 網站
BANKS = [
    dict(name="段考",            tier=2, glob="段考/json/*.json",                      folder="Tier2_段考",          site="chem-exam"),
    dict(name="學測模考",        tier=1, glob="學測模考/json/*.json",                  folder="Tier1_學測模考",      site="mock:a"),
    dict(name="指考分科模考",    tier=1, glob="指考分科模考/json/*.json",              folder="Tier1_指考分科模考",  site="mock:b"),
    dict(name="學測歷屆",        tier=1, glob="學測歷屆/json/*.json",                  folder="Tier1_學測歷屆",      site=None),
    dict(name="指考分科歷屆",    tier=1, glob="指考歷屆/json/*.json",                  folder="Tier1_指考分科歷屆",  site=None),
    dict(name="化學奧林匹亞初選", tier=0, glob="化學奧林匹亞/json/*.json",              folder="Tier0_化學奧林匹亞初選", site="olympiad"),
    dict(name="清華盃初賽",      tier=0, glob="清華盃初賽/_工具/json/*/*.json",        folder="Tier0_清華盃初賽",    site=None),
    dict(name="學科能力競賽地區複賽", tier=0, glob="學科能力競賽地區複賽/_工具/json/*/*.json", folder="Tier0_學科能力競賽地區複賽", site=None),
    dict(name="龍騰題庫光碟",    tier=3, glob="題庫光碟_龍騰/json/*.json",             folder="Tier3_龍騰題庫光碟",  site=None),
    dict(name="大學普化原創",    tier=0, glob="大學普化原創/json/*.json",               folder="Tier0_大學普化原創",  site=None),
]
SKIP_STEMS = {"圖片尺寸", "說明", "desktop"}

def stem(p):
    return os.path.splitext(os.path.basename(p))[0]

def master_set(root, b):
    return {stem(p) for p in glob.glob(os.path.join(root, b["glob"])) if stem(p) not in SKIP_STEMS}

def zip_set(zipdirs, b):
    s = set()
    if not zipdirs: return None
    found = False
    for z in [z for d in zipdirs for z in glob.glob(os.path.join(d, b["folder"] + "*.zip"))]:
        found = True
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                if n.endswith(".json") and "/img/" not in n and not n.startswith("img/"):
                    st = stem(n)
                    if st not in SKIP_STEMS: s.add(st)
    return s if found else None

def difficulty_set(path, b):
    if not path or not os.path.exists(path): return None
    d = json.load(open(path, encoding="utf-8"))
    s = set()
    for k in d.get("levels", {}):
        m = re.match(r"題庫/([^/]+)/(.+?\.json)#", k)
        if m and m.group(1).startswith(b["folder"]):
            s.add(stem(m.group(2)))
    return s if s or any(k.split("/")[1].startswith(b["folder"]) for k in d.get("levels", {}) if k.count("/") >= 2) else None

def offline_set(path, b):
    if not path or not os.path.exists(path): return None
    d = json.load(open(path, encoding="utf-8"))
    for folder, files in d.items():
        if folder.startswith(b["folder"]):
            return {stem(f) for f in files if stem(f) not in SKIP_STEMS}
    return None

# ---- 網站 ----
SEM = {"一": "上", "二": "下"}
def chem_exam_set(html):
    m = re.search(r"const DATA=(\[.*?\]);", html, re.S)
    data = json.loads(m.group(1))
    return {f"{x['y']}{x['sc']}{x['g']}{SEM.get(x['s'], x['s'])}第{x['e']}次" for x in data}

def norm_mock(full, group):
    f = full
    f = f.replace("翰林全模E", "全模E").replace("南一全模N", "全模N")
    f = re.sub(r"^銓達T", "全模(詮達)", f); f = re.sub(r"^銓達S", "全模(詮達)S", f)
    f = f.replace("南一高二複習", "高二複習N").replace("翰林高二複習R", "高二複習R")
    if group == "b":  # 指考模考 JSON 的北模沒有 B
        f = f.replace("北模B", "北模")
    return f

def mock_set(html, group):
    m = re.search(r"const DATA=(\{.*?\});\s*\n", html, re.S)
    data = json.loads(m.group(1))
    return {f"{x['y']}{norm_mock(x['full'], group)}" for x in data.get(group, [])}

def olympiad_set(html):
    return {f"{y}化奧初選" for y in re.findall(r'data-paper="(\d{4}) 化奧初選 題目"', html)}

def catalog_private(path):
    """目錄.json 標「不公開」的段考卷（網站本來就不放）"""
    if not path or not os.path.exists(path): return set()
    d = json.load(open(path, encoding="utf-8")); rows = d.get("catalog", [])
    if not rows: return set()
    idx = {h: i for i, h in enumerate(rows[0])}; s = set()
    for r in rows[1:]:
        try:
            y, sem, no, g, sc, pub = (r[idx[k]] for k in ("學年", "學期", "考次", "年級", "學校", "公開"))
        except Exception: continue
        if y and sc and str(pub).strip() == "不公開": s.add(f"{y}{sc}{g}{SEM.get(sem, sem)}第{no}次")
    return s

def catalog_set(path):
    if not path or not os.path.exists(path): return None
    d = json.load(open(path, encoding="utf-8"))
    rows = d.get("catalog", [])
    if not rows: return None
    hdr = rows[0]; idx = {h: i for i, h in enumerate(hdr)}
    s = set()
    for r in rows[1:]:
        try:
            y, sem, no, g, sc, pub = (r[idx[k]] for k in ("學年", "學期", "考次", "年級", "學校", "公開"))
        except Exception:
            continue
        if not y or not sc: continue
        s.add(f"{y}{sc}{g}{SEM.get(sem, sem)}第{no}次")
    return s

def compare(name, label, master, target, note="", extra_is_info=False):
    """missing＝正本有、對象沒有（對象落後，status=miss）；extra＝對象有、正本沒有。
    網站／目錄的 extra 是「原卷已收、題庫尚未建檔」（待建檔，status=todo）；zip／難度／離線的 extra 是多餘檔（warn）。"""
    if target is None:
        return dict(target=name, label=label, count=None, missing=[], extra=[], status="none", note=note or "尚未收錄此題庫")
    missing = sorted(master - target); extra = sorted(target - master)
    if missing: status = "miss"
    elif extra: status = "todo" if extra_is_info else "warn"
    else: status = "ok"
    return dict(target=name, label=label, count=len(target), missing=missing, extra=extra, status=status, note=note, extra_kind=("todo" if extra_is_info else "warn"))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--banks", required=True)
    ap.add_argument("--zips", nargs="*"); ap.add_argument("--difficulty"); ap.add_argument("--offline")
    ap.add_argument("--chem-exam"); ap.add_argument("--mock"); ap.add_argument("--olympiad"); ap.add_argument("--catalog")
    ap.add_argument("-o", "--out", default="sync.json")
    a = ap.parse_args()
    rd = lambda p: open(p, encoding="utf-8").read() if p and os.path.exists(p) else None
    ce, mk, ol = rd(a.chem_exam), rd(a.mock), rd(a.olympiad)
    out = dict(checked=datetime.date.today().isoformat(), banks=[])
    for b in BANKS:
        master = master_set(a.banks, b)
        row = dict(name=b["name"], tier=b["tier"], master=len(master), targets=[])
        row["targets"].append(compare("zip", "講義專案用題庫 zip", master, zip_set(a.zips, b)))
        row["targets"].append(compare("diff", "難度.json", master, difficulty_set(a.difficulty, b)))
        row["targets"].append(compare("offline", "離線出題題庫", master, offline_set(a.offline, b)))
        site = b["site"]
        if site == "chem-exam":
            priv = catalog_private(a.catalog)
            t = compare("site", "段考網站 chem-exam", master - priv, chem_exam_set(ce) if ce else None, extra_is_info=True)
            if priv & master: t["note"] = f"不公開卷不比對：{'、'.join(sorted(priv & master))}"
            row["targets"].append(t)
            row["targets"].append(compare("catalog", "段考目錄 目錄.json", master, catalog_set(a.catalog), extra_is_info=True))
        elif site and site.startswith("mock:"):
            row["targets"].append(compare("site", "模考網站 mock", master, mock_set(mk, site[-1]) if mk else None,
                                          note="網站只放有原卷的卷", extra_is_info=True))
        elif site == "olympiad":
            row["targets"].append(compare("site", "化奧網站 chem-olympiad", master, olympiad_set(ol) if ol else None, extra_is_info=True))
        sts = {t["status"] for t in row["targets"]}
        row["status"] = "miss" if "miss" in sts else ("warn" if "warn" in sts else ("todo" if "todo" in sts else "ok"))
        out["banks"].append(row)
    out["ok"] = all(r["status"] in ("ok", "todo") for r in out["banks"])
    out["summary"] = dict(miss=sum(len(t["missing"]) for r in out["banks"] for t in r["targets"]),
                          todo=sum(len(t["extra"]) for r in out["banks"] for t in r["targets"] if t["status"] == "todo"),
                          warn=sum(len(t["extra"]) for r in out["banks"] for t in r["targets"] if t["status"] == "warn"))
    json.dump(out, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    # 摘要
    for r in out["banks"]:
        mark = {"ok": "✓", "todo": "△", "warn": "!", "miss": "✗"}[r["status"]]
        print(f"[{mark}] {r['name']}（正本 {r['master']} 份）")
        for t in r["targets"]:
            if t["status"] in ("ok", "none"): continue
            lab = "待建檔" if t.get("extra_kind") == "todo" else "多餘"
            print(f"    {t['label']}：{t['count']} 份；落後 {len(t['missing'])}：{t['missing'][:8]}{'…' if len(t['missing'])>8 else ''}；{lab} {len(t['extra'])}：{t['extra'][:8]}{'…' if len(t['extra'])>8 else ''}")
    return 0 if out["ok"] else 1

if __name__ == "__main__":
    sys.exit(main())
