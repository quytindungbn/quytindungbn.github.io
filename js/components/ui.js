import { icon } from '../icons.js';
import { openModal } from './modal.js';
import { debounce, formatVND, formatDate } from '../utils.js';
import * as S from '../state.js';

export function searchBoxHtml(id, placeholder, value = '') {
  return `
    <div class="search-box mb-8">
      ${icon('search', 'icon-sm')}
      <input id="${id}" placeholder="${placeholder}" value="${value}" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search"/>
      <button type="button" class="search-clear-btn" id="${id}-clear" style="display:${value ? 'flex' : 'none'}" title="Xóa">${icon('x', 'icon-sm')}</button>
    </div>`;
}

export function bindSearchBox(root, id, onChange, { debounceMs = 200 } = {}) {
  const input = root.querySelector('#' + id);
  const clearBtn = root.querySelector('#' + id + '-clear');
  if (!input) return;
  const debounced = debounce((v) => onChange(v), debounceMs);
  input.addEventListener('input', () => {
    if (clearBtn) clearBtn.style.display = input.value ? 'flex' : 'none';
    debounced(input.value);
  });
  if (clearBtn) clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    input.focus();
    onChange('');
  });
}

export function emptyState({ iconName = 'box', title, message }) {
  return `
    <div class="empty-state">
      ${icon(iconName, 'icon-lg')}
      <h3>${title}</h3>
      <p>${message}</p>
    </div>`;
}

export function statusDotsHtml(loggedIn, pushOn) {
  const dot = (on) => `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${on ? 'var(--success)' : 'var(--danger)'};flex:none"></span>`;
  const tooltip = `${loggedIn ? 'Đã đăng nhập' : 'Chưa đăng nhập'} · ${pushOn ? 'Đã bật thông báo' : 'Chưa bật thông báo'}`;
  return `<span class="status-dots" title="${tooltip}" style="display:inline-flex;gap:5px;align-items:center;padding:4px">${dot(loggedIn)}${dot(pushOn)}</span>`;
}

export function statusBadge(statusObj) {
  return `<span class="badge ${statusObj.badge}">${statusObj.label}</span>`;
}

export const orderStatusBadge = statusBadge;

export function openPicker({ title, options, selected, multiSelect = false, onSelect }) {
  if (!multiSelect) {
    const close = openModal({
      title,
      bodyHtml: `<ul class="flex-col gap-6">${options.map((o) => `
        <li>
          <button class="list-row w-full" data-val="${o.value}" style="border:none;padding:11px 4px;background:none;text-align:left;cursor:pointer;">
            <div class="row-main"><div class="row-title" style="font-weight:${o.value === selected ? 700 : 500}">${o.label}</div></div>
            ${o.value === selected ? icon('check', 'icon-sm') : ''}
          </button>
        </li>`).join('')}</ul>`,
      onMount(sheet, closeFn) {
        sheet.querySelectorAll('[data-val]').forEach((btn) => {
          btn.addEventListener('click', () => { closeFn(); onSelect(btn.dataset.val); });
        });
      },
    });
    return close;
  }

  const chosen = new Set(selected || []);
  const close = openModal({
    title,
    bodyHtml: `
      <div class="flex gap-8 mb-8">
        <button class="btn btn-outline btn-sm" data-select-all>Chọn tất cả</button>
        <button class="btn btn-outline btn-sm" data-clear-all>Bỏ chọn tất cả</button>
      </div>
      <ul class="flex-col gap-6">${options.map((o) => `
      <li>
        <button class="list-row w-full" data-val="${o.value}" style="border:none;padding:11px 4px;background:none;text-align:left;cursor:pointer;">
          <div class="row-main"><div class="row-title" style="font-weight:${chosen.has(o.value) ? 700 : 500}">${o.label}</div></div>
          <span data-check style="visibility:${chosen.has(o.value) ? 'visible' : 'hidden'}">${icon('check', 'icon-sm')}</span>
        </button>
      </li>`).join('')}</ul>`,
    footHtml: `<button class="btn btn-primary btn-block" data-done>Xong</button>`,
    onMount(sheet, closeFn) {
      function refreshRows() {
        sheet.querySelectorAll('[data-val]').forEach((b) => {
          const isChosen = chosen.has(b.dataset.val);
          b.querySelector('.row-title').style.fontWeight = isChosen ? 700 : 500;
          b.querySelector('[data-check]').style.visibility = isChosen ? 'visible' : 'hidden';
        });
      }
      sheet.querySelectorAll('[data-val]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const val = btn.dataset.val;
          if (chosen.has(val)) chosen.delete(val); else chosen.add(val);
          refreshRows();
        });
      });
      sheet.querySelector('[data-select-all]').addEventListener('click', () => {
        options.forEach((o) => chosen.add(o.value));
        refreshRows();
      });
      sheet.querySelector('[data-clear-all]').addEventListener('click', () => {
        chosen.clear();
        refreshRows();
      });
      sheet.querySelector('[data-done]').addEventListener('click', () => { closeFn(); onSelect([...chosen]); });
    },
  });
  return close;
}

