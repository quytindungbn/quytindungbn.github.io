const EOCD_SIG = 0x06054b50;
const CDFH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

function findEOCD(view) {
  const maxBack = Math.min(view.byteLength, 65557);
  for (let i = view.byteLength - 22; i >= view.byteLength - maxBack && i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  throw new Error('Không tìm thấy cấu trúc ZIP hợp lệ (End Of Central Directory).');
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function readZipEntries(arrayBuffer, wantedNames) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const eocdOffset = findEOCD(view);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);

  const wanted = new Set(wantedNames);
  const entries = {};
  let ptr = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(ptr, true) !== CDFH_SIG) break;
    const compMethod = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    if (wanted.has(name)) {

      const lfhNameLen = view.getUint16(localOffset + 26, true);
      const lfhExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lfhNameLen + lfhExtraLen;
      const raw = bytes.subarray(dataStart, dataStart + compSize);
      entries[name] = compMethod === 0 ? raw : await inflateRaw(raw);
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function parseXml(bytes) {
  const text = new TextDecoder('utf-8').decode(bytes);
  return new DOMParser().parseFromString(text, 'application/xml');
}

function colLetterToIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

function parseSharedStrings(xmlDoc) {
  if (!xmlDoc) return [];
  const items = Array.from(xmlDoc.getElementsByTagName('si'));
  return items.map((si) => {
    const tNodes = si.getElementsByTagName('t');
    return Array.from(tNodes).map((t) => t.textContent).join('');
  });
}

function parseSheetToRows(xmlDoc, sharedStrings) {
  const rowEls = Array.from(xmlDoc.getElementsByTagName('row'));
  const rows = [];
  rowEls.forEach((rowEl) => {
    const rowIdx = (parseInt(rowEl.getAttribute('r'), 10) || rows.length + 1) - 1;
    const row = rows[rowIdx] || (rows[rowIdx] = []);
    Array.from(rowEl.children).forEach((cellEl) => {
      const ref = cellEl.getAttribute('r') || '';
      const m = ref.match(/^([A-Z]+)/);
      const colIdx = m ? colLetterToIndex(m[1]) : row.length;
      const type = cellEl.getAttribute('t');
      let value = '';
      if (type === 'inlineStr') {
        const isEl = cellEl.getElementsByTagName('is')[0];
        value = isEl ? Array.from(isEl.getElementsByTagName('t')).map((t) => t.textContent).join('') : '';
      } else {
        const vEl = cellEl.getElementsByTagName('v')[0];
        const raw = vEl ? vEl.textContent : '';
        value = type === 's' ? (sharedStrings[Number(raw)] ?? '') : raw;
      }
      row[colIdx] = value;
    });
  });

  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

export async function readXlsxFirstSheet(file) {
  const buf = await file.arrayBuffer();

  const rootEntries = await readZipEntries(buf, ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels']);
  if (!rootEntries['xl/workbook.xml']) {
    throw new Error('File không đúng định dạng .xlsx (thiếu xl/workbook.xml).');
  }
  const workbookXml = parseXml(rootEntries['xl/workbook.xml']);
  const firstSheetEl = workbookXml.getElementsByTagName('sheet')[0];
  if (!firstSheetEl) throw new Error('Không tìm thấy sheet nào trong file.');
  const rid = firstSheetEl.getAttribute('r:id') || firstSheetEl.getAttribute('id');

  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (rootEntries['xl/_rels/workbook.xml.rels']) {
    const relsXml = parseXml(rootEntries['xl/_rels/workbook.xml.rels']);
    const relEl = Array.from(relsXml.getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid);
    if (relEl) {
      let target = relEl.getAttribute('Target');
      if (target.startsWith('/')) target = target.slice(1);
      sheetPath = target.startsWith('xl/') ? target : `xl/${target}`;
    }
  }

  const dataEntries = await readZipEntries(buf, ['xl/sharedStrings.xml', sheetPath]);
  if (!dataEntries[sheetPath]) throw new Error(`Không đọc được sheet (${sheetPath}).`);

  const sharedStrings = dataEntries['xl/sharedStrings.xml'] ? parseSharedStrings(parseXml(dataEntries['xl/sharedStrings.xml'])) : [];
  const sheetXml = parseXml(dataEntries[sheetPath]);
  return parseSheetToRows(sheetXml, sharedStrings);
}

export function rowsToTsv(rows) {
  return rows
    .map((row) => row.map((cell) => (cell == null ? '' : String(cell))).join('\t'))
    .filter((line) => line.replace(/\t/g, '').trim() !== '')
    .join('\n');
}

const REPORT_TEMPLATE_HEADER_MAP = {
  code: 'số hđ',
  name: 'tên khách hàng',
  address: 'địa chỉ',
  cccd: 'số cmnd',
  phone: 'điện thoại',
  disbursedDate: 'ngày vay',
  dueDate: 'ngày đáo hạn',
  interestPaidUntil: 'thu lãi đến ngày',
  principal: 'số tiền vay',
  balance: 'số dư',
  interestRate: 'lãi suất',
  agreementCode: 'mã khế ước',
};

const REPORT_TEMPLATE_FIELD_ORDER = ['code', 'name', 'address', 'cccd', 'phone', 'disbursedDate', 'dueDate', 'interestPaidUntil', 'principal', 'balance', 'interestRate', 'agreementCode'];
const REPORT_TEMPLATE_REQUIRED_FIELDS = REPORT_TEMPLATE_FIELD_ORDER.filter((field) => field !== 'agreementCode');

const INSTALLMENT_COLUMN_RE = /^phân kỳ năm (\d{4})$/;

function normalizeHeaderCell(v) {
  return String(v ?? '').trim().toLowerCase();
}

const PRIMARY_REPORT_FIELDS = {
  code: 'số hđtd', name: 'người nhận nợ', address: 'địa chỉ',
  cccd: 'số cmnd/cccd', phone: 'số di động',
  disbursedDate: 'ngày nhận nợ', dueDate: 'ngày đáo hạn',
  interestPaidUntil: 'thu lãi đến ngày', principal: 'số tiền giải ngân',
  balance: ['sô dư', 'số dư'], interestRate: 'lãi suất',
};

function remapPrimaryLoanRows(rows) {
  const headerIdx = rows.findIndex((row) => {
    const h = (row || []).map(normalizeHeaderCell);
    return h.includes('số hđtd') && h.includes('số cmnd/cccd') && h.includes('người nhận nợ');
  });
  if (headerIdx < 0) return null;
  const header = rows[headerIdx].map(normalizeHeaderCell);
  const colMap = {};
  for (const [field, label] of Object.entries(PRIMARY_REPORT_FIELDS)) {
    const labels = Array.isArray(label) ? label : [label];
    const idx = header.findIndex((cell) => labels.includes(cell));
    if (idx < 0) throw new Error(`File số 1 thiếu cột "${labels[0]}".`);
    colMap[field] = idx;
  }

  if (!['giá trị tsđb', 'giá trị tsbđ'].includes(header[19]) || header[22] !== 'w' || header[26] !== 'aa' || header[27] !== 'ab') {
    throw new Error('File số 1 đã thay đổi vị trí cột T/W/AA/AB; hãy kiểm tra đúng mẫu trước khi tải lên.');
  }
  const out = [];
  for (let rowIdx = headerIdx + 1; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx] || [];
    const code = String(row?.[colMap.code] ?? '').trim();
    const cccd = String(row?.[colMap.cccd] ?? '').trim().replace(/\s/g, '');
    if (!code && !cccd) continue;
    if (!code || !/^\d{9,12}$/.test(cccd)) {
      throw new Error(`File số 1 có dòng thiếu Số HĐTD hoặc CCCD hợp lệ (hàng ${rowIdx + 1}). Không thể đồng bộ toàn bộ.`);
    }
    const line = REPORT_TEMPLATE_REQUIRED_FIELDS.map((field) => String(row[colMap[field]] ?? '').trim());
    line.push('', '');
    line.push(String(row[19] ?? '').trim(), String(row[27] ?? '').trim(),
      String(row[22] ?? '').trim(), String(row[26] ?? '').trim());
    { const heir = String(row[3] ?? '').trim(); line.push(/\p{L}/u.test(heir) ? heir : ''); }
    out.push(line);
  }
  if (!out.length) throw new Error('File số 1 không có hợp đồng hợp lệ.');
  return out;
}

function supplementHeaderIndex(rows) {
  return rows.findIndex((row) => {
    const h = (row || []).map(normalizeHeaderCell);
    return h[7] === 'số hđ' && h[8] === 'mã khế ước' && h.some((cell) => INSTALLMENT_COLUMN_RE.test(cell));
  });
}

export function isSupplementReportRows(rows) {
  return supplementHeaderIndex(rows) >= 0;
}

export function parseSupplementReportRows(rows) {
  const headerIdx = supplementHeaderIndex(rows);
  if (headerIdx < 0) throw new Error('File số 2 thiếu hàng tiêu đề Số HĐ, Mã khế ước hoặc Phân kỳ năm.');
  const header = rows[headerIdx].map(normalizeHeaderCell);
  const installmentCols = [];
  for (let idx = 0; idx < header.length; idx++) {
    const match = header[idx].match(INSTALLMENT_COLUMN_RE);
    if (match) installmentCols.push([match[1], idx]);
  }
  const out = [];
  const seenCodes = new Set();
  for (const row of rows.slice(headerIdx + 1)) {
    const code = String(row?.[7] ?? '').trim();
    if (!code) continue;

    const cccd = String(row?.[4] ?? '').trim().replace(/\s/g, '');
    if (!/^\d{9,12}$/.test(cccd)) continue;
    if (seenCodes.has(code)) throw new Error(`File số 2 có Số HĐ ${code} bị trùng.`);
    seenCodes.add(code);
    const schedule = {};
    for (const [year, idx] of installmentCols) {
      const value = String(row[idx] ?? '').trim();
      if (value) schedule[year] = value;
    }
    out.push({ code, agreementCode: String(row[8] ?? '').trim(), installmentSchedule: schedule });
  }
  if (!out.length) throw new Error('File số 2 không có hợp đồng hợp lệ.');
  return out;
}

export function remapReportTemplateRows(rows) {
  const primary = remapPrimaryLoanRows(rows);
  if (primary) return primary;
  let headerRowIdx = -1;
  let colMap = null;
  let installmentCols = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const normalized = row.map(normalizeHeaderCell);
    if (!normalized.includes('stt')) continue;
    const map = {};
    let foundAll = true;
    for (const field of REPORT_TEMPLATE_REQUIRED_FIELDS) {
      const idx = normalized.indexOf(REPORT_TEMPLATE_HEADER_MAP[field]);
      if (idx === -1) { foundAll = false; break; }
      map[field] = idx;
    }
    if (!foundAll) continue;
    map.agreementCode = normalized.indexOf(REPORT_TEMPLATE_HEADER_MAP.agreementCode);
    headerRowIdx = i;
    colMap = map;
    const ik = {};
    normalized.forEach((cell, idx) => {
      const m = cell.match(INSTALLMENT_COLUMN_RE);
      if (m) ik[m[1]] = idx;
    });
    if (Object.keys(ik).length) installmentCols = ik;
    break;
  }
  if (headerRowIdx === -1) return rows;

  const out = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const cccd = String(row[colMap.cccd] ?? '').trim().replace(/\s/g, '');

    if (!/^\d{9,12}$/.test(cccd)) continue;
    const line = REPORT_TEMPLATE_FIELD_ORDER.map((field) => {
      const v = colMap[field] >= 0 ? row[colMap[field]] : '';
      return v == null ? '' : String(v).trim();
    });
    if (installmentCols) {
      const schedule = {};
      for (const [year, idx] of Object.entries(installmentCols)) {
        const v = row[idx];
        if (v != null && String(v).trim() !== '') schedule[year] = String(v).trim();
      }
      line.push(JSON.stringify(schedule));
    }
    out.push(line);
  }
  return out;
}
