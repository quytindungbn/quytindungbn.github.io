import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { openModal } from '../../components/modal.js';
import { emptyState, statusBadge, installmentHintHtml } from '../../components/ui.js';
import { formatVND, formatNumber, formatDateTime, formatCompact, initials, colorFor } from '../../utils.js';
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
  const { isStaff, isSuper } = currentRoles();
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

    ${nhomNoSectionHtml(contracts)}
    ${isSuper ? debtDashboardHtml() : ''}

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

  // "Dư nợ theo nhóm nợ" LUÔN hiện (mọi vai trò) — bấm vào 1 cột/nhãn nhóm
  // để xem danh sách hợp đồng đúng nhóm đó.
  bindNhomNoClicks(contentEl);

  // Bấm chọn 1 tháng ở dãy chip dưới biểu đồ "Biến động hàng tháng" — cập
  // nhật bảng "Tổng hợp tăng giảm" bên dưới theo ĐÚNG tháng đó, không tải
  // lại cả trang. Tính lại buildDebtDashboardData() mỗi lần bấm (rẻ, không
  // gọi mạng) để luôn khớp dữ liệu mới nhất đang có.
  if (isSuper) {
    contentEl.querySelector('#btn-monthly-detail')?.addEventListener('click', openMonthlyDetailModal);
    contentEl.querySelectorAll('[data-month-picker]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ym = btn.dataset.monthPicker;
        const { months, prevMonthOf, yearStartOf } = buildDebtDashboardData();
        const m = months.find((x) => x.yearMonth === ym);
        if (!m) return;
        contentEl.querySelector('#month-detail-slot').innerHTML = monthDetailTableHtml(m, prevMonthOf, yearStartOf);
        contentEl.querySelector('#month-detail-label').textContent = `${m.label}${m.live ? ' (đang cập nhật)' : ''}`;
        contentEl.querySelectorAll('[data-month-picker]').forEach((b) => {
          const active = b.dataset.monthPicker === ym;
          b.dataset.active = String(active);
          b.style.border = `1px solid ${active ? 'var(--color-primary)' : 'var(--border)'}`;
          b.style.background = active ? 'var(--color-primary)' : 'var(--surface)';
          b.style.color = active ? '#fff' : 'var(--text-muted)';
        });
      });
    });
  }
}

/** Gắn click cho mỗi cột/nhãn "Dư nợ theo nhóm nợ" (data-id = số nhóm) — mở danh sách hợp đồng ĐÚNG nhóm đó theo phân loại HIỆN TẠI. `root` là contentEl (lúc render() đầu) hoặc document (lúc refreshNhomNoSection() gọi lại sau khi lưu TSBĐ) — cả 2 đều có .querySelector nên dùng chung được. */
function bindNhomNoClicks(root) {
  const slot = root.querySelector('#nhom-no-slot');
  if (!slot) return;
  const { isStaff, isSuper } = currentRoles();
  slot.querySelectorAll('[data-id]').forEach((el) => {
    el.addEventListener('click', () => openDebtGroupModal(Number(el.dataset.id), isStaff, isSuper));
  });
}

const GROUP_COLORS = { 1: 'var(--success)', 2: 'var(--warning)', 3: '#f0a29c', 4: 'var(--danger)', 5: '#8f231d' };

/**
 * "Dư nợ theo nhóm nợ" + Dự phòng chung/cụ thể phải trích — LUÔN hiện cho
 * MỌI quản trị viên (staff lẫn super — staff chỉ thấy đúng phạm vi Thôn/Xóm
 * được gán, xem visibleContracts()), KHÁC với "Biến động hàng tháng"/"Tổng
 * hợp tăng giảm" bên dưới (debtDashboardHtml() — vẫn CHỈ super xem, đọc từ
 * bảng monthly_snapshots RLS super-only). Luôn tính "SỐNG" (ngay bây giờ,
 * không có lịch sử theo tháng — provisionSummary() ở state.js).
 *
 * Nhóm nợ 1-5 theo đúng quy định phân loại nợ NHNN (Thông tư 02/2013): Nhóm
 * 1 = quá hạn 0-10 ngày, Nhóm 2 = 11-90, Nhóm 3 = 91-180, Nhóm 4 = 181-360,
 * Nhóm 5 = trên 360 ngày.
 *
 * Bấm vào 1 cột/nhãn nhóm để xem danh sách hợp đồng đúng nhóm đó
 * (openDebtGroupModal) — với Nhóm 2-5, danh sách có thêm ô "Có TSBĐ" (tài
 * sản bảo đảm) — CHỈ super admin tích/sửa được (đúng yêu cầu: "chỉ tài
 * khoản admin mới có chức năng này còn tất cả tk quản trị đều xem được dữ
 * liệu"), ai cũng xem được giá trị đã lưu. Sau khi lưu TSBĐ,
 * refreshNhomNoSection() cập nhật lại ngay Dự phòng cụ thể mà không cần tải
 * lại trang.
 */