export function pillSelectHtml(id, label, active = false) {
  return `
    <span style="position:relative;display:inline-flex">
      <button class="pill-select" id="${id}" title="${String(label).trim().replace(/"/g, '&quot;').replace(/</g, '&lt;')}"><span class="pill-text">${label}</span> ${icon('chevronDown', 'icon-sm')}</button>
      ${active ? `<button type="button" class="pill-clear-btn" data-pill-clear="${id}" title="Bỏ lọc" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;border:none;background:var(--text);color:var(--surface);display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1;cursor:pointer;padding:0">✕</button>` : ''}
    </span>`;
}

export function openResetPasswordModal({ title = 'Cấp lại mật khẩu', onConfirm }) {
  return openModal({
    title,
    bodyHtml: `
      <div class="field">
        <label>Mật khẩu mới</label>
        <input id="reset-pw-input" placeholder="Để trống sẽ tự sinh mật khẩu ngẫu nhiên"/>
      </div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" data-confirm>Cấp lại mật khẩu</button>`,
    onMount(sheet, closeFn) {
      sheet.querySelector('[data-confirm]').addEventListener('click', () => {
        const val = sheet.querySelector('#reset-pw-input').value;
        closeFn();
        onConfirm(val);
      });
    },
  });
}

export function installmentHintHtml(ct) {
  const info = S.contractAttentionInfo(ct);
  if (info.source !== 'installment') return '';
  const inst = S.nextInstallmentInfo(ct);
  if (!inst) return '';
  const color = info.level === 'qua_han' ? 'var(--danger)' : 'var(--warning)';

  return `<div class="field-hint" style="margin-top:3px">Kỳ ${inst.idx + 1}: <b style="color:${color}">${formatVND(info.dueAmount)}</b></div>`;
}

export function installmentNextBoxHtml(contract, elId = 'installment-next-box') {
  const info = S.nextInstallmentInfo(contract);
  if (!info) return '';
  const { idx, next, urgency } = info;
  const cls = urgency === 'qua_han' ? 'is-overdue' : urgency === 'gan_den_han' ? 'is-near-due' : '';

  const warnLine = urgency === 'qua_han'
    ? `<div class="text-danger fw-700" style="margin-top:4px;font-size:13px">${icon('alert', 'icon-sm')} Kỳ này đã quá hạn ${Math.abs(next.daysLeft)} ngày</div>`
    : urgency === 'gan_den_han'
      ? `<div class="fw-700" style="margin-top:4px;font-size:13px;color:var(--warning)">${icon('alert', 'icon-sm')} Còn ${next.daysLeft} ngày nữa đến hạn kỳ này</div>`
      : '';
  return `
    <button type="button" id="${elId}" class="installment-next-btn ${cls}">
      <span class="installment-next-col"><span class="field-hint">Kỳ</span>Kỳ ${idx + 1}</span>
      <span class="installment-next-col"><span class="field-hint">Ngày</span>${formatDate(next.dueDate)}</span>
      <span class="installment-next-col installment-next-amount"><span class="field-hint">Số tiền trả nợ gốc</span>${formatVND(next.dueAmount)}</span>
      ${icon('chevronRight', 'icon-sm')}
    </button>
    ${warnLine}
  `;
}

