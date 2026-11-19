// 在瀏覽器內把預覽中的考卷（.paper）轉成 Word（.docx），不需外部套件（使用者 2026-11-04）。
// 做法：逐一走訪 .paper 裡的區塊（標題、題目 .q、選項、圖片、表格、兩欄詳解 .cols），寫成 WordprocessingML，
// 圖片取預覽中已載入的圖、尺寸照預覽（預覽紙張 = A4 可印寬 180 mm，所以 CSS px 就是實際大小），
// 浮水印放頁首、文字下層（周逸書法圖，與 PDF 相同），每題設「與下段同頁＋段落不分頁」＝整題不跨頁，
// 最後用無壓縮 zip（store）打包成 .docx。
const DOCX = (() => {
  const MM_TW = 56.6929;               // 1 mm = 56.69 twips
  const PX_EMU = 9525;                 // 1 CSS px = 9525 EMU
  const PAGE = { w: 210, h: 297, ml: 15, mr: 15, mt: 16, mb: 18 };   // 與 @page 一致
  const USABLE_TW = Math.round((PAGE.w - PAGE.ml - PAGE.mr) * MM_TW);
  const FONT = 'Microsoft JhengHei';
  const C = { tag: 'C55A11', pl: '7030A0', h2: '2E74B5', sol: '1F4E79', note: 'C00000', gray: '444444', cap: '595959', qline: 'C8C8C8',
    ans: 'E8F1FB', noteBg: 'FFF2CC', grp: 'F7F7F7', th: 'DDEBF7' };

  // ---------- 小工具 ----------
  const xe = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hasCls = (el, c) => el.classList && el.classList.contains(c);
  const tw = mm => Math.round(mm * MM_TW);

  // ---------- 文字段（run）----------
  // fmt: {b, u, color, sz(半點), i}
  function runXml(text, fmt) {
    const pr = [`<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/>`];
    if (fmt.b) pr.push('<w:b/><w:bCs/>');
    if (fmt.i) pr.push('<w:i/>');
    if (fmt.u) pr.push('<w:u w:val="single"/>');
    if (fmt.color) pr.push(`<w:color w:val="${fmt.color}"/>`);
    if (fmt.sz) pr.push(`<w:sz w:val="${fmt.sz}"/><w:szCs w:val="${fmt.sz}"/>`);
    if (fmt.vert) pr.push(`<w:vertAlign w:val="${fmt.vert}"/>`);
    const parts = String(text).split('\n');
    return parts.map((t, k) => (k ? `<w:r><w:rPr>${pr.join('')}</w:rPr><w:br/></w:r>` : '')
      + (t ? `<w:r><w:rPr>${pr.join('')}</w:rPr><w:t xml:space="preserve">${xe(t)}</w:t></w:r>` : '')).join('');
  }

  // ---------- 圖片 ----------
  function sniff(u8) {
    if (u8[0] === 0x89 && u8[1] === 0x50) return 'png';
    if (u8[0] === 0xFF && u8[1] === 0xD8) return 'jpeg';
    return '';
  }
  async function imgBytes(im) {
    const src = im.currentSrc || im.src;
    if (!src) return null;
    try {
      const buf = new Uint8Array(await (await fetch(src)).arrayBuffer());
      const t = sniff(buf);
      if (t) return { bytes: buf, ext: t === 'png' ? 'png' : 'jpeg' };
    } catch (e) { }
    // 其他格式（gif、webp、svg）或抓不到：用 canvas 轉 PNG
    try {
      const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
      cv.getContext('2d').drawImage(im, 0, 0);
      const b = await new Promise(res => cv.toBlob(res, 'image/png'));
      return { bytes: new Uint8Array(await b.arrayBuffer()), ext: 'png' };
    } catch (e) { return null; }
  }

  class Doc {
    constructor(opts) {
      this.opts = opts; this.media = []; this.rels = []; this.idn = 1;
      this.baseSz = Math.round((opts.fontPt || 10) * 2);
    }
    rel(type, target) { const id = 'rId' + (this.rels.length + 10); this.rels.push({ id, type, target }); return id; }
    async addImage(im) {
      const d = await imgBytes(im); if (!d) return null;
      const name = `image${this.media.length + 1}.${d.ext === 'png' ? 'png' : 'jpg'}`;
      this.media.push({ name, bytes: d.bytes });
      return this.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', 'media/' + name);
    }
    // 行內圖：尺寸照預覽畫面（px → EMU）
    async inlineImg(im, maxWpx) {
      const r = im.getBoundingClientRect();
      let w = r.width || im.naturalWidth, h = r.height || im.naturalHeight;
      if (!w || !h) return '';
      // object-fit:contain 時框比圖大：依原圖比例取實際圖面
      if (im.naturalWidth && im.naturalHeight) {
        const k = Math.min(w / im.naturalWidth, h / im.naturalHeight);
        w = im.naturalWidth * k; h = im.naturalHeight * k;
      }
      if (maxWpx && w > maxWpx) { h = h * maxWpx / w; w = maxWpx; }
      const rid = await this.addImage(im); if (!rid) return '';
      const id = this.idn++, cx = Math.round(w * PX_EMU), cy = Math.round(h * PX_EMU);
      return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="圖${id}"/>`
        + `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>`
        + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
        + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="圖${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
        + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
        + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    }
  }

  // ---------- 段落屬性 ----------
  // p: {jc, ind(左縮 twips), shd, color, sz, bdrTop, bdrBottom, box, keep, before, after, tabs:[{pos,val}]}
  function pPr(p) {
    const x = [];
    if (p.keep) x.push('<w:keepNext/>');
    if (p.keepLines) x.push('<w:keepLines/>');
    const bd = [];
    if (p.box) bd.push(...['top', 'left', 'bottom', 'right'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="3" w:color="999999"/>`));
    else {
      if (p.bdrTop) bd.push(`<w:top w:val="single" w:sz="4" w:space="2" w:color="${p.bdrTop}"/>`);
      if (p.bdrBottom) bd.push(`<w:bottom w:val="single" w:sz="12" w:space="1" w:color="${p.bdrBottom}"/>`);
    }
    if (bd.length) x.push(`<w:pBdr>${bd.join('')}</w:pBdr>`);
    if (p.shd) x.push(`<w:shd w:val="clear" w:color="auto" w:fill="${p.shd}"/>`);
    if (p.tabs && p.tabs.length) x.push('<w:tabs>' + p.tabs.map(t => `<w:tab w:val="${t.val || 'left'}" w:pos="${t.pos}"/>`).join('') + '</w:tabs>');
    x.push(`<w:spacing w:before="${p.before || 0}" w:after="${p.after || 0}"${p.exact ? ` w:line="${p.exact}" w:lineRule="exact"` : ''}/>`);
    if (p.ind) x.push(`<w:ind w:left="${p.ind}"/>`);
    if (p.jc) x.push(`<w:jc w:val="${p.jc}"/>`);
    if (p.sect) x.push(p.sect);
    return `<w:pPr>${x.join('')}</w:pPr>`;
  }
  const para = (p, runs) => `<w:p>${pPr(p)}${runs}</w:p>`;

  // ---------- 由 class 決定段落／字的樣式 ----------
  function styleOf(el, ctx) {
    const p = { ind: ctx.ind || 0, shd: ctx.shd || '', after: 0 }, f = { sz: ctx.sz, color: ctx.color || '' };
    const c = el.classList || { contains: () => false };
    if (c.contains('subtitle')) { p.jc = 'center'; p.after = 120; f.sz = 23; }
    if (c.contains('title')) { p.jc = 'center'; f.sz = 32; }
    if (c.contains('sintro')) { f.sz = 19; f.color = C.gray; p.after = 60; p.keep = true; }
    if (c.contains('cap')) { f.sz = 18; f.color = C.cap; p.ind += tw(3.5); }
    if (c.contains('opt')) p.ind += tw(5.6);
    if (c.contains('pt')) p.ind += tw(3.5);
    if (c.contains('soli')) p.ind += tw(3.5);
    if (c.contains('ans')) p.shd = C.ans;
    if (c.contains('note')) p.shd = C.noteBg;
    if (c.contains('sol')) f.color = C.sol;
    if (c.contains('cls') || c.contains('clsr')) { f.sz = 17; f.color = '333333'; }
    if (c.contains('gl')) { f.b = true; f.u = true; }
    return { p, f };
  }

  // ---------- 行內內容 → runs ----------
  async function inlineRuns(node, f, doc, maxWpx) {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { const t = n.textContent.replace(/\s*\n\s*/g, ' '); if (t) out += runXml(t, f); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName, g = { ...f };
      if (tag === 'BR') { out += runXml('\n', f); continue; }
      if (tag === 'IMG') { out += await doc.inlineImg(n, maxWpx); continue; }
      if (tag === 'B' || tag === 'STRONG') g.b = true;
      if (tag === 'I' || tag === 'EM') g.i = true;
      if (tag === 'U') g.u = true;
      if (tag === 'SUB') g.vert = 'subscript';
      if (tag === 'SUP') g.vert = 'superscript';
      if (hasCls(n, 'tag')) { g.b = true; g.color = C.tag; }
      if (hasCls(n, 'pl')) { g.b = true; g.color = C.pl; }
      if (hasCls(n.parentNode, 'cls') && tag === 'B') { g.b = false; g.color = C.tag; }
      if (hasCls(n.parentNode, 'note') && tag === 'B') g.color = C.note;
      if (hasCls(n, 'bl')) {   // 填空底線（班級、座號、姓名、得分）
        const k = hasCls(n, 'w5') ? 8 : hasCls(n, 'w2') ? 3 : 5;
        out += runXml('　'.repeat(k), { ...g, u: true }) + runXml(' ', g); continue;
      }
      if (hasCls(n, 'rng')) { g.sz = 17; g.color = '333333'; }
      out += await inlineRuns(n, g, doc, maxWpx);
    }
    return out;
  }

  // ---------- 表格 ----------
  async function tableXml(t, ctx, doc) {
    const rows = [...t.rows]; if (!rows.length) return '';
    const ncol = Math.max(...rows.map(r => [...r.cells].reduce((a, c) => a + (c.colSpan || 1), 0)));
    const auto = hasCls(t, 'tt'), np = hasCls(t, 'np');
    const sz = auto ? (ctx.inCols ? 17 : 18) : ctx.sz;
    const full = ctx.width || USABLE_TW;
    let grid;
    if (np) { const a = tw(14); grid = [a, ...Array(ncol - 1).fill(Math.round((full - a) / Math.max(1, ncol - 1)))]; }
    else grid = Array(ncol).fill(Math.round(full / ncol));
    const tblPr = `<w:tblPr><w:tblW w:w="${auto ? 0 : full}" w:type="${auto ? 'auto' : 'dxa'}"/>${auto ? `<w:tblInd w:w="${(ctx.ind || 0) + tw(3.5)}" w:type="dxa"/>` : ''}`
      + '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="888888"/>`).join('') + '</w:tblBorders>'
      + `<w:tblLayout w:type="${auto ? 'autofit' : 'fixed'}"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
    let x = `<w:tbl>${tblPr}<w:tblGrid>${grid.map(g => `<w:gridCol w:w="${g}"/>`).join('')}</w:tblGrid>`;
    for (let ri = 0; ri < rows.length; ri++) {
      const last = ri === rows.length - 1;
      x += `<w:tr><w:trPr><w:cantSplit/></w:trPr>`;
      let ci = 0;
      for (const cell of rows[ri].cells) {
        const span = cell.colSpan || 1, th = cell.tagName === 'TH';
        const wcell = auto ? 0 : grid.slice(ci, ci + span).reduce((a, b) => a + b, 0); ci += span;
        const left = np && ci > 1 && !th;
        const runs = await inlineRuns(cell, { sz }, doc, (wcell ? wcell / 15 : 600) - 12);
        // 整題不跨頁：題內表格每列都與下段同頁；最後一列只在題目還有後續時才連下段
        const keep = ctx.keep && (!last || ctx.keepAfter);
        x += `<w:tc><w:tcPr><w:tcW w:w="${wcell}" w:type="${auto ? 'auto' : 'dxa'}"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${th ? `<w:shd w:val="clear" w:color="auto" w:fill="${C.th}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr>`
          + para({ jc: left ? 'left' : 'center', keep }, runs || '') + '</w:tc>';
      }
      x += '</w:tr>';
    }
    return x + '</w:tbl>';
  }

  // ---------- 區塊 → 一串「項目」（段落或表格），之後再統一加「與下段同頁」 ----------
  // 每個項目 {k:'p', p, runs} 或 {k:'raw', xml}（表格）或 {k:'tbl', el, ctx}
  async function blocksOf(el, ctx, doc, items) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) items.push({ k: 'p', p: { ind: ctx.ind || 0, shd: ctx.shd }, runs: runXml(t, { sz: ctx.sz }) }); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (getComputedStyle(n).display === 'none' && !hasCls(n, 'wm')) continue;
      if (hasCls(n, 'wm')) continue;   // 浮水印另外放頁首
      if (tag === 'H2') {
        items.push({ k: 'p', p: { keep: true, bdrBottom: C.h2, before: 160, after: 80 }, runs: runXml(n.textContent, { sz: 24, color: C.h2 }) });
        continue;
      }
      if (tag === 'TABLE') { items.push({ k: 'tbl', el: n, ctx: { ...ctx } }); continue; }
      if (tag === 'IMG' && hasCls(n, 'shot')) { items.push({ k: 'p', p: { ind: (ctx.ind || 0) + tw(4), before: 20, after: 40, shd: ctx.shd }, runs: await doc.inlineImg(n, ((ctx.width || USABLE_TW) - tw(4)) / 15) }); continue; }
      if (tag === 'IMG') { items.push({ k: 'p', p: { jc: 'center', before: 60, after: 60 }, runs: await doc.inlineImg(n, (ctx.width || USABLE_TW) / 15) }); continue; }
      if (hasCls(n, 'timg')) { await blocksOf(n, ctx, doc, items); continue; }
      if (hasCls(n, 'imgrow')) {   // 同一處多張圖排成一列
        const imgs = [...n.querySelectorAll('img')], k = Number(getComputedStyle(n).getPropertyValue('--k')) || imgs.length;
        const maxW = ((ctx.width || USABLE_TW) / 15 - 12 * (k - 1)) / k;
        let runs = '';
        for (let i = 0; i < imgs.length; i++) runs += (i && i % k === 0 ? runXml('\n', {}) : i ? runXml('　', {}) : '') + await doc.inlineImg(imgs[i], maxW);
        for (const cap of n.querySelectorAll('.cap')) runs += runXml('\n' + cap.textContent, { sz: 18, color: C.cap });
        items.push({ k: 'p', p: { jc: 'center', before: 40, after: 40 }, runs });
        continue;
      }
      if (hasCls(n, 'info')) {   // 出題範圍（左）＋ 班級座號姓名得分（右）
        const rng = n.querySelector('.rng'), bl = n.querySelector('.blanks');
        let runs = rng ? runXml(rng.textContent, { sz: 17, color: '333333' }) : '';
        if (bl) runs += (rng ? '<w:r><w:tab/></w:r>' : '') + await inlineRuns(bl, { sz: ctx.sz }, doc);
        items.push({ k: 'p', p: { jc: rng ? 'left' : 'right', tabs: [{ pos: USABLE_TW, val: 'right' }], before: 60, after: 120 }, runs });
        continue;
      }
      if (hasCls(n, 'const')) {   // 參考數據：外框
        for (const c of n.children) items.push({ k: 'p', p: { box: true }, runs: await inlineRuns(c, { sz: 19 }, doc) });
        items.push({ k: 'p', p: { exact: 120 }, runs: '' });
        continue;
      }
      if (hasCls(n, 'opts')) {   // 選項：依 grid 欄數用定位點排成一列
        const m = /repeat\((\d+)/.exec(n.style.gridTemplateColumns || ''), cols = m ? Number(m[1]) : 1;
        const ind = (ctx.ind || 0) + tw(5.6), w = (ctx.width || USABLE_TW) - ind;
        const ps = [...n.children];
        for (let i = 0; i < ps.length; i += cols) {
          let runs = '';
          for (let j = 0; j < cols && i + j < ps.length; j++) runs += (j ? '<w:r><w:tab/></w:r>' : '') + await inlineRuns(ps[i + j], { sz: ctx.sz }, doc);
          items.push({ k: 'p', p: { ind, shd: ctx.shd, tabs: cols > 1 ? Array.from({ length: cols - 1 }, (_, j) => ({ pos: ind + Math.round(w * (j + 1) / cols) })) : [] }, runs });
        }
        continue;
      }
      if (hasCls(n, 'space') || hasCls(n, 'pspace')) {   // 非選留白
        items.push({ k: 'p', p: { exact: tw(hasCls(n, 'space') ? 30 : 22) }, runs: '' }); continue;
      }
      if (hasCls(n, 'grp')) { await blocksOf(n, { ...ctx, shd: C.grp }, doc, items); continue; }
      if (hasCls(n, 'q')) {   // 一題：上方細線，整題同頁
        const qi = [];
        await blocksOf(n, ctx, doc, qi);
        if (qi.length) {
          const f = qi.find(x => x.k === 'p');
          if (f && qi[0] === f) { f.p.bdrTop = C.qline; f.p.before = 40; }
          else qi.unshift({ k: 'p', p: { bdrTop: C.qline, exact: 80 }, runs: '' });
          qi.forEach((x, i) => { x.keepGroup = true; x.keepAfter = i < qi.length - 1; });
          qi[qi.length - 1].p && (qi[qi.length - 1].p.after = 60);
        }
        items.push(...qi);
        continue;
      }
      if (hasCls(n, 'cols')) {   // 兩欄詳解：用 Word 分欄（前後各一個連續分節）
        items.push({ k: 'sect', cols: 1 });
        await blocksOf(n, { ...ctx, sz: 18, inCols: true, width: Math.round((USABLE_TW - tw(7)) / 2) }, doc, items);
        items.push({ k: 'sect', cols: 2 });
        continue;
      }
      if (tag === 'P' || tag === 'DIV' && !n.querySelector('p, div, table, img')) {
        const s = styleOf(n, ctx);
        if (s.f.sz == null) s.f.sz = ctx.sz;
        items.push({ k: 'p', p: s.p, runs: await inlineRuns(n, s.f, doc, (ctx.width || USABLE_TW) / 15) });
        continue;
      }
      await blocksOf(n, ctx, doc, items);   // 其他容器：往下拆
    }
    return items;
  }

  function sectPr(doc, cols, last) {
    return `<w:sectPr>${doc.hdrId ? `<w:headerReference w:type="default" r:id="${doc.hdrId}"/>` : ''}${last ? '' : '<w:type w:val="continuous"/>'}`
      + `<w:pgSz w:w="${tw(PAGE.w)}" w:h="${tw(PAGE.h)}"/><w:pgMar w:top="${tw(PAGE.mt)}" w:right="${tw(PAGE.mr)}" w:bottom="${tw(PAGE.mb)}" w:left="${tw(PAGE.ml)}" w:header="${tw(8)}" w:footer="${tw(8)}" w:gutter="0"/>`
      + `<w:cols w:num="${cols}" w:space="${tw(7)}"/></w:sectPr>`;
  }

  async function body(paper, doc) {
    const items = await blocksOf(paper, { sz: doc.baseSz, ind: 0 }, doc, []);
    // 最後一段是兩欄詳解時，不另起空白分節，直接讓文件最後的分節設為兩欄（避免多出一頁空白）
    let lastCols = 1;
    while (items.length && items[items.length - 1].k === 'sect') lastCols = items.pop().cols;
    let x = '';
    for (const it of items) {
      if (it.k === 'sect') { x += para({ sect: sectPr(doc, it.cols, false), exact: 20 }, ''); continue; }
      if (it.k === 'tbl') { x += await tableXml(it.el, { ...it.ctx, keep: !!it.keepGroup, keepAfter: !!it.keepAfter }, doc); continue; }
      const p = { ...it.p };
      if (it.keepGroup) { p.keepLines = true; if (it.keepAfter) p.keep = true; }
      x += para(p, it.runs);
    }
    return x + sectPr(doc, lastCols, true);
  }

  // ---------- 頁首浮水印（文字下層、置中、110 mm） ----------
  async function header(doc, wmImg) {
    const rid = await doc.addImage(wmImg); if (!rid) return null;
    const s = Math.round(110 * 36000), id = doc.idn++;
    const hdrRels = [{ id: 'rIdW', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', target: doc.rels.find(r => r.id === rid).target }];
    doc.rels = doc.rels.filter(r => r.id !== rid);
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:drawing>`
      + `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>`
      + `<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH><wp:positionV relativeFrom="page"><wp:align>center</wp:align></wp:positionV>`
      + `<wp:extent cx="${s}" cy="${s}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="浮水印"/><wp:cNvGraphicFramePr/>`
      + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
      + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="浮水印"/><pic:cNvPicPr/></pic:nvPicPr>`
      + `<pic:blipFill><a:blip r:embed="rIdW"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
      + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${s}" cy="${s}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:hdr>`;
    return { xml, rels: hdrRels };
  }

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const relsXml = rels => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + rels.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${xe(r.target)}"/>`).join('') + '</Relationships>';

  // ---------- zip（store，不壓縮） ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    const enc = new TextEncoder(), chunks = [], central = []; let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      chunks.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    }
    const csize = central.reduce((a, b) => a + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob([...chunks, ...central, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  // paper：預覽中的 .paper 元素（圖片已載入）；opts: {title, fontPt, watermark(已載入的 <img> 或 URL)}
  async function make(paper, opts = {}) {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const doc = new Doc(opts);
    let hdr = null;
    if (opts.watermark) {
      const wm = typeof opts.watermark === 'string' ? await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = opts.watermark; }) : opts.watermark;
      if (wm) hdr = await header(doc, wm);
      if (hdr) doc.hdrId = doc.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/header', 'header1.xml');
    }
    const bodyXml = await body(paper, doc);
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${bodyXml}</w:body></w:document>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
      + `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/><w:color w:val="111111"/><w:sz w:val="${doc.baseSz}"/><w:szCs w:val="${doc.baseSz}"/><w:lang w:val="en-US" w:eastAsia="zh-TW"/></w:rPr></w:rPrDefault>`
      + `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
      + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`
      + `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
      + `<dc:title>${xe(opts.title || '')}</dc:title><dc:creator>周逸化學</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
    const docRels = [{ id: 'rIdS', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles', target: 'styles.xml' }, ...doc.rels];
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        + '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>'
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        + (hdr ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : '')
        + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
      { name: '_rels/.rels', data: relsXml([{ id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', target: 'word/document.xml' },
        { id: 'rId2', type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', target: 'docProps/core.xml' }]) },
      { name: 'docProps/core.xml', data: core },
      { name: 'word/document.xml', data: docXml },
      { name: 'word/styles.xml', data: styles },
      { name: 'word/_rels/document.xml.rels', data: relsXml(docRels) },
    ];
    if (hdr) { files.push({ name: 'word/header1.xml', data: hdr.xml }, { name: 'word/_rels/header1.xml.rels', data: relsXml(hdr.rels) }); }
    for (const m of doc.media) files.push({ name: 'word/media/' + m.name, data: m.bytes });
    return { blob: zip(files), images: doc.media.length };
  }

  function download(blob, filename) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  return { make, download };
})();
