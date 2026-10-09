import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { emptyState, statusBadge, installmentHintHtml } from '../../components/ui.js';
import { formatVND, formatDate, formatNumber, formatDateTime, initials, colorFor, escapeHtml } from '../../utils.js';
import { readExcelFirstSheet, rowsToTsv, remapReportTemplateRows } from '../../lib/excelLite.js';
import { isSupplementReportRows } from '../../lib/xlsxLite.js';
import { barChartSvg, monthlyTrendLineChartSvg, compositionDonutHtml, BALANCE_TREND_COLOR } from '../../components/charts.js';
import { openContractView, openCustomerDetail } from './customers.js';
import { SPECIFIC_PROVISION_RATE, specificProvisionCalculation } from '../../lib/collateral.js';

const COLLATERAL_NAMES = Object.freeze({
  '01': 'Quyền sử dụng đất chính chủ',
  '02': 'Quyền sử dụng đất bên thứ 3',
  '04': 'Xe ô tô chính chủ',
  '06': 'Sổ tiết kiệm',
});
// Chỉ tồn tại trong phiên trang hiện tại. Mở ứng dụng mới sẽ chọn tháng mới nhất.
let selectedDashboardMonth = null;
export function resetSelection() { selectedDashboardMonth = null; }

function collateralDescription(contract) {
  const name = contract.hasCollateral && COLLATERAL_NAMES[contract.collateralType];
  return name ? `${name}: ${formatVND(contract.collateralValue)}` : 'Không có tài sản bảo đảm';
}

/** "2026-08" -> "Th08/26" — nhãn gọn cho trục ngang biểu đồ theo tháng. */
function monthLabel(yearMonth) {
  const [y, m] = String(yearMonth).split('-');
  return `Th${m}/${y.slice(2)}`;
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
  const attention = contracts
    .filter((c) => Number(c.balance) > 0)
    .map((c) => ({ c, info: S.contractAttentionInfo(c) }));
  const overdue = attention
  .filter((x) => x.info.level === 'qua_han')
  .sort((a, b) => a.info.days - b.info.days)
  .map((x) => x.c);
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
  const dashboardData = buildDebtDashboardData();
  const dashboardMonth = dashboardData.months.find((m) => m.yearMonth === selectedDashboardMonth)
    || dashboardData.months[dashboardData.months.length - 1];

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

    <div id="month-selector-slot" class="card card-pad mb-16 overview-period-picker">${monthSelectorHtml(dashboardData.months, dashboardMonth.yearMonth, isSuper)}</div>

    ${debtDashboardHtml(dashboardData, dashboardMonth)}

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
  bindProvisionDetails(contentEl);
  bindMonthClicks(contentEl);
  bindMonthSelector(contentEl);
  bindCompositionTabs(contentEl);
  scrollTrendChartToEnd(contentEl);
  contentEl.querySelector('#btn-monthly-detail')?.addEventListener('click', openMonthlyDetailModal);
  contentEl.querySelector('#btn-import-historical')?.addEventListener('click', openImportHistoricalModal);
}

/** Làm mới dữ liệu nền mà không đổi tháng hay vị trí biểu đồ đang xem. */
export function refresh(contentEl) {
  const scrollPositions = [...contentEl.querySelectorAll('#trend-chart-slot .trend-scroll')].map((el) => el.scrollLeft);
  render(contentEl);
  contentEl.querySelectorAll('#trend-chart-slot .trend-scroll').forEach((el, index) => {
    if (scrollPositions[index] != null) el.scrollLeft = scrollPositions[index];
  });
}

/**
 * Gắn click cho mỗi cột/nhãn "Dư nợ theo nhóm nợ" (data-id = số nhóm, xem
 * nhomNoBarHtml()) — mở danh sách hợp đồng ĐÚNG nhóm đó theo phân loại
 * HIỆN TẠI (LUÔN tính từ dữ liệu hợp đồng sống, KỂ CẢ khi đang xem lại 1
 * tháng đã chốt trong quá khứ — quỹ chỉ lưu TỔNG theo nhóm lúc chốt, không
 * lưu chi tiết từng hợp đồng nên không tra đúng danh sách CỦA đúng tháng đó
 * được; openDebtGroupModal() tự ghi rõ đây là dữ liệu hiện tại khi mở từ 1
 * tháng không phải tháng sống, tránh hiểu nhầm là khớp đúng số liệu tháng
 * đó). Đọc tháng đang xem qua `data-ym` trên #nhom-no-slot (do
 * debtDashboardHtml()/selectMonth() tự ghi) — gọi lại mỗi lần #nhom-no-slot
 * được vẽ lại (render() đầu VÀ mỗi lần selectMonth() đổi tháng).
 */
function bindNhomNoClicks(root) {
  const slot = root.querySelector('#nhom-no-slot');
  if (!slot) return;
  const { isStaff } = currentRoles();
  const { months } = buildDebtDashboardData();
  const m = months.find((x) => x.yearMonth === slot.dataset.ym) || months[months.length - 1];
  slot.querySelectorAll('[data-id]').forEach((el) => {
    el.addEventListener('click', () => openDebtGroupModal(Number(el.dataset.id), isStaff, m));
  });
}

const GROUP_COLORS = { 1: BALANCE_TREND_COLOR, 2: 'var(--warning)', 3: '#f0a29c', 4: 'var(--danger)', 5: '#8f231d' };

const COMPOSITION_OPTIONS = {
  purpose: {
    label: 'Mục đích vay', field: 'loanPurpose',
    categories: [
      { code: '01', label: 'Vay tiêu dùng', color: '#0f766e' },
      { code: '04', label: 'Vay sản xuất kinh doanh', color: '#2563eb' },
      { code: '052', label: 'Vay nông nghiệp', color: '#e59b16' },
    ],
  },
  term: {
    label: 'Loại vay', field: 'loanTerm',
    categories: [
      { code: 'NH', label: 'Ngắn hạn', color: '#0f766e' },
      { code: 'TH', label: 'Trung hạn', color: '#2563eb' },
    ],
  },
  collateral: {
    label: 'Tài sản bảo đảm', field: 'collateralType',
    categories: [
      { code: '01', label: 'Quyền sử dụng đất chính chủ', color: '#0f766e' },
      { code: '02', label: 'Quyền sử dụng đất bên thứ ba', color: '#2563eb' },
      { code: '04', label: 'Xe ô tô chính chủ', color: '#e59b16' },
      { code: '06', label: 'Sổ tiết kiệm', color: '#8b5cf6' },
      { code: 'KCDB', label: 'Không có tài sản bảo đảm', color: '#e05b50' },
    ],
  },
};
const COMPOSITION_UNKNOWN = { label: 'Khác / chưa xác định', color: '#94a3b8' };
let activeCompositionTab = 'purpose';
let activeCompositionMetric = 'balance';