export function bindInstallmentNextBox(root, contract, elId = 'installment-next-box') {
  const btn = root.querySelector('#' + elId);
  if (btn) btn.addEventListener('click', () => openInstallmentPlanModal(contract));
}

export function openInstallmentPlanModal(contract) {
  const plan = S.computeInstallmentPlan(contract);
  if (!plan) return;
  const nextIdx = plan.findIndex((p) => p.dueAmount > 0);
  openModal({
    title: `Kế hoạch trả nợ — HĐ ${contract.code}`,
    bodyHtml: `
      <table class="installment-table">
        <thead><tr><th>Kỳ hạn trả nợ</th><th>Ngày</th><th>Số tiền trả nợ gốc</th></tr></thead>
        <tbody>
          ${plan.map((p, i) => {

            const amountToShow = p.dueAmount > 0 ? p.dueAmount : p.amount;
            const urgency = p.dueAmount > 0 ? (p.daysLeft < 0 ? 'qua_han' : p.daysLeft <= S.NEAR_DUE_DAYS ? 'gan_den_han' : null) : null;
            const color = urgency === 'qua_han' ? 'var(--danger)' : urgency === 'gan_den_han' ? 'var(--warning)' : 'var(--text)';
            const badge = urgency === 'qua_han'
              ? `<span class="badge badge-red" style="margin-left:6px">Quá hạn ${Math.abs(p.daysLeft)} ngày</span>`
              : urgency === 'gan_den_han'
                ? `<span class="badge badge-yellow" style="margin-left:6px">Còn ${p.daysLeft} ngày</span>`
                : '';
            const diffNote = urgency && p.dueAmount !== p.amount
              ? `<tr class="${i === nextIdx ? 'is-next-due' : ''}"><td colspan="3" class="field-hint" style="text-align:right;padding-top:0">(kỳ ghi ${formatVND(p.amount)}, đã trừ phần trả dư từ trước)</td></tr>`
              : '';
            return `
            <tr class="${i === nextIdx ? 'is-next-due' : ''}${p.paid ? ' is-paid' : ''}">
              <td>Kỳ ${i + 1}${i === nextIdx ? ` <span class="field-hint" style="display:inline">(kỳ tới)</span>` : ''}</td>
              <td>${formatDate(p.dueDate)}</td>
              <td style="color:${color};font-weight:600">${p.paid ? `<s class="installment-paid" title="Đã trả đủ kỳ này">${formatVND(amountToShow)}</s>` : `${formatVND(amountToShow)}${badge}`}</td>
            </tr>
            ${diffNote}
          `;
          }).join('')}
        </tbody>
      </table>
    `,
  });
}

export function mountScrollTopButton(hostEl) {
  if (!hostEl) return;
  hostEl.querySelector('.scroll-top-btn')?.remove();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'scroll-top-btn';
  btn.setAttribute('aria-label', 'Về đầu trang');
  btn.title = 'Về đầu trang';
  btn.innerHTML = icon('arrowUp', 'icon-sm');
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  hostEl.appendChild(btn);
  const onScroll = () => {
    if (!btn.isConnected) { window.removeEventListener('scroll', onScroll); return; }
    btn.classList.toggle('show', window.scrollY > 500);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

export function periodStepperHtml({ canPrev, canNext }) {
  return `<span class="period-step" role="group" aria-label="Chuyển nhanh kỳ báo cáo">
    <button type="button" class="period-step-btn" data-step="1" title="Tháng sau" aria-label="Chuyển sang tháng sau" ${canNext ? '' : 'disabled'}>${icon('chevronDown')}</button>
    <button type="button" class="period-step-btn" data-step="-1" title="Tháng trước" aria-label="Chuyển sang tháng trước" ${canPrev ? '' : 'disabled'}>${icon('chevronDown')}</button>
  </span>`;
}

export function syncPeriodStepper(root, index, count) {
  const next = root.querySelector('.period-step-btn[data-step="1"]');
  const prev = root.querySelector('.period-step-btn[data-step="-1"]');
  if (next) next.disabled = index >= count - 1;
  if (prev) prev.disabled = index <= 0;
}
