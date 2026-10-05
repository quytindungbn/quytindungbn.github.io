import * as S from '../../state.js';
import { pageHeader } from '../../components/shell.js';
import { openModal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { readExcelFirstSheet } from '../../lib/excelLite.js';
import { parseBalanceSheetRows } from '../../lib/balanceSheet.js';
import { getSupabaseClient } from '../../lib/supabaseClient.js';
import { escapeHtml, formatNumber, formatVND, formatCompact } from '../../utils.js';

let reports = [];
let selectedMonth = null;
let loadedFor = null;
let requestId = 0;

const monthName = (ym) => `Tháng ${Number(ym.slice(5))}/${ym.slice(0, 4)}`;
const money = (value) => formatVND(value || 0);
const signed = (value) => `${value > 0 ? '+' : ''}${formatNumber(value)} ₫`;
const row = (label, start, end, strong = false) => `
  <tr class="${strong ? 'bs-strong' : ''}"><th scope="row">${label}</th><td>${money(start)}</td><td>${money(end)}</td><td class="${end - start < 0 ? 'bs-negative' : ''}">${signed(end - start)}</td></tr>`;

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
}

export async function render(contentEl) {
  resetIfChangedUser();
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
  if (!reports.some((r) => r.year_month === selectedMonth)) selectedMonth = reports.at(-1)?.year_month || null;
  draw(contentEl);
}

function stat(label, value, note, color) {
  return `<div class="stat-tile ${color}"><div class="stat-label">${label}</div><div class="stat-value bs-stat-value">${money(value)}</div><div class="stat-trend">${note}</div></div>`;
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
  return `<div class="card card-pad bs-section"><h3>Đối chiếu dự phòng với app</h3>
    <p class="text-sm text-muted">So sánh số dư cuối kỳ tài khoản 2192 (chung), 2191 (cụ thể) với dữ liệu app đã chốt cùng tháng. Chênh lệch = app trừ bảng cân đối.</p>
    ${snap?.snapshotDate && snap.snapshotDate !== report.period_end ? `<p class="bs-warning">Ngày chốt trên app (${escapeHtml(snap.snapshotDate)}) khác ngày cuối kỳ của file (${escapeHtml(report.period_end)}); chỉ dùng số chênh lệch để tham khảo.</p>` : ''}
    <div class="bs-table-wrap"><table class="bs-table"><thead><tr><th>Khoản mục</th><th>Bảng cân đối</th><th>App</th><th>Chênh lệch</th></tr></thead><tbody>
      ${compare('Dự phòng chung', end.generalProvision, snap?.generalProvision)}
      ${compare('Dự phòng cụ thể', end.specificProvision, snap?.specificProvision)}
      ${compare('Tổng dự phòng', end.generalProvision + end.specificProvision,
        Number.isFinite(snap?.generalProvision) && Number.isFinite(snap?.specificProvision) ? snap.generalProvision + snap.specificProvision : null)}
    </tbody></table></div></div>`;
}

