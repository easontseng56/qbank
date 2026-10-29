// 主程式：資料夾連線、篩選瀏覽、考卷籃、自動抽題、列印、出題紀錄、設定
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const today = () => new Date().toISOString().slice(0, 10);
const DEFAULT_CONST = ['原子量：H ＝ 1、C ＝ 12、N ＝ 14、O ＝ 16、Na ＝ 23、Mg ＝ 24、Al ＝ 27、S ＝ 32、Cl ＝ 35.5、K ＝ 39、Ca ＝ 40、Fe ＝ 56、Cu ＝ 63.5、Zn ＝ 65、Ag ＝ 108（題目另有給定者依題目）'];
const DIFF_NAME = { 1: '1 基本', 2: '2 單步', 3: '3 中上', 4: '4 進階', 5: '5 競賽' };
const TIER_ORDER = ['0', '0+1', '0+1+2', '0+1+2+3', '0+2+3', '0+3', '1', '1+2', '1+2+3', '2', '2+3', '3'];
const TIER_NAME = { '0': '競賽', '1': '大考', '2': '段考', '3': '光碟' };
// Tier 字串「0+1」→「競賽·大考」（使用者 2026-10-28：0+1、0+1+2 不直覺）
const tierLabel = tiers => [...new Set(tiers.flatMap(t => t.split('+')))].sort().map(d => TIER_NAME[d] || d).join('·');

const S = {
  fs: null, all: [], byId: new Map(), filtered: [], page: 0, pageSize: 50, sel: null, sort: 'yearDesc',
  filter: { secs: new Set(), secondaryToo: false, tiers: new Set(), sources: new Set(), subs: new Set(), yMin: '', yMax: '',
    types: new Set(), tags: new Set(), extra: new Set(), diff: new Set(), ltd: new Set(), kw: '', hideUsed: false },
  basket: null, history: { exams: [] }, used: new Map(), diff: {}, diffCount: 0,
  settings: { classes: [], constants: DEFAULT_CONST, watermark: false, titleImg: true, fontSize: 10 },
  facets: { subs: {} }, imgCache: new Map(),
};
function newBasket() {
  return { id: 'E' + Date.now().toString(36), title: '', subtitle: '', range: '', cls: '', date: today(), constants: [...S.settings.constants],
    items: [], score: 'auto', manual: { '單選': 4, '多選': 6, '非選': 6 }, opts: { watermark: !!S.settings.watermark, titleImg: S.settings.titleImg !== false, space: false, hideTag: false }, recorded: false };
}

// ---------- 檔案讀寫 ----------
async function readJson(path, dflt) {
  try {
    if (S.fs.kind === 'http') { const t = localStorage.getItem('file:' + path); if (t) return JSON.parse(t); }
    return JSON.parse(await S.fs.readText(path));
  } catch (e) { return dflt; }
}
async function writeJson(path, obj) {
  try { await S.fs.writeText(path, JSON.stringify(obj, null, 1)); return true; }
  catch (e) { toast('寫入失敗：' + path + '（' + e.message + '）'); return false; }
}
function toast(msg, ms = 3500) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), ms);
}
function status(msg) { $('#status').textContent = msg; }
// 網路版多帳號：主帳號用原本的檔；其他帳號各自一份（紀錄/出題紀錄_帳號.json、考卷/帳號/）
function acctSuffix() { const u = S.fs && S.fs.kind === 'drive' && S.fs.user; return u && u !== (CONFIG.primaryAccount || '') ? u.split('@')[0].replace(/[^\w.-]/g, '_') : ''; }
function histPath() { const a = acctSuffix(); return a ? `紀錄/出題紀錄_${a}.json` : '紀錄/出題紀錄.json'; }
function examDir() { const a = acctSuffix(); return a ? `考卷/${a}` : '考卷'; }

// ---------- 啟動 ----------
async function init() {
  await IDB.open();
  const isHttp = location.protocol.startsWith('http');
  if (isHttp) {
    let root = null;
    try { const r = await fetch('/api/ping'); if (r.ok) { const j = await r.json(); if (j && j.ok) root = j.root; } } catch (e) { }
    if (root != null) {
      S.fs = new ServerFS(root);
      $('#btnConnect').style.display = 'none';   // exe／伺服器模式不需要選資料夾
      await loadSideFiles(); await loadCached(); if (!S.all.length) await rescan();
    } else if (window.CONFIG && CONFIG.clientId) {   // 網路版：Google 登入 ＋ 雲端硬碟
      S.fs = new DriveFS(CONFIG);
      $('#btnConnect').textContent = '用 Google 登入';
      await loadCached();
      if (S.fs.loggedIn()) { await afterLogin(); }
      else status('請按右上「用 Google 登入」，系統會讀取你雲端硬碟裡的題庫。' + (S.all.length ? '（先顯示上次快取的題庫）' : ''));
    } else {
      S.fs = new HttpFS();
      $('#btnConnect').style.display = 'none';
      await loadSideFiles(); await loadCached(); if (!S.all.length) await rescan();
    }
  } else {
    const h = await IDB.get('root');
    if (h) {
      S.fs = new DirFS(h);
      const p = await h.queryPermission({ mode: 'readwrite' });
      if (p === 'granted') { await loadSideFiles(); await loadCached(); if (!S.all.length) await rescan(); }
      else { status('請按「連線資料夾」重新授權（' + h.name + '）'); $('#btnConnect').textContent = '連線資料夾 ' + h.name; }
    } else status('第一次使用：請按「選擇資料夾」，指到「離線出題系統」這個資料夾。');
  }
  if (!S.basket) S.basket = newBasket();
  const draft = localStorage.getItem('basketDraft');
  if (draft) { try { const b = JSON.parse(draft); if (b.items.length) S.basket = b; } catch (e) { } }
  bindUI(); renderBasket(); renderSettings(); renderHistory();
}
async function afterLogin() {
  $('#btnConnect').textContent = '重新整理';
  try { await loadSideFiles(); } catch (e) { toast('讀取設定失敗：' + e.message, 6000); }
  await rescan();
  renderBasket(); renderSettings(); renderHistory();
}
async function connect() {
  if (S.fs && S.fs.kind === 'drive') {
    if (!S.fs.loggedIn()) {
      try { status('Google 登入中…'); await S.fs.login(true); } catch (e) { status('登入失敗：' + e.message); return; }
    }
    return afterLogin();
  }
  if (S.fs && S.fs.kind !== 'dir') return rescan();
  let h = await IDB.get('root');
  try {
    if (h) { const p = await h.requestPermission({ mode: 'readwrite' }); if (p !== 'granted') h = null; }
    if (!h) { h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'chemq' }); await IDB.set('root', h); }
  } catch (e) { if (e.name !== 'AbortError') toast('無法開啟資料夾：' + e.message); return; }
  S.fs = new DirFS(h); $('#btnConnect').textContent = '連線資料夾 ' + h.name;
  if (!(await S.fs.exists('題庫')) && !(await dirExists('題庫'))) toast('這個資料夾裡沒有「題庫」子資料夾，請確認選的是「離線出題系統」。', 6000);
  await loadSideFiles(); await loadCached(); await rescan();
  renderBasket(); renderSettings(); renderHistory();
}
async function dirExists(p) { try { await S.fs._dir(p.split('/')); return true; } catch (e) { return false; } }
async function loadCached() {
  status('讀取快取…');
  const papers = new Map((await IDB.allPapers()).map(p => [p.path, p]));
  if (papers.size) afterIndex(buildIndex(papers));
}
async function rescan() {
  if (!S.fs) return toast('請先連線資料夾');
  $('#btnScan').disabled = true;
  try {
    const r = await scanBank(S.fs, (n, N, p) => status(`掃描題庫 ${n}/${N}　${p.split('/').pop()}`));
    afterIndex(buildIndex(r.papers));
    toast(`掃描完成：更新 ${r.changed} 份、移除 ${r.removed} 份，共 ${S.all.length} 題`);
  } catch (e) { toast('掃描失敗：' + e.message, 6000); console.error(e); }
  $('#btnScan').disabled = false;
}
async function loadSideFiles() {
  S.settings = Object.assign({ classes: [], constants: DEFAULT_CONST, watermark: false, titleImg: true, fontSize: 10 }, await readJson('設定/設定.json', {}));
  S.history = await readJson(histPath(), { exams: [] });
  if (!Array.isArray(S.history.exams)) S.history.exams = [];
  rebuildUsed();
  S.diff = await readJson('難度/難度.json', {});
  if (S.diff && S.diff.levels) S.diff = S.diff.levels;
  S.diffCount = Object.keys(S.diff).length;
}
function rebuildUsed() {
  S.used = new Map();
  for (const e of S.history.exams) for (const id of e.qids || []) {
    if (!S.used.has(id)) S.used.set(id, []);
    S.used.get(id).push({ date: e.date, name: e.name, cls: e.cls });
  }
}
function diffRec(r) {   // 優先讀題目 JSON 內的 difficulty，沒有才查 難度/難度.json（ID 或標籤當 key）
  return (r && r.q && r.q.difficulty) || S.diff[r.id] || S.diff[r.tag];
}
function diffOf(r) {
  const d = diffRec(r);
  if (d == null) return null;
  return typeof d === 'object' ? Number(d.level) : Number(d);
}
function afterIndex(all) {
  S.all = all; S.byId = new Map(all.map(r => [r.id, r]));
  S.diffCount = all.reduce((n, r) => n + (diffOf(r) != null ? 1 : 0), 0);
  const subs = {};
  for (const r of all) { if (!subs[r.source]) subs[r.source] = new Map(); if (r.sub) subs[r.source].set(r.sub, (subs[r.source].get(r.sub) || 0) + 1); }
  S.facets.subs = subs;
  S.facets.tiers = [...new Set(all.flatMap(r => r.tiers))].sort((a, b) => (TIER_ORDER.indexOf(a) + 99) % 99 - (TIER_ORDER.indexOf(b) + 99) % 99 || a.localeCompare(b));
  S.facets.sources = SOURCE_ORDER.filter(s => all.some(r => r.source === s));
  S.facets.types = [...new Set(all.map(r => r.type))].sort((a, b) => (TYPE_ORDER[a] ?? 9) - (TYPE_ORDER[b] ?? 9));
  S.facets.tags = [...new Set(all.flatMap(r => r.tags))].filter(t => !['單選', '多選', '非選'].includes(t) && !S.facets.types.includes(t)).sort((a, b) => (KNOWN_TAGS.indexOf(a) + 99) % 99 - (KNOWN_TAGS.indexOf(b) + 99) % 99);
  const years = all.map(r => r.roc).filter(Boolean);
  S.facets.yMin = Math.min(...years); S.facets.yMax = Math.max(...years);
  renderFilters(); applyFilter();
  status(`題庫 ${S.all.length.toLocaleString()} 題（${new Set(all.map(r => r.path)).size} 份）${S.diffCount ? '　難度已分級 ' + S.diffCount.toLocaleString() + ' 題' : '　尚無難度檔'}`);
  // 考卷籃內的題目重新對應
  if (S.basket) S.basket.items = S.basket.items.filter(id => S.byId.has(id));
}

