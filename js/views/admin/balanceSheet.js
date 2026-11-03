import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { formatTrieuDong, formatTyDong } from '../../components/charts.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { readExcelFirstSheet } from '../../lib/excelLite.js';
import { parseBalanceSheetRows } from '../../lib/balanceSheet.js';
import { compareBalance, yearOpeningReport, previousDecemberReport, historicAccountLines, accountDetailChanges, selectLatestBalanceImports, provisionDifference, nextProvisionDeadline, managementRatios, monthlyProfit, previousMonthReport } from '../../lib/balanceSheetMetrics.js';
import { callCreateAccountFunction, getSupabaseClient } from '../../lib/supabaseClient.js';
import { escapeHtml, formatNumber, formatVND, compactParts } from '../../utils.js';
import { icon } from '../../icons.js';
import { periodStepperHtml } from '../../components/ui.js';
import { kvGet, kvSet } from '../../lib/kvCache.js';

let reports = [];
let selectedMonth = null;
let loadedFor = null;
let hasLoaded = false;
let requestId = 0;
let loadingPromise = null;
let latestContentEl = null;
let skipCache = false;
const remoteProvisions = new Map();
const pendingProvisions = new Set();
const openRows = new Set();

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

function managementRow(label, key, start, end, yearOpening, { total = false, child = false, noYear = false, profitDetail = false, toggle = null, ordinal = null } = {}) {
  const name = `${label}<span class="bs-colon">:</span>`;
  const childName = `<span class="bs-sub-arrow" aria-hidden="true">↳</span><span class="bs-sub-label">${name}</span>`;
  const detailButton = profitDetail
    ? `<button type="button" class="bs-management-link" data-profit-details aria-label="Xem Doanh thu và Chi phí">${name}</button>`
    : toggle
      ? `<button type="button" class="bs-expand" data-expand="${toggle.id}" aria-expanded="${toggle.open}" aria-controls="bs-sub-${toggle.id}"><span>${name}</span><span class="bs-expand-chev" aria-hidden="true">${icon('chevronDown', 'icon-sm')}</span></button>`
      : child ? childName : `<span>${name}</span>`;
  return `<div class="bs-management-row ${total ? 'bs-management-total' : ''} ${child ? 'bs-management-child' : ''} ${ordinal ? 'bs-management-numbered' : ''}${toggle?.open ? ' is-open' : ''}">
    <div class="bs-management-name">${ordinal ? `<span class="bs-roman" aria-label="Mục ${ordinal}">${ordinal}.</span>` : ''}${detailButton}</div>
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

function accountLineRow(line) {
  const code = line.residual ? 'Phần chưa tách' : `TK ${escapeHtml(String(line.code || ''))}${line.incomplete ? ' (chưa đủ cấp)' : ''}`;
  const balance = Number(line.balance) || 0;
  return `<div class="bs-management-row bs-management-child">
    <div class="bs-management-name"><span class="bs-sub-arrow" aria-hidden="true">↳</span><span class="bs-sub-label"><b class="bs-acc-code">${code}</b>${line.name ? ` <span class="bs-acc-name">${escapeHtml(String(line.name))}</span>` : ''}</span></div>
    <div class="bs-management-end"><strong>${money(balance)}</strong></div>
    <div class="bs-management-value" data-label="Tăng/giảm">${change(balance, line.startBalance)}</div>
    <div class="bs-management-value" data-label="Từ đầu năm">${change(balance, line.yearBalance)}</div>
  </div>`;
}

function accountLinesHtml(report, key) {
  const { start, end } = report.figures;
  const januaryStart = yearOpeningReport(reports, report.year_month)?.figures?.start;
  const lines = accountDetailChanges(end.accountDetails?.[key], start.accountDetails?.[key],
    januaryStart?.accountDetails?.[key], historicAccountLines(reports, report.year_month, key));
  if (!lines) return '<p class="bs-management-hint">Kỳ này được nạp trước khi ứng dụng lưu chi tiết tài khoản. Nạp lại file A01 của đúng tháng để xem từng tài khoản.</p>';
  return lines.length ? lines.map(accountLineRow).join('') : '<p class="bs-management-hint">Không có số dư cuối kỳ.</p>';
}

function numberedManagementRows(items, start, end, yearOpening, group) {
  return items.map((item, index) => {
    const subHtml = (item.children || []).map(([label, key]) => managementRow(label, key,
      start, end, yearOpening, { child: true })).join('') + (item.detailHtml || '');
    const id = `${group}-${item.key}`;
    const open = !!subHtml && openRows.has(id);
    return managementRow(item.label, item.key, start, end, yearOpening,
      { ...item.options, ordinal: roman(index + 1), toggle: subHtml ? { id, open } : null }) +
      (subHtml ? `<div class="bs-sub${open ? ' is-open' : ''}" id="bs-sub-${id}" data-sub="${id}"><div class="bs-sub-in">${subHtml}</div></div>` : '');
  }).join('');
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

  const tile = (label, value, detail, advice, alert = false, calc = false) => `<article class="bs-ratio-card ${alert ? 'bs-ratio-alert' : ''}">
    <div class="bs-ratio-head"><h4>${label}</h4><strong>${value}</strong></div>
    ${detail ? `<p class="bs-ratio-detail${calc ? ' bs-ratio-detail--calc' : ''}">${detail}</p>` : ''}${advice ? `<p class="bs-ratio-advice">${advice}</p>` : ''}</article>`;
  return `<section class="bs-ratios bs-section" id="bs-sec-ratios"><div class="bs-management-title"><h3 class="bs-sec-h">Chỉ số quản trị</h3><span>Lũy kế từ đầu năm · không quy đổi năm</span></div>
    <div class="bs-ratio-grid">
      ${tile('ROE', ratioFormat(ratios.roe, '%'), 'Lợi nhuận lũy kế / vốn chủ sở hữu', profitWarning, Number(end.profit) < 0)}
      ${tile('ROA', ratioFormat(ratios.roa, '%'), 'Lợi nhuận lũy kế / tổng tài sản', profitWarning, Number(end.profit) < 0)}
      ${tile('Cho vay / tiền gửi', ratioFormat(ratios.loanDeposit, '%'), 'Dư nợ cho vay / tiền gửi khách hàng', loanWarning, ratios.loanDeposit > 100, true)}
      ${tile('Tiền gửi / vốn chủ sở hữu', ratioFormat(ratios.depositCapital, ' lần'), 'Tiền gửi khách hàng / vốn chủ sở hữu', depositsWarning, ratios.depositCapital > 20, true)}
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
  requestId++;
  loadingPromise = null;
  remoteProvisions.clear();
  pendingProvisions.clear();
  openRows.clear();
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

const onThisPage = () => location.hash.split('?')[0] === '#/admin/can-doi-ke-toan';

const SELECT_FULL = 'year_month, period_end, source_name, figures, imported_at';
const cacheKey = (uid) => `balance:${uid}`;

async function fetchReports(uid, cached) {
  const client = makeClient();
  if (!cached.length) {
    const { data, error } = await client.from('balance_sheet_reports').select(SELECT_FULL).order('year_month', { ascending: true });
    if (error) throw new Error(error.message);
    return { reports: data || [], changed: true };
  }
  const { data: meta, error: metaError } = await client.from('balance_sheet_reports')
    .select('year_month, period_end, source_name, imported_at').order('year_month', { ascending: true });
  if (metaError) throw new Error(metaError.message);
  const have = new Map(cached.map((r) => [r.year_month, r]));
  const stale = (meta || []).filter((m) => {
    const c = have.get(m.year_month);
    return !c || c.imported_at !== m.imported_at || c.period_end !== m.period_end || c.source_name !== m.source_name;
  }).map((m) => m.year_month);
  let fresh = [];
  if (stale.length) {
    const { data, error } = await client.from('balance_sheet_reports').select(SELECT_FULL).in('year_month', stale).order('year_month', { ascending: true });
    if (error) throw new Error(error.message);
    fresh = data || [];
  }
  const freshMap = new Map(fresh.map((r) => [r.year_month, r]));
  const next = (meta || []).map((m) => freshMap.get(m.year_month) || have.get(m.year_month)).filter(Boolean);
  const changed = stale.length > 0 || next.length !== cached.length;
  return { reports: next, changed };
}

function startLoad() {
  const id = ++requestId;
  const uid = loadedFor;
  const useCache = !skipCache;
  skipCache = false;
  const job = (async () => {
    let cached = [];
    if (useCache) {
      const saved = await kvGet(cacheKey(uid));
      if (id !== requestId) return;
      if (saved && Array.isArray(saved.reports) && saved.reports.length) {
        cached = saved.reports;
        reports = cached;
        hasLoaded = true;
        if (!reports.some((r) => r.year_month === selectedMonth)) selectedMonth = reports.at(-1)?.year_month || null;
        if (latestContentEl && onThisPage()) draw(latestContentEl);
      }
    }
    let result;
    try { result = await fetchReports(uid, cached); }
    catch (e) { result = { error: { message: e?.message || 'Mất kết nối' } }; }
    if (id !== requestId) return;
    const el = latestContentEl;
    if (result.error) {

      if (!cached.length && el && onThisPage()) el.innerHTML = `<div class="card card-pad text-danger">Không tải được số liệu. Kiểm tra kết nối hoặc cấu trúc Supabase: ${escapeHtml(result.error.message)}</div>`;
      return;
    }
    const firstTime = !cached.length;
    reports = result.reports;
    hasLoaded = true;
    if (!reports.some((r) => r.year_month === selectedMonth)) selectedMonth = reports.at(-1)?.year_month || null;
    if (firstTime || result.changed) {
      kvSet(cacheKey(uid), { at: Date.now(), reports });
      if (el && onThisPage()) draw(el);
    }
  })().finally(() => { if (loadingPromise === job) loadingPromise = null; });
  loadingPromise = job;
  return job;
}

export async function render(contentEl) {
  resetIfChangedUser();
  latestContentEl = contentEl;
  if (hasLoaded) { remoteProvisions.delete(selectedMonth); draw(contentEl); return; }
  contentEl.innerHTML = '<div class="card card-pad text-muted">Đang tải bảng cân đối kế toán...</div>';

  if (loadingPromise) return loadingPromise;
  return startLoad();
}

export function prefetch() {
  const session = S.getSession();
  if (!session || session.role !== 'admin' || !S.canViewBalanceSheet(session.id)) return;
  resetIfChangedUser();
  if (hasLoaded || loadingPromise) return;
  startLoad().catch(() => {});
}

function reloadFromServer(contentEl) {
  hasLoaded = false;
  skipCache = true;
  requestId++;
  loadingPromise = null;
  remoteProvisions.clear();
  return render(contentEl);
}

export function refresh(contentEl) {
  latestContentEl = contentEl;
  if (hasLoaded) draw(contentEl);
}

function compactMoney(value) { return compactParts(value); }

function stat(label, value, startValue, color, clickable = false) {
  const tag = clickable ? 'button' : 'div';
  const compact = compactMoney(value);
  return `<${tag} ${clickable ? 'type="button" id="bs-profit-details" aria-label="Xem Doanh thu và Chi phí"' : ''} class="stat-tile ${color} ${clickable ? 'bs-stat-clickable' : ''}"><span class="stat-label">${label}</span><span class="stat-value bs-stat-value">${compact.num}<small>${compact.unit}</small></span><span class="stat-trend">${change(value, startValue)}</span>${clickable ? '<span class="bs-stat-more">Xem Doanh thu – Chi phí ›</span>' : ''}</${tag}>`;
}

const trendSeries = [
  { key: 'assets', label: 'Tổng tài sản', color: '#0c4a3f' },
  { key: 'customerDeposits', label: 'Tiền gửi khách hàng', color: '#b08d3c' },
  { key: 'grossLoans', label: 'Dư nợ cho vay', color: '#4f9d86' },
];

function trendSvg(shown, base, span, mobile) {
  const viewport = mobile ? 320 : 1120;
  const visible = mobile ? 5 : 12;
  const height = mobile ? 255 : 372;
  const edge = mobile ? 28 : 44;
  const left = edge;
  const step = (viewport - left - edge) / (visible - 1);
  const width = Math.max(viewport, left + step * (shown.length - 1) + edge);
  const right = width - edge;
  const top = mobile ? 20 : 24;
  const bottom = mobile ? 208 : 316;
  const x = (i) => left + i * step;
  const y = (v) => bottom - (v - base) / span * (bottom - top);
  const lines = [0, 0.5, 1].map((p) => {
    const yy = bottom - (bottom - top) * p;
    return `<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="#e2e8f0"/>`;
  }).join('');
  const pointYs = trendSeries.map((s) => shown.map((r) => y(Number(r.figures.end[s.key]) || 0)));
  const positions = shown.map((_, monthIndex) => {
    const points = trendSeries.map((_, seriesIndex) => ({ seriesIndex, rawY: pointYs[seriesIndex][monthIndex] }))
      .sort((a, b) => a.rawY - b.rawY);
    const minGap = mobile ? 21 : 25;
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
    const points = shown.map((r, i) => `${x(i)},${y(Number(r.figures.end[s.key]) || 0)}`).join(' ');
    return { line: `<polyline points="${points}" fill="none" stroke="${s.color}" stroke-width="${mobile ? 2 : 3}" stroke-linecap="round" stroke-linejoin="round"/>`, dots: shown.map((r, i) => {
      const value = Number(r.figures.end[s.key]) || 0;
      const cx = x(i), cy = pointYs[seriesIndex][i];
      const { dotX, labelY } = positions[i][seriesIndex];
      return `<g class="bs-trend-point${r.year_month === selectedMonth ? ' is-active' : ''}" data-trend-month="${r.year_month}" tabindex="0" role="button" aria-label="${monthName(r.year_month)} · ${s.label}: ${money(value)}">${dotX !== cx ? `<line x1="${cx}" y1="${cy}" x2="${dotX}" y2="${cy}" stroke="${s.color}" stroke-width="1.5"/>` : ''}<circle cx="${dotX}" cy="${cy}" r="${mobile ? 11 : 13}" fill="transparent"/><circle class="bs-trend-dot" cx="${dotX}" cy="${cy}" r="${mobile ? 3.5 : 5}" fill="${s.color}" stroke="white" stroke-width="1.5"/>${Math.abs(labelY - cy) > 16 ? `<line x1="${dotX}" y1="${cy}" x2="${dotX}" y2="${labelY + 3}" stroke="${s.color}" stroke-width="1" stroke-dasharray="2 2"/>` : ''}<text x="${dotX}" y="${labelY}" text-anchor="middle" font-size="${mobile ? 10.5 : 13}" font-weight="700" fill="${s.color}" stroke="white" stroke-width="3" paint-order="stroke">${formatTyDong(value)} tỷ</text><title>${monthName(r.year_month)} · ${s.label}: ${money(value)}</title></g>`;
    }).join('') };
  });
  const labels = shown.map((r, i) => `<text x="${x(i)}" y="${mobile ? 240 : 352}" text-anchor="middle" font-size="${mobile ? 10 : 13}" font-weight="700" fill="#475569">${r.year_month.slice(5, 7)}/${r.year_month.slice(2, 4)}</text>`).join('');
  return `<svg class="${mobile ? 'bs-trend-mobile' : 'bs-trend-desktop'}" viewBox="0 0 ${width} ${height}" style="width:${shown.length > visible ? (width / viewport * 100).toFixed(2) : 100}%" role="img" aria-label="Biến động theo các tháng đã nạp: tổng tài sản, tiền gửi và dư nợ tính bằng tỷ đồng">${lines}${plots.map((plot) => plot.line).join('')}${plots.map((plot) => plot.dots).join('')}${labels}</svg>`;
}

function trendChart(list) {
  if (!list.length) return '<p class="text-muted text-sm">Chưa có tháng nào để vẽ biểu đồ.</p>';
  const shown = list;
  const values = shown.flatMap((r) => [Number(r.figures.end.assets), Number(r.figures.end.customerDeposits), Number(r.figures.end.grossLoans) || 0]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const base = Math.max(0, min - (max - min || max * 0.05) * 0.12);
  const span = Math.max(1, max + (max - min || max * 0.05) * 0.16 - base);
  return `<p class="bs-chart-note">Tổng tài sản, tiền gửi, dư nợ: tỷ đồng.</p><div class="bs-chart-scroll">${trendSvg(shown, base, span, false)}${trendSvg(shown, base, span, true)}</div>
    <div class="bs-chart-legend">${trendSeries.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>`;
}

function profitSvg(list, mobile) {
  const width = mobile ? 320 : 1120;
  const pad = mobile ? 8 : 14;
  const n = list.length;
  const slot = (width - pad * 2) / n;
  const x = (i) => pad + slot * (i + 0.5);
  const monthly = list.map((r) => monthlyProfit(r) ?? 0);
  const cumulative = list.map((r) => Number(r.figures.end.profit) || 0);
  const g = mobile
    ? { capA: 12, aTop: 40, aBottom: 112, capB: 146, bTop: 174, bBottom: 236, axis: 258, height: 266 }
    : { capA: 14, aTop: 50, aBottom: 142, capB: 188, bTop: 222, bBottom: 308, axis: 334, height: 344 };
  const font = mobile ? 10.5 : 13;
  const selected = list.findIndex((r) => r.year_month === selectedMonth);
  const scale = (values, top, bottom) => {
    const lo = Math.min(0, ...values);
    const hi = Math.max(0, ...values, 1);
    return (v) => bottom - (v - lo) / (hi - lo) * (bottom - top);
  };
  const yBar = scale(monthly, g.aTop, g.aBottom);
  const yLine = scale(cumulative, g.bTop, g.bBottom);
  const trieu = (v) => (mobile ? formatNumber(Math.round(v / 1e6)) : formatTrieuDong(v));
  const label = (cx, cy, text, color) => `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-size="${font}" font-weight="700" fill="${color}" stroke="white" stroke-width="3" paint-order="stroke">${text}</text>`;
  const caption = (y, title, unit) => `<text class="bs-profit-cap" x="${pad}" y="${y}" font-size="${mobile ? 10 : 12}">${title}<tspan class="bs-profit-unit" dx="8">${unit}</tspan></text>`;
  const rule = (y) => `<line x1="${pad}" y1="${y.toFixed(1)}" x2="${width - pad}" y2="${y.toFixed(1)}" stroke="#cbd5e1"/>`;
  const showCumulative = list.map((_, i) => !mobile || (n - 1 - i) % 2 === 0);
  if (mobile && selected >= 0) {
    showCumulative[selected] = true;
    if (selected > 0) showCumulative[selected - 1] = false;
    if (selected < n - 1) showCumulative[selected + 1] = false;
  }
  let svg = '';
  if (selected >= 0) svg += `<rect x="${(pad + slot * selected).toFixed(1)}" y="${g.capA + 8}" width="${slot.toFixed(1)}" height="${g.axis - g.capA - 2}" fill="#b08d3c" opacity=".1"/>`;
  svg += caption(g.capA, 'LỢI NHUẬN HÀNG THÁNG', 'triệu đồng');
  svg += rule(yBar(0));
  list.forEach((r, i) => {
    const edge = yBar(monthly[i]);
    const zero = yBar(0);
    const top = Math.min(edge, zero);
    const height = Math.max(Math.abs(zero - edge), 1.5);
    const loss = monthly[i] < 0;
    svg += `<rect x="${(x(i) - slot * 0.28).toFixed(1)}" y="${top.toFixed(1)}" width="${(slot * 0.56).toFixed(1)}" height="${height.toFixed(1)}" rx="2" fill="${loss ? '#b4372d' : i === selected ? '#b08d3c' : '#4f9d86'}"/>`;
    svg += label(x(i), loss ? top + height + font + 1 : top - 6, trieu(monthly[i]), loss ? '#b4372d' : i === selected ? '#8a6a22' : '#0c4a3f');
  });
  svg += caption(g.capB, 'LỢI NHUẬN LŨY KẾ TỪ ĐẦU NĂM', 'triệu đồng');
  svg += rule(yLine(0));
  const points = list.map((_, i) => `${x(i).toFixed(1)},${yLine(cumulative[i]).toFixed(1)}`);
  svg += `<polygon points="${x(0).toFixed(1)},${yLine(0).toFixed(1)} ${points.join(' ')} ${x(n - 1).toFixed(1)},${yLine(0).toFixed(1)}" fill="#0c4a3f" opacity=".08"/>`;
  svg += `<polyline points="${points.join(' ')}" fill="none" stroke="#0c4a3f" stroke-width="${mobile ? 2 : 3}" stroke-linecap="round" stroke-linejoin="round"/>`;
  list.forEach((r, i) => {
    const cy = yLine(cumulative[i]);
    const active = i === selected;
    svg += `<circle cx="${x(i).toFixed(1)}" cy="${cy.toFixed(1)}" r="${(mobile ? 3.5 : 5) + (active ? 2 : 0)}" fill="${active ? '#b08d3c' : '#0c4a3f'}" stroke="white" stroke-width="1.5"/>`;
    if (showCumulative[i]) svg += label(x(i), cy - (mobile ? 9 : 12), trieu(cumulative[i]), active ? '#8a6a22' : '#0c4a3f');
    svg += `<text x="${x(i).toFixed(1)}" y="${g.axis}" text-anchor="middle" font-size="${mobile ? 10 : 13}" font-weight="${active ? 800 : 700}" fill="${active ? '#0c4a3f' : '#475569'}">${mobile ? `T${Number(r.year_month.slice(5, 7))}` : `${r.year_month.slice(5, 7)}/${r.year_month.slice(2, 4)}`}</text>`;
    svg += `<rect class="bs-profit-hit" data-trend-month="${r.year_month}" x="${(pad + slot * i).toFixed(1)}" y="${g.capA + 8}" width="${slot.toFixed(1)}" height="${g.axis - g.capA + 6}" fill="transparent" tabindex="0" role="button" aria-label="${monthName(r.year_month)} · lợi nhuận hàng tháng ${money(monthly[i])}, lũy kế ${money(cumulative[i])}"/>`;
  });
  return `<svg class="${mobile ? 'bs-trend-mobile' : 'bs-trend-desktop'}" viewBox="0 0 ${width} ${g.height}" style="width:100%" role="img" aria-label="Lợi nhuận hàng tháng (cột) và lợi nhuận lũy kế từ đầu năm (đường) theo các tháng, đơn vị triệu đồng">${svg}</svg>`;
}

function profitSection(report) {
  const year = report.year_month.slice(0, 4);
  const yearList = reports.filter((r) => r.year_month.slice(0, 4) === year);
  const month = monthlyProfit(report);
  const previous = previousMonthReport(reports, report.year_month);
  const previousMonth = previous ? monthlyProfit(previous) : null;
  const end = report.figures.end;
  const figure = (title, value, base) => {
    const compact = value == null ? null : compactMoney(value);
    return `<div class="bs-pf"><span class="bs-pf-label">${title}</span><span class="bs-pf-value">${compact ? `${compact.num}<small>${compact.unit}</small>` : '—'}</span><span class="bs-pf-change">${compact ? change(value, base) : ''}</span></div>`;
  };
  return `<div class="card card-pad bs-section bs-profit-section" id="bs-sec-profit"><h3 class="bs-sec-h">Lợi nhuận</h3>
    <div class="bs-profit-figures">${figure('Lợi nhuận hàng tháng', month, previousMonth)}${figure('Lợi nhuận lũy kế', Number(end.profit) || 0, report.figures.start?.profit)}</div>
    <div class="bs-chart-scroll" data-chart="profit">${profitSvg(yearList, false)}${profitSvg(yearList, true)}</div>
    <p class="bs-chart-note">Tháng đang chọn tô vàng. Bấm vào một tháng để xem số liệu tháng đó.</p></div>`;
}

let trendScrollLeft = null;

function bindTrendPoints(root, onSelect) {
  root.querySelectorAll('.bs-chart-scroll').forEach((chart) => {
    const pick = (target) => {
      const point = target?.closest?.('[data-trend-month]');
      if (point) onSelect(point.dataset.trendMonth);
    };
    chart.addEventListener('click', (event) => pick(event.target));
    chart.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      pick(event.target);
    });
    if (chart.dataset.chart === 'profit') return;
    chart.scrollLeft = trendScrollLeft ?? chart.scrollWidth;
    trendScrollLeft = null;
  });
}

