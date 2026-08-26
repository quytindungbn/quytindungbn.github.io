import { icon } from '../icons.js';
import { openModal } from './modal.js';
import { debounce, formatVND, formatDate } from '../utils.js';
import * as S from '../state.js';

/**
 * Ô tìm kiếm chuẩn (icon kính lúp + input + nút "x" xóa nhanh ở cuối ô) —
 * nút "x" chỉ hiện khi đang có chữ trong ô, bấm vào xóa sạch ngay lập tức
 * (không cần tự xóa từng chữ). Dùng chung `bindSearchBox()` bên dưới để gắn
 * sự kiện (debounce gõ chữ + xử lý nút "x").
 */
export function searchBoxHtml(id, placeholder, value = '') {
  return `
    <div class="search-box mb-8">
      ${icon('search', 'icon-sm')}
      <input id="${id}" placeholder="${placeholder}" value="${value}"/>
      <button type="button" class="search-clear-btn" id="${id}-clear" style="display:${value ? 'flex' : 'none'}" title="Xóa">${icon('x', 'icon-sm')}</button>
    </div>`;
}
/** Gắn sự kiện cho ô tìm kiếm dựng bằng searchBoxHtml() — `onChange(text)` gọi mỗi khi giá trị đổi (có debounce lúc gõ, tức thì khi bấm nút "x"). */
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

/**
 * 2 chấm trạng thái của 1 Use — chấm trái = đã đăng nhập hay chưa, chấm phải
 * = đã bật thông báo hay chưa. Xanh = đã có (tốt), đỏ = chưa. Chú thích gộp
 * chung 1 dòng, gắn trên cả CỤM (không gắn riêng từng chấm) — di chuột vào
 * (hoặc chạm giữ trên điện thoại) bất kỳ đâu trong vùng 2 chấm đều hiện đủ cả
 * 2 ý cùng lúc, không cần rê trúng chính xác từng chấm 9px nhỏ xíu. Dùng ở
 * trang "Khách hàng & Hợp đồng" (ngang hàng tên khách, lề phải) và "Quản lý
 * User".
 */
export function statusDotsHtml(loggedIn, pushOn) {
  const dot = (on) => `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${on ? 'var(--success)' : 'var(--danger)'};flex:none"></span>`;
  const tooltip = `${loggedIn ? 'Đã đăng nhập' : 'Chưa đăng nhập'} · ${pushOn ? 'Đã bật thông báo' : 'Chưa bật thông báo'}`;
  return `<span class="status-dots" title="${tooltip}" style="display:inline-flex;gap:5px;align-items:center;padding:4px">${dot(loggedIn)}${dot(pushOn)}</span>`;
}

export function statusBadge(statusObj) {
  return `<span class="badge ${statusObj.badge}">${statusObj.label}</span>`;
}
// Bí danh cho các view dùng tên cũ
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

  // Chế độ chọn nhiều — tích chọn nhiều mục cùng lúc, bấm "Xong" mới áp dụng.
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

/**
 * Pill lọc (Thôn/Xóm/Sắp xếp...) — bấm vào pill mở picker để CHỌN, nhưng
 * bỏ lọc thì bấm thẳng dấu "x" nhỏ ở góc pill (khi đang có lọc) cho nhanh,
 * không cần mở picker rồi "Bỏ chọn tất cả" rồi "Xong". `active` = đang có
 * lọc áp dụng (khác mặc định) thì mới hiện dấu "x"; `data-pill-clear` gắn
 * đúng id pill để nơi gọi tự biết cần xóa bộ lọc nào.
 */
