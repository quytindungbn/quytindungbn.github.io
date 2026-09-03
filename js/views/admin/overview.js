import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { emptyState, statusBadge, installmentHintHtml } from '../../components/ui.js';
import { formatVND, formatDate, formatNumber, formatDateTime, initials, colorFor } from '../../utils.js';
import { readExcelFirstSheet, rowsToTsv, remapReportTemplateRows } from '../../lib/excelLite.js';
import { barChartSvg, monthlyComboChartSvg } from '../../components/charts.js';
import { openContractView } from './customers.js';

/** "2026-08" -> "Th8/26" — nhãn gọn cho trục ngang biểu đồ theo tháng. */
function monthLabel(yearMonth) {
  const [y, m] = String(yearMonth).split('-');
  return `Th${Number(m)}/${y.slice(2)}`;
}
function formatPercent(n) {
  return `${n.toFixed(1).replace('.', ',')}%`;
}
/** Nhãn tháng (dạng chữ thường, không kèm thẻ HTML) kèm ghi chú "đang cập nhật" cho tháng sống — dùng thống nhất ở mọi chỗ hiện tên tháng ngoài bảng "Xem chi tiết" (nơi cần tô màu nhạt riêng cho ghi chú, xem monthDetailTableHtml/openMonthlyDetailModal). */
function monthLabelWithNote(m) {
  return m.live ? `${m.label} (đang cập nhật)` : m.label;
}

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Tổng quan quản trị' });
}

/** Vai trò của phiên admin đang đăng nhập — gọi lại MỖI LẦN cần (rẻ, không gọi mạng), tránh phải truyền isStaff/isSuper xuyên suốt nhiều lớp hàm. */
function currentRoles() {
  const session = S.getSession();
  const admin = S.getAdmin(session.id);
  return { isStaff: admin.role === 'staff', isSuper: S.isSuperAdmin(session.id) };
}

/** Hợp đồng ĐÚNG phạm vi được phép xem của phiên đang đăng nhập — super = toàn quỹ, staff = chỉ khách trong Thôn/Xóm được gán (khớp đúng cách "Tổng dư nợ"/4 ô thống kê chính đang lọc, dùng lại cho cả "Dư nợ theo nhóm nợ" + Dự phòng bên dưới để 2 nơi luôn đối chiếu khớp nhau). RLS ở Supabase đã tự chặn KHÔNG CHO staff tải về hợp đồng ngoài phạm vi ngay từ đầu — filter này chỉ để khớp đúng với cách "Tổng dư nợ" đang tính (qua listCustomers), không phải lớp bảo mật (lớp bảo mật thật là RLS phía server). */
function visibleContracts() {
  const { isStaff } = currentRoles();
  if (!isStaff) return S.getState().contracts;
  const session = S.getSession();
  const admin = S.getAdmin(session.id);
  const customerIds = new Set(S.listCustomers({ adminId: admin.id }).map((c) => c.id));
  return S.getState().contracts.filter((c) => customerIds.has(c.customerId));
}

export function render(contentEl) {
  const { isStaff } = currentRoles();
  const session = S.getSession();
  const admin = S.getAdmin(session.id);
  const customers = S.listCustomers({ adminId: isStaff ? admin.id : undefined });
  const customerIds = new Set(customers.map((c) => c.id));
  const contracts = visibleContracts();
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

    ${debtDashboardHtml()}

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

  // "Dư nợ theo nhóm nợ" + "Biến động hàng tháng" + "Tổng hợp tăng giảm" LUÔN
  // hiện cho MỌI vai trò (staff lẫn super) — bấm vào 1 cột/nhãn nhóm nợ để
  // xem danh sách hợp đồng đúng nhóm đó; bấm vào 1 cặp cột tháng ở biểu đồ
  // "Biến động hàng tháng" để CHUYỂN cả "Dư nợ theo nhóm nợ" lẫn "Tổng hợp
  // tăng giảm" sang đúng tháng đó (xem selectMonth()) — không tải lại trang.
  bindNhomNoClicks(contentEl);
  bindMonthClicks(contentEl);
  bindMonthSelector(contentEl);
  contentEl.querySelector('#btn-monthly-detail')?.addEventListener('click', openMonthlyDetailModal);
  contentEl.querySelector('#btn-import-historical')?.addEventListener('click', openImportHistoricalModal);
}

/** Gắn click cho mỗi cột/nhãn "Dư nợ theo nhóm nợ" (data-id = số nhóm, CHỈ có ở tháng đang sống — xem nhomNoBarHtml()) — mở danh sách hợp đồng ĐÚNG nhóm đó theo phân loại HIỆN TẠI. Gọi lại mỗi lần #nhom-no-slot được vẽ lại (render() đầu VÀ mỗi lần selectMonth() đổi tháng). */
function bindNhomNoClicks(root) {
  const slot = root.querySelector('#nhom-no-slot');
  if (!slot) return;
  const { isStaff, isSuper } = currentRoles();
  slot.querySelectorAll('[data-id]').forEach((el) => {
    el.addEventListener('click', () => openDebtGroupModal(Number(el.dataset.id), isStaff, isSuper));
  });
}

const GROUP_COLORS = { 1: 'var(--success)', 2: 'var(--warning)', 3: '#f0a29c', 4: 'var(--danger)', 5: '#8f231d' };

