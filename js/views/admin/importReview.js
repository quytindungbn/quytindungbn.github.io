// Xem trước + lịch sử + quay lại bản trước cho việc nhập file Excel — CHỈ tài
// khoản toàn quyền (nút nhập chỉ hiện cho họ, máy chủ cũng chặn các type
// 'import-*' với người khác). Dữ liệu danh sách do Edge Function create-account
// tính sẵn (xem 'import-preview'/'import-history'), file này chỉ hiển thị.
import { icon } from '../../icons.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import * as S from '../../state.js';
import { formatVND, formatDate, formatDateTime, escapeHtml } from '../../utils.js';

const PAGE = 50; // mỗi mục chỉ hiện 50 dòng đầu, bấm "Hiện thêm" để xem tiếp

function formatValue(kind, v) {
  if (v === null || v === undefined || v === '') return '—';
  switch (kind) {
    case 'money': return formatVND(Number(v) || 0);
    case 'date': return formatDate(v);
    case 'percent': return `${Number(v)}%/năm`;
    case 'yesno': return v ? 'Có' : 'Không';
    case 'schedule': {
      const entries = Object.entries(v || {}).sort(([a], [b]) => a.localeCompare(b));
      return entries.length ? entries.map(([year, amount]) => `${year}: ${formatVND(Number(amount) || 0)}`).join(' · ') : '—';
    }
    default: return String(v);
  }
}

const who = (item) => `<b>${escapeHtml(item.name || 'Chưa có tên')}</b>${item.cccd ? ` <span class="imp-muted">CCCD ${escapeHtml(item.cccd)}</span>` : ''}`;
const changesHtml = (changes) => `<div class="imp-changes">${changes.map((c) =>
  `<div><span class="imp-muted">${escapeHtml(c.label)}:</span> <s>${escapeHtml(formatValue(c.kind, c.from))}</s> → <b>${escapeHtml(formatValue(c.kind, c.to))}</b></div>`).join('')}</div>`;

// Mỗi mục: tiêu đề + cách vẽ 1 dòng. tone: danger (đỏ) / warn / ok / info.
const SECTIONS = {
  deletedContracts: { tone: 'danger', title: (n) => `Xóa ${n} hợp đồng`, open: true,
    row: (it) => `<div>Hợp đồng <b>${escapeHtml(it.code)}</b> — ${who(it)}</div><div class="imp-muted">Dư nợ cũ ${formatVND(it.balance)} · ${escapeHtml(it.reason || '')}</div>` },
  newContracts: { tone: 'ok', title: (n) => `Hợp đồng mới: ${n}`,
    row: (it) => `<div>Hợp đồng <b>${escapeHtml(it.code)}</b> — ${who(it)}</div><div class="imp-muted">Dư nợ ${formatVND(it.balance)}${it.dueDate ? ` · đến hạn ${formatDate(it.dueDate)}` : ''}</div>` },
  changedContracts: { tone: 'warn', title: (n) => `Hợp đồng thay đổi: ${n}`,
    row: (it) => `<div>Hợp đồng <b>${escapeHtml(it.code)}</b> — ${who(it)}</div>${changesHtml(it.changes)}` },
  newCustomers: { tone: 'ok', title: (n) => `Khách hàng mới (tự tạo tài khoản): ${n}`,
    row: (it) => `<div>${who(it)}</div>${it.phone ? `<div class="imp-muted">SĐT ${escapeHtml(it.phone)}</div>` : ''}` },
  changedCustomers: { tone: 'warn', title: (n) => `Khách hàng đổi thông tin: ${n}`,
    row: (it) => `<div>${who(it)}</div>${changesHtml(it.changes)}` },
  deletedCustomers: { tone: 'danger', title: (n) => `Dọn hồ sơ khách không còn hợp đồng: ${n}`,
    row: (it) => `<div>${who(it)}</div>` },
  skipped: { tone: 'warn', title: (n) => `Dòng bị bỏ qua: ${n}`,
    row: (it) => `<div>${it.code ? `Hợp đồng <b>${escapeHtml(it.code)}</b> — ` : ''}${who(it)}</div><div class="imp-muted">${escapeHtml(it.reason || '')}</div>` },
  // file số 2
  matched: { tone: 'warn', title: (n) => `Hợp đồng được bổ sung: ${n}`,
    row: (it) => `<div>Hợp đồng <b>${escapeHtml(it.code)}</b> — ${who(it)}</div>${changesHtml(it.changes)}` },
  unmatched: { tone: 'warn', title: (n) => `Không cập nhật được: ${n}`,
    row: (it) => `<div>Hợp đồng <b>${escapeHtml(it.code)}</b></div><div class="imp-muted">${escapeHtml(it.reason || '')}</div>` },
};
const ORDER_IMPORT = ['deletedContracts', 'newContracts', 'changedContracts', 'newCustomers', 'changedCustomers', 'deletedCustomers', 'skipped'];
const ORDER_SUPPLEMENT = ['matched', 'unmatched'];

