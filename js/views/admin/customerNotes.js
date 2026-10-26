import * as S from '../../state.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { emptyState } from '../../components/ui.js';
import { icon } from '../../icons.js';
import { escapeHtml, formatVND, formatNumber, formatCompact, initials, colorFor } from '../../utils.js';
import {
  todayIso, isoOf, noteState, pillLabel, repeatLabel, sortNotes, summarize, dayMonthTile, formatVnDate, describeFirst, NOTE_MAX_LEN,
} from '../../lib/customerNotes.js';

const ic = (n) => icon(n, 'icon-sm');
const SNOOZE_DAYS = [1, 3, 7];
const QUICK_DAYS = [3, 7, 10, 15, 30];
const TEMPLATES = {
  monthly: { kind: 'monthly', text: 'Thu gốc hàng tháng', label: 'Trả gốc hàng tháng', icon: 'refresh' },
  after: { kind: 'after', text: '', label: 'Hẹn trả sau … ngày', icon: 'clock', afterDays: 7 },
  call: { kind: 'after', text: 'Hẹn gọi lại', label: 'Hẹn gọi lại', icon: 'phone', afterDays: 3 },
  plain: { kind: 'none', text: '', label: 'Ghi chú thường', icon: 'edit' },
};
const KIND_BUTTONS = [
  { id: 'none', label: 'Không nhắc', icon: 'edit' },
  { id: 'after', label: 'Sau … ngày', icon: 'clock' },
  { id: 'date', label: 'Ngày cụ thể', icon: 'calendar' },
  { id: 'monthly', label: 'Hàng tháng', icon: 'refresh' },
];

function contractCodeOf(note) {
  const ct = note.contractId ? S.getContract(note.contractId) : null;
  return ct ? ct.code : '';
}

function tileHtml(note) {
  const t = note.remindOn ? dayMonthTile(note.remindOn) : null;
  return t ? `<div class="nt-date"><span>${t.month}</span><b>${t.day}</b></div>` : `<div class="nt-date is-icon">${ic('edit')}</div>`;
}

function byHtml(name, text) {
  return `<div class="nt-by"><i style="background:${colorFor(name || '?')}">${escapeHtml(initials(name))}</i>${escapeHtml(text)}</div>`;
}

function chipsHtml(note) {
  const code = contractCodeOf(note);
  const rep = repeatLabel(note);
  const repIcon = note.kind === 'monthly' ? 'refresh' : 'calendar';
  const vis = note.visibility === 'me' ? 'Chỉ mình tôi' : (note.remindOn ? 'Nhắc mọi nhân viên' : 'Mọi nhân viên thấy');
  return `<div class="nt-meta">${code ? `<span class="nt-chip">${ic('landmark')}HĐ ${escapeHtml(code)}</span>` : ''}${rep ? `<span class="nt-chip">${ic(repIcon)}${escapeHtml(rep)}</span>` : ''}<span class="nt-chip">${ic('user')}${vis}</span></div>`;
}

function amountHtml(note) {
  if (!note.amount) return '';
  return `<div class="nq-amt"><span>${note.kind === 'monthly' ? 'Cần thu' : 'Hẹn trả'}</span><b>${formatVND(note.amount)}</b></div>`;
}

function okLabel(note) { return note.amount ? 'Đã thu' : 'Đã xử lý'; }

function actionsHtml(note, ui) {
  if (!note.remindOn) return `<div class="nt-acts"><button type="button" class="nt-btn" data-nt-edit="${note.id}">${ic('edit')}Sửa</button></div>`;
  if (ui.snoozeId === note.id) {
    return `<div class="nt-acts nt-snz"><span>Hoãn thêm:</span>${SNOOZE_DAYS.map((d) => `<button type="button" class="nt-btn" data-nt-days="${d}" data-nt-id="${note.id}">${d} ngày</button>`).join('')}<button type="button" class="nt-btn more" data-nt-snooze-cancel aria-label="Hủy">${ic('x')}</button></div>`;
  }
  return `<div class="nt-acts"><button type="button" class="nt-btn ok" data-nt-done="${note.id}">${ic('check')}${okLabel(note)}</button><button type="button" class="nt-btn" data-nt-snooze="${note.id}">${ic('clock')}Hoãn</button><button type="button" class="nt-btn" data-nt-edit="${note.id}">${ic('edit')}Sửa</button></div>`;
}