/** Excel đôi khi chuyển 01 thành số 1; mã kỳ hạn trong file có dạng NH01/TH01. */
function compositionCode(value, tab) {
  const code = String(value ?? '').trim().toUpperCase();
  if (tab === 'term') {
    if (code === 'NH' || code === 'NH01') return 'NH';
    if (code === 'TH' || code === 'TH01') return 'TH';
    return code;
  }
  if (/^\d+$/.test(code)) {
    if (tab === 'purpose' && code === '52') return '052';
    return code.padStart(2, '0');
  }
  return code;
}

function compositionRows(m) {
  return (m.live
    ? visibleContracts().filter((ct) => S.effectiveContractStatus(ct) !== 'da_tat_toan')
    : (Array.isArray(m.contractsDetail) ? m.contractsDetail : []))
    .filter((row) => Number(row.balance) > 0);
}

/** Dùng cùng quy tắc phân loại cho biểu đồ và danh sách khi bấm vào từng mục. */
function compositionBucket(row, tab) {
  const code = compositionCode(row[COMPOSITION_OPTIONS[tab].field], tab);
  if (tab === 'collateral' && !COMPOSITION_OPTIONS.collateral.categories.some((c) => c.code === code)) return 'KCDB';
  return COMPOSITION_OPTIONS[tab].categories.some((c) => c.code === code) ? code : 'unknown';
}

/** Các bản chốt cũ có thể chưa lưu mã phân loại; không suy diễn loại TSBĐ
 * cho phần dư nợ thiếu cả chi tiết hợp đồng. */
function compositionData(m, tab) {
  const option = COMPOSITION_OPTIONS[tab];
  const rows = compositionRows(m);
  const byCode = new Map(option.categories.map((c) => [c.code, { value: 0, count: 0 }]));
  const unknownBucket = { value: 0, count: 0 };
  let detailTotal = 0;
  let totalCount = 0;
  for (const row of rows) {
    const balance = Math.max(0, Number(row.balance) || 0);
    if (!balance) continue;
    detailTotal += balance;
    totalCount += 1;
    const bucket = compositionBucket(row, tab);
    const item = byCode.get(bucket) || unknownBucket;
    item.value += balance;
    item.count += 1;
  }
  // Một số bản lưu cũ chỉ có số tổng, chưa có chi tiết từng hợp đồng.
  const total = Math.max(0, Number(m.balance) || 0, detailTotal);
  const missingBalance = Math.max(0, total - detailTotal);
  unknownBucket.value += missingBalance;
  const countComplete = missingBalance < 1;
  const items = option.categories
    .filter((c) => byCode.get(c.code).value > 0)
    .map((c) => ({ code: c.code, label: c.label, color: c.color, ...byCode.get(c.code) }));
  if (unknownBucket.value > 0 && tab !== 'collateral') items.push({ code: 'unknown', ...COMPOSITION_UNKNOWN, ...unknownBucket, countKnown: !missingBalance });
  return { items, total, totalCount, countComplete };
}

function compositionTabsHtml() {
  return `<div class="composition-tabs" role="tablist" aria-label="Chọn cách phân nhóm khoản vay">
    ${Object.entries(COMPOSITION_OPTIONS).map(([key, option]) => `<button type="button" id="composition-tab-${key}"
      role="tab" aria-controls="composition-slot" aria-selected="${activeCompositionTab === key}"
      tabindex="${activeCompositionTab === key ? '0' : '-1'}" data-composition-tab="${key}"
      class="${activeCompositionTab === key ? 'active' : ''}">${option.label}</button>`).join('')}
  </div>`;
}

function compositionPanelHtml(m) {
  const { items, total, totalCount, countComplete } = compositionData(m, activeCompositionTab);
  const metric = countComplete ? activeCompositionMetric : 'balance';
  return `<div class="composition-total">${monthLabelWithNote(m)} · Tổng dư nợ <strong>${formatVND(total)}</strong>
    · Số món vay <strong>${countComplete ? formatNumber(totalCount) : 'Chưa có dữ liệu'}</strong></div>
    <div class="composition-metrics" role="group" aria-label="Chọn thước đo tỷ trọng">
      <button type="button" data-composition-metric="balance" aria-pressed="${metric === 'balance'}" class="${metric === 'balance' ? 'active' : ''}">Theo dư nợ</button>
      <button type="button" data-composition-metric="count" aria-pressed="${metric === 'count'}" class="${metric === 'count' ? 'active' : ''}" ${countComplete ? '' : 'disabled title="Tháng này chưa lưu đủ chi tiết hợp đồng"'}>Theo số món vay</button>
    </div>
    ${!countComplete ? `<p class="composition-note">${activeCompositionTab === 'collateral'
      ? 'Bản chốt cũ chưa đủ chi tiết hợp đồng để phân loại tài sản bảo đảm. Nạp lại file của tháng này để xem biểu đồ.'
      : 'Bản chốt cũ chưa có đủ chi tiết hợp đồng. Nạp lại file của tháng này để xem số món vay và tỷ trọng theo số món vay.'}</p>` : ''}
    ${activeCompositionTab === 'collateral' && !countComplete
      ? ''
      : compositionDonutHtml({ items, total, totalCount, metric, countComplete, tab: activeCompositionTab })}`;
}

