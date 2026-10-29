// 在瀏覽器內直接把考卷做成 PDF（給手機用：iPhone 分享到 LINE；電腦則下載）。
// 做法：html2canvas 把 .paper 畫成高解析圖，依 A4 可印高度切頁（切點避開整題／標題），
// 每頁先墊浮水印再貼內容，最後用極簡 PDF 寫法把每頁 JPEG 包成 PDF（不需 jsPDF）。
const PDF = (() => {
  const MM = 96 / 25.4;                 // 1 mm 的 CSS px
  const PAGE = { w: 210, h: 297, ml: 15, mr: 15, mt: 16, mb: 18 }; // 與 @page 一致
  const PT = 72 / 25.4;                 // 1 mm 的 pt

  // 找出切頁點：在 limit 以內、且不切到任何「整塊」（.q、h2、p、table、img、.const）
  function cutPoints(root, scale) {
    const base = root.getBoundingClientRect().top;
    const atoms = [...root.querySelectorAll('.q, h2, p, table, img, .const, .info, .timg')].map(el => {
      const r = el.getBoundingClientRect(); return { top: (r.top - base) * scale, bottom: (r.bottom - base) * scale, h2: el.tagName === 'H2' };
    }).filter(a => a.bottom > a.top);
    const cands = [...new Set(atoms.flatMap(a => [a.top, a.bottom]))].sort((x, y) => x - y);
    return { atoms, cands };
  }
  function pickCut(cp, from, limit, pageH) {
    let best = -1;
    for (const y of cp.cands) {
      if (y <= from + 1 || y > limit) continue;
      const ok = cp.atoms.every(a => !(a.top < y - 0.5 && a.bottom > y + 0.5) || (a.bottom - a.top) > pageH * 0.9);
      if (ok) best = y;
    }
    if (best > 0) {   // 標題（h2）不孤懸頁尾：切點剛好在某個 h2 下緣時，改切在它上緣
      const h = cp.atoms.find(a => a.h2 && Math.abs(a.bottom - best) < 2);
      if (h && h.top > from + 1) best = h.top;
    }
    return best > 0 ? best : limit;
  }

  async function loadImg(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  }

  // 把 .paper 元素做成每頁 JPEG dataURL 陣列
  async function renderPages(paper, opts = {}) {
    const scale = opts.scale || 2;
    const usableW = (PAGE.w - PAGE.ml - PAGE.mr) * MM, usableH = (PAGE.h - PAGE.mt - PAGE.mb) * MM;
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    paper.classList.add('pdf');          // 單欄排版（.cols 兩欄在切頁時會被切到行中）
    const canvas = await html2canvas(paper, { scale, backgroundColor: null, useCORS: true, logging: false, windowWidth: document.documentElement.clientWidth });
    const cp = cutPoints(paper, scale);
    paper.classList.remove('pdf');
    const pageH = usableH * scale, total = canvas.height;
    const wm = opts.watermark ? await loadImg(opts.watermark).catch(() => null) : null;
    const pages = []; let y = 0;
    while (y < total - 2) {
      const limit = Math.min(y + pageH, total);
      const cut = (limit >= total) ? total : pickCut(cp, y, limit, pageH);
      const pc = document.createElement('canvas');
      pc.width = Math.round(PAGE.w * MM * scale); pc.height = Math.round(PAGE.h * MM * scale);
      const g = pc.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, pc.width, pc.height);
      if (wm) { const s = 110 * MM * scale; g.drawImage(wm, (pc.width - s) / 2, (pc.height - s) / 2, s, s); }
      g.drawImage(canvas, 0, y, canvas.width, cut - y, PAGE.ml * MM * scale, PAGE.mt * MM * scale, canvas.width, cut - y);
      pages.push(pc.toDataURL('image/jpeg', opts.quality || 0.85));
      y = cut;
    }
    return pages;
  }

  // 極簡 PDF：每頁一張滿版 JPEG
  function b64ToBytes(b64) { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function buildPdf(pages, title) {
    const enc = new TextEncoder();
    const objs = [];                     // 每個元素是 Uint8Array（物件內容）
    const add = parts => { objs.push(parts); return objs.length; };
    const W = (PAGE.w * PT).toFixed(2), H = (PAGE.h * PT).toFixed(2);
    const catalog = add(null), pagesObj = add(null);
    const kids = [];
    for (const dataUrl of pages) {
      const jpg = b64ToBytes(dataUrl.split(',')[1]);
      // 讀 JPEG 尺寸（SOF 標記）
      let i = 2, w = 0, h = 0;
      while (i < jpg.length) { if (jpg[i] !== 0xFF) { i++; continue; } const m = jpg[i + 1]; if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) { h = (jpg[i + 5] << 8) | jpg[i + 6]; w = (jpg[i + 7] << 8) | jpg[i + 8]; break; } i += 2 + ((jpg[i + 2] << 8) | jpg[i + 3]); }
      const img = add([enc.encode(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`), jpg, enc.encode('\nendstream')]);
      const content = enc.encode(`q ${W} 0 0 ${H} 0 0 cm /Im${img} Do Q`);
      const cs = add([enc.encode(`<< /Length ${content.length} >>\nstream\n`), content, enc.encode('\nendstream')]);
      const pg = add([enc.encode(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im${img} ${img} 0 R >> >> /Contents ${cs} 0 R >>`)]);
      kids.push(pg);
    }
    objs[catalog - 1] = [enc.encode(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`)];
    objs[pagesObj - 1] = [enc.encode(`<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`)];
    const infoT = title ? '(' + Array.from(enc.encode(title)).map(b => '\\' + b.toString(8).padStart(3, '0')).join('') + ')' : '()';
    const info = add([enc.encode(`<< /Producer (chem-exam) /Title ${infoT} >>`)]);
    // 組檔
    const chunks = [enc.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')]; let off = chunks[0].length; const xref = [];
    objs.forEach((parts, idx) => {
      xref.push(off);
      const head = enc.encode(`${idx + 1} 0 obj\n`), tail = enc.encode('\nendobj\n');
      for (const c of [head, ...parts, tail]) { chunks.push(c); off += c.length; }
    });
    const xrefOff = off;
    let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of xref) x += String(o).padStart(10, '0') + ' 00000 n \n';
    x += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xrefOff}\n%%EOF\n`;
    chunks.push(enc.encode(x));
    return new Blob(chunks, { type: 'application/pdf' });
  }

  async function make(paper, opts) {
    const pages = await renderPages(paper, opts);
    return { blob: buildPdf(pages, opts.title), pages: pages.length };
  }
  // 分享（iPhone／Android 會跳出分享選單，可選 LINE）；不支援則下載
  async function shareOrDownload(blob, filename) {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return 'shared'; }
      catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    return 'downloaded';
  }
  return { make, shareOrDownload };
})();