function noteRowHtml(note, today, ui) {
  const st = noteState(note, today);
  const open = ui.openId === note.id;
  const code = contractCodeOf(note);
  const sub = [code && `HĐ ${code}`, note.amount ? formatCompact(note.amount) : ''].filter(Boolean).join(' · ');
  const detail = open
    ? `<div class="nq-x">${chipsHtml(note)}${amountHtml(note)}${byHtml(note.createdByName, `${note.createdByName || 'Quản trị viên'} · tạo ${formatVnDate(String(note.createdAt || '').slice(0, 10))}`)}${actionsHtml(note, ui)}</div>`
    : '';
  return `<div class="nq-r is-${st}${open ? ' is-open' : ''}" data-nt-row="${note.id}" role="button" tabindex="0" aria-expanded="${open}">
    ${tileHtml(note)}
    <div class="nq-m"><b class="nq-t">${escapeHtml(note.text)}</b><div class="nq-s"><span class="nt-pill">${pillLabel(note, today)}</span>${sub ? `<span>${escapeHtml(sub)}</span>` : ''}</div></div>
    <span class="nq-c">${icon('chevronRight', 'icon-sm')}</span>
    ${detail}
  </div>`;
}

function doneRowHtml(log) {
  const iso = isoOf(new Date(log.createdAt));
  const t = dayMonthTile(iso);
  const when = new Date(log.createdAt);
  const hhmm = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  return `<div class="nq-r is-done">
    <div class="nt-date"><span>${t.month}</span><b>${t.day}</b></div>
    <div class="nq-m"><b class="nq-t">${escapeHtml(log.text)}</b><div class="nq-s"><span class="nt-pill">Đã xong</span><span>${escapeHtml(log.byName || '')} · ${hhmm}${log.amount ? ` · ${formatCompact(log.amount)}` : ''}</span></div></div>
  </div>`;
}

function cardInnerHtml(customerId, ui) {
  const today = todayIso();
  const notes = S.listNotesByCustomer(customerId).filter((n) => n.status === 'open');
  const sum = summarize(notes, today);
  const doneLogs = S.listNoteLogByCustomer(customerId).filter((l) => l.action === 'done').slice(0, 30);
  const todo = sortNotes(notes.filter((n) => n.remindOn), today);
  const plain = sortNotes(notes.filter((n) => !n.remindOn), today);
  if (!ui.tab) ui.tab = todo.length ? 'todo' : plain.length ? 'plain' : doneLogs.length ? 'done' : 'todo';
  const chips = [
    sum.late ? `<span><i class="red"></i>${sum.late} trễ</span>` : '',
    sum.today ? `<span><i class="gold"></i>${sum.today} hôm nay</span>` : '',
    sum.soon ? `<span><i></i>${sum.soon} sắp tới</span>` : '',
    sum.plain ? `<span><i class="grey"></i>${sum.plain} ghi chú</span>` : '',
  ].join('');
  const list = ui.tab === 'todo' ? todo.map((n) => noteRowHtml(n, today, ui)) : ui.tab === 'plain' ? plain.map((n) => noteRowHtml(n, today, ui)) : doneLogs.map(doneRowHtml);
  const emptyText = ui.tab === 'todo' ? 'Không có việc cần làm.' : ui.tab === 'plain' ? 'Chưa có ghi chú thường.' : 'Chưa có việc nào hoàn thành.';
  const body = ui.expanded
    ? `<div class="nq-body"><div class="nt-tabs" role="tablist">
        <button type="button" role="tab" class="${ui.tab === 'todo' ? 'on' : ''}" data-nt-tab="todo">Cần làm <em>${todo.length}</em></button>
        <button type="button" role="tab" class="${ui.tab === 'plain' ? 'on' : ''}" data-nt-tab="plain">Ghi chú <em>${plain.length}</em></button>
        <button type="button" role="tab" class="${ui.tab === 'done' ? 'on' : ''}" data-nt-tab="done">Đã xong <em>${doneLogs.length}</em></button>
      </div><div class="nq-list">${list.join('') || `<p class="nq-empty">${emptyText}</p>`}</div></div>`
    : '';
  return `<div class="nr-bar" role="button" tabindex="0" aria-expanded="${ui.expanded}" data-nt-toggle>
      <span class="nq-ic">${icon('bell')}</span>
      <span class="nr-tt">Ghi chú &amp; nhắc việc${sum.total ? `<em>${sum.total}</em>` : ''}</span>
      <button type="button" class="nr-add" data-nt-add>${ic('plus')}Ghi chú</button>
      <span class="nq-chev">${ic('chevronDown')}</span>
    </div>
    <div class="nr-sum">${chips || '<span class="nr-none">Chưa có ghi chú. Bấm “+ Ghi chú” để thêm.</span>'}</div>
    ${body}`;
}

