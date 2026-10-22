// File PDF "Bảng tính lãi vay" để gửi cho người khác (nút Chia sẻ). Trình duyệt không có sẵn công cụ tạo PDF, nên mỗi trang A4 ngang được vẽ
// bằng canvas — cùng bố cục, màu và kiểu chữ của app (Inter, Source Serif 4) như bản in ở js/lib/loanCalcExport.js — rồi ghép các trang ảnh
// vào một tệp PDF tối giản. Phần thuần (chia trang, ghi PDF) kiểm thử bằng node: tests/loanCalcPdf.test.mjs.
import { printModel, loanCalcFileName, SANS_STACK, SERIF_STACK } from './loanCalcExport.js';
import { downloadBlob } from './xlsxWrite.js';

// ---- Kích thước (mm) — khớp với bản in HTML ----
const DPI = 180;
const S = DPI / 25.4;               // điểm ảnh trên mm
const PT = 25.4 / 72;               // mm trên 1 pt
export const PAGE = { w: 297, h: 210 };
const X0 = 14, X1 = 283, TOP = 12, BOTTOM = 196;
export const COLS_MM = [22, 30, 22, 40, 38, 38, 40, 39];
export const GEO = { headH: 8, rowH: 6, totalH: 7.5, noteGap: 3.4, noteH: 4, firstTableTop: 96.37 };

/** Chia các dòng bảng vào các trang: trang 1 có phần đầu (điều kiện + ô tổng), dòng Cộng và ghi chú nằm cuối trang cuối. */
export function planPages(rowCount) {
  const cap = (top) => Math.max(1, Math.floor((BOTTOM - (top + GEO.headH)) / GEO.rowH));
  const capFirst = cap(GEO.firstTableTop), capNext = cap(TOP);
  const counts = [];
  let left = rowCount;
  counts.push(Math.min(left, capFirst)); left -= counts[0];
  while (left > 0) { const n = Math.min(left, capNext); counts.push(n); left -= n; }
  // Cuối bảng phải còn chỗ cho dòng Cộng + ghi chú; thiếu thì chuyển vài dòng cuối sang một trang mới để dòng Cộng không đứng một mình.
  const tail = GEO.totalH + GEO.noteGap + GEO.noteH;
  const lastTop = counts.length === 1 ? GEO.firstTableTop : TOP;
  const used = lastTop + GEO.headH + counts[counts.length - 1] * GEO.rowH;
  if (used + tail > BOTTOM) {
    const last = counts.length - 1;
    const move = Math.min(3, counts[last] - 1); // luôn giữ lại ít nhất 1 dòng ở trang trước
    counts[last] -= move; counts.push(move);
  }
  let start = 0;
  return counts.map((n, i) => { const p = { index: i, from: start, to: start + n, first: i === 0, last: i === counts.length - 1 }; start += n; return p; });
}

// ---- Ghi PDF tối giản: mỗi trang là một ảnh JPEG phủ kín khổ A4 ngang ----
const hexUtf16 = (s) => `<FEFF${[...String(s)].map((c) => c.codePointAt(0).toString(16).padStart(4, '0')).join('')}>`;

