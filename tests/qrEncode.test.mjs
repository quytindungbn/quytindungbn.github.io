import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, __test as T } from '../js/lib/qrEncode.js';
import { crc16, buildVietQrPayload, logoBoxModules } from '../js/lib/vietQrLocal.js';

test('Reed-Solomon, thông tin định dạng/phiên bản và dung lượng khớp bảng chuẩn QR', () => {

  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(T.rsRemainder(data, T.rsDivisor(10)), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  assert.equal(T.formatBits('M', 0).toString(2).padStart(15, '0'), '101010000010010');
  assert.equal(T.formatBits('L', 0).toString(2).padStart(15, '0'), '111011111000100');
  assert.equal(T.versionBits(7).toString(2).padStart(18, '0'), '000111110010010100');
  assert.equal(T.versionBits(8).toString(2).padStart(18, '0'), '001000010110111100');
  const capM = [], capL = [];
  for (let v = 1; v <= 10; v++) { const cb = v <= 9 ? 8 : 16; capM.push(Math.floor((T.dataCodewords(v, 'M') * 8 - 4 - cb) / 8)); capL.push(Math.floor((T.dataCodewords(v, 'L') * 8 - 4 - cb) / 8)); }
  assert.deepEqual(capM, [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
  assert.deepEqual(capL, [17, 32, 53, 78, 106, 134, 154, 192, 230, 271]);
});

test('CRC-16/CCITT-FALSE và chuỗi VietQR', () => {
  assert.equal(crc16('123456789'), 0x29B1);
  const payload = buildVietQrPayload({ bin: '970446', accountNo: '5200000000825012', amount: 1446000, content: 'Trả lãi HDTD 455' });
  assert.match(payload, /^000201010212/);
  assert.ok(payload.includes('5303704') && payload.includes('540714460005802VN'));
  assert.ok(payload.includes('0816Tra lai HDTD 455'), 'nội dung bỏ dấu tiếng Việt');
  assert.equal(payload.slice(-4), crc16(payload.slice(0, -4)).toString(16).toUpperCase().padStart(4, '0'));
});

function decode(qr) {
  const { size, modules: m } = qr;
  const get = (x, y) => (m[y][x] ? 1 : 0);

  const coordsA = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
  let bitsA = 0; coordsA.forEach(([x, y], i) => { bitsA |= get(x, y) << i; });
  const coordsB = []; for (let i = 0; i < 8; i++) coordsB.push([size - 1 - i, 8]); for (let i = 8; i < 15; i++) coordsB.push([8, size - 15 + i]);
  let bitsB = 0; coordsB.forEach(([x, y], i) => { bitsB |= get(x, y) << i; });
  assert.equal(bitsA, bitsB, 'hai bản thông tin định dạng khớp nhau');
  const fmt = bitsA ^ 0x5412;
  const dataBits = fmt >>> 10; const eclBits = dataBits >>> 3; const mask = dataBits & 7;
  let rem = dataBits; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  assert.equal(((dataBits << 10) | rem) ^ 0x5412, bitsA, 'BCH hợp lệ');
  assert.equal(mask, qr.mask);
  assert.equal(eclBits, qr.ecl === 'M' ? 0 : 1);

  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < size && y < size) fn[y][x] = true; };
  mark(0, 0, 9, 9); mark(size - 8, 0, 8, 9); mark(0, size - 8, 9, 8);
  for (let i = 0; i < size; i++) { fn[6][i] = true; fn[i][6] = true; }
  const ap = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] }[qr.version];
  ap.forEach((cx, i) => ap.forEach((cy, j) => { if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) return; mark(cx - 2, cy - 2, 5, 5); }));
  if (qr.version >= 7) { mark(size - 11, 0, 3, 6); mark(0, size - 11, 6, 3); }

  const maskFn = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0, (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => (((x + y) % 2) + (x * y) % 3) % 2 === 0][mask];
  const bits = [];
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let n = 0; n < size; n++) {
      const y = upward ? size - 1 - n : n;
      for (const x of [col, col - 1]) { if (!fn[y][x]) bits.push(get(x, y) ^ (maskFn(x, y) ? 1 : 0)); }
    }
    upward = !upward;
  }
  const codewords = []; for (let i = 0; i + 8 <= bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  const E = { M: { per: [0,10,16,26,18,24,16,18,22,22,26], nb: [0,1,1,1,2,2,4,4,4,5,5] }, L: { per: [0,7,10,15,20,26,18,20,24,30,18], nb: [0,1,1,1,1,1,2,2,2,2,4] } }[qr.ecl];
  const per = E.per[qr.version], nb = E.nb[qr.version];
  const total = codewords.length; const shortBlocks = nb - (total % nb); const shortLen = Math.floor(total / nb);
  const blocks = Array.from({ length: nb }, () => []);
  let idx = 0;
  for (let i = 0; i <= shortLen; i++) for (let j = 0; j < nb; j++) { if (i === shortLen - per && j < shortBlocks) continue; blocks[j].push(codewords[idx++]); }
  assert.equal(idx, codewords.length);
  const out = [];
  blocks.forEach((blk) => {
    const dat = blk.slice(0, blk.length - per), e = blk.slice(blk.length - per);
    assert.deepEqual(T.rsRemainder(dat, T.rsDivisor(per)), e, 'mã sửa lỗi khớp');
    out.push(...dat);
  });

  const bs = out.flatMap((b) => [...b.toString(2).padStart(8, '0')].map(Number));
  let p = 0; const read = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | bs[p++]; return v; };
  assert.equal(read(4), 0b0100);
  const len = read(qr.version <= 9 ? 8 : 16);
  const bytes = []; for (let i = 0; i < len; i++) bytes.push(read(8));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