function openCompositionCategoryModal(m, tab, code) {
  const item = compositionData(m, tab).items.find((entry) => entry.code === code);
  if (!item) return;
  const rows = compositionRows(m).filter((row) => compositionBucket(row, tab) === code);
  const { isStaff } = currentRoles();
  const rowHtml = rows.map((row, index) => {
    const customer = m.live ? S.getCustomer(row.customerId) : null;
    const name = m.live ? customer?.name : row.name;
    const address = m.live
      ? ([customer?.xom, customer?.thon, customer?.tinh].filter(Boolean).join(', ') || customer?.address)
      : row.address;
    return `<div class="list-row" ${m.live ? `data-composition-row="${index}" style="cursor:pointer"` : ''}>
      <div class="row-main">
        <div class="row-title">${escapeHtml(name || '—')}</div>
        <div class="row-sub">${row.code ? `HĐTD ${escapeHtml(row.code)} · ` : ''}${escapeHtml(address || 'Chưa có địa bàn')}</div>
      </div>
      <div class="row-end"><b class="amount">${formatVND(Number(row.balance) || 0)}</b></div>
    </div>`;
  }).join('');
  openModal({
    title: item.label,
    bodyHtml: `<div class="text-sm text-muted mb-12">${monthLabelWithNote(m)} · ${formatNumber(rows.length)} món vay · Dư nợ <b>${formatVND(rows.reduce((sum, row) => sum + (Number(row.balance) || 0), 0))}</b></div>
      ${!m.live ? '<p class="text-sm text-muted mb-8">Danh sách đã lưu của tháng này.</p>' : ''}
      ${!m.live && !compositionData(m, tab).countComplete ? '<p class="text-sm mb-8" style="color:var(--warning)">Bản chốt này thiếu chi tiết một số hợp đồng; danh sách chỉ gồm các món vay có chi tiết đã lưu.</p>' : ''}
      ${rowHtml || emptyState({ iconName: 'search', title: 'Chưa có danh sách chi tiết', message: 'Bản chốt cũ chưa lưu chi tiết các món vay thuộc mục này.' })}`,
    onMount(sheet) {
      if (!m.live) return;
      sheet.querySelectorAll('[data-composition-row]').forEach((element) => {
        element.addEventListener('click', () => {
          const contract = rows[Number(element.dataset.compositionRow)];
          if (contract) openContractView(contract.customerId, contract, { readOnly: isStaff });
        });
      });
    },
  });
}

function bindCompositionTabs(root) {
  const tabs = [...root.querySelectorAll('[data-composition-tab]')];
  const activate = (tab, focus = false) => {
    activeCompositionTab = tab.dataset.compositionTab;
    for (const button of tabs) {
      const selected = button === tab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    const { months } = buildDebtDashboardData();
    const ym = root.querySelector('#nhom-no-slot')?.dataset.ym;
    const m = months.find((item) => item.yearMonth === ym) || months[months.length - 1];
    if (m) root.querySelector('#composition-slot').innerHTML = compositionPanelHtml(m);
    root.querySelector('#composition-slot').setAttribute('aria-labelledby', tab.id);
    if (focus) tab.focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (event) => {
      const nextIndex = event.key === 'ArrowRight' ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (nextIndex === null) return;
      event.preventDefault();
      activate(tabs[nextIndex], true);
    });
  });
  root.querySelector('#composition-slot')?.addEventListener('click', (event) => {
    const category = event.target.closest('[data-composition-category]');
    if (category) {
      const { months } = buildDebtDashboardData();
      const ym = root.querySelector('#nhom-no-slot')?.dataset.ym;
      const m = months.find((item) => item.yearMonth === ym) || months[months.length - 1];
      if (m) openCompositionCategoryModal(m, activeCompositionTab, category.dataset.compositionCategory);
      return;
    }
    const button = event.target.closest('[data-composition-metric]');
    if (!button || button.disabled) return;
    activeCompositionMetric = button.dataset.compositionMetric;
    const { months } = buildDebtDashboardData();
    const ym = root.querySelector('#nhom-no-slot')?.dataset.ym;
    const m = months.find((item) => item.yearMonth === ym) || months[months.length - 1];
    if (m) root.querySelector('#composition-slot').innerHTML = compositionPanelHtml(m);
  });
  root.querySelector('#composition-slot')?.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const category = event.target.closest('svg [data-composition-category]');
    if (!category) return;
    event.preventDefault();
    category.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Biểu đồ cột "Dư nợ theo nhóm nợ" của ĐÚNG 1 tháng (m — có thể là tháng đang sống hoặc tháng đã chốt trong quá khứ, xem selectMonth()) — mỗi cột bấm được để mở danh sách hợp đồng, xem bindNhomNoClicks(). */
function nhomNoBarHtml(m) {
  const gb = m.groupBalances || {};
  const barItems = [1, 2, 3, 4, 5].map((g) => ({
    id: g,
    label: `Nhóm ${g}`, shortLabel: String(g), value: gb[g] || 0, color: GROUP_COLORS[g],
  }));
  return barChartSvg({ items: barItems });
}
/**
 * Dự phòng phải trích của ĐÚNG 1 tháng (m, mục 10.52 docs) — tháng ĐANG
 * SỐNG luôn tính lại NGAY BÂY GIỜ (`m.live`, tự cập nhật ngay khi dư nợ/
 * TSBĐ đổi — VD vừa tải file Excel mới, xem selectMonth()/render()); tháng
 * ĐÃ CHỐT dùng ĐÚNG số đã lưu lúc chốt (`captureMonthlySnapshot()` trong
 * send-due-reminders/index.ts) — không tính lại theo TSBĐ/dư nợ HIỆN TẠI
 * nữa, giữ đúng lịch sử của tháng đó. `null` (không phải 0) nếu tháng đó
 * chốt TRƯỚC khi có tính năng lưu Dự phòng, hoặc nạp qua "Nạp dữ liệu cũ"
 * (mẫu Excel đó không có cột TSBĐ nên không tính được).
 */
