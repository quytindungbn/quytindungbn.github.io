// Bộ đọc file .xlsx tối giản, thuần trình duyệt — không dùng thư viện ngoài
// (SheetJS...). Đọc ZIP bằng DecompressionStream('deflate-raw') có sẵn trong
// trình duyệt hiện đại + phân tích XML bằng DOMParser có sẵn.
// Chỉ hỗ trợ .xlsx (định dạng OOXML/zip). File .xls cũ (OLE nhị phân) KHÔNG
// đọc được bằng cách này — cần lưu lại dưới dạng .xlsx.

const EOCD_SIG = 0x06054b50;
const CDFH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

function findEOCD(view) {
  const maxBack = Math.min(view.byteLength, 65557); // 22 + tối đa 65535 byte comment
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

/** Đọc toàn bộ entry trong file .xlsx (zip) thành Map<tên file, Uint8Array>. */
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
      // Đọc local file header để biết chính xác vị trí dữ liệu (tên/extra có thể khác CD)
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

/** Chuyển tên cột kiểu "AB" -> chỉ số 0-based. */
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
  // Lấp các dòng trống bị bỏ qua trong XML, đảm bảo mảng liền mạch
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/**
 * Đọc file .xlsx (đối tượng File từ input) -> trả về mảng 2 chiều (rows x cols)
 * của sheet đầu tiên trong workbook.
 */
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

  let sheetPath = 'xl/worksheets/sheet1.xml'; // dự phòng nếu không đọc được rels
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

/** Chuyển mảng 2 chiều thành text dạng dán-từ-Excel (phân cách Tab/xuống dòng) để tái sử dụng bộ nhập liệu sẵn có. */
export function rowsToTsv(rows) {
  return rows
    .map((row) => row.map((cell) => (cell == null ? '' : String(cell))).join('\t'))
    .filter((line) => line.replace(/\t/g, '').trim() !== '')
    .join('\n');
}

// ------------------------------------------------------------
// "Mẫu báo cáo" — file sổ theo dõi vay xuất ra từ phần mềm nghiệp vụ (VD:
// "IN SAO KÊ HỢP ĐỒNG TÍN DỤNG THEO SẢN PHẨM"), khác hẳn mẫu Excel PHẲNG cũ
// (đúng 11 cột, dòng đầu là tiêu đề, hết) mà importFromPastedTable() trong
// js/state.js đang đọc theo THỨ TỰ CỐ ĐỊNH. Mẫu báo cáo này có:
// - Vài dòng tiêu đề/quốc hiệu ở TRÊN dòng tiêu đề cột thật (không phải
//   dòng đầu tiên mới là tiêu đề).
// - Nhiều cột hơn, KHÔNG cùng thứ tự app đang cần, kể cả thừa cột (Sổ thành
//   viên, Dự thu lũy kế, Phân kỳ theo từng năm...) không dùng tới.
// - XEN GIỮA các dòng khách hàng thật là các dòng "cộng dồn theo loại vay"
//   (VD: "Cho vay vốn trong nước ngắn hạn - ...") và dòng "Tổng cộng" +
//   khối chữ ký cuối file — đều KHÔNG PHẢI là 1 hợp đồng thật, phải loại bỏ,
//   nếu không sẽ bị hiểu nhầm thành hợp đồng có số tiền khổng lồ (cộng dồn
//   cả trăm khách) hoặc lỗi khi thiếu CCCD.
// ------------------------------------------------------------

/** Tên cột mẫu báo cáo (đã chuẩn hóa: cắt khoảng trắng + viết thường) ứng với từng trường app cần — CHỈ cần khớp ĐÚNG tên, không quan tâm thứ tự cột trong file. */
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
};
const REPORT_TEMPLATE_FIELD_ORDER = ['code', 'name', 'address', 'cccd', 'phone', 'disbursedDate', 'dueDate', 'interestPaidUntil', 'principal', 'balance', 'interestRate'];

function normalizeHeaderCell(v) {
  return String(v ?? '').trim().toLowerCase();
}

/**
 * Nếu `rows` (mảng 2 chiều thô đọc từ file) khớp đúng "mẫu báo cáo" (tìm
 * thấy 1 dòng có ô "STT" + đủ tên cột cần dùng ở REPORT_TEMPLATE_HEADER_MAP)
 * thì tự dò đúng cột theo TÊN (không theo vị trí — file đổi thứ tự cột vẫn
 * nhận đúng), lọc bỏ mọi dòng KHÔNG PHẢI hợp đồng thật (dòng tiêu đề/cộng
 * dồn/tổng cộng/chữ ký — nhận biết qua việc thiếu đúng 1 CCCD 9-12 số ở cột
 * "Số CMND"), rồi trả về mảng đã xếp lại ĐÚNG thứ tự 11 cột app cần (khớp
 * `importFromPastedTable()` trong js/state.js: code, name, address, cccd,
 * phone, disbursedDate, dueDate, interestPaidUntil, principal, balance,
 * interestRate) — không kèm dòng tiêu đề (importFromPastedTable không bắt
 * buộc phải có).
 *
 * KHÔNG khớp mẫu báo cáo (VD: đang là mẫu PHẲNG cũ, không có ô "STT" nào) —
 * trả về NGUYÊN VẸN `rows` như cũ, KHÔNG đổi gì — giữ đúng hành vi cũ cho
 * ai vẫn đang dùng mẫu cũ, không bắt buộc phải đổi ngay.
 */
export function remapReportTemplateRows(rows) {
  let headerRowIdx = -1;
  let colMap = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const normalized = row.map(normalizeHeaderCell);
    if (!normalized.includes('stt')) continue;
    const map = {};
    let foundAll = true;
    for (const field of REPORT_TEMPLATE_FIELD_ORDER) {
      const idx = normalized.indexOf(REPORT_TEMPLATE_HEADER_MAP[field]);
      if (idx === -1) { foundAll = false; break; }
      map[field] = idx;
    }
    if (foundAll) { headerRowIdx = i; colMap = map; break; }
  }
  if (headerRowIdx === -1) return rows; // không phải mẫu báo cáo — giữ nguyên, xử lý như mẫu cũ

  const out = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const cccd = String(row[colMap.cccd] ?? '').trim().replace(/\s/g, '');
    // Dòng "cộng dồn theo loại vay"/"Tổng cộng"/chữ ký cuối file đều KHÔNG có
    // CCCD hợp lệ ở đúng cột này — loại thẳng, không phải hợp đồng thật.
    if (!/^\d{9,12}$/.test(cccd)) continue;
    out.push(REPORT_TEMPLATE_FIELD_ORDER.map((field) => {
      const v = row[colMap[field]];
      return v == null ? '' : String(v).trim();
    }));
  }
  return out;
}