/** Các mục chi tiết (gập/mở được) cho cả bản xem trước, kết quả vừa nhập lẫn xem lại lịch sử. */
export function importDetailsHtml(details, kind = 'import') {
  if (!details) return '';
  const unchanged = kind === 'supplement' ? details.unchangedContracts : details.unchangedContracts;
  const blocks = (kind === 'supplement' ? ORDER_SUPPLEMENT : ORDER_IMPORT).map((key) => {
    const list = details[key] || [];
    if (!list.length) return '';
    const sec = SECTIONS[key];
    const rows = list.map((it, i) => `<div class="imp-row${i >= PAGE ? ' imp-hidden' : ''}">${sec.row(it)}</div>`).join('');
    const more = list.length > PAGE ? `<button type="button" class="btn btn-outline btn-sm btn-block imp-more" data-more>Hiện thêm (còn ${list.length - PAGE})</button>` : '';
    return `<details class="imp-section imp-${sec.tone}"${sec.open ? ' open' : ''}><summary>${escapeHtml(sec.title(list.length))}</summary><div class="imp-list">${rows}${more}</div></details>`;
  }).join('');
  const note = unchanged ? `<div class="imp-muted imp-note">${unchanged} hợp đồng không thay đổi gì.</div>` : '';
  return `<div class="imp-details">${blocks || '<div class="imp-muted">Không có thay đổi nào.</div>'}${note}</div>`;
}

/** Gắn nút "Hiện thêm" cho các mục vừa vẽ. */
export function bindImportDetails(root) {
  root.querySelectorAll('[data-more]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const list = btn.parentElement;
      const hidden = [...list.querySelectorAll('.imp-hidden')];
      hidden.slice(0, PAGE).forEach((el) => el.classList.remove('imp-hidden'));
      const left = hidden.length - PAGE;
      if (left > 0) btn.textContent = `Hiện thêm (còn ${left})`; else btn.remove();
    });
  });
}

/** Dải số liệu tóm tắt. */
export function importSummaryHtml(summary, kind = 'import') {
  if (!summary) return '';
  const chip = (n, label, tone) => (n ? `<span class="imp-chip imp-chip-${tone}"><b>${n}</b> ${label}</span>` : '');
  const chips = kind === 'supplement'
    ? [chip(summary.changedContracts, 'hợp đồng được bổ sung', 'warn'), chip(summary.unchangedContracts, 'không đổi', 'info'), chip(summary.unmatched, 'không khớp', 'warn')]
    : [chip(summary.newContracts, 'hợp đồng mới', 'ok'), chip(summary.changedContracts, 'hợp đồng đổi', 'warn'), chip(summary.deletedContracts, 'hợp đồng bị xóa', 'danger'),
      chip(summary.newCustomers, 'khách mới', 'ok'), chip(summary.changedCustomers, 'khách đổi thông tin', 'warn'), chip(summary.deletedCustomers, 'hồ sơ khách bị dọn', 'danger'),
      chip(summary.skipped, 'dòng bỏ qua', 'warn'), chip(summary.unchangedContracts, 'hợp đồng không đổi', 'info')];
  return `<div class="imp-chips">${chips.join('') || '<span class="imp-muted">Không có thay đổi nào.</span>'}</div>`;
}

