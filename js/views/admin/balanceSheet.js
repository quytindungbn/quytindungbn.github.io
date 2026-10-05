import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { readExcelFirstSheet } from '../../lib/excelLite.js';
import { parseBalanceSheetRows } from '../../lib/balanceSheet.js';
import { compareBalance, priorYearEndReport } from '../../lib/balanceSheetMetrics.js';
import { getSupabaseClient } from '../../lib/supabaseClient.js';
import { escapeHtml, formatNumber, formatVND, formatCompact } from '../../utils.js';

let reports = [];
let selectedMonth = null;
let loadedFor = null;
let hasLoaded = false;
let requestId = 0;

const monthName = (ym) => `Tháng ${Number(ym.slice(5))}/${ym.slice(0, 4)}`;
const money = (value) => formatVND(value || 0);
const signed = (value) => `${value > 0 ? '+' : ''}${formatNumber(value)} ₫`;
const percent = (value) => `${value > 0 ? '+' : ''}${new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(value)}%`;

function change(current, base) {
  const result = compareBalance(current, base);
  if (!result) return '<span class="text-muted">—</span>';
  const tone = result.amount < 0 ? 'bs-negative' : result.amount > 0 ? 'bs-positive' : '';
  return `<span class="bs-change ${tone}"><strong>${signed(result.amount)}</strong><small>${result.percent == null ? '—' : percent(result.percent)}</small></span>`;
}

function managementRow(label, key, start, end, yearEnd, { total = false, child = false } = {}) {
  return `<div class="bs-management-row ${total ? 'bs-management-total' : ''} ${child ? 'bs-management-child' : ''}">
    <div class="bs-management-name">${label}</div>
    <div class="bs-management-value" data-label="Cuối kỳ">${money(end[key])}</div>
    <div class="bs-management-value" data-label="Trong tháng">${change(end[key], start[key])}</div>
    <div class="bs-management-value" data-label="Từ đầu năm">${change(end[key], yearEnd?.[key])}</div>
  </div>`;
}

function equityPartRow(label, key, report, yearEnd) {
  return managementRow(label, key, report.figures.start.equityParts || {},
    report.figures.end.equityParts || {}, yearEnd?.equityParts, { child: true });
}

function managementSection(title, rows) {
  return `<section class="card bs-management-section"><h4>${title}</h4>
    <div class="bs-management-head"><span>Khoản mục</span><span>Cuối kỳ</span><span>Trong tháng</span><span>Từ đầu năm</span></div>
    ${rows}</section>`;
}

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Cân đối kế toán' });
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
}

