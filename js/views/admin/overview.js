import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { emptyState, statusBadge, installmentHintHtml, periodStepperHtml, syncPeriodStepper } from '../../components/ui.js';
import { formatVND, formatDate, formatNumber, formatDateTime, initials, colorFor, escapeHtml, compactParts } from '../../utils.js';
import { readExcelFirstSheet, rowsToTsv, remapReportTemplateRows } from '../../lib/excelLite.js';
import { isSupplementReportRows } from '../../lib/xlsxLite.js';
import { monthlyTrendLineChartSvg, compositionDonutHtml } from '../../components/charts.js';
import { openContractView, openCustomerDetail, customerLedgerHtml, bindCustomerLedger } from './customers.js';
import { openDueNotesModal, dueNotesSummary } from './customerNotes.js';
import { SPECIFIC_PROVISION_RATE, specificProvisionCalculation } from '../../lib/collateral.js';
import { icon } from '../../icons.js';

const COLLATERAL_NAMES = Object.freeze({
  '01': 'Quyền sử dụng đất chính chủ',
  '02': 'Quyền sử dụng đất bên thứ 3',
  '04': 'Xe ô tô chính chủ',
  '06': 'Sổ tiết kiệm',
});

let selectedDashboardMonth = null;
export function resetSelection() { selectedDashboardMonth = null; }

function collateralDescription(contract) {
  const name = contract.hasCollateral && COLLATERAL_NAMES[contract.collateralType];
  return name ? `${name}: ${formatVND(contract.collateralValue)}` : 'Không có tài sản bảo đảm';
}

function monthLabel(yearMonth) {
  const [y, m] = String(yearMonth).split('-');
  return `Th${m}/${y.slice(2)}`;
}
function formatPercent(n) {
  return `${n.toFixed(1).replace('.', ',')}%`;
}

function monthLabelWithNote(m) {
  return m.live ? `${m.label} (đang cập nhật)` : m.label;
}

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Tổng quan quản trị' });
}

function currentRoles() {
  const session = S.getSession();
  const admin = S.getAdmin(session.id);
  return { isStaff: admin.role === 'staff', isSuper: S.isSuperAdmin(session.id) };
}

function visibleContracts() {
  const { isStaff } = currentRoles();
  if (!isStaff) return S.getState().contracts;
  const session = S.getSession();
  const admin = S.getAdmin(session.id);
  const customerIds = new Set(S.listCustomers({ adminId: admin.id }).map((c) => c.id));
  return S.getState().contracts.filter((c) => customerIds.has(c.customerId));
}

function computeLiveOverview() {
  const { isStaff } = currentRoles();
  const session = S.getSession();
  const admin = S.getAdmin(session.id);
  const customers = S.listCustomers({ adminId: isStaff ? admin.id : undefined });
  const contracts = visibleContracts();

  const balanceByCustomer = new Map();
  for (const ct of contracts) balanceByCustomer.set(ct.customerId, (balanceByCustomer.get(ct.customerId) || 0) + (ct.balance || 0));
  const activeCustomerCount = customers.filter((c) => (balanceByCustomer.get(c.id) || 0) > 0).length;
  const totalOutstanding = contracts.filter((c) => S.effectiveContractStatus(c) !== 'da_tat_toan').reduce((sum, c) => sum + c.balance, 0);

  const attention = contracts
    .filter((c) => Number(c.balance) > 0)
    .map((c) => ({ c, info: S.contractAttentionInfo(c) }));
  const overdue = attention
    .filter((x) => x.info.level === 'qua_han')
    .sort((a, b) => a.info.days - b.info.days)
    .map((x) => x.c);

  const nearDue = attention.filter((x) => x.info.level === 'gan_den_han' && x.info.days <= S.NEAR_DUE_DAYS).map((x) => x.c);

  const overdueTotal = attention.filter((x) => x.info.level === 'qua_han').reduce((sum, x) => sum + x.info.dueAmount, 0);
  const nearDueTotal = attention.filter((x) => x.info.level === 'gan_den_han' && x.info.days <= S.NEAR_DUE_DAYS).reduce((sum, x) => sum + x.info.dueAmount, 0);

  const upcoming = attention
    .filter((x) => x.info.level === 'gan_den_han')
    .sort((a, b) => a.info.days - b.info.days)
    .map((x) => x.c);
  return {
    isStaff, customers, activeCustomerCount, activeContractCount: contracts.filter((c) => Number(c.balance) > 0).length,
    totalOutstanding, overdue, nearDue, upcoming, overdueTotal, nearDueTotal,
  };
}

