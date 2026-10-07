import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { formatTrieuDong, formatTyDong } from '../../components/charts.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { readExcelFirstSheet } from '../../lib/excelLite.js';
import { parseBalanceSheetRows } from '../../lib/balanceSheet.js';
import { compareBalance, yearOpeningReport, provisionDifference, nextProvisionDeadline, managementRatios } from '../../lib/balanceSheetMetrics.js';
import { callCreateAccountFunction, getSupabaseClient } from '../../lib/supabaseClient.js';
import { escapeHtml, formatNumber, formatVND, formatCompact } from '../../utils.js';

let reports = [];
let selectedMonth = null;
let loadedFor = null;
let hasLoaded = false;
let requestId = 0;
const remoteProvisions = new Map();
const pendingProvisions = new Set();

const monthName = (ym) => `Tháng ${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
const reportDate = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || '')
  ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—';
const money = (value) => formatVND(value || 0);
const signed = (value) => `${value > 0 ? '+' : ''}${formatNumber(value)} ₫`;
const percent = (value) => `${value > 0 ? '+' : ''}${new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(value)}%`;

function change(current, base) {
  const result = compareBalance(current, base);
  if (!result) return '<span class="text-muted">—</span>';
  const tone = result.amount < 0 ? 'bs-negative' : result.amount > 0 ? 'bs-positive' : '';
  return `<span class="bs-change ${tone}"><strong>${signed(result.amount)}</strong><small><span class="bs-change-separator" aria-hidden="true">|</span>${result.percent == null ? '—' : percent(result.percent)}</small></span>`;
}

function managementRow(label, key, start, end, yearOpening, { total = false, child = false, noYear = false, profitDetail = false, ordinal = null } = {}) {
  const name = `${label}:`;
  return `<div class="bs-management-row ${total ? 'bs-management-total' : ''} ${child ? 'bs-management-child' : ''} ${ordinal ? 'bs-management-numbered' : ''}">
    <div class="bs-management-name">${ordinal ? `<span class="bs-roman" aria-label="Mục ${ordinal}">${ordinal}.</span>` : ''}${profitDetail ? `<button type="button" class="bs-management-link" data-profit-details aria-label="Xem Doanh thu và Chi phí">${name}</button>` : name}</div>
    <div class="bs-management-end"><strong>${money(end[key])}</strong></div>
    <div class="bs-management-value" data-label="Tăng/giảm">${change(end[key], start[key])}</div>
    <div class="bs-management-value" data-label="Từ đầu năm">${noYear ? '<span class="text-muted">—</span>' : change(end[key], yearOpening?.[key])}</div>
  </div>`;
}

function equityPartRow(label, key, report, yearOpening) {
  return managementRow(label, key, report.figures.start.equityParts || {},
    report.figures.end.equityParts || {}, yearOpening?.equityParts, { child: true });
}

function managementSection(title, rows) {
  return `<section class="card bs-management-section"><h4>${title}</h4>
    <div class="bs-management-head"><span>Chỉ tiêu</span><span>Cuối kỳ</span><span>Tăng/giảm</span><span>Từ đầu năm</span></div>
    ${rows}</section>`;
}

function roman(index) {
  const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  return numerals[index - 1] || String(index);
}

function numberedManagementRows(items, start, end, yearOpening) {
  return items.map((item, index) => managementRow(item.label, item.key,
    start, end, yearOpening, { ...item.options, ordinal: roman(index + 1) }) +
    (item.children || []).map(([label, key]) => managementRow(`↳ ${label}`, key,
      start, end, yearOpening, { child: true })).join('') +
    (item.detailHtml || '')).join('');
}

const ratioFormat = (value, suffix) => Number.isFinite(value)
  ? `${new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(value)}${suffix}` : '—';

function ratiosSection(end) {
  const ratios = managementRatios(end);
  if (!ratios) return '';
  const depositsWarning = ratios.depositCapital == null ? 'Chưa đủ số liệu để đánh giá giới hạn tiền gửi.'
    : ratios.depositCapital > 20 ? 'Vượt giới hạn 20 lần; cần giảm tiền gửi nhận hoặc tăng vốn chủ sở hữu.'
      : ratios.depositCapital >= 18 ? 'Gần giới hạn 20 lần; cần theo dõi quy mô huy động và vốn chủ sở hữu.'
        : 'Trong giới hạn 20 lần.';
  const loanWarning = ratios.loanDeposit == null ? 'Chưa đủ số liệu để đánh giá cơ cấu vốn.'
    : ratios.loanDeposit > 100 ? 'Dư nợ lớn hơn tiền gửi khách hàng; cần đánh giá nguồn vốn bù đắp và thanh khoản.'
      : '';
  const profitWarning = Number(end.profit) < 0 ? 'Lợi nhuận lũy kế âm; cần rà soát doanh thu và chi phí.'
    : '';
  const tile = (label, value, detail, advice, alert = false) => `<article class="bs-ratio-card ${alert ? 'bs-ratio-alert' : ''}">
    <div class="bs-ratio-head"><h4>${label}</h4><strong>${value}</strong></div>
    ${detail ? `<p class="bs-ratio-detail">${detail}</p>` : ''}${advice ? `<p class="bs-ratio-advice">${advice}</p>` : ''}</article>`;
  return `<section class="bs-ratios bs-section"><div class="bs-management-title"><h3>Chỉ số quản trị</h3><span>Lũy kế từ đầu năm · không quy đổi năm</span></div>
    <div class="bs-ratio-grid">
      ${tile('ROE', ratioFormat(ratios.roe, '%'), 'Lợi nhuận lũy kế / vốn chủ sở hữu', profitWarning, Number(end.profit) < 0)}
      ${tile('ROA', ratioFormat(ratios.roa, '%'), 'Lợi nhuận lũy kế / tổng tài sản', profitWarning, Number(end.profit) < 0)}
      ${tile('Cho vay / tiền gửi', ratioFormat(ratios.loanDeposit, '%'), '', loanWarning, ratios.loanDeposit > 100)}
      ${tile('Tiền gửi / vốn chủ sở hữu', ratioFormat(ratios.depositCapital, ' lần'), '', depositsWarning, ratios.depositCapital > 20)}
    </div><p class="bs-chart-note">ROA và ROE dùng lợi nhuận lũy kế và số dư cuối kỳ của tháng được chọn; đây là tỷ lệ quản trị tạm tính, chưa dùng tài sản/vốn bình quân hoặc lợi nhuận sau thuế.</p></section>`;
}

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Quản trị' });
}

function makeClient() {
  return getSupabaseClient(S.getSession()?.sbToken);
}

function resetIfChangedUser() {
  const session = S.getSession();
  if (loadedFor === session?.id) return;
  reports = [];
  selectedMonth = null;
  loadedFor = session?.id;
  hasLoaded = false;
  remoteProvisions.clear();
  pendingProvisions.clear();
}

async function loadRemoteProvision(yearMonth, contentEl) {
  if (remoteProvisions.has(yearMonth) || pendingProvisions.has(yearMonth)) return;
  const session = S.getSession();
  if (!session || !S.canViewBalanceSheet(session.id)) return;
  pendingProvisions.add(yearMonth);
  const result = await callCreateAccountFunction(session.sbToken, { type: 'get-management-provision', yearMonth });
  pendingProvisions.delete(yearMonth);
  if (loadedFor !== session.id) return;
  remoteProvisions.set(yearMonth,
    result.ok && Number.isFinite(result.generalProvision) && Number.isFinite(result.specificProvision)
      ? { generalProvision: result.generalProvision, specificProvision: result.specificProvision }
      : { error: true });
  if (selectedMonth === yearMonth && location.hash.split('?')[0] === '#/admin/can-doi-ke-toan') draw(contentEl);
}

export async function render(contentEl) {
  resetIfChangedUser();
  if (hasLoaded) { remoteProvisions.delete(selectedMonth); draw(contentEl); return; }
  const id = ++requestId;
  contentEl.innerHTML = '<div class="card card-pad text-muted">Đang tải bảng cân đối kế toán...</div>';
  const { data, error } = await makeClient().from('balance_sheet_reports')
    .select('year_month, period_end, source_name, figures, imported_at')
    .order('year_month', { ascending: true });
  if (id !== requestId || location.hash.split('?')[0] !== '#/admin/can-doi-ke-toan') return;
  if (error) {
    contentEl.innerHTML = `<div class="card card-pad text-danger">Không tải được số liệu. Kiểm tra kết nối hoặc cấu trúc Supabase: ${escapeHtml(error.message)}</div>`;
    return;
  }
  reports = data || [];
  hasLoaded = true;
  if (!reports.some((r) => r.year_month === selectedMonth)) selectedMonth = reports.at(-1)?.year_month || null;
  draw(contentEl);
}

function stat(label, value, startValue, color, clickable = false) {
  const tag = clickable ? 'button' : 'div';
  return `<${tag} ${clickable ? 'type="button" id="bs-profit-details" aria-label="Xem Doanh thu và Chi phí"' : ''} class="stat-tile ${color} ${clickable ? 'bs-stat-clickable' : ''}"><span class="stat-label">${label}</span><span class="stat-value bs-stat-value">${money(value)}</span><span class="stat-trend">${change(value, startValue)}</span>${clickable ? '<span class="bs-stat-more">Xem Doanh thu – Chi phí ›</span>' : ''}</${tag}>`;
}

const trendSeries = [
  { key: 'assets', label: 'Tổng tài sản', color: '#087d6a' },
  { key: 'customerDeposits', label: 'Tiền gửi khách hàng', color: '#2f69d9' },
  { key: 'grossLoans', label: 'Dư nợ cho vay', color: '#d97706' },
  { key: 'profit', label: 'Lợi nhuận', color: '#8b46b8', rightAxis: true },
];

function trendMonthDetail(report) {
  return `<strong>${monthName(report.year_month)}</strong><div>${trendSeries.map((s) =>
    `<span><i style="background:${s.color}"></i>${s.label}: <b>${money(report.figures.end[s.key])}</b></span>`).join('')}</div>`;
}

function trendSvg(shown, base, span, profitBase, profitSpan, mobile) {
  const viewport = mobile ? 320 : 1120;
  const visible = mobile ? 6 : 12;
  const height = mobile ? 215 : 330;
  const left = mobile ? 45 : 80;
  const step = (viewport - left - (mobile ? 55 : 100)) / (visible - 1);
  const width = Math.max(viewport, left + step * (shown.length - 1) + (mobile ? 55 : 100));
  const right = width - (mobile ? 55 : 100);
  const top = mobile ? 20 : 24;
  const bottom = mobile ? 170 : 278;
  const x = (i) => left + i * step;
  const y = (v) => bottom - (v - base) / span * (bottom - top);
  const profitY = (v) => bottom - (v - profitBase) / profitSpan * (bottom - top);
  const lines = [0, 0.5, 1].map((p) => {
    const yy = bottom - (bottom - top) * p;
    return `<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="#e2e8f0"/><text x="${left - (mobile ? 5 : 8)}" y="${yy + 4}" text-anchor="end" font-size="${mobile ? 9 : 11}" fill="#64748b">${formatCompact(base + span * p)}</text><text x="${right + 7}" y="${yy + 4}" font-size="${mobile ? 8 : 11}" fill="#8b46b8">${formatTrieuDong(profitBase + profitSpan * p)}</text>`;
  }).join('');
  const pointYs = trendSeries.map((s) => shown.map((r) =>
    (s.rightAxis ? profitY : y)(Number(r.figures.end[s.key]) || 0)));
  const positions = shown.map((_, monthIndex) => {
    const points = trendSeries.map((_, seriesIndex) => ({ seriesIndex, rawY: pointYs[seriesIndex][monthIndex] }))
      .sort((a, b) => a.rawY - b.rawY);
    const minGap = mobile ? 17 : 21;
    const labelTop = top + 12;
    const labelBottom = bottom - 5;
    points.forEach((point, index) => {
      point.labelY = Math.max(index ? points[index - 1].labelY + minGap : labelTop, point.rawY - 10);
    });
    const overflow = Math.max(0, points.at(-1).labelY - labelBottom);
    points.forEach((point) => { point.labelY -= overflow; });
    for (let index = points.length - 2; index >= 0; index--) {
      points[index].labelY = Math.min(points[index].labelY, points[index + 1].labelY - minGap);
    }
    const indexed = [];
    points.forEach((point, index) => {
      const coincident = points.filter((other) => Math.abs(other.rawY - point.rawY) < 13);
      indexed[point.seriesIndex] = {
        labelY: point.labelY,
        dotX: x(monthIndex) + (coincident.length > 1 ? (coincident.indexOf(point) - (coincident.length - 1) / 2) * (mobile ? 10 : 12) : 0),
      };
    });
    return indexed;
  });
  const plots = trendSeries.map((s, seriesIndex) => {
    const pointY = s.rightAxis ? profitY : y;
    const points = shown.map((r, i) => `${x(i)},${pointY(Number(r.figures.end[s.key]) || 0)}`).join(' ');
    return { line: `<polyline points="${points}" fill="none" stroke="${s.color}" stroke-width="${mobile ? 2 : 3}" ${s.rightAxis ? 'stroke-dasharray="7 4"' : ''} stroke-linecap="round" stroke-linejoin="round"/>`, dots: shown.map((r, i) => {
      const value = Number(r.figures.end[s.key]) || 0;
      const cx = x(i), cy = pointYs[seriesIndex][i];
      const { dotX, labelY } = positions[i][seriesIndex];
      return `<g class="bs-trend-point" data-trend-month="${r.year_month}" tabindex="0" role="button" aria-label="${monthName(r.year_month)} · ${s.label}: ${money(value)}">${dotX !== cx ? `<line x1="${cx}" y1="${cy}" x2="${dotX}" y2="${cy}" stroke="${s.color}" stroke-width="1.5"/>` : ''}<circle cx="${dotX}" cy="${cy}" r="${mobile ? 11 : 13}" fill="transparent"/><circle class="bs-trend-dot" cx="${dotX}" cy="${cy}" r="${mobile ? 3.5 : 5}" fill="${s.color}" stroke="white" stroke-width="1.5"/>${Math.abs(labelY - cy) > 16 ? `<line x1="${dotX}" y1="${cy}" x2="${dotX}" y2="${labelY + 3}" stroke="${s.color}" stroke-width="1" stroke-dasharray="2 2"/>` : ''}<text x="${dotX}" y="${labelY}" text-anchor="middle" font-size="${mobile ? 8 : 10}" font-weight="700" fill="${s.color}" stroke="white" stroke-width="2.5" paint-order="stroke">${s.rightAxis ? formatTrieuDong(value) : formatTyDong(value)}</text><title>${monthName(r.year_month)} · ${s.label}: ${money(value)}</title></g>`;
    }).join('') };
  });
  const labels = shown.map((r, i) => `<text x="${x(i)}" y="${mobile ? 200 : 314}" text-anchor="middle" font-size="${mobile ? 9 : 13}" font-weight="700" fill="#475569">${r.year_month.slice(5, 7)}${mobile ? '' : `/${r.year_month.slice(2, 4)}`}</text>`).join('');
  return `<svg class="${mobile ? 'bs-trend-mobile' : 'bs-trend-desktop'}" viewBox="0 0 ${width} ${height}" style="width:${shown.length > visible ? (width / viewport * 100).toFixed(2) : 100}%" role="img" aria-label="Biến động theo các tháng đã nạp: tổng tài sản, tiền gửi và dư nợ tính bằng tỷ đồng; lợi nhuận tính bằng triệu đồng">${lines}${plots.map((plot) => plot.line).join('')}${plots.map((plot) => plot.dots).join('')}${labels}</svg>`;
}

function trendChart(list) {
  if (!list.length) return '<p class="text-muted text-sm">Chưa có tháng nào để vẽ biểu đồ.</p>';
  const shown = list;
  const values = shown.flatMap((r) => [Number(r.figures.end.assets), Number(r.figures.end.customerDeposits), Number(r.figures.end.grossLoans) || 0]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const base = Math.max(0, min - (max - min || max * 0.05) * 0.35);
  const span = Math.max(1, max - base);
  const profits = shown.map((r) => Number(r.figures.end.profit) || 0);
  const profitBase = Math.min(0, ...profits) * 1.15;
  const profitTop = Math.max(0, ...profits) * 1.15 || 1;
  const profitSpan = Math.max(1, profitTop - profitBase);
  const selected = shown.find((r) => r.year_month === selectedMonth) || shown.at(-1);
  return `<p class="bs-chart-note">Tổng tài sản, tiền gửi, dư nợ: tỷ đồng · Lợi nhuận: triệu đồng.</p><div class="bs-chart-scroll">${trendSvg(shown, base, span, profitBase, profitSpan, false)}${trendSvg(shown, base, span, profitBase, profitSpan, true)}</div>
    <div class="bs-chart-legend">${trendSeries.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>
    <div class="bs-trend-detail" id="bs-trend-detail" aria-live="polite">${trendMonthDetail(selected)}</div>`;
}

function bindTrendPoints(root) {
  const chart = root.querySelector('.bs-chart-scroll');
  const detail = root.querySelector('#bs-trend-detail');
  if (!chart || !detail) return;
  const show = (target) => {
    const point = target?.closest?.('[data-trend-month]');
    if (!point) return;
    const report = reports.find((r) => r.year_month === point.dataset.trendMonth);
    if (!report || detail.dataset.month === report.year_month) return;
    detail.dataset.month = report.year_month;
    detail.innerHTML = trendMonthDetail(report);
    chart.querySelectorAll('[data-trend-month]').forEach((el) =>
      el.classList.toggle('is-active', el.dataset.trendMonth === report.year_month));
  };
  chart.addEventListener('pointerover', (event) => show(event.target));
  chart.addEventListener('click', (event) => show(event.target));
  chart.addEventListener('focusin', (event) => show(event.target));
  chart.scrollLeft = chart.scrollWidth;
}

function composition(items, total, centerLabel, { grossShares = false } = {}) {
  const chartTotal = items.reduce((sum, [, value]) => sum + Math.max(0, value), 0) || 1;
  let offset = 0;
  const stops = items.map(([, value, color]) => {
    const start = offset;
    offset += Math.max(0, value) / chartTotal * 100;
    return `${color} ${start}% ${offset}%`;
  }).join(',');
  const percentageBase = grossShares ? chartTotal : total;
  return `<div class="bs-composition"><div class="bs-donut" style="background:conic-gradient(${stops})"><div>${formatCompact(total)}<small>${centerLabel}</small></div></div>
    <div class="bs-composition-list">${items.map(([label, value, color]) => `<div class="${value < 0 ? 'bs-composition-deduction' : ''}"><span><i style="background:${color}"></i>${label}</span><strong>${percentageBase ? (value / percentageBase * 100).toFixed(1).replace('.', ',') + '%' : '—'}</strong><small>${money(value)}</small></div>`).join('')}</div></div>
    ${!grossShares && items.some(([, value]) => value < 0) ? '<p class="bs-chart-note">Khoản âm hiển thị trong danh sách, không vẽ thành lát trên biểu đồ.</p>' : ''}`;
}

function assetComposition(figures) {
  return composition([
    ['Dư nợ cho vay', figures.grossLoans, '#087d6a'],
    ['Dự phòng rủi ro (trừ)', -(figures.totalProvision ?? figures.generalProvision + figures.specificProvision), '#c04343'],
    ['Tiền gửi tại TCTD', figures.tctdDeposits, '#2f69d9'],
    ['Lãi, phí phải thu', figures.accruedReceivables, '#e69910'],
    ['Tiền mặt', figures.cash, '#b066c6'],
    ['TSCĐ, vốn góp NHHTX và tài sản khác', figures.fixedCapital + figures.internalReceivables + figures.otherAssets, '#8996a8'],
  ], figures.assets, 'Tổng tài sản', { grossShares: true });
}

function fundingComposition(figures) {
  return composition([
    ['Tiền gửi khách hàng', figures.customerDeposits, '#2f69d9'],
    ['Lãi và phí phải trả', figures.interestPayable, '#e69910'],
    ['Nợ phải trả khác', figures.otherLiabilities, '#8996a8'],
    ['Vốn chủ sở hữu', figures.equity, '#087d6a'],
    ['Lợi nhuận lũy kế', figures.profit, '#b066c6'],
  ], figures.liabilities, 'Tổng nguồn vốn');
}

function showProfitDetails(report) {
  const { start, end } = report.figures;
  if (!Number.isFinite(end.revenue) || !Number.isFinite(end.expenses)) {
    openModal({ title: 'Doanh thu – Chi phí', bodyHtml: '<p class="text-muted">Báo cáo này được nạp trước khi lưu chi tiết Doanh thu – Chi phí. Cần nạp lại file của kỳ này để xem số liệu.</p>' });
    return;
  }
  openModal({
    title: `Doanh thu – Chi phí · ${monthName(report.year_month)}`,
    bodyHtml: `<div class="bs-profit-details">
      <div class="bs-profit-head"><span>Chỉ tiêu</span><span>Lũy kế cuối kỳ</span><span>Tăng/giảm</span></div>
      <div><span>Doanh thu</span><strong>${money(end.revenue)}</strong>${change(end.revenue, start.revenue)}</div>
      <div><span>Chi phí</span><strong>${money(end.expenses)}</strong>${change(end.expenses, start.expenses)}</div>
      <div class="bs-profit-total"><span>Lợi nhuận lũy kế</span><strong>${money(end.profit)}</strong>${change(end.profit, start.profit)}</div>
    </div>`,
  });
}

function provisionComparison(report) {
  const snap = S.listMonthlySnapshots().find((x) => x.yearMonth === report.year_month);
  const end = report.figures.end;
  const snapshotProvision = S.provisionFromSnapshot(snap);
  // Cùng nguồn với Tổng quan: bản chốt của tháng được ưu tiên.
  const today = new Date();
  const live = !snapshotProvision && S.isSuperAdmin(S.getSession()?.id)
    ? S.provisionSummary(S.getState().contracts, today) : null;
  const remote = remoteProvisions.get(report.year_month);
  const app = snapshotProvision || live || (remote?.error ? null : remote);
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const isUnclosedMonth = report.year_month >= currentMonth;
  // Chỉ yêu cầu bút toán sau khi tháng đã kết thúc và có bản chốt của đúng tháng.
  const canRecommendAdjustment = report.year_month < currentMonth && !!snapshotProvision;
  const deadline = nextProvisionDeadline(report.year_month);
  const provisions = [
    ['Dự phòng chung', end.generalProvision, app?.generalProvision],
    ['Dự phòng cụ thể', end.specificProvision, app?.specificProvision],
  ];
  const compare = (label, fileValue, appValue) => {
    const gap = provisionDifference(fileValue, appValue);
    return `<tr><th scope="row">${label}</th><td>${money(fileValue)}</td><td>${Number.isFinite(appValue) ? money(appValue) : 'Chưa có số liệu'}</td><td class="${gap == null ? '' : gap === 0 ? 'bs-match' : gap > 0 ? 'bs-overprovision' : 'bs-negative'}">${gap == null ? '—' : signed(gap)}</td></tr>`;
  };
  const alerts = canRecommendAdjustment ? provisions.map(([label, fileValue, appValue]) => {
    const gap = provisionDifference(fileValue, appValue);
    if (gap > 0) return `<p>${label} dư <strong>${money(gap)}</strong> so với mức phải trích; cần hoàn nhập phần dư.</p>`;
    if (gap < 0) return `<p>${label} thiếu <strong>${money(-gap)}</strong>; cần trích bổ sung trong 07 ngày đầu tháng sau, chậm nhất ngày ${deadline}.</p>`;
    return '';
  }).join('') : '';
  return `<div class="card card-pad bs-section bs-provision-section"><h3>Trích lập dự phòng${isUnclosedMonth ? ' <span class="bs-provision-pending">(Chưa chốt số liệu tháng này)</span>' : ''}</h3>
    ${remote?.error && !app ? '<p class="bs-warning">Không tải được số Phải trích. Bấm Làm mới để thử lại.</p>' : ''}
    ${alerts ? `<div class="bs-provision-alerts" role="status">${alerts}</div>` : ''}
    <div class="bs-table-wrap"><table class="bs-table"><thead><tr><th>Khoản mục</th><th>Bảng cân đối</th><th>Phải trích</th><th>Chênh lệch</th></tr></thead><tbody>
      ${provisions.map(([label, fileValue, appValue]) => compare(label, fileValue, appValue)).join('')}
      ${compare('Tổng dự phòng', end.totalProvision ?? end.generalProvision + end.specificProvision,
        Number.isFinite(app?.generalProvision) && Number.isFinite(app?.specificProvision) ? app.generalProvision + app.specificProvision : null)}
    </tbody></table></div></div>`;
}

function draw(contentEl) {
  const superAdmin = S.isSuperAdmin(S.getSession()?.id);
  const report = reports.find((r) => r.year_month === selectedMonth);
  const end = report?.figures.end;
  const start = report?.figures.start;
  const yearOpening = report ? yearOpeningReport(reports, report.year_month) : null;
  const yearStart = yearOpening?.figures.start;
  const equityParts = end?.equityParts;
  const assetItems = report ? [
    { label: 'Tiền mặt tại đơn vị', key: 'cash' },
    { label: 'Tiền gửi tại các TCTD', key: 'tctdDeposits', children: [['Không kỳ hạn', 'tctdDemand'], ['Có kỳ hạn', 'tctdTerm']] },
    { label: 'Dư nợ cho vay', key: 'grossLoans', children: [['Dự phòng chung', 'generalProvision'], ['Dự phòng cụ thể', 'specificProvision']] },
    ...(Number.isFinite(end.fixedAssetsNet) && Number.isFinite(end.capitalContribution)
      ? [{ label: 'TSCĐ sau hao mòn', key: 'fixedAssetsNet' }, { label: 'Vốn góp NHHTX', key: 'capitalContribution' }]
      : [{ label: 'TSCĐ ròng và vốn góp NHHTX', key: 'fixedCapital' }]),
    { label: 'Phải thu nội bộ', key: 'internalReceivables' },
    { label: 'Lãi và phí phải thu', key: 'accruedReceivables' },
    ...(end.otherAssets || start.otherAssets ? [{ label: 'Tài sản khác', key: 'otherAssets' }] : []),
  ] : [];
  const equityDetails = equityParts ? `
    ${equityPartRow('↳ Vốn điều lệ', 'charterCapital', report, yearStart)}
    ${equityPartRow('↳ Quỹ dự trữ bổ sung vốn điều lệ', 'supplementaryReserve', report, yearStart)}
    ${equityPartRow('↳ Quỹ đầu tư phát triển', 'developmentReserve', report, yearStart)}
    ${equityPartRow('↳ Quỹ dự phòng tài chính', 'financialReserve', report, yearStart)}
    ${equityParts.otherEquity || start.equityParts?.otherEquity ? equityPartRow('↳ Vốn chủ sở hữu khác', 'otherEquity', report, yearStart) : ''}`
    : '<p class="bs-management-hint">Cần nạp lại file kỳ này để hiển thị vốn điều lệ và các quỹ.</p>';
  const fundingItems = report ? [
    { label: 'Tiền gửi khách hàng', key: 'customerDeposits' },
    { label: 'Lãi và phí phải trả', key: 'interestPayable' },
    { label: 'Nợ phải trả khác', key: 'otherLiabilities' },
    { label: 'Vốn chủ sở hữu', key: 'equity', detailHtml: equityDetails },
    { label: 'Lợi nhuận lũy kế', key: 'profit', options: { noYear: true, profitDetail: true } },
  ] : [];
  contentEl.innerHTML = `<div class="bs-toolbar"><div><h2>Số liệu quản trị theo tháng</h2>${report ? `<p class="bs-source">Số liệu đến ngày: <strong>${reportDate(report.period_end)}</strong></p>` : ''}</div>
    <div class="bs-toolbar-actions">${reports.length ? `<label class="bs-month-select">Kỳ báo cáo <select id="bs-month">${[...reports].reverse().map((r) => `<option value="${r.year_month}" ${r.year_month === selectedMonth ? 'selected' : ''}>${monthName(r.year_month)}</option>`).join('')}</select></label>` : ''}
    <button class="btn btn-outline" id="bs-refresh" type="button">Làm mới</button>
    ${superAdmin ? '<button class="btn btn-primary" id="bs-import">Nạp cân đối</button><input type="file" id="bs-file" accept=".xls,.xlsx" hidden>' : ''}</div></div>
    ${!report ? `<div class="card card-pad"><p>Chưa có bảng cân đối nào. Quản trị viên toàn quyền có thể nạp file .xls hoặc .xlsx của từng tháng.</p></div>` : `
    <div class="grid-4 bs-stats">
      ${stat('Tổng tài sản', end.assets, start.assets, 'c-green')}
      ${stat('Tiền gửi khách hàng', end.customerDeposits, start.customerDeposits, 'c-blue')}
      ${stat('Tiền gửi tại TCTD', end.tctdDeposits, start.tctdDeposits, 'c-orange')}
      ${stat('Lợi nhuận lũy kế', end.profit, start.profit, 'c-pink', true)}
    </div>
    <div class="card card-pad bs-section bs-trend-section"><h3>Biến động</h3>${trendChart(reports)}</div>
    <div class="bs-two-col"><div class="card card-pad bs-section"><h3>Cơ cấu tài sản</h3>${assetComposition(end)}</div>
      <div class="card card-pad bs-section"><h3>Cơ cấu nguồn vốn</h3>${fundingComposition(end)}</div></div>
    <div class="bs-management bs-section"><div class="bs-management-title"><h3>Chỉ tiêu quản trị</h3><span>${yearOpening ? `So với đầu kỳ tháng 01/${report.year_month.slice(0, 4)}` : `Chưa có kỳ 01/${report.year_month.slice(0, 4)} để so sánh từ đầu năm`}</span></div>
      ${managementSection('Tài sản', `${numberedManagementRows(assetItems, start, end, yearStart)}
        ${managementRow('Tổng tài sản', 'assets', start, end, yearStart, { total: true })}`)}
      ${managementSection('Nguồn vốn', `${numberedManagementRows(fundingItems, start, end, yearStart)}
        ${managementRow('Tổng nguồn vốn', 'liabilities', start, end, yearStart, { total: true })}`)}
      <p class="bs-balance-note">Chênh lệch Tài sản − Nguồn vốn cuối kỳ: <strong>${signed(end.assets - end.liabilities)}</strong></p></div>
    ${ratiosSection(end)}
    ${provisionComparison(report)}`}`;
  contentEl.querySelector('#bs-month')?.addEventListener('change', (event) => {
    selectedMonth = event.target.value;
    remoteProvisions.delete(selectedMonth);
    draw(contentEl);
  });
  if (report && !superAdmin && !S.provisionFromSnapshot(S.listMonthlySnapshots().find((x) => x.yearMonth === report.year_month))) {
    void loadRemoteProvision(report.year_month, contentEl);
  }
  bindTrendPoints(contentEl);
  contentEl.querySelector('#bs-profit-details')?.addEventListener('click', () => showProfitDetails(report));
  contentEl.querySelector('[data-profit-details]')?.addEventListener('click', () => showProfitDetails(report));
  contentEl.querySelector('#bs-refresh')?.addEventListener('click', () => { hasLoaded = false; remoteProvisions.clear(); render(contentEl); });
  contentEl.querySelector('#bs-import')?.addEventListener('click', () => contentEl.querySelector('#bs-file')?.click());
  contentEl.querySelector('#bs-file')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await previewImport(file, contentEl);
  });
}

async function previewImport(file, contentEl) {
  try {
    if (!/\.xlsx?$/i.test(file.name)) throw new Error('Chỉ nhận file .xls hoặc .xlsx.');
    if (file.size > 10 * 1024 * 1024) throw new Error('File vượt quá 10 MB.');
    const parsed = parseBalanceSheetRows(await readExcelFirstSheet(file));
    const replacing = reports.some((r) => r.year_month === parsed.yearMonth);
    openModal({
      title: `Kiểm tra ${monthName(parsed.yearMonth)}`,
      bodyHtml: `<p>File: <strong>${escapeHtml(file.name)}</strong></p>
        <p>Số liệu đến ngày: <strong>${reportDate(parsed.periodEnd)}</strong></p>
        <div class="oc-line"><span>Tổng tài sản đầu kỳ</span><b>${money(parsed.start.assets)}</b></div>
        <div class="oc-line"><span>Tổng tài sản cuối kỳ</span><b>${money(parsed.end.assets)}</b></div>
        <div class="oc-line"><span>Dự phòng chung cuối kỳ</span><b>${money(parsed.end.generalProvision)}</b></div>
        <div class="oc-line"><span>Dự phòng cụ thể cuối kỳ</span><b>${money(parsed.end.specificProvision)}</b></div>
        <p class="bs-balance-note">Đã kiểm tra: Tài sản = Nguồn vốn ở đầu và cuối kỳ.</p>
        ${replacing ? '<p class="bs-warning">Kỳ này đã có dữ liệu. Lưu sẽ thay thế số liệu cũ của đúng tháng này.</p>' : ''}`,
      footHtml: '<button class="btn btn-outline" data-cancel>Hủy</button><button class="btn btn-primary" data-save>Lưu số liệu</button>',
      onMount(sheet, close) {
        sheet.querySelector('[data-cancel]').addEventListener('click', close);
        sheet.querySelector('[data-save]').addEventListener('click', async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          const session = S.getSession();
          if (!S.isSuperAdmin(session?.id)) { toast('Chỉ quản trị viên toàn quyền được nạp file.', 'error'); close(); return; }
          const { error } = await makeClient().from('balance_sheet_reports').upsert({
            year_month: parsed.yearMonth, period_end: parsed.periodEnd,
            source_name: file.name, figures: { start: parsed.start, end: parsed.end },
            imported_by: session.id, imported_at: new Date().toISOString(),
          }, { onConflict: 'year_month' });
          if (error) { toast(`Không lưu được: ${error.message}`, 'error'); button.disabled = false; return; }
          selectedMonth = parsed.yearMonth;
          close();
          toast(`Đã lưu ${monthName(parsed.yearMonth)}`, 'success');
          hasLoaded = false;
          await render(contentEl);
        });
      },
    });
  } catch (error) {
    toast(error.message || 'Không đọc được file bảng cân đối.', 'error');
  }
}