// ---------- 篩選 ----------
function renderFilters() {
  const F = S.facets;
  // 章節樹（可收合、父層連動、半勾）
  let h = '<label class="all"><input type="checkbox" id="chapAll"> 全選</label>';
  for (const b of BOOKS) {
    h += `<div class="node"><span class="tw">▸</span><label class="bk"><input type="checkbox" data-book="${b}"> <b>${BOOK_FULL[b]}</b></label><div class="kids" hidden>`;
    for (const c in CHAP[b]) {
      h += `<div class="node"><span class="tw">▸</span><label class="ch"><input type="checkbox" data-chap="${b}|${c}"> 第${c}章 ${CHAP[b][c]}</label><div class="kids" hidden>`;
      for (const s in SEC[b]) if (s[0] === c) h += `<label class="sec"><input type="checkbox" data-sec="${b} ${s}"> ${s} ${SEC[b][s]}</label>`;
      h += '</div></div>';
    }
    h += '</div></div>';
  }
  $('#chapTree').innerHTML = h;
  $('#fTiers').innerHTML = ['0', '1', '2', '3'].filter(d => F.tiers.some(t => t.split('+').includes(d))).map(d => `<label><input type="checkbox" data-tier="${d}"> ${TIER_NAME[d]}（Tier ${d}）</label>`).join('');
  $('#fSources').innerHTML = F.sources.map(s => `<label><input type="checkbox" data-source="${s}"> ${s}</label>`).join('');
  $('#fTypes').innerHTML = F.types.map(t => `<label><input type="checkbox" data-type="${t}"> ${t}</label>`).join('');
  $('#fTags').innerHTML = F.tags.map(t => `<label><input type="checkbox" data-tag="${t}"> ${t}</label>`).join('')
    + ['有圖', '題組', '有疑義'].map(t => `<label><input type="checkbox" data-extra="${t}"> ${t}</label>`).join('');
  $('#fYMin').placeholder = F.yMin; $('#fYMax').placeholder = F.yMax;
  $('#fDiff').innerHTML = [1, 2, 3, 4, 5].map(d => `<label><input type="checkbox" data-diff="${d}"> ${DIFF_NAME[d]}</label>`).join('') + `<label><input type="checkbox" data-diff="0"> 未分級</label>`;
  $('#fLtd').innerHTML = ['易', '中', '難'].map(d => `<label><input type="checkbox" data-ltd="${d}"> ${d}</label>`).join('');
  $('#diffBox').style.display = S.diffCount ? '' : 'none';
  renderSubs();
}
function syncTree() {   // 依 F.secs 更新章節樹的勾選與半勾
  const F = S.filter;
  $$('#chapTree input[data-sec]').forEach(x => x.checked = F.secs.has(x.dataset.sec));
  const st = els => { const n = els.filter(x => x.checked).length, i = els.filter(x => x.indeterminate).length; return [n === els.length && !i, (n > 0 || i > 0) && n < els.length]; };
  for (const b of BOOKS) {
    for (const c in CHAP[b]) { const el = $(`#chapTree input[data-chap="${b}|${c}"]`); [el.checked, el.indeterminate] = st($$(`#chapTree input[data-sec^="${b} ${c}-"]`)); }
    const el = $(`#chapTree input[data-book="${b}"]`); [el.checked, el.indeterminate] = st($$(`#chapTree input[data-chap^="${b}|"]`));
  }
  const all = $('#chapAll'); if (all) [all.checked, all.indeterminate] = st($$('#chapTree input[data-book]'));
}
function renderSubs() {
  const sel = S.filter.sources.size ? [...S.filter.sources] : [];
  let h = '';
  for (const src of sel) {
    const m = S.facets.subs[src]; if (!m || !m.size) continue;
    h += `<div class="subgrp"><span>${src}：</span>` + [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<label><input type="checkbox" data-sub="${esc(k)}" ${S.filter.subs.has(k) ? 'checked' : ''}> ${esc(k)} <i>${n}</i></label>`).join('') + '</div>';
  }
  $('#fSubs').innerHTML = h || '<span class="hint">勾選來源後可再選卷別／學校</span>';
}
function matches(r) {
  const f = S.filter;
  if (f.secs.size) {
    let ok = r.mains.some(c => f.secs.has(c));
    if (!ok && f.secondaryToo) ok = r.secs.some(c => f.secs.has(c));
    if (!ok) return false;
  }
  if (f.tiers.size && !r.tiers.some(t => t.split('+').some(d => f.tiers.has(d)))) return false;   // 勾「競賽」＝含 Tier 0 的都算（0、0+1、0+1+2…）
  if (f.sources.size && !f.sources.has(r.source)) return false;
  if (f.subs.size && !f.subs.has(r.sub)) return false;
  if (f.yMin && r.roc < Number(f.yMin)) return false;
  if (f.yMax && r.roc > Number(f.yMax)) return false;
  if (f.types.size && !f.types.has(r.type)) return false;
  if (f.tags.size) for (const t of f.tags) if (!r.tags.includes(t)) return false;
  if (f.extra.has('有圖') && !r.hasImg) return false;
  if (f.extra.has('題組') && !r.group) return false;
  if (f.extra.has('有疑義') && !r.doubt) return false;
  if (f.diff.size) { const d = diffOf(r); if (!f.diff.has(d == null ? 0 : d)) return false; }
  if (f.ltd.size && !f.ltd.has(r.ltd)) return false;
  if (f.hideUsed && S.used.has(r.id)) return false;
  if (f.kw) for (const k of f.kw) if (!r.text.includes(k)) return false;
  return true;
}
const SORTS = {
  yearDesc: (a, b) => b.roc - a.roc || a.path.localeCompare(b.path) || a.si - b.si || a.qi - b.qi,
  yearAsc: (a, b) => a.roc - b.roc || a.path.localeCompare(b.path) || a.si - b.si || a.qi - b.qi,
  diffAsc: (a, b) => (diffOf(a) ?? 9) - (diffOf(b) ?? 9) || b.roc - a.roc,
  diffDesc: (a, b) => (diffOf(b) ?? -1) - (diffOf(a) ?? -1) || b.roc - a.roc,
  chap: (a, b) => (a.mains[0] ? chapterOrder(a.mains[0]) : 999) - (b.mains[0] ? chapterOrder(b.mains[0]) : 999) || b.roc - a.roc,
  source: (a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) || b.roc - a.roc,
};
function applyFilter() {
  S.filter.kw = $('#fKw').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  S.filtered = S.all.filter(matches).sort(SORTS[S.sort]);
  S.page = 0; renderList();
}
function filterSummary() {
  const f = S.filter, p = [];
  if (f.secs.size) p.push('章節 ' + [...f.secs].sort((a, b) => chapterOrder(a) - chapterOrder(b)).join('、') + (f.secondaryToo ? '（含次要）' : ''));
  if (f.tiers.size) p.push([...f.tiers].sort().map(d => TIER_NAME[d]).join('/'));
  if (f.sources.size) p.push('來源 ' + [...f.sources].join('、'));
  if (f.subs.size) p.push([...f.subs].join('、'));
  if (f.yMin || f.yMax) p.push(`年份 ${f.yMin || ''}～${f.yMax || ''}`);
  if (f.types.size) p.push([...f.types].join('/'));
  if (f.tags.size || f.extra.size) p.push([...f.tags, ...f.extra].join('、'));
  if (f.diff.size) p.push('難度 ' + [...f.diff].sort().join('/'));
  if (f.ltd.size) p.push('光碟難易 ' + [...f.ltd].join('/'));
  if (f.kw && f.kw.length) p.push('關鍵字「' + f.kw.join(' ') + '」');
  if (f.hideUsed) p.push('隱藏已出過');
  return p.length ? p.join('；') : '（無篩選）';
}
function usedLabel(r) {
  const u = S.used.get(r.id); if (!u) return '';
  const last = u[u.length - 1];
  return `出過 ${u.length} 次，最近 ${last.date}${last.cls ? ' ' + last.cls : ''}`;
}
function renderList() {
  const N = S.filtered.length, from = S.page * S.pageSize, rows = S.filtered.slice(from, from + S.pageSize);
  $('#count').textContent = `${N.toLocaleString()} 題`;
  $('#pager').textContent = N ? `${from + 1}–${Math.min(N, from + S.pageSize)}` : '';
  const inB = new Set(S.basket ? S.basket.items : []);
  $('#list').innerHTML = rows.map(r => {
    const d = diffOf(r);
    return `<div class="row ${r.id === S.sel ? 'sel' : ''} ${inB.has(r.id) ? 'inb' : ''}" data-id="${esc(r.id)}"><div class="rmain">
      <div class="r1"><span class="tag">${esc(r.tag)}</span><span class="pill t${r.tg}">${esc(r.type)}</span>
        <span class="pill tier">${tierLabel(r.tiers)}</span>${d ? `<span class="pill d${d}">難${d}</span>` : ''}${r.ltd ? `<span class="pill ltd">${r.ltd}</span>` : ''}
        ${r.hasImg ? '<span class="pill">圖</span>' : ''}${r.doubt ? '<span class="pill doubt">疑</span>' : ''}
        <span class="chapters">${r.mains.map(chapterName).join('、')}${r.secs.length ? '｜次 ' + r.secs.join('、') : ''}</span>
        <span class="used">${usedLabel(r)}</span></div>
      <div class="r2">${esc(r.head).slice(0, 110)}</div></div>
      <button class="addb ${inB.has(r.id) ? 'on' : ''}" data-add="${esc(r.id)}" title="${inB.has(r.id) ? '已在考卷籃，按一下移出' : '加入考卷籃'}">${inB.has(r.id) ? '✓ 已加入' : '＋ 加入'}</button></div>`;
  }).join('') || `<div class="empty"><p>沒有符合的題目。</p><p>試著少勾幾個條件，或 <button class="lnk" id="btnClear2">清除全部篩選</button></p></div>`;
  renderChips(); renderFlow();
}
// 篩選標籤列：目前生效的條件，每個可單獨 ✕ 取消
function renderChips() {
  const f = S.filter, c = [];
  const chip = (k, t) => c.push(`<span class="chip">${esc(t)}<button data-clear="${k}" title="取消這個條件">✕</button></span>`);
  if (f.kw && f.kw.length) chip('kw', '關鍵字「' + f.kw.join(' ') + '」');
  if (f.secs.size) chip('secs', '章節 ' + [...f.secs].sort((a, b) => chapterOrder(a) - chapterOrder(b)).slice(0, 6).join('、') + (f.secs.size > 6 ? `…共 ${f.secs.size} 節` : '') + (f.secondaryToo ? '（含次要）' : ''));
  if (f.tiers.size) chip('tiers', [...f.tiers].sort().map(d => TIER_NAME[d]).join('／'));
  if (f.sources.size) chip('sources', '來源 ' + [...f.sources].join('、'));
  if (f.subs.size) chip('subs', [...f.subs].join('、'));
  if (f.yMin || f.yMax) chip('year', `年份 ${f.yMin || '…'}～${f.yMax || '…'}`);
  if (f.types.size) chip('types', [...f.types].join('／'));
  if (f.tags.size) chip('tags', [...f.tags].join('、'));
  if (f.extra.size) chip('extra', [...f.extra].join('、'));
  if (f.diff.size) chip('diff', '難度 ' + [...f.diff].sort().map(d => d || '未分級').join('／'));
  if (f.ltd.size) chip('ltd', '光碟難易 ' + [...f.ltd].join('／'));
  if (f.hideUsed) chip('hideUsed', '隱藏已出過');
  $('#chips').innerHTML = c.length ? c.join('') + `<button class="lnk" id="btnClear" title="全部條件取消">清除全部</button>` : '<span class="hint">尚未設定篩選條件（顯示全部題目）。在左邊勾選章節、來源、題型，或打關鍵字。</span>';
}
function clearFilterGroup(k) {
  const F = S.filter;
  const un = sel => $$(sel).forEach(x => x.checked = false);
  if (k === 'kw') { $('#fKw').value = ''; }
  else if (k === 'secs') { F.secs.clear(); F.secondaryToo = false; $('#fSecondary').checked = false; syncTree(); }
  else if (k === 'year') { F.yMin = F.yMax = ''; $('#fYMin').value = $('#fYMax').value = ''; }
  else if (k === 'hideUsed') { F.hideUsed = false; $('#fHideUsed').checked = false; }
  else if (k === 'sources') { F.sources.clear(); F.subs.clear(); un('#fSources input'); renderSubs(); }
  else { F[k].clear(); un(`#filters input[data-${{ tiers: 'tier', subs: 'sub', types: 'type', tags: 'tag', extra: 'extra', diff: 'diff', ltd: 'ltd' }[k]}]`); }
  applyFilter();
}
function clearFilters() {
  const F = S.filter;
  for (const k of ['secs', 'tiers', 'sources', 'subs', 'types', 'tags', 'extra', 'diff', 'ltd']) F[k].clear();
  F.secondaryToo = F.hideUsed = false; F.yMin = F.yMax = ''; $('#fKw').value = '';
  $$('#filters input[type=checkbox]').forEach(x => x.checked = false); $('#fYMin').value = $('#fYMax').value = '';
  syncTree(); renderSubs(); applyFilter();
}
// 挑題頁底部的流程列
function renderFlow() {
  const n = S.basket ? S.basket.items.length : 0;
  $('#flowInfo').innerHTML = n ? `考卷籃已有 <b>${n}</b> 題` : '考卷籃是空的，先把題目加進來';
  $('#btnGoBasket').disabled = !n;
}
function stepSel(dir) {   // 在清單中上下移動選取（跨頁自動翻頁）
  const i = S.filtered.findIndex(r => r.id === S.sel);
  const j = i < 0 ? 0 : i + dir; if (j < 0 || j >= S.filtered.length) return;
  const pg = Math.floor(j / S.pageSize); if (pg !== S.page) { S.page = pg; renderList(); }
  selectRow(S.filtered[j].id);
  const el = $(`#list .row[data-id="${CSS.escape(S.filtered[j].id)}"]`); if (el) el.scrollIntoView({ block: 'nearest' });
}
function selectRow(id) {
  S.sel = id; $$('#list .row').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
  renderPreview(id);
}
async function renderPreview(id) {
  const r = S.byId.get(id); if (!r) return;
  const inB = S.basket.items.includes(id);
  const d = diffOf(r), dd = diffRec(r);
  const P = r.paper;
  $('#preview').innerHTML = `
    <div class="pv-head"><div><b>${esc(P.title || '')}</b> ${esc(P.subtitle || '')}<br><span class="tag">${esc(r.tag)}</span>
      ${r.type}　${tierLabel(r.tiers)}（Tier ${esc(r.tiers.join('、'))}）　${r.mains.map(chapterName).join('、')}${r.secs.length ? '　次要：' + r.secs.map(chapterName).join('、') : ''}
      ${d ? `　難度 ${d}${dd && dd.why ? '（' + esc(dd.why) + '）' : ''}` : ''}${r.ltd ? '　光碟難易：' + r.ltd : ''}
      ${r.tags.length ? '　標籤：' + r.tags.join('、') : ''}<br><span class="used">${usedLabel(r)}</span></div>
      <div class="pv-btn"><button class="${inB ? '' : 'pri'}" id="pvAdd" title="${inB ? '按一下從考卷籃移出' : '加入考卷籃'}">${inB ? '✓ 已加入（移出）' : '＋ 加入考卷籃'}</button><br><button id="pvPrev" title="上一題（↑）">▲ 上一題</button><button id="pvNext" title="下一題（↓）">▼ 下一題</button></div></div>
    <div class="paper pv">${groupHtml(r, { caption: true })}<div class="q">${questionHtml(r, null, { caption: true })}</div>
    <div class="q">${answerHtml(r, true)}</div></div>`;
  $('#pvAdd').onclick = () => { toggleBasket(id); renderPreview(id); };
  $('#pvPrev').onclick = () => stepSel(-1); $('#pvNext').onclick = () => stepSel(1);
  await hydrateImages($('#preview'));
}
async function imgUrl(path) {
  if (S.imgCache.has(path)) return S.imgCache.get(path);
  try { const f = await S.fs.readFile(path); const u = URL.createObjectURL(f); S.imgCache.set(path, u); return u; }
  catch (e) { S.imgCache.set(path, ''); return ''; }
}
async function hydrateImages(root) {
  const imgs = [...root.querySelectorAll('img[data-src]')];
  await Promise.all(imgs.map(async im => {
    const u = await imgUrl(im.dataset.src);
    if (u) { im.src = u; await new Promise(res => { im.onload = im.onerror = res; }); }
    else { im.replaceWith(Object.assign(document.createElement('p'), { className: 'cap', textContent: '〔圖檔遺失：' + im.dataset.src + '〕' })); }
  }));
}

// ---------- 考卷籃 ----------
function saveDraft() { localStorage.setItem('basketDraft', JSON.stringify(S.basket)); }
function toggleBasket(id) {
  const b = S.basket, i = b.items.indexOf(id);
  if (i >= 0) b.items.splice(i, 1); else b.items.push(id);
  b.recorded = false; saveDraft(); renderBasket(); renderList();
}
function basketItems() { return S.basket.items.map(id => S.byId.get(id)).filter(Boolean); }
function examObject() {
  const b = S.basket, items = [];
  for (const g of ['單選', '多選', '非選']) for (const r of basketItems()) if (r.tg === g) items.push(r);
  const ex = { title: b.title || '化學測驗', subtitle: b.subtitle, range: b.range || '', constants: b.constants.filter(Boolean), items, opts: b.opts, score: null, total: 0 };
  if (items.length) {
    if (b.score === 'auto') { const a = autoScore(items); ex.score = a.score; ex.total = a.total; }
    else { ex.score = b.manual; const a = autoScore(items); ex.total = a.cnt['單選'] * b.manual['單選'] + a.cnt['多選'] * b.manual['多選'] + a.cnt['非選'] * b.manual['非選']; }
  }
  return ex;
}
function renderBasket() {
  const b = S.basket; if (!b) return;
  $('#bTitle').value = b.title; $('#bSub').value = b.subtitle; $('#bRange').value = b.range || ''; $('#bDate').value = b.date;
  $('#bConst').value = b.constants.join('\n');
  $('#bCls').innerHTML = '<option value="">（未指定班級）</option>' + S.settings.classes.map(c => `<option ${c === b.cls ? 'selected' : ''}>${esc(c)}</option>`).join('')
    + (b.cls && !S.settings.classes.includes(b.cls) ? `<option selected>${esc(b.cls)}</option>` : '');
  $('#bWm').checked = !!b.opts.watermark; $('#bTitleImg').checked = !!b.opts.titleImg; $('#bSpace').checked = !!b.opts.space; $('#bHideTag').checked = !!b.opts.hideTag;
  $('#bScoreAuto').checked = b.score === 'auto'; $('#bScoreMan').checked = b.score !== 'auto';
  $('#manualScore').style.display = b.score === 'auto' ? 'none' : '';
  ['單選', '多選', '非選'].forEach(g => { $(`#ms${g}`).value = b.manual[g]; });
  const ex = examObject();
  const cnt = { '單選': [0, 0], '多選': [0, 0], '非選': [0, 0] };
  for (const r of ex.items) { cnt[r.tg][0]++; cnt[r.tg][1] += r.tg === '非選' ? Math.max(1, (r.q.parts || []).length) : 1; }
  $('#bCount').textContent = `${ex.items.length} 題`;
  $('#bTotal').textContent = ex.items.length ? `總分 ${ex.total}${ex.total > 100 ? '（超過 100 分以 100 分計）' : ''}` : '';
  $('#bSum').innerHTML = '<tr><th>題型</th><th>題數</th><th>格數</th><th>每格配分</th><th>小計</th></tr>' + ['單選', '多選', '非選'].filter(g => cnt[g][0]).map(g =>
    `<tr><td>${SEC_NAME[g]}</td><td>${cnt[g][0]}</td><td>${cnt[g][1]}</td><td>${ex.score ? ex.score[g] : ''}</td><td>${ex.score ? ex.score[g] * cnt[g][1] : ''}</td></tr>`).join('');
  $('#basketBadge').innerHTML = `<span class="step">2</span>組卷輸出${ex.items.length ? ` <span class="badge">${ex.items.length}</span>` : ''}`;
  $('#bRecorded').textContent = b.recorded ? '✔ 已記錄為出過' : '';
  $('#btnPrintQ').disabled = $('#btnPrintA').disabled = !ex.items.length;
  renderFlow();
  let h = '';
  for (const g of ['單選', '多選', '非選']) {
    const rows = basketItems().filter(r => r.tg === g); if (!rows.length) continue;
    h += `<h4>${SEC_NAME[g]}（${rows.length}）</h4>`;
    rows.forEach((r, i) => {
      const d = diffOf(r);
      h += `<div class="brow" data-id="${esc(r.id)}"><span class="n">${i + 1}</span><div class="bmain"><span class="tag">${esc(r.tag)}</span> <span class="pill tier">${tierLabel(r.tiers)}</span>${d ? `<span class="pill d${d}">難${d}</span>` : ''} <span class="chapters">${r.mains.join('、')}</span><span class="used">${usedLabel(r)}</span><br><span class="head">${esc(r.head).slice(0, 90)}</span></div>
        <span class="bbtn"><button data-act="up" title="往上移一題">▲</button><button data-act="down" title="往下移一題">▼</button><button data-act="view" title="到挑題頁看整題">看題目</button><button data-act="swap" title="換成同篩選條件、同難度的另一題">換一題</button><button data-act="del" class="del" title="從考卷移除">✕ 移除</button></span></div>`;
    });
  }
  $('#bList').innerHTML = h || '<div class="empty"><p>還沒有題目。</p><p>到「<b>1 挑題</b>」按「＋」把題目加進來，或用右邊的「<b>自動抽題</b>」。</p></div>';
  $('#drawFilter').textContent = filterSummary();
  $('#drawDiffBox').style.display = S.diffCount ? '' : 'none';
}
function moveItem(id, dir) {
  const b = S.basket, r = S.byId.get(id), ids = b.items.filter(x => S.byId.get(x) && S.byId.get(x).tg === r.tg);
  const i = ids.indexOf(id), j = i + dir; if (j < 0 || j >= ids.length) return;
  const a = b.items.indexOf(ids[i]), c = b.items.indexOf(ids[j]);
  [b.items[a], b.items[c]] = [b.items[c], b.items[a]]; saveDraft(); renderBasket();
}
function sortBasketByDiff() {
  const b = S.basket; b.items.sort((x, y) => (diffOf(S.byId.get(x)) ?? 3) - (diffOf(S.byId.get(y)) ?? 3)); saveDraft(); renderBasket();
}
// 抽題候選：目前篩選條件 ＋ 排除已在籃、已出過
function candidates(tg, band) {
  const inB = new Set(S.basket.items);
  const exUsed = $('#drawExUsed').checked;
  return S.all.filter(r => r.tg === tg && !inB.has(r.id) && matches(r) && !(exUsed && S.used.has(r.id)) && (!band || band.includes(diffOf(r) ?? 3)));
}
function weightedPick(list, k, recent) {
  const out = [], pool = list.slice();
  const w = r => recent ? 1 + Math.max(0, r.roc - 95) / 4 : 1;
  while (out.length < k && pool.length) {
    const tot = pool.reduce((a, r) => a + w(r), 0);
    let x = Math.random() * tot, i = 0;
    for (; i < pool.length; i++) { x -= w(pool[i]); if (x <= 0) break; }
    out.push(...pool.splice(Math.min(i, pool.length - 1), 1));
  }
  return out;
}
function autoDraw() {
  const want = { '單選': Number($('#dn單選').value) || 0, '多選': Number($('#dn多選').value) || 0, '非選': Number($('#dn非選').value) || 0 };
  const recent = $('#drawRecent').checked;
  const ratio = S.diffCount ? { easy: Number($('#drEasy').value) || 0, mid: Number($('#drMid').value) || 0, hard: Number($('#drHard').value) || 0 } : null;
  const short = [];
  for (const g of ['單選', '多選', '非選']) {
    if (!want[g]) continue;
    let picked = [];
    if (ratio && ratio.easy + ratio.mid + ratio.hard > 0) {
      const tot = ratio.easy + ratio.mid + ratio.hard;
      const plan = [[[1, 2], Math.round(want[g] * ratio.easy / tot)], [[3], Math.round(want[g] * ratio.mid / tot)], [[4, 5], 0]];
      plan[2][1] = want[g] - plan[0][1] - plan[1][1];
      for (const [band, k] of plan) if (k > 0) picked.push(...weightedPick(candidates(g, band).filter(r => !picked.includes(r)), k, recent));
      if (picked.length < want[g]) picked.push(...weightedPick(candidates(g, null).filter(r => !picked.includes(r)), want[g] - picked.length, recent));
    } else picked = weightedPick(candidates(g, null), want[g], recent);
    if (picked.length < want[g]) short.push(`${g}只抽到 ${picked.length}/${want[g]}`);
    S.basket.items.push(...picked.map(r => r.id));
  }
  S.basket.recorded = false; saveDraft(); renderBasket(); renderList();
  toast(short.length ? '候選題不足：' + short.join('；') + '，請放寬篩選條件' : '已抽題加入考卷籃');
}
function swapItem(id) {
  const r = S.byId.get(id), d = diffOf(r);
  let pool = candidates(r.tg, d ? [d] : null);
  if (!pool.length) pool = candidates(r.tg, null);
  if (!pool.length) return toast('沒有符合目前篩選條件的其他題目可換');
  const n = weightedPick(pool, 1, $('#drawRecent').checked)[0];
  S.basket.items[S.basket.items.indexOf(id)] = n.id; S.basket.recorded = false; saveDraft(); renderBasket(); renderList();
}
function basketFile() {
  const b = S.basket, ex = examObject();
  return { id: b.id, title: b.title, subtitle: b.subtitle, range: b.range || '', cls: b.cls, date: b.date, constants: b.constants, score: b.score, manual: b.manual, opts: b.opts,
    total: ex.total, recorded: b.recorded, items: ex.items.map(r => ({ id: r.id, path: r.path.replace(/^題庫\//, ''), si: r.si, qi: r.qi, tag: r.tag, type: r.type })) };
}
async function saveExam(silent) {
  const b = S.basket;
  if (!b.title) { toast('請先填考卷名稱'); return false; }
  const stem = b.title.replace(/[\\/:*?"<>|]/g, '_');
  const ok = await writeJson(`${examDir()}/${stem}.json`, basketFile());
  if (ok && !silent) toast(`已儲存 ${examDir()}/${stem}.json`);
  return ok;
}
async function listExams() {
  try { return (await S.fs.listJson(examDir())).filter(f => f.path.split('/').length === examDir().split('/').length + 1).sort((a, b) => b.mtime - a.mtime); } catch (e) { return []; }
}
async function loadExamFile(path) {
  const d = await readJson(path, null); if (!d) return toast('讀取失敗');
  loadExamData(d);
}
function loadExamData(d) {
  const b = newBasket();
  Object.assign(b, { id: d.id || b.id, title: d.title || '', subtitle: d.subtitle || '', range: d.range || '', cls: d.cls || '', date: d.date || today(), constants: d.constants || b.constants,
    score: d.score || 'auto', manual: d.manual || b.manual, opts: Object.assign(b.opts, d.opts || {}), recorded: !!d.recorded });
  b.items = (d.items || []).map(it => it.id || `題庫/${it.path}#${it.si}#${it.qi}`).filter(id => S.byId.has(id));
  if (b.items.length < (d.items || []).length) toast(`有 ${(d.items || []).length - b.items.length} 題在目前題庫找不到，已略過`);
  S.basket = b; saveDraft(); renderBasket(); renderList(); showTab('basket');
}

// ---------- 列印 ----------
async function openPrint(kind) {
  const ex = examObject();
  if (!ex.items.length) return toast('考卷裡還沒有題目');
  S.printKind = kind;
  $('#btnSwitchPrint').textContent = kind === '題目卷' ? '改看解答卷' : '改看題目卷';
  if (kind === '題目卷' && !S.basket.recorded) await recordExam(true);
  const html = kind === '題目卷' ? questionPaperHtml(ex) : answerPaperHtml(ex);
  const area = $('#printArea');
  area.innerHTML = `<div class="paper print" style="font-size:${S.settings.fontSize || 10}pt">${html}</div>`;
  $('#printTitle').textContent = `${ex.title}　${kind}`;
  document.body.classList.add('printing');
  await hydrateImages(area);
  document.title = `${ex.title}_${kind}`;
}
function closePrint() { document.body.classList.remove('printing'); document.title = '離線出題系統'; }
async function recordExam(auto) {
  const b = S.basket, ex = examObject();
  if (!ex.items.length) return;
  if (!b.title) { b.title = `化學測驗_${b.date}`; $('#bTitle').value = b.title; }
  S.history.exams = S.history.exams.filter(e => e.id !== b.id);
  S.history.exams.push({ id: b.id, date: b.date, name: b.title, cls: b.cls, n: ex.items.length, qids: ex.items.map(r => r.id), tags: ex.items.map(r => r.tag) });
  S.history.exams.sort((a, b2) => a.date.localeCompare(b2.date));
  b.recorded = true; rebuildUsed();
  await writeJson(histPath(), S.history);
  await saveExam(true);
  saveDraft(); renderBasket(); renderHistory(); renderList();
  if (!auto) toast('已記錄到出題紀錄，並儲存考卷');
}

// ---------- 出題紀錄 ----------
function renderHistory() {
  const ex = S.history.exams.slice().reverse();
  $('#hList').innerHTML = ex.map(e => `<div class="hrow" data-id="${esc(e.id)}"><div><b>${esc(e.date)}</b>　${esc(e.name)}　${e.cls ? '<span class="pill">' + esc(e.cls) + '</span>' : ''}　${e.n || (e.qids || []).length} 題
    <span class="bbtn"><button data-act="show" title="展開／收起題目清單">看題目</button><button data-act="load" title="把這份考卷的題目載回組卷頁">載入到組卷</button><button data-act="del" class="del" title="刪掉這筆紀錄，這些題就不算出過">刪除紀錄</button></span></div>
    <div class="hq" style="display:none">${(e.qids || []).map(id => { const r = S.byId.get(id); return r ? `<span class="tag">${esc(r.tag)}</span> ${esc(r.head).slice(0, 60)}` : `<span class="tag">${esc(id)}</span>（目前題庫無此題）`; }).join('<br>')}</div></div>`).join('')
    || '<div class="empty"><p>還沒有出題紀錄。</p><p>在「2 組卷輸出」按「輸出題目卷」時會自動記錄。</p></div>';
}
async function deleteHistory(id) {
  if (!confirm('刪除這筆紀錄？刪除後這些題目就不算出過。')) return;
  S.history.exams = S.history.exams.filter(e => e.id !== id); rebuildUsed();
  if (S.basket.id === id) S.basket.recorded = false;
  await writeJson(histPath(), S.history); renderHistory(); renderList(); renderBasket();
}

// ---------- 題庫管理 ----------
async function renderBank() {
  const rows = {};
  for (const r of S.all) {
    const b = rows[r.bank] || (rows[r.bank] = { bank: r.bank, source: r.source, papers: new Set(), n: 0, yMin: 9999, yMax: 0 });
    b.papers.add(r.path); b.n++; if (r.roc) { b.yMin = Math.min(b.yMin, r.roc); b.yMax = Math.max(b.yMax, r.roc); }
  }
  const list = Object.values(rows).sort((a, b) => a.bank.localeCompare(b.bank));
  $('#bankTab').innerHTML = '<tr><th>資料夾</th><th>來源</th><th>份數</th><th>題數</th><th>年份</th></tr>' + list.map(b =>
    `<tr><td>${esc(b.bank)}</td><td>${esc(b.source)}</td><td>${b.papers.size}</td><td>${b.n.toLocaleString()}</td><td>${b.yMax ? b.yMin + '～' + b.yMax : ''}</td></tr>`).join('')
    + `<tr><th>合計</th><th></th><th>${list.reduce((a, b) => a + b.papers.size, 0)}</th><th>${S.all.length.toLocaleString()}</th><th></th></tr>`;
  const canUp = S.fs && (S.fs.kind === 'server' || S.fs.kind === 'drive');
  $('#dropZone').classList.toggle('off', !canUp);
  if (!canUp) $('#upLog').textContent = '上傳功能需用「離線出題系統.exe」啟動；瀏覽器直接開 index.html 時請把 JSON 直接放進「題庫」資料夾再按「重新讀取題庫」。';
  let dirs = list.map(b => b.bank);
  if (S.fs && S.fs.kind === 'server') { try { dirs = (await (await fetch('/api/dirs')).json()).dirs; } catch (e) { } }
  else if (S.fs && S.fs.kind === 'drive') { try { dirs = await S.fs.dirs('題庫'); } catch (e) { } }
  $('#upFolder').innerHTML = '<option value="">（zip 內已含題庫資料夾層）</option>' + dirs.map(d => `<option>${esc(d)}</option>`).join('');
}
async function uploadFiles(files) {
  if (!files || !files.length) return;
  if (!S.fs || (S.fs.kind !== 'server' && S.fs.kind !== 'drive')) return toast('上傳功能需用 離線出題系統.exe 啟動');
  const folder = $('#upNewFolder').value.trim() || $('#upFolder').value;
  if (S.fs.kind === 'drive') return uploadToDrive(files, folder);
  const fd = new FormData();
  for (const f of files) fd.append('files', f, f.webkitRelativePath || f.name);
  const log = $('#upLog');
  log.textContent = `上傳中（${files.length} 個檔案，${(Array.from(files).reduce((a, f) => a + f.size, 0) / 1048576).toFixed(1)} MB）…`;
  try {
    const r = await fetch('/api/upload?folder=' + encodeURIComponent(folder), { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    const nJson = d.added.filter(p => p.endsWith('.json')).length, nImg = d.added.length - nJson;
    log.innerHTML = `<b class="ok">已加入 ${nJson} 份 JSON、${nImg} 個圖檔。</b>` + (d.errors.length ? '<br><span style="color:#b22">未處理：</span><br>' + d.errors.map(esc).join('<br>') : '');
    if (d.added.length) { await rescan(); await renderBank(); }
  } catch (e) { log.textContent = '上傳失敗：' + e.message; }
  $('#upFiles').value = '';
}

// 網路版：在瀏覽器解 zip，逐檔寫進雲端硬碟
async function uploadToDrive(files, folder) {
  const log = $('#upLog');
  const added = [], errs = [];
  const items = [];   // {rel, blob()}
  for (const f of files) {
    const low = f.name.toLowerCase();
    if (low.endsWith('.zip')) {
      let ents; try { ents = await unzipEntries(f); } catch (e) { errs.push(f.name + '：' + e.message); continue; }
      for (const e of ents) {
        let rel = e.name.replace(/\\/g, '/').replace(/^\.\//, '');
        if (!rel.split('/')[0].startsWith('Tier')) { if (!folder) { errs.push(f.name + '：zip 內沒有 Tier 開頭的題庫資料夾層，請先選目標題庫'); break; } rel = folder + '/' + rel; }
        items.push({ rel, blob: e.data });
      }
    } else if (low.endsWith('.json')) {
      if (!folder) { errs.push(f.name + '：單檔 JSON 請先選目標題庫'); continue; }
      items.push({ rel: folder + '/' + f.name, blob: async () => f });
    } else if (/\.(png|jpe?g)$/.test(low)) {
      if (!folder) { errs.push(f.name + '：圖片請先選目標題庫'); continue; }
      let rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
      if (!rel.includes('img/')) rel = 'img/' + rel;
      items.push({ rel: folder + '/' + rel.slice(rel.indexOf('img/')), blob: async () => f });
    } else errs.push(f.name + '：只接受 .zip、.json、圖片');
  }
  let n = 0;
  const work = items.slice();
  const worker = async () => {
    while (work.length) {
      const it = work.shift();
      try {
        const b = await it.blob();
        if (it.rel.endsWith('.json') && !it.rel.endsWith('manifest.json')) { const v = JSON.parse(await b.text()); if (!v || !v.sections) throw new Error('不是題庫 JSON（沒有 sections）'); }
        await S.fs.writeBlob('題庫/' + it.rel, b);
        added.push(it.rel);
      } catch (e) { errs.push(it.rel + '：' + e.message); }
      n++; log.textContent = `寫入雲端硬碟 ${n}/${items.length}…`;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const nJson = added.filter(p => p.endsWith('.json')).length;
  log.innerHTML = `<b class="ok">已加入 ${nJson} 份 JSON、${added.length - nJson} 個圖檔。</b>` + (errs.length ? '<br><span style="color:#b22">未處理：</span><br>' + errs.map(esc).join('<br>') : '');
  if (added.length) { await rescan(); await renderBank(); }
  $('#upFiles').value = '';
}

// ---------- 設定 ----------
function renderSettings() {
  $('#sClasses').value = S.settings.classes.join('\n'); $('#sConst').value = (S.settings.constants || []).join('\n');
  $('#sWm').checked = !!S.settings.watermark; $('#sTitleImg').checked = S.settings.titleImg !== false; $('#sFont').value = S.settings.fontSize || 10;
  $('#sInfo').textContent = S.fs ? (S.fs.kind === 'server' ? '由 離線出題系統.exe 提供：' + S.fs.root : S.fs.kind === 'http' ? '以網頁伺服器模式執行（唯讀；紀錄與設定存在瀏覽器）' : S.fs.kind === 'drive' ? '網路版：資料在 Google 雲端硬碟 ' + S.fs.root + (S.fs.loggedIn() ? '（已登入 ' + (S.fs.user || '') + '；出題紀錄檔 ' + histPath() + '）' : '（未登入）') : '已連線資料夾：' + S.fs.root.name) : '尚未連線資料夾';
  $('#driveBox').style.display = S.fs && S.fs.kind === 'drive' ? '' : 'none';
}
async function saveSettings() {
  S.settings.classes = $('#sClasses').value.split('\n').map(s => s.trim()).filter(Boolean);
  S.settings.constants = $('#sConst').value.split('\n').map(s => s.trim()).filter(Boolean);
  S.settings.watermark = $('#sWm').checked; S.settings.titleImg = $('#sTitleImg').checked; S.settings.fontSize = Number($('#sFont').value) || 10;
  if (await writeJson('設定/設定.json', S.settings)) toast('設定已儲存');
  renderBasket();
}

// ---------- UI 綁定 ----------
function showTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === name));
  $$('.page').forEach(p => p.classList.toggle('on', p.id === 'page-' + name));
  if (name === 'basket') renderBasket();
  if (name === 'history') renderHistory();
  if (name === 'bank') renderBank();
}
function bindUI() {
  $$('.tab').forEach(t => t.onclick = () => showTab(t.dataset.tab));
  $('#btnConnect').onclick = connect; $('#btnScan').onclick = rescan;
  // 篩選
  const F = S.filter;
  $('#filters').addEventListener('change', e => {
    const el = e.target, d = el.dataset;
    const setSecs = (sel, on) => $$(sel).forEach(x => on ? F.secs.add(x.dataset.sec) : F.secs.delete(x.dataset.sec));
    if (el.id === 'chapAll') { setSecs('#chapTree input[data-sec]', el.checked); syncTree(); }
    else if (d.book) { setSecs(`#chapTree input[data-sec^="${d.book} "]`, el.checked); syncTree(); }
    else if (d.chap) { const [b, c] = d.chap.split('|'); setSecs(`#chapTree input[data-sec^="${b} ${c}-"]`, el.checked); syncTree(); }
    else if (d.sec) { el.checked ? F.secs.add(d.sec) : F.secs.delete(d.sec); syncTree(); }
    else if (d.tier) el.checked ? F.tiers.add(d.tier) : F.tiers.delete(d.tier);
    else if (d.source) { el.checked ? F.sources.add(d.source) : F.sources.delete(d.source); if (!el.checked) for (const k of S.facets.subs[d.source]?.keys() || []) F.subs.delete(k); renderSubs(); }
    else if (d.sub) el.checked ? F.subs.add(d.sub) : F.subs.delete(d.sub);
    else if (d.type) el.checked ? F.types.add(d.type) : F.types.delete(d.type);
    else if (d.tag) el.checked ? F.tags.add(d.tag) : F.tags.delete(d.tag);
    else if (d.extra) el.checked ? F.extra.add(d.extra) : F.extra.delete(d.extra);
    else if (d.diff) el.checked ? F.diff.add(Number(d.diff)) : F.diff.delete(Number(d.diff));
    else if (d.ltd) el.checked ? F.ltd.add(d.ltd) : F.ltd.delete(d.ltd);
    else if (el.id === 'fSecondary') F.secondaryToo = el.checked;
    else if (el.id === 'fHideUsed') F.hideUsed = el.checked;
    else if (el.id === 'fYMin') F.yMin = el.value.trim();
    else if (el.id === 'fYMax') F.yMax = el.value.trim();
    else if (el.id === 'fSort') { S.sort = el.value; }
    applyFilter();
  });
  $('#filters').addEventListener('click', e => {
    const tw = e.target.closest('.tw');
    if (tw) { const k = tw.parentElement.querySelector(':scope > .kids'); k.hidden = !k.hidden; tw.textContent = k.hidden ? '▸' : '▾'; return; }
    const fh = e.target.closest('.fh');
    if (fh && !e.target.closest('input,button,label')) fh.parentElement.classList.toggle('closed');
  });
  $('#fKw').addEventListener('keydown', e => { if (e.key === 'Enter') applyFilter(); });
  $('#btnKw').onclick = applyFilter;
  $('#chips').addEventListener('click', e => { const t = e.target.closest('button'); if (!t) return; if (t.dataset.clear) clearFilterGroup(t.dataset.clear); else if (t.id === 'btnClear') clearFilters(); });
  $('#list').addEventListener('click', e => {
    const add = e.target.closest('[data-add]');
    if (add) { toggleBasket(add.dataset.add); if (S.sel === add.dataset.add) renderPreview(S.sel); toast(S.basket.items.includes(add.dataset.add) ? '已加入考卷籃' : '已從考卷籃移出'); return; }
    if (e.target.id === 'btnClear2') return clearFilters();
    const row = e.target.closest('.row'); if (row) selectRow(row.dataset.id);
  });
  document.addEventListener('keydown', e => {   // 挑題頁鍵盤：↑↓ 換題、空白鍵 加入／移出、←→ 翻頁
    if (!$('#page-browse').classList.contains('on') || document.body.classList.contains('printing')) return;
    if (e.target.matches('input,textarea,select')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); stepSel(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); stepSel(-1); }
    else if (e.key === ' ' && S.sel) { e.preventDefault(); toggleBasket(S.sel); renderPreview(S.sel); }
    else if (e.key === 'ArrowLeft') $('#prev').click();
    else if (e.key === 'ArrowRight') $('#next').click();
  });
  $('#btnGoBasket').onclick = () => showTab('basket');
  $('#btnRandom').onclick = () => {   // 從目前篩選結果，依題型各隨機抽 N 題（使用者 2026-10-29：單選／多選／非選分開輸入）
    const want = { '單選': Number($('#rn單選').value) || 0, '多選': Number($('#rn多選').value) || 0, '非選': Number($('#rn非選').value) || 0 };
    if (!want['單選'] && !want['多選'] && !want['非選']) return toast('請先填要抽的題數');
    const inB = new Set(S.basket.items);
    const got = [], short = [];
    for (const g of ['單選', '多選', '非選']) {
      if (!want[g]) continue;
      const pool = S.filtered.filter(r => r.tg === g && !inB.has(r.id));
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      const picked = pool.slice(0, want[g]);
      if (picked.length < want[g]) short.push(`${g}只有 ${picked.length}/${want[g]} 題可抽`);
      got.push(...picked);
    }
    if (!got.length) return toast('目前篩選結果沒有可加入的題目（' + short.join('；') + '）', 5000);
    S.basket.items.push(...got.map(r => r.id));
    S.basket.recorded = false; saveDraft(); renderBasket(); renderList();
    toast(`已隨機加入 ${got.length} 題` + (short.length ? '；' + short.join('；') + '，請放寬篩選' : ''), 5000);
  };
  $('#btnGoBrowse').onclick = () => showTab('browse');
  $('#list').addEventListener('dblclick', e => { const row = e.target.closest('.row'); if (row) { toggleBasket(row.dataset.id); if (S.sel === row.dataset.id) renderPreview(S.sel); } });
  $('#prev').onclick = () => { if (S.page > 0) { S.page--; renderList(); } };
  $('#next').onclick = () => { if ((S.page + 1) * S.pageSize < S.filtered.length) { S.page++; renderList(); } };
  $('#btnAddAll').onclick = () => {
    const rows = S.filtered.slice(S.page * S.pageSize, (S.page + 1) * S.pageSize);
    for (const r of rows) if (!S.basket.items.includes(r.id)) S.basket.items.push(r.id);
    S.basket.recorded = false; saveDraft(); renderBasket(); renderList(); toast(`已把這頁 ${rows.length} 題加入考卷籃`);
  };
  // 考卷籃
  const b = () => S.basket;
  $('#bTitle').oninput = e => { b().title = e.target.value; saveDraft(); };
  $('#bSub').oninput = e => { b().subtitle = e.target.value; saveDraft(); };
  $('#bRange').oninput = e => { b().range = e.target.value; saveDraft(); };
  $('#bRangeAuto').onclick = e => { e.preventDefault();
    const codes = []; for (const r of basketItems()) for (const c of r.mains) if (!codes.includes(c)) codes.push(c);
    if (!codes.length) return toast('籃子裡還沒有題目');
    codes.sort((a, c) => chapterOrder(a) - chapterOrder(c));
    b().range = codes.map(chapterName).join('、'); $('#bRange').value = b().range; saveDraft(); };
  $('#bDate').onchange = e => { b().date = e.target.value; saveDraft(); };
  $('#bCls').onchange = e => { b().cls = e.target.value; saveDraft(); };
  $('#bConst').onchange = e => { b().constants = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); saveDraft(); };
  $('#bWm').onchange = e => { b().opts.watermark = e.target.checked; saveDraft(); };
  $('#bTitleImg').onchange = e => { b().opts.titleImg = e.target.checked; saveDraft(); };
  $('#bSpace').onchange = e => { b().opts.space = e.target.checked; saveDraft(); };
  $('#bHideTag').onchange = e => { b().opts.hideTag = e.target.checked; saveDraft(); };
  $('#bScoreAuto').onchange = $('#bScoreMan').onchange = () => { b().score = $('#bScoreAuto').checked ? 'auto' : 'manual'; saveDraft(); renderBasket(); };
  ['單選', '多選', '非選'].forEach(g => $(`#ms${g}`).onchange = e => { b().manual[g] = Number(e.target.value) || 0; saveDraft(); renderBasket(); });
  $('#bList').addEventListener('click', e => {
    const btn = e.target.closest('button'); if (!btn) return;
    const id = btn.closest('.brow').dataset.id, act = btn.dataset.act;
    if (act === 'up') moveItem(id, -1); else if (act === 'down') moveItem(id, 1); else if (act === 'del') toggleBasket(id);
    else if (act === 'swap') swapItem(id); else if (act === 'view') { showTab('browse'); selectRow(id); }
  });
  $('#btnSortDiff').onclick = sortBasketByDiff;
  $('#btnDraw').onclick = autoDraw;
  $('#btnClearBasket').onclick = () => { if (!b().items.length) return toast('目前沒有題目'); if (confirm(`移除考卷裡的 ${b().items.length} 題？考卷名稱等資訊會保留。`)) { b().items = []; b().recorded = false; saveDraft(); renderBasket(); renderList(); } };
  $('#btnNewExam').onclick = () => { if (!b().items.length || confirm('開新考卷會清掉目前的題目與考卷資訊（已儲存、已記錄的不受影響）。繼續？')) { S.basket = newBasket(); saveDraft(); renderBasket(); renderList(); toast('已開新考卷'); } };
  $('#btnSaveExam').onclick = () => saveExam(false);
  $('#btnRecord').onclick = () => recordExam(false);
  $('#btnLoadExam').onclick = async () => {
    const files = await listExams();
    const box = $('#examFiles');
    box.style.display = '';
    box.innerHTML = '<div class="hint">點一份載入（會取代目前的題目）：</div>' + (files.length ? files.map(f => `<button class="lnk" data-path="${esc(f.path)}">${esc(f.path.slice(examDir().length + 1).replace(/\.json$/, ''))}</button>`).join('') : '<span class="hint">「考卷」資料夾裡還沒有儲存過的考卷</span>') + ' <button data-close="1">關閉</button>';
  };
  $('#examFiles').addEventListener('click', e => { const t = e.target.closest('button'); if (!t) return; if (t.dataset.close) $('#examFiles').style.display = 'none'; else loadExamFile(t.dataset.path); });
  $('#btnPrintQ').onclick = () => openPrint('題目卷'); $('#btnPrintA').onclick = () => openPrint('解答卷');
  $('#btnDoPrint').onclick = () => window.print(); $('#btnClosePrint').onclick = closePrint;
  $('#btnSwitchPrint').onclick = () => openPrint(S.printKind === '題目卷' ? '解答卷' : '題目卷');
  // 紀錄
  $('#hList').addEventListener('click', e => {
    const btn = e.target.closest('button'); if (!btn) return;
    const row = btn.closest('.hrow'), id = row.dataset.id, ex = S.history.exams.find(x => x.id === id);
    if (btn.dataset.act === 'show') { const q = row.querySelector('.hq'); q.style.display = q.style.display === 'none' ? '' : 'none'; }
    else if (btn.dataset.act === 'del') deleteHistory(id);
    else if (btn.dataset.act === 'load') loadExamData({ id: ex.id, title: ex.name, cls: ex.cls, date: ex.date, recorded: true, items: (ex.qids || []).map(i => ({ id: i })) });
  });
  // 題庫管理
  $('#btnPick').onclick = () => $('#upFiles').click();
  $('#upFiles').onchange = e => uploadFiles(e.target.files);
  const dz = $('#dropZone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); uploadFiles(e.dataTransfer.files); });
  // 設定
  $('#btnSaveSettings').onclick = saveSettings;
  $('#btnLogout').onclick = () => { if (S.fs && S.fs.kind === 'drive') { S.fs.logout(); $('#btnConnect').textContent = '用 Google 登入'; status('已登出。'); renderSettings(); } };
  window.addEventListener('afterprint', () => { });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('printing')) closePrint(); });
}
init().catch(e => { console.error(e); status('啟動失敗：' + e.message); });