function provisionForMonth(m) {
  if (m.live) return S.provisionSummary(visibleContracts(), new Date());
  return S.provisionFromSnapshot({ ...m, totalBalance: m.balance })
    || { generalProvision: null, specificProvision: null };
}
/** 2 dòng "Dự phòng chung/cụ thể phải trích" — chỉ chữ, không bỏ trong khung. `null` (xem provisionForMonth()) hiện "—" kèm ghi chú thay vì 0đ dễ hiểu nhầm là ĐÃ tính ra đúng 0. */
function provisionRowsHtml(provision) {
  const val = (n) => (n != null ? formatVND(n) : '<span class="text-muted" style="font-weight:400;font-size:12px">— chưa có dữ liệu</span>');
  return `
    <button type="button" class="provision-row provision-detail-button" id="general-provision-detail" aria-label="Xem cách tính dự phòng chung"><span class="text-sm text-muted">Dự phòng chung phải trích <span aria-hidden="true">›</span></span><b>${val(provision.generalProvision)}</b></button>
    <button type="button" class="provision-row provision-detail-button" id="specific-provision-detail" aria-label="Xem cách tính dự phòng cụ thể từng món vay"><span class="text-sm text-muted">Dự phòng cụ thể phải trích <span aria-hidden="true">›</span></span><b>${val(provision.specificProvision)}</b></button>`;
}

function openGeneralProvisionModal(month) {
  const balances = [1, 2, 3, 4].map((group) => ({ group, balance: Number(month.groupBalances?.[group]) || 0 }));
  const base = balances.reduce((sum, row) => sum + row.balance, 0);
  const calculated = base * S.GENERAL_PROVISION_RATE;
  const stored = provisionForMonth(month).generalProvision;
  openModal({
    title: `Dự phòng chung · ${month.label}`,
    sheetClass: 'provision-detail-sheet',
    bodyHtml: `<p class="text-sm text-muted">${month.live ? 'Dữ liệu hiện tại.' : 'Dữ liệu đã lưu của tháng này.'}</p>
      <div class="provision-loan-grid">${balances.map((row) => `<span>Nhóm nợ ${row.group}</span><b>${formatVND(row.balance)}</b>`).join('')}
        <span>Dư nợ nhóm 1–4</span><b>${formatVND(base)}</b>
        <span>Tỷ lệ</span><b>0,75%</b>
        <span>Phải trích</span><b class="provision-loan-amount">${formatVND(base)} × 0,75% = ${formatVND(calculated)}</b>
      </div>
      ${stored != null && Math.abs(calculated - stored) > 1 ? `<p class="bs-warning">Số tính từ chi tiết ${formatVND(calculated)} khác số đã lưu ${formatVND(stored)}; cần kiểm tra dữ liệu kỳ này.</p>` : ''}`,
  });
}

function openSpecificProvisionModal(month) {
  const stored = provisionForMonth(month).specificProvision;
  const historical = !month.live;
  const source = historical ? month.contractsDetail : visibleContracts().map((ct) => ({
    ...ct, group: S.debtGroup(ct, new Date()),
    name: S.getCustomer(ct.customerId)?.name || ct.name || '—',
  }));
  if (stored == null || !Array.isArray(source) || (historical && !source.length && stored > 0)) {
    openModal({ title: `Dự phòng cụ thể · ${month.label}`, bodyHtml: '<p class="text-muted">Kỳ này chưa lưu chi tiết từng món vay để đối chiếu. Hãy nạp lại dữ liệu của đúng tháng nếu cần xem cách tính.</p>' });
    return;
  }
  const items = source.filter((ct) => Number(ct.balance) > 0 && SPECIFIC_PROVISION_RATE[Number(ct.group)])
    .map((ct) => ({ ct, calc: specificProvisionCalculation(ct, SPECIFIC_PROVISION_RATE[Number(ct.group)]) }))
    .sort((a, b) => b.calc.amount - a.calc.amount);
  const total = items.reduce((sum, item) => sum + item.calc.amount, 0);
  const cards = items.map(({ ct, calc }) => {
    const code = escapeHtml(ct.code || 'Chưa lưu số HĐTD');
    const name = escapeHtml(ct.name || '—');
    const eligible = calc.factor > 0;
    const asset = collateralDescription(ct);
    return `<article class="provision-loan" data-provision-loan>
      <div class="provision-loan-head"><div><strong>${name}</strong><small>HĐTD ${code}</small></div><span>Nhóm ${ct.group} · ${formatPercent(calc.rate * 100)}</span></div>
      <div class="provision-loan-grid"><span>Dư nợ</span><b>${formatVND(calc.balance)}</b><span>TSBĐ</span><b>${asset}</b>${eligible ? `<span>Tỷ lệ khấu trừ</span><b>${formatPercent(calc.factor * 100)}</b><span>Giá trị khấu trừ</span><b>${formatVND(calc.deduction)}</b><span>Cơ sở tính</span><b>max(0; ${formatVND(calc.balance)} − ${formatVND(calc.deduction)}) = ${formatVND(calc.base)}</b>` : ''}<span>Phải trích</span><b class="provision-loan-amount">${formatVND(calc.amount)}</b></div>
    </article>`;
  }).join('');
  openModal({
    title: `Dự phòng cụ thể · ${month.label}`,
    sheetClass: 'provision-detail-sheet',
    bodyHtml: `<div class="provision-summary"><span>${items.length} món vay thuộc nhóm 2–5</span><strong>${formatVND(stored)}</strong></div>
      ${historical ? '<p class="text-sm text-muted">Chi tiết theo dữ liệu đã lưu của tháng này.</p>' : '<p class="text-sm text-muted">Chi tiết tính theo dữ liệu hiện tại.</p>'}
      ${Math.abs(total - stored) > 1 ? `<p class="bs-warning">Tổng chi tiết ${formatVND(total)} khác số đã lưu ${formatVND(stored)}; cần kiểm tra lại dữ liệu của kỳ này.</p>` : ''}
      ${items.length ? `<input class="provision-search" type="search" placeholder="Tìm tên hoặc số HĐTD" aria-label="Tìm món vay trong chi tiết dự phòng"><div class="provision-loan-list">${cards}</div><p class="provision-no-results" hidden>Không tìm thấy món vay phù hợp.</p>` : '<p class="text-muted">Không có món vay nhóm 2–5 cần tính dự phòng cụ thể.</p>'}`,
    onMount(sheet) {
      const input = sheet.querySelector('.provision-search');
      input?.addEventListener('input', () => {
        const query = input.value.trim().toLocaleLowerCase('vi-VN');
        let count = 0;
        sheet.querySelectorAll('[data-provision-loan]').forEach((card) => {
          const matches = card.querySelector('.provision-loan-head').textContent.toLocaleLowerCase('vi-VN').includes(query);
          card.hidden = !matches;
          if (matches) count++;
        });
        sheet.querySelector('.provision-no-results').hidden = count > 0;
      });
    },
  });
}

