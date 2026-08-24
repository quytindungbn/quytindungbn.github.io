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
//
// Giao diện học theo các app nhắn tin/hỗ trợ phổ biến (Messenger/Zalo/
// Intercom): gộp nhóm tin nhắn liên tiếp cùng 1 người (chỉ hiện avatar/tên ở
// tin ĐẦU nhóm), có vạch chia ngày, giờ gửi nhỏ gọn nằm NGAY trong bong bóng
// (không chiếm riêng 1 dòng), avatar khác màu theo từng người, VÀ phân biệt
// RÕ 3 vai trò bằng màu bong bóng — chứ không chỉ 2 vai (trái/phải) như bản
// trước: "của tôi" (chính người đang xem gửi) tô màu chủ đạo bên phải; "của
// khách hàng" tô màu trung tính bên trái; "của đồng nghiệp khác" (1 quản trị
// viên/nhân viên KHÁC cũng đang trả lời cùng hội thoại) tô màu xanh nhạt bên
// trái — để quản trị viên luôn phân biệt được ngay đâu là câu hỏi thật của
// khách, đâu là đồng nghiệp mình đã trả lời trước đó.
import { openModal } from './modal.js';
import * as S from '../state.js';
import { icon } from '../icons.js';
import { toast } from './toast.js';
import { escapeHtml, initials, colorFor, formatDate } from '../utils.js';

const POLL_MS = 7000;
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

/** "Nhóm" 1 tin nhắn thuộc về ai — dùng để gộp avatar/tên cho các tin liên tiếp cùng người, KHÔNG phân biệt "của tôi hay của người khác" (2 tin liên tiếp của 2 quản trị viên khác nhau vẫn phải tách nhóm riêng). */
function senderGroupKey(m) {
  return m.senderRole === 'admin' ? `admin:${m.senderAdminId || '?'}` : `customer:${m.customerId}`;
}

/**
 * Tên hiển thị + màu avatar cho 1 tin nhắn, tùy theo AI đang xem khung chat
 * này (session) — khách hàng không cần biết chính xác nhân viên nào đang trả
 * lời (không tải bảng admins về phía khách, xem loadCustomerSessionData) nên
 * hiện tên quỹ tín dụng thay cho tên riêng của người trả lời.
 */
function senderInfo(m, session, customerName) {
  if (m.senderRole === 'customer') {
    return { name: customerName || 'Khách hàng', seed: m.customerId, kind: 'customer' };
  }
  if (session.role === 'admin') {
    const admin = S.getAdmin(m.senderAdminId);
    return { name: admin?.name || 'Nhân viên', seed: m.senderAdminId || 'admin', kind: 'staff' };
  }
  return { name: S.getOrg()?.shortName || 'Hỗ trợ', seed: m.senderAdminId || 'admin', kind: 'staff' };
}

function dividerHtml(label) {
  return `<div class="chat-date-divider"><span>${escapeHtml(label)}</span></div>`;
}

function rowHtml(m, { mine, showHead, info }) {
  const bubbleKindCls = mine ? 'mine' : info.kind === 'staff' ? 'staff' : 'customer';
  return `
    <div class="chat-msg-row ${mine ? 'mine' : 'theirs'} ${showHead ? 'group-start' : 'group-cont'}">
      <div class="chat-avatar-slot">${!mine && showHead ? `<div class="chat-avatar" style="background:${colorFor(info.seed)}">${initials(info.name)}</div>` : ''}</div>
      <div class="chat-bubble-wrap">
        ${!mine && showHead ? `<div class="chat-sender-name">${escapeHtml(info.name)}</div>` : ''}
        <div class="chat-bubble ${bubbleKindCls}">
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
  let lastGroupKey = null;
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

      function appendNew(list, session) {
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
            lastGroupKey = null; // sang ngày mới thì luôn hiện lại avatar/tên, không gộp xuyên ngày
          }

          const mine = session.role === 'admin' ? (m.senderRole === 'admin' && m.senderAdminId === session.id) : m.senderRole === 'customer';
          const gk = senderGroupKey(m);
          const showHead = !mine && gk !== lastGroupKey;
          lastGroupKey = gk;

          const wrap = document.createElement('div');
          wrap.innerHTML = rowHtml(m, { mine, showHead, info: senderInfo(m, session, customerName) });
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
