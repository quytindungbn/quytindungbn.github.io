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

export function render(contentEl) {
  const session = S.getSession();
  const admin = S.getAdmin(session.id);
  const isStaff = admin.role === 'staff';
  const isSuper = S.isSuperAdmin(session.id);
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

  // Bấm chọn 1 tháng ở dãy chip dưới biểu đồ "Biến động hàng tháng" — cập
  // nhật biểu đồ "Dư nợ theo nhóm nợ" + bảng "Tổng hợp tăng giảm" bên dưới
  // theo ĐÚNG tháng đó, không tải lại cả trang. Tính lại
  // buildDebtDashboardData() mỗi lần bấm (rẻ, không gọi mạng) để luôn khớp
  // dữ liệu mới nhất đang có.
  if (isSuper) {
    bindNhomNoClicks(contentEl, isStaff);
    contentEl.querySelector('#btn-monthly-detail')?.addEventListener('click', openMonthlyDetailModal);
    contentEl.querySelectorAll('[data-month-picker]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ym = btn.dataset.monthPicker;
        const { months, prevMonthOf, yearStartOf } = buildDebtDashboardData();
        const m = months.find((x) => x.yearMonth === ym);
        if (!m) return;
        contentEl.querySelector('#month-detail-slot').innerHTML = monthDetailTableHtml(m, prevMonthOf, yearStartOf);
        contentEl.querySelector('#nhom-no-slot').innerHTML = nhomNoHtml(m);
        contentEl.querySelector('#month-detail-label').textContent = `${m.label}${m.live ? ' (đang cập nhật)' : ''}`;
        bindNhomNoClicks(contentEl, isStaff);
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

/** Gắn click cho mỗi cột/nhãn "Dư nợ theo nhóm nợ" (data-id = số nhóm) — mở danh sách hợp đồng ĐÚNG nhóm đó theo phân loại HIỆN TẠI (thời gian thực, không phải theo tháng đã chốt trong quá khứ — quỹ không lưu lịch sử xếp nhóm theo từng hợp đồng, chỉ lưu tổng dư nợ mỗi nhóm). Gọi lại mỗi lần #nhom-no-slot được vẽ lại (lúc render() đầu tiên VÀ mỗi lần bấm chọn tháng khác). */
function bindNhomNoClicks(contentEl, isStaff) {
  const slot = contentEl.querySelector('#nhom-no-slot');
  if (!slot) return;
  slot.querySelectorAll('[data-id]').forEach((el) => {
    el.addEventListener('click', () => openDebtGroupModal(Number(el.dataset.id), isStaff));
  });
}

/**
 * Dashboard "Dư nợ — Lãi phải thu — Nợ xấu" — CHỈ hiện cho quản trị viên
 * TOÀN QUYỀN (role='super'), dưới 4 ô thống kê chính — tính trên TOÀN BỘ hợp
 * đồng của cả quỹ (không giới hạn theo phạm vi Thôn/Xóm của 1 nhân viên,
 * khác 4 ô phía trên) vì đây là bức tranh CHUNG toàn quỹ dành cho lãnh đạo,
 * giống cách trang "Nhật ký" cũng chỉ dành riêng cho super — xem mục 10.46
 * docs/supabase-migration.md.
 *
 * Nhóm nợ 1-5 theo đúng quy định phân loại nợ NHNN (Thông tư 02/2013):
 * Nhóm 1 = quá hạn 0-10 ngày, Nhóm 2 = 11-90, Nhóm 3 = 91-180, Nhóm 4 =
 * 181-360, Nhóm 5 = trên 360 ngày — "Nợ xấu" CHÍNH THỨC = Nhóm 3+4+5 (không
 * tính Nhóm 2, dù Nhóm 2 đã là "nợ cần chú ý"). "Lãi phải thu" chỉ tính
 * Nhóm 1-4 (Nhóm 5 coi như khó thu, không tính lãi phải thu nữa).
 *
 * Thứ tự trên trang (từ trên xuống): biểu đồ "Dư nợ theo nhóm nợ" (bấm vào 1
 * cột/nhãn để xem danh sách hợp đồng đúng nhóm đó — openDebtGroupModal()) →
 * biểu đồ "Biến động hàng tháng" (LUÔN vẽ TOÀN BỘ lịch sử, không đổi theo
 * tháng đang chọn) → dãy chip chọn Tháng/Năm → bảng "Tổng hợp tăng giảm".
 * "Dư nợ theo nhóm nợ" + bảng LUÔN hiện đúng số liệu của 1 THÁNG ĐANG CHỌN
 * (mặc định = tháng mới nhất/đang sống) — bấm 1 chip tháng để đổi tháng xem,
 * cập nhật ngay 2 chỗ đó mà không tải lại trang (xem
 * buildDebtDashboardData()/monthDetailTableHtml()/nhomNoHtml() và handler
 * data-month-picker trong render()).
 *
 * Biểu đồ "Biến động hàng tháng" (monthlyComboChartSvg — xem
 * js/components/charts.js) mỗi tháng vẽ 1 cặp cột liền nhau, đơn vị TỶ ĐỒNG
 * ghi 1 lần ở đầu: cột Dư nợ (to) LỒNG sẵn đoạn màu cam đè lên ở đỉnh thể
 * hiện Nợ xấu (số tiền ghi ngay trong cột, ở đầu đoạn cam), cột Lãi phải thu
 * (nhỏ hơn) ngay bên cạnh — cả 2 cột phụ co theo ĐÚNG tỷ lệ % của cột Dư nợ
 * tháng đó. Đọc dữ liệu từ bảng monthly_snapshots — bảng này KHÔNG có sẵn số
 * liệu quá khứ (mỗi lần nhập Excel mới đè lên số liệu cũ, không lưu lịch sử)
 * nên lịch sử chỉ bắt đầu từ lúc tính năng này ra đời. Số liệu tự chốt vào
 * ĐÚNG ngày cuối cùng mỗi tháng (xem send-due-reminders/index.ts); tháng
 * hiện tại (chưa chốt) tự tính "sống" theo dữ liệu hợp đồng đang có, không
 * cần thao tác gì.
 *
 * Cột "So sánh năm" ở bảng "Tổng hợp tăng giảm" so với CUỐI KỲ 31/12 năm
 * liền trước (đầu năm), KHÔNG phải cùng tháng năm trước — xem yearStartOf()
 * trong buildDebtDashboardData().
 */
const GROUP_COLORS = { 1: 'var(--success)', 2: 'var(--warning)', 3: '#f0a29c', 4: 'var(--danger)', 5: '#8f231d' };

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
    groupBalances: s.groupBalances,
  }));
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!lastSnapshot || lastSnapshot.yearMonth !== currentYearMonth) {
    months.push({
      yearMonth: currentYearMonth, label: monthLabel(currentYearMonth),
      balance: summary.totalBalance, interest: summary.interestReceivable, badDebt: summary.badDebtBalance, badDebtRatio: summary.badDebtRatio,
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
  /** "So sánh năm" = so với CUỐI KỲ 31/12 năm liền trước (đầu năm nay) đến ĐÚNG tháng đang xem — không phải so với cùng tháng năm trước. */
  function yearStartOf(ym) {
    const [y] = ym.split('-').map(Number);
    return byYearMonth.get(`${y - 1}-12`) || null;
  }
  return { months, prevMonthOf, yearStartOf };
}

/** Biểu đồ cột "Dư nợ theo nhóm nợ" của ĐÚNG 1 tháng (m) — dùng lại khi bấm chọn tháng khác trên biểu đồ "Biến động hàng tháng" bên dưới, không cần tải lại trang. Mỗi cột gắn `id` = số nhóm để render.js bind click mở danh sách hợp đồng đúng nhóm đó. */
function nhomNoHtml(m) {
  const barItems = [1, 2, 3, 4, 5].map((g) => ({ id: g, label: `Nhóm ${g}`, shortLabel: String(g), value: (m.groupBalances && m.groupBalances[g]) || 0, color: GROUP_COLORS[g] }));
  return barChartSvg({ items: barItems });
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
  if (!months.length) return '';
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
      <div class="mb-24">
        <h3 style="font-size:13.5px;margin-bottom:10px">Dư nợ theo nhóm nợ</h3>
        <div id="nhom-no-slot">${nhomNoHtml(initial)}</div>
      </div>

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
function openDebtGroupModal(g, isStaff) {
  const now = new Date();
  const list = S.getState().contracts.filter((ct) => S.debtGroup(ct, now) === g);
  const total = list.reduce((s, ct) => s + (ct.balance || 0), 0);
  const color = GROUP_COLORS[g];
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
        </div>`;
      }).join('') : emptyState({ iconName: 'checkCircle', title: 'Không có hợp đồng nào', message: 'Nhóm này hiện đang trống.' })}
    `,
    onMount(sheet) {
      sheet.querySelectorAll('[data-view-ct]').forEach((row) => {
        row.addEventListener('click', () => {
          const ct = S.getContract(row.dataset.viewCt);
          openContractView(ct.customerId, ct, { readOnly: isStaff });
        });
      });
    },
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