/** pages = [{ jpeg: Uint8Array, width, height }] (điểm ảnh). Trả về Uint8Array của tệp PDF. */
export function buildPdf(pages, { title = '' } = {}) {
  const enc = new TextEncoder();
  const chunks = [], offsets = [];
  let offset = 0;
  const push = (d) => { const b = typeof d === 'string' ? enc.encode(d) : d; chunks.push(b); offset += b.length; };
  const begin = (n) => { offsets[n] = offset; push(`${n} 0 obj\n`); };
  const wPt = 841.89, hPt = 595.28;
  const total = 3 + pages.length * 3;
  push('%PDF-1.4\n%âãÏÓ\n');
  begin(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  begin(2); push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + i * 3} 0 R`).join(' ')}] >>\nendobj\n`);
  begin(3); push(`<< /Title ${hexUtf16(title)} /Producer (Quy tin dung) >>\nendobj\n`);
  pages.forEach((pg, i) => {
    const page = 4 + i * 3, content = page + 1, image = page + 2;
    begin(page); push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>\nendobj\n`);
    const draw = `q ${wPt} 0 0 ${hPt} 0 0 cm /Im0 Do Q`;
    begin(content); push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream\nendobj\n`);
    begin(image); push(`<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`);
    push(pg.jpeg); push('\nendstream\nendobj\n');
  });
  const xref = offset;
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n${Array.from({ length: total }, (_, k) => `${String(offsets[k + 1]).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(offset);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

// ---- Vẽ từng trang bằng canvas ----
const C = { ink: '#12231e', em: '#0c4a3f', gold: '#b08d3c', goldDark: '#8a6a22', muted: '#6a7a73', cream: '#f7f1df', hi: '#e9f3ee', zebra: '#f8faf8', rowLine: '#a3b8ae', paramLine: '#c9d6cf', secLine: '#c9d6cf', total: '#f1e7c6', white: '#ffffff' };
const px = (mm) => mm * S;
const fontStr = (weight, sizePt, family, italic = false) => `${italic ? 'italic ' : ''}${weight} ${(sizePt * PT * S).toFixed(2)}px ${family}`;

// Độ rộng chữ số rộng nhất của từng kiểu chữ — đo một lần rồi nhớ lại (mỗi dòng bảng có hàng chục lần cần tới).
const digitCache = new Map();
const digitWidth = (ctx) => {
  let w = digitCache.get(ctx.font);
  if (w === undefined) { w = Math.max(...'0123456789'.split('').map((d) => ctx.measureText(d).width)); digitCache.set(ctx.font, w); }
  return w;
};

/** Độ rộng chữ; tracking = khoảng cách thêm giữa các chữ (mm), tnum = số rộng đều nhau để cột số thẳng hàng. */
function measure(ctx, text, o) {
  if (!o.track && !o.tnum) return ctx.measureText(text).width / S;
  let w = 0;
  const digit = o.tnum ? digitWidth(ctx) : 0;
  for (const ch of text) w += (o.tnum && ch >= '0' && ch <= '9' ? digit : ctx.measureText(ch).width) / S + (o.track || 0);
  return w - (o.track || 0);
}
/** Vẽ chữ tại (x, y) mm, y là đường chân chữ. align: left | center | right. */
function text(ctx, str, x, y, { weight = 500, size = 9.5, family = SANS_STACK, color = C.ink, align = 'left', track = 0, tnum = false, italic = false, maxW = 0 } = {}) {
  let sz = size;
  ctx.font = fontStr(weight, sz, family, italic);
  const o = { track: track * sz * PT, tnum };
  let w = measure(ctx, str, o);
  if (maxW && w > maxW) { sz = size * (maxW / w); ctx.font = fontStr(weight, sz, family, italic); o.track = track * sz * PT; w = measure(ctx, str, o); }
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  let cx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  if (!o.track && !o.tnum) { ctx.fillText(str, px(cx), px(y)); return; }
  const digit = o.tnum ? digitWidth(ctx) : 0;
  for (const ch of str) {
    const cw = o.tnum && ch >= '0' && ch <= '9' ? digit : ctx.measureText(ch).width;
    // Số rộng đều: căn giữa từng chữ số trong ô cố định để nhìn đều như tabular-nums.
    const dx = o.tnum && ch >= '0' && ch <= '9' ? (digit - ctx.measureText(ch).width) / 2 : 0;
    ctx.fillText(ch, px(cx) + dx, px(y));
    cx += cw / S + o.track;
  }
}
const rect = (ctx, x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(px(x), px(y), px(w), px(h)); };
const hline = (ctx, x1, x2, y, thick, color) => rect(ctx, x1, y - thick / 2, x2 - x1, thick, color);

function colEdges() {
  const e = [X0];
  for (const w of COLS_MM) e.push(e[e.length - 1] + w);
  return e;
}
const ALIGN = ['left', 'center', 'center', 'right', 'right', 'right', 'right', 'right'];
const cellX = (edges, i) => (ALIGN[i] === 'left' ? edges[i] + 4 : ALIGN[i] === 'center' ? (edges[i] + edges[i + 1]) / 2 : edges[i + 1] - 4);

function drawTableHead(ctx, top, head) {
  const edges = colEdges();
  rect(ctx, X0, top, X1 - X0, GEO.headH, C.em);
  head.forEach((t, i) => text(ctx, t.toUpperCase(), cellX(edges, i), top + GEO.headH / 2 + 0.9, { weight: 700, size: 7, color: C.white, align: ALIGN[i], track: 0.1 }));
}
function drawRow(ctx, top, r, odd) {
  const edges = colEdges();
  if (odd) rect(ctx, X0, top, X1 - X0, GEO.rowH, C.zebra);
  hline(ctx, X0, X1, top + GEO.rowH - 0.15, 0.3, C.rowLine);
  const y = top + GEO.rowH / 2 + 1.15;
  const cells = [[r.ky, 700, C.ink], [r.date, 500, C.ink], [r.days, 500, C.ink], [r.opening, 500, C.ink], [r.principal, 600, C.em], [r.interest, 600, C.goldDark], [r.payment, 700, C.ink], [r.closing, 500, C.ink]];
  cells.forEach(([t, weight, color], i) => text(ctx, t, cellX(edges, i), y, { weight, size: 9, color, align: ALIGN[i], tnum: i > 0 && t !== '—' }));
}

function drawFirstPageHead(ctx, m) {
  text(ctx, m.orgName, X0, 15.38, { weight: 700, size: 9, color: C.em, track: 0.1 });
  text(ctx, m.dateText, X1, 15.38, { weight: 500, size: 8.5, color: C.muted, align: 'right' });
  hline(ctx, X0, X1, 19.265, 0.45, C.gold);
  text(ctx, m.title, X0, 31.35, { weight: 700, size: 26, family: SERIF_STACK, color: C.em });
  text(ctx, m.subtitle, X0, 38.24, { weight: 500, size: 9.5, color: C.muted });
  // Điều kiện vay (trái)
  const top = 43.37;
  text(ctx, 'ĐIỀU KIỆN VAY', X0, top + 2.81, { weight: 700, size: 7.5, color: C.goldDark, track: 0.12 });
  hline(ctx, X0, X0 + 142, top + 5.4 + 0.1, 0.2, C.secLine);
  m.params.forEach(([label, value], i) => {
    const t = top + 5.5 + 0.2 + i * 7.64;
    text(ctx, label, X0, t + 4.96, { weight: 500, size: 9, color: C.goldDark });
    text(ctx, value, X0 + 44, t + 4.96, { weight: 600, size: 9.5, color: C.ink, maxW: 142 - 44 });
    hline(ctx, X0, X0 + 142, t + 7.64 - 0.1, 0.2, C.paramLine);
  });
  // Bốn ô tổng (phải)
  const tw = 57.5, tx0 = X0 + 142 + 8;
  m.tiles.forEach((t, i) => {
    const x = tx0 + (i % 2) * (tw + 4), y = top + Math.floor(i / 2) * 26;
    rect(ctx, x, y, tw, 22, t.hi ? C.hi : C.cream);
    rect(ctx, x, y, tw, 0.7, t.hi ? C.em : C.gold);
    text(ctx, t.label.toUpperCase(), x + 4, y + 5.72, { weight: 700, size: 7, color: C.goldDark, track: 0.12 });
    text(ctx, t.value, x + 4, y + 13.18, { weight: 700, size: 16, family: SERIF_STACK, color: C.em, maxW: tw - 8 });
    text(ctx, t.sub, x + 4, y + 18.25, { weight: 500, size: 8, color: C.muted });
  });
}

/** Vẽ trang `plan.index` của bảng vào canvas (đã đặt kích thước theo DPI). */
export function drawPage(ctx, m, plan, pageCount) {
  ctx.fillStyle = C.white;
  ctx.fillRect(0, 0, px(PAGE.w), px(PAGE.h));
  let tableTop = TOP;
  if (plan.first) { drawFirstPageHead(ctx, m); tableTop = GEO.firstTableTop; }
  else text(ctx, `${m.orgName} · ${m.title} (tiếp theo)`, X0, 6.9, { weight: 600, size: 7, color: C.muted, track: 0.08 });
  drawTableHead(ctx, tableTop, m.head);
  let y = tableTop + GEO.headH;
  for (let i = plan.from; i < plan.to; i++) { drawRow(ctx, y, m.rows[i], i % 2 === 1); y += GEO.rowH; }
  if (plan.last) {
    const edges = colEdges();
    rect(ctx, X0, y, X1 - X0, GEO.totalH, C.total);
    hline(ctx, X0, X1, y + 0.2, 0.4, C.gold); hline(ctx, X0, X1, y + GEO.totalH - 0.2, 0.4, C.gold);
    const ty = y + GEO.totalH / 2 + 1.15, T = m.total;
    text(ctx, 'Cộng', cellX(edges, 0), ty, { weight: 700, size: 9, color: C.em });
    [[2, T.days], [4, T.principal], [5, T.interest], [6, T.payment]].forEach(([i, t]) => text(ctx, t, cellX(edges, i), ty, { weight: 700, size: 9, color: C.em, align: ALIGN[i], tnum: true }));
    text(ctx, m.note, X0, y + GEO.totalH + GEO.noteGap + 3, { weight: 500, size: 8, color: C.muted, italic: true });
  }
  text(ctx, m.dateText, X0, 203.96, { weight: 500, size: 7.5, color: C.muted });
  text(ctx, `Trang ${plan.index + 1} / ${pageCount}`, X1, 203.96, { weight: 500, size: 7.5, color: C.muted, align: 'right' });
}

async function canvasToJpeg(canvas) {
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Không tạo được ảnh trang'))), 'image/jpeg', 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Chờ kiểu chữ của app sẵn sàng trước khi vẽ (canvas không tự chờ như trang HTML). */
async function ensureFonts() {
  if (!document.fonts || !document.fonts.load) return;
  await Promise.all(['500 20px Inter', '600 20px Inter', '700 20px Inter', 'italic 500 20px Inter', '700 20px "Source Serif 4"'].map((f) => document.fonts.load(f, 'Aàâăđêôơư 0123456789').catch(() => null)));
}

/** Tạo file PDF (Uint8Array) từ dữ liệu giống bản in. */
export async function buildLoanCalcPdf(data) {
  await ensureFonts();
  const m = printModel(data);
  const plans = planPages(m.rows.length);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(px(PAGE.w)); canvas.height = Math.round(px(PAGE.h));
  const ctx = canvas.getContext('2d');
  const pages = [];
  for (const plan of plans) {
    drawPage(ctx, m, plan, plans.length);
    pages.push({ jpeg: await canvasToJpeg(canvas), width: canvas.width, height: canvas.height });
  }
  return buildPdf(pages, { title: 'Bảng tính lãi vay' });
}

export const PDF_MIME = 'application/pdf';

/**
 * Gửi tệp qua bảng chia sẻ của điện thoại/máy tính (Zalo, Messenger, thư...). Trả về:
 * 'shared' đã gửi · 'cancelled' người dùng đóng bảng chia sẻ · 'download' máy không hỗ trợ chia sẻ tệp nên đã tải về ·
 * 'need-tap' trình duyệt đòi bấm lại (quá lâu sau lần bấm nút) — tệp đã sẵn sàng, bấm Chia sẻ lần nữa là gửi ngay.
 */
export async function shareOrDownload(bytes, fileName, title) {
  const file = new File([bytes], fileName, { type: PDF_MIME });
  if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      if (e && e.name === 'NotAllowedError') return 'need-tap';
    }
  }
  downloadBlob(bytes, fileName, PDF_MIME);
  return 'download';
}

export { loanCalcFileName };
