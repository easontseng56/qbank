#!/usr/bin/env python3
"""把控制板試算表五個分頁的值（Sheets get_values 回傳的 values 陣列）轉成 dashboard/data.json。
用法：python3 build_dashboard_data.py sheets.json > data.json
sheets.json 格式：{"題庫總覽":[[...],...], "來源待處理":[...], "本週結果":[...], "網站份數":[...], "待Eason處理":[...]}
"""
import json, sys, datetime

def cell(row, i):
    return row[i].strip() if i < len(row) and row[i] is not None else ''

def num(s):
    try: return int(str(s).replace(',', ''))
    except: return 0

S = json.load(open(sys.argv[1], encoding='utf-8'))
out = {
    'updated': datetime.date.today().isoformat(),
    'schedule': '每週一 08:40（台北）排程「每週題庫池檢查」',
    'control_sheet': 'https://docs.google.com/spreadsheets/d/1V8LvhY-eh66mBTe7kp2eSXXIqs-_OUSxHXf498O_P9c/edit',
    'banks': [], 'pending_sources': [], 'runs': [], 'sites': [], 'todo': []
}
for r in S.get('題庫總覽', [])[2:]:
    if not cell(r, 0) or cell(r, 0) == '合計': continue
    out['banks'].append({'name': cell(r,0), 'tier': num(cell(r,1)), 'range': cell(r,2), 'papers': num(cell(r,3)),
                         'questions': num(cell(r,4)), 'updated': cell(r,5), 'note': cell(r,6)})
for r in S.get('來源待處理', [])[2:]:
    if cell(r, 0) == '來源清單': break
    if not cell(r, 1): continue
    out['pending_sources'].append({'found': cell(r,0), 'file': cell(r,1), 'source': cell(r,2), 'type': cell(r,3), 'id': cell(r,4), 'status': cell(r,5)})
for r in S.get('本週結果', [])[2:]:
    if not cell(r, 0): continue
    out['runs'].append({'date': cell(r,0), 'new': num(cell(r,1)), 'skipped': num(cell(r,2)), 'questions': num(cell(r,3)),
                        'tier0': num(cell(r,4)), 'tier1': num(cell(r,5)), 'tier2': num(cell(r,6)), 'issues': num(cell(r,7)),
                        'pr': cell(r,8) if cell(r,8).startswith('http') else '', 'note': cell(r,9) if cell(r,8).startswith('http') else (cell(r,8)+' '+cell(r,9)).strip()})
out['runs'].reverse()  # 最新在前
for r in S.get('網站份數', [])[2:]:
    if not cell(r, 0): continue
    out['sites'].append({'name': cell(r,0), 'url': cell(r,1), 'repo': cell(r,2), 'count': cell(r,3), 'updated': cell(r,4), 'pr': cell(r,5)})
for r in S.get('待Eason處理', [])[2:]:
    if not cell(r, 1): continue
    out['todo'].append({'date': cell(r,0), 'item': cell(r,1), 'done': cell(r,4).upper() == 'TRUE'})
out['todo'].sort(key=lambda t: t['done'])
if '--sync' in sys.argv:
    out['sync'] = json.load(open(sys.argv[sys.argv.index('--sync') + 1], encoding='utf-8'))
json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
