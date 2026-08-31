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
 * Biểu đồ GỘP theo tháng — dư nợ (vùng/đường, làn trên) + lãi phải thu (cột,
 * làn dưới) trong CÙNG 1 khối, chia sẻ 1 trục ngang (tháng) nhưng MỖI chuỗi
 * tự co giãn theo đúng thang riêng của nó (không dùng chung 1 trục tung —
 * dư nợ và lãi phải thu chênh lệch quá lớn, dùng chung trục sẽ làm cột lãi
 * biến mất). Không in số lên biểu đồ (tổng dư nợ/lãi phải thu hiện tại đã
 * có sẵn ở 3 ô số liệu phía trên rồi, không lặp lại) — chỉ vẽ HÌNH DẠNG xu
 * hướng cho dễ nhìn, xem số chi tiết từng tháng bằng cách di/giữ vào đúng
 * điểm đó (title có sẵn của trình duyệt). Tháng hiện tại (chưa chốt chính
 * thức, tự tính theo ngày) tô nhạt hơn + nét đứt để phân biệt trực quan với
 * các tháng đã chốt, không cần chú thích chữ.
 */
export function monthlyComboChartSvg({ months, aspect = 1.85, balanceColor = 'var(--color-primary)', interestColor = 'var(--purple)' }) {
  if (!months.length) {
    return `<div class="text-sm text-muted" style="text-align:center;padding:24px 0">Chưa có số liệu.</div>`;
  }
  const vbH = Math.round(VB_W / aspect);
  const padBottom = 20; // nhãn tháng
  const chartH = vbH - padBottom;
  const areaH = chartH * 0.6;
  const barsH = chartH * 0.34;
  const barsBase = chartH; // đáy cột lãi phải thu = đáy toàn khối
  const barsTop = chartH - barsH;

  const n = months.length;
  const stepX = n > 1 ? VB_W / (n - 1) : 0;
  const xs = months.map((m, i) => (n > 1 ? i * stepX : VB_W / 2));
  const liveIdx = months[n - 1].live ? n - 1 : -1;

  const balMax = Math.max(1, ...months.map((m) => m.balance));
  const balMin = Math.min(0, ...months.map((m) => m.balance));
  const balRange = balMax - balMin || 1;
  const ys = months.map((m) => areaH - ((m.balance - balMin) / balRange) * areaH);

  const intMax = Math.max(1, ...months.map((m) => m.interest));

  const gradId = `mc-grad-${Math.random().toString(36).slice(2, 8)}`;
  const solidEnd = liveIdx >= 0 ? liveIdx : n - 1;
  const areaPath = xs.slice(0, solidEnd + 1).map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ')
    + ` L ${xs[solidEnd].toFixed(1)} ${areaH.toFixed(1)} L ${xs[0].toFixed(1)} ${areaH.toFixed(1)} Z`;
  const linePath = xs.slice(0, solidEnd + 1).map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');
  const dashSegment = liveIdx > 0 ? `M ${xs[liveIdx - 1].toFixed(1)} ${ys[liveIdx - 1].toFixed(1)} L ${xs[liveIdx].toFixed(1)} ${ys[liveIdx].toFixed(1)}` : '';

  const dots = months.map((m, i) => {
    const isLive = i === liveIdx;
    const title = `${m.label}: Dư nợ ${formatVND(m.balance)} · Lãi phải thu ${formatVND(m.interest)} · Nợ xấu ${m.badDebtRatio.toFixed(1).replace('.', ',')}%`;
    return isLive
      ? `<circle cx="${xs[i].toFixed(1)}" cy="${ys[i].toFixed(1)}" r="4.5" fill="var(--surface)" stroke="${balanceColor}" stroke-width="2.5"><title>${title}</title></circle>`
      : `<circle cx="${xs[i].toFixed(1)}" cy="${ys[i].toFixed(1)}" r="3.5" fill="${balanceColor}"><title>${title}</title></circle>`;
  }).join('');

  const barW = (n > 1 ? stepX : VB_W) * 0.42;
  const bars = months.map((m, i) => {
    const h = Math.max(2, (m.interest / intMax) * barsH);
    const y = barsBase - h;
    const isLive = i === liveIdx;
    const title = `${m.label}: Lãi phải thu ${formatVND(m.interest)}`;
    return `<rect x="${(xs[i] - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2.5" fill="${interestColor}" fill-opacity="${isLive ? 0.45 : 1}" ${isLive ? `stroke="${interestColor}" stroke-width="1" stroke-dasharray="3 2"` : ''}><title>${title}</title></rect>`;
  }).join('');

  const showLabelEvery = n > 8 ? Math.ceil(n / 6) : 1;
  const xLabels = months.map((m, i) => (i % showLabelEvery === 0 || i === n - 1)
    ? `<text x="${xs[i].toFixed(1)}" y="${vbH - 4}" text-anchor="middle" font-size="10.5" fill="${i === liveIdx ? balanceColor : 'var(--text-faint)'}" font-weight="${i === liveIdx ? '700' : '400'}">${m.label}</text>`
    : '').join('');

  return `
    <div class="flex items-center" style="gap:14px;margin-bottom:4px;font-size:11px;color:var(--text-muted)">
      <span class="flex items-center" style="gap:5px"><span style="width:9px;height:9px;border-radius:50%;background:${balanceColor};display:inline-block"></span>Dư nợ</span>
      <span class="flex items-center" style="gap:5px"><span style="width:9px;height:9px;border-radius:2px;background:${interestColor};display:inline-block"></span>Lãi phải thu</span>
    </div>
    <svg viewBox="0 0 ${VB_W} ${vbH}" style="width:100%;height:auto;display:block;overflow:visible">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${balanceColor}" stop-opacity="0.22"></stop>
          <stop offset="100%" stop-color="${balanceColor}" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <line x1="0" y1="${barsTop.toFixed(1)}" x2="${VB_W}" y2="${barsTop.toFixed(1)}" stroke="var(--border)" stroke-width="1"></line>
      <line x1="0" y1="${chartH - 0.5}" x2="${VB_W}" y2="${chartH - 0.5}" stroke="var(--border)" stroke-width="1"></line>
      <path d="${areaPath}" fill="url(#${gradId})" stroke="none"></path>
      ${linePath ? `<path d="${linePath}" fill="none" stroke="${balanceColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>` : ''}
      ${dashSegment ? `<path d="${dashSegment}" fill="none" stroke="${balanceColor}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="6 5"></path>` : ''}
      ${dots}
      ${bars}
      ${xLabels}
    </svg>`;
}