export async function render(contentEl) {
  resetIfChangedUser();
  if (hasLoaded) { draw(contentEl); return; }
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

function stat(label, value, startValue, color) {
  return `<div class="stat-tile ${color}"><div class="stat-label">${label}</div><div class="stat-value bs-stat-value">${money(value)}</div><div class="stat-trend">${change(value, startValue)}</div></div>`;
}

function trendChart(list) {
  if (!list.length) return '<p class="text-muted text-sm">Chưa có tháng nào để vẽ biểu đồ.</p>';
  const shown = list.slice(-12);
  const values = shown.flatMap((r) => [Number(r.figures.end.assets), Number(r.figures.end.customerDeposits)]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const base = Math.max(0, min - (max - min || max * 0.05) * 0.35);
  const span = Math.max(1, max - base);
  const left = 58, right = 645, top = 22, bottom = 190;
  const x = (i) => shown.length === 1 ? (left + right) / 2 : left + (right - left) * i / (shown.length - 1);
  const y = (v) => bottom - (v - base) / span * (bottom - top);
  const series = [
    { key: 'assets', label: 'Tổng tài sản', color: '#087d6a' },
    { key: 'customerDeposits', label: 'Tiền gửi khách hàng', color: '#2f69d9' },
  ];
  const lines = [0, 0.5, 1].map((p) => {
    const yy = bottom - (bottom - top) * p;
    return `<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="#e2e8f0"/><text x="${left - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#64748b">${formatCompact(base + span * p)}</text>`;
  }).join('');
  const plots = series.map((s) => {
    const points = shown.map((r, i) => `${x(i)},${y(Number(r.figures.end[s.key]))}`).join(' ');
    return `<polyline points="${points}" fill="none" stroke="${s.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${shown.map((r, i) => `<circle cx="${x(i)}" cy="${y(Number(r.figures.end[s.key]))}" r="5" fill="${s.color}"><title>${monthName(r.year_month)} · ${s.label}: ${money(r.figures.end[s.key])}</title></circle>`).join('')}`;
  }).join('');
  const labels = shown.map((r, i) => `<text x="${x(i)}" y="215" text-anchor="middle" font-size="11" fill="#64748b">${Number(r.year_month.slice(5))}/${r.year_month.slice(2, 4)}</text>`).join('');
  return `<div class="bs-chart-scroll"><svg viewBox="0 0 680 230" role="img" aria-label="Biến động tổng tài sản và tiền gửi khách hàng theo tháng">${lines}${plots}${labels}</svg></div>
    <div class="bs-chart-legend"><span><i style="background:#087d6a"></i>Tổng tài sản</span><span><i style="background:#2f69d9"></i>Tiền gửi khách hàng</span></div>`;
}

function composition(figures) {
  const items = [
    ['Dư nợ sau dự phòng', figures.loanNet, '#087d6a'],
    ['Tiền gửi tại TCTD', figures.tctdDeposits, '#2f69d9'],
    ['Lãi, phí phải thu', figures.accruedReceivables, '#e69910'],
    ['Tiền mặt', figures.cash, '#b066c6'],
    ['TSCĐ, góp vốn và khoản khác', figures.fixedCapital + figures.internalReceivables + figures.otherAssets, '#8996a8'],
  ];
  const total = figures.assets || 1;
  let offset = 0;
  const stops = items.map(([, value, color]) => {
    const start = offset;
    offset += value / total * 100;
    return `${color} ${start}% ${offset}%`;
  }).join(',');
  return `<div class="bs-composition"><div class="bs-donut" style="background:conic-gradient(${stops})"><div>${formatCompact(figures.assets)}<small>Tổng tài sản</small></div></div>
    <div class="bs-composition-list">${items.map(([label, value, color]) => `<div><span><i style="background:${color}"></i>${label}</span><strong>${(value / total * 100).toFixed(1).replace('.', ',')}%</strong><small>${money(value)}</small></div>`).join('')}</div></div>`;
}

function provisionComparison(report) {
  const snap = S.listMonthlySnapshots().find((x) => x.yearMonth === report.year_month);
  const end = report.figures.end;
  const compare = (label, fileValue, appValue) => {
    const available = Number.isFinite(appValue);
    const gap = available ? appValue - fileValue : null;
    return `<tr><th scope="row">${label}</th><td>${money(fileValue)}</td><td>${available ? money(appValue) : 'Chưa có số liệu'}</td><td class="${gap == null ? '' : gap === 0 ? 'bs-match' : 'bs-negative'}">${gap == null ? '—' : signed(gap)}</td></tr>`;
  };
  return `<div class="card card-pad bs-section"><h3>Trích lập dự phòng</h3>
    ${snap?.snapshotDate && snap.snapshotDate !== report.period_end ? `<p class="bs-warning">Ngày chốt trên app (${escapeHtml(snap.snapshotDate)}) khác ngày cuối kỳ của file (${escapeHtml(report.period_end)}); chỉ dùng số chênh lệch để tham khảo.</p>` : ''}
    <div class="bs-table-wrap"><table class="bs-table"><thead><tr><th>Khoản mục</th><th>Bảng cân đối</th><th>Phải trích</th><th>Chênh lệch</th></tr></thead><tbody>
      ${compare('Dự phòng chung', end.generalProvision, snap?.generalProvision)}
      ${compare('Dự phòng cụ thể', end.specificProvision, snap?.specificProvision)}
      ${compare('Tổng dự phòng', end.generalProvision + end.specificProvision,
        Number.isFinite(snap?.generalProvision) && Number.isFinite(snap?.specificProvision) ? snap.generalProvision + snap.specificProvision : null)}
    </tbody></table></div></div>`;
}

function draw(contentEl) {
  const superAdmin = S.isSuperAdmin(S.getSession()?.id);
  const report = reports.find((r) => r.year_month === selectedMonth);
  const end = report?.figures.end;
  const start = report?.figures.start;
  const yearEndReport = report ? priorYearEndReport(reports, report.year_month) : null;
  const yearEnd = yearEndReport?.figures.end;
  const equityParts = end?.equityParts;
  contentEl.innerHTML = `<div class="bs-toolbar"><h2>Cân đối kế toán theo tháng</h2>
    <div class="bs-toolbar-actions">${reports.length ? `<label class="bs-month-select">Kỳ báo cáo <select id="bs-month">${[...reports].reverse().map((r) => `<option value="${r.year_month}" ${r.year_month === selectedMonth ? 'selected' : ''}>${monthName(r.year_month)}</option>`).join('')}</select></label>` : ''}
    <button class="btn btn-outline" id="bs-refresh" type="button">Làm mới</button>
    ${superAdmin ? '<button class="btn btn-primary" id="bs-import">Nạp bảng cân đối</button><input type="file" id="bs-file" accept=".xls,.xlsx" hidden>' : ''}</div></div>
    ${!report ? `<div class="card card-pad"><p>Chưa có bảng cân đối nào. Quản trị viên toàn quyền có thể nạp file .xls hoặc .xlsx của từng tháng.</p></div>` : `
    <div class="grid-4 bs-stats">
      ${stat('Tổng tài sản', end.assets, start.assets, 'c-green')}
      ${stat('Tiền gửi khách hàng', end.customerDeposits, start.customerDeposits, 'c-blue')}
      ${stat('Tiền gửi tại TCTD', end.tctdDeposits, start.tctdDeposits, 'c-orange')}
      ${stat('Lợi nhuận lũy kế', end.profit, start.profit, 'c-pink')}
    </div>
    <div class="bs-two-col"><div class="card card-pad bs-section"><h3>Biến động</h3>${trendChart(reports)}</div>
      <div class="card card-pad bs-section"><h3>Cơ cấu tài sản cuối kỳ</h3>${composition(end)}</div></div>
    <div class="bs-management bs-section"><div class="bs-management-title"><h3>Chỉ tiêu quản trị</h3><span>${yearEndReport ? `So với cuối năm ${Number(report.year_month.slice(0, 4)) - 1}` : `Chưa có kỳ 12/${Number(report.year_month.slice(0, 4)) - 1} để so sánh đầu năm`}</span></div>
      ${managementSection('Tài sản', `
        ${managementRow('Tiền mặt tại đơn vị', 'cash', start, end, yearEnd)}
        ${managementRow('Tiền gửi tại các TCTD', 'tctdDeposits', start, end, yearEnd)}
        ${managementRow('↳ Không kỳ hạn', 'tctdDemand', start, end, yearEnd, { child: true })}
        ${managementRow('↳ Có kỳ hạn', 'tctdTerm', start, end, yearEnd, { child: true })}
        ${managementRow('Dư nợ sau dự phòng', 'loanNet', start, end, yearEnd)}
        ${managementRow('↳ Dư nợ cho vay', 'grossLoans', start, end, yearEnd, { child: true })}
        ${managementRow('↳ Dự phòng chung', 'generalProvision', start, end, yearEnd, { child: true })}
        ${managementRow('↳ Dự phòng cụ thể', 'specificProvision', start, end, yearEnd, { child: true })}
        ${managementRow('TSCĐ ròng và góp vốn', 'fixedCapital', start, end, yearEnd)}
        ${managementRow('Phải thu nội bộ', 'internalReceivables', start, end, yearEnd)}
        ${managementRow('Lãi và phí phải thu', 'accruedReceivables', start, end, yearEnd)}
        ${end.otherAssets || start.otherAssets ? managementRow('Tài sản khác', 'otherAssets', start, end, yearEnd) : ''}
        ${managementRow('Tổng tài sản', 'assets', start, end, yearEnd, { total: true })}`)}
      ${managementSection('Nguồn vốn', `
        ${managementRow('Tiền gửi khách hàng', 'customerDeposits', start, end, yearEnd)}
        ${managementRow('Lãi và phí phải trả', 'interestPayable', start, end, yearEnd)}
        ${managementRow('Nợ phải trả khác', 'otherLiabilities', start, end, yearEnd)}
        ${managementRow('Vốn chủ sở hữu', 'equity', start, end, yearEnd)}
        ${equityParts ? `
          ${equityPartRow('↳ Vốn điều lệ', 'charterCapital', report, yearEnd)}
          ${equityPartRow('↳ Quỹ dự trữ bổ sung vốn điều lệ', 'supplementaryReserve', report, yearEnd)}
          ${equityPartRow('↳ Quỹ đầu tư phát triển', 'developmentReserve', report, yearEnd)}
          ${equityPartRow('↳ Quỹ dự phòng tài chính', 'financialReserve', report, yearEnd)}
          ${equityParts.otherEquity || start.equityParts?.otherEquity ? equityPartRow('↳ Vốn chủ sở hữu khác', 'otherEquity', report, yearEnd) : ''}` : '<p class="bs-management-hint">Cần nạp lại file kỳ này để hiển thị vốn điều lệ và các quỹ.</p>'}
        ${managementRow('Lợi nhuận lũy kế', 'profit', start, end, yearEnd)}
        ${managementRow('Tổng nguồn vốn', 'liabilities', start, end, yearEnd, { total: true })}`)}
      <p class="bs-balance-note">Chênh lệch Tài sản − Nguồn vốn cuối kỳ: <strong>${signed(end.assets - end.liabilities)}</strong></p></div>
    ${provisionComparison(report)}`}`;
  contentEl.querySelector('#bs-month')?.addEventListener('change', (event) => {
    selectedMonth = event.target.value;
    draw(contentEl);
  });
  contentEl.querySelector('#bs-refresh')?.addEventListener('click', () => { hasLoaded = false; render(contentEl); });
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
