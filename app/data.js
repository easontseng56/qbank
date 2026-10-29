// 資料層：資料夾存取（File System Access API 或 http）、IndexedDB 快取、題庫索引
'use strict';

// ---------- 資料夾後端 ----------
// 兩種後端介面相同：listJson() → [{path, mtime}]；readText(path)；readFile(path) → Blob；writeText(path, text)
// path 一律是相對於系統根資料夾（離線出題系統\）的 '/' 路徑，例如 '題庫/Tier2_段考_112-115/112竹北高一下第一次.json'
class DirFS {
  constructor(root) { this.root = root; this.kind = 'dir'; this.writable = true; }
  async _dir(parts, create = false) {
    let d = this.root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  }
  async _file(path, create = false) {
    const parts = path.split('/');
    const name = parts.pop();
    const d = await this._dir(parts, create);
    return d.getFileHandle(name, { create });
  }
  async exists(path) { try { await this._file(path); return true; } catch (e) { return false; } }
  async listJson(prefix = '題庫') {
    const out = [];
    let d;
    try { d = await this._dir(prefix.split('/')); } catch (e) { return out; }
    const walk = async (dir, rel) => {
      for await (const [name, h] of dir.entries()) {
        if (h.kind === 'directory') { if (name !== 'img') await walk(h, rel + name + '/'); }
        else if (name.endsWith('.json') && name !== 'manifest.json') {
          const f = await h.getFile();
          out.push({ path: rel + name, mtime: f.lastModified, size: f.size });
        }
      }
    };
    await walk(d, prefix + '/');
    return out;
  }
  async readText(path) { const h = await this._file(path); return (await h.getFile()).text(); }
  async readFile(path) { const h = await this._file(path); return h.getFile(); }
  async writeText(path, text) {
    const h = await this._file(path, true);
    const w = await h.createWritable();
    await w.write(text); await w.close();
  }
  async writeBlob(path, blob) { const h = await this._file(path, true); const w = await h.createWritable(); await w.write(blob); await w.close(); }
}

class HttpFS {   // 以 http 伺服器提供整個資料夾時（例如放上 GitHub Pages）；需要 題庫/manifest.json
  constructor() { this.kind = 'http'; this.writable = false; }
  _u(path) { return path.split('/').map(encodeURIComponent).join('/'); }
  async exists(path) { const r = await fetch(this._u(path), { method: 'HEAD' }); return r.ok; }
  async listJson(prefix = '題庫') {
    const r = await fetch(this._u(prefix + '/manifest.json'));
    if (!r.ok) throw new Error('找不到 ' + prefix + '/manifest.json');
    return (await r.json()).files.map(f => ({ path: prefix + '/' + f.path, mtime: f.mtime, size: f.size }));
  }
  async readText(path) { const r = await fetch(this._u(path)); if (!r.ok) throw new Error('讀取失敗 ' + path); return r.text(); }
  async readFile(path) { const r = await fetch(this._u(path)); if (!r.ok) throw new Error('讀取失敗 ' + path); return r.blob(); }
  async writeText(path, text) { localStorage.setItem('file:' + path, text); }   // 唯讀模式：改存瀏覽器
}

class ServerFS {   // 由 離線出題系統.exe 本機伺服器提供（可讀寫）
  constructor(root) { this.kind = 'server'; this.writable = true; this.root = root; }
  _u(path) { return '/' + path.split('/').map(encodeURIComponent).join('/'); }
  async exists(path) { const r = await fetch('/api/exists?path=' + encodeURIComponent(path)); return (await r.json()).exists; }
  async listJson(prefix = '題庫') {
    const r = await fetch('/api/list?prefix=' + encodeURIComponent(prefix));
    if (!r.ok) throw new Error('列檔失敗 ' + prefix);
    return (await r.json()).files;
  }
  async readText(path) { const r = await fetch(this._u(path)); if (!r.ok) throw new Error('讀取失敗 ' + path); return r.text(); }
  async readFile(path) { const r = await fetch(this._u(path)); if (!r.ok) throw new Error('讀取失敗 ' + path); return r.blob(); }
  async writeText(path, text) {
    const r = await fetch('/api/write?path=' + encodeURIComponent(path), { method: 'POST', body: text });
    if (!r.ok) throw new Error(await r.text());
  }
  async writeBlob(path, blob) { return this.writeText(path, blob); }
}