/** Biểu đồ cột "Dư nợ theo nhóm nợ" của ĐÚNG 1 tháng (m — có thể là tháng đang sống hoặc tháng đã chốt trong quá khứ, xem selectMonth()). CHỈ gắn `id` (bấm ra danh sách hợp đồng) khi là THÁNG SỐNG — tháng đã chốt trong quá khứ không còn lưu chi tiết từng hợp đồng để tra lại được, chỉ có tổng theo nhóm. */
function nhomNoBarHtml(m) {
  const gb = m.groupBalances || {};
  const barItems = [1, 2, 3, 4, 5].map((g) => ({
    ...(m.live ? { id: g } : {}),
    label: `Nhóm ${g}`, shortLabel: String(g), value: gb[g] || 0, color: GROUP_COLORS[g],
  }));
  return barChartSvg({ items: barItems });
}
/** 2 dòng "Dự phòng chung/cụ thể phải trích" — chỉ chữ, không bỏ trong khung — LUÔN tính "SỐNG" (ngay bây giờ, không đổi theo tháng đang xem) vì cần đúng trạng thái TSBĐ hiện tại của từng hợp đồng, không có cách nào biết TSBĐ "tại thời điểm 1 tháng trong quá khứ". */
function provisionRowsHtml(provision) {
  const row = 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid var(--border)';
  return `
    <div style="${row}"><span class="text-sm text-muted">Dự phòng chung phải trích</span><b style="font-size:13.5px">${formatVND(provision.generalProvision)}</b></div>
    <div style="${row}"><span class="text-sm text-muted">Dự phòng cụ thể phải trích</span><b style="font-size:13.5px">${formatVND(provision.specificProvision)}</b></div>`;
}
/** Vẽ lại 2 dòng Dự phòng ngay sau khi lưu TSBĐ trong modal (openDebtGroupModal) — KHÔNG đụng tới "Dư nợ theo nhóm nợ" (TSBĐ không đổi số dư từng nhóm, chỉ đổi số tiền phải trích) nên không cần vẽ lại biểu đồ, tránh làm mất tháng đang xem nếu đang xem 1 tháng quá khứ. */
function refreshProvisionSlot() {
  const provision = S.provisionSummary(visibleContracts(), new Date());
  const slot = document.getElementById('provision-slot');
  if (slot) slot.innerHTML = provisionRowsHtml(provision);
}

/**
 * Dashboard "Dư nợ theo nhóm nợ" + "Biến động hàng tháng" + "Tổng hợp tăng
 * giảm" — LUÔN hiện cho MỌI quản trị viên (staff lẫn super), dưới 4 ô thống
 * kê chính. "Dự phòng chung/cụ thể phải trích" (provisionRowsHtml() ở trên)
 * LUÔN tính "SỐNG" (không đổi theo tháng đang xem — xem ghi chú ở đó), tách
 * riêng khỏi phần chọn tháng dưới đây.
 *
 * "Lãi phải thu" CHỈ tính Nhóm 1 (từ Nhóm 2 trở lên coi như khó thu lãi
 * đúng hạn, không tính vào lãi phải thu nữa). "Nợ xấu" CHÍNH THỨC = Nhóm
 * 3+4+5 (không tính Nhóm 2, dù Nhóm 2 đã là "nợ cần chú ý").
 *
 * MỘT trạng thái "tháng đang xem" DÙNG CHUNG cho cả "Dư nợ theo nhóm nợ" lẫn
 * "Tổng hợp tăng giảm" (mặc định = tháng mới nhất/đang sống) — bấm vào 1 cặp
 * cột tháng bất kỳ ở biểu đồ "Biến động hàng tháng" (data-month, xem
 * js/components/charts.js) để CHUYỂN cả 2 mục đó sang đúng tháng vừa bấm,
 * xem trực quan lịch sử — riêng bản THÂN biểu đồ "Biến động hàng tháng" LUÔN
 * vẽ TOÀN BỘ lịch sử, chỉ tô khung mờ + đậm nhãn tháng đang chọn, không thu
 * gọn lại — xem selectMonth()/bindMonthClicks() bên dưới.
 *
 * Biểu đồ "Biến động hàng tháng" (monthlyComboChartSvg — xem
 * js/components/charts.js) mỗi tháng vẽ 1 cột Dư nợ, đơn vị TỶ ĐỒNG ghi 1
 * lần ở đầu, LỒNG sẵn đoạn màu cam đè lên ở đáy thể hiện Nợ xấu (số tiền +
 * % ghi ngay trong cột) — co theo ĐÚNG tỷ lệ % của cột Dư nợ tháng đó.
 * KHÔNG còn cột Lãi phải thu riêng ở biểu đồ này (đã có đủ, kèm %, ở bảng
 * "Tổng hợp tăng giảm"/modal "Xem chi tiết" bên dưới). Đọc dữ liệu từ bảng
 * monthly_snapshots (RLS cho MỌI admin SELECT — xem mục
 * 10.48 docs/supabase-migration.md) — bảng này KHÔNG có sẵn số liệu quá khứ
 * (mỗi lần nhập Excel mới đè lên số liệu cũ, không lưu lịch sử) nên lịch sử
 * chỉ bắt đầu từ lúc tính năng này ra đời. Số liệu tự chốt vào ĐÚNG ngày
 * cuối cùng mỗi tháng (xem send-due-reminders/index.ts); tháng hiện tại
 * (chưa chốt) tự tính "sống" theo dữ liệu hợp đồng đang có, không cần thao
 * tác gì — riêng tháng SỐNG này tính trực tiếp từ `contracts` (RLS đã tự
 * giới hạn staff về đúng phạm vi Thôn/Xóm được gán) nên CHỈ tháng sống mới
 * có thể lệch phạm vi giữa staff/super — mọi tháng ĐÃ CHỐT trong quá khứ đều
 * là số TOÀN QUỸ như nhau cho mọi vai trò (đã lưu sẵn dạng tổng hợp lúc chốt
 * bằng service_role, không qua RLS).
 *
 * Cột "So sánh năm" ở bảng "Tổng hợp tăng giảm" so với CUỐI KỲ 31/12 năm
 * liền trước (đầu năm), KHÔNG phải cùng tháng năm trước — xem yearStartOf()
 * trong buildDebtDashboardData().
 */
