// Biểu đồ tự vẽ bằng SVG thuần (không dùng thư viện ngoài — tránh thêm 1
// lượt tải mạng nữa, đúng tinh thần "không phụ thuộc gì thêm" của cả app,
// xem mục 10.45 docs/supabase-migration.md vừa sửa app mở chậm). Dùng cho
// dashboard "Tổng quan" (chỉ quản trị viên toàn quyền xem — overview.js).
//
// CẢ 2 biểu đồ bên dưới đều dùng viewBox có ĐƠN VỊ THỐNG NHẤT (không trộn
// px với %) và scale ĐỀU theo tỷ lệ gốc (KHÔNG dùng preserveAspectRatio=
// "none") — tránh chữ/chấm tròn bị kéo méo ngang/dọc khi khung chứa co giãn
// (lỗi rất dễ gặp nếu trộn "%" với viewBox hoặc ép co giãn không đều).
import { formatVND, formatCompact } from '../utils.js';

const VB_W = 400; // "px logic" chiều ngang — chỉ là đơn vị nội bộ của viewBox, KHÔNG phải px thật (SVG tự co giãn đều theo khung chứa thật).

/**
 * Biểu đồ cột đứng (dư nợ theo TỪNG NHÓM NỢ) — mỗi cột 1 màu riêng (đã truyền
 * sẵn từ nơi gọi, theo đúng "màu trạng thái": xanh (tốt) -> vàng (cần chú ý)
 * -> các sắc đỏ đậm dần (nợ xấu, càng đậm càng nghiêm trọng) — LUÔN có CHỮ
 * (nhãn nhóm + số tiền) đi kèm màu, không chỉ dựa vào màu để phân biệt.
 */
export function barChartSvg({ items, aspect = 2.1 }) {
  const vbH = Math.round(VB_W / aspect);
  const chartH = vbH - 34; // chừa chỗ cho nhãn số tiền phía trên mỗi cột
  const max = Math.max(1, ...items.map((it) => it.value));
  const barW = VB_W / items.length;
  const gap = barW * 0.14;
  const barsHtml = items.map((it, i) => {
    const h = Math.max(3, (it.value / max) * chartH);
    const x = i * barW + gap / 2;
    const w = barW - gap;
    const y = chartH - h;
    return `
      <g>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="5" fill="${it.color}"></rect>
        <text x="${(x + w / 2).toFixed(1)}" y="${Math.max(13, y - 8).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="${it.value > 0 ? it.color : 'var(--text-faint)'}">${formatCompact(it.value)}</text>
        <title>${it.label}: ${formatVND(it.value)}</title>
      </g>`;
  }).join('');
  const labels = items.map((it) => `<div style="flex:1;text-align:center;font-size:11px;color:var(--text-muted)">${it.label}</div>`).join('');
  return `
    <div>
      <svg viewBox="0 0 ${VB_W} ${chartH}" style="width:100%;height:auto;display:block;overflow:visible">
        <line x1="0" y1="${chartH - 0.5}" x2="${VB_W}" y2="${chartH - 0.5}" stroke="var(--border)" stroke-width="1"></line>
        ${barsHtml}
      </svg>
      <div style="display:flex;margin-top:8px">${labels}</div>
    </div>`;
}

/**
 * Biểu đồ đường theo THỜI GIAN (1 chuỗi số liệu, VD: tổng dư nợ/lãi phải
 * thu/tỷ lệ nợ xấu theo từng tháng) — đường nét mảnh (2px) + vùng tô nhạt
 * bên dưới, chấm tròn từng điểm (di chuột vào xem đúng số tháng đó — dùng
 * <title> có sẵn của trình duyệt, không cần tự dựng tooltip), LUÔN ghi rõ
 * số ở điểm CUỐI (mới nhất — quan trọng nhất) ngay trên biểu đồ. Chỉ 1
 * chuỗi số liệu -> không cần chú giải (legend) riêng, tên biểu đồ đã đủ để
 * biết đây là số liệu gì.
 */
export function lineChartSvg({ points, aspect = 2.4, color = 'var(--color-primary)', formatValue = formatCompact, formatTooltip = formatVND }) {
  if (!points.length) {
    return `<div class="text-sm text-muted" style="text-align:center;padding:24px 0">Chưa có số liệu — xem ghi chú bên dưới.</div>`;
  }
  const vbH = Math.round(VB_W / aspect);
  const padTop = 34; // chừa chỗ nhãn điểm cuối
  const padBottom = 22; // chừa chỗ nhãn tháng
  const chartH = vbH - padTop - padBottom;
  const max = Math.max(...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const range = max - min || 1;
  const n = points.length;
  const stepX = n > 1 ? VB_W / (n - 1) : 0;
  const coords = points.map((p, i) => {
    const x = n > 1 ? i * stepX : VB_W / 2;
    const y = padTop + chartH - ((p.value - min) / range) * chartH;
    return { x, y, p };
  });
  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(padTop + chartH).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(padTop + chartH).toFixed(1)} Z`;
  const last = coords[coords.length - 1];
  // Thưa bớt nhãn tháng nếu quá nhiều điểm (>8) — chỉ hiện đầu/cuối/giữa, đỡ chữ đè lên nhau.
  const showLabelEvery = n > 8 ? Math.ceil(n / 6) : 1;
  const gradId = `lc-grad-${Math.random().toString(36).slice(2, 8)}`;
  const dots = coords.map((c) => `
    <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4" fill="${color}">
      <title>${c.p.label}: ${formatTooltip(c.p.value)}</title>
    </circle>`).join('');
  const xLabels = coords.map((c, i) => (i % showLabelEvery === 0 || i === n - 1) ? `<text x="${c.x.toFixed(1)}" y="${vbH - 5}" text-anchor="middle" font-size="10.5" fill="var(--text-faint)">${c.p.label}</text>` : '').join('');
  const lastAnchor = last.x > VB_W * 0.82 ? 'end' : last.x < VB_W * 0.18 ? 'start' : 'middle';
  return `
    <svg viewBox="0 0 ${VB_W} ${vbH}" style="width:100%;height:auto;display:block;overflow:visible">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.22"></stop>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <line x1="0" y1="${(padTop + chartH).toFixed(1)}" x2="${VB_W}" y2="${(padTop + chartH).toFixed(1)}" stroke="var(--border)" stroke-width="1"></line>
      <path d="${areaPath}" fill="url(#${gradId})" stroke="none"></path>
      <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
      ${dots}
      <text x="${last.x.toFixed(1)}" y="${Math.max(14, last.y - 12).toFixed(1)}" text-anchor="${lastAnchor}" font-size="14" font-weight="700" fill="${color}">${formatValue(last.p.value)}</text>
      ${xLabels}
    </svg>`;
}