function snapshotOverview(m) {
  const rows = Array.isArray(m.contractsDetail) ? m.contractsDetail.filter((d) => Number(d.balance) > 0) : [];
  if (!rows.length && Number(m.balance) > 0) return { hasDetail: false, hasAttention: false };

  const hasAttention = rows.length > 0 && rows.every((d) => Object.prototype.hasOwnProperty.call(d, 'attention'));
  const amountOf = (d) => (hasAttention ? Number(d.attentionAmount) || 0 : Number(d.balance) || 0);
  const overdueRows = hasAttention
    ? rows.filter((d) => d.attention === 'qua_han').sort((a, b) => a.attentionDays - b.attentionDays)
    : rows.filter((d) => Number(d.daysOverdue) > 0).sort((a, b) => a.daysOverdue - b.daysOverdue);

  const upcomingRows = hasAttention ? rows.filter((d) => d.attention === 'gan_den_han').sort((a, b) => a.attentionDays - b.attentionDays) : [];
  const nearRows = upcomingRows.filter((d) => d.attentionDays <= S.NEAR_DUE_DAYS);
  return {
    hasDetail: true,
    hasAttention,
    customers: new Set(rows.map((d) => `${d.name || ''}|${d.address || ''}`)).size,
    contracts: rows.length,
    overdueRows,
    overdueTotal: overdueRows.reduce((sum, d) => sum + amountOf(d), 0),
    upcomingRows,
    nearRows,
    nearTotal: nearRows.reduce((sum, d) => sum + amountOf(d), 0),
    amountOf,
  };
}