function bindProvisionDetails(root) {
  const selectedMonth = () => {
    const ym = root.querySelector('#nhom-no-slot')?.dataset.ym;
    return buildDebtDashboardData().months.find((m) => m.yearMonth === ym);
  };
  root.querySelector('#general-provision-detail')?.addEventListener('click', () => {
    const month = selectedMonth();
    if (month) openGeneralProvisionModal(month);
  });
  root.querySelector('#specific-provision-detail')?.addEventListener('click', () => {
    const month = selectedMonth();
    if (month) openSpecificProvisionModal(month);
  });
}
/**
 * Dashboard "Dư nợ theo nhóm nợ" + "Biến động hàng tháng" + "Tổng hợp tăng
 * giảm" — LUÔN hiện cho MỌI quản trị viên (staff lẫn super), dưới 4 ô thống
 * kê chính. "Dự phòng chung/cụ thể phải trích" ĐỔI theo tháng đang xem như
 * mọi mục khác (xem provisionForMonth() ở trên) — tháng sống tính SỐNG, tháng
 * đã chốt dùng đúng số đã lưu lúc chốt.
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
    generalProvision: s.generalProvision, specificProvision: s.specificProvision,
    contractsDetail: s.contractsDetail,
  }));
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!lastSnapshot || lastSnapshot.yearMonth !== currentYearMonth) {
    months.push({
      yearMonth: currentYearMonth, label: monthLabel(currentYearMonth),
      balance: summary.totalBalance, interest: summary.interestReceivable, badDebt: summary.badDebtBalance, badDebtRatio: summary.badDebtRatio,
      interestRatio: interestRatio(summary.interestReceivable, summary.totalBalance),
      groupBalances: summary.groupBalances,
      live: true,
      // Tháng sống LUÔN tính dự phòng SỐNG (xem provisionForMonth()) — 2 field
      // này chỉ dùng cho tháng ĐÃ CHỐT, giữ null ở đây cho rõ không dùng tới.
      generalProvision: null, specificProvision: null,
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
    { label: 'Dư nợ', color: 'var(--color-primary)', value: m.balance, prevV: prev?.balance ?? null, yearStartV: yearStart ? yearStart.balance : null, mode: 'better' },
    { label: 'Nợ xấu', color: 'var(--danger)', value: m.badDebt, extra: formatPercent(m.badDebtRatio), prevV: prev?.badDebt ?? null, yearStartV: yearStart ? yearStart.badDebt : null, mode: 'worse' },
    { label: 'Lãi phải thu', color: 'var(--purple)', value: m.interest, extra: formatPercent(m.interestRatio), prevV: prev?.interest ?? null, yearStartV: yearStart ? yearStart.interest : null, mode: 'better' },
  ];
  const th = 'padding:0 8px 8px 0;text-align:left;font-size:10.5px;color:var(--text-muted);font-weight:600;white-space:nowrap';
  const td = 'padding:10px 8px 10px 0;border-top:1px solid var(--border);white-space:nowrap';
  const bodyRows = rows.map((r) => `
    <tr>
      <td style="${td}font-weight:700;color:${r.color}">${r.label}</td>
      <td style="${td}font-weight:700">${formatVND(r.value)}${r.extra ? ` <span style="font-weight:400;color:var(--text-muted);font-size:10.5px">(${r.extra})</span>` : ''}</td>
      <td style="${td}">${deltaChip(pct(r.value, r.prevV), { mode: r.mode })}</td>
      <td style="${td}">${r.yearStartV != null ? deltaChip(pct(r.value, r.yearStartV), { mode: r.mode }) : '<span style="font-size:10.5px;color:var(--text-faint)">—</span>'}</td>
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
    // 4 ô riêng (KHÔNG colspan) — xếp thẳng hàng đúng dưới 4 cột phía trên
    // (Tháng/Dư nợ/Nợ xấu/Lãi phải thu), thay vì dồn chung 1 dòng chữ như
    // trước — dễ nhìn hơn, theo đúng yêu cầu. "So với đầu năm:" vẫn nằm ở ô
    // đầu dòng (cột "Tháng").
    const yoyTd = 'padding:2px 10px 10px 0;border-bottom:1px solid var(--border);font-size:11px;color:var(--text-muted)';
    const yoyRow = yearStart ? `
      <tr data-yoy-row="${m.yearMonth}" hidden>
        <td style="${yoyTd}">So với đầu năm:</td>
        <td style="${yoyTd}">${deltaChip(pct(m.balance, yearStart.balance), { mode: 'better' })}</td>
        <td style="${yoyTd}">${deltaChip(pct(m.badDebt, yearStart.badDebt), { mode: 'worse' })}</td>
        <td style="${yoyTd}">${deltaChip(pct(m.interest, yearStart.interest), { mode: 'better' })}</td>
      </tr>` : '';
    return `
      <tr data-toggle-yoy="${m.yearMonth}" style="${yearStart ? 'cursor:pointer' : ''}">
        <td style="${td}font-weight:700">${m.label}${m.live ? ' <span style="font-weight:400;color:var(--text-faint)">(đang cập nhật)</span>' : ''}${yearStart ? ' <span style="font-size:9px;color:var(--text-faint)">▾</span>' : ''}</td>
        <td style="${td}">${formatVND(m.balance)}<br>${deltaChip(pct(m.balance, prev?.balance ?? null), { mode: 'better' })}</td>
        <td style="${td}">${formatVND(m.badDebt)} <span style="color:var(--text-muted);font-size:10.5px">(${formatPercent(m.badDebtRatio)})</span><br>${deltaChip(pct(m.badDebt, prev?.badDebt ?? null), { mode: 'worse' })}</td>
        <td style="${td}">${formatVND(m.interest)} <span style="color:var(--text-muted);font-size:10.5px">(${formatPercent(m.interestRatio)})</span><br>${deltaChip(pct(m.interest, prev?.interest ?? null), { mode: 'better' })}</td>
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
 * Nút chọn tháng để xem lại lịch sử, đặt ngay dưới bốn ô tổng quan —
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
    <div class="overview-period-row">
      <div class="overview-period-controls">
        <label for="month-select" style="font-size:12px;color:var(--text-muted);font-weight:600;white-space:nowrap">Kỳ báo cáo tháng</label>
        <select id="month-select" class="pill-select" style="max-width:220px">${options}</select>
      </div>
      ${isSuper ? `<a href="javascript:void(0)" id="btn-import-historical" class="link-more" style="font-size:11.5px">Nạp dữ liệu cũ</a>` : ''}
    </div>`;
}

function debtDashboardHtml({ months, prevMonthOf, yearStartOf }, initial) {
  const provision = provisionForMonth(initial);

  return `
    <div class="card card-pad mb-16">
      <h3 style="font-size:13.5px;margin-bottom:10px">Dư nợ theo nhóm nợ</h3>
      <div id="nhom-no-slot" data-ym="${initial.yearMonth}">${nhomNoBarHtml(initial)}</div>
      <div id="provision-slot" class="mt-16">${provisionRowsHtml(provision)}</div>
      <h3 style="font-size:13.5px;margin-bottom:10px" class="mt-24">Biến động hàng tháng</h3>
      <div id="trend-chart-slot">${monthlyTrendLineChartSvg({ months, selectedYm: initial.yearMonth })}</div>

      <section class="composition-section" aria-labelledby="composition-heading">
        <h3 id="composition-heading" style="font-size:13.5px;margin-bottom:10px">Tỷ trọng dư nợ và số món vay</h3>
        ${compositionTabsHtml()}
        <div id="composition-slot" role="tabpanel" aria-labelledby="composition-tab-${activeCompositionTab}">
          ${compositionPanelHtml(initial)}
        </div>
      </section>

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
/** Gắn sự kiện đổi cho nút chọn tháng dưới bốn ô tổng quan; chọn tháng cũng cập nhật các biểu đồ và chi tiết. */
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
 * Dùng mẫu sao kê có dòng "Đến ngày" hoặc file số 1 kèm ngày chốt do người
 * dùng chọn — đọc + tính tổng NGAY TRONG TRÌNH DUYỆT (KHÔNG đụng gì tới bảng
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
        Dùng mẫu <b>"Sao kê hợp đồng tín dụng"</b> có dòng "Đến ngày DD/MM/YYYY" hoặc <b>file số 1</b>.
        Nếu file không có dòng ngày, chọn ngày chốt bên dưới. <b>Chỉ tính tổng để xem lại lịch sử</b>,
        KHÔNG đụng gì tới danh sách hợp đồng đang dùng hiện tại.
      </p>
      <div class="field">
        <input type="file" id="hist-file-input" accept=".xls,.xlsx"/>
      </div>
      <div class="field mt-8">
        <label for="hist-as-of-date" class="fw-700 text-sm">Ngày chốt trong file (khi file không ghi “Đến ngày”)</label>
        <input type="date" id="hist-as-of-date"/>
      </div>
      <button class="btn btn-primary btn-block mt-8" id="btn-hist-upload" disabled>Đọc file</button>
      <div id="hist-preview"></div>
    `,
    onMount(sheet, closeFn) {
      const fileInput = sheet.querySelector('#hist-file-input');
      const asOfInput = sheet.querySelector('#hist-as-of-date');
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
          if (isSupplementReportRows(rawRows)) throw new Error('File số 2 chỉ bổ sung khế ước và phân kỳ; hãy dùng file số 1 hoặc mẫu sao kê để nạp dữ liệu cũ.');
          const asOfDate = extractReportAsOfDate(rawRows) || asOfInput.value;
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
            <div class="text-sm text-muted mb-4">Nhóm 1: ${formatVND(g[1])} · Nhóm 2: ${formatVND(g[2])} · Nhóm 3: ${formatVND(g[3])} · Nhóm 4: ${formatVND(g[4])} · Nhóm 5: ${formatVND(g[5])}</div>
            <div class="text-sm mb-4">Dự phòng chung <b>${formatVND(preview.generalProvision)}</b> · Dự phòng cụ thể <b>${formatVND(preview.specificProvision)}</b></div>
            <div class="text-sm text-muted mb-8">Số HĐ được áp TSBĐ: ${preview.collateralMatchedCount}; ${preview.collateralUnmatchedCount} hợp đồng còn lại không có tài sản bảo đảm.</div>
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
/** Tự cuộn khối "Biến động hàng tháng" (nếu có cuộn ngang — quá 7 tháng, xem monthlyComboChartSvg()) về SÁT MÉP PHẢI ngay sau khi vẽ — LUÔN thấy đúng tháng MỚI NHẤT trước tiên, không phải kéo từ tháng đầu tiên bên trái mới tới được tháng mới nhất. CHỈ gọi lúc mới vào trang (render() đầu) — bấm chọn 1 tháng khác (selectMonth(), kể cả bấm thẳng vào 1 cột trong biểu đồ) KHÔNG được tự kéo lại về mép phải, giữ nguyên đúng vị trí đang cuộn để không giật ngược ngay dưới ngón tay vừa bấm. */
function scrollTrendChartToEnd(root) {
  root.querySelectorAll('#trend-chart-slot .trend-scroll').forEach((el) => { el.scrollLeft = el.scrollWidth; });
}
/** Chuyển "Dư nợ theo nhóm nợ" + "Dự phòng" + "Tổng hợp tăng giảm" sang đúng tháng `ym` vừa bấm — vẽ lại TOÀN BỘ biểu đồ "Biến động hàng tháng" để tô lại khung mờ + đậm nhãn đúng tháng đang chọn (chart này vẫn luôn vẽ đủ lịch sử, không thu gọn) — GIỮ NGUYÊN vị trí đang cuộn ngang (nếu có), không tự kéo về mép nào cả, xem scrollTrendChartToEnd(). */
function selectMonth(root, ym) {
  const { months, prevMonthOf, yearStartOf } = buildDebtDashboardData();
  const m = months.find((x) => x.yearMonth === ym);
  if (!m) return;
  selectedDashboardMonth = m.yearMonth;
  const nhomNoSlot = root.querySelector('#nhom-no-slot');
  nhomNoSlot.dataset.ym = m.yearMonth;
  nhomNoSlot.innerHTML = nhomNoBarHtml(m);
  root.querySelector('#provision-slot').innerHTML = provisionRowsHtml(provisionForMonth(m));
  root.querySelector('#composition-slot').innerHTML = compositionPanelHtml(m);
  root.querySelector('#month-detail-slot').innerHTML = monthDetailTableHtml(m, prevMonthOf, yearStartOf);
  root.querySelector('#month-detail-label').textContent = monthLabelWithNote(m);
  // Đổi trend-chart-slot.innerHTML sẽ làm mất luôn vị trí cuộn ngang cũ (nếu
  // khối trước đó có cuộn) — LƯU LẠI trước, đặt lại ĐÚNG vị trí đó sau khi
  // vẽ xong, thay vì gọi scrollTrendChartToEnd() (chỉ dùng lúc mới vào trang).
  const oldScrollLeft = [...root.querySelectorAll('#trend-chart-slot .trend-scroll')].map((el) => el.scrollLeft);
  root.querySelector('#trend-chart-slot').innerHTML = monthlyTrendLineChartSvg({ months, selectedYm: ym });
  root.querySelectorAll('#trend-chart-slot .trend-scroll').forEach((el, i) => { el.scrollLeft = oldScrollLeft[i] || 0; });
  const sel = root.querySelector('#month-select');
  if (sel) sel.value = ym;
  bindNhomNoClicks(root);
  bindProvisionDetails(root);
  bindMonthClicks(root);
}

/** % thay đổi so với 1 giá trị trước đó — null nếu chưa có gì để so (chưa đủ lịch sử, hoặc giá trị trước = 0). */
function pct(curr, prevVal) {
  if (prevVal === null || prevVal === undefined || prevVal === 0) return null;
  return ((curr - prevVal) / Math.abs(prevVal)) * 100;
}
/**
 * `mode`: 'better' (tăng = TỐT, tam giác XANH — giảm = ĐỎ; dùng cho Dư nợ/
 * Lãi phải thu, quỹ cho vay ra được nhiều hơn/thu lãi tốt hơn là tín hiệu
 * tốt) | 'worse' (tăng = XẤU, tam giác ĐỎ — giảm = XANH; dùng cho Nợ xấu) |
 * bỏ trống = trung tính (chỉ hiện mũi tên + %, không tô màu phán xét).
 */
function deltaChip(p, { mode = null } = {}) {
  if (p === null) return `<span style="font-size:10.5px;color:var(--text-faint)">—</span>`;
  const flat = Math.abs(p) < 0.05;
  const up = p > 0;
  const isGood = mode === 'better' ? up : mode === 'worse' ? !up : null;
  const color = flat ? 'var(--text-faint)' : isGood === null ? 'var(--text-muted)' : isGood ? 'var(--success)' : 'var(--danger)';
  const arrow = flat ? '·' : up ? '▲' : '▼';
  return `<span style="font-size:10.5px;font-weight:700;color:${color}">${arrow} ${Math.abs(p).toFixed(1).replace('.', ',')}%</span>`;
}

/**
 * Danh sách hợp đồng thuộc ĐÚNG 1 nhóm nợ (1-5, phân loại theo Thông tư
 * 02/2013 — xem S.debtGroup()) — mở khi bấm vào cột/nhãn tương ứng ở biểu đồ
 * "Dư nợ theo nhóm nợ", bấm được ở MỌI tháng (kể cả tháng đã chốt trong quá
 * khứ, xem nhomNoBarHtml()/bindNhomNoClicks()). Luôn tính theo phân loại
 * HIỆN TẠI (thời điểm bấm) — quỹ chỉ lưu TỔNG theo nhóm lúc chốt, không lưu
 * chi tiết từng hợp đồng của đúng tháng đó — nên khi mở từ 1 tháng KHÔNG
 * phải tháng sống (`m.live` false, `m` truyền vào từ bindNhomNoClicks()) tự
 * ghi rõ đây là danh sách HIỆN TẠI, tránh hiểu nhầm khớp đúng số liệu tháng
 * đang xem. Dùng ĐÚNG phạm vi được phép xem của phiên đang đăng nhập
 * (visibleContracts() — super = toàn quỹ, staff = trong Thôn/Xóm được gán).
 */
function openDebtGroupModal(g, isStaff, m) {
  const color = GROUP_COLORS[g];
  // TSBĐ (tài sản bảo đảm) chỉ có ý nghĩa với Nhóm 2-5 (Nhóm 1 = 0% dự phòng
  // cụ thể, xem S.provisionSummary()) — Nhóm 1 giữ đúng danh sách gọn như cũ.
  const showTsbd = g >= 2;
  // Tháng ĐÃ CHỐT và có lưu sẵn chi tiết từng hợp đồng (mục 10.53 docs, chốt
  // từ nay về sau) -> dùng ĐÚNG danh sách CỦA THÁNG ĐÓ (đông cứng theo lúc
  // chốt). Tháng ĐANG SỐNG, hoặc tháng đã chốt TRƯỚC khi có tính năng này
  // (VD tháng 08 chốt bù) -> vẫn phải dùng dữ liệu HIỆN TẠI như trước, có
  // ghi chú rõ khi không phải tháng sống để không hiểu nhầm khớp đúng tháng
  // đang xem.
  const isHistorical = m && !m.live;
  const historicalList = isHistorical && Array.isArray(m.contractsDetail)
    ? m.contractsDetail.filter((d) => d.group === g)
    : null;

  let listHtml, count;
  if (historicalList) {
    const total = historicalList.reduce((s, d) => s + (d.balance || 0), 0);
    count = historicalList.length;
    listHtml = `
      <div class="text-sm text-muted mb-12">Tổng dư nợ (${m.label}): <b style="color:${color}">${formatVND(total)}</b></div>
      ${historicalList.length ? historicalList.map((d) => `
        <div class="list-row" style="flex-direction:column;align-items:stretch;gap:2px">
          <div class="flex items-center gap-6" style="flex-wrap:nowrap">
            <span style="font-size:14px;font-weight:700;line-height:1.8;padding-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">${d.name || '—'}</span>
            <span class="text-sm text-muted" style="flex-shrink:0">${d.daysOverdue > 0 ? `Quá hạn ${d.daysOverdue} ngày` : 'Trong hạn'}</span>
          </div>
          <div class="flex justify-between items-center gap-6" style="flex-wrap:nowrap">
            <span class="row-sub" style="margin-top:0;flex:1;min-width:0">${d.address || 'Chưa có địa bàn'}</span>
            <b style="color:${color};font-size:13px;flex-shrink:0">${formatVND(d.balance)}</b>
          </div>
          ${showTsbd ? `<div class="text-sm text-muted" style="margin-top:2px">${collateralDescription(d)}</div>` : ''}
        </div>`).join('') : emptyState({ iconName: 'checkCircle', title: 'Không có hợp đồng nào', message: 'Nhóm này hiện đang trống.' })}
    `;
  } else {
    const now = new Date();
    const list = visibleContracts().filter((ct) => S.debtGroup(ct, now) === g);
    const total = list.reduce((s, ct) => s + (ct.balance || 0), 0);
    count = list.length;
    listHtml = `
      ${isHistorical ? `<div class="text-sm mb-12" style="color:var(--warning)">Danh sách theo dữ liệu HIỆN TẠI — ${m.label} đã chốt trước đó chỉ lưu số tổng theo nhóm, không lưu chi tiết từng hợp đồng nên không tra đúng danh sách của riêng tháng đó được.</div>` : ''}
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
          ${showTsbd ? tsbdRowHtml(ct) : ''}
        </div>`;
      }).join('') : emptyState({ iconName: 'checkCircle', title: 'Không có hợp đồng nào', message: 'Nhóm này hiện đang trống.' })}
    `;
  }

  openModal({
    title: `Nhóm ${g} (${count})`,
    bodyHtml: listHtml,
    onMount(sheet) {
      if (historicalList) return; // danh sách đông cứng của tháng đã chốt — chỉ xem, không click-through/sửa TSBĐ được.
      sheet.querySelectorAll('[data-view-ct]').forEach((row) => {
        row.addEventListener('click', (e) => {
          const ct = S.getContract(row.dataset.viewCt);
          openContractView(ct.customerId, ct, { readOnly: isStaff });
        });
      });
    },
  });
}