/** Tính lại toàn bộ dữ liệu tháng (kể cả tháng hiện tại đang "sống", chưa chốt) — gọi lại MỖI LẦN cần vẽ (kể cả khi bấm chọn tháng khác), rẻ vì chỉ tính trên dữ liệu đã có sẵn trong bộ nhớ, không gọi mạng. */
function buildDebtDashboardData() {
  const now = new Date();
  const contracts = S.getState().contracts;
  const summary = S.debtGroupSummary(contracts, now);
  const snapshots = S.listMonthlySnapshots();
  const lastSnapshot = snapshots.length ? snapshots[snapshots.length - 1] : null;

  // interestRatio (Lãi phải thu / Dư nợ) KHÔNG có sẵn cột riêng trong
  // monthly_snapshots (chỉ lưu bad_debt_ratio) — tự tính lại từ 2 số đã có,
  // dùng chung cho cả tháng đã chốt lẫn tháng sống.
  const interestRatio = (interest, balance) => (balance > 0 ? (interest / balance) * 100 : 0);
  const months = snapshots.map((s) => ({
    yearMonth: s.yearMonth, label: monthLabel(s.yearMonth),
    balance: s.totalBalance, interest: s.interestReceivable, badDebt: s.badDebtBalance, badDebtRatio: s.badDebtRatio,
    interestRatio: interestRatio(s.interestReceivable, s.totalBalance),
    groupBalances: s.groupBalances,
  }));
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!lastSnapshot || lastSnapshot.yearMonth !== currentYearMonth) {
    months.push({
      yearMonth: currentYearMonth, label: monthLabel(currentYearMonth),
      balance: summary.totalBalance, interest: summary.interestReceivable, badDebt: summary.badDebtBalance, badDebtRatio: summary.badDebtRatio,
      interestRatio: interestRatio(summary.interestReceivable, summary.totalBalance),
      groupBalances: summary.groupBalances,
      live: true,
    });
  }
  const byYearMonth = new Map(months.map((m) => [m.yearMonth, m]));
  /** Tháng liền trước (so sánh hàng tháng) — tra trực tiếp theo year_month, không giả định mảng liền mạch (có thể thiếu tháng nếu app mới dùng tính năng giữa chừng). */
  function prevMonthOf(ym) {
    const [y, m] = ym.split('-').map(Number);
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return byYearMonth.get(`${py}-${String(pm).padStart(2, '0')}`) || null;
  }
  /**
   * "So sánh năm" = so với CUỐI KỲ 31/12 năm liền trước (đầu năm nay) đến
   * ĐÚNG tháng đang xem — không phải so với cùng tháng năm trước. Tính năng
   * còn quá mới, CHƯA có dữ liệu tới tận 31/12 năm trước — lúc đó tạm lấy
   * THÁNG SỚM NHẤT đang có làm mốc, để luôn có gì đó so sánh thay vì ẩn hẳn.
   */
  function yearStartOf(ym) {
    const [y] = ym.split('-').map(Number);
    const exact = byYearMonth.get(`${y - 1}-12`);
    if (exact) return exact;
    const earliest = months[0];
    return earliest && earliest.yearMonth < ym ? earliest : null;
  }
  return { months, prevMonthOf, yearStartOf };
}

/**
 * Bảng tổng hợp tăng/giảm — mỗi dòng 1 chỉ tiêu (Dư nợ/Lãi phải thu/Nợ xấu)
 * của ĐÚNG 1 tháng (m): số dư ĐÚNG tháng đó, kèm % so với tháng trước VÀ "So
 * sánh năm" (so với 31/12 năm liền trước — chưa đủ lịch sử tới mốc đó thì
 * yearStartOf() tự lấy tạm THÁNG SỚM NHẤT hiện có, xem giải thích ở đó — cột
 * này chỉ hiện "—" khi thực sự chưa có tháng nào khác để so). Dòng Nợ xấu
 * LUÔN tô màu đỏ (không đổi theo tỷ lệ nghiêm trọng) — đây là nhãn NHẬN DIỆN
 * chỉ tiêu, không phải màu cảnh báo mức độ.
 */
