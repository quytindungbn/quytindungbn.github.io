import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { openModal } from '../../components/modal.js';
import { emptyState, statusBadge, installmentHintHtml } from '../../components/ui.js';
import { formatVND, formatNumber, formatDateTime, initials, colorFor } from '../../utils.js';
import { openContractView } from './customers.js';

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Tổng quan quản trị' });
}

export function render(contentEl) {
  const session = S.getSession();
  const admin = S.getAdmin(session.id);
  const isStaff = admin.role === 'staff';
  const customers = S.listCustomers({ adminId: isStaff ? admin.id : undefined });
  const customerIds = new Set(customers.map((c) => c.id));
  const contracts = S.getState().contracts.filter((c) => !isStaff || customerIds.has(c.customerId));
  // "Yêu cầu mới nhất" chỉ để nhắc việc CẦN LÀM — yêu cầu đã chuyển "Đã liên
  // hệ" (xử lý xong) tự ẩn khỏi đây, xem đầy đủ (kể cả đã xử lý) ở trang
  // "Hỗ trợ" (tab "Tư vấn") qua nút "Xem tất cả".
  const requests = S.listRequests({}).filter((r) => (!isStaff || customerIds.has(r.customerId)) && r.status !== 'da_lien_he');
  // "Tổng khách hàng" chỉ tính khách còn dư nợ > 0 — khớp đúng với số khách
  // hàng thực sự hiện ra ở trang Khách hàng & Hợp đồng (trang đó cũng ẩn
  // khách hết dư nợ), để 2 nơi luôn đồng bộ với nhau.
  const balanceByCustomer = new Map();
  for (const ct of contracts) balanceByCustomer.set(ct.customerId, (balanceByCustomer.get(ct.customerId) || 0) + (ct.balance || 0));
  const activeCustomerCount = customers.filter((c) => (balanceByCustomer.get(c.id) || 0) > 0).length;
  const totalOutstanding = contracts.filter((c) => S.effectiveContractStatus(c) !== 'da_tat_toan').reduce((s, c) => s + c.balance, 0);
  // Xét CẢ ngày đáo hạn hợp đồng gốc LẪN "Kỳ tới" của phân kỳ trả nợ (nếu
  // có) — xem S.contractAttentionInfo() — để hợp đồng có 1 kỳ giữa chừng
  // (chưa tới ngày đáo hạn cuối) đến/quá hạn cũng được tính vào đây, y hệt
  // trang "Khách hàng & Hợp đồng". Tính 1 lần, dùng lại cho cả tile lẫn
  // popup danh sách bên dưới, khỏi tính lại nhiều lần.
  const attention = contracts.map((c) => ({ c, info: S.contractAttentionInfo(c) }));
  const overdue = attention.filter((x) => x.info.level === 'qua_han').map((x) => x.c);
  // Ô thống kê + tổng tiền "Gần đến hạn" GIỮ NGUYÊN đúng trong NEAR_DUE_DAYS
  // (15 ngày chính thức) như cũ, không đổi — không phải ngưỡng RỘNG 45 ngày.
  const nearDue = attention.filter((x) => x.info.level === 'gan_den_han' && x.info.days <= S.NEAR_DUE_DAYS).map((x) => x.c);
  // Tổng cộng CỦA NHÓM = cộng ĐÚNG số tiền của KỲ đến hạn (info.dueAmount)
  // khi cảnh báo đến từ 1 kỳ cụ thể, không phải toàn bộ dư nợ hợp đồng — xem
  // S.contractAttentionInfo().
  const overdueTotal = attention.filter((x) => x.info.level === 'qua_han').reduce((s, x) => s + x.info.dueAmount, 0);
  const nearDueTotal = attention.filter((x) => x.info.level === 'gan_den_han' && x.info.days <= S.NEAR_DUE_DAYS).reduce((s, x) => s + x.info.dueAmount, 0);
  // Danh sách hiện trong popup khi bấm vào ô "Gần đến hạn" — KHÁC với nearDue
  // ở trên (ô thống kê + tổng tiền trên Tổng quan giữ nguyên đúng trong
  // NEAR_DUE_DAYS ngày như cũ, không đổi): popup này liệt kê TIẾP cả những
  // hợp đồng còn xa hơn nữa (16, 17, 18 ngày...) — kể cả xa hơn do KỲ TỚI của
  // phân kỳ trả nợ, không chỉ ngày đáo hạn hợp đồng gốc — sắp xếp gần nhất
  // trước, để xem trước được lịch sắp tới — chỉ hợp đồng trong đúng
  // NEAR_DUE_DAYS ngày mới tô khung vàng cảnh báo như cũ (xem
  // highlightWithinDays ở openContractListModal), phần còn lại hiện chữ nhỏ
  // bình thường. contractAttentionInfo() đã tự giới hạn tối đa
  // S.WIDE_NEAR_DUE_DAYS (45 ngày) — xa hơn nữa chưa cần xem trước, tránh
  // danh sách dài vô ích.
  const upcoming = attention
    .filter((x) => x.info.level === 'gan_den_han')
    .sort((a, b) => a.info.days - b.info.days)
    .map((x) => x.c);

  contentEl.innerHTML = `
    <div class="grid-4 mb-16">
      <div class="stat-tile c-blue"><div class="stat-label">Tổng khách hàng</div><div class="stat-value">${formatNumber(activeCustomerCount)}</div></div>
      <div class="stat-tile c-green"><div class="stat-label">Tổng dư nợ</div><div class="stat-value" style="font-size:15px">${formatVND(totalOutstanding)}</div></div>
      <div class="stat-tile c-pink" id="tile-overdue" style="cursor:pointer">
        <div class="stat-label">Hợp đồng quá hạn</div>
        <div class="stat-value">${formatNumber(overdue.length)}</div>
        <div class="stat-trend" style="color:var(--danger)">Tổng cộng: ${formatVND(overdueTotal)}</div>
      </div>
      <div class="stat-tile c-orange" id="tile-neardue" style="cursor:pointer">
        <div class="stat-label">Gần đến hạn</div>
        <div class="stat-value">${formatNumber(nearDue.length)}</div>
        <div class="stat-trend" style="color:var(--warning)">Tổng cộng: ${formatVND(nearDueTotal)}</div>
      </div>
    </div>

    <div class="card card-pad">
      <div class="section-head"><h2>Yêu cầu mới nhất</h2><a href="#/admin/ho-tro?tab=requests" class="link-more">Xem tất cả</a></div>
      ${requests.length ? requests.slice(0, 5).map((r) => {
        const cust = S.getCustomer(r.customerId);
        const typeLabel = S.REQUEST_TYPE.find((t) => t.id === r.type)?.label || '';
        return `
        <div class="list-row" style="padding:8px 0">
          <div class="row-thumb" style="background:${colorFor(r.customerId)}">${initials(cust ? cust.name : '?')}</div>
          <div class="row-main">
            <div class="row-title" style="font-size:13.5px">${cust ? cust.name : '—'}</div>
            <div class="row-sub">${typeLabel} · ${formatDateTime(r.createdAt)}</div>
          </div>
          <div class="row-end">${statusBadge(S.REQUEST_STATUS_MAP[r.status])}</div>
        </div>`;
      }).join('') : `<p class="text-sm text-muted">Chưa có yêu cầu nào.</p>`}
    </div>
  `;

  // Bấm thẳng vào ô "Hợp đồng quá hạn"/"Gần đến hạn" ở trên là ra đúng danh
  // sách chi tiết của nhóm đó (giống hệt "Xem tất cả" trước đây) — gộp
  // thông tin số lượng + tổng tiền + danh sách vào chung 1 chỗ cho gọn,
  // không cần 2 bảng riêng bên dưới nữa.
  contentEl.querySelector('#tile-overdue').addEventListener('click', () => openContractListModal('Hợp đồng quá hạn', overdue, isStaff, 'var(--danger)'));
  contentEl.querySelector('#tile-neardue').addEventListener('click', () => openContractListModal('Gần đến hạn', upcoming, isStaff, 'var(--warning)', { highlightWithinDays: S.NEAR_DUE_DAYS }));
}

