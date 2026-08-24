// Khung chat hỗ trợ — dùng CHUNG cho cả 2 phía: khách hàng (mở hội thoại của
// CHÍNH mình qua nút nổi, xem shell.js renderChatFab) và quản trị viên/nhân
// viên (mở hội thoại của 1 khách hàng cụ thể, xem js/views/admin/support.js).
// Chỉ khác nhau đúng 1 điểm: customerId truyền vào — S.sendChatMessage() tự
// biết gửi với vai trò nào dựa theo session đang đăng nhập, không cần phân
// biệt gì thêm ở đây.
//
// Cập nhật tin nhắn mới bằng POLLING NGẮN (mỗi 7 giây) — NHƯNG chỉ chạy
// trong lúc khung chat này đang mở (bắt đầu lúc mở, tự dừng lúc đóng, xem
// onClose) — KHÔNG phải polling toàn app kiểu setInterval đã bị bỏ trước đây
// (xem ghi chú ở js/state.js refreshSessionData()) — 2 việc khác hẳn nhau:
// polling ở ĐÂY chỉ ảnh hưởng đúng khung chat, người dùng đang thật sự nhìn
// vào màn hình này nên không có gì để "mất" (không có ô lọc/gõ dở nào khác).
import { openModal } from './modal.js';
import * as S from '../state.js';
import { icon } from '../icons.js';
import { toast } from './toast.js';
import { escapeHtml, formatDateTime } from '../utils.js';

const POLL_MS = 7000;

function isNearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}

function bubbleHtml(m, isMine) {
  return `
    <div class="chat-row ${isMine ? 'mine' : ''}">
      <div class="chat-bubble">${escapeHtml(m.message)}</div>
      <div class="chat-time">${formatDateTime(m.createdAt)}</div>
    </div>`;
}

/**
 * Mở khung chat cho hội thoại của customerId. `title` hiện ở đầu khung (VD:
 * tên khách hàng, hoặc "Hỗ trợ" khi khách tự mở). `opts.onClose` (tùy chọn) —
 * gọi lúc khung chat đóng lại, dùng ở trang "Hỗ trợ" (admin) để tải lại danh
 * sách hội thoại ngay sau khi xem xong (cập nhật lại chấm đỏ "chưa đọc").
 */
export function openChatPanel(customerId, title, opts = {}) {
  let renderedIds = new Set();
  let emptyShown = false;
  let timer = null;

  openModal({
    title: title || 'Hỗ trợ',
    bodyHtml: `<div class="chat-log" id="chat-log"></div>`,
    footHtml: `
      <form id="chat-form" class="chat-input-row">
        <input id="chat-input" placeholder="Nhập câu hỏi của bạn..." autocomplete="off" />
        <button type="submit" class="btn btn-primary" id="chat-send" style="border-radius:50%;width:42px;height:42px;padding:0;flex:none;display:flex;align-items:center;justify-content:center">${icon('chevronRight', 'icon-sm')}</button>
      </form>
    `,
    onMount(sheet) {
      const logEl = sheet.querySelector('#chat-log');
      const form = sheet.querySelector('#chat-form');
      const input = sheet.querySelector('#chat-input');

      function appendNew(list, session) {
        const frag = document.createDocumentFragment();
        let any = false;
        for (const m of list) {
          if (renderedIds.has(m.id)) continue;
          renderedIds.add(m.id);
          const wrap = document.createElement('div');
          wrap.innerHTML = bubbleHtml(m, m.senderRole === session.role);
          frag.appendChild(wrap.firstElementChild);
          any = true;
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
            logEl.innerHTML = `<div class="text-sm text-muted" style="text-align:center;padding:24px 0">Chưa có tin nhắn nào, hãy gửi câu hỏi của bạn.</div>`;
          }
        } else {
          const added = appendNew(list, session);
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
        input.focus();
        try {
          await S.sendChatMessage(customerId, text);
          await loadAndRender({ forceScroll: true });
        } catch (err) {
          toast(err.message || 'Không gửi được tin nhắn', 'error');
          input.value = text; // trả lại nội dung vừa gõ để không mất chữ khi gửi lỗi
        }
      });
    },
    onClose() {
      if (timer) clearInterval(timer);
      opts.onClose && opts.onClose();
    },
  });
}