/**
 * Cửa sổ xem trước trước khi nhập thật. onConfirm() chạy việc nhập thật; nếu
 * ném lỗi thì cửa sổ vẫn mở để người dùng thấy thông báo và thử lại/hủy.
 */
export function openImportPreview({ title, kind = 'import', summary, details, fullSync, notes = [], confirmLabel = 'Xác nhận nhập', onConfirm }) {
  const deleting = (summary?.deletedContracts || 0) + (summary?.deletedCustomers || 0);
  openModal({
    title: escapeHtml(title),
    sheetClass: 'imp-sheet',
    bodyHtml: `
      <div class="imp-banner">${icon('alert', 'icon-sm')}<div>Đây là <b>bản xem trước</b> — chưa có gì bị thay đổi. Kiểm tra kỹ rồi bấm “${escapeHtml(confirmLabel)}”.</div></div>
      ${deleting && fullSync ? `<div class="imp-banner imp-banner-danger"><div>Tải file số 1 là danh sách đầy đủ: hợp đồng nào <b>không còn trong file</b> sẽ bị xóa. Xem mục màu đỏ bên dưới.</div></div>` : ''}
      ${notes.map((n) => `<div class="imp-muted imp-note">${escapeHtml(n)}</div>`).join('')}
      ${importSummaryHtml(summary, kind)}
      ${importDetailsHtml(details, kind)}
      <div class="imp-muted imp-note">Nhập nhầm vẫn quay lại được: mục “Lịch sử nhập” trong cửa sổ nhập file.</div>
    `,
    footHtml: `
      <button class="btn btn-outline btn-block" data-cancel>Hủy</button>
      <button class="btn ${deleting ? 'btn-danger' : 'btn-primary'} btn-block" data-ok>${escapeHtml(confirmLabel)}</button>
    `,
    onMount(sheet, close) {
      bindImportDetails(sheet);
      sheet.querySelector('[data-cancel]').addEventListener('click', close);
      const ok = sheet.querySelector('[data-ok]');
      ok.addEventListener('click', async () => {
        const idle = ok.innerHTML;
        ok.disabled = true; ok.textContent = 'Đang nhập...';
        try {
          await onConfirm();
          close();
        } catch (err) {
          toast(err.message || 'Có lỗi khi nhập dữ liệu', 'error');
          ok.disabled = false; ok.innerHTML = idle;
        }
      });
    },
  });
}

function kindLabel(item) {
  if (item.kind === 'supplement') return 'File số 2 (khế ước, phân kỳ)';
  return item.full_sync ? 'File số 1 (đồng bộ toàn bộ)' : 'Dán tay';
}
function summaryLine(item) {
  const sm = item.summary || {};
  const parts = item.kind === 'supplement'
    ? [`${sm.changedContracts || 0} hợp đồng được bổ sung`, sm.unmatched ? `${sm.unmatched} không khớp` : '']
    : [sm.newContracts ? `${sm.newContracts} hợp đồng mới` : '', sm.changedContracts ? `${sm.changedContracts} đổi` : '', sm.deletedContracts ? `${sm.deletedContracts} xóa` : '',
      sm.newCustomers ? `${sm.newCustomers} khách mới` : '', sm.deletedCustomers ? `${sm.deletedCustomers} hồ sơ dọn` : ''];
  return parts.filter(Boolean).join(' · ') || 'Không có thay đổi';
}

function openImportDetail(id) {
  openModal({
    title: 'Chi tiết lần nhập',
    sheetClass: 'imp-sheet',
    bodyHtml: '<div class="imp-muted">Đang tải...</div>',
    onMount(sheet) {
      S.getImportHistoryDetail(id).then((item) => {
        const body = sheet.querySelector('.modal-body');
        body.innerHTML = `
          <div class="imp-head"><b>${escapeHtml(kindLabel(item))}</b>${item.file_name ? ` · ${escapeHtml(item.file_name)}` : ''}<br/>
            <span class="imp-muted">${formatDateTime(item.created_at)} · ${escapeHtml(item.admin_name || '')}</span>
            ${item.rolled_back_at ? `<br/><span class="imp-tag">Đã quay lại bản trước lúc ${formatDateTime(item.rolled_back_at)}${item.rolled_back_by ? ` bởi ${escapeHtml(item.rolled_back_by)}` : ''}</span>` : ''}</div>
          ${importSummaryHtml(item.summary, item.kind)}
          ${importDetailsHtml(item.details, item.kind)}`;
        bindImportDetails(body);
      }).catch((err) => { sheet.querySelector('.modal-body').innerHTML = `<div class="text-danger">${escapeHtml(err.message || 'Không tải được')}</div>`; });
    },
  });
}