function isCurrentMonth(m) {
  const now = new Date();
  return !!m.live || m.yearMonth === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function heroInnerHtml(m, ctx) {
  const { months, prevMonthOf } = ctx.dashboardData;
  const useLive = isCurrentMonth(m);
  const snap = useLive ? null : snapshotOverview(m);
  const balance = useLive ? ctx.live.totalOutstanding : m.balance;
  const prev = prevMonthOf(m.yearMonth);
  const delta = prev && prev.balance > 0 ? ((balance - prev.balance) / prev.balance) * 100 : null;
  const money = compactVnd(balance);
  const interest = compactVnd(m.interest || 0);
  const spark = months.filter((x) => x.yearMonth <= m.yearMonth).slice(-6).map((x) => x.balance);
  const customers = useLive ? formatNumber(ctx.live.activeCustomerCount) : (snap.hasDetail ? formatNumber(snap.customers) : '—');
  const contractCount = useLive ? formatNumber(ctx.live.activeContractCount) : (snap.hasDetail ? formatNumber(snap.contracts) : '—');
  return `
      <span class="lux-eyebrow">Tổng dư nợ${useLive ? '' : ` · ${m.label}`}</span>
      <div class="lux-num">${money.num}<small>${money.unit}</small></div>
      <div class="lux-sub">${delta !== null ? `<span class="lux-delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${formatPercent(Math.abs(delta))} so với tháng trước</span> · ` : ''}lãi phải thu ${interest.num} ${interest.unit.replace(' ₫', '')}</div>
      ${spark.length >= 2 ? `<div class="lux-spark">${sparklineSvg(spark)}</div>` : ''}
      <div class="lux-trio">
        <div><span class="lux-eyebrow">Khách hàng</span><b>${customers}</b></div>
        <div><span class="lux-eyebrow">Hợp đồng</span><b>${contractCount}</b></div>
        <div><span class="lux-eyebrow">Nợ xấu</span><b class="${(m.badDebtRatio || 0) > 0 ? 'bad' : ''}">${formatPercent(m.badDebtRatio || 0)}</b></div>
      </div>`;
}

const ATTN_TITLE = '<h3 class="lux-h lux-attn-title"><span>Cần chú ý</span></h3>';

function notesAttnRowHtml() {
  const n = dueNotesSummary();
  if (!n.count) return '';
  const tone = n.late ? 'red' : 'gold';
  return `<button type="button" class="lux-attn-row" id="tile-notes" data-count="${n.count}">
        <span class="mk ${tone}"></span>
        <span class="t"><b>Nhắc việc đến hạn</b><small>${formatNumber(n.customers)} khách hàng${n.late ? ` · ${formatNumber(n.late)} trễ hạn` : ''}</small></span>
        <span class="v ${tone}">${formatNumber(n.count)}<small>việc</small></span>${LUX_CHEVRON}
      </button>`;
}

function redrawAttention(root) {
  const slot = root.querySelector('#attention-slot');
  if (!slot) return;
  const { months, prevMonthOf, yearStartOf } = buildDebtDashboardData();
  const m = months.find((x) => x.yearMonth === selectedDashboardMonth) || months[months.length - 1];
  const ctx = { live: computeLiveOverview(), dashboardData: { months, prevMonthOf, yearStartOf } };
  slot.innerHTML = attentionInnerHtml(m, ctx);
  bindAttention(root, m, ctx.live);
}

function loadNotesIntoAttention(root) {
  S.loadOpenNotes().then((ok) => {
    const shown = Number(root.querySelector('#tile-notes')?.dataset.count || 0);
    if (ok && root.isConnected && dueNotesSummary().count !== shown) redrawAttention(root);
  });
}

function attentionInnerHtml(m, ctx) {
  if (isCurrentMonth(m)) {
    const L = ctx.live;
    const overdueMoney = compactVnd(L.overdueTotal);
    const nearDueMoney = compactVnd(L.nearDueTotal);
    return `${ATTN_TITLE}${notesAttnRowHtml()}
      <button type="button" class="lux-attn-row" id="tile-overdue">
        <span class="mk red"></span>
        <span class="t"><b>Hợp đồng quá hạn</b><small>${formatNumber(L.overdue.length)} hợp đồng</small></span>
        <span class="v red">${overdueMoney.num}<small>${overdueMoney.unit}</small></span>${LUX_CHEVRON}
      </button>
      <button type="button" class="lux-attn-row" id="tile-neardue">
        <span class="mk gold"></span>
        <span class="t"><b>Gần đến hạn</b><small>${formatNumber(L.nearDue.length)} hợp đồng</small></span>
        <span class="v gold">${nearDueMoney.num}<small>${nearDueMoney.unit}</small></span>${LUX_CHEVRON}
      </button>`;
  }
  const snap = snapshotOverview(m);
  const overdueMoney = compactVnd(snap.hasDetail ? snap.overdueTotal : 0);
  const nearMoney = compactVnd(snap.hasAttention ? snap.nearTotal : 0);
  return `${ATTN_TITLE}
      ${snap.hasDetail ? `<button type="button" class="lux-attn-row" id="tile-overdue">
        <span class="mk red"></span>
        <span class="t"><b>Hợp đồng quá hạn</b><small>${formatNumber(snap.overdueRows.length)} hợp đồng · tại ${m.label}</small></span>
        <span class="v red">${overdueMoney.num}<small>${overdueMoney.unit}</small></span>${LUX_CHEVRON}
      </button>` : `<div class="lux-attn-row is-static">
        <span class="mk red"></span>
        <span class="t"><b>Hợp đồng quá hạn</b><small>${m.label} chưa lưu chi tiết hợp đồng</small></span>
        <span class="v red">—</span>
      </div>`}
      ${snap.hasAttention ? `<button type="button" class="lux-attn-row" id="tile-neardue">
        <span class="mk gold"></span>
        <span class="t"><b>Gần đến hạn</b><small>${formatNumber(snap.nearRows.length)} hợp đồng · tại ${m.label}</small></span>
        <span class="v gold">${nearMoney.num}<small>${nearMoney.unit}</small></span>${LUX_CHEVRON}
      </button>` : `<div class="lux-attn-row is-static">
        <span class="mk gold"></span>
        <span class="t"><b>Gần đến hạn</b><small>${m.label} chốt trước khi lưu ngày đến hạn nên không tính lại được</small></span>
        <span class="v gold">—</span>
      </div>`}`;
}

function bindAttention(root, m, live) {
  const { isStaff } = currentRoles();
  const useLive = isCurrentMonth(m);
  root.querySelector('#tile-notes')?.addEventListener('click', () => openDueNotesModal({
    onOpenCustomer: (id) => openCustomerDetail(id, { readOnly: isStaff }),
    onChange: () => redrawAttention(root),
  }));
  root.querySelector('#tile-overdue')?.addEventListener('click', () => {
    if (useLive) openContractListModal('Hợp đồng quá hạn', live.overdue, isStaff, 'var(--danger)');
    else openSnapshotAttentionModal(m, 'qua_han');
  });
  root.querySelector('#tile-neardue')?.addEventListener('click', () => {
    if (useLive) openContractListModal('Gần đến hạn', live.upcoming, isStaff, 'var(--warning)');
    else openSnapshotAttentionModal(m, 'gan_den_han');
  });
}

function openSnapshotAttentionModal(m, kind) {
  const snap = snapshotOverview(m);
  const overdue = kind === 'qua_han';
  const rows = overdue ? snap.overdueRows : snap.upcomingRows;
  const total = rows.reduce((sum, d) => sum + snap.amountOf(d), 0);
  const title = overdue ? 'Hợp đồng quá hạn' : 'Gần đến hạn';
  const color = overdue ? 'var(--danger)' : 'var(--warning)';
  const dayText = (d) => {
    if (snap.hasAttention) return overdue ? `Quá hạn ${d.attentionDays} ngày` : (d.attentionDays === 0 ? 'Đến hạn hôm nay' : `Còn ${d.attentionDays} ngày`);
    return `Quá hạn ${d.daysOverdue} ngày`;
  };
  openModal({
    title: `${title} · ${m.label} (${rows.length})`,
    bodyHtml: `
      <div class="text-sm text-muted mb-12">Số liệu đã chốt của ${m.label} · Tổng tiền ${overdue ? 'quá hạn' : 'đến hạn'}: <b style="color:${color}">${formatVND(total)}</b></div>
      ${rows.length ? rows.map((d) => `
        <div class="list-row" style="flex-direction:column;align-items:stretch;gap:2px">
          <div class="flex items-center gap-6" style="flex-wrap:nowrap">
            <span style="font-size:14px;font-weight:700;line-height:1.8;padding-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">${d.name || '—'}</span>
            <span class="text-sm" style="flex-shrink:0;color:${color}">${dayText(d)}</span>
          </div>
          <div class="flex justify-between items-center gap-6" style="flex-wrap:nowrap">
            <span class="row-sub" style="margin-top:0;flex:1;min-width:0">${d.code ? `HĐTD ${d.code} · ` : ''}${d.address || 'Chưa có địa bàn'}</span>
            <b style="color:${color};font-size:13px;flex-shrink:0">${formatVND(snap.amountOf(d))}</b>
          </div>
        </div>`).join('') : emptyState({ iconName: 'checkCircle', title: 'Không có hợp đồng nào', message: `${m.label} không có hợp đồng ${overdue ? 'quá hạn' : 'gần đến hạn'}.` })}`,
  });
}

export function render(contentEl) {
  const { isStaff, isSuper } = currentRoles();
  const session = S.getSession();
  const admin = S.getAdmin(session.id);
  const customers = S.listCustomers({ adminId: isStaff ? admin.id : undefined });
  const customerIds = new Set(customers.map((c) => c.id));

  const requests = S.listRequests({}).filter((r) => (!isStaff || customerIds.has(r.customerId)) && r.status !== 'da_lien_he');
  const dashboardData = buildDebtDashboardData();
  const dashboardMonth = dashboardData.months.find((m) => m.yearMonth === selectedDashboardMonth)
    || dashboardData.months[dashboardData.months.length - 1];
  const ctx = { live: computeLiveOverview(), dashboardData };

  contentEl.innerHTML = `
    <div id="month-selector-slot" class="lux-period overview-period-picker">${monthSelectorHtml(dashboardData.months, dashboardMonth.yearMonth, isSuper)}</div>
    <div class="lux-root">

    <section class="lux-hero lux-c-hero" id="hero-slot" aria-label="Tổng dư nợ">${heroInnerHtml(dashboardMonth, ctx)}
    </section>

    <h3 class="lux-h lux-h--plain lux-c-attn-h"><span>Cần chú ý</span></h3>
    <div class="lux-card lux-attn lux-c-attn" id="attention-slot">${attentionInnerHtml(dashboardMonth, ctx)}
    </div>

    ${debtDashboardHtml(dashboardData, dashboardMonth)}

    <section class="lux-card lux-c-req">
      <h3 class="lux-h"><span>Yêu cầu mới nhất</span><a href="#/admin/ho-tro?tab=requests" class="lux-link">Xem tất cả</a></h3>
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
    </section>
    </div>
  `;

  bindAttention(contentEl, dashboardMonth, ctx.live);
  loadNotesIntoAttention(contentEl);

  bindNhomNoClicks(contentEl);
  bindProvisionDetails(contentEl);
  bindMonthClicks(contentEl);
  bindMonthSelector(contentEl);
  bindCompositionTabs(contentEl);
  scrollTrendChartToEnd(contentEl);
  contentEl.querySelector('#btn-monthly-detail')?.addEventListener('click', openMonthlyDetailModal);
  contentEl.querySelector('#btn-import-historical')?.addEventListener('click', openImportHistoricalModal);
}

export function refresh(contentEl) {
  const scrollPositions = [...contentEl.querySelectorAll('#trend-chart-slot .trend-scroll')].map((el) => el.scrollLeft);
  render(contentEl);
  contentEl.querySelectorAll('#trend-chart-slot .trend-scroll').forEach((el, index) => {
    if (scrollPositions[index] != null) el.scrollLeft = scrollPositions[index];
  });
}

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

const GROUP_COLORS = { 1: '#0c4a3f', 2: '#b08d3c', 3: '#d49a8a', 4: '#a8402f', 5: '#5e1717' };

const GROUP_NAMES = { 1: 'Đủ tiêu chuẩn', 2: 'Cần chú ý', 3: 'Dưới tiêu chuẩn', 4: 'Nghi ngờ', 5: 'Có khả năng mất vốn' };

function compactVnd(n) { return compactParts(n); }

function sparklineSvg(values) {
  const w = 340, h = 52;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i * (w - 10)) / (values.length - 1) + 5, h - 6 - ((v - min) / span) * (h - 14)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="lux-spark-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0c4a3f" stop-opacity=".28"/><stop offset="1" stop-color="#0c4a3f" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${w - 5} ${h} L5 ${h} Z" fill="url(#lux-spark-fill)"/>
    <path d="${d}" fill="none" stroke="#0c4a3f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <path d="M${last[0].toFixed(1)} ${last[1].toFixed(1)}h0" stroke="#fffdf8" stroke-width="12" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <path d="M${last[0].toFixed(1)} ${last[1].toFixed(1)}h0" stroke="#b08d3c" stroke-width="8.5" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}
const LUX_CHEVRON = '<svg class="lux-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

const COMPOSITION_OPTIONS = {
  purpose: {
    label: 'Mục đích vay', field: 'loanPurpose',
    categories: [
      { code: '01', label: 'Vay tiêu dùng', color: '#0c4a3f' },
      { code: '04', label: 'Vay sản xuất kinh doanh', color: '#b08d3c' },
      { code: '052', label: 'Vay nông nghiệp', color: '#7fa597' },
    ],
  },
  term: {
    label: 'Loại vay', field: 'loanTerm',
    categories: [
      { code: 'NH', label: 'Ngắn hạn', color: '#0c4a3f' },
      { code: 'TH', label: 'Trung hạn', color: '#b08d3c' },
    ],
  },
  collateral: {
    label: 'Tài sản bảo đảm', field: 'collateralType',
    categories: [
      { code: '01', label: 'Quyền sử dụng đất chính chủ', color: '#0c4a3f' },
      { code: '02', label: 'Quyền sử dụng đất bên thứ ba', color: '#b08d3c' },
      { code: '04', label: 'Xe ô tô chính chủ', color: '#7fa597' },
      { code: '06', label: 'Sổ tiết kiệm', color: '#8a7a9e' },
      { code: 'KCDB', label: 'Không có tài sản bảo đảm', color: '#a8402f' },
    ],
  },
};
const COMPOSITION_UNKNOWN = { label: 'Khác / chưa xác định', color: '#cbbf9d' };
let activeCompositionTab = 'purpose';
let activeCompositionMetric = 'balance';

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

function compositionBucket(row, tab) {
  const code = compositionCode(row[COMPOSITION_OPTIONS[tab].field], tab);
  if (tab === 'collateral' && !COMPOSITION_OPTIONS.collateral.categories.some((c) => c.code === code)) return 'KCDB';
  return COMPOSITION_OPTIONS[tab].categories.some((c) => c.code === code) ? code : 'unknown';
}

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

function nhomNoBarHtml(m) {
  const gb = m.groupBalances || {};
  const groups = [1, 2, 3, 4, 5];
  const total = groups.reduce((sum, g) => sum + (gb[g] || 0), 0);
  const share = (g) => (total > 0 ? ((gb[g] || 0) / total) * 100 : 0);

  const segments = groups.filter((g) => (gb[g] || 0) > 0).map((g) => `<button type="button" class="lux-seg" data-id="${g}" aria-label="Nhóm ${g}: ${formatVND(gb[g])}" style="flex:${Math.max(share(g), 1.5).toFixed(2)};background:${GROUP_COLORS[g]}"></button>`).join('');
  const rows = groups.map((g) => {
    const money = compactVnd(gb[g] || 0);
    return `<button type="button" class="lux-leg" data-id="${g}">
      <i style="background:${GROUP_COLORS[g]}"></i>
      <span class="t"><b>Nhóm ${g}</b><small>${GROUP_NAMES[g]}</small></span>
      <span class="v"><b>${money.num}<small>${money.unit}</small></b><small>${formatPercent(share(g))}</small></span>
    </button>`;
  }).join('');
  return `<div class="lux-bad-row"><span class="lux-bad-tag${(m.badDebtRatio || 0) > 0 ? '' : ' zero'}">Nợ xấu ${formatPercent(m.badDebtRatio || 0)}</span></div>
    ${total > 0 ? `<div class="lux-stack">${segments}</div>` : ''}
    <div class="lux-legs">${rows}</div>`;
}

function provisionForMonth(m) {
  if (m.live) return S.provisionSummary(visibleContracts(), new Date());
  return S.provisionFromSnapshot({ ...m, totalBalance: m.balance })
    || { generalProvision: null, specificProvision: null };
}

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

function buildDebtDashboardData() {
  const now = new Date();
  const contracts = S.getState().contracts;
  const summary = S.debtGroupSummary(contracts, now);
  const snapshots = S.listMonthlySnapshots();
  const lastSnapshot = snapshots.length ? snapshots[snapshots.length - 1] : null;

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

      generalProvision: null, specificProvision: null,
    });
  }
  months.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const byYearMonth = new Map(months.map((m) => [m.yearMonth, m]));

  function prevMonthOf(ym) {
    const [y, m] = ym.split('-').map(Number);
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return byYearMonth.get(`${py}-${String(pm).padStart(2, '0')}`) || null;
  }

  function yearStartOf(ym) {
    const [y] = ym.split('-').map(Number);
    const exact = byYearMonth.get(`${y - 1}-12`);
    if (exact) return exact;
    const earliest = months[0];
    return earliest && earliest.yearMonth < ym ? earliest : null;
  }
  return { months, prevMonthOf, yearStartOf };
}

function monthDetailTableHtml(m, prevMonthOf, yearStartOf, months = []) {

  return `<div class="lux-diff-desktop">${monthDetailCardsHtml(m, prevMonthOf, yearStartOf, months)}</div><div class="lux-diff-mobile">${monthDetailMobileHtml(m, prevMonthOf, yearStartOf)}</div>`;
}

function monthDetailCardsHtml(m, prevMonthOf, yearStartOf, months = []) {
  const prev = prevMonthOf(m.yearMonth);
  const yearStart = yearStartOf(m.yearMonth);

  const at = months.findIndex((x) => x.yearMonth === m.yearMonth);
  const trail = at >= 0 ? months.slice(Math.max(0, at - 5), at + 1) : [m];
  const items = [
    { key: 'balance', label: 'Dư nợ', tone: 'green', mode: 'better' },
    { key: 'badDebt', label: 'Nợ xấu', tone: 'red', mode: 'worse', ratio: m.badDebtRatio },
    { key: 'interest', label: 'Lãi phải thu', tone: 'gold', mode: 'better', ratio: m.interestRatio },
  ];
  return `<div class="lux-kpis">${items.map((it) => {
    const value = Number(m[it.key]) || 0;
    return `
      <article class="lux-kpi lux-kpi--${it.tone}">
        <header class="lux-kpi-head"><span class="lux-kpi-name">${it.label}</span>${it.ratio != null ? `<span class="lux-kpi-ratio">${formatPercent(it.ratio)} dư nợ</span>` : ''}</header>
        <div class="lux-kpi-val">${formatNumber(value)}<small>đồng</small></div>
        ${kpiSparkHtml(trail, it.key)}
        <div class="lux-kpi-cmp">
          ${kpiCompareHtml('So tháng trước', value, prev ? Number(prev[it.key]) : null, it.mode)}
          ${kpiCompareHtml('So đầu năm', value, yearStart ? Number(yearStart[it.key]) : null, it.mode)}
        </div>
      </article>`;
  }).join('')}</div>`;
}

function monthDetailMobileHtml(m, prevMonthOf, yearStartOf) {
  const prev = prevMonthOf(m.yearMonth);
  const yearStart = yearStartOf(m.yearMonth);
  const rows = [
    { label: 'Dư nợ', color: '#0c4a3f', value: m.balance, prevV: prev?.balance ?? null, yearStartV: yearStart ? yearStart.balance : null, mode: 'better' },
    { label: 'Nợ xấu', color: '#a8402f', value: m.badDebt, extra: formatPercent(m.badDebtRatio), prevV: prev?.badDebt ?? null, yearStartV: yearStart ? yearStart.badDebt : null, mode: 'worse' },
    { label: 'Lãi phải thu', color: '#8a6a22', value: m.interest, extra: formatPercent(m.interestRatio), prevV: prev?.interest ?? null, yearStartV: yearStart ? yearStart.interest : null, mode: 'better' },
  ];

  const bodyRows = rows.map((r) => `
    <tr>
      <td class="ld-name" style="color:${r.color}">${r.label}</td>
      <td class="ld-amt">${formatVND(r.value)}${r.extra ? `<span class="ld-ratio">(${r.extra})</span>` : ''}</td>
      <td class="ld-chip">${deltaChip(pct(r.value, r.prevV), { mode: r.mode })}</td>
      <td class="ld-chip">${r.yearStartV != null ? deltaChip(pct(r.value, r.yearStartV), { mode: r.mode }) : '<span style="font-size:10.5px;color:var(--text-faint)">—</span>'}</td>
    </tr>`).join('');
  return `
    <div class="ld-wrap">
      <table class="ld-table">
        <thead><tr>
          <th>Chỉ tiêu</th>
          <th>Số dư</th>
          <th>+/- tháng</th>
          <th>+/- năm</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}

function kpiSparkHtml(trail, key) {
  const pts = trail.map((t) => Number(t[key]) || 0);
  if (pts.length < 2) return '<div class="lux-kpi-spark is-empty"></div>';
  const w = 200, h = 56;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const xy = pts.map((v, i) => [(i * (w - 12)) / (pts.length - 1) + 6, max === min ? h / 2 : h - 8 - ((v - min) / span) * (h - 18)]);
  const d = xy.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = xy[xy.length - 1];
  const fill = `lux-kpi-fill-${key}`;
  const label = (t) => `${t.yearMonth.slice(5, 7)}/${t.yearMonth.slice(2, 4)}`;
  return `<div class="lux-kpi-spark">
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${fill}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:var(--k);stop-opacity:.22"/><stop offset="1" style="stop-color:var(--k);stop-opacity:0"/></linearGradient></defs>
      <path d="${d} L${w - 6} ${h} L6 ${h} Z" fill="url(#${fill})"/>
      <path d="${d}" class="ln" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      ${xy.slice(0, -1).map((p) => `<path d="M${p[0].toFixed(1)} ${p[1].toFixed(1)}h0" class="pt" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`).join('')}
      <path d="M${last[0].toFixed(1)} ${last[1].toFixed(1)}h0" stroke="#fff" stroke-width="13" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <path d="M${last[0].toFixed(1)} ${last[1].toFixed(1)}h0" class="pt" stroke-width="9" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="lux-kpi-axis"><span>${label(trail[0])}</span><span>${label(trail.at(-1))}</span></div>
  </div>`;
}

function kpiCompareHtml(label, value, base, mode) {
  if (base === null || base === undefined || Number.isNaN(base)) {
    return `<div class="lux-cmp"><span class="lux-cmp-l">${label}</span><span class="lux-cmp-na">Chưa có số liệu</span></div>`;
  }
  const diff = value - base;
  const p = pct(value, base);
  const flat = p === null ? diff === 0 : Math.abs(p) < 0.05;
  const up = diff > 0;
  const good = mode === 'better' ? up : !up;
  const tone = flat ? 'flat' : good ? 'good' : 'bad';
  const arrow = flat ? '·' : up ? '▲' : '▼';
  const amt = compactParts(Math.abs(diff));
  const amount = flat ? 'Không đổi' : `${up ? '+' : '-'}${amt.num} ${amt.unit.replace(/ đ$/, '<span class="lux-cmp-d"> đ</span>')}`;
  return `<div class="lux-cmp"><span class="lux-cmp-l">${label}</span><span class="lux-pill ${tone}">${arrow} ${p === null ? '—' : `${Math.abs(p).toFixed(1).replace('.', ',')}%`}</span><span class="lux-cmp-amt">${amount}</span></div>`;
}

const DETAIL_METRICS = [
  { key: 'balance', label: 'Dư nợ', tone: 'green', mode: 'better' },
  { key: 'badDebt', label: 'Nợ xấu', tone: 'red', mode: 'worse', ratioKey: 'badDebtRatio' },
  { key: 'interest', label: 'Lãi phải thu', tone: 'gold', mode: 'better', ratioKey: 'interestRatio' },
];

function monthlyDetailPanelHtml(metric, months, prevMonthOf, yearStartOf) {
  const rows = [...months].reverse().map((x) => {
    const value = Number(x[metric.key]) || 0;
    const prev = prevMonthOf(x.yearMonth);
    const yearStart = yearStartOf(x.yearMonth);
    const big = compactParts(value);
    return `<div class="mdl-row">
      <div class="mdl-m"><b><span class="mdl-t">Tháng </span>${x.yearMonth.slice(5, 7)}/${x.yearMonth.slice(0, 4)}</b>${x.live ? '<small>đang cập nhật</small>' : ''}</div>
      <div class="mdl-v"><b>${big.num}</b> <span class="mdl-u">${big.unit}</span>${metric.ratioKey ? `<small>${formatPercent(x[metric.ratioKey])} dư nợ</small>` : ''}</div>
      ${kpiCompareHtml('So tháng trước', value, prev ? Number(prev[metric.key]) : null, metric.mode)}
      ${kpiCompareHtml('So đầu năm', value, yearStart ? Number(yearStart[metric.key]) : null, metric.mode)}
    </div>`;
  }).join('');
  return `
    <div class="mdl-list">
      <div class="mdl-head"><span>Tháng</span><span>Số dư</span><span>So tháng trước</span><span>So đầu năm</span></div>
      ${rows}
    </div>`;
}

function openMonthlyDetailModal() {
  const { months, prevMonthOf, yearStartOf } = buildDebtDashboardData();
  openModal({
    title: 'Chi tiết theo từng tháng',
    sheetClass: 'month-detail-sheet',
    bodyHtml: `
      <div class="mdl-tabs" role="tablist" aria-label="Chọn chỉ tiêu">${DETAIL_METRICS.map((mt, i) => `<button type="button" role="tab" class="mdl-tab mdl-tab--${mt.tone}" data-metric="${i}" aria-selected="${i === 0}">${mt.label}</button>`).join('')}</div>
      <div id="mdl-panel" class="mdl-panel mdl-panel--${DETAIL_METRICS[0].tone}">${monthlyDetailPanelHtml(DETAIL_METRICS[0], months, prevMonthOf, yearStartOf)}</div>`,
    onMount(sheet) {
      const panel = sheet.querySelector('#mdl-panel');
      sheet.querySelectorAll('.mdl-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          const metric = DETAIL_METRICS[Number(tab.dataset.metric)];
          sheet.querySelectorAll('.mdl-tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
          panel.className = `mdl-panel mdl-panel--${metric.tone}`;
          panel.innerHTML = monthlyDetailPanelHtml(metric, months, prevMonthOf, yearStartOf);
        });
      });
    },
  });
}

