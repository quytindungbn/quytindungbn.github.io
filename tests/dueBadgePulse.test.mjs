import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const overview = readFileSync(new URL('../js/views/admin/overview.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../js/components/shell.js', import.meta.url), 'utf8');

const balanced = (src, from) => {
  let depth = 0;
  for (let i = src.indexOf('{', from); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(src.indexOf('{', from), i + 1);
  }
  return '';
};
const keyframes = (name) => balanced(css, css.indexOf(`@keyframes ${name} `));
const rule = (selector) => (css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[1] || '';
const ring = (frames) => {
  const start = frames.match(/0%\s*\{\s*box-shadow:\s*0 0 0 0 rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/);
  const end = frames.match(/70%\s*\{\s*box-shadow:\s*0 0 0 (\d+)px rgba\(\d+, \d+, \d+, 0\)/);
  return { g: +start[2], alpha: +start[4], spread: +end[1] };
};

test('Số đỏ nhắc việc đến hạn: ô trong "Cần chú ý" và số đỏ trên menu đều có vòng tỏa chạy mãi', () => {
  assert.match(rule('.lux-bubble'), /animation: luxBubble 2\.4s ease-out infinite;/);
  assert.match(rule('.nav-badge.is-due, .bottom-nav-badge.is-due'), /animation: luxBubbleDark 2\.4s ease-out infinite;/);
  assert.ok(overview.includes('<b class="lux-bubble"'));
  assert.ok(shell.includes("' is-due'"));
});

test('Vòng tỏa KHÔNG bị tắt khi máy bật "giảm chuyển động" (máy tính tắt hiệu ứng động vẫn thấy tỏa như điện thoại)', () => {
  const blocks = [...css.matchAll(/@media \(prefers-reduced-motion[^{]*\)/g)].map((m) => balanced(css, m.index));
  assert.ok(blocks.length > 0);
  for (const b of blocks) assert.ok(!/lux-bubble|nav-badge|bottom-nav-badge/.test(b), b.slice(0, 80));
});

test('Vòng tỏa: nền trắng giữ nguyên (đỏ, 9px); nền menu xanh đậm dùng vòng sáng và đậm hơn để nhìn rõ', () => {
  const light = ring(keyframes('luxBubble'));
  const dark = ring(keyframes('luxBubbleDark'));
  assert.ok(light.spread >= 9 && light.alpha >= 0.4);
  assert.ok(dark.spread >= 9 && dark.alpha >= 0.6);
  assert.ok(dark.alpha > light.alpha);
  assert.ok(dark.g >= 90, 'vòng sáng hơn màu đỏ của số (kênh xanh lá > 54)');
});
