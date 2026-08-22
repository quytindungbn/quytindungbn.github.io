import { icon } from '../icons.js';
import { openModal } from './modal.js';
import { debounce } from '../utils.js';

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
