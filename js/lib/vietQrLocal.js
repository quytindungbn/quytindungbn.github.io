// Ảnh QR chuyển khoản VietQR tự vẽ ngay trên máy (không cần mạng, không phụ thuộc img.vietqr.io).
// Dùng để hiện QR trong popup thanh toán và cho nút "Chia sẻ ảnh QR" / "Tải ảnh QR" — xem contractDetail.js.
// Nội dung QR theo chuẩn VietQR (EMVCo, NAPAS 247): chuyển nhanh tới số tài khoản, có số tiền và nội dung chuyển khoản.
import { encodeQr } from './qrEncode.js';

/** CRC-16/CCITT-FALSE (đa thức 0x1021, khởi tạo 0xFFFF) — mã kiểm tra cuối chuỗi QR theo chuẩn EMVCo. */
export function crc16(text) {
  let crc = 0xFFFF;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xFFFF) : ((crc << 1) & 0xFFFF);
  }
  return crc;
}

const tlv = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** Bỏ dấu, chỉ giữ ký tự in được của bảng mã ASCII (nội dung chuyển khoản trong QR không dùng tiếng Việt có dấu). */
function asciiOnly(text, max) {
  return String(text || '')
    .replace(/[đ]/g, 'd').replace(/[Đ]/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Chuỗi nội dung của mã QR chuyển khoản VietQR. */
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
const SERIF = '"Source Serif 4", Charter, Georgia, "Times New Roman", serif';

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

/** Vẽ mã QR từng ô vuông nguyên pixel (nét, không nhòe) trên nền trắng, có viền trắng `quiet` ô xung quanh. */
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

/** Chỉ riêng mã QR (hình vuông, nền trắng) — dùng cho ô QR nhỏ trong popup nhân viên. */
export function drawVietQrOnly(p) {
  const qr = encodeQr(buildVietQrPayload(p), 'M');
  const QUIET = 3, mod = Math.max(4, Math.floor(480 / (qr.size + QUIET * 2)));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = mod * (qr.size + QUIET * 2);
  paintQr(canvas.getContext('2d'), qr, 0, 0, mod, QUIET);
  return canvas;
}

/**
 * Vẽ "thẻ" QR chuyển khoản (tên quỹ, mã QR, chủ tài khoản, số tài khoản, số tiền, nội dung) lên canvas, nền trắng.
 * @param {{ bin: string, accountNo: string, amount: number, content: string, accountName?: string, bankName?: string, orgName?: string }} p
 */
export function drawVietQrCard(p) {
  const qr = encodeQr(buildVietQrPayload(p), 'M');
  const W = 720, PAD = 40, QUIET = 4;
  const mod = Math.max(4, Math.floor((W - PAD * 2 - 24) / (qr.size + QUIET * 2)));
  const qrBox = mod * (qr.size + QUIET * 2);
  const money = Math.round(Number(p.amount) || 0);
  const rows = [];
  if (p.bankName) rows.push(['Ngân hàng', p.bankName]);
  if (p.accountName) rows.push(['Chủ tài khoản', p.accountName]);
  rows.push(['Số tài khoản', String(p.accountNo)]);
  if (money > 0) rows.push(['Số tiền', `${money.toLocaleString('vi-VN')} đ`, true]);
  if (p.content) rows.push(['Nội dung', asciiOnly(p.content, 50)]);

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `700 26px ${SANS}`;
  const laid = rows.map(([label, value, big]) => {
    measure.font = `700 ${big ? 34 : 26}px ${SANS}`;
    return { label, big, lines: wrapLines(measure, value, W - PAD * 2) };
  });
  let H = PAD + 40 + 30 + 26 + qrBox + 28; // tên quỹ + dòng hướng dẫn + khung QR
  laid.forEach((r) => { H += 26 + r.lines.length * (r.big ? 42 : 34) + 14; });
  H += PAD - 6;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  let y = PAD + 32;
  if (p.orgName) {
    ctx.fillStyle = '#0c4a3f'; ctx.font = `700 30px ${SERIF}`;
    ctx.fillText(String(p.orgName), W / 2, y, W - PAD * 2);
  }
  y += 34;
  ctx.fillStyle = '#6a7a73'; ctx.font = `500 21px ${SANS}`;
  ctx.fillText('Quét mã bằng app ngân hàng để chuyển khoản', W / 2, y, W - PAD * 2);
  y += 26;
  paintQr(ctx, qr, Math.round((W - qrBox) / 2), y, mod, QUIET);
  y += qrBox + 28;
  ctx.textAlign = 'left';
  laid.forEach((row) => {
    ctx.strokeStyle = '#dbe6e0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PAD, y - 12); ctx.lineTo(W - PAD, y - 12); ctx.stroke();
    ctx.fillStyle = '#6a7a73'; ctx.font = `600 19px ${SANS}`;
    ctx.fillText(row.label.toUpperCase(), PAD, y + 14, W - PAD * 2);
    y += 26;
    ctx.fillStyle = row.big ? '#0c4a3f' : '#12231e'; ctx.font = `700 ${row.big ? 34 : 26}px ${SANS}`;
    row.lines.forEach((ln) => { y += row.big ? 42 : 34; ctx.fillText(ln, PAD, y - 8, W - PAD * 2); });
    y += 14;
  });
  return canvas;
}