function nhomNoSectionHtml(contracts) {
  const now = new Date();
  const summary = S.debtGroupSummary(contracts, now);
  const provision = S.provisionSummary(contracts, now);
  return `
    <div class="card card-pad mb-16">
      <h3 style="font-size:13.5px;margin-bottom:10px">Dư nợ theo nhóm nợ</h3>
      <div id="nhom-no-slot">${nhomNoBarHtml(summary)}</div>
      <div class="grid-2 mt-16" id="provision-slot">${provisionRowsHtml(provision)}</div>
    </div>`;
}
function nhomNoBarHtml(summary) {
  const barItems = [1, 2, 3, 4, 5].map((g) => ({ id: g, label: `Nhóm ${g}`, shortLabel: String(g), value: summary.groupBalances[g], color: GROUP_COLORS[g] }));
  return barChartSvg({ items: barItems });
}
function provisionRowsHtml(provision) {
  return `
    <div class="stat-tile c-purple"><div class="stat-label">Dự phòng chung phải trích</div><div class="stat-value" style="font-size:14px">${formatVND(provision.generalProvision)}</div></div>
    <div class="stat-tile c-orange"><div class="stat-label">Dự phòng cụ thể phải trích</div><div class="stat-value" style="font-size:14px">${formatVND(provision.specificProvision)}</div></div>`;
}
/** Vẽ lại "Dư nợ theo nhóm nợ" + Dự phòng ngay sau khi lưu TSBĐ trong modal (openDebtGroupModal) — không cần tải lại trang, không cần đóng modal đang mở. */
function refreshNhomNoSection() {
  const contracts = visibleContracts();
  const now = new Date();
  const summary = S.debtGroupSummary(contracts, now);
  const provision = S.provisionSummary(contracts, now);
  const nhomSlot = document.getElementById('nhom-no-slot');
  if (nhomSlot) nhomSlot.innerHTML = nhomNoBarHtml(summary);
  const provisionSlot = document.getElementById('provision-slot');
  if (provisionSlot) provisionSlot.innerHTML = provisionRowsHtml(provision);
  bindNhomNoClicks(document);
}

