// Khung chat hỗ trợ — dùng CHUNG cho cả 2 phía: khách hàng (mở hội thoại của
// CHÍNH mình qua nút nổi, xem shell.js renderChatFab) và quản trị viên/nhân
// viên (mở hội thoại của 1 khách hàng cụ thể, xem js/views/admin/support.js).
// Chỉ khác nhau đúng 1 điểm: customerId truyền vào — S.sendChatMessage() tự
// biết gửi với vai trò nào dựa theo session đang đăng nhập, không cần phân
// biệt gì thêm ở đây.
//
// Cập nhật tin nhắn mới bằng POLLING NGẮN (mỗi 3 giây) — NHƯNG chỉ chạy
// trong lúc khung chat này đang mở (bắt đầu lúc mở, tự dừng lúc đóng, xem
// onClose) — KHÔNG phải polling toàn app kiểu setInterval đã bị bỏ trước đây
// (xem ghi chú ở js/state.js refreshSessionData()) — 2 việc khác hẳn nhau:
// polling ở ĐÂY chỉ ảnh hưởng đúng khung chat, người dùng đang thật sự nhìn
// vào màn hình này nên không có gì để "mất" (không có ô lọc/gõ dở nào khác).
//
// Giao diện kiểu Messenger, CỐ ĐỊNH theo VAI TRÒ (không đổi theo ai đang
// xem): tin của KHÁCH HÀNG luôn ở bên TRÁI, tin của QUẢN TRỊ VIÊN/NHÂN VIÊN
// (bất kể ai trong số họ trả lời) luôn ở bên PHẢI — cả 2 phía (khách hàng tự
// xem hội thoại của mình lẫn admin xem hộ) đều thấy giống nhau, khỏi phải
// suy nghĩ "bên nào là mình". Avatar tách 2 bên (khách hàng dùng tên viết
// tắt của chính họ; quản trị viên/nhân viên dùng icon chung của quỹ, KHÔNG
// hiện tên ai cụ thể — biết đang chat với "Quỹ tín dụng" là đủ, đúng ý không
// cần lộ tên riêng từng nhân viên). Gộp nhóm tin nhắn liên tiếp cùng phía
// (chỉ hiện avatar ở tin ĐẦU nhóm) + vạch chia ngày + giờ gửi nhỏ gọn nằm
// ngay trong bong bóng, không chiếm riêng 1 dòng.
import { openModal } from './modal.js';
import * as S from '../state.js';
import { icon } from '../icons.js';
import { toast } from './toast.js';
import { escapeHtml, initials, colorFor, formatDate } from '../utils.js';

const POLL_MS = 3000;
const COMPOSER_MAX_HEIGHT = 110;

function isNearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}

function hhmm(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

/** "Hôm nay" / "Hôm qua" / dd/mm/yyyy — dùng cho vạch chia ngày giữa các cụm tin nhắn. */
function dateDividerLabel(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(dt)) / 86400000);
  if (diffDays === 0) return 'Hôm nay';
  if (diffDays === 1) return 'Hôm qua';
  return formatDate(dt);
}

function dayKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
}

function dividerHtml(label) {
  return `<div class="chat-date-divider"><span>${escapeHtml(label)}</span></div>`;
}

/** Avatar bên khách hàng — viết tắt tên thật, màu riêng theo customerId (giống avatar dùng khắp app, xem colorFor/initials). */
function customerAvatarHtml(customerName, customerId) {
  return `<div class="chat-avatar" style="background:${colorFor(customerId || customerName || 'KH')}">${initials(customerName || 'KH')}</div>`;
}
/** Avatar bên quỹ tín dụng — icon CHUNG (không phải initials/tên riêng từng nhân viên), đại diện "quỹ đang trả lời" chứ không lộ danh tính người trả lời cụ thể. */
function orgAvatarHtml() {
  return `<div class="chat-avatar chat-avatar-org">${icon('landmark', 'icon-sm')}</div>`;
}

function rowHtml(m, { showHead, customerName }) {
  const fromCustomer = m.senderRole === 'customer';
  return `
    <div class="chat-msg-row ${fromCustomer ? 'from-customer' : 'from-admin'} ${showHead ? 'group-start' : 'group-cont'}">
      <div class="chat-avatar-slot">${showHead ? (fromCustomer ? customerAvatarHtml(customerName, m.customerId) : orgAvatarHtml()) : ''}</div>
      <div class="chat-bubble-wrap">
        <div class="chat-bubble ${fromCustomer ? 'customer' : 'admin'}">
          <span class="chat-bubble-text">${escapeHtml(m.message)}</span>
          <span class="chat-bubble-time">${hhmm(m.createdAt)}</span>
        </div>
      </div>
    </div>`;
}