function draw(contentEl) {
  const superAdmin = S.isSuperAdmin(S.getSession()?.id);
  const report = reports.find((r) => r.year_month === selectedMonth);
  contentEl.innerHTML = `<div class="bs-toolbar"><div><h2>Cân đối kế toán theo tháng</h2><p class="text-sm text-muted">Số liệu lấy từ bảng cân đối tài khoản A01/QTDCS, lưu theo ngày cuối kỳ.</p></div>
    <div class="bs-toolbar-actions">${reports.length ? `<label class="bs-month-select">Kỳ báo cáo <select id="bs-month">${[...reports].reverse().map((r) => `<option value="${r.year_month}" ${r.year_month === selectedMonth ? 'selected' : ''}>${monthName(r.year_month)}</option>`).join('')}</select></label>` : ''}
    ${superAdmin ? '<button class="btn btn-primary" id="bs-import">Nạp bảng cân đối</button><input type="file" id="bs-file" accept=".xls,.xlsx" hidden>' : ''}</div></div>
    ${!report ? `<div class="card card-pad"><p>Chưa có bảng cân đối nào. Quản trị viên toàn quyền có thể nạp file .xls hoặc .xlsx của từng tháng.</p></div>` : `
    <p class="bs-source">${monthName(report.year_month)} · chốt ngày ${report.period_end.split('-').reverse().join('/')} · file ${escapeHtml(report.source_name)}</p>
    <div class="grid-4 bs-stats">
      ${stat('Tổng tài sản', report.figures.end.assets, `Biến động: ${signed(report.figures.end.assets - report.figures.start.assets)}`, 'c-green')}
      ${stat('Tiền gửi khách hàng', report.figures.end.customerDeposits, `Biến động: ${signed(report.figures.end.customerDeposits - report.figures.start.customerDeposits)}`, 'c-blue')}
      ${stat('Tiền và tiền gửi TCTD', report.figures.end.liquidity, 'Tiền mặt + tiền gửi TCTD', 'c-orange')}
      ${stat('Lợi nhuận lũy kế', report.figures.end.profit, `Biến động trong tháng: ${signed(report.figures.end.profit - report.figures.start.profit)}`, 'c-pink')}
    </div>
    <div class="bs-two-col"><div class="card card-pad bs-section"><h3>Biến động qua các kỳ đã nạp</h3>${trendChart(reports)}</div>
      <div class="card card-pad bs-section"><h3>Cơ cấu tài sản cuối kỳ</h3>${composition(report.figures.end)}</div></div>
    <div class="card card-pad bs-section"><h3>Chi tiết đầu kỳ – cuối kỳ</h3><p class="text-sm text-muted">Tổng tài sản đã trừ dự phòng rủi ro và hao mòn TSCĐ. Các số trên cùng dòng đầu/cuối kỳ lấy trực tiếp từ số dư kế toán.</p>
      <div class="bs-table-wrap"><table class="bs-table"><thead><tr><th>Khoản mục</th><th>Đầu kỳ</th><th>Cuối kỳ</th><th>Biến động</th></tr></thead><tbody>
        ${row('Tiền mặt tại đơn vị', report.figures.start.cash, report.figures.end.cash)}
        ${row('Tiền gửi tại các TCTD', report.figures.start.tctdDeposits, report.figures.end.tctdDeposits)}
        ${row('↳ Không kỳ hạn tại TCTD', report.figures.start.tctdDemand, report.figures.end.tctdDemand)}
        ${row('↳ Có kỳ hạn tại TCTD', report.figures.start.tctdTerm, report.figures.end.tctdTerm)}
        ${row('Dư nợ cho vay', report.figures.start.grossLoans, report.figures.end.grossLoans)}
        ${row('Trừ: dự phòng chung', -report.figures.start.generalProvision, -report.figures.end.generalProvision)}
        ${row('Trừ: dự phòng cụ thể', -report.figures.start.specificProvision, -report.figures.end.specificProvision)}
        ${row('TSCĐ ròng + góp vốn', report.figures.start.fixedCapital, report.figures.end.fixedCapital)}
        ${row('Phải thu nội bộ', report.figures.start.internalReceivables, report.figures.end.internalReceivables)}
        ${row('Lãi và phí phải thu', report.figures.start.accruedReceivables, report.figures.end.accruedReceivables)}
        ${report.figures.end.otherAssets || report.figures.start.otherAssets ? row('Tài sản Có khác', report.figures.start.otherAssets, report.figures.end.otherAssets) : ''}
        ${row('TỔNG TÀI SẢN', report.figures.start.assets, report.figures.end.assets, true)}
        ${row('Tiền gửi khách hàng', report.figures.start.customerDeposits, report.figures.end.customerDeposits)}
        ${row('Lãi và phí phải trả', report.figures.start.interestPayable, report.figures.end.interestPayable)}
        ${row('Nợ phải trả khác', report.figures.start.otherLiabilities, report.figures.end.otherLiabilities)}
        ${row('Vốn chủ sở hữu', report.figures.start.equity, report.figures.end.equity)}
        ${row('Lợi nhuận lũy kế', report.figures.start.profit, report.figures.end.profit)}
        ${row('TỔNG NGUỒN VỐN', report.figures.start.liabilities, report.figures.end.liabilities, true)}
      </tbody></table></div><p class="bs-balance-note">Chênh lệch Tài sản − Nguồn vốn: <strong>0 ₫</strong> ở cả đầu kỳ và cuối kỳ.</p></div>
    ${provisionComparison(report)}`}`;
  contentEl.querySelector('#bs-month')?.addEventListener('change', (event) => {
    selectedMonth = event.target.value;
    draw(contentEl);
  });
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
          await render(contentEl);
        });
      },
    });
  } catch (error) {
    toast(error.message || 'Không đọc được file bảng cân đối.', 'error');
  }
}