function monthSelectorHtml(months, selectedYm, isSuper) {
  const ascending = months;
  const options = months
    .slice()
    .reverse()
    .map((m) => `<option value="${m.yearMonth}" ${m.yearMonth === selectedYm ? 'selected' : ''}>${monthLabelWithNote(m)}</option>`)
    .join('');
  return `
    <div class="overview-period-row">
      <div class="overview-period-controls">
        <label for="month-select" class="lux-eyebrow">Kỳ báo cáo tháng</label>
        <select id="month-select" class="lux-select">${options}</select>
        ${periodStepperHtml({ canPrev: ascending.findIndex((m) => m.yearMonth === selectedYm) > 0, canNext: ascending.findIndex((m) => m.yearMonth === selectedYm) < ascending.length - 1 })}
      </div>
      ${isSuper ? `<button type="button" id="btn-import-historical" class="lux-icon-btn" title="Nạp dữ liệu cũ" aria-label="Nạp dữ liệu cũ">${icon('upload')}</button>` : ''}
    </div>`;
}

function debtDashboardHtml({ months, prevMonthOf, yearStartOf }, initial) {
  const provision = provisionForMonth(initial);

  return `
    <section class="lux-card lux-c-nhom">
      <h3 class="lux-h"><span>Dư nợ theo nhóm nợ</span></h3>
      <div id="nhom-no-slot" data-ym="${initial.yearMonth}">${nhomNoBarHtml(initial)}</div>
    </section>

    <section class="lux-card lux-c-prov">
      <h3 class="lux-h"><span>Dự phòng rủi ro</span></h3>
      <div id="provision-slot">${provisionRowsHtml(provision)}</div>
    </section>

    <section class="lux-card lux-c-trend">
      <h3 class="lux-h"><span>Biến động hàng tháng</span></h3>
      <div id="trend-chart-slot">${monthlyTrendLineChartSvg({ months, selectedYm: initial.yearMonth })}</div>
    </section>

    <section class="lux-card lux-c-comp composition-section" aria-labelledby="composition-heading">
      <h3 class="lux-h" id="composition-heading"><span>Tỷ trọng dư nợ và số món vay</span></h3>
      ${compositionTabsHtml()}
      <div id="composition-slot" role="tabpanel" aria-labelledby="composition-tab-${activeCompositionTab}">
        ${compositionPanelHtml(initial)}
      </div>
    </section>

    <section class="lux-card lux-c-diff">
      <h3 class="lux-h"><span>Tổng hợp tăng giảm</span>
        <span class="lux-h-end"><span id="month-detail-label">${monthLabelWithNote(initial)}</span><a href="javascript:void(0)" id="btn-monthly-detail" class="lux-link">Xem chi tiết</a></span>
      </h3>
      <div id="month-detail-slot">${monthDetailTableHtml(initial, prevMonthOf, yearStartOf, months)}</div>
    </section>
  `;
}

