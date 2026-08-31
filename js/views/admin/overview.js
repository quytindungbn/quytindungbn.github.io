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
  // nhật 3 cột số liệu + biểu đồ "Dư nợ theo nhóm nợ" phía trên theo ĐÚNG
  // tháng đó, không tải lại cả trang. Tính lại buildDebtDashboardData() mỗi
  // lần bấm (rẻ, không gọi mạng) để luôn khớp dữ liệu mới nhất đang có.
  if (isSuper) {
    contentEl.querySelectorAll('[data-month-picker]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ym = btn.dataset.monthPicker;
        const { months, prevMonthOf, yearAgoOf } = buildDebtDashboardData();
        const m = months.find((x) => x.yearMonth === ym);
        if (!m) return;
        contentEl.querySelector('#month-detail-slot').innerHTML = monthDetailHtml(m, prevMonthOf, yearAgoOf);
        contentEl.querySelector('#nhom-no-slot').innerHTML = nhomNoHtml(m);
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
 * 3 cột "Dư nợ / Lãi phải thu / Nợ xấu" + biểu đồ "Dư nợ theo nhóm nợ" LUÔN
 * hiện đúng số liệu của 1 THÁNG ĐANG CHỌN (mặc định = tháng mới nhất/đang
 * sống) — bấm 1 chip tháng ở dưới biểu đồ "Biến động hàng tháng" để đổi
 * tháng xem, cập nhật ngay 2 chỗ trên mà không tải lại trang (xem
 * buildDebtDashboardData()/monthDetailHtml()/nhomNoHtml() và handler
 * data-month-picker trong render()) — không còn lặp lại y hệt "Tổng dư nợ"
 * đã có ở 4 ô thống kê phía trên nữa.
 *
 * Biểu đồ "Biến động hàng tháng" GỘP dư nợ + lãi phải thu vào CHUNG 1 khối
 * (monthlyComboChartSvg — xem js/components/charts.js) thay vì 3 biểu đồ
 * đường riêng như bản đầu, luôn vẽ TOÀN BỘ lịch sử (không đổi theo tháng
 * đang chọn). Đọc dữ liệu từ bảng monthly_snapshots — bảng này KHÔNG có sẵn
 * số liệu quá khứ (mỗi lần nhập Excel mới đè lên số liệu cũ, không lưu lịch
 * sử) nên lịch sử chỉ bắt đầu từ lúc tính năng này ra đời. Số liệu tự chốt
 * vào ĐÚNG ngày cuối cùng mỗi tháng (xem send-due-reminders/index.ts);
 * tháng hiện tại (chưa chốt) tự tính "sống" theo dữ liệu hợp đồng đang có,
 * không cần thao tác gì.
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
  /** Tháng liền trước NĂM NAY (so sánh hàng tháng) và đúng tháng này NĂM TRƯỚC (so sánh hàng năm) — tra trực tiếp theo year_month, không giả định mảng liền mạch (có thể thiếu tháng nếu app mới dùng tính năng giữa chừng). */
  function prevMonthOf(ym) {
    const [y, m] = ym.split('-').map(Number);
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return byYearMonth.get(`${py}-${String(pm).padStart(2, '0')}`) || null;
  }
  function yearAgoOf(ym) {
    const [y, m] = ym.split('-').map(Number);
    return byYearMonth.get(`${y - 1}-${String(m).padStart(2, '0')}`) || null;
  }
  // Gắn sẵn % tăng/giảm lãi phải thu so với tháng trước vào TỪNG tháng — để
  // monthlyComboChartSvg() ghi thẳng lên biểu đồ (cột).
  months.forEach((m) => { m.interestMomPct = pct(m.interest, prevMonthOf(m.yearMonth)?.interest ?? null); });

  return { months, prevMonthOf, yearAgoOf };
}

function ratioClassFor(ratio) {
  return ratio >= 5 ? { bg: 'var(--danger-bg)', fg: 'var(--danger)' } : ratio >= 2 ? { bg: 'var(--warning-bg)', fg: 'var(--warning)' } : { bg: 'var(--success-bg)', fg: '#0d6b34' };
}

/** Biểu đồ cột "Dư nợ theo nhóm nợ" của ĐÚNG 1 tháng (m) — dùng lại khi bấm chọn tháng khác trên biểu đồ "Biến động hàng tháng" bên dưới, không cần tải lại trang. */
function nhomNoHtml(m) {
  const barItems = [1, 2, 3, 4, 5].map((g) => ({ label: `Nhóm ${g}`, value: (m.groupBalances && m.groupBalances[g]) || 0, color: GROUP_COLORS[g] }));
  return barChartSvg({ items: barItems });
}

/**
 * 3 cột nhỏ gọn Dư nợ / Lãi phải thu / Nợ xấu của ĐÚNG 1 tháng (m), kèm %
 * tăng/giảm so với tháng trước VÀ so với cùng kỳ năm trước (nếu đã có đủ
 * lịch sử để so — chưa đủ thì tự ẩn dòng "Năm trước", không giả vờ có số
 * liệu không tồn tại).
 */
function monthDetailHtml(m, prevMonthOf, yearAgoOf) {
  const prev = prevMonthOf(m.yearMonth);
  const yearAgo = yearAgoOf(m.yearMonth);
  const ratioClass = ratioClassFor(m.badDebtRatio);
  const trend = (curr, prevV, yearAgoV, opts) => `
    <div style="display:flex;flex-direction:column;gap:2px;margin-top:4px;font-size:10px;color:var(--text-faint)">
      <span>Tháng trước ${deltaChip(pct(curr, prevV), opts)}</span>
      ${yearAgoV != null ? `<span>Năm trước ${deltaChip(pct(curr, yearAgoV), opts)}</span>` : ''}
    </div>`;
  return `
    <div class="stat-tile c-blue">
      <div class="stat-label">Dư nợ</div>
      <div class="stat-value" style="font-size:15px">${formatCompact(m.balance)}</div>
      ${trend(m.balance, prev?.balance ?? null, yearAgo ? yearAgo.balance : null)}
    </div>
    <div class="stat-tile c-purple">
      <div class="stat-label">Lãi phải thu</div>
      <div class="stat-value" style="font-size:15px">${formatCompact(m.interest)}</div>
      ${trend(m.interest, prev?.interest ?? null, yearAgo ? yearAgo.interest : null)}
    </div>
    <div class="stat-tile" style="background:${ratioClass.bg};color:${ratioClass.fg}">
      <div class="stat-label">Nợ xấu</div>
      <div class="stat-value">${formatPercent(m.badDebtRatio)}</div>
      <div style="font-size:10.5px;color:var(--text-muted);margin-top:2px">${formatCompact(m.badDebt)}</div>
      ${trend(m.badDebt, prev?.badDebt ?? null, yearAgo ? yearAgo.badDebt : null, { worse: true })}
    </div>`;
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
  const { months, prevMonthOf, yearAgoOf } = buildDebtDashboardData();
  const initial = months[months.length - 1];

  return `
    <div class="card card-pad mb-16">
      <div class="section-head"><h2>Dư nợ · Lãi phải thu · Nợ xấu (toàn quỹ)</h2></div>

      <div class="flex items-center justify-between mb-10">
        <h3 style="font-size:13.5px;margin:0">Số liệu chi tiết</h3>
        <span id="month-detail-label" style="font-size:12px;color:var(--text-muted);font-weight:600">${initial.label}${initial.live ? ' (đang cập nhật)' : ''}</span>
      </div>
      <div class="grid-3 mb-20" id="month-detail-slot">${monthDetailHtml(initial, prevMonthOf, yearAgoOf)}</div>

      <div class="mb-20">
        <h3 style="font-size:13.5px;margin-bottom:10px">Dư nợ theo nhóm nợ</h3>
        <div id="nhom-no-slot">${nhomNoHtml(initial)}</div>
      </div>

      <h3 style="font-size:13.5px;margin-bottom:10px">Biến động hàng tháng</h3>
      ${monthlyComboChartSvg({ months })}

      ${monthPickerHtml(months, initial.yearMonth)}
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