// ---------- IndexedDB 快取 ----------
const IDB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('chemq', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('papers', { keyPath: 'path' });   // {path, mtime, text}
        db.createObjectStore('kv');                             // 根資料夾 handle 等
      };
      r.onsuccess = () => { IDB.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  _tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const tx = IDB.db.transaction(store, mode);
      const rq = fn(tx.objectStore(store));
      tx.oncomplete = () => res(rq && rq.result);
      tx.onerror = () => rej(tx.error);
    });
  },
  get(k) { return IDB._tx('kv', 'readonly', s => s.get(k)); },
  set(k, v) { return IDB._tx('kv', 'readwrite', s => s.put(v, k)); },
  allPapers() { return IDB._tx('papers', 'readonly', s => s.getAll()); },
  putPapers(list) { return IDB._tx('papers', 'readwrite', s => { list.forEach(p => s.put(p)); }); },
  delPapers(paths) { return IDB._tx('papers', 'readwrite', s => { paths.forEach(p => s.delete(p)); }); },
};

// ---------- 題庫索引 ----------
const BANK_INFO = [   // 資料夾名前綴 → 來源名稱、年份是否西元
  ['Tier0_化學奧林匹亞', '化奧', true], ['Tier0_學科能力競賽', '學科能力競賽', true], ['Tier0_清華盃', '清華盃', true],
  ['Tier1_學測模考', '學測模考', false], ['Tier1_學測歷屆', '學測歷屆', false],
  ['Tier1_指考分科模考', '指考分科模考', false], ['Tier1_指考分科歷屆', '指考分科歷屆', false],
  ['Tier2_段考', '段考', false], ['Tier3_龍騰', '龍騰光碟', false],
];
const SOURCE_ORDER = BANK_INFO.map(b => b[1]).concat(['其他']);
const TYPE_ORDER = { '單選': 0, '多選': 1, '非選': 2 };
const KNOWN_TAGS = ['素養題', '實驗', '計算題', '觀念題', '圖表題', '跨科', '超範圍'];

function bankOf(path) {   // path: 題庫/<bank>/...
  const bank = path.split('/')[1] || '';
  for (const [pre, name, ad] of BANK_INFO) if (bank.startsWith(pre)) return { bank, source: name, ad };
  return { bank, source: '其他', ad: false };
}
function typeGroup(t) { return t in TYPE_ORDER ? t : '非選'; }
function splitList(s) { return String(s || '').split(/[、；;，,]/).map(x => x.trim()).filter(x => x && x !== '無'); }
function lines(x) { return x == null ? [] : (Array.isArray(x) ? x : [x]); }
function tagOf(P, q) { return `【${P.tag_prefix}-${q.type}${q.num}】`; }