/**
 * Dashboard "Biến động hàng tháng" + "Tổng hợp tăng giảm" — CHỈ hiện cho
 * quản trị viên TOÀN QUYỀN (role='super'), dưới 4 ô thống kê chính + "Dư nợ
 * theo nhóm nợ" (2 mục đó LUÔN hiện cho mọi vai trò — xem nhomNoSectionHtml())
 * — vì 2 mục NÀY đọc từ bảng monthly_snapshots, RLS CHỈ cho super SELECT
 * (giống trang "Nhật ký") — xem mục 10.46 docs/supabase-migration.md.
 *
 * "Lãi phải thu" chỉ tính Nhóm 1-4 (Nhóm 5 coi như khó thu, không còn tính
 * lãi phải thu nữa). "Nợ xấu" CHÍNH THỨC = Nhóm 3+4+5 (không tính Nhóm 2, dù
 * Nhóm 2 đã là "nợ cần chú ý").
 *
 * Thứ tự: biểu đồ "Biến động hàng tháng" (LUÔN vẽ TOÀN BỘ lịch sử, không đổi
 * theo tháng đang chọn) → dãy chip chọn Tháng/Năm → bảng "Tổng hợp tăng
 * giảm" (LUÔN hiện đúng số liệu của 1 THÁNG ĐANG CHỌN, mặc định = tháng mới
 * nhất/đang sống — bấm 1 chip tháng để đổi tháng xem, cập nhật ngay mà
 * không tải lại trang, xem buildDebtDashboardData()/monthDetailTableHtml()
 * và handler data-month-picker trong render()).
 *
 * Biểu đồ "Biến động hàng tháng" (monthlyComboChartSvg — xem
 * js/components/charts.js) mỗi tháng vẽ 1 cặp cột liền nhau, đơn vị TỶ ĐỒNG
 * ghi 1 lần ở đầu: cột Dư nợ (to) LỒNG sẵn đoạn màu cam đè lên ở đáy thể
 * hiện Nợ xấu (số tiền ghi ngay trong cột), cột Lãi phải thu (nhỏ hơn) ngay
 * bên cạnh — cả 2 cột phụ co theo ĐÚNG tỷ lệ % của cột Dư nợ tháng đó. Đọc
 * dữ liệu từ bảng monthly_snapshots — bảng này KHÔNG có sẵn số liệu quá khứ
 * (mỗi lần nhập Excel mới đè lên số liệu cũ, không lưu lịch sử) nên lịch sử
 * chỉ bắt đầu từ lúc tính năng này ra đời. Số liệu tự chốt vào ĐÚNG ngày
 * cuối cùng mỗi tháng (xem send-due-reminders/index.ts); tháng hiện tại
 * (chưa chốt) tự tính "sống" theo dữ liệu hợp đồng đang có, không cần thao
 * tác gì.
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

  const months = snapshots.map((s) => ({
    yearMonth: s.yearMonth, label: monthLabel(s.yearMonth),
    balance: s.totalBalance, interest: s.interestReceivable, badDebt: s.badDebtBalance, badDebtRatio: s.badDebtRatio,
  }));
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!lastSnapshot || lastSnapshot.yearMonth !== currentYearMonth) {
    months.push({
      yearMonth: currentYearMonth, label: monthLabel(currentYearMonth),
      balance: summary.totalBalance, interest: summary.interestReceivable, badDebt: summary.badDebtBalance, badDebtRatio: summary.badDebtRatio,
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
  /** "So sánh năm" = so với CUỐI KỲ 31/12 năm liền trước (đầu năm nay) đến ĐÚNG tháng đang xem — không phải so với cùng tháng năm trước. */
  function yearStartOf(ym) {
    const [y] = ym.split('-').map(Number);
    return byYearMonth.get(`${y - 1}-12`) || null;
  }
  return { months, prevMonthOf, yearStartOf };
}

/**
 * Bảng tổng hợp tăng/giảm — mỗi dòng 1 chỉ tiêu (Dư nợ/Lãi phải thu/Nợ xấu)
 * của ĐÚNG 1 tháng (m): số dư ĐÚNG tháng đó, kèm % so với tháng trước VÀ "So
 * sánh năm" (so với 31/12 năm liền trước — cột này tự hiện "—" nếu chưa đủ
 * lịch sử để so, không giả vờ có số liệu không tồn tại). Dòng Nợ xấu LUÔN tô
 * màu đỏ (không đổi theo tỷ lệ nghiêm trọng) — đây là nhãn NHẬN DIỆN chỉ
 * tiêu, không phải màu cảnh báo mức độ.
 */