test('mã QR tạo ra đọc ngược đúng nội dung (mọi phiên bản 1-10, cả mức M và L)', () => {
  const samples = [
    'A', 'HELLO WORLD', 'https://example.com/' + 'x'.repeat(40),
    buildVietQrPayload({ bin: '970446', accountNo: '5200000000825012', amount: 1446000, content: 'TRA LAI HDTD 455 26 PHAM THI TAI' }),
    buildVietQrPayload({ bin: '970446', accountNo: '5200000000825012', amount: 0, content: '' }),
    buildVietQrPayload({ bin: '970446', accountNo: '5200000000825012', amount: 120000000, content: 'TAT TOAN HDTD HD20261001 NGUYEN THI HOA THON BINH NGUYEN' }),
    'ké'.repeat(30), 'z'.repeat(213), 'y'.repeat(260),
  ];
  for (const s of samples) assert.equal(decode(encodeQr(s)), s);
  for (let v = 1; v <= 10; v++) {
    for (const ecl of ['M', 'L']) {
      const cap = (T.dataCodewords(v, ecl) * 8 - 4 - (v <= 9 ? 8 : 16)) >> 3;
      const s = 'q'.repeat(cap);
      const qr = encodeQr(s, ecl);
      if (qr.version === v && qr.ecl === ecl) assert.equal(decode(qr), s);
    }
  }
  assert.throws(() => encodeQr('w'.repeat(300)));
});

function logoDamage(qr) {
  const { size, version: ver, ecl } = qr;
  const E = { M: { per: [0,10,16,26,18,24,16,18,22,22,26], nb: [0,1,1,1,2,2,4,4,4,5,5] }, L: { per: [0,7,10,15,20,26,18,20,24,30,18], nb: [0,1,1,1,1,1,2,2,2,2,4] } }[ecl];
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < size && y < size) fn[y][x] = true; };
  mark(0, 0, 9, 9); mark(size - 8, 0, 8, 9); mark(0, size - 8, 9, 8);
  for (let i = 0; i < size; i++) { fn[6][i] = true; fn[i][6] = true; }
  const ap = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] }[ver];
  ap.forEach((cx, i) => ap.forEach((cy, j) => { if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) return; mark(cx - 2, cy - 2, 5, 5); }));
  if (ver >= 7) { mark(size - 11, 0, 3, 6); mark(0, size - 11, 6, 3); }
  const box = logoBoxModules(size), lo = (size - box) / 2, hi = lo + box;
  const hit = new Set(); let bit = 0, upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let n = 0; n < size; n++) {
      const y = upward ? size - 1 - n : n;
      for (const x of [col, col - 1]) {
        if (fn[y][x]) continue;
        if (x >= lo && x < hi && y >= lo && y < hi) hit.add(bit >> 3);
        bit++;
      }
    }
    upward = !upward;
  }
  const total = bit >> 3, per = E.per[ver], nb = E.nb[ver];
  const shortBlocks = nb - (total % nb), shortLen = Math.floor(total / nb);
  const owner = [];
  for (let i = 0; i <= shortLen; i++) for (let j = 0; j < nb; j++) { if (i === shortLen - per && j < shortBlocks) continue; owner.push(j); }
  const perBlock = new Array(nb).fill(0);
  hit.forEach((k) => perBlock[owner[k]]++);
  return { worst: Math.max(...perBlock), allowed: Math.floor(per / 2) };
}

test('logo giữa mã QR chỉ che tối đa nửa sức bù của mã sửa lỗi ở mọi khối', () => {
  const contents = ['', 'A', 'TRA LAI HDTD 455', 'TRA LAI HDTD 455 26 PHAM THI TAI', 'TAT TOAN HDTD HD20261001 NGUYEN THI HOA THON BINH NGUYEN'];
  for (const content of contents) {
    for (const amount of [0, 5000, 1446000, 120000000]) {
      const qr = encodeQr(buildVietQrPayload({ bin: '970446', accountNo: '5200000000825012', amount, content }), 'M');
      const { worst, allowed } = logoDamage(qr);
      assert.ok(worst * 2 <= allowed, `v${qr.version}: che ${worst} mã/khối, sức bù ${allowed}`);
    }
  }
});
