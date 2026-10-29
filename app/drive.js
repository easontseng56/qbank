// Google Drive 後端：網頁放 GitHub Pages，資料（題庫／紀錄／考卷／設定／難度）直接讀寫使用者雲端硬碟裡的系統資料夾。
// 登入用 Google Identity Services 取 access token；Drive REST v3；資料夾內容以 Map 快取（path → {id, name, isDir, mtime, size}）。
'use strict';

const FOLDER = 'application/vnd.google-apps.folder';

class DriveFS {
  constructor(cfg) {
    this.kind = 'drive'; this.writable = true; this.parallel = 8;
    this.cfg = cfg; this.api = cfg.apiBase || 'https://www.googleapis.com';
    this.token = null; this.exp = 0; this.rootId = null; this.root = cfg.rootPath;
    this.children = new Map();   // folderId → Map(name → entry)
    this.tokenClient = null;
    try { const t = JSON.parse(sessionStorage.getItem('gtoken') || 'null'); if (t && t.exp > Date.now() + 60000) { this.token = t.token; this.exp = t.exp; } } catch (e) { }
  }
  // ---- 登入 ----
  async loadGis() {
    if (window.google && google.accounts) return;
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res; s.onerror = () => rej(new Error('無法載入 Google 登入元件，請確認有網路')); document.head.appendChild(s); });
  }
  async login(interactive = true) {
    await this.loadGis();
    if (!this.tokenClient) {
      this.tokenClient = google.accounts.oauth2.initTokenClient({ client_id: this.cfg.clientId, scope: 'https://www.googleapis.com/auth/drive', callback: () => { } });
    }
    return new Promise((res, rej) => {
      this.tokenClient.callback = r => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        this.token = r.access_token; this.exp = Date.now() + (Number(r.expires_in) - 60) * 1000;
        sessionStorage.setItem('gtoken', JSON.stringify({ token: this.token, exp: this.exp }));
        res();
      };
      this.tokenClient.error_callback = e => rej(new Error(e.message || e.type || '登入取消'));
      this.tokenClient.requestAccessToken({ prompt: interactive ? '' : 'none' });
    });
  }
  loggedIn() { return !!this.token && Date.now() < this.exp; }
  logout() { this.token = null; this.exp = 0; sessionStorage.removeItem('gtoken'); }
  async ensure() { if (!this.loggedIn()) await this.login(true); }
  // ---- REST ----
  async req(url, opt = {}, retry = 0) {
    await this.ensure();
    opt.headers = Object.assign({ Authorization: 'Bearer ' + this.token }, opt.headers || {});
    const r = await fetch(url, opt);
    if (r.status === 401 && retry < 1) { this.logout(); await this.login(true); return this.req(url, opt, retry + 1); }
    if ((r.status === 403 || r.status === 429 || r.status >= 500) && retry < 5) {   // 配額／暫時錯誤：退避重試
      await new Promise(res => setTimeout(res, 500 * 2 ** retry + Math.random() * 300));
      return this.req(url, opt, retry + 1);
    }
    if (!r.ok) throw new Error(`Drive ${r.status}：${(await r.text()).slice(0, 200)}`);
    return r;
  }
  async list(folderId) {   // 該資料夾全部子項（分頁），快取
    if (this.children.has(folderId)) return this.children.get(folderId);
    const m = new Map();
    let pageToken = '';
    do {
      const q = `'${folderId}' in parents and trashed=false`;
      const u = `${this.api}/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('nextPageToken,files(id,name,mimeType,modifiedTime,size)')}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? '&pageToken=' + pageToken : ''}`;
      const d = await (await this.req(u)).json();
      for (const f of d.files || []) if (!m.has(f.name)) m.set(f.name, { id: f.id, name: f.name, isDir: f.mimeType === FOLDER, mtime: Date.parse(f.modifiedTime), size: Number(f.size) || 0 });
      pageToken = d.nextPageToken || '';
    } while (pageToken);
    this.children.set(folderId, m);
    return m;
  }
  async getRoot() {
    if (this.rootId) return this.rootId;
    if (this.cfg.rootFolderId) { this.rootId = this.cfg.rootFolderId; return this.rootId; }
    let id = 'root';
    for (const seg of this.cfg.rootPath.split('/').filter(Boolean)) {
      const e = (await this.list(id)).get(seg);
      if (!e || !e.isDir) throw new Error('雲端硬碟找不到資料夾 ' + this.cfg.rootPath + '（缺「' + seg + '」）');
      id = e.id;
    }
    this.rootId = id; return id;
  }
  async dirId(path, create = false) {   // 'a/b' → 資料夾 id
    let id = await this.getRoot();
    for (const seg of path.split('/').filter(Boolean)) {
      const m = await this.list(id);
      let e = m.get(seg);
      if (!e) {
        if (!create) return null;
        const d = await (await this.req(`${this.api}/drive/v3/files?fields=id,name,mimeType,modifiedTime&supportsAllDrives=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: seg, mimeType: FOLDER, parents: [id] }) })).json();
        e = { id: d.id, name: seg, isDir: true, mtime: Date.now(), size: 0 }; m.set(seg, e);
      }
      if (!e.isDir) return null;
      id = e.id;
    }
    return id;
  }
  async entry(path) {
    const i = path.lastIndexOf('/');
    const did = await this.dirId(i < 0 ? '' : path.slice(0, i));
    if (!did) return null;
    return { dirId: did, e: (await this.list(did)).get(path.slice(i + 1)) || null };
  }
  // ---- 統一介面 ----
  async exists(path) { const r = await this.entry(path); return !!(r && r.e); }
  async listJson(prefix = '題庫') {
    const out = [];
    const did = await this.dirId(prefix);
    if (!did) return out;
    const walk = async (id, rel) => {
      for (const e of (await this.list(id)).values()) {
        if (e.isDir) { if (e.name !== 'img') await walk(e.id, rel + e.name + '/'); }
        else if (e.name.endsWith('.json') && e.name !== 'manifest.json') out.push({ path: rel + e.name, mtime: e.mtime, size: e.size });
      }
    };
    await walk(did, prefix + '/');
    return out;
  }
  async readFile(path) {
    const r = await this.entry(path);
    if (!r || !r.e) throw new Error('找不到 ' + path);
    return (await this.req(`${this.api}/drive/v3/files/${r.e.id}?alt=media&supportsAllDrives=true`)).blob();
  }
  async readText(path) { return (await this.readFile(path)).text(); }
  async writeBlob(path, blob, mime) {
    const i = path.lastIndexOf('/');
    const dir = i < 0 ? '' : path.slice(0, i), name = path.slice(i + 1);
    const did = await this.dirId(dir, true);
    const m = await this.list(did);
    const e = m.get(name);
    mime = mime || (name.endsWith('.json') ? 'application/json' : name.endsWith('.png') ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'application/octet-stream');
    let d;
    if (e) {
      d = await (await this.req(`${this.api}/upload/drive/v3/files/${e.id}?uploadType=media&fields=id,modifiedTime,size&supportsAllDrives=true`, { method: 'PATCH', headers: { 'Content-Type': mime }, body: blob })).json();
    } else {
      const fd = new FormData();
      fd.append('metadata', new Blob([JSON.stringify({ name, parents: [did] })], { type: 'application/json' }));
      fd.append('file', new Blob([blob], { type: mime }));
      d = await (await this.req(`${this.api}/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime,size&supportsAllDrives=true`, { method: 'POST', body: fd })).json();
    }
    m.set(name, { id: d.id, name, isDir: false, mtime: Date.parse(d.modifiedTime) || Date.now(), size: Number(d.size) || blob.size || 0 });
  }
  async writeText(path, text) { return this.writeBlob(path, new Blob([text], { type: 'text/plain' })); }
  async dirs(prefix = '題庫') { const id = await this.dirId(prefix); if (!id) return []; return [...(await this.list(id)).values()].filter(e => e.isDir && e.name !== 'img').map(e => e.name).sort(); }
}

// ---- zip 解析（瀏覽器內，用 DecompressionStream 解 deflate）----
async function unzipEntries(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = buf.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('不是 zip 檔');
  const n = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder('utf-8');
  const out = [];
  let p = cdOff;
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip 目錄損壞');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loc = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    out.push({ name, async data() {
      const ln = dv.getUint16(loc + 26, true), le = dv.getUint16(loc + 28, true);
      const raw = buf.subarray(loc + 30 + ln + le, loc + 30 + ln + le + csize);
      if (method === 0) return new Blob([raw]);
      if (method !== 8) throw new Error('不支援的壓縮方式 ' + method + '：' + name);
      const ds = new DecompressionStream('deflate-raw');
      const w = ds.writable.getWriter(); w.write(raw); w.close();
      return new Response(ds.readable).blob();
    } });
  }
  return out;
}