function stackedBar(items) {
  const parts = items.filter(([, value]) => value > 0);
  const sum = parts.reduce((total, [, value]) => total + value, 0) || 1;
  return `<div class="bs-stack" role="img" aria-label="Tỷ trọng các khoản">${parts.map(([label, value, color]) => `<i style="flex-grow:${(value / sum * 100).toFixed(2)};background:${color}" title="${label}"></i>`).join('')}</div>`;
}

function composition(title, items, total, totalLabel, { grossShares = false } = {}) {
  const chartTotal = items.reduce((sum, [, value]) => sum + Math.max(0, value || 0), 0) || 1;
  const base = grossShares ? chartTotal : total;
  const sign = (value) => (value < 0 ? '−' : '');
  const rows = items.map(([label, value, color]) => `<li class="${value < 0 ? 'bs-neg' : ''}"><i style="background:${color}"></i><span>${label}</span><small>${Number.isFinite(value) ? `${sign(value)}${(Math.abs(value) / 1e9).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tỷ` : '—'}</small><b>${Number.isFinite(value) && base ? `${sign(value)}${Math.abs(value / base * 100).toFixed(1).replace('.', ',')}%` : '—'}</b></li>`).join('');
  const compact = compactMoney(total);
  return `<h3>${title}</h3><span class="bs-comp-total"><small>${totalLabel}</small><b>${compact.num}<u>${compact.unit}</u></b></span>
    ${stackedBar(items)}<ul class="bs-comp-list">${rows}</ul>
    ${!grossShares && items.some(([, value]) => value < 0) ? '<p class="bs-chart-note">Khoản âm hiển thị trong danh sách, không vẽ thành lát trên biểu đồ.</p>' : ''}`;
}

function assetComposition(figures) {
  return composition('Cơ cấu tài sản', [
    ['Dư nợ cho vay', figures.grossLoans, '#0c4a3f'],
    ['Dự phòng rủi ro (trừ)', -(figures.totalProvision ?? figures.generalProvision + figures.specificProvision), '#a8402f'],
    ['Tiền gửi tại TCTD', figures.tctdDeposits, '#b08d3c'],
    ['Lãi, phí phải thu', figures.accruedReceivables, '#dcc27d'],
    ['Tiền mặt', figures.cash, '#7fa597'],
    ['TSCĐ, vốn góp NHHTX và tài sản khác', figures.fixedCapital + figures.internalReceivables + figures.otherAssets, '#b9c4bf'],
  ], figures.assets, 'Tổng tài sản', { grossShares: true });
}

function fundingComposition(figures) {
  return composition('Cơ cấu nguồn vốn', [
    ['Tiền gửi khách hàng', figures.customerDeposits, '#0c4a3f'],
    ['Lãi và phí phải trả', figures.interestPayable, '#dcc27d'],
    ['Nợ phải trả khác', figures.otherLiabilities, '#b9c4bf'],
    ['Vốn chủ sở hữu', figures.equity, '#b08d3c'],
    ['Lợi nhuận lũy kế', figures.profit, '#7fa597'],
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

  const today = new Date();
  const live = !snapshotProvision && S.isSuperAdmin(S.getSession()?.id)
    ? S.provisionSummary(S.getState().contracts, today) : null;
  const remote = remoteProvisions.get(report.year_month);
  const app = snapshotProvision || live || (remote?.error ? null : remote);
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const isUnclosedMonth = report.year_month >= currentMonth;

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
  return `<div class="card card-pad bs-section bs-provision-section" id="bs-sec-prov"><h3 class="bs-sec-h">Trích lập dự phòng${isUnclosedMonth ? ' <span class="bs-provision-pending">(Chưa chốt số liệu tháng này)</span>' : ''}</h3>
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
  const previousDecember = report ? previousDecemberReport(reports, report.year_month) : null;
  const fundingYearStart = { ...yearStart, equity: previousDecember?.figures?.end?.equity };
  const equityParts = end?.equityParts;
  const hasEquityHistory = report && historicAccountLines(reports, report.year_month, 'equityOther').length > 0;
  const assetItems = report ? [
    { label: 'Tiền mặt tại đơn vị', key: 'cash' },
    { label: 'Tiền gửi tại các TCTD', key: 'tctdDeposits', children: [['Không kỳ hạn', 'tctdDemand'], ['Có kỳ hạn', 'tctdTerm']] },
    { label: 'Dư nợ cho vay', key: 'grossLoans', children: [['Dự phòng chung', 'generalProvision'], ['Dự phòng cụ thể', 'specificProvision']] },
    ...(Number.isFinite(end.fixedAssetsNet) && Number.isFinite(end.capitalContribution)
      ? [{ label: 'TSCĐ sau hao mòn', key: 'fixedAssetsNet' }, { label: 'Vốn góp NHHTX', key: 'capitalContribution' }]
      : [{ label: 'TSCĐ ròng và vốn góp NHHTX', key: 'fixedCapital' }]),
    { label: 'Phải thu nội bộ', key: 'internalReceivables', detailHtml: accountLinesHtml(report, 'internalReceivables') },
    { label: 'Lãi và phí phải thu', key: 'accruedReceivables', detailHtml: accountLinesHtml(report, 'accruedReceivables') },
    ...(end.otherAssets || start.otherAssets || reports.some((item) => item.year_month?.slice(0, 4) === report.year_month.slice(0, 4)
      && item.year_month <= report.year_month && item.figures?.end?.otherAssets)
      ? [{ label: 'Tài sản khác', key: 'otherAssets' }] : []),
  ] : [];
  const equityDetails = equityParts ? `
    ${equityPartRow('Vốn điều lệ', 'charterCapital', report, yearStart)}
    ${equityPartRow('Quỹ dự trữ bổ sung vốn điều lệ', 'supplementaryReserve', report, yearStart)}
    ${equityPartRow('Quỹ đầu tư phát triển', 'developmentReserve', report, yearStart)}
    ${equityPartRow('Quỹ dự phòng tài chính', 'financialReserve', report, yearStart)}
    ${equityParts.otherEquity || start.equityParts?.otherEquity || yearStart?.equityParts?.otherEquity || hasEquityHistory
      ? equityPartRow('Lợi nhuận chưa phân phối', 'otherEquity', report, yearStart) : ''}`
    : '<p class="bs-management-hint">Cần nạp lại file kỳ này để hiển thị vốn điều lệ và các quỹ.</p>';
  const fundingItems = report ? [
    { label: 'Tiền gửi khách hàng', key: 'customerDeposits' },
    { label: 'Lãi và phí phải trả', key: 'interestPayable' },
    { label: 'Nợ phải trả khác', key: 'otherLiabilities', detailHtml: accountLinesHtml(report, 'otherLiabilities') },
    { label: 'Vốn chủ sở hữu', key: 'equity', detailHtml: equityDetails },
    { label: 'Lợi nhuận lũy kế', key: 'profit', options: { noYear: true, profitDetail: true } },
  ] : [];
  const dateText = report ? reportDate(report.period_end) : '';

  const periodIndex = reports.findIndex((r) => r.year_month === selectedMonth);
  const barHtml = `<div class="bs-bar">
    ${report ? `<div class="bs-bar-date"><small><span class="bs-wide-only">Số liệu </span>đến ngày</small><b>${dateText}</b></div>` : ''}
    ${reports.length ? `<label class="bs-bar-period"><small>Kỳ báo cáo</small><span class="bs-period-row"><select id="bs-month">${[...reports].reverse().map((r) => `<option value="${r.year_month}" ${r.year_month === selectedMonth ? 'selected' : ''}>${r.year_month.slice(5, 7)}/${r.year_month.slice(0, 4)}</option>`).join('')}</select>${periodStepperHtml({ canPrev: periodIndex > 0, canNext: periodIndex < reports.length - 1 })}</span></label>` : ''}
    <div class="bs-bar-tools"><button type="button" class="bs-ibtn" id="bs-refresh" title="Làm mới" aria-label="Làm mới">${icon('refresh')}</button>${superAdmin ? `<button type="button" class="bs-ibtn" id="bs-import" title="Nạp cân đối" aria-label="Nạp cân đối">${icon('upload')}</button><input type="file" id="bs-file" accept=".xls,.xlsx" multiple hidden>` : ''}</div></div>`;
  const ratiosHtml = report ? ratiosSection(end) : '';

  contentEl.innerHTML = `<div class="bs-lux">
    <div class="bs-sticky">${barHtml}</div>
    <div class="bs-doc">
    ${report ? `<header class="bs-doc-head"><div class="bs-doc-org">${escapeHtml(S.getOrg()?.shortName || 'QTD Bình Nguyên')} · Báo cáo số liệu quản trị</div><h1>${monthName(report.year_month)}</h1><div class="bs-doc-asof">Số liệu đến ngày ${dateText}</div></header>` : ''}
    <div class="bs-hero" id="bs-sec-summary">${report ? `<h3 class="bs-sec-h bs-d-only">Tổng hợp</h3>
      <div class="grid-4 bs-stats">
        ${stat('Tổng tài sản', end.assets, start.assets, 'c-green')}
        ${stat('Tiền gửi khách hàng', end.customerDeposits, start.customerDeposits, 'c-blue')}
        ${stat('Tiền gửi tại TCTD', end.tctdDeposits, start.tctdDeposits, 'c-orange')}
        ${stat('Lợi nhuận lũy kế', end.profit, start.profit, 'c-pink', true)}
      </div>` : ''}</div>
    ${!report ? `<div class="card card-pad"><p>Chưa có bảng cân đối nào. Quản trị viên toàn quyền có thể nạp file .xls hoặc .xlsx của từng tháng.</p></div>` : `
    <div class="card card-pad bs-section bs-trend-section" id="bs-sec-trend"><h3 class="bs-sec-h">Biến động</h3>${trendChart(reports)}</div>
    ${profitSection(report)}
    <div class="bs-comp-wrap" id="bs-sec-comp"><h3 class="bs-sec-h bs-d-only">Cơ cấu</h3><div class="bs-two-col"><div class="card card-pad bs-section bs-comp-card">${assetComposition(end)}</div>
      <div class="card card-pad bs-section bs-comp-card">${fundingComposition(end)}</div></div></div>
    <div class="bs-management bs-section" id="bs-sec-mgmt"><div class="bs-management-title"><h3 class="bs-sec-h">Cân đối rút gọn</h3></div>
      ${managementSection('Tài sản', `${numberedManagementRows(assetItems, start, end, yearStart, 'ts')}
        ${managementRow('Tổng tài sản', 'assets', start, end, yearStart, { total: true })}`)}
      ${managementSection('Nguồn vốn', `${numberedManagementRows(fundingItems, start, end, fundingYearStart, 'nv')}
        ${managementRow('Tổng nguồn vốn', 'liabilities', start, end, yearStart, { total: true })}`)}
      <p class="bs-balance-note">Chênh lệch Tài sản − Nguồn vốn cuối kỳ: <strong>${signed(end.assets - end.liabilities)}</strong></p></div>
    ${provisionComparison(report)}
    ${ratiosHtml}`}</div></div>`;

  contentEl.querySelectorAll('.bs-bar .period-step-btn').forEach((button) => button.addEventListener('click', () => {
    const target = reports[reports.findIndex((r) => r.year_month === selectedMonth) + Number(button.dataset.step)];
    if (!target) return;
    const scrollY = window.scrollY;
    selectedMonth = target.year_month;
    remoteProvisions.delete(selectedMonth);
    draw(contentEl);
    window.scrollTo(0, scrollY);
  }));
  contentEl.querySelector('#bs-month')?.addEventListener('change', (event) => {
    selectedMonth = event.target.value;
    remoteProvisions.delete(selectedMonth);
    draw(contentEl);
  });
  if (report && !superAdmin && !S.provisionFromSnapshot(S.listMonthlySnapshots().find((x) => x.yearMonth === report.year_month))) {
    void loadRemoteProvision(report.year_month, contentEl);
  }
  bindTrendPoints(contentEl, (yearMonth) => {
    if (yearMonth === selectedMonth) return;
    trendScrollLeft = contentEl.querySelector('.bs-chart-scroll:not([data-chart])')?.scrollLeft ?? null;
    const scrollY = window.scrollY;
    selectedMonth = yearMonth;
    remoteProvisions.delete(selectedMonth);
    draw(contentEl);
    window.scrollTo(0, scrollY);
  });
  contentEl.querySelector('#bs-profit-details')?.addEventListener('click', () => showProfitDetails(report));
  contentEl.querySelector('[data-profit-details]')?.addEventListener('click', () => showProfitDetails(report));
  contentEl.querySelectorAll('[data-expand]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.expand;
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    button.closest('.bs-management-row')?.classList.toggle('is-open', open);
    contentEl.querySelector(`[data-sub="${id}"]`)?.classList.toggle('is-open', open);
    if (open) openRows.add(id); else openRows.delete(id);
  }));
  contentEl.querySelector('#bs-refresh')?.addEventListener('click', () => { reloadFromServer(contentEl); });
  contentEl.querySelector('#bs-import')?.addEventListener('click', () => contentEl.querySelector('#bs-file')?.click());
  contentEl.querySelector('#bs-file')?.addEventListener('change', async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (files.length) await previewImport(files, contentEl);
  });
}

async function previewImport(files, contentEl) {
  const importButton = contentEl.querySelector('#bs-import');
  if (importButton) importButton.disabled = true;
  try {
    const imports = [];
    for (const [index, file] of files.entries()) {
      if (importButton) importButton.textContent = `Đang đọc ${index + 1}/${files.length}...`;
      if (!/\.xlsx?$/i.test(file.name)) throw new Error(`${file.name}: Chỉ nhận file .xls hoặc .xlsx.`);
      if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name}: File vượt quá 10 MB.`);
      try {
        imports.push({ file, parsed: parseBalanceSheetRows(await readExcelFirstSheet(file)) });
      } catch (error) {
        throw new Error(`${file.name}: ${error.message || 'Không đọc được file.'}`);
      }
    }
    const { selected, skipped } = selectLatestBalanceImports(imports);
    openModal({
      title: selected.length === 1 ? `Kiểm tra ${monthName(selected[0].parsed.yearMonth)}` : `Kiểm tra ${selected.length} kỳ cân đối`,
      bodyHtml: `<p>Đã kiểm tra cân đối đầu kỳ và cuối kỳ cho ${imports.length} file. Mỗi tháng chỉ lưu bản có ngày số liệu mới nhất trong lượt nạp này.</p>
        <div class="bs-import-list">${selected.map(({ file, parsed }) => {
          const existing = reports.find((item) => item.year_month === parsed.yearMonth);
          return `<div class="bs-import-item"><strong>${monthName(parsed.yearMonth)} · đến ngày ${reportDate(parsed.periodEnd)}</strong>
            <small>${escapeHtml(file.name)}</small>
            <div><span>Tổng tài sản đầu kỳ</span><b>${money(parsed.start.assets)}</b></div>
            <div><span>Tổng tài sản cuối kỳ</span><b>${money(parsed.end.assets)}</b></div>
            <div><span>Dự phòng chung / cụ thể</span><b>${money(parsed.end.generalProvision)} / ${money(parsed.end.specificProvision)}</b></div>
            ${existing ? `<p class="bs-warning">Sẽ thay bản ${monthName(parsed.yearMonth)} đang lưu (đến ngày ${reportDate(existing.period_end)}).</p>` : ''}</div>`;
        }).join('')}</div>
        ${skipped.length ? `<p class="bs-account-period">Bỏ qua ${skipped.length} file cũ hơn trong cùng tháng: ${skipped.map(({ file }) => escapeHtml(file.name)).join(', ')}.</p>` : ''}`,
      footHtml: '<button class="btn btn-outline" data-cancel>Hủy</button><button class="btn btn-primary" data-save>Lưu số liệu</button>',
      onMount(sheet, close) {
        sheet.querySelector('[data-cancel]').addEventListener('click', close);
        sheet.querySelector('[data-save]').addEventListener('click', async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          const session = S.getSession();
          if (!S.isSuperAdmin(session?.id)) { toast('Chỉ quản trị viên toàn quyền được nạp file.', 'error'); close(); return; }
          const importedAt = new Date().toISOString();
          const rows = selected.map(({ file, parsed }) => ({
            year_month: parsed.yearMonth, period_end: parsed.periodEnd,
            source_name: file.name, figures: { start: parsed.start, end: parsed.end },
            imported_by: session.id, imported_at: importedAt,
          }));
          const { error } = await makeClient().from('balance_sheet_reports').upsert(rows, { onConflict: 'year_month' });
          if (error) { toast(`Không lưu được: ${error.message}`, 'error'); button.disabled = false; return; }
          selectedMonth = selected.at(-1).parsed.yearMonth;
          close();
          toast(`Đã lưu ${selected.length} kỳ cân đối`, 'success');
          await reloadFromServer(contentEl);
        });
      },
    });
  } catch (error) {
    toast(error.message || 'Không đọc được file bảng cân đối.', 'error');
  } finally {
    if (importButton) { importButton.disabled = false; importButton.textContent = 'Nạp cân đối'; }
  }
}