export function pillSelectHtml(id, label, active = false) {
  return `
    <span style="position:relative;display:inline-flex">
      <button class="pill-select" id="${id}">${label} ${icon('chevronDown', 'icon-sm')}</button>
      ${active ? `<button type="button" class="pill-clear-btn" data-pill-clear="${id}" title="Bỏ lọc" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;border:none;background:var(--text);color:var(--surface);display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1;cursor:pointer;padding:0">✕</button>` : ''}
    </span>`;
}

/** Modal nhỏ để "Cấp lại mật khẩu" — admin có thể tự gõ mật khẩu cụ thể, để trống thì hệ thống tự sinh ngẫu nhiên. Dùng chung cho cả Use lẫn Quản trị viên/nhân viên. */
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

/**
 * Ô tóm tắt "Kỳ tới" (Kỳ N — Ngày — Số tiền), bấm vào mở popup xem chi tiết
 * đầy đủ từng kỳ (xem bindInstallmentNextBox() + openInstallmentPlanModal()
 * bên dưới). Trả về chuỗi rỗng nếu hợp đồng không có (hoặc đã trả đủ hết)
 * phân kỳ — nơi gọi chèn thẳng vào bodyHtml, không cần tự kiểm tra trước.
 * "Kỳ tới" tính bằng S.nextInstallmentInfo() — dùng CHUNG với bộ lọc "Gần
 * đến hạn"/"Quá hạn" ở trang Khách hàng (admin/customers.js), để mọi nơi
 * tính nhất quán, không lặp code.
 */
export function installmentNextBoxHtml(contract, elId = 'installment-next-box') {
  const info = S.nextInstallmentInfo(contract);
  if (!info) return '';
  const { idx, next, urgency } = info;
  const cls = urgency === 'qua_han' ? 'is-overdue' : urgency === 'gan_den_han' ? 'is-near-due' : '';
  const warnLine = urgency === 'qua_han'
    ? `<div class="field-hint text-danger" style="margin-top:4px">${icon('alert', 'icon-sm')} Kỳ này đã quá hạn ${Math.abs(next.daysLeft)} ngày</div>`
    : urgency === 'gan_den_han'
      ? `<div class="field-hint" style="margin-top:4px;color:var(--warning)">${icon('alert', 'icon-sm')} Còn ${next.daysLeft} ngày nữa đến hạn kỳ này</div>`
      : '';
  return `
    <button type="button" id="${elId}" class="installment-next-btn ${cls}">
      <span class="installment-next-col"><span class="field-hint">Kỳ</span>Kỳ ${idx + 1}</span>
      <span class="installment-next-col"><span class="field-hint">Ngày</span>${formatDate(next.dueDate)}</span>
      <span class="installment-next-col installment-next-amount"><span class="field-hint">Số tiền trả</span>${formatVND(next.dueAmount)}</span>
      ${icon('chevronRight', 'icon-sm')}
    </button>
    ${warnLine}
  `;
}

/** Gắn sự kiện bấm cho installmentNextBoxHtml() — mở popup bảng đầy đủ từng kỳ. Gọi trong onMount() sau khi đã chèn bodyHtml vào DOM. */
export function bindInstallmentNextBox(root, contract, elId = 'installment-next-box') {
  const btn = root.querySelector('#' + elId);
  if (btn) btn.addEventListener('click', () => openInstallmentPlanModal(contract));
}

/** Popup "Kế hoạch trả nợ" — bảng đầy đủ TỪNG kỳ (Kỳ hạn trả nợ | Ngày | Số tiền), mở từ installmentNextBoxHtml(). */
export function openInstallmentPlanModal(contract) {
  const plan = S.computeInstallmentPlan(contract);
  if (!plan) return;
  const nextIdx = plan.findIndex((p) => p.dueAmount > 0);
  openModal({
    title: `Kế hoạch trả nợ — HĐ ${contract.code}`,
    bodyHtml: `
      <table class="installment-table">
        <thead><tr><th>Kỳ hạn trả nợ</th><th>Ngày</th><th>Số tiền</th></tr></thead>
        <tbody>
          ${plan.map((p, i) => {
            // Kỳ đã trả đủ (dueAmount = 0) -> hiện số ghi trong Excel để tham
            // khảo, không cần tô màu cảnh báo. Kỳ còn thiếu tiền (dueAmount >
            // 0) -> LUÔN hiện đúng dueAmount (số thực còn phải trả), tô màu
            // theo đúng mức cảnh báo y hệt hạn hợp đồng gốc (NEAR_DUE_DAYS).
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
            <tr class="${i === nextIdx ? 'is-next-due' : ''}">
              <td>Kỳ ${i + 1}${i === nextIdx ? ` <span class="field-hint" style="display:inline">(kỳ tới)</span>` : ''}</td>
              <td>${formatDate(p.dueDate)}</td>
              <td style="color:${color};font-weight:600">${formatVND(amountToShow)}${badge}</td>
            </tr>
            ${diffNote}
          `;
          }).join('')}
        </tbody>
      </table>
      <div class="field-hint mt-8">Chưa gửi nhắc nợ tự động qua Zalo/nhắc nợ cho từng kỳ — mới chỉ xem được tại đây.</div>
    `,
  });
}