function monthDetailTableHtml(m, prevMonthOf, yearStartOf) {
  const prev = prevMonthOf(m.yearMonth);
  const yearStart = yearStartOf(m.yearMonth);
  const rows = [
    { label: 'Dư nợ', color: 'var(--color-primary)', value: m.balance, prevV: prev?.balance ?? null, yearStartV: yearStart ? yearStart.balance : null, worse: false },
    { label: 'Nợ xấu', color: 'var(--danger)', value: m.badDebt, extra: formatPercent(m.badDebtRatio), prevV: prev?.badDebt ?? null, yearStartV: yearStart ? yearStart.badDebt : null, worse: true },
    { label: 'Lãi phải thu', color: 'var(--purple)', value: m.interest, prevV: prev?.interest ?? null, yearStartV: yearStart ? yearStart.interest : null, worse: false },
  ];
  const th = 'padding:0 8px 8px 0;text-align:left;font-size:10.5px;color:var(--text-muted);font-weight:600;white-space:nowrap';
  const td = 'padding:10px 8px 10px 0;border-top:1px solid var(--border);white-space:nowrap';
  const bodyRows = rows.map((r) => `
    <tr>
      <td style="${td}font-weight:700;color:${r.color}">${r.label}</td>
      <td style="${td}font-weight:700">${formatCompact(r.value)}${r.extra ? ` <span style="font-weight:400;color:var(--text-muted);font-size:10.5px">(${r.extra})</span>` : ''}</td>
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
          So với đầu năm (${yearStart.label} → ${m.label}):
          Dư nợ ${deltaChip(pct(m.balance, yearStart.balance))} ·
          Nợ xấu ${deltaChip(pct(m.badDebt, yearStart.badDebt), { worse: true })} ·
          Lãi phải thu ${deltaChip(pct(m.interest, yearStart.interest))}
        </td>
      </tr>` : '';
    return `
      <tr data-toggle-yoy="${m.yearMonth}" style="${yearStart ? 'cursor:pointer' : ''}">
        <td style="${td}font-weight:700">${m.label}${m.live ? ' <span style="font-weight:400;color:var(--text-faint)">(đang cập nhật)</span>' : ''}${yearStart ? ' <span style="font-size:9px;color:var(--text-faint)">▾</span>' : ''}</td>
        <td style="${td}">${formatCompact(m.balance)}<br>${deltaChip(pct(m.balance, prev?.balance ?? null))}</td>
        <td style="${td}">${formatCompact(m.badDebt)} <span style="color:var(--text-muted);font-size:10.5px">(${formatPercent(m.badDebtRatio)})</span><br>${deltaChip(pct(m.badDebt, prev?.badDebt ?? null), { worse: true })}</td>
        <td style="${td}">${formatCompact(m.interest)}<br>${deltaChip(pct(m.interest, prev?.interest ?? null))}</td>
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

/** Dãy chip chọn tháng (gộp theo năm) đặt dưới biểu đồ "Biến động hàng tháng" — bấm vào 1 tháng để cập nhật 3 cột + biểu đồ nhóm nợ phía trên, không tải lại trang. */
function monthPickerHtml(months, activeYm) {
  // Chỉ có ĐÚNG 1 tháng thì KHÔNG có gì để "chọn" (dư thừa, chỉ 1 chip) — ẩn
  // hẳn dãy chip, tự hiện lại khi có từ tháng thứ 2 trở lên.
  if (months.length <= 1) return '';
  const byYear = new Map();
  for (const m of months) {
    const y = m.yearMonth.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(m);
  }
  const groups = [...byYear.keys()].sort().map((y) => {
    const chips = byYear.get(y).map((m) => {
      const active = m.yearMonth === activeYm;
      return `<button type="button" data-month-picker="${m.yearMonth}" data-active="${active}" style="flex-shrink:0;padding:6px 12px;border-radius:20px;border:1px solid ${active ? 'var(--color-primary)' : 'var(--border)'};background:${active ? 'var(--color-primary)' : 'var(--surface)'};color:${active ? '#fff' : 'var(--text-muted)'};font-size:12px;font-weight:600;white-space:nowrap">Th${Number(m.yearMonth.slice(5))}</button>`;
    }).join('');
    return `<div class="mb-6"><div style="font-size:11px;color:var(--text-faint);margin-bottom:4px">Năm ${y}</div><div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:2px">${chips}</div></div>`;
  }).join('');
  return `<div class="mt-16">${groups}</div>`;
}

