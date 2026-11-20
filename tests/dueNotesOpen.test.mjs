import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/views/admin/customerNotes.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('function dueBodyHtml'), src.indexOf('export function openDueNotesModal'));
const who = body.slice(body.indexOf('<button type="button" class="nz-who"'), body.indexOf('</button>', body.indexOf('class="nz-who"')) + 9);
const rule = (selector) => (css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[1] || '';

test('Nhắc việc đến hạn: ảnh đại diện + tên + địa chỉ khách nằm trong MỘT nút mở hồ sơ (bấm vào đâu cũng mở)', () => {
  assert.ok(who.includes('data-nt-open="${g.c.id}"'));
  assert.ok(who.includes('aria-label="Mở hồ sơ khách hàng ${escapeHtml(g.c.name)}"'));
  for (const part of ['class="av"', '<b>${escapeHtml(g.c.name)}</b>', '<small>${escapeHtml(addr)}</small>']) assert.ok(who.includes(part), part);
});

test('Nút mở hồ sơ hợp lệ: bên trong chỉ có thẻ span/b/small (không div, không liên kết); nút Gọi nằm NGOÀI để bấm Gọi không mở hồ sơ', () => {
  assert.ok(!/<(div|a|button)\b/.test(who.replace('<button type="button" class="nz-who"', '')));
  assert.ok(body.indexOf('</button>${phone}') > body.indexOf('class="nz-who"'));
  assert.ok(!who.includes('data-nt-call'));
});

test('Giữ nút "Mở hồ sơ ›" ở máy tính; cùng một cách bắt sự kiện mở hồ sơ cho cả hai nút', () => {
  assert.ok(body.includes('<button type="button" class="nz-open" data-nt-open="${g.c.id}">Mở hồ sơ ›</button>'));
  assert.equal(src.split("t.closest('[data-nt-open]')").length - 1, 1);
  assert.ok(src.includes("if (open) { closeFn(); if (onOpenCustomer) onOpenCustomer(open.dataset.ntOpen); return; }"));
});

test('Kiểu nút: con trỏ bàn tay, chiếm hết chỗ còn lại và co được (địa chỉ dài vẫn cắt …), rê chuột có nền nhạt + tên chuyển vàng; điện thoại KHÔNG bị ẩn', () => {
  assert.match(rule('.nz-who'), /cursor: pointer;/);
  assert.match(rule('.nz-who'), /flex: 1; min-width: 0;/);
  assert.match(rule('.nz-who:hover'), /background: #eef4f1;/);
  assert.match(rule('.nz-who:hover .nz-gt b'), /color: #8a6a22;/);
  assert.ok(!/\.nz-who[^{]*\{[^}]*display: none/.test(css));
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?\.nz-open \{ display: none; \}/);
});