/**
 * Danh sách gọn chỉ gồm các hợp đồng thuộc đúng nhóm (quá hạn / gần đến hạn)
 * — bấm vào 1 dòng để mở thẳng chi tiết hợp đồng. Bên phải hiện thẳng số
 * tiền (tô màu theo nhóm) thay vì nhãn trạng thái, kèm tổng cộng cả nhóm ở
 * đầu danh sách để dễ theo dõi. Số tiền = ĐÚNG số tiền của KỲ đến hạn (nếu
 * cảnh báo đến từ 1 kỳ cụ thể trong phân kỳ trả nợ), KHÔNG phải toàn bộ dư
 * nợ hợp đồng — xem S.contractAttentionInfo().dueAmount.
 *
 * `opts.highlightWithinDays` (tùy chọn, chỉ dùng cho danh sách "Gần đến
 * hạn"): nếu có, CHỈ những hợp đồng còn trong đúng số ngày này mới tô khung
 * vàng cảnh báo như cũ — hợp đồng còn xa hơn (vẫn hiện tiếp trong cùng danh
 * sách để xem trước lịch sắp tới) chỉ hiện chữ nhỏ bình thường, không khung.
 * Không truyền (mặc định, dùng cho "Hợp đồng quá hạn") thì LUÔN tô khung như
 * trước giờ, không đổi gì.
 */