export function noteCardShellHtml() {
  return '<section class="cd-card nt-card nq-card nr-card" id="nt-card"></section>';
}

export function mountNoteCard(sheet, customerId) {
  const host = sheet.querySelector('#nt-card');
  if (!host) return;
  const ui = { expanded: false, tab: null, openId: null, snoozeId: null };
  let busy = false;
  const draw = () => {
    host.classList.toggle('is-open', ui.expanded);
    host.innerHTML = cardInnerHtml(customerId, ui);
  };
  const run = async (promise, okText) => {
    if (busy) return;
    busy = true;
    host.classList.add('is-busy');
    try {
      const res = await promise;
      if (res && res.ok) { if (okText) toast(okText, 'success'); }
      else toast((res && res.reason) || 'Không thực hiện được.', 'error');
    } finally { busy = false; host.classList.remove('is-busy'); }
    ui.snoozeId = null;
    draw();
  };
  const afterSave = (note) => { ui.expanded = true; ui.tab = note && note.remindOn ? 'todo' : 'plain'; ui.openId = note ? note.id : null; draw(); };
  host.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-nt-add]')) { openNoteForm({ customerId, onSaved: afterSave }); return; }
    const tab = t.closest('[data-nt-tab]');
    if (tab) { ui.tab = tab.dataset.ntTab; ui.openId = null; ui.snoozeId = null; draw(); return; }
    const done = t.closest('[data-nt-done]');
    if (done) { run(S.completeNote(done.dataset.ntDone), 'Đã ghi nhận hoàn thành.'); return; }
    const days = t.closest('[data-nt-days]');
    if (days) { run(S.snoozeNote(days.dataset.ntId, Number(days.dataset.ntDays)), `Đã hoãn ${days.dataset.ntDays} ngày.`); return; }
    const snooze = t.closest('[data-nt-snooze]');
    if (snooze) { ui.snoozeId = snooze.dataset.ntSnooze; draw(); return; }
    if (t.closest('[data-nt-snooze-cancel]')) { ui.snoozeId = null; draw(); return; }
    const edit = t.closest('[data-nt-edit]');
    if (edit) { const note = S.listNotesByCustomer(customerId).find((n) => n.id === edit.dataset.ntEdit); if (note) openNoteForm({ customerId, note, onSaved: afterSave, onDeleted: () => { ui.openId = null; draw(); } }); return; }
    const row = t.closest('[data-nt-row]');
    if (row) { ui.openId = ui.openId === row.dataset.ntRow ? null : row.dataset.ntRow; ui.snoozeId = null; draw(); return; }
    if (t.closest('[data-nt-toggle]')) { ui.expanded = !ui.expanded; draw(); }
  });
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target;
    if (t.matches('[data-nt-toggle], [data-nt-row]')) { e.preventDefault(); t.click(); }
  });
  draw();
  S.loadNotesForCustomer(customerId).then((ok) => { if (ok && host.isConnected) { ui.tab = null; draw(); } });
}