function autoResizeComposer(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT) + 'px';
}

/**
 * Mở khung chat cho hội thoại của customerId. `title` hiện ở đầu khung (VD:
 * tên khách hàng, hoặc "Hỗ trợ" khi khách tự mở). `opts.onClose` (tùy chọn) —
 * gọi lúc khung chat đóng lại, dùng ở trang "Hỗ trợ" (admin) để tải lại danh
 * sách hội thoại ngay sau khi xem xong (cập nhật lại chấm đỏ "chưa đọc").
 */
export function openChatPanel(customerId, title, opts = {}) {
  let lastGroupKey = null; // 'customer' | 'admin' của tin gần nhất đã vẽ — đổi phía mới hiện lại avatar
  let lastDayKey = null;
  let renderedIds = new Set();
  let emptyShown = false;
  let timer = null;

  openModal({
    title: title || 'Hỗ trợ',
    sheetClass: 'chat-modal-sheet',
    bodyHtml: `<div class="chat-log" id="chat-log"></div>`,
    footHtml: `
      <form id="chat-form" class="chat-input-row">
        <textarea id="chat-input" rows="1" placeholder="Nhập câu hỏi của bạn..." autocomplete="off" enterkeyhint="send"></textarea>
        <button type="submit" class="chat-send-btn" id="chat-send" disabled>${icon('send', 'icon-sm')}</button>
      </form>
    `,
    onMount(sheet) {
      const logEl = sheet.querySelector('#chat-log');
      const form = sheet.querySelector('#chat-form');
      const input = sheet.querySelector('#chat-input');
      const sendBtn = sheet.querySelector('#chat-send');
      const customerName = S.getCustomer(customerId)?.name || (title !== 'Hỗ trợ' ? title : '');

      input.addEventListener('input', () => {
        autoResizeComposer(input);
        sendBtn.disabled = !input.value.trim();
      });
      input.addEventListener('keydown', (e) => {
        // Enter gửi tin, Shift+Enter xuống dòng — đúng quy ước của mọi app nhắn tin phổ biến.
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
      });

      function appendNew(list) {
        const frag = document.createDocumentFragment();
        let any = false;
        for (const m of list) {
          if (renderedIds.has(m.id)) continue;
          renderedIds.add(m.id);
          any = true;

          const dk = dayKey(m.createdAt);
          if (dk !== lastDayKey) {
            const div = document.createElement('div');
            div.innerHTML = dividerHtml(dateDividerLabel(m.createdAt));
            frag.appendChild(div.firstElementChild);
            lastDayKey = dk;
            lastGroupKey = null; // sang ngày mới thì luôn hiện lại avatar, không gộp xuyên ngày
          }

          const showHead = m.senderRole !== lastGroupKey;
          lastGroupKey = m.senderRole;

          const wrap = document.createElement('div');
          wrap.innerHTML = rowHtml(m, { showHead, customerName });
          frag.appendChild(wrap.firstElementChild);
        }
        if (any) {
          if (emptyShown) { logEl.innerHTML = ''; emptyShown = false; }
          logEl.appendChild(frag);
        }
        return any;
      }

      async function loadAndRender({ forceScroll = false } = {}) {
        const session = S.getSession();
        if (!session) return;
        let list;
        try { list = await S.listChatMessages(customerId); }
        catch (e) { return; } // im lặng, thử lại ở lượt sau (giữ đúng nội dung đang hiện)
        const wasNearBottom = isNearBottom(logEl);
        if (!list.length) {
          if (!renderedIds.size && !emptyShown) {
            emptyShown = true;
            logEl.innerHTML = `<div class="chat-empty">${icon('message', 'icon-lg')}<p>Chưa có tin nhắn nào, hãy gửi câu hỏi của bạn.</p></div>`;
          }
        } else {
          const added = appendNew(list);
          if (added && (forceScroll || wasNearBottom)) logEl.scrollTop = logEl.scrollHeight;
        }
        S.markChatRead(customerId).catch(() => {});
      }

      loadAndRender({ forceScroll: true });
      timer = setInterval(() => loadAndRender(), POLL_MS);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        autoResizeComposer(input);
        sendBtn.disabled = true;
        try {
          await S.sendChatMessage(customerId, text);
          await loadAndRender({ forceScroll: true });
        } catch (err) {
          toast(err.message || 'Không gửi được tin nhắn', 'error');
          input.value = text; // trả lại nội dung vừa gõ để không mất chữ khi gửi lỗi
          autoResizeComposer(input);
          sendBtn.disabled = false;
        }
        input.focus();
      });
    },
    onClose() {
      if (timer) clearInterval(timer);
      opts.onClose && opts.onClose();
    },
  });
}
