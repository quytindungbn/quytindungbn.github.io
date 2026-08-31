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

/** Quy đổi ra tỷ đồng, CHỈ số (không kèm chữ đơn vị) — dùng khi đơn vị đã ghi sẵn 1 lần ở đầu biểu đồ, ghi lặp lại "tỷ" sau từng số sẽ rối mắt. */
export function formatTyDong(n) {
  return (Math.round((n || 0) / 1e7) / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

/**
 * Biểu đồ cột đứng (dư nợ theo TỪNG NHÓM NỢ) — mỗi cột 1 màu riêng (đã truyền
 * sẵn từ nơi gọi, theo đúng "màu trạng thái": xanh (tốt) -> vàng (cần chú ý)
 * -> các sắc đỏ đậm dần (nợ xấu, càng đậm càng nghiêm trọng) — LUÔN có CHỮ
 * (nhãn nhóm + số tiền) đi kèm màu, không chỉ dựa vào màu để phân biệt. Mỗi
 * cột có thể bấm vào (nếu items có `id`) — nơi gọi tự bind click theo
 * `data-id` để mở danh sách hợp đồng đúng nhóm đó. Nhãn dưới mỗi cột dùng
 * `shortLabel` nếu có (gọn hơn `label` — `label` đầy đủ vẫn dùng cho tooltip
 * chạm/hover), cho khoảng cách các cột đều và dễ nhìn hơn trên màn hình nhỏ.
 */
export function barChartSvg({ items, aspect = 2.1 }) {
  const vbH = Math.round(VB_W / aspect);
  const chartH = vbH - 34; // chừa chỗ cho nhãn số tiền phía trên mỗi cột
  const max = Math.max(1, ...items.map((it) => it.value));
  const barW = VB_W / items.length;
  const gap = barW * 0.14;
  const barsHtml = items.map((it, i) => {
    // Chừa TRẦN 15% phía trên cột cao nhất — nếu không, cột giá trị lớn
    // nhất cao kín hết chartH (chạm y=0) thì nhãn số tiền của NÓ bị đẩy vào
    // NẰM ĐÈ lên chính cột đó, cùng màu nên chữ biến mất (không đọc được).
    const h = Math.max(3, (it.value / max) * chartH * 0.85);
    const x = i * barW + gap / 2;
    const w = barW - gap;
    const y = chartH - h;
    const idAttr = it.id != null ? ` data-id="${it.id}" style="cursor:pointer"` : '';
    return `
      <g${idAttr}>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="5" fill="${it.color}"></rect>
        <text x="${(x + w / 2).toFixed(1)}" y="${Math.max(13, y - 8).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="${it.value > 0 ? it.color : 'var(--text-faint)'}">${formatCompact(it.value)}</text>
        <title>${it.label}: ${formatVND(it.value)}</title>
      </g>`;
  }).join('');
  const labels = items.map((it) => `<div${it.id != null ? ` data-id="${it.id}"` : ''} style="flex:1;text-align:center;font-size:11px;color:var(--text-muted)${it.id != null ? ';cursor:pointer' : ''}">${it.shortLabel ?? it.label}</div>`).join('');
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
 * Biểu đồ cột GỘP theo tháng — MỖI tháng 1 cặp cột LIỀN NHAU, bắt đầu từ mép
 * TRÁI của ô tháng đó (không căn giữa): cột Dư nợ (to, bên trái) LỒNG sẵn 1
 * đoạn màu cam Ở ĐÁY ĐÈ LÊN (không phải đỉnh), thể hiện đúng phần Nợ xấu
 * trong đó (số tiền ghi NGAY BÊN TRONG cột, ở đầu đoạn cam), và cột Lãi phải
 * thu (nhỏ hơn, ngay bên phải) — CẢ 2 cột phụ (nợ xấu lồng trong + lãi phải
 * thu) co theo ĐÚNG tỷ lệ % so với chính cột Dư nợ của tháng đó, NHƯNG được
 * "khuếch đại" thêm hệ số BOOST + chiều cao tối thiểu để luôn nhìn rõ trên
 * màn hình nhỏ — tỷ lệ % CHÍNH XÁC vẫn ghi ngay DƯỚI số tiền (2 dòng riêng —
 * VD dòng 1 "2", dòng 2 "(4,5%)" — để gọn trong bề ngang hẹp của cột) nên
 * không gây hiểu nhầm dù cột được phóng to hơn thực tế.
 * Đơn vị TIỀN của cả biểu đồ là TỶ ĐỒNG, ghi 1 lần duy nhất ở đầu (không lặp
 * lại chữ "tỷ" sau từng số). Quá 7 tháng thì bề rộng mỗi ô tháng GIỮ NGUYÊN
 * (không co thêm) và cả khối biểu đồ cho VUỐT/CUỘN NGANG để xem tiếp tháng cũ
 * hơn, tránh cột co lại nhỏ xíu khó xem khi lịch sử dài dần theo thời gian.
 * Số liệu tự động lấy từ dữ liệu hợp đồng/số đã chốt hiện có, luôn cập nhật
 * lại mỗi lần trang vẽ lại. Tháng hiện tại (chưa chốt chính thức, tự tính
 * theo ngày) tô nhạt hơn + nét đứt để phân biệt trực quan với các tháng đã
 * chốt.
 *
 * Mỗi cặp cột gắn `data-month` (giá trị year_month) — nơi gọi tự bind click
 * để chọn xem tháng đó (cập nhật "Dư nợ theo nhóm nợ"/"Tổng hợp tăng giảm"
 * mà KHÔNG thu gọn biểu đồ này lại, vẫn luôn vẽ TOÀN BỘ lịch sử). Truyền
 * `selectedYm` (year_month đang chọn) để tô khung mờ + đậm nhãn tháng đó,
 * phân biệt với việc tô đậm nhãn THÁNG SỐNG (isLive) — 1 tháng có thể vừa là
 * tháng sống vừa là tháng đang chọn cùng lúc. Ngay dưới biểu đồ LUÔN có 1
 * dòng ghi ĐẦY ĐỦ số tiền (đến đơn vị đồng, không rút gọn tỷ đồng như trên
 * cột) của ĐÚNG tháng đang chọn — đặt ngoài SVG (chữ HTML thường) vì số đầy
 * đủ quá dài, ghi thẳng lên cột hẹp sẽ đè sang cột tháng bên cạnh.
 */
export function monthlyComboChartSvg({ months, aspect = 1.5, balanceColor = 'var(--color-primary)', badDebtColor = 'var(--warning)', interestColor = 'var(--purple)', selectedYm = null }) {
  if (!months.length) {
    return `<div class="text-sm text-muted" style="text-align:center;padding:24px 0">Chưa có số liệu.</div>`;
  }
  const vbH = Math.round(VB_W / aspect);
  const padTop = 16; // nhãn số tiền dư nợ phía trên cột (nhãn nợ xấu nằm LỒNG trong cột, không cần chừa riêng)
  const padBottom = 20; // nhãn tháng
  const chartH = vbH - padTop - padBottom;
  const baseY = padTop + chartH;

  const n = months.length;
  // Mỗi ô tháng cần tối thiểu ~54 đơn vị ngang mới đủ chỗ vẽ rõ cặp cột +
  // nhãn — dồn QUÁ NHIỀU tháng vào bề ngang cố định (VB_W) sẽ ép cột co lại
  // nhỏ xíu, khó xem. Quá 7 tháng (ước lượng vừa đúng 1 màn hình điện thoại ở
  // bề rộng chuẩn) thì GIỮ NGUYÊN bề rộng mỗi ô — không co thêm nữa — và cho
  // CUỘN NGANG để xem tiếp các tháng cũ hơn (bọc trong div overflow-x:auto ở
  // nơi gọi), thay vì ép co hết vào 1 màn hình.
  const SLOT_PX = 54;
  const scroll = n > 7;
  const chartW = scroll ? n * SLOT_PX : VB_W;
  // Chỉ có 1 tháng (mới bắt đầu dùng tính năng) thì KHÔNG lấy nguyên chartW
  // làm bề rộng 1 ô tháng (ra 1 cặp cột khổng lồ) — dùng tạm bề rộng như thể
  // đang có 8 tháng, cho tới khi có thêm tháng thứ 2 trở lên.
  const slotW = scroll ? SLOT_PX : (n > 1 ? chartW / n : chartW / 8);
  const slotGap = slotW * 0.12;
  const innerW = slotW - slotGap;
  const balW = innerW * 0.6;
  const intW = innerW * 0.28;

  const balMax = Math.max(1, ...months.map((m) => m.balance));
  const liveIdx = months[n - 1].live ? n - 1 : -1;

  const bars = months.map((m, i) => {
    const slotX = i * slotW + slotGap / 2;
    const isLive = i === liveIdx;
    const isSelected = selectedYm != null && m.yearMonth === selectedYm;
    const dash = isLive ? `stroke-dasharray="3 2"` : '';

    const balH = Math.max(3, (m.balance / balMax) * chartH);
    const balY = baseY - balH;
    // Nợ xấu + lãi phải thu co theo ĐÚNG tỷ lệ % của CHÍNH cột dư nợ tháng đó
    // (KHÔNG dùng thang riêng theo lịch sử) — nhưng khuếch đại thêm hệ số
    // BOOST + chiều cao tối thiểu để luôn nhìn rõ trên điện thoại (tỷ lệ %
    // thật thường rất nhỏ, co đúng tỷ lệ sẽ gần như biến mất) — tỷ lệ % chính
    // xác vẫn ghi rõ bằng số ngay trong nhãn nên không gây hiểu nhầm.
    const BOOST = 7.5;
    const badRatio = m.balance > 0 ? Math.min(1, m.badDebt / m.balance) : 0;
    const interestRatio = m.balance > 0 ? (m.interest / m.balance) * 100 : 0;
    const badH = badRatio > 0 ? Math.min(balH * 0.7, Math.max(24, badRatio * balH * BOOST)) : 0;
    const badY = baseY - badH; // ĐÁY cột (không phải đỉnh) — đè lên phần dưới của cột dư nợ.
    const intH = balH > 0 ? Math.min(balH * 0.65, Math.max(22, (m.interest / m.balance) * balH * BOOST)) : 22;
    const intY = baseY - intH;
    const intX = slotX + balW + innerW * 0.12;
    // Tháng "sống" (chưa chốt) vẫn tô ĐẬM gần như màu thật (0.85, không phải
    // nửa trong suốt) — chỉ dựa vào NÉT ĐỨT để phân biệt, không làm nhạt màu
    // đến mức trông như bị phủ 1 lớp trắng mờ (đặc biệt rõ với cột Dư nợ khi
    // đây luôn là cột duy nhất có dữ liệu lúc quỹ mới bắt đầu dùng tính năng).
    const liveOpacity = isLive ? 0.85 : 1;

    return `
      <g data-month="${m.yearMonth}" style="cursor:pointer">
        ${isSelected ? `<rect x="${(slotX - slotGap / 2).toFixed(1)}" y="${(padTop - 6).toFixed(1)}" width="${slotW.toFixed(1)}" height="${(chartH + 12).toFixed(1)}" rx="6" fill="${balanceColor}" fill-opacity="0.08"></rect>` : ''}
        <rect x="${slotX.toFixed(1)}" y="${balY.toFixed(1)}" width="${balW.toFixed(1)}" height="${balH.toFixed(1)}" rx="4" fill="${balanceColor}" fill-opacity="${liveOpacity}" ${isLive ? `stroke="${balanceColor}" stroke-width="1" ${dash}` : ''}><title>${m.label}: Dư nợ ${formatVND(m.balance)}</title></rect>
        ${badH > 0 ? `<rect x="${slotX.toFixed(1)}" y="${badY.toFixed(1)}" width="${balW.toFixed(1)}" height="${badH.toFixed(1)}" rx="4" fill="${badDebtColor}" fill-opacity="${liveOpacity}"><title>${m.label}: Nợ xấu ${formatVND(m.badDebt)} (${m.badDebtRatio.toFixed(1).replace('.', ',')}%)</title></rect>
        <text x="${(slotX + balW / 2).toFixed(1)}" y="${(badY + 9).toFixed(1)}" text-anchor="middle" font-size="7.5" font-weight="700" fill="#fff">${formatTyDong(m.badDebt)}</text>
        <text x="${(slotX + balW / 2).toFixed(1)}" y="${(badY + 17).toFixed(1)}" text-anchor="middle" font-size="6.5" font-weight="700" fill="#fff">(${m.badDebtRatio.toFixed(1).replace('.', ',')}%)</text>` : ''}
        <text x="${(slotX + balW / 2).toFixed(1)}" y="${(balY - 4).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${balanceColor}">${formatTyDong(m.balance)}</text>

        <rect x="${intX.toFixed(1)}" y="${intY.toFixed(1)}" width="${intW.toFixed(1)}" height="${intH.toFixed(1)}" rx="3" fill="${interestColor}" fill-opacity="${liveOpacity}" ${isLive ? `stroke="${interestColor}" stroke-width="1" ${dash}` : ''}><title>${m.label}: Lãi phải thu ${formatVND(m.interest)}</title></rect>
        <text x="${(intX + intW / 2).toFixed(1)}" y="${(intY - 13).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="${interestColor}">${formatTyDong(m.interest)}</text>
        <text x="${(intX + intW / 2).toFixed(1)}" y="${(intY - 4).toFixed(1)}" text-anchor="middle" font-size="6.5" font-weight="700" fill="${interestColor}">(${interestRatio.toFixed(1).replace('.', ',')}%)</text>

        <text x="${(slotX + innerW / 2).toFixed(1)}" y="${vbH - 5}" text-anchor="middle" font-size="10" font-weight="${isLive || isSelected ? 700 : 400}" fill="${isLive || isSelected ? balanceColor : 'var(--text-faint)'}">${m.label}</text>
      </g>`;
  }).join('');

  const svgHtml = `
    <svg viewBox="0 0 ${chartW} ${vbH}" style="${scroll ? `width:${chartW}px;flex-shrink:0` : 'width:100%'};height:auto;display:block;overflow:visible">
      <line x1="0" y1="${(baseY - 0.5).toFixed(1)}" x2="${chartW}" y2="${(baseY - 0.5).toFixed(1)}" stroke="var(--border)" stroke-width="1"></line>
      ${bars}
    </svg>`;

  return `
    <div style="font-size:10.5px;color:var(--text-muted);margin-bottom:4px">Đơn vị trên biểu đồ: tỷ đồng${scroll ? ' — vuốt ngang để xem thêm tháng cũ hơn' : ''}</div>
    <div class="flex items-center" style="gap:14px;margin-bottom:6px;font-size:11px;color:var(--text-muted);flex-wrap:wrap">
      <span class="flex items-center" style="gap:5px"><span style="width:9px;height:9px;border-radius:2px;background:${balanceColor};display:inline-block"></span>Dư nợ</span>
      <span class="flex items-center" style="gap:5px"><span style="width:9px;height:9px;border-radius:2px;background:${badDebtColor};display:inline-block"></span>Nợ xấu</span>
      <span class="flex items-center" style="gap:5px"><span style="width:9px;height:9px;border-radius:2px;background:${interestColor};display:inline-block"></span>Lãi phải thu</span>
    </div>
    ${scroll ? `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">${svgHtml}</div>` : svgHtml}`;
}
