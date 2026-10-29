// 題目 HTML（預覽與列印共用）、題目卷／解答卷版面、自動配分
'use strict';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function imgHtml(dir, im, caption) {
  const p = im.path.startsWith('/') ? im.path : `${dir}/${im.path}`;
  const w = Math.min(Number(im.width_cm) || 12, 16);
  return `<img data-src="${esc(p)}" style="width:${w}cm;max-width:100%" alt="">`
    + (caption && im.caption ? `<p class="cap">〔圖說〕${esc(im.caption)}</p>` : '');
}
// 原卷表格截圖（images 內 kind:'table'）：at＝表格前面有幾段非表格文字，對到「｜」文字表格的位置；有截圖就不再畫文字表格
const isTbl = i => i.kind === 'table';
const tblFor = (dir, imgs, cap, site) => (imgs || []).filter(i => isTbl(i) && (i.site || 'stem') === (site || 'stem')).map(i => ({ at: Number(i.at) || 0, h: imgHtml(dir, i, cap) }));
function groupHtml(r, opt) {
  const g = r.q.group;
  if (!g) return '';
  let h = `<div class="grp"><p class="gl">${esc(g.label || '題組')}</p>`;
  h += blocks(lines(g.stem), '', '', '', tblFor(r.dir, g.images, opt.caption)).join('');
  h += (g.images || []).filter(i => !isTbl(i)).map(i => imgHtml(r.dir, i, opt.caption)).join('');
  return h + '</div>';
}
// 「｜」分隔的文字表格（題庫轉錄時用文字寫的表）畫成真正的表格；連續 ≥2 行、每行 ≥2 個分隔符才算
const isRow = l => (String(l).match(/[|｜]/g) || []).length >= 2;
function tableHtml(rows) {
  const cells = rows.map(l => String(l).replace(/^\s*[|｜]|[|｜]\s*$/g, '').split(/\s*[|｜]\s*/));
  return '<table class="tt"><tr>' + cells[0].map(c => `<th>${esc(c)}</th>`).join('') + '</tr>'
    + cells.slice(1).map(r => '<tr>' + r.map(c => `<td>${esc(c)}</td>`).join('') + '</tr>').join('') + '</table>';
}
// 段落陣列 → HTML 區塊陣列（<p> 或 <table>）；pre 加在第一個 <p> 前、tail 加在最後一個 <p> 後（最後是表格時另起一行）
function blocks(list, pre = '', tail = '', cls = '', tbl = []) {
  const out = []; let i = 0, np = 0; const c = cls ? ` class="${cls}"` : '';
  while (i < list.length) {
    if (isRow(list[i]) && i + 1 < list.length && isRow(list[i + 1])) {
      let j = i; while (j < list.length && isRow(list[j])) j++;
      const m = tbl.find(t => t.at === np);
      out.push({ t: 'tb', h: m ? m.h : tableHtml(list.slice(i, j)) }); i = j;
    } else { out.push({ t: 'p', h: `<p${c}>${esc(list[i])}</p>` }); i++; np++; }
  }
  if (!out.length) out.push({ t: 'p', h: `<p${c}></p>` });
  if (pre) { if (out[0].t === 'p') out[0].h = out[0].h.replace(/^<p[^>]*>/, m => m + pre); else out.unshift({ t: 'p', h: `<p${c}>${pre}</p>` }); }
  if (tail) { const L = out[out.length - 1]; if (L.t === 'p') L.h = L.h.replace(/<\/p>$/, tail + '</p>'); else out.push({ t: 'p', h: `<p${c}>${tail}</p>` }); }
  return out.map(b => b.h);
}
// 選項本身就在圖裡（圖說寫「五個選項圖」「各選項…」或 ≥2 個選項寫「見圖」）→ 只印圖、不重印文字選項
function optionsInImage(q) {
  const ops = lines(q.options);
  if (!ops.length || !(q.images || []).length) return false;
  if ((q.images || []).some(im => /選項(的|之)?圖|各選項|個選項|選項\s*[\(（]?A/.test(String(im.caption || '').slice(0, 30)))) return true;
  return ops.filter(o => /見圖|如圖/.test(o)).length >= 2;
}
// 題目本體；n = 考卷題號（預覽時可為 null），opt: {tag:true, space:false, caption:false}
function questionHtml(r, n, opt = {}) {
  const q = r.q, dir = r.dir, h = [];
  const imgs = q.images || [];
  const tagSpan = opt.tag === false ? '' : `<span class="tag">${esc(r.tag)}</span>`;
  h.push(...blocks(lines(q.stem), n != null ? `<b>${n}.</b> ` : '', tagSpan, '', tblFor(dir, imgs, opt.caption)));
  for (const i of imgs) if (!isTbl(i) && !/after/.test(i.pos || '')) h.push(imgHtml(dir, i, opt.caption));
  const optTbl = imgs.filter(i => isTbl(i) && i.site === 'options');
  for (const i of optTbl) h.push(imgHtml(dir, i, opt.caption));
  const ops = optionsInImage(q) || optTbl.length ? [] : lines(q.options);
  if (ops.length) {
    const L = Math.max(...ops.map(o => String(o).length));
    const cols = L <= 12 ? Math.min(ops.length, 5) : (L <= 28 ? 2 : 1);
    h.push(`<div class="opts" style="grid-template-columns:repeat(${cols},1fr)">${ops.map(o => `<p>${esc(o)}</p>`).join('')}</div>`);
  }
  for (const i of imgs) if (!isTbl(i) && /after/.test(i.pos || '')) h.push(imgHtml(dir, i, opt.caption));
  for (const pt of q.parts || []) {
    h.push(...blocks(lines(pt.stem), `<span class="pl">${esc(pt.label)}</span> `, '', 'pt', tblFor(dir, pt.images, opt.caption)));
    h.push(...lines(pt.options).map(o => `<p class="pt opt">${esc(o)}</p>`));
    h.push(...(pt.images || []).filter(i => !isTbl(i)).map(i => imgHtml(dir, i, opt.caption)));
    if (opt.space) h.push('<div class="pspace"></div>');
  }
  if (opt.space && r.tg === '非選' && !(q.parts || []).length) h.push('<div class="space"></div>');
  return h.join('');
}
function shortAns(q) {
  if (q.short) return q.short;
  if (q.parts && q.parts.length) return q.parts.map(pt => `${pt.label} ${pt.short || pt.answer || ''}`).join('　');
  return String(q.answer == null ? '' : q.answer).trim() + (q.doubt ? '＊' : '');
}
function ansBlock(o, dir, lab = '') {
  const h = [`<p class="ans"><b>【簡答】</b>${lab ? esc(lab) + ' ' : ''}${esc(String(o.answer == null ? '' : o.answer).trim())}${o.answer_src ? '（' + esc(o.answer_src) + '）' : ''}</p>`];
  const sol = lines(o.solution);
  if (sol.length) { h.push('<p class="sol"><b>【詳解】</b></p>'); h.push(...blocks(sol, '', '', 'soli')); }
  h.push(...(o.answer_images || []).map(i => imgHtml(dir, i, false)));
  h.push(...lines(o.notes).map(x => `<p class="note"><b>【注意】</b>${esc(x)}</p>`));
  return h.join('');
}
function answerHtml(r, withCls = false) {
  const q = r.q; let h = '';
  if (q.parts && q.parts.length) for (const pt of q.parts) h += ansBlock(pt, r.dir, pt.label);
  else h += ansBlock(q, r.dir);
  if (withCls) for (const c of q.cls || []) {
    h += `<p class="cls"><b>【新版分類${c.label ? ' ' + esc(c.label) : ''}】</b>Tier ${esc(c.tier)}｜冊別 ${esc(c.book)}｜主要章節：${esc(c.main)}｜次要章節：${esc(c.secondary || '無')}｜特殊標籤：${esc(c.tags || '無')}</p><p class="clsr">判斷說明：${esc(c.reason || '')}</p>`;
  }
  return h;
}

// ---------- 自動配分（沿用 make_exam.py 規則）----------
// 總分以 100 為目標；多選每題約為單選的 1.5～2 倍；非選以小題計，每小題同多選。湊不到 100 取最接近且 ≥100。
function autoScore(items) {
  const cnt = { '單選': 0, '多選': 0, '非選': 0 };
  for (const r of items) cnt[r.tg] += r.tg === '非選' ? Math.max(1, (r.q.parts || []).length) : 1;
  let best = null;
  for (let sv = 2; sv <= 10; sv++) {
    const mv0 = Math.ceil(3 * sv / 2);
    for (let mv = mv0; mv <= 2 * sv; mv++) {
      if (!cnt['多選'] && !cnt['非選'] && mv !== mv0) continue;
      const tot = cnt['單選'] * sv + (cnt['多選'] + cnt['非選']) * mv;
      const key = [tot < 100 ? 1 : 0, Math.abs(tot - 100), Math.abs(mv / sv - 5 / 3)];
      if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] || (key[1] === best.key[1] && key[2] < best.key[2]))))
        best = { key, sv, mv, tot };
    }
  }
  return { score: { '單選': best.sv, '多選': best.mv, '非選': best.mv }, total: best.tot, cnt };
}
const SEC_NAME = { '單選': '單選題', '多選': '多選題', '非選': '非選擇題' };
const SEC_INTRO = {
  '單選': '每題有 4 或 5 個選項，其中只有一個是最適當的選項。',
  '多選': '每題有 5 個選項，其中至少有一個是正確的選項。各題之選項獨立判定，所有選項均答對者得該題全部分數；答錯 1 個選項者得 60%；答錯 2 個選項者得 20%；答錯多於 2 個選項或未作答者，該題以零分計算。',
  '非選': '請在答案卷上作答，計算題須寫出計算過程。',
};
const CN = ['一', '二', '三', '四'];

