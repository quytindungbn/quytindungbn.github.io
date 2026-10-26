const ECC = {
  L: { bits: 1, perBlock: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18], blocks: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4] },
  M: { bits: 0, perBlock: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], blocks: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5] },
};
const MAX_VERSION = 10;
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const bit = (x, i) => ((x >>> i) & 1) !== 0;

function rawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
function dataCodewords(ver, ecl) {
  return Math.floor(rawDataModules(ver) / 8) - ECC[ecl].perBlock[ver] * ECC[ecl].blocks[ver];
}

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 2);
  }
  return result;
}
function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

function utf8Bytes(text) { return Array.from(new TextEncoder().encode(text)); }

function buildCodewords(bytes, ver, ecl) {
  const capacityBits = dataCodewords(ver, ecl) * 8;
  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));
  push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xEC; data.length < capacityBits / 8; pad ^= 0xEC ^ 0x11) data.push(pad);

  const { perBlock, blocks: nb } = { perBlock: ECC[ecl].perBlock[ver], blocks: ECC[ecl].blocks[ver] };
  const raw = Math.floor(rawDataModules(ver) / 8);
  const shortBlocks = nb - (raw % nb);
  const shortLen = Math.floor(raw / nb);
  const divisor = rsDivisor(perBlock);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - perBlock + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < shortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((blk, j) => { if (i !== shortLen - perBlock || j >= shortBlocks) out.push(blk[i]); });
  }
  return out;
}

function formatBits(ecl, mask) {
  const data = (ECC[ecl].bits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
function versionBits(ver) {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
  return (ver << 12) | rem;
}

function penalty(m, size) {
  let score = 0;
  const line = (get) => {
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (get(i) === get(i - 1)) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else run = 1;
    }
  };
  const finderLike = (get) => {
    const pat = [1, 0, 1, 1, 1, 0, 1];
    for (let i = 0; i + 7 <= size; i++) {
      if (!pat.every((v, k) => (get(i + k) ? 1 : 0) === v)) continue;
      const white = (a, b) => { for (let t = a; t < b; t++) if (t >= 0 && t < size && get(t)) return false; return true; };
      if (white(i - 4, i) || white(i + 7, i + 11)) score += 40;
    }
  };
  for (let y = 0; y < size; y++) { line((i) => m[y][i]); finderLike((i) => m[y][i]); }
  for (let x = 0; x < size; x++) { line((i) => m[i][x]); finderLike((i) => m[i][x]); }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
  }
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

export function encodeQr(text, ecl = 'M') {
  const bytes = utf8Bytes(text);
  let ver = 1;
  const countBits = (v) => (v <= 9 ? 8 : 16);
  while (ver <= MAX_VERSION && 4 + countBits(ver) + bytes.length * 8 > dataCodewords(ver, ecl) * 8) ver++;
  if (ver > MAX_VERSION) {
    if (ecl === 'M') return encodeQr(text, 'L');
    throw new Error('Nội dung quá dài để tạo mã QR.');
  }
  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, dark) => { modules[y][x] = dark; isFn[y][x] = true; };

  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const pos = ALIGN[ver];
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  const drawFormat = (mask) => {
    const bits = formatBits(ecl, mask);
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(bits, i));
    setFn(8, 7, bit(bits, 6)); setFn(8, 8, bit(bits, 7)); setFn(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(bits, i));
    setFn(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    const bits = versionBits(ver);
    for (let i = 0; i < 18; i++) {
      const dark = bit(bits, i);
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      setFn(a, b, dark); setFn(b, a, dark);
    }
  }

  const codewords = buildCodewords(bytes, ver, ecl);
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y][x] && k < codewords.length * 8) { modules[y][x] = bit(codewords[k >>> 3], 7 - (k & 7)); k++; }
      }
    }
  }

  const maskFn = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0, (x, y) => ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0,
  ];
  const applyMask = (mask) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFn[y][x] && maskFn[mask](x, y)) modules[y][x] = !modules[y][x];
  };
  let best = 0, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask); drawFormat(mask);
    const score = penalty(modules, size);
    if (score < bestScore) { best = mask; bestScore = score; }
    applyMask(mask);
  }
  applyMask(best); drawFormat(best);
  return { size, modules, version: ver, mask: best, ecl };
}

export const __test = { rsDivisor, rsRemainder, formatBits, versionBits, dataCodewords, rawDataModules, buildCodewords, utf8Bytes };
