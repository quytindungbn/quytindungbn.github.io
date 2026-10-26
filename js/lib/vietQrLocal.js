import { encodeQr } from './qrEncode.js';

export function crc16(text) {
  let crc = 0xFFFF;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xFFFF) : ((crc << 1) & 0xFFFF);
  }
  return crc;
}

const tlv = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

function asciiOnly(text, max) {
  return String(text || '')
    .replace(/[đ]/g, 'd').replace(/[Đ]/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function clipDisplay(display, max = 50) {
  const norm = (t) => asciiOnly(t, Infinity).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  let out = String(display || '').replace(/\s+/g, ' ').trim();
  while (out && norm(out).length > max) out = out.slice(0, -1);
  return out.trim();
}

export function buildVietQrPayload({ bin, accountNo, amount, content }) {
  const money = Math.round(Number(amount) || 0);
  const info = asciiOnly(content, 50);
  const account = tlv('00', 'A000000727')
    + tlv('01', tlv('00', String(bin)) + tlv('01', String(accountNo)))
    + tlv('02', 'QRIBFTTA');
  const body = tlv('00', '01')
    + tlv('01', money > 0 ? '12' : '11')
    + tlv('38', account)
    + tlv('53', '704')
    + (money > 0 ? tlv('54', String(money)) : '')
    + tlv('58', 'VN')
    + (info ? tlv('62', tlv('08', info)) : '')
    + '6304';
  return body + crc16(body).toString(16).toUpperCase().padStart(4, '0');
}

const SANS = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const GREEN = '#0c4a3f';

function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export function logoBoxModules(size) {
  let b = Math.round(size * 0.14);
  if (b % 2 === 0) b++;
  return Math.max(5, b);
}

function paintLogo(ctx, qr, x, y, mod, quiet, logo) {
  if (!logo) return;
  const box = logoBoxModules(qr.size);
  const side = box * mod;
  const lx = x + (quiet + (qr.size - box) / 2) * mod, ly = y + (quiet + (qr.size - box) / 2) * mod;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(lx, ly, side, side);
  const pad = Math.max(1, Math.round(mod * 0.4));
  const iw = logo.naturalWidth || logo.width, ih = logo.naturalHeight || logo.height;
  const k = Math.min((side - pad * 2) / iw, (side - pad * 2) / ih);
  ctx.drawImage(logo, lx + (side - iw * k) / 2, ly + (side - ih * k) / 2, iw * k, ih * k);
}

function paintQr(ctx, qr, x, y, mod, quiet) {
  const box = mod * (qr.size + quiet * 2);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, box, box);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) ctx.fillRect(x + (c + quiet) * mod, y + (r + quiet) * mod, mod, mod);
    }
  }
}

export function drawVietQrCompact(p, { logo = null } = {}) {
  const qr = encodeQr(buildVietQrPayload(p), 'M');
  const W = 400, PAD = 16, QUIET = 2;
  const mod = Math.max(3, Math.floor((W - PAD * 2) / (qr.size + QUIET * 2)));
  const qrBox = mod * (qr.size + QUIET * 2);
  const money = Math.round(Number(p.amount) || 0);
  const lines = [];
  const holder = p.displayAccountName || p.accountName;
  if (holder) lines.push({ text: String(holder), size: 23, weight: 700, color: GREEN });
  lines.push({ text: String(p.accountNo), size: 27, weight: 700, color: '#12231e' });
  if (money > 0) lines.push({ text: `${money.toLocaleString('vi-VN')} đ`, size: 34, weight: 800, color: GREEN });
  const gap = (l) => Math.round(l.size * 1.45);
  const H = PAD + qrBox + 12 + lines.reduce((sum, l) => sum + gap(l), 0) + PAD - 4;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  let y = PAD;
  const qx = Math.round((W - qrBox) / 2);
  paintQr(ctx, qr, qx, y, mod, QUIET);
  paintLogo(ctx, qr, qx, y, mod, QUIET, logo);
  y += qrBox + 12;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  lines.forEach((l) => {
    let size = l.size;
    ctx.font = `${l.weight} ${size}px ${SANS}`;
    while (size > 13 && ctx.measureText(l.text).width > W - PAD * 2) { size -= 1; ctx.font = `${l.weight} ${size}px ${SANS}`; }
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, W / 2, y + l.size, W - PAD * 2);
    y += gap(l);
  });
  return canvas;
}

export function drawVietQrCard(p, { logo = null } = {}) {
  const qr = encodeQr(buildVietQrPayload(p), 'M');
  const W = 720, PAD = 40, QUIET = 4;
  const mod = Math.max(4, Math.floor((W - PAD * 2 - 24) / (qr.size + QUIET * 2)));
  const qrBox = mod * (qr.size + QUIET * 2);
  const money = Math.round(Number(p.amount) || 0);
  const rows = [];
  if (p.bankName) rows.push(['Ngân hàng', p.bankName]);
  const holder = p.displayAccountName || p.accountName;
  if (holder) rows.push(['Chủ tài khoản', holder, false, true]);
  rows.push(['Số tài khoản', String(p.accountNo)]);
  if (money > 0) rows.push(['Số tiền', `${money.toLocaleString('vi-VN')} đ`, true]);
  const note = p.displayContent ? clipDisplay(p.displayContent, 50) : asciiOnly(p.content, 50);
  if (note) rows.push(['Nội dung', note]);

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `700 26px ${SANS}`;
  const laid = rows.map(([label, value, big, green]) => {
    measure.font = `700 ${big ? 34 : 26}px ${SANS}`;
    return { label, big, green, lines: wrapLines(measure, value, W - PAD * 2) };
  });
  let H = PAD + 40 + 30 + 26 + qrBox + 28;
  laid.forEach((r) => { H += 26 + r.lines.length * (r.big ? 42 : 34) + 14; });
  H += PAD - 6;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  let y = PAD + 32;
  if (p.orgName) {
    ctx.fillStyle = GREEN; ctx.font = `800 30px ${SANS}`;
    ctx.fillText(String(p.orgName), W / 2, y, W - PAD * 2);
  }
  y += 34;
  ctx.fillStyle = '#6a7a73'; ctx.font = `500 21px ${SANS}`;
  ctx.fillText('Quét mã bằng app ngân hàng để chuyển khoản', W / 2, y, W - PAD * 2);
  y += 26;
  const qx = Math.round((W - qrBox) / 2);
  paintQr(ctx, qr, qx, y, mod, QUIET);
  paintLogo(ctx, qr, qx, y, mod, QUIET, logo);
  y += qrBox + 28;
  ctx.textAlign = 'left';
  laid.forEach((row) => {
    ctx.strokeStyle = '#dbe6e0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PAD, y - 12); ctx.lineTo(W - PAD, y - 12); ctx.stroke();
    ctx.fillStyle = '#6a7a73'; ctx.font = `600 19px ${SANS}`;
    ctx.fillText(row.label.toUpperCase(), PAD, y + 14, W - PAD * 2);
    y += 26;
    ctx.fillStyle = row.big || row.green ? GREEN : '#12231e'; ctx.font = `700 ${row.big ? 34 : 26}px ${SANS}`;
    row.lines.forEach((ln) => { y += row.big ? 42 : 34; ctx.fillText(ln, PAD, y - 8, W - PAD * 2); });
    y += 14;
  });
  return canvas;
}
