import { openModal } from './modal.js';
import * as S from '../state.js';
import { icon } from '../icons.js';
import { toast } from './toast.js';
import { escapeHtml, initials, colorFor, formatDate } from '../utils.js';

const POLL_MS = 3000;
const COMPOSER_MAX_HEIGHT = 110;

export const DEFAULT_CHAT_TITLE = 'Hỗ trợ tư vấn';

function isNearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}

function hhmm(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

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

function customerAvatarHtml(customerName, customerId) {
  return `<div class="chat-avatar" style="background:${colorFor(customerId || customerName || 'KH')}">${initials(customerName || 'KH')}</div>`;
}

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

export function openChatPanel(customerId, title, opts = {}) {
  let lastGroupKey = null;
  let lastDayKey = null;
  let renderedIds = new Set();
  let emptyShown = false;
  let timer = null;

  openModal({
    title: title || DEFAULT_CHAT_TITLE,
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
      const customerName = S.getCustomer(customerId)?.name || (title && title !== DEFAULT_CHAT_TITLE ? title : '');

      input.addEventListener('input', () => {
        autoResizeComposer(input);
        sendBtn.disabled = !input.value.trim();
      });
      input.addEventListener('keydown', (e) => {

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
            lastGroupKey = null;
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
        catch (e) { return; }
        const wasNearBottom = isNearBottom(logEl);
        if (!list.length) {
          if (!renderedIds.size && !emptyShown) {
            emptyShown = true;
            logEl.innerHTML = `<div class="chat-empty">${icon('message', 'icon-lg')}<p>Hãy đặt câu hỏi để gặp trực tiếp nhân viên tư vấn.</p></div>`;
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
          input.value = text;
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