// exam = {title, subtitle, constants[], items[] (已依單選→多選→非選排好), score:{單選,多選,非選}|null, opts:{watermark, space, hideTag, cls}}
function examSections(exam) {
  const secs = [];
  for (const g of ['單選', '多選', '非選']) {
    const qs = exam.items.filter(r => r.tg === g);
    if (qs.length) secs.push({ g, qs });
  }
  let n = 0;
  for (const s of secs) { s.first = n + 1; s.qs = s.qs.map(r => ({ r, n: ++n })); s.last = n; }
  return secs;
}
function headingOf(s, score) {
  let h = `${CN[0 + ['單選', '多選', '非選'].indexOf(s.g)]}、${SEC_NAME[s.g]}（第 ${s.first}–${s.last} 題`;
  if (score) {
    const units = s.qs.reduce((a, x) => a + (s.g === '非選' ? Math.max(1, (x.r.q.parts || []).length) : 1), 0);
    h += `，${s.g === '非選' ? '每小題' : '每題'} ${score[s.g]} 分，共 ${units * score[s.g]} 分`;
  }
  return h + '）';
}
function examHead(exam, kind) {
  const o = exam.opts || {};
  // 浮水印：周逸書法圖（素材/浮水印_周逸.png，使用者 2026-10-28）；卷首標題圖可選
  return (o.watermark ? '<div class="wm"><img data-src="素材/浮水印_周逸.png" alt=""></div>' : '')
    + (o.titleImg ? '<div class="timg"><img data-src="素材/標題_周逸化學小考卷.png" alt="周逸化學小考卷"></div>' : '')
    // 有標題圖時不印「化學測驗／題目卷」字樣（使用者 2026-10-29）；解答卷仍標「解答卷」以免混淆
    + (o.titleImg
      ? ((exam.subtitle || kind !== '題目卷') ? `<p class="subtitle">${esc(exam.subtitle || '')}${kind !== '題目卷' ? '　' + kind : ''}</p>` : '')
      : `<div class="title">${esc(exam.title)}</div><p class="subtitle">${esc(exam.subtitle || '')}　${kind}</p>`);
}
function questionPaperHtml(exam) {
  const secs = examSections(exam), o = exam.opts || {};
  const out = [examHead(exam, '題目卷'),
    '<div class="info">' + (exam.range ? `<span class="rng">出題範圍：${esc(exam.range)}</span>` : '')
    + '<span class="blanks">班級：<span class="bl w3"></span>座號：<span class="bl w2"></span>姓名：<span class="bl w5"></span>得分：<span class="bl w3"></span></span></div>'];
  if (exam.total) out.push(`<p class="sintro">本卷共 ${exam.total} 分${exam.total > 100 ? '，超過 100 分以 100 分計。' : '。'}</p>`);
  if ((exam.constants || []).length) out.push('<div class="const">' + exam.constants.map(c => `<p>${esc(c)}</p>`).join('') + '</div>');
  for (const s of secs) {
    out.push(`<h2>${esc(headingOf(s, exam.score))}</h2><p class="sintro">${esc(SEC_INTRO[s.g])}</p>`);
    let lastGroup = null;
    for (const { r, n } of s.qs) {
      const gk = r.q.group ? `${r.path}#${r.si}#${r.q.group.label}` : null;
      const showGroup = gk && gk !== lastGroup;
      lastGroup = gk;
      out.push(`<div class="q">${showGroup ? groupHtml(r, o) : ''}${questionHtml(r, n, { tag: !o.hideTag, space: !!o.space, caption: false })}</div>`);
    }
  }
  return out.join('\n');
}
function answerPaperHtml(exam) {
  const secs = examSections(exam), o = exam.opts || {};
  const all = secs.flatMap(s => s.qs);
  const mc = all.filter(x => x.r.tg !== '非選'), non = all.filter(x => x.r.tg === '非選');
  const out = [examHead(exam, '解答卷'), '<h2 style="margin-top:4px">簡答表</h2><table>'];
  for (let i = 0; i < mc.length; i += 10) {
    const row = mc.slice(i, i + 10), pad = 10 - row.length;
    out.push('<tr>' + row.map(x => `<th>${x.n}</th>`).join('') + '<th></th>'.repeat(pad) + '</tr>');
    out.push('<tr>' + row.map(x => `<td>${esc(shortAns(x.r.q))}</td>`).join('') + '<td></td>'.repeat(pad) + '</tr>');
  }
  out.push('</table>');
  if (non.length) out.push('<table class="np"><tr><th>題號</th><th>簡答</th></tr>' + non.map(x => `<tr><td>${x.n}</td><td>${esc(shortAns(x.r.q))}</td></tr>`).join('') + '</table>');
  for (const s of secs) {
    out.push(`<h2>詳解　${SEC_NAME[s.g]}</h2><div class="cols">`);
    for (const { r, n } of s.qs) out.push(`<div class="q"><p><b>${n}.</b> <span class="tag">${esc(r.tag)}</span></p>${answerHtml(r, !!o.cls)}</div>`);
    out.push('</div>');
  }
  return out.join('\n');
}