/** Lịch sử các lần nhập + nút quay lại bản trước (chỉ lần mới nhất chưa quay lại). onChanged() gọi sau khi quay lại thành công. */
export function openImportHistory({ onChanged } = {}) {
  openModal({
    title: 'Lịch sử nhập file',
    sheetClass: 'imp-sheet',
    bodyHtml: '<div id="imp-hist" class="imp-muted">Đang tải...</div>',
    onMount(sheet) {
      const host = sheet.querySelector('#imp-hist');
      const load = async () => {
        try {
          const { items, latestActiveId } = await S.listImportHistory();
          if (!items.length) { host.innerHTML = '<div class="imp-muted">Chưa có lần nhập nào được ghi lại.</div>'; return; }
          host.className = '';
          host.innerHTML = `<div class="imp-muted imp-note">Chỉ quay lại được lần nhập <b>mới nhất</b> chưa quay lại. Muốn quay lại lần cũ hơn thì quay lại lần mới hơn trước.</div>` + items.map((it) => `
            <div class="imp-hist-item${it.rolled_back_at ? ' is-rolled' : ''}">
              <div><b>${escapeHtml(kindLabel(it))}</b>${it.file_name ? ` · ${escapeHtml(it.file_name)}` : ''}</div>
              <div class="imp-muted">${formatDateTime(it.created_at)} · ${escapeHtml(it.admin_name || '')}</div>
              <div class="imp-hist-sum">${escapeHtml(summaryLine(it))}</div>
              ${it.rolled_back_at ? `<div class="imp-tag">Đã quay lại bản trước lúc ${formatDateTime(it.rolled_back_at)}${it.rolled_back_by ? ` · ${escapeHtml(it.rolled_back_by)}` : ''}</div>` : ''}
              <div class="flex gap-8 mt-8">
                <button type="button" class="btn btn-outline btn-sm" data-view="${escapeHtml(it.id)}">Xem chi tiết</button>
                ${it.id === latestActiveId ? `<button type="button" class="btn btn-danger btn-sm" data-rollback="${escapeHtml(it.id)}">${icon('refresh', 'icon-sm')} Quay lại bản trước</button>` : ''}
              </div>
            </div>`).join('');
          host.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => openImportDetail(b.dataset.view)));
          host.querySelectorAll('[data-rollback]').forEach((b) => b.addEventListener('click', () => {
            const item = items.find((x) => x.id === b.dataset.rollback);
            confirmDialog({
              title: 'Quay lại bản trước?',
              message: `Dữ liệu sẽ được trả về <b>đúng như trước</b> lần nhập lúc <b>${formatDateTime(item.created_at)}</b> (${escapeHtml(summaryLine(item))}): hợp đồng/khách đã bị xóa được tạo lại, giá trị đã đổi được trả về như cũ, hợp đồng/khách do lần nhập đó tạo ra bị xóa. Thao tác này được ghi vào Nhật ký.`,
              confirmLabel: 'Quay lại bản trước',
              danger: true,
              async onConfirm() {
                try {
                  await S.rollbackImportHistory(item.id);
                  toast('Đã quay lại bản trước', 'success');
                  onChanged?.();
                } catch (err) { toast(err.message || 'Không quay lại được', 'error'); }
                load();
              },
            });
          }));
        } catch (err) {
          host.innerHTML = `<div class="text-danger">${escapeHtml(err.message || 'Không tải được lịch sử nhập')}</div>`;
        }
      };
      load();
    },
  });
}