function dueGroups(today) {
  const byCustomer = new Map();
  for (const n of S.listDueNotes(today)) {
    const c = S.getCustomer(n.customerId);
    if (!c) continue;
    if (!byCustomer.has(c.id)) byCustomer.set(c.id, { c, notes: [] });
    byCustomer.get(c.id).notes.push(n);
  }
  const groups = [...byCustomer.values()];
  groups.forEach((g) => { g.notes = sortNotes(g.notes, today); });
  const rank = (g) => (g.notes.some((n) => noteState(n, today) === 'late') ? 0 : 1);
  return groups.sort((a, b) => rank(a) - rank(b) || a.c.name.localeCompare(b.c.name, 'vi'));
}

export function dueNotesSummary() {
  const today = todayIso();
  const due = S.listDueNotes(today);
  return {
    count: due.length,
    customers: new Set(due.map((n) => n.customerId)).size,
    late: due.filter((n) => noteState(n, today) === 'late').length,
  };
}

function dueRowHtml(note, today, ui) {
  const code = contractCodeOf(note);
  const rep = repeatLabel(note);
  const chips = `<div class="nt-meta">${code ? `<span class="nt-chip">${ic('landmark')}HĐ ${escapeHtml(code)}</span>` : ''}${rep ? `<span class="nt-chip">${ic(note.kind === 'monthly' ? 'refresh' : 'calendar')}${escapeHtml(rep)}</span>` : ''}</div>`;
  return `<div class="nv-r nz is-${noteState(note, today)}">
    ${tileHtml(note)}
    <div class="nv-m"><div class="nv-n">${escapeHtml(note.text)}<span class="nt-pill">${pillLabel(note, today)}</span></div>${chips}</div>
    <div class="nv-a">${note.amount ? `<b>${formatVND(note.amount)}</b><span>${note.kind === 'monthly' ? 'Cần thu' : 'Hẹn trả'}</span>` : ''}</div>
    <div class="nv-b"><div class="nv-w"><i style="background:${colorFor(note.createdByName || '?')}">${escapeHtml(initials(note.createdByName))}</i><div>${escapeHtml(note.createdByName || 'Quản trị viên')}<small>tạo ${formatVnDate(String(note.createdAt || '').slice(0, 10))}</small></div></div>${actionsHtml(note, ui)}</div>
  </div>`;
}

function dueBodyHtml(ui) {
  const today = todayIso();
  const groups = dueGroups(today);
  if (!groups.length) return emptyState({ iconName: 'checkCircle', title: 'Đã xử lý hết việc đến hạn', message: 'Không còn ghi chú nào đến hạn hôm nay.' });
  const total = groups.reduce((s, g) => s + g.notes.length, 0);
  const money = groups.reduce((s, g) => s + g.notes.reduce((x, n) => x + (n.amount || 0), 0), 0);
  const head = `<div class="nz-sum">${groups.length} khách hàng · ${total} việc${money ? ` · Cần thu hôm nay: <strong>${formatVND(money)}</strong>` : ''}</div>`;
  const list = groups.map((g) => {
    const addr = g.c.address || [g.c.xom, g.c.thon, g.c.tinh].filter(Boolean).join(', ');
    const phone = g.c.phone ? `<a class="nt-btn call" href="tel:${escapeHtml(g.c.phone)}" data-nt-call="${g.c.id}">${ic('phone')}Gọi</a>` : '';
    return `<div class="nz-g"><div class="nz-gh">
      <span class="av" style="background:${colorFor(g.c.id)}">${escapeHtml(initials(g.c.name))}</span>
      <div class="nz-gt"><b>${escapeHtml(g.c.name)}</b><small>${escapeHtml(addr)}</small></div>${phone}
      <button type="button" class="nz-open" data-nt-open="${g.c.id}">Mở hồ sơ ›</button>
    </div><div class="nz-gl">${g.notes.map((n) => dueRowHtml(n, today, ui)).join('')}</div></div>`;
  }).join('');
  return `${head}<div class="nz-list">${list}</div>`;
}