// 一份卷 JSON → 題目紀錄陣列
function indexPaper(path, P) {
  const { bank, source, ad } = bankOf(path);
  const dir = path.slice(0, path.lastIndexOf('/'));
  const yr = Number(P.year) || 0;
  const roc = ad ? (yr > 1911 ? yr - 1911 : yr) : yr;
  const sub = source === '段考' ? (P.school || '') : (P.exam || P.region || '');
  const out = [];
  P.sections.forEach((s, si) => {
    s.questions.forEach((q, qi) => {
      const cls = q.cls || [];
      const tiers = [], mains = [], secs = [], tags = new Set();
      for (const c of cls) {
        if (c.tier != null) { const t = String(c.tier).replace(/\s/g, ''); if (!tiers.includes(t)) tiers.push(t); }
        for (const m of chapterCodes(c.main)) if (!mains.includes(m)) mains.push(m);
        for (const m of chapterCodes(c.secondary)) if (!secs.includes(m) && !mains.includes(m)) secs.push(m);
        for (const t of splitList(c.tags)) tags.add(t.replace(/題$/, '') === '實驗' ? '實驗' : t);
      }
      const texts = [];
      const push = x => { for (const l of lines(x)) if (l) texts.push(String(l)); };
      if (q.group) push(q.group.stem);
      push(q.stem); push(q.options); push(q.solution); push(q.notes);
      for (const pt of q.parts || []) { push(pt.stem); push(pt.answer); push(pt.solution); }
      if (q.answer) push(q.answer);
      const tg = (P.tag_prefix ? tagOf(P, q) : `【${q.type}${q.num}】`);
      texts.push(tg);
      const hasImg = (q.images || []).length > 0 || (q.group && (q.group.images || []).length > 0)
        || (q.parts || []).some(pt => (pt.images || []).length > 0);
      out.push({
        id: `${path}#${si}#${qi}`, path, si, qi, dir, bank, source, sub,
        year: yr, roc, yearLabel: ad ? String(yr) : String(yr),
        tag: tg, type: q.type, tg: typeGroup(q.type), num: q.num,
        tiers, tier0: tiers.some(t => t.split('+').includes('0')),
        mains, secs, tags: [...tags], hasImg, doubt: !!q.doubt, group: !!q.group,
        ltd: q.lt_difficulty || '', text: texts.join('\n').toLowerCase(),
        head: lines(q.stem)[0] || (q.group && lines(q.group.stem)[0]) || '',
        paper: P, q,
      });
    });
  });
  return out;
}

// 掃描資料夾：比對 IndexedDB 快取的 mtime，只重讀有變動的檔；回傳 {papers: Map(path→{mtime,text}), changed, removed}
async function scanBank(fs, onProgress) {
  const listed = await fs.listJson('題庫');
  const cached = new Map((await IDB.allPapers()).map(p => [p.path, p]));
  const toRead = listed.filter(f => !cached.has(f.path) || cached.get(f.path).mtime !== f.mtime);
  const listedSet = new Set(listed.map(f => f.path));
  const removed = [...cached.keys()].filter(p => !listedSet.has(p));
  let n = 0;
  const batch = [];
  const queue = toRead.slice();
  const worker = async () => {   // 平行讀檔（雲端硬碟每檔一個請求，平行才快）
    while (queue.length) {
      const f = queue.shift();
      let text;
      try { text = await fs.readText(f.path); } catch (e) { console.warn('讀取失敗，略過', f.path, e); n++; continue; }
      try { JSON.parse(text); } catch (e) { console.warn('JSON 格式錯誤，略過', f.path); n++; continue; }
      const rec = { path: f.path, mtime: f.mtime, text };
      batch.push(rec); cached.set(f.path, rec);
      if (batch.length >= 40) { await IDB.putPapers(batch.splice(0)); }
      n++;
      if (onProgress) onProgress(n, toRead.length, f.path);
    }
  };
  await Promise.all(Array.from({ length: fs.parallel || 4 }, worker));
  if (batch.length) await IDB.putPapers(batch);
  if (removed.length) { await IDB.delPapers(removed); removed.forEach(p => cached.delete(p)); }
  return { papers: cached, changed: toRead.length, removed: removed.length };
}

function buildIndex(papers) {   // Map(path→{text}) → 題目陣列
  const all = [];
  for (const [path, p] of papers) {
    let P;
    try { P = JSON.parse(p.text); } catch (e) { continue; }
    if (!P || !Array.isArray(P.sections)) continue;
    for (const r of indexPaper(path, P)) all.push(r);
  }
  return all;
}