function bindMonthClicks(root) {
  root.querySelectorAll('[data-month]').forEach((el) => {
    el.addEventListener('click', () => selectMonth(root, el.dataset.month));
  });
}

function bindMonthSelector(root) {
  const sel = root.querySelector('#month-select');
  if (!sel) return;
  sel.addEventListener('change', () => selectMonth(root, sel.value));

  root.querySelectorAll('.period-step-btn').forEach((button) => button.addEventListener('click', () => {
    const { months } = buildDebtDashboardData();
    const target = months[months.findIndex((m) => m.yearMonth === sel.value) + Number(button.dataset.step)];
    if (target) selectMonth(root, target.yearMonth);
  }));
}

function extractReportAsOfDate(rawRows) {
  for (const row of rawRows.slice(0, 10)) {
    for (const cell of row || []) {
      const m = String(cell ?? '').match(/đến ngày\s+(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i);
      if (m) return S.parseVNDate(m[1]);
    }
  }
  return null;
}

function openImportHistoricalModal() {
  let preview = null;
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

function scrollTrendChartToEnd(root) {
  root.querySelectorAll('#trend-chart-slot .trend-scroll').forEach((el) => { el.scrollLeft = el.scrollWidth; });
}

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
  root.querySelector('#month-detail-slot').innerHTML = monthDetailTableHtml(m, prevMonthOf, yearStartOf, months);
  root.querySelector('#month-detail-label').textContent = monthLabelWithNote(m);

  const ctx = { live: computeLiveOverview(), dashboardData: { months, prevMonthOf, yearStartOf } };
  root.querySelector('#hero-slot').innerHTML = heroInnerHtml(m, ctx);
  root.querySelector('#attention-slot').innerHTML = attentionInnerHtml(m, ctx);
  bindAttention(root, m, ctx.live);

  const oldScrollLeft = [...root.querySelectorAll('#trend-chart-slot .trend-scroll')].map((el) => el.scrollLeft);
  root.querySelector('#trend-chart-slot').innerHTML = monthlyTrendLineChartSvg({ months, selectedYm: ym });
  root.querySelectorAll('#trend-chart-slot .trend-scroll').forEach((el, i) => { el.scrollLeft = oldScrollLeft[i] || 0; });
  const sel = root.querySelector('#month-select');
  if (sel) sel.value = ym;
  syncPeriodStepper(root, months.findIndex((x) => x.yearMonth === ym), months.length);
  bindNhomNoClicks(root);
  bindProvisionDetails(root);
  bindMonthClicks(root);
}

function pct(curr, prevVal) {
  if (prevVal === null || prevVal === undefined || prevVal === 0) return null;
  return ((curr - prevVal) / Math.abs(prevVal)) * 100;
}

function deltaChip(p, { mode = null } = {}) {
  if (p === null) return `<span style="font-size:10.5px;color:var(--text-faint)">—</span>`;
  const flat = Math.abs(p) < 0.05;
  const up = p > 0;
  const isGood = mode === 'better' ? up : mode === 'worse' ? !up : null;
  const color = flat ? 'var(--text-faint)' : isGood === null ? 'var(--text-muted)' : isGood ? 'var(--success)' : 'var(--danger)';
  const arrow = flat ? '·' : up ? '▲' : '▼';
  return `<span style="font-size:10.5px;font-weight:700;color:${color}">${arrow} ${Math.abs(p).toFixed(1).replace('.', ',')}%</span>`;
}

function openDebtGroupModal(g, isStaff, m) {
  const color = GROUP_COLORS[g];

  const showTsbd = g >= 2;

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
      if (historicalList) return;
      sheet.querySelectorAll('[data-view-ct]').forEach((row) => {
        row.addEventListener('click', (e) => {
          const ct = S.getContract(row.dataset.viewCt);
          openContractView(ct.customerId, ct, { readOnly: isStaff });
        });
      });
    },
  });
}