export function openDueNotesModal({ onOpenCustomer, onChange } = {}) {
  const ui = { snoozeId: null };
  let busy = false;
  openModal({
    title: `Nhắc việc đến hạn (${S.listDueNotes().length})`,
    sheetClass: 'attention-ledger-sheet nt-scope',
    bodyHtml: dueBodyHtml(ui),
    onMount(sheet, closeFn) {
      const body = sheet.querySelector('.modal-body');
      const title = sheet.querySelector('.modal-head h3');
      const draw = () => { body.innerHTML = dueBodyHtml(ui); if (title) title.textContent = `Nhắc việc đến hạn (${S.listDueNotes().length})`; };
      const run = async (promise, okText) => {
        if (busy) return;
        busy = true;
        body.classList.add('is-busy');
        try {
          const res = await promise;
          if (res && res.ok) { if (okText) toast(okText, 'success'); }
          else toast((res && res.reason) || 'Không thực hiện được.', 'error');
        } finally { busy = false; body.classList.remove('is-busy'); }
        ui.snoozeId = null;
        draw();
        if (onChange) onChange();
      };
      body.addEventListener('click', (e) => {
        const t = e.target;
        const call = t.closest('[data-nt-call]');
        if (call) { const c = S.getCustomer(call.dataset.ntCall); if (c) S.logCall(c.id, c.phone); return; }
        const open = t.closest('[data-nt-open]');
        if (open) { closeFn(); if (onOpenCustomer) onOpenCustomer(open.dataset.ntOpen); return; }
        const done = t.closest('[data-nt-done]');
        if (done) { run(S.completeNote(done.dataset.ntDone), 'Đã ghi nhận hoàn thành.'); return; }
        const days = t.closest('[data-nt-days]');
        if (days) { run(S.snoozeNote(days.dataset.ntId, Number(days.dataset.ntDays)), `Đã hoãn ${days.dataset.ntDays} ngày.`); return; }
        const snooze = t.closest('[data-nt-snooze]');
        if (snooze) { ui.snoozeId = snooze.dataset.ntSnooze; draw(); return; }
        if (t.closest('[data-nt-snooze-cancel]')) { ui.snoozeId = null; draw(); return; }
        const edit = t.closest('[data-nt-edit]');
        if (edit) {
          const note = (S.getState().customerNotes || []).find((n) => n.id === edit.dataset.ntEdit);
          if (note) openNoteForm({ customerId: note.customerId, note, onSaved: () => { draw(); if (onChange) onChange(); }, onDeleted: () => { draw(); if (onChange) onChange(); } });
        }
      });
    },
  });
}

function planHtml(f, today) {
  if (f.kind === 'none') return '';
  const amountLabel = f.kind === 'monthly' ? 'Số tiền cần thu' : 'Số tiền khách hẹn trả <small>(không bắt buộc)</small>';
  const amount = `<div class="nt-f"><span class="nt-lb">${amountLabel}</span><label class="nt-in"><input id="nf-amount" type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="${f.amount ? formatNumber(Number(f.amount)) : ''}"><em>₫</em></label></div>`;
  if (f.kind === 'after') {
    const custom = !QUICK_DAYS.includes(Number(f.afterDays)) || f.customDays;
    return `<div class="nt-f"><span class="nt-lb">Hẹn sau bao nhiêu ngày</span><div class="nt-quick">${QUICK_DAYS.map((d) => `<button type="button" class="${!custom && Number(f.afterDays) === d ? 'on' : ''}" data-nf-days="${d}">${d}</button>`).join('')}<button type="button" class="${custom ? 'on' : ''}" data-nf-days="custom">Khác…</button></div>${custom ? `<label class="nt-in nt-days"><input id="nf-days" type="text" inputmode="numeric" autocomplete="off" placeholder="Số ngày" value="${f.afterDays || ''}"><em>ngày</em></label>` : ''}</div>${amount}`;
  }
  if (f.kind === 'date') {
    return `<div class="nt-f"><span class="nt-lb">Ngày nhắc</span><input id="nf-date" class="nt-inp" type="date" min="${today}" value="${f.date || ''}"></div>${amount}`;
  }
  return `<div class="nt-two"><div class="nt-f"><span class="nt-lb">Ngày trong tháng</span><label class="nt-in"><input id="nf-mday" type="text" inputmode="numeric" autocomplete="off" placeholder="VD: 5" value="${f.monthlyDay || ''}"><em>hàng tháng</em></label></div>${amount}</div>`;
}