function monthDetailTableHtml(m, prevMonthOf, yearStartOf) {
  const prev = prevMonthOf(m.yearMonth);
  const yearStart = yearStartOf(m.yearMonth);
  const rows = [
    { label: 'Dư nợ', color: 'var(--color-primary)', value: m.balance, prevV: prev?.balance ?? null, yearStartV: yearStart ? yearStart.balance : null, worse: false },
    { label: 'Nợ xấu', color: 'var(--danger)', value: m.badDebt, extra: formatPercent(m.badDebtRatio), prevV: prev?.badDebt ?? null, yearStartV: yearStart ? yearStart.badDebt : null, worse: true },
    { label: 'Lãi phải thu', color: 'var(--purple)', value: m.interest, extra: formatPercent(m.interestRatio), prevV: prev?.interest ?? null, yearStartV: yearStart ? yearStart.interest : null, worse: false },
  ];
  const th = 'padding:0 8px 8px 0;text-align:left;font-size:10.5px;color:var(--text-muted);font-weight:600;white-space:nowrap';
  const td = 'padding:10px 8px 10px 0;border-top:1px solid var(--border);white-space:nowrap';
  const bodyRows = rows.map((r) => `
    <tr>
      <td style="${td}font-weight:700;color:${r.color}">${r.label}</td>
      <td style="${td}font-weight:700">${formatVND(r.value)}${r.extra ? ` <span style="font-weight:400;color:var(--text-muted);font-size:10.5px">(${r.extra})</span>` : ''}</td>
      <td style="${td}">${deltaChip(pct(r.value, r.prevV), { worse: r.worse })}</td>
      <td style="${td}">${r.yearStartV != null ? deltaChip(pct(r.value, r.yearStartV), { worse: r.worse }) : '<span style="font-size:10.5px;color:var(--text-faint)">—</span>'}</td>
    </tr>`).join('');
  return `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead><tr>
          <th style="${th}">Chỉ tiêu</th>
          <th style="${th}">Số dư</th>
          <th style="${th}">So tháng trước</th>
          <th style="${th}">So sánh năm</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}

/**
 * Modal "Xem chi tiết" — bảng ĐẦY ĐỦ toàn bộ lịch sử các tháng (mới nhất lên
 * đầu), mỗi cột 1 chỉ tiêu (Dư nợ/Nợ xấu/Lãi phải thu) kèm % so với tháng
 * trước ngay dưới số — khác bảng "Tổng hợp tăng giảm" ở ngoài (CHỈ hiện 1
 * tháng đang chọn): ở đây xem được NHIỀU tháng cùng lúc để so sánh xu hướng.
 * Bấm vào 1 dòng tháng (chỉ những tháng ĐÃ có đủ dữ liệu để so — 31/12 năm
 * liền trước) để MỞ RỘNG thêm 1 dòng phụ ngay dưới, hiện "So sánh năm" của
 * đúng tháng đó — không hiện sẵn hết để bảng gọn, chỉ mở khi cần xem.
 */
function openMonthlyDetailModal() {
  const { months, prevMonthOf, yearStartOf } = buildDebtDashboardData();
  const rows = [...months].reverse();
  const td = 'padding:8px 10px 8px 0;border-bottom:1px solid var(--border);white-space:nowrap';
  const bodyRows = rows.map((m) => {
    const prev = prevMonthOf(m.yearMonth);
    const yearStart = yearStartOf(m.yearMonth);
    const yoyRow = yearStart ? `
      <tr data-yoy-row="${m.yearMonth}" hidden>
        <td colspan="4" style="padding:2px 10px 10px 0;border-bottom:1px solid var(--border);font-size:11px;color:var(--text-muted)">
          So với đầu năm:
          Dư nợ ${deltaChip(pct(m.balance, yearStart.balance))} ·
          Nợ xấu ${deltaChip(pct(m.badDebt, yearStart.badDebt), { worse: true })} ·
          Lãi phải thu ${deltaChip(pct(m.interest, yearStart.interest))}
        </td>
      </tr>` : '';
    return `
      <tr data-toggle-yoy="${m.yearMonth}" style="${yearStart ? 'cursor:pointer' : ''}">
        <td style="${td}font-weight:700">${m.label}${m.live ? ' <span style="font-weight:400;color:var(--text-faint)">(đang cập nhật)</span>' : ''}${yearStart ? ' <span style="font-size:9px;color:var(--text-faint)">▾</span>' : ''}</td>
        <td style="${td}">${formatVND(m.balance)}<br>${deltaChip(pct(m.balance, prev?.balance ?? null))}</td>
        <td style="${td}">${formatVND(m.badDebt)} <span style="color:var(--text-muted);font-size:10.5px">(${formatPercent(m.badDebtRatio)})</span><br>${deltaChip(pct(m.badDebt, prev?.badDebt ?? null), { worse: true })}</td>
        <td style="${td}">${formatVND(m.interest)} <span style="color:var(--text-muted);font-size:10.5px">(${formatPercent(m.interestRatio)})</span><br>${deltaChip(pct(m.interest, prev?.interest ?? null))}</td>
      </tr>${yoyRow}`;
  }).join('');
  openModal({
    title: 'Chi tiết theo từng tháng',
    bodyHtml: `
      <p class="text-sm text-muted mb-8">Bấm vào 1 tháng để xem thêm so với đầu năm.</p>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px">
          <thead>
            <tr style="color:var(--text-muted);font-size:11px;text-align:left">
              <th style="padding:0 10px 6px 0">Tháng</th>
              <th style="padding:0 10px 6px 0">Dư nợ</th>
              <th style="padding:0 10px 6px 0">Nợ xấu</th>
              <th style="padding:0 10px 6px 0">Lãi phải thu</th>
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>`,
    onMount(sheet) {
      sheet.querySelectorAll('[data-toggle-yoy]').forEach((row) => {
        const detail = sheet.querySelector(`[data-yoy-row="${row.dataset.toggleYoy}"]`);
        if (!detail) return;
        row.addEventListener('click', () => { detail.hidden = !detail.hidden; });
      });
    },
  });
}

/**
 * Nút chọn tháng để xem lại lịch sử, đặt NGAY SAU "Dư nợ theo nhóm nợ" —
 * chọn 1 tháng bất kỳ (VD 07/2026) sẽ gọi selectMonth() y hệt như bấm vào
 * cột biểu đồ "Biến động hàng tháng". Danh sách xếp mới nhất trước cho dễ
 * tìm. Kèm nút "Nạp dữ liệu cũ" (CHỈ super, xem openImportHistoricalModal())
 * — nạp file Excel của 1 tháng ĐÃ QUA để có số liệu xem lại lịch sử, TÁCH
 * RIÊNG hẳn khỏi nút "Nhập dữ liệu từ Excel" ở trang Khách hàng (nút đó ghi
 * đè danh sách hợp đồng ĐANG SỐNG — nút này chỉ tính tổng rồi lưu 1 dòng
 * lịch sử, không đụng gì tới hợp đồng thật).
 */
function monthSelectorHtml(months, selectedYm, isSuper) {
  const options = months
    .slice()
    .reverse()
    .map((m) => `<option value="${m.yearMonth}" ${m.yearMonth === selectedYm ? 'selected' : ''}>${monthLabelWithNote(m)}</option>`)
    .join('');
  return `
    <div class="flex items-center justify-between mt-12" style="gap:8px;flex-wrap:wrap">
      <div class="flex items-center" style="gap:8px">
        <label for="month-select" style="font-size:12px;color:var(--text-muted);font-weight:600;white-space:nowrap">Xem lại tháng</label>
        <select id="month-select" class="pill-select" style="max-width:220px">${options}</select>
      </div>
      ${isSuper ? `<a href="javascript:void(0)" id="btn-import-historical" class="link-more" style="font-size:11.5px">Nạp dữ liệu cũ</a>` : ''}
    </div>`;
}

function debtDashboardHtml() {
  const { isSuper } = currentRoles();
  const contracts = visibleContracts();
  const { months, prevMonthOf, yearStartOf } = buildDebtDashboardData();
  const initial = months[months.length - 1];
  const provision = S.provisionSummary(contracts, new Date());

  return `
    <div class="card card-pad mb-16">
      <h3 style="font-size:13.5px;margin-bottom:10px">Dư nợ theo nhóm nợ</h3>
      <div id="nhom-no-slot">${nhomNoBarHtml(initial)}</div>
      <div id="provision-slot" class="mt-16">${provisionRowsHtml(provision)}</div>
      <div id="month-selector-slot">${monthSelectorHtml(months, initial.yearMonth, isSuper)}</div>

      <h3 style="font-size:13.5px;margin-bottom:10px" class="mt-24">Biến động hàng tháng</h3>
      <div id="trend-chart-slot">${monthlyComboChartSvg({ months, selectedYm: initial.yearMonth })}</div>

      <div class="flex items-center justify-between mb-10 mt-20">
        <h3 style="font-size:13.5px;margin:0">Tổng hợp tăng giảm</h3>
        <div class="flex items-center" style="gap:10px">
          <span id="month-detail-label" style="font-size:12px;color:var(--text-muted);font-weight:600">${monthLabelWithNote(initial)}</span>
          <a href="javascript:void(0)" id="btn-monthly-detail" class="link-more">Xem chi tiết</a>
        </div>
      </div>
      <div id="month-detail-slot">${monthDetailTableHtml(initial, prevMonthOf, yearStartOf)}</div>
    </div>
  `;
}

/** Gắn click cho mỗi cặp cột tháng ở biểu đồ "Biến động hàng tháng" (data-month = year_month) — bấm vào để CHUYỂN "Dư nợ theo nhóm nợ" + "Tổng hợp tăng giảm" sang đúng tháng đó, xem selectMonth(). */
function bindMonthClicks(root) {
  root.querySelectorAll('[data-month]').forEach((el) => {
    el.addEventListener('click', () => selectMonth(root, el.dataset.month));
  });
}
/** Gắn sự kiện đổi cho nút chọn tháng (ngay sau "Dư nợ theo nhóm nợ") — chọn 1 tháng trong danh sách sẽ chuyển y hệt như bấm vào cột biểu đồ, xem selectMonth(). */
function bindMonthSelector(root) {
  const sel = root.querySelector('#month-select');
  if (!sel) return;
  sel.addEventListener('change', () => selectMonth(root, sel.value));
}

/** Dò dòng "Đến ngày DD/MM/YYYY" (mẫu "Sao kê hợp đồng tín dụng" luôn ghi ở vài dòng đầu file, TRƯỚC dòng tiêu đề cột "STT") trong dữ liệu THÔ đọc từ Excel (chưa qua remapReportTemplateRows — hàm đó đã bỏ các dòng này) — đây là ngày quyết định số liệu vừa nạp thuộc về THÁNG NÀO. null nếu không tìm thấy. */
function extractReportAsOfDate(rawRows) {
  for (const row of rawRows.slice(0, 10)) {
    for (const cell of row || []) {
      const m = String(cell ?? '').match(/đến ngày\s+(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i);
      if (m) return S.parseVNDate(m[1]);
    }
  }
  return null;
}

/**
 * "Nạp dữ liệu cũ" (mục 10.51 docs) — TÁCH RIÊNG hẳn nút "Nhập dữ liệu từ
 * Excel" ở trang Khách hàng (nút đó ghi đè danh sách hợp đồng ĐANG SỐNG).
 * Dùng ĐÚNG mẫu "Sao kê hợp đồng tín dụng" (có dòng "Đến ngày DD/MM/YYYY" ở
 * đầu file) — đọc + tính tổng NGAY TRONG TRÌNH DUYỆT (KHÔNG đụng gì tới bảng
 * hợp đồng thật), hiện bản xem trước để xác nhận, rồi mới lưu 1 dòng lịch sử
 * cho đúng tháng của ngày "Đến ngày" đó (xem S.previewHistoricalSnapshot()/
 * S.saveHistoricalSnapshot() trong state.js).
 */
function openImportHistoricalModal() {
  let preview = null; // { yearMonth, snapshotDate, contractsCount, summary, parseErrors, willOverwrite }
  openModal({
    title: 'Nạp dữ liệu cũ',
    bodyHtml: `
      <p class="text-sm text-muted mb-8">
        Dùng đúng mẫu <b>"Sao kê hợp đồng tín dụng"</b> (file có dòng "Đến ngày DD/MM/YYYY" ở đầu) — hệ
        thống tự đọc ngày này để biết số liệu thuộc tháng nào. <b>Chỉ tính tổng để xem lại lịch sử</b>,
        KHÔNG đụng gì tới danh sách hợp đồng đang dùng hiện tại.
      </p>
      <div class="field">
        <input type="file" id="hist-file-input" accept=".xls,.xlsx"/>
      </div>
      <button class="btn btn-primary btn-block mt-8" id="btn-hist-upload" disabled>Đọc file</button>
      <div id="hist-preview"></div>
    `,
    onMount(sheet, closeFn) {
      const fileInput = sheet.querySelector('#hist-file-input');
      const uploadBtn = sheet.querySelector('#btn-hist-upload');
      const previewEl = sheet.querySelector('#hist-preview');
      fileInput.addEventListener('change', () => { uploadBtn.disabled = !fileInput.files[0]; });

      const uploadIdleHtml = uploadBtn.innerHTML;
      uploadBtn.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Đang đọc file...';
        preview = null;
        previewEl.innerHTML = '';
        try {
          const rawRows = await readExcelFirstSheet(file);
          const asOfDate = extractReportAsOfDate(rawRows);
          const tsv = rowsToTsv(remapReportTemplateRows(rawRows));
          preview = S.previewHistoricalSnapshot(tsv, asOfDate);
        } catch (err) {
          toast(err.message || 'Không đọc được file', 'error');
          uploadBtn.innerHTML = uploadIdleHtml;
          uploadBtn.disabled = !fileInput.files[0];
          return;
        }
        uploadBtn.innerHTML = uploadIdleHtml;
        uploadBtn.disabled = !fileInput.files[0];
        const g = preview.summary.groupBalances;
        previewEl.innerHTML = `
          <div class="card card-pad mt-16" style="background:var(--surface-alt)">
            <div class="text-sm fw-700 mb-8">Xem trước — tháng ${monthLabel(preview.yearMonth)} (đến ngày ${formatDate(preview.snapshotDate)})</div>
            ${preview.willOverwrite ? `<div class="text-sm mb-8" style="color:var(--warning)">Tháng này đã có sẵn số liệu — lưu sẽ GHI ĐÈ.</div>` : ''}
            <div class="text-sm mb-4">${preview.contractsCount} hợp đồng · Dư nợ <b>${formatVND(preview.summary.totalBalance)}</b></div>
            <div class="text-sm mb-4">Nợ xấu <b style="color:var(--danger)">${formatVND(preview.summary.badDebtBalance)}</b> (${formatPercent(preview.summary.badDebtRatio)}) · Lãi phải thu <b style="color:var(--purple)">${formatVND(preview.summary.interestReceivable)}</b></div>
            <div class="text-sm text-muted mb-8">Nhóm 1: ${formatVND(g[1])} · Nhóm 2: ${formatVND(g[2])} · Nhóm 3: ${formatVND(g[3])} · Nhóm 4: ${formatVND(g[4])} · Nhóm 5: ${formatVND(g[5])}</div>
            ${preview.parseErrors.length ? `<div class="text-sm text-danger mb-8">${preview.parseErrors.slice(0, 5).join('<br/>')}</div>` : ''}
            <button class="btn btn-primary btn-block" id="btn-hist-confirm">Xác nhận lưu</button>
          </div>
        `;
        previewEl.querySelector('#btn-hist-confirm').addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.textContent = 'Đang lưu...';
          try {
            const res = await S.saveHistoricalSnapshot(preview);
            if (!res.ok) throw new Error(res.reason || 'Có lỗi xảy ra');
            toast('Đã lưu dữ liệu cũ', 'success');
            closeFn();
            render(document.getElementById('app-content'));
          } catch (err) {
            toast(err.message || 'Có lỗi xảy ra', 'error');
            btn.disabled = false;
            btn.textContent = 'Xác nhận lưu';
          }
        });
      });
    },
  });
}
/** Chuyển "Dư nợ theo nhóm nợ" + "Tổng hợp tăng giảm" sang đúng tháng `ym` vừa bấm — vẽ lại TOÀN BỘ biểu đồ "Biến động hàng tháng" để tô lại khung mờ + đậm nhãn đúng tháng đang chọn (chart này vẫn luôn vẽ đủ lịch sử, không thu gọn). Không đụng tới Dự phòng (luôn tính sống, xem provisionRowsHtml()). */
function selectMonth(root, ym) {
  const { months, prevMonthOf, yearStartOf } = buildDebtDashboardData();
  const m = months.find((x) => x.yearMonth === ym);
  if (!m) return;
  root.querySelector('#nhom-no-slot').innerHTML = nhomNoBarHtml(m);
  root.querySelector('#month-detail-slot').innerHTML = monthDetailTableHtml(m, prevMonthOf, yearStartOf);
  root.querySelector('#month-detail-label').textContent = monthLabelWithNote(m);
  root.querySelector('#trend-chart-slot').innerHTML = monthlyComboChartSvg({ months, selectedYm: ym });
  const sel = root.querySelector('#month-select');
  if (sel) sel.value = ym;
  bindNhomNoClicks(root);
  bindMonthClicks(root);
}

/** % thay đổi so với 1 giá trị trước đó — null nếu chưa có gì để so (chưa đủ lịch sử, hoặc giá trị trước = 0). */
function pct(curr, prevVal) {
  if (prevVal === null || prevVal === undefined || prevVal === 0) return null;
  return ((curr - prevVal) / Math.abs(prevVal)) * 100;
}
/** `worse` = chiều tăng bị coi là XẤU (chỉ dùng cho Nợ xấu — tăng tô đỏ, giảm tô xanh). Mặc định trung tính (chỉ hiện mũi tên + %, không phán xét tốt/xấu). */
function deltaChip(p, { worse = false } = {}) {
  if (p === null) return `<span style="font-size:10.5px;color:var(--text-faint)">—</span>`;
  const flat = Math.abs(p) < 0.05;
  const up = p > 0;
  const color = flat ? 'var(--text-faint)' : worse ? (up ? 'var(--danger)' : 'var(--success)') : 'var(--text-muted)';
  const arrow = flat ? '·' : up ? '▲' : '▼';
  return `<span style="font-size:10.5px;font-weight:700;color:${color}">${arrow} ${Math.abs(p).toFixed(1).replace('.', ',')}%</span>`;
}

/**
 * Danh sách hợp đồng thuộc ĐÚNG 1 nhóm nợ (1-5, phân loại theo Thông tư
 * 02/2013 — xem S.debtGroup()) — mở khi bấm vào cột/nhãn tương ứng ở biểu đồ
 * "Dư nợ theo nhóm nợ" (CHỈ bấm được ở tháng đang sống — xem nhomNoBarHtml()).
 * Luôn tính theo phân loại HIỆN TẠI (thời điểm bấm), dùng ĐÚNG phạm vi được
 * phép xem của phiên đang đăng nhập (visibleContracts() — super = toàn quỹ,
 * staff = trong Thôn/Xóm được gán).
 */
function openDebtGroupModal(g, isStaff, isSuper) {
  const now = new Date();
  const list = visibleContracts().filter((ct) => S.debtGroup(ct, now) === g);
  const total = list.reduce((s, ct) => s + (ct.balance || 0), 0);
  const color = GROUP_COLORS[g];
  // TSBĐ (tài sản bảo đảm) chỉ có ý nghĩa với Nhóm 2-5 (Nhóm 1 = 0% dự phòng
  // cụ thể, xem S.provisionSummary()) — Nhóm 1 giữ đúng danh sách gọn như cũ.
  const showTsbd = g >= 2;
  openModal({
    title: `Nhóm ${g} (${list.length})`,
    bodyHtml: `
      <div class="text-sm text-muted mb-12">Tổng dư nợ: <b style="color:${color}">${formatVND(total)}</b></div>
      ${list.length ? list.map((ct) => {
        const cust = S.getCustomer(ct.customerId);
        const days = S.daysOverdue(ct, now);
        const addressLabel = cust ? ([cust.xom, cust.thon, cust.tinh].filter(Boolean).join(', ') || cust.address || 'Chưa có địa bàn') : '—';
        return `
        <div class="list-row" data-view-ct="${ct.id}" style="cursor:pointer;flex-direction:column;align-items:stretch;gap:2px">
          <div class="flex items-center gap-6" style="flex-wrap:nowrap">
            <span style="font-size:14px;font-weight:700;line-height:1.8;padding-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">${cust ? cust.name : '—'}</span>
            <span class="text-sm text-muted" style="flex-shrink:0">${days > 0 ? `Quá hạn ${days} ngày` : 'Trong hạn'}</span>
          </div>
          <div class="flex justify-between items-center gap-6" style="flex-wrap:nowrap">
            <span class="row-sub" style="margin-top:0;flex:1;min-width:0">${addressLabel}</span>
            <b style="color:${color};font-size:13px;flex-shrink:0">${formatVND(ct.balance)}</b>
          </div>
          ${installmentHintHtml(ct)}
          ${showTsbd ? tsbdRowHtml(ct, isSuper) : ''}
        </div>`;
      }).join('') : emptyState({ iconName: 'checkCircle', title: 'Không có hợp đồng nào', message: 'Nhóm này hiện đang trống.' })}
    `,
    onMount(sheet) {
      sheet.querySelectorAll('[data-view-ct]').forEach((row) => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('[data-tsbd-wrap]')) return; // bấm vào ô TSBĐ thì đừng mở chi tiết hợp đồng
          const ct = S.getContract(row.dataset.viewCt);
          openContractView(ct.customerId, ct, { readOnly: isStaff });
        });
      });
      if (isSuper && showTsbd) bindTsbdInputs(sheet);
    },
  });
}

/**
 * Ô "Có TSBĐ" + giá trị TSBĐ trong danh sách hợp đồng theo nhóm — dùng tính
 * "Dự phòng cụ thể phải trích" (xem S.provisionSummary() ở state.js). CHỈ
 * super admin (editable=true) tích/sửa được — nhân viên thường CHỈ XEM, đúng
 * yêu cầu "chỉ tài khoản admin mới có chức năng này còn tất cả tk quản trị
 * đều xem được dữ liệu". Tích/bỏ tích được tự do (không khóa lại) — đúng
 * yêu cầu. Giá trị nhập vào tự ngăn cách hàng nghìn bằng dấu chấm lúc gõ
 * (VD "4.000.000") cho dễ đọc trên điện thoại — xem bindTsbdInputs().
 */
function tsbdRowHtml(ct, editable) {
  if (!editable) {
    return `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);font-size:11.5px;color:var(--text-muted)">${ct.hasCollateral ? `Có TSBĐ: <b>${formatVND(ct.collateralValue)}</b>` : 'Chưa có TSBĐ'}</div>`;
  }
  const checked = !!ct.hasCollateral;
  return `
    <div data-tsbd-wrap="${ct.id}" style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border)">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted)">
        <input type="checkbox" data-tsbd-check="${ct.id}" ${checked ? 'checked' : ''} style="width:16px;height:16px;flex-shrink:0">
        <span>Có TSBĐ</span>
      </label>
      <input type="text" inputmode="numeric" data-tsbd-value="${ct.id}" placeholder="Giá trị TSBĐ (₫)" value="${checked && ct.collateralValue ? formatNumber(ct.collateralValue) : ''}" ${checked ? '' : 'hidden'} style="margin-top:6px;width:100%;padding:7px 9px;border:1px solid var(--border);border-radius:8px;font-size:12.5px">
    </div>`;
}
/** Gắn sự kiện cho ô "Có TSBĐ" + giá trị trong modal (chỉ gọi khi isSuper) — tích thì hiện ô nhập, gõ xong rời khỏi ô (blur) mới lưu (tránh lưu 0 lúc chưa kịp gõ); bỏ tích thì xóa hẳn ngay (không khóa lại). Ô nhập tự format thêm dấu chấm ngăn cách hàng nghìn MỖI LẦN gõ (input) — lúc lưu tự bỏ dấu chấm lại thành số thật. Lưu xong gọi refreshProvisionSlot() để "Dự phòng cụ thể phải trích" ở ngoài cập nhật ngay. */
function bindTsbdInputs(sheet) {
  sheet.querySelectorAll('[data-tsbd-check]').forEach((cb) => {
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', async () => {
      const ctId = cb.dataset.tsbdCheck;
      const wrap = sheet.querySelector(`[data-tsbd-wrap="${ctId}"]`);
      const valueInput = wrap?.querySelector('[data-tsbd-value]');
      if (cb.checked) {
        if (valueInput) { valueInput.hidden = false; valueInput.focus(); }
        return;
      }
      try {
        await S.setContractCollateral(ctId, { hasCollateral: false, collateralValue: 0 });
        if (valueInput) { valueInput.hidden = true; valueInput.value = ''; }
        refreshProvisionSlot();
      } catch (err) {
        alert(err.message);
        cb.checked = true;
        if (valueInput) valueInput.hidden = false;
      }
    });
  });
  sheet.querySelectorAll('[data-tsbd-value]').forEach((input) => {
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '');
      input.value = digits ? formatNumber(Number(digits)) : '';
    });
    input.addEventListener('blur', async () => {
      const ctId = input.dataset.tsbdValue;
      const val = Number(input.value.replace(/\D/g, '')) || 0;
      try {
        await S.setContractCollateral(ctId, { hasCollateral: true, collateralValue: val });
        refreshProvisionSlot();
      } catch (err) {
        alert(err.message);
      }
    });
  });
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