function tsbdRowHtml(ct) {
  return `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);font-size:11.5px;color:var(--text-muted)">${collateralDescription(ct)}</div>`;
}

function openContractListModal(title, contracts, isStaff, colorVar) {
  const total = contracts.reduce((s, ct) => s + S.contractAttentionInfo(ct).dueAmount, 0);
  const grouped = new Map();
  for (const ct of contracts) {
    let group = grouped.get(ct.customerId);
    if (!group) {
      group = { c: S.getCustomer(ct.customerId) || { id: ct.customerId, name: '—' }, contracts: [], totalBalance: 0 };
      grouped.set(ct.customerId, group);
    }
    group.contracts.push(ct);
    group.totalBalance += ct.balance || 0;
  }
  openModal({
    title: `${title} (${contracts.length})`,
    sheetClass: 'attention-ledger-sheet',
    bodyHtml: `
      <div class="customer-list-summary">${grouped.size} khách hàng · ${contracts.length} hợp đồng · Tổng tiền đến hạn: <strong style="color:${colorVar}">${formatVND(total)}</strong></div>
      ${contracts.length ? customerLedgerHtml([...grouped.values()], S.canManageZaloOA(S.getSession().id)) : emptyState({ iconName: 'checkCircle', title: 'Không có hợp đồng nào', message: 'Danh sách hiện đang trống.' })}
    `,
    onMount(sheet) {
      bindCustomerLedger(sheet, { readOnly: isStaff });
    },
  });
}