function whenHtml(f, today) {
  if (f.kind === 'none') return '';
  const plan = { kind: f.kind, afterDays: f.afterDays, monthlyDay: f.monthlyDay, date: f.date };
  const d = describeFirst(plan, today);
  if (!d) {
    const hint = f.kind === 'after' ? 'Nhập số ngày từ 1 đến 365.' : f.kind === 'date' ? 'Chọn ngày nhắc.' : 'Nhập ngày trong tháng từ 1 đến 31.';
    return `<div class="nt-when is-empty">${icon('bell')}<div><b>Chưa đủ thông tin để nhắc</b><span>${hint}</span></div></div>`;
  }
  const amount = f.amount ? `, ${f.kind === 'monthly' ? 'thu' : 'hẹn trả'} ${formatVND(Number(f.amount))}` : '';
  let line;
  if (f.kind === 'monthly') line = `Sau đó mỗi tháng vào ngày ${f.monthlyDay}${amount}; ${f.contractId ? 'tự dừng khi hợp đồng tất toán' : 'dừng khi bạn xóa ghi chú'}.`;
  else if (f.kind === 'after') line = `Còn ${d.inDays} ngày kể từ hôm nay (${formatVnDate(today)}). Hiện ở mục Cần chú ý khi đến hạn${amount}.`;
  else line = `Đến ngày đó sẽ hiện ở mục Cần chú ý${amount}.`;
  return `<div class="nt-when">${icon('bell')}<div><b>${f.kind === 'monthly' ? 'Nhắc lần đầu' : 'Nhắc vào'}: ${d.text}</b><span>${line}</span></div></div>`;
}