function debtDashboardHtml() {
  const { months, prevMonthOf, yearStartOf } = buildDebtDashboardData();
  const initial = months[months.length - 1];

  return `
    <div class="card card-pad mb-16">
      <h3 style="font-size:13.5px;margin-bottom:10px">Biến động hàng tháng</h3>
      ${monthlyComboChartSvg({ months })}
      ${monthPickerHtml(months, initial.yearMonth)}

      <div class="flex items-center justify-between mb-10 mt-20">
        <h3 style="font-size:13.5px;margin:0">Tổng hợp tăng giảm</h3>
        <div class="flex items-center" style="gap:10px">
          <span id="month-detail-label" style="font-size:12px;color:var(--text-muted);font-weight:600">${initial.label}${initial.live ? ' (đang cập nhật)' : ''}</span>
          <a href="javascript:void(0)" id="btn-monthly-detail" class="link-more">Xem chi tiết</a>
        </div>
      </div>
      <div id="month-detail-slot">${monthDetailTableHtml(initial, prevMonthOf, yearStartOf)}</div>
    </div>
  `;
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
 * "Dư nợ theo nhóm nợ". Luôn tính theo phân loại HIỆN TẠI (thời điểm bấm),
 * dùng TOÀN BỘ hợp đồng của quỹ (không giới hạn theo phạm vi 1 nhân viên) —
 * khớp đúng cách "Dư nợ theo nhóm nợ" đang tổng hợp.
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
 * đều xem được dữ liệu".
 *
 * Đã tích + lưu (hasCollateral=true) trong khi hợp đồng còn dư nợ (>0, tức
 * còn đang ở Nhóm 2-5 vì danh sách này chỉ liệt kê hợp đồng CÒN dư nợ) thì
 * KHÓA checkbox lại — KHÔNG cho bỏ tích nữa, chỉ cho SỬA giá trị — đúng yêu
 * cầu "còn trong nhóm 2 3 4 5 thì vẫn lưu không được xóa dữ liệu TSBĐ trừ
 * khi tất toán" (hợp đồng tất toán thì dư nợ = 0, không còn xuất hiện trong
 * danh sách này nữa nên không cần nút "xóa" riêng).
 */
function tsbdRowHtml(ct, editable) {
  if (!editable) {
    return `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);font-size:11.5px;color:var(--text-muted)">${ct.hasCollateral ? `Có TSBĐ: <b>${formatVND(ct.collateralValue)}</b>` : 'Chưa có TSBĐ'}</div>`;
  }
  const checked = !!ct.hasCollateral;
  const locked = checked && (ct.balance || 0) > 0;
  return `
    <div data-tsbd-wrap="${ct.id}" style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border)">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted)">
        <input type="checkbox" data-tsbd-check="${ct.id}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''} style="width:16px;height:16px;flex-shrink:0">
        <span>Có TSBĐ${locked ? ' <span style="color:var(--text-faint)">(đã lưu, chỉ sửa được giá trị)</span>' : ''}</span>
      </label>
      <input type="number" inputmode="decimal" data-tsbd-value="${ct.id}" placeholder="Giá trị TSBĐ (₫)" value="${checked && ct.collateralValue ? ct.collateralValue : ''}" ${checked ? '' : 'hidden'} style="margin-top:6px;width:100%;padding:7px 9px;border:1px solid var(--border);border-radius:8px;font-size:12.5px">
    </div>`;
}
/** Gắn sự kiện cho ô "Có TSBĐ" + giá trị trong modal (chỉ gọi khi isSuper) — tích thì hiện ô nhập, gõ xong rời khỏi ô (blur) mới lưu (tránh lưu 0 lúc chưa kịp gõ); bỏ tích thì xóa hẳn (chỉ bấm được khi CHƯA khóa — xem tsbdRowHtml()). Lưu xong gọi refreshNhomNoSection() để "Dự phòng cụ thể phải trích" ở ngoài cập nhật ngay. */
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
        if (valueInput) valueInput.hidden = true;
        refreshNhomNoSection();
      } catch (err) {
        alert(err.message);
        cb.checked = true;
        if (valueInput) valueInput.hidden = false;
      }
    });
  });
  sheet.querySelectorAll('[data-tsbd-value]').forEach((input) => {
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('blur', async () => {
      const ctId = input.dataset.tsbdValue;
      const val = Number(input.value) || 0;
      try {
        await S.setContractCollateral(ctId, { hasCollateral: true, collateralValue: val });
        const cb = sheet.querySelector(`[data-tsbd-check="${ctId}"]`);
        const ct = S.getContract(ctId);
        if (cb && ct && (ct.balance || 0) > 0) cb.disabled = true;
        refreshNhomNoSection();
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