function openContractListModal(title, contracts, isStaff, colorVar, opts = {}) {
  const { highlightWithinDays } = opts;
  // Tổng cộng = cộng ĐÚNG số tiền của KỲ đến hạn (S.contractAttentionInfo().dueAmount)
  // khi cảnh báo đến từ 1 kỳ cụ thể, không phải toàn bộ dư nợ hợp đồng.
  const total = contracts.reduce((s, ct) => s + S.contractAttentionInfo(ct).dueAmount, 0);
  openModal({
    title: `${title} (${contracts.length})`,
    bodyHtml: `
      <div class="text-sm text-muted mb-12">Tổng cộng: <b style="color:${colorVar}">${formatVND(total)}</b></div>
      ${contracts.length ? contracts.map((ct) => {
        const cust = S.getCustomer(ct.customerId);
        // Xét CẢ ngày đáo hạn hợp đồng gốc LẪN "Kỳ tới" của phân kỳ trả nợ
        // (nếu có) — xem S.contractAttentionInfo() — cùng cách hiện "Quá
        // hạn/Gần đến hạn X ngày" và địa chỉ (Xóm, Thôn, Tỉnh) như ở mục
        // Khách hàng & Hợp đồng, để 2 nơi nhất quán với nhau.
        const info = S.contractAttentionInfo(ct);
        const dueLabel = info.level === 'qua_han' ? `Quá hạn ${info.days} ngày` : `Gần đến hạn ${info.days} ngày`;
        const dueBadgeClass = info.level === 'qua_han' ? 'badge-red' : 'badge-yellow';
        const highlight = highlightWithinDays == null || info.days <= highlightWithinDays;
        const addressLabel = cust ? ([cust.xom, cust.thon, cust.tinh].filter(Boolean).join(', ') || cust.address || 'Chưa có địa bàn') : '—';
        return `
        <div class="list-row" data-view-ct="${ct.id}" style="cursor:pointer;flex-direction:column;align-items:stretch;gap:2px">
          <div class="flex items-center gap-6" style="flex-wrap:nowrap">
            <span style="font-size:14px;font-weight:700;line-height:1.8;padding-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">${cust ? cust.name : '—'}</span>
            ${highlight
              ? `<span class="badge ${dueBadgeClass}" style="flex-shrink:0">${dueLabel}</span>`
              : `<span class="text-sm text-muted" style="flex-shrink:0">${dueLabel}</span>`}
          </div>
          <div class="flex justify-between items-center gap-6" style="flex-wrap:nowrap">
            <span class="row-sub" style="margin-top:0;flex:1;min-width:0">${addressLabel}</span>
            <b style="color:${colorVar};font-size:13px;flex-shrink:0">${formatVND(info.dueAmount)}</b>
          </div>
          ${installmentHintHtml(ct)}
        </div>`;
      }).join('') : emptyState({ iconName: 'checkCircle', title: 'Không có hợp đồng nào', message: 'Danh sách hiện đang trống.' })}
    `,
    onMount(sheet) {
      // Mở chi tiết hợp đồng CHỒNG lên trên (không đóng danh sách này trước)
      // — đóng chi tiết hợp đồng lại là quay về đúng danh sách đang xem, đỡ
      // phải mở lại "Xem tất cả" từ đầu mỗi lần muốn xem hợp đồng khác.
      sheet.querySelectorAll('[data-view-ct]').forEach((row) => {
        row.addEventListener('click', () => {
          const ct = S.getContract(row.dataset.viewCt);
          openContractView(ct.customerId, ct, { readOnly: isStaff });
        });
      });
    },
  });
}