export function openNoteForm({ customerId, note = null, onSaved, onDeleted }) {
  const customer = S.getCustomer(customerId);
  if (!customer) return;
  const today = todayIso();
  const contracts = S.listContractsByCustomer(customerId).filter((ct) => S.effectiveContractStatus(ct) !== 'da_tat_toan' || (note && note.contractId === ct.id));
  const f = note
    ? { tpl: note.kind === 'monthly' ? 'monthly' : note.kind === 'after' ? 'after' : 'plain', text: note.text, contractId: note.contractId, kind: note.kind, afterDays: note.afterDays, date: note.kind === 'date' ? note.remindOn : '', monthlyDay: note.monthlyDay, amount: note.amount ? String(note.amount) : '', visibility: note.visibility, customDays: false }
    : { tpl: 'plain', text: '', contractId: null, kind: 'none', afterDays: null, date: '', monthlyDay: null, amount: '', visibility: 'all', customDays: false };
  let autoText = '';
  const tplHtml = () => Object.entries(TEMPLATES).map(([id, t]) => `<button type="button" class="${f.tpl === id ? 'on' : ''}" data-nf-tpl="${id}">${ic(t.icon)}${t.label}</button>`).join('');
  const ctHtml = () => `<button type="button" class="${f.contractId ? '' : 'on'}" data-nf-ct="">Cả khách hàng</button>${contracts.map((ct) => `<button type="button" class="${f.contractId === ct.id ? 'on' : ''}" data-nf-ct="${ct.id}">HĐ ${escapeHtml(ct.code)}</button>`).join('')}`;
  const kindHtml = () => KIND_BUTTONS.map((k) => `<button type="button" class="${f.kind === k.id ? 'on' : ''}" data-nf-kind="${k.id}">${ic(k.icon)}${k.label}</button>`).join('');
  const whoHtml = () => `<button type="button" class="${f.visibility === 'all' ? 'on' : ''}" data-nf-who="all">${icon('users', 'icon-sm')}<span>Mọi nhân viên<small>phụ trách khách này</small></span></button><button type="button" class="${f.visibility === 'me' ? 'on' : ''}" data-nf-who="me">${icon('user', 'icon-sm')}<span>Chỉ mình tôi<small>người khác không thấy</small></span></button>`;
  openModal({
    title: note ? 'Sửa ghi chú' : 'Thêm ghi chú',
    sheetClass: 'nt-sheet nt-scope',
    bodyHtml: `<form class="nt-form" id="nf" novalidate>
      <div class="nt-cust"><span class="av" style="background:${colorFor(customer.id)}">${escapeHtml(initials(customer.name))}</span><div><b>${escapeHtml(customer.name)}</b><small>CCCD ${escapeHtml(customer.cccd || '')}${contracts.length ? ` · ${contracts.length} hợp đồng` : ''}</small></div></div>
      <div class="nt-f"><span class="nt-lb">Mẫu nhanh</span><div class="nt-tpl" id="nf-tpl">${tplHtml()}</div></div>
      <div class="nt-f"><label class="nt-lb" for="nf-text">Nội dung ghi chú</label><textarea id="nf-text" class="nt-ta" rows="3" maxlength="${NOTE_MAX_LEN}" placeholder="VD: Khách trả gốc 2 triệu mỗi tháng">${escapeHtml(f.text)}</textarea><small class="nt-cnt" id="nf-cnt"></small></div>
      <div class="nt-f"><span class="nt-lb">Gắn với</span><div class="nt-tpl" id="nf-ct">${ctHtml()}</div></div>
      <div class="nt-f"><span class="nt-lb">Kiểu nhắc</span><div class="nt-seg" id="nf-kind">${kindHtml()}</div></div>
      <div id="nf-plan">${planHtml(f, today)}</div>
      <div id="nf-when">${whenHtml(f, today)}</div>
      <div class="nt-f"><span class="nt-lb">Ai thấy ghi chú</span><div class="nt-who" id="nf-who">${whoHtml()}</div></div>
      <p class="nt-err" id="nf-err" hidden></p>
    </form>`,
    footHtml: `<div class="nt-foot">${note ? `<button type="button" class="nt-del" id="nf-del" aria-label="Xóa ghi chú">${ic('trash')}</button>` : ''}<button type="button" class="nt-cancel" id="nf-cancel">Hủy</button><button type="button" class="nt-save" id="nf-save">Lưu ghi chú</button></div>`,
    onMount(sheet, closeFn) {
      const q = (s) => sheet.querySelector(s);
      const text = q('#nf-text');
      const cnt = q('#nf-cnt');
      const err = q('#nf-err');
      const refreshCnt = () => { cnt.textContent = `${text.value.length} / ${NOTE_MAX_LEN} ký tự`; };
      const refreshWhen = () => { q('#nf-when').innerHTML = whenHtml(f, today); };
      const refreshPlan = () => { q('#nf-plan').innerHTML = planHtml(f, today); refreshWhen(); };
      const showErr = (msg) => { err.textContent = msg || ''; err.hidden = !msg; };
      refreshCnt();
      text.addEventListener('input', () => { f.text = text.value; refreshCnt(); showErr(''); });
      q('#nf-cancel').addEventListener('click', closeFn);
      const applyTemplate = (id) => {
        const t = TEMPLATES[id];
        f.tpl = id;
        f.kind = t.kind;
        if (t.afterDays && (f.kind !== 'after' || !f.afterDays)) f.afterDays = t.afterDays;
        if (t.afterDays && id === 'call') f.afterDays = t.afterDays;
        f.customDays = false;
        if (!text.value.trim() || text.value === autoText) { text.value = t.text; autoText = t.text; f.text = t.text; refreshCnt(); }
        q('#nf-tpl').innerHTML = tplHtml();
        q('#nf-kind').innerHTML = kindHtml();
        refreshPlan();
      };
      sheet.addEventListener('click', (e) => {
        const t = e.target;
        const tpl = t.closest('[data-nf-tpl]');
        if (tpl) { applyTemplate(tpl.dataset.nfTpl); return; }
        const ct = t.closest('[data-nf-ct]');
        if (ct) { f.contractId = ct.dataset.nfCt || null; q('#nf-ct').innerHTML = ctHtml(); refreshWhen(); return; }
        const kind = t.closest('[data-nf-kind]');
        if (kind) {
          f.kind = kind.dataset.nfKind;
          f.tpl = f.kind === 'monthly' ? 'monthly' : f.kind === 'after' ? 'after' : 'plain';
          if (f.kind === 'after' && !f.afterDays) f.afterDays = 7;
          f.customDays = false;
          q('#nf-tpl').innerHTML = tplHtml();
          q('#nf-kind').innerHTML = kindHtml();
          refreshPlan();
          return;
        }
        const days = t.closest('[data-nf-days]');
        if (days) {
          if (days.dataset.nfDays === 'custom') { f.customDays = true; refreshPlan(); q('#nf-days')?.focus(); }
          else { f.customDays = false; f.afterDays = Number(days.dataset.nfDays); refreshPlan(); }
          return;
        }
        const who = t.closest('[data-nf-who]');
        if (who) { f.visibility = who.dataset.nfWho; q('#nf-who').innerHTML = whoHtml(); }
      });
      sheet.addEventListener('input', (e) => {
        const t = e.target;
        if (t.id === 'nf-amount') {
          const digits = t.value.replace(/\D/g, '').slice(0, 12);
          f.amount = digits;
          t.value = digits ? formatNumber(Number(digits)) : '';
          refreshWhen();
        } else if (t.id === 'nf-days') { f.afterDays = t.value.replace(/\D/g, '').slice(0, 3); refreshWhen(); }
        else if (t.id === 'nf-mday') { f.monthlyDay = t.value.replace(/\D/g, '').slice(0, 2); refreshWhen(); }
        else if (t.id === 'nf-date') { f.date = t.value; refreshWhen(); }
      });
      const save = q('#nf-save');
      const submit = async () => {
        showErr('');
        save.disabled = true;
        save.textContent = 'Đang lưu…';
        const res = await S.saveNote({ customerId, contractId: f.contractId, text: f.text, kind: f.kind, afterDays: f.afterDays, monthlyDay: f.monthlyDay, date: f.date, amount: f.amount, visibility: f.visibility }, note ? note.id : null);
        save.disabled = false;
        save.textContent = 'Lưu ghi chú';
        if (!res.ok) { showErr(res.reason || 'Không lưu được ghi chú.'); return; }
        closeFn();
        toast('Đã lưu ghi chú.', 'success');
        if (onSaved) onSaved(res.note);
      };
      save.addEventListener('click', submit);
      q('#nf').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      const del = q('#nf-del');
      if (del) {
        del.addEventListener('click', () => confirmDialog({
          title: 'Xóa ghi chú?',
          message: 'Ghi chú và lịch sử hoàn thành của nó sẽ bị xóa, không khôi phục được.',
          confirmLabel: 'Xóa', danger: true,
          onConfirm: async () => {
            const res = await S.deleteNote(note.id);
            if (!res.ok) { toast(res.reason || 'Không xóa được.', 'error'); return; }
            closeFn();
            toast('Đã xóa ghi chú.', 'success');
            if (onDeleted) onDeleted();
          },
        }));
      }
    },
  });
}