/** TSBĐ chỉ đọc từ cột T/AB của file số 1 hoặc dữ liệu đã chốt. */
function tsbdRowHtml(ct) {
  return `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);font-size:11.5px;color:var(--text-muted)">${collateralDescription(ct)}</div>`;
}

/**
 * Danh sách gọn chỉ gồm các hợp đồng thuộc đúng nhóm (quá hạn / gần đến hạn)
 * — bấm vào PHẦN THÔNG TIN KHÁCH HÀNG (tên/địa chỉ) của 1 dòng để mở thẳng
 * chi tiết KHÁCH HÀNG (openCustomerDetail — y hệt màn "Khách hàng & Hợp
 * đồng", có đủ CCCD/SĐT/mật khẩu/nút thao tác + danh sách MỌI hợp đồng của
 * khách đó, dễ quản lý hơn thay vì chỉ thấy đúng 1 hợp đồng) — riêng ô SỐ
 * TIỀN bên phải vẫn bấm riêng được để mở thẳng chi tiết ĐÚNG hợp đồng đang
 * cảnh báo (openContractView), giống cách tách 2 lớp bấm ở customers.js. Kèm
 * tổng cộng cả nhóm ở đầu danh sách để dễ theo dõi. Số tiền = ĐÚNG số tiền
 * của KỲ đến hạn (nếu cảnh báo đến từ 1 kỳ cụ thể trong phân kỳ trả nợ),
 * KHÔNG phải toàn bộ dư nợ hợp đồng — xem S.contractAttentionInfo().dueAmount.
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
        <div class="list-row" data-view-cust="${ct.customerId}" style="cursor:pointer;flex-direction:column;align-items:stretch;gap:2px">
          <div class="flex items-center gap-6" style="flex-wrap:nowrap">
            <span style="font-size:14px;font-weight:700;line-height:1.8;padding-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">${cust ? cust.name : '—'}</span>
            ${highlight
              ? `<span class="badge ${dueBadgeClass}" style="flex-shrink:0">${dueLabel}</span>`
              : `<span class="text-sm text-muted" style="flex-shrink:0">${dueLabel}</span>`}
          </div>
          <div class="flex justify-between items-center gap-6" style="flex-wrap:nowrap">
            <span class="row-sub" style="margin-top:0;flex:1;min-width:0">${addressLabel}</span>
            <b data-view-contract="${ct.id}" style="color:${colorVar};font-size:13px;flex-shrink:0">${formatVND(info.dueAmount)}</b>
          </div>
          ${installmentHintHtml(ct)}
        </div>`;
      }).join('') : emptyState({ iconName: 'checkCircle', title: 'Không có hợp đồng nào', message: 'Danh sách hiện đang trống.' })}
    `,
    onMount(sheet) {
      // Bấm vào PHẦN THÔNG TIN KHÁCH HÀNG (tên/địa chỉ) mở chi tiết KHÁCH
      // HÀNG (y hệt bấm 1 dòng ở màn "Khách hàng & Hợp đồng") — CHỒNG lên
      // trên (không đóng danh sách này trước), đóng lại là quay về đúng danh
      // sách đang xem, đỡ phải mở lại "Xem tất cả" từ đầu mỗi lần muốn xem
      // khách khác. Bấm riêng vào Ô SỐ TIỀN (data-view-contract, lồng bên
      // trong) thì mở thẳng chi tiết ĐÚNG hợp đồng đang cảnh báo — chặn nổi
      // bọt (stopPropagation) để không mở luôn cả khách hàng cùng lúc.
      sheet.querySelectorAll('[data-view-cust]').forEach((row) => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('[data-view-contract]')) return;
          openCustomerDetail(row.dataset.viewCust, { readOnly: isStaff });
        });
      });
      sheet.querySelectorAll('[data-view-contract]').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const ct = S.getContract(el.dataset.viewContract);
          openContractView(ct.customerId, ct, { readOnly: isStaff });
        });
      });
    },
  });
}
