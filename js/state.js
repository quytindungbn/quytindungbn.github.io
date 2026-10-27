import { genId, mulberry32, randInt, addDays, daysBetween, detectDeviceKind } from './utils.js';
import { describeOrgPatch } from './lib/activityLabels.js';
import { heirNamesOf, heirOfContract, samePerson, normPersonName, coPhoneOf, contractOa, customerOaSummary, hasOaPhone, phoneHolders } from './lib/coBorrower.js';
import { interestDaysBetween } from './lib/interestDays.js';
import { validateDraft, planChanged, firstRemindOn, nextAfterDone, addDaysIso, todayIso, isDue } from './lib/customerNotes.js';
import { restoreLeadingInstallment } from './lib/installmentPlan.js';
import { clearDeviceCaches } from './lib/kvCache.js';
import { getSupabaseClient, callLoginFunction, callCreateAccountFunction, callImportDataFunction, callForgotPasswordFunction } from './lib/supabaseClient.js';
import { specificProvisionForLoan, SPECIFIC_PROVISION_RATE, GENERAL_PROVISION_RATE, inheritCurrentCollateral } from './lib/collateral.js';
export { GENERAL_PROVISION_RATE, provisionFromSnapshot } from './lib/collateral.js';

export const STORAGE_KEY = 'qtd_demo_v3';

export const REQUEST_TYPE = [
  { id: 'vay_moi', label: 'Yêu cầu mở khoản vay mới' },
  { id: 'tu_van', label: 'Yêu cầu tư vấn khác' },
  { id: 'quen_mat_khau', label: 'Yêu cầu cấp lại mật khẩu' },
];
export const REQUEST_STATUS = [
  { id: 'moi', label: 'Mới', badge: 'badge-blue' },
  { id: 'dang_xu_ly', label: 'Đang xử lý', badge: 'badge-yellow' },
  { id: 'da_lien_he', label: 'Đã liên hệ', badge: 'badge-green' },
];
export const REQUEST_STATUS_MAP = Object.fromEntries(REQUEST_STATUS.map((s) => [s.id, s]));

export const CONTRACT_STATUS = [
  { id: 'dang_vay', label: 'Trong hạn', badge: 'badge-blue' },
  { id: 'qua_han', label: 'Quá hạn', badge: 'badge-red' },
  { id: 'da_tat_toan', label: 'Đã tất toán', badge: 'badge-green' },
];
export const CONTRACT_STATUS_MAP = Object.fromEntries(CONTRACT_STATUS.map((s) => [s.id, s]));

const LOCK_AFTER_FAILS = 5;
const LOCK_MINUTES = 15;
export const NEAR_DUE_DAYS = 15;

export const BANK_INFO = Object.freeze({
  bankName: 'Ngân hàng Hợp tác xã Việt Nam (Co-op Bank)',
  bankBin: '970446',
  bankAccountNo: '5200000000825012',
  bankAccountName: 'QUY TIN DUNG NHAN DAN BINH NGUYEN',

  bankAccountDisplayName: 'QUỸ TÍN DỤNG NHÂN DÂN BÌNH NGUYÊN',
});

let state = null;
const listeners = new Set();
function notify() { persist(); listeners.forEach((fn) => fn()); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getState() { return state; }

let persistTimer = null;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(flushPersist, 400);
}
function flushPersist() {
  clearTimeout(persistTimer); persistTimer = null;
  if (!state) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.error('Không lưu được dữ liệu', e); }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPersist);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPersist(); });
}

function migrateState() {
  if (!state) return;
  (state.admins || []).forEach((a) => {
    if (!Array.isArray(a.allowedThon)) a.allowedThon = [];
    if (!Array.isArray(a.allowedXom)) a.allowedXom = [];
  });
  if (!Array.isArray(state.pushSubscribedCustomerIds)) state.pushSubscribedCustomerIds = [];
  if (!Array.isArray(state.zaloCustomers)) state.zaloCustomers = [];
  if (!Array.isArray(state.zaloAutoSendList)) state.zaloAutoSendList = [];
  if (!Array.isArray(state.zaloAutoOverview)) state.zaloAutoOverview = [];
  if (!Array.isArray(state.zaloSendLog)) state.zaloSendLog = [];
  if (!Array.isArray(state.customerNotes)) state.customerNotes = [];
  if (!Array.isArray(state.customerNoteLog)) state.customerNoteLog = [];
  if (typeof state.chatUnreadCount !== 'number') state.chatUnreadCount = 0;
  if (!Array.isArray(state.monthlySnapshots)) state.monthlySnapshots = [];
}

export async function init() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { state = JSON.parse(raw); migrateState(); }
    catch (e) { console.warn('Dữ liệu lỗi, tạo lại dữ liệu mẫu.', e); await seedDemoData(); }
  } else {
    await seedDemoData();
  }

  persist();
}

export async function refreshOrgPublic() {
  await loadOrgPublic();
  notify();
}

async function loadOrgPublic() {
  try {
    const sb = getSupabaseClient();
    const { data } = await sb.from('orgs').select('*').limit(1).maybeSingle();
    if (data) state.org = mapOrgRow(data);
  } catch (e) {
    console.warn('Không tải được thông tin quỹ tín dụng từ Supabase, tạm dùng dữ liệu demo.', e);
  }
}
function mapOrgRow(row) {
  return {
    id: row.id, name: row.name, shortName: row.short_name, hotline: row.hotline, address: row.address,
    bannerEnabled: !!row.banner_enabled, bannerTitle: row.banner_title || '', bannerText: row.banner_text || '',

    ...BANK_INFO,

    zaloTemplateDueId: row.zalo_template_due_id || '',

    zaloTemplateInterestId: row.zalo_template_interest_id || '',

    zaloNearDueDays: row.zalo_near_due_days || 15,

    pushTemplates: row.push_templates || null,
  };
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function genTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const arr = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(arr).map((b) => chars[b % chars.length]).join('');
}
async function makeCredential(plainPassword) {
  const salt = randomHex(8);
  const hash = await sha256Hex(salt + ':' + plainPassword);
  return { salt, hash };
}
async function verifyCredential(plainPassword, salt, hash) {
  return (await sha256Hex(salt + ':' + plainPassword)) === hash;
}

export const DEFAULT_PUSH_TEMPLATES = {
  title: '<Ten_quy> thông báo:',
  interest: 'Số tiền lãi hợp đồng <Ma_HD> của quý khách đến hôm nay là: <So_tien_lai>. Quý khách vui lòng thanh toán đúng hạn.',
  nearDue: 'Hợp đồng <Ma_HD> của quý khách đã GẦN ĐẾN HẠN. Số tiền gốc là <So_tien_goc> và lãi đến nay là: <So_tien_lai>. Quý khách vui lòng thanh toán trước ngày <Ngay_dao_han>.',
  overdue: 'Hợp đồng <Ma_HD> ĐÃ TRỄ HẠN. Số tiền gốc là <So_tien_goc>, lãi đến nay là: <So_tien_lai>. Yêu cầu quý khách thanh toán và thực hiện đúng như cam kết.',
};

export const PUSH_TEMPLATE_TOKENS = [
  { token: '<Ten_KH>', desc: 'Tên khách hàng' },
  { token: '<Ma_HD>', desc: 'Mã hợp đồng' },
  { token: '<So_tien_goc>', desc: 'Số tiền gốc phải trả (đúng theo kỳ đang cần chú ý nếu hợp đồng có phân kỳ trả nợ, không thì là dư nợ hiện tại)' },
  { token: '<So_tien_lai>', desc: 'Tiền lãi tính đến hôm nay' },
  { token: '<So_du>', desc: 'Dư nợ hiện tại (không đổi theo kỳ)' },
  { token: '<Ngay_dao_han>', desc: 'Ngày đến hạn (đúng theo kỳ đang cần chú ý nếu có, không thì là ngày đáo hạn hợp đồng)' },
  { token: '<Ten_quy>', desc: 'Tên viết tắt quỹ tín dụng' },
];

export function renderNotificationTemplate(str, tokens) {
  return String(str || '').replace(/<([A-Za-z0-9_]+)>/g, (m, key) => (key in tokens ? String(tokens[key]) : m));
}

export function getOrg() { return state.org; }

export async function updateOrg(patch) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const dbPatch = {};
  const map = {
    name: 'name', shortName: 'short_name', hotline: 'hotline', address: 'address',
    bannerEnabled: 'banner_enabled', bannerTitle: 'banner_title', bannerText: 'banner_text',
    zaloTemplateDueId: 'zalo_template_due_id', zaloTemplateInterestId: 'zalo_template_interest_id',
    zaloNearDueDays: 'zalo_near_due_days', pushTemplates: 'push_templates',
  };
  for (const [k, col] of Object.entries(map)) if (patch[k] !== undefined) dbPatch[col] = patch[k];
  const { error } = await sb.from('orgs').update(dbPatch).eq('id', state.org.id);
  if (error) throw new Error('Không lưu được cài đặt, thử lại sau.');
  Object.assign(state.org, patch);
  logUiAction('settings', `Sửa cài đặt: **${describeOrgPatch(patch)}**`);
  notify();
}

export function parseAddress(raw) {
  const text = String(raw || '').trim();
  const withoutNote = text.replace(/\([^)]*\)/g, '');
  const parts = withoutNote.split(',').map((s) => s.trim()).filter(Boolean);
  const result = { xom: '', thon: '', xa: '', tinh: '' };
  const rest = [];

  let currentField = null;
  for (const p of parts) {
    const low = p.toLowerCase();
    let field = null;
    if (low.startsWith('xóm') || low.startsWith('xom')) field = 'xom';
    else if (low.startsWith('thôn') || low.startsWith('thon')) field = 'thon';
    else if (low.startsWith('xã') || low.startsWith('xa ') || low.startsWith('phường') || low.startsWith('thị trấn') || low.startsWith('huyện')) field = 'xa';
    else if (low.startsWith('tỉnh') || low.startsWith('tp') || low.startsWith('thành phố')) field = 'tinh';

    if (field) { result[field] = p; currentField = field; }
    else if (currentField) result[currentField] += ', ' + p;
    else rest.push(p);
  }

  if (!result.tinh && parts.length) result.tinh = parts[parts.length - 1];
  if (!result.xa && rest.length) result.xa = rest.shift();
  if (!result.thon && parts.length >= 2) result.thon = parts[1];
  if (!result.xom && parts.length >= 1) result.xom = parts[0];
  return result;
}

export function listCustomers(filters = {}) {
  let list = state.customers;
  const thonList = [].concat(filters.thon || []).filter(Boolean);
  const xomList = [].concat(filters.xom || []).filter(Boolean);
  if (thonList.length) list = list.filter((c) => thonList.includes(c.thon));
  if (xomList.length) list = list.filter((c) => xomList.includes(c.xom));
  if (filters.adminId) {
    const admin = getAdmin(filters.adminId);
    if (admin && admin.role === 'staff') {
      const allowedThon = new Set(admin.allowedThon || []);
      const allowedXomKeys = new Set(admin.allowedXom || []);

      list = list.filter((c) => allowedThon.has(c.thon) || allowedXomKeys.has(xomKey(c.thon, c.xom)));
    }
  }
  return list;
}
export function getCustomer(id) { return state.customers.find((c) => c.id === id); }
export function findCustomerByCccd(cccd) { return state.customers.find((c) => c.cccd === String(cccd).trim()); }

export function findCustomerByIdentifier(value) {
  const v = String(value || '').trim();
  const vNoSpace = v.replace(/\s/g, '');
  return state.customers.find((c) => c.cccd === v || (c.phone && c.phone.replace(/\s/g, '') === vNoSpace));
}

export function listContractsByCustomer(customerId) {
  return state.contracts.filter((c) => c.customerId === customerId).sort((a, b) => new Date(b.disbursedDate) - new Date(a.disbursedDate));
}
export function getContract(id) { return state.contracts.find((c) => c.id === id); }

export function customerOutstandingTotal(customerId) {
  return listContractsByCustomer(customerId)
    .filter((c) => effectiveContractStatus(c) !== 'da_tat_toan')
    .reduce((s, c) => s + c.balance, 0);
}

export function effectiveContractStatus(contract, asOf = new Date()) {
  if ((contract.balance || 0) <= 0) return 'da_tat_toan';
  if (daysBetween(new Date(contract.dueDate), asOf) > 0) return 'qua_han';
  return 'dang_vay';
}

export function contractUrgency(contract, asOf = new Date()) {
  const status = effectiveContractStatus(contract, asOf);
  if (status === 'qua_han') return 'qua_han';
  if (status === 'dang_vay') {
    const d = daysBetween(asOf, new Date(contract.dueDate));
    if (d >= 0 && d <= NEAR_DUE_DAYS) return 'gan_den_han';
  }
  return null;
}

export function interestDaysAccrued(contract, asOf = new Date()) {
  return interestDaysBetween(contract, asOf);
}

function interestRoundedToThousand(balance, days, annualRate) {
  if (![balance, days, annualRate].every(v => Number.isFinite(Number(v)))) {
    throw new Error('Du lieu tinh lai khong hop le');
  }
  if (!Number.isSafeInteger(Number(days)) || Number(days) < 0) {
    throw new Error('So ngay tinh lai khong hop le');
  }
  if (Number(balance) <= 0 || Number(annualRate) <= 0 || Number(days) === 0) return 0;
  function fraction(value) {
    const [mantissa, exponent = '0'] = String(value).trim().toLowerCase().split('e');
    const [whole, decimal = ''] = mantissa.split('.');
    const digits = BigInt(whole + decimal);
    const scale = decimal.length - Number(exponent);
    return scale >= 0
      ? [digits, 10n ** BigInt(scale)]
      : [digits * 10n ** BigInt(-scale), 1n];
  }
  const [balanceNum, balanceDen] = fraction(balance);
  const [rateNum, rateDen] = fraction(annualRate);
  const numerator = balanceNum * BigInt(days) * rateNum;
  const denominator = balanceDen * rateDen * 100n * 365n * 1000n;
  const thousands = numerator / denominator;
  const remainder = numerator % denominator;
  const result = Number((thousands + (remainder * 2n >= denominator ? 1n : 0n)) * 1000n);
  if (!Number.isSafeInteger(result)) throw new Error('So tien vuot gioi han an toan');
  return result;
}

export function accruedInterest(contract, asOf = new Date()) {
  if (effectiveContractStatus(contract, asOf) === 'da_tat_toan') return 0;
  const days = interestDaysAccrued(contract, asOf);
  return interestRoundedToThousand(contract.balance, days, contract.interestRate);
}

function withYear(date, year) {
  const month = date.getMonth();
  const day = date.getDate();
  const d = new Date(year, month, day);
  if (d.getMonth() !== month) d.setDate(0);
  return d;
}

function toLocalISODate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function computeInstallmentPlan(contract, asOf = new Date()) {
  const schedule = contract.installmentSchedule;
  if (!schedule) return null;
  const stored = Object.entries(schedule)
    .map(([year, amount]) => ({ year: Number(year), amount: Number(amount) }))
    .filter((e) => Number.isFinite(e.year) && e.amount > 0)
    .sort((a, b) => a.year - b.year);
  if (stored.length < 2) return null;

  const disbursed = new Date(contract.disbursedDate);
  const balance = Number(contract.balance) || 0;
  const amountPaid = (Number(contract.principal) || 0) - balance;

  const entries = restoreLeadingInstallment(stored, { principal: contract.principal, balance, disbursedYear: Number(String(contract.disbursedDate || '').slice(0, 4)) });
  const sumBeforeLast = entries.slice(0, -1).reduce((s, e) => s + e.amount, 0);
  let cumulativeRequired = 0;
  return entries.map((e, idx) => {
    cumulativeRequired += e.amount;
    const isLast = idx === entries.length - 1;
    const dueDate = withYear(disbursed, e.year);
    const daysLeft = daysBetween(asOf, dueDate);
    const isPastOrToday = daysLeft <= 0;

    let dueAmount;
    if (isLast) {

      dueAmount = amountPaid > sumBeforeLast ? balance : e.amount;
    } else {

      const requiredBeforeThis = cumulativeRequired - e.amount;
      const coveredForThis = Math.max(0, amountPaid - requiredBeforeThis);
      dueAmount = Math.max(0, e.amount - coveredForThis);
    }

    return {
      year: e.year,
      dueDate: toLocalISODate(dueDate),
      amount: e.amount,
      dueAmount,
      paid: dueAmount <= 0,
      restored: !!e.restored,
      daysLeft,
      shouldWarn: isPastOrToday && dueAmount > 0,
    };
  });
}

export function nextInstallmentInfo(contract, asOf = new Date()) {
  const plan = computeInstallmentPlan(contract, asOf);
  if (!plan) return null;
  const idx = plan.findIndex((p) => p.dueAmount > 0);
  if (idx < 0) return null;
  const next = plan[idx];
  const urgency = next.daysLeft < 0 ? 'qua_han' : next.daysLeft <= NEAR_DUE_DAYS ? 'gan_den_han' : null;
  return { plan, idx, next, urgency };
}

export function daysOverdue(contract, asOf = new Date()) {
  if ((Number(contract.balance) || 0) <= 0) return null;
  const mainOverdue = daysBetween(new Date(contract.dueDate), asOf);
  const inst = nextInstallmentInfo(contract, asOf);
  const instOverdue = inst ? -inst.next.daysLeft : -Infinity;
  return Math.max(0, mainOverdue, instOverdue);
}

export function debtGroup(contract, asOf = new Date()) {
  const d = daysOverdue(contract, asOf);
  if (d === null) return null;
  if (d < 10) return 1;
  if (d <= 90) return 2;
  if (d <= 180) return 3;
  if (d <= 360) return 4;
  return 5;
}

export function debtGroupSummary(contracts, asOf = new Date()) {
  const groupBalances = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let totalBalance = 0;
  let interestReceivable = 0;
  for (const ct of contracts) {
    const g = debtGroup(ct, asOf);
    if (g === null) continue;
    const balance = Number(ct.balance) || 0;
    groupBalances[g] += balance;
    totalBalance += balance;
    if (g === 1) interestReceivable += accruedInterest(ct, asOf);
  }
  const badDebtBalance = groupBalances[3] + groupBalances[4] + groupBalances[5];
  const badDebtRatio = totalBalance > 0 ? (badDebtBalance / totalBalance) * 100 : 0;
  return { groupBalances, totalBalance, interestReceivable, badDebtBalance, badDebtRatio };
}

export function provisionSummary(contracts, asOf = new Date()) {
  let generalBase = 0;
  let specificProvision = 0;
  for (const ct of contracts) {
    const g = debtGroup(ct, asOf);
    if (g === null) continue;
    const balance = Number(ct.balance) || 0;
    if (g <= 4) generalBase += balance;
    const rate = SPECIFIC_PROVISION_RATE[g];
    if (!rate) continue;
    specificProvision += specificProvisionForLoan(ct, rate);
  }
  return { generalProvision: generalBase * GENERAL_PROVISION_RATE, specificProvision };
}

export function contractStatusInfo(contract, asOf = new Date()) {
  if ((contract.balance || 0) <= 0) {
    return { status: 'da_tat_toan', badge: 'badge-green', label: 'Đã tất toán', days: 0, dueAmount: 0, source: null };
  }
  const mainDays = daysBetween(asOf, new Date(contract.dueDate));
  const mainLevel = mainDays < 0 ? 'qua_han' : mainDays <= NEAR_DUE_DAYS ? 'gan_den_han' : null;
  const inst = nextInstallmentInfo(contract, asOf);
  const instLevel = inst ? inst.urgency : null;

  const overdue = [];
  if (mainLevel === 'qua_han') overdue.push({ days: Math.abs(mainDays), source: 'contract', amount: contract.balance });
  if (instLevel === 'qua_han') overdue.push({ days: Math.abs(inst.next.daysLeft), source: 'installment', amount: inst.next.dueAmount });
  if (overdue.length) {
    const worst = overdue.reduce((a, b) => (b.days > a.days ? b : a));
    return { status: 'qua_han', badge: 'badge-red', label: `Quá hạn ${worst.days} ngày`, days: worst.days, dueAmount: worst.amount, source: worst.source };
  }
  const near = [];
  if (mainLevel === 'gan_den_han') near.push({ days: mainDays, source: 'contract', amount: contract.balance });
  if (instLevel === 'gan_den_han') near.push({ days: inst.next.daysLeft, source: 'installment', amount: inst.next.dueAmount });
  if (near.length) {
    const soonest = near.reduce((a, b) => (b.days < a.days ? b : a));
    return { status: 'gan_den_han', badge: 'badge-yellow', label: `Gần đến hạn ${soonest.days} ngày`, days: soonest.days, dueAmount: soonest.amount, source: soonest.source };
  }
  return { status: 'dang_vay', badge: 'badge-blue', label: 'Trong hạn', days: mainDays, dueAmount: contract.balance, source: 'contract' };
}

export const WIDE_NEAR_DUE_DAYS = 45;

export function contractAttentionInfo(contract, asOf = new Date()) {
  if ((Number(contract.balance) || 0) <= 0) {
    return { level: null, days: 0, dueAmount: 0, source: null };
  }
  const d = daysBetween(asOf, new Date(contract.dueDate));
  const contractLevel = contractUrgency(contract, asOf) === 'qua_han' ? 'qua_han' : (d >= 0 && d <= WIDE_NEAR_DUE_DAYS ? 'gan_den_han' : null);
  const inst = nextInstallmentInfo(contract, asOf);
  const instDays = inst ? inst.next.daysLeft : null;
  const instLevel = inst ? (instDays < 0 ? 'qua_han' : (instDays <= WIDE_NEAR_DUE_DAYS ? 'gan_den_han' : null)) : null;

  const overdue = [];
  if (contractLevel === 'qua_han') overdue.push({ days: Math.abs(d), source: 'contract', amount: contract.balance });
  if (instLevel === 'qua_han') overdue.push({ days: Math.abs(instDays), source: 'installment', amount: inst.next.dueAmount });
  if (overdue.length) {
    const worst = overdue.reduce((a, b) => (b.days > a.days ? b : a));
    return { level: 'qua_han', days: worst.days, dueAmount: worst.amount, source: worst.source };
  }

  const nearDue = [];
  if (contractLevel === 'gan_den_han') nearDue.push({ days: d, source: 'contract', amount: contract.balance });
  if (instLevel === 'gan_den_han') nearDue.push({ days: instDays, source: 'installment', amount: inst.next.dueAmount });
  if (nearDue.length) {
    const soonest = nearDue.reduce((a, b) => (b.days < a.days ? b : a));
    return { level: 'gan_den_han', days: soonest.days, dueAmount: soonest.amount, source: soonest.source };
  }

  return { level: null, days: 0, dueAmount: contract.balance, source: null };
}

export async function loginCustomer(identifier, password) {
  const res = await callLoginFunction({ role: 'customer', identifier, password });
  if (!res.ok) return { ok: false, reason: res.reason };
  await loadWithRetry(() => loadCustomerSessionData(res.id, res.token));
  return { ok: true, customerId: res.id, mustChangePassword: !!res.mustChangePassword, sbToken: res.token };
}

export async function requestPasswordReset(cccd, phone) {
  return callForgotPasswordFunction({ cccd, phone });
}

async function loadCustomerSessionData(customerId, token) {
  const sb = getSupabaseClient(token);
  const [custRes, contractRes, requestRes, chatUnreadRes] = await Promise.all([
    sb.from('customers').select('*').eq('id', customerId).maybeSingle(),
    sb.from('contracts').select('*').eq('customer_id', customerId),
    sb.from('requests').select('*').eq('customer_id', customerId),

    sb.from('chat_messages').select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId).eq('sender_role', 'admin').is('read_at', null)
      .then((r) => r, () => ({ count: 0 })),
  ]);

  if (custRes?.error || !queryOk(contractRes)) {
    console.warn('Tải dữ liệu khách hàng chưa trọn vẹn, giữ nguyên dữ liệu cũ.', custRes?.error || contractRes?.error);
    return false;
  }
  state.customers = custRes.data ? [mapCustomerRow(custRes.data)] : [];
  state.contracts = contractRes.data.map(mapContractRow);
  if (queryOk(requestRes)) state.requests = requestRes.data.map(mapRequestRow);
  if (chatUnreadRes && !chatUnreadRes.error) state.chatUnreadCount = chatUnreadRes.count || 0;
  lastRefreshOkAt = Date.now();
  return true;
}

const queryOk = (res) => !!res && !res.error && Array.isArray(res.data);

async function loadWithRetry(load, tries = 3, waitMs = 1500) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try { if (await load()) return true; lastErr = null; }
    catch (e) { lastErr = e; }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs * (i + 1)));
  }
  if (lastErr) throw lastErr;
  return false;
}

function mapCustomerRow(row) {
  return {
    id: row.id, cccd: row.cccd, name: row.name, phone: row.phone || '', address: row.address || '',
    thon: row.thon || '', xom: row.xom || '', xa: row.xa || '', tinh: row.tinh || '',
    salt: row.salt, hash: row.hash,
    mustChangePassword: !!row.must_change_password,
    forceLogoutAt: row.force_logout_at || null,
    failedAttempts: row.failed_attempts || 0,
    lockedUntil: row.locked_until ? new Date(row.locked_until).getTime() : null,
    lastLoginAt: row.last_login_at || null,
    isOnline: !!row.is_online,

    coPeople: Array.isArray(row.co_people) ? row.co_people.map((x) => ({ name: String(x?.name || ''), phone: String(x?.phone || '') })).filter((x) => x.name) : [],
    coPrevName: row.co_prev_name || '',
    createdAt: row.created_at,
  };
}
function mapContractRow(row) {
  return {
    id: row.id, customerId: row.customer_id, code: row.code,
    principal: Number(row.principal), balance: Number(row.balance),
    disbursedDate: row.disbursed_date, dueDate: row.due_date,
    interestRate: Number(row.interest_rate),
    interestPaidUntil: row.interest_paid_until,

    agreementCode: row.agreement_code || null,
    installmentSchedule: row.installment_schedule || null,

    hasCollateral: !!row.has_collateral && ['01', '02', '04', '06'].includes(row.collateral_type),
    collateralValue: Number(row.collateral_value) || 0,
    collateralType: row.collateral_type || null,
    loanTerm: row.loan_term || null,
    loanPurpose: row.loan_purpose || null,

    heirName: row.heir_name || null,

    oaEnabled: row.oa_enabled !== false, oaToMain: row.oa_to_main !== false, oaToCo: !!row.oa_to_co, oaCoKey: row.oa_co_key || null,
  };
}

export async function verifyCustomerPassword(customerId, password) {
  const session = getSession();
  if (!session || session.id !== customerId) return false;
  const res = await callCreateAccountFunction(session.sbToken, { type: 'verify-own-password', password });
  return !!(res.ok && res.valid);
}

export async function setCustomerPassword(customerId, newPassword, opts = {}) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, {
    type: 'set-own-password', newPassword, mustChangePassword: !!opts.mustChangePassword,
  });
  if (!res.ok) throw new Error(res.reason || 'Không đổi được mật khẩu.');
  const c = getCustomer(customerId);
  if (c) { c.mustChangePassword = !!opts.mustChangePassword; c.tempPassword = null; }
  notify();
}

export async function adminResetCustomerPassword(customerId, customPassword) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'reset-customer-password', customerId, password: customPassword });
  if (!res.ok) throw new Error(res.reason || 'Không cấp lại được mật khẩu.');
  const c = getCustomer(customerId);
  if (c) { c.mustChangePassword = true; c.failedAttempts = 0; c.lockedUntil = null; }
  notify();
  return res.tempPassword;
}

function activeContractsOf(customerId) {
  return listContractsByCustomer(customerId).filter((ct) => effectiveContractStatus(ct) !== 'da_tat_toan');
}

export function findPhoneHolders(phone, customerId, coName) { return phoneHolders(state.customers, phone, { exceptCustomerId: customerId, exceptCoName: coName }); }
export function listCoPeople(customerId) {
  const c = getCustomer(customerId);
  if (!c) return [];
  const cts = activeContractsOf(customerId);
  return heirNamesOf(cts, c.name).map((name) => ({
    name, phone: coPhoneOf(c.coPeople, name),
    contracts: cts.filter((ct) => samePerson(heirOfContract(ct, c.name), name)),
  }));
}

export function oaAddBlockReason(customerId) {
  const c = getCustomer(customerId);
  if (!c || String(c.phone || '').trim() || hasOaPhone(activeContractsOf(customerId), c)) return '';
  return listCoPeople(customerId).length
    ? 'Người vay và người cùng vay đều chưa có số điện thoại nên chưa thêm được vào danh sách OA.'
    : 'Khách hàng chưa có số điện thoại nên chưa thêm được vào danh sách OA.';
}

export function getContractOa(contractId) {
  const ct = getContract(contractId);
  const c = ct && getCustomer(ct.customerId);
  return ct && c ? contractOa(ct, c) : null;
}

export function customerOaOverview(customerId) {
  const c = getCustomer(customerId);
  if (!c) return null;
  const sum = customerOaSummary(activeContractsOf(customerId), c);
  const people = listCoPeople(customerId);

  return { ...sum, people, detail: people.length >= 2 || sum.offCount > 0 || !sum.uniform };
}

export function isZaloLogVisible(log) {
  const ct = getContract(log?.contractId);
  return !(ct && ct.oaEnabled === false);
}

export function coChangeInfo(customerId) {
  const c = getCustomer(customerId);
  if (!c || !c.coPrevName) return null;
  return { prevName: c.coPrevName, names: heirNamesOf(activeContractsOf(customerId), c.name) };
}

const coSaveQueue = new Map();
function coSaveError(res) {
  const reason = String(res.reason || '');
  return new Error(/Thiếu hoặc sai "type"/.test(reason) ? 'Máy chủ chưa cập nhật để lưu cấu hình gửi OA — cần deploy lại Edge Function create-account (docs mục 10.83).' : (reason || 'Không lưu được, thử lại sau.'));
}

async function runCoSave(customerId, job) {
  const q = coSaveQueue.get(customerId) || { tail: Promise.resolve(), pending: 0 };
  coSaveQueue.set(customerId, q);
  q.pending++;
  const run = q.tail.catch(() => {}).then(job);
  q.tail = run;
  try { const result = await run; return { result, last: q.pending === 1 }; }
  finally { q.pending--; if (!q.pending) coSaveQueue.delete(customerId); }
}

export async function setContractOa(contractId, patch, { optimistic = true } = {}) {
  const ct = getContract(contractId);
  if (!ct) throw new Error('Không tìm thấy hợp đồng.');
  const c = getCustomer(ct.customerId);
  const snap = { oaEnabled: ct.oaEnabled, oaToMain: ct.oaToMain, oaToCo: ct.oaToCo, oaCoKey: ct.oaCoKey };
  if (optimistic) {
    if (patch.enabled !== undefined) ct.oaEnabled = !!patch.enabled;
    if (patch.toMain !== undefined) ct.oaToMain = !!patch.toMain;
    if (patch.toCo !== undefined) { ct.oaToCo = !!patch.toCo; ct.oaCoKey = patch.toCo ? normPersonName(heirOfContract(ct, c?.name)) : null; }
    notify();
  }
  try {
    const { result, last } = await runCoSave(ct.customerId, async () => {
      const res = await callCreateAccountFunction(getSession()?.sbToken, { type: 'save-contract-oa', contractId, ...patch });
      if (!res.ok) throw coSaveError(res);
      return res;
    });
    if (last && result.contract) {
      ct.oaEnabled = result.contract.oaEnabled !== false; ct.oaToMain = result.contract.oaToMain !== false;
      ct.oaToCo = !!result.contract.oaToCo; ct.oaCoKey = result.contract.oaCoKey || null;
    }
    notify();
  } catch (err) {
    if (optimistic) {
      if (patch.enabled !== undefined) ct.oaEnabled = snap.oaEnabled;
      if (patch.toMain !== undefined) ct.oaToMain = snap.oaToMain;
      if (patch.toCo !== undefined) { ct.oaToCo = snap.oaToCo; ct.oaCoKey = snap.oaCoKey; }
      notify();
    }
    throw err;
  }
}

export async function saveCoPhone(customerId, name, phone) {
  const c = getCustomer(customerId);
  const { result } = await runCoSave(customerId, async () => {
    const res = await callCreateAccountFunction(getSession()?.sbToken, { type: 'save-co-phone', customerId, name, phone });
    if (!res.ok) throw coSaveError(res);
    return res;
  });
  if (c && Array.isArray(result.people)) c.coPeople = result.people.map((x) => ({ name: String(x?.name || ''), phone: String(x?.phone || '') })).filter((x) => x.name);
  for (const r of result.contracts || []) {
    const ct = getContract(r.id);
    if (ct) { ct.oaToMain = r.oaToMain !== false; ct.oaToCo = !!r.oaToCo; ct.oaCoKey = r.oaCoKey || null; }
  }
  notify();
}

export async function saveMainPhone(customerId, phone) {
  const c = getCustomer(customerId);
  const { result } = await runCoSave(customerId, async () => {
    const res = await callCreateAccountFunction(getSession()?.sbToken, { type: 'save-main-phone', customerId, phone });
    if (!res.ok) throw coSaveError(res);
    return res;
  });
  if (c) c.phone = String(result.phone || phone).replace(/\s/g, '');
  notify();
}

async function runImportCoPhones(items, { overwrite = false, preview = false } = {}) {
  const res = await callCreateAccountFunction(getSession()?.sbToken, { type: 'import-co-phones', items, overwrite: !!overwrite, preview: !!preview });
  if (!res.ok) throw coSaveError(res);
  return res;
}
export function previewImportCoPhones(items, opts = {}) { return runImportCoPhones(items, { ...opts, preview: true }); }
export async function importCoPhones(items, opts = {}) {
  const res = await runImportCoPhones(items, { ...opts, preview: false });
  for (const u of res.updated || []) {
    const c = getCustomer(u.id);
    if (c) c.coPeople = (u.people || []).map((x) => ({ name: String(x?.name || ''), phone: String(x?.phone || '') })).filter((x) => x.name);
  }
  notify();
  return res;
}

export function dismissCoBorrowerChange(customerId) {
  const c = getCustomer(customerId);
  if (c && c.coPrevName) { c.coPrevName = ''; notify(); }
}

export async function forceLogoutCustomer(customerId) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'force-logout-customer', customerId });
  if (!res.ok) throw new Error(res.reason || 'Không đăng xuất được tài khoản này.');
  const c = getCustomer(customerId);
  if (c) c.forceLogoutAt = new Date().toISOString();
  notify();
}

function upsertCustomerProfileCore({ cccd, name, phone, address }, existing) {
  const parsed = address != null ? parseAddress(address) : null;
  const phoneClean = phone != null ? String(phone).replace(/\s/g, '') : phone;
  let c = existing !== undefined ? existing : findCustomerByCccd(cccd);
  if (c) {
    c.name = name || c.name;
    c.phone = phoneClean || c.phone;
    if (address) { c.address = address; Object.assign(c, parsed); }
    return { customer: c, isNew: false };
  }
  c = {
    id: genId('cust'), cccd: String(cccd).trim(), name: name || '', phone: phoneClean || '',
    address: address || '', ...(parsed || { xom: '', thon: '', xa: '', tinh: '' }),
    salt: null, hash: null, mustChangePassword: false, tempPassword: null,
    failedAttempts: 0, lockedUntil: null, createdAt: new Date().toISOString(),
  };
  state.customers.push(c);
  return { customer: c, isNew: true };
}

export async function upsertCustomerProfile({ cccd, name, phone, address }) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'update-customer-profile', cccd, name, phone, address });
  if (!res.ok) throw new Error(res.reason || 'Không cập nhật được hồ sơ.');
  const c = findCustomerByCccd(cccd);
  if (c) {
    if (name) c.name = name;
    if (phone) c.phone = String(phone).replace(/\s/g, '');
    if (address) { c.address = address; Object.assign(c, parseAddress(address)); }
  }
  notify();
  return { customer: c };
}

export async function activateCustomerAccount({ cccd, name, phone, password }) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'customer', cccd, name, phone, password });
  if (!res.ok) throw new Error(res.reason || 'Không tạo được tài khoản.');

  const customer = res.customer ? mapCustomerRow(res.customer) : { id: res.id, cccd };
  const idx = state.customers.findIndex((c) => c.id === customer.id);
  if (idx >= 0) state.customers[idx] = customer; else state.customers.push(customer);
  notify();
  return { customer, tempPassword: res.tempPassword };
}

export async function deactivateCustomerAccount(customerId) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'deactivate-customer', customerId });
  if (!res.ok) throw new Error(res.reason || 'Không xóa được Use.');
  const c = getCustomer(customerId);
  if (c) { c.salt = null; c.hash = null; c.mustChangePassword = false; c.tempPassword = null; c.failedAttempts = 0; c.lockedUntil = null; }
  notify();
}

function naturalXomCompare(a, b) {
  const parse = (s) => {
    const m = String(s).match(/(\d+)(?:\s*\/\s*(\d+))?/);
    return m ? [parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0] : [Infinity, 0];
  };
  const [aMajor, aMinor] = parse(a);
  const [bMajor, bMinor] = parse(b);
  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return String(a).localeCompare(String(b), 'vi');
}
export function distinctThon() {
  return [...new Set(state.customers.map((c) => c.thon).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
}
export function distinctXom(thon) {
  const thonList = [].concat(thon || []).filter(Boolean);
  const list = thonList.length ? state.customers.filter((c) => thonList.includes(c.thon)) : state.customers;
  return [...new Set(list.map((c) => c.xom).filter(Boolean))].sort(naturalXomCompare);
}

function territoryOf(adminId) {
  const a = getAdmin(adminId);
  return a && a.role === 'staff' ? { thon: new Set(a.allowedThon || []), xom: new Set(a.allowedXom || []) } : null;
}

export function isCustomerInTerritory(customer, adminId) {
  const t = territoryOf(adminId);
  return !t || t.thon.has(customer.thon) || t.xom.has(xomKey(customer.thon, customer.xom));
}

export function territoryThonList(adminId) {
  const t = territoryOf(adminId);
  if (!t) return distinctThon();
  const set = new Set(t.thon);
  t.xom.forEach((k) => { const thon = parseXomKey(k).thon; if (thon) set.add(thon); });
  return [...set].sort((a, b) => a.localeCompare(b, 'vi'));
}

export function territoryXomList(adminId, thon) {
  const t = territoryOf(adminId);
  if (!t) return distinctXom(thon);
  const picked = [].concat(thon || []).filter(Boolean);
  const set = new Set();
  for (const th of (picked.length ? picked : territoryThonList(adminId))) {
    if (t.thon.has(th)) distinctXom(th).forEach((x) => set.add(x));
    t.xom.forEach((k) => { const p = parseXomKey(k); if (p.thon === th && p.xom) set.add(p.xom); });
  }
  return [...set].sort(naturalXomCompare);
}

export function xomKey(thon, xom) { return `${thon}||${xom}`; }
export function parseXomKey(key) {
  const i = String(key || '').indexOf('||');
  return i < 0 ? { thon: '', xom: key || '' } : { thon: key.slice(0, i), xom: key.slice(i + 2) };
}

export function thonXomTree() {
  return distinctThon().map((thon) => ({ thon, xomList: distinctXom(thon) }));
}

function autoContractCode(cccd) {
  const n = state.contracts.filter((c) => c.autoCode).length + 1;
  return `HD-${cccd}-${String(n).padStart(3, '0')}`;
}

function upsertContractCore({ customerId, code, principal, disbursedDate, dueDate, interestRate, balance, status, interestPaidUntil }, existing) {
  const customer = getCustomer(customerId);
  const bal = Number(balance) || 0;
  let ct = existing !== undefined ? existing : (code ? state.contracts.find((c) => c.code === code) : null);
  const data = {
    customerId,
    code: code || (ct ? ct.code : autoContractCode(customer?.cccd || customerId)),
    autoCode: !code,
    principal: principal != null && principal !== '' ? Number(principal) || 0 : bal,
    disbursedDate,
    dueDate: dueDate || addDays(new Date(disbursedDate), 365).toISOString().slice(0, 10),
    interestRate: interestRate != null && interestRate !== '' ? Number(interestRate) || 0 : (ct ? ct.interestRate : 0),
    balance: bal, status: status || 'dang_vay',
    interestPaidUntil: interestPaidUntil || disbursedDate,
  };
  if (ct) { Object.assign(ct, data); }
  else { ct = { id: genId('hd'), ...data }; state.contracts.push(ct); }
  return ct;
}
export function upsertContract(args) {
  const ct = upsertContractCore(args);
  notify();
  return ct;
}

export async function sendManualNotification(customerId, title, body) {
  const session = getSession();
  return callCreateAccountFunction(session?.sbToken, { type: 'send-manual-notification', customerId, title, body });
}

function oaListable(customerId) { return !oaAddBlockReason(customerId); }
export function isZaloCustomer(customerId) {
  return (state.zaloCustomers || []).some((r) => r.customerId === customerId) && oaListable(customerId);
}
export function listZaloCustomers() {
  const addedMs = (r) => Date.parse(r.addedAt) || 0;
  return (state.zaloCustomers || []).filter((r) => oaListable(r.customerId)).sort((a, b) => addedMs(b) - addedMs(a));
}

export function findZaloAutoSend(contractId) {
  return listZaloAutoSend().find((r) => r.contractId === contractId) || null;
}

const AUTO_STATUS_TTL_MS = 5 * 60 * 1000;
const autoStatusCache = new Map();
const autoStatusAsking = new Map();
let autoStatusGen = 0;
function dropAutoStatusCache() { autoStatusGen += 1; autoStatusCache.clear(); autoStatusAsking.clear(); }

// Suy từ dữ liệu đã tải, không gọi máy chủ: null = chưa biết, final=false = nên hỏi lại ngầm.
export function peekZaloAutoSendStatus(contractId) {
  const row = (state.zaloAutoSendList || []).find((r) => r.contractId === contractId);
  if (row) return { enabled: true, intervalMonths: row.intervalMonths || 1, final: true };
  const hit = autoStatusCache.get(contractId);
  if (hit && Date.now() - hit.at < AUTO_STATUS_TTL_MS) return { ...hit.status, final: true };
  if (!hasZaloAutoOverview()) return null;
  if (listZaloAutoOverview().some((r) => r.contractId === contractId)) return { enabled: true, intervalMonths: null, final: false };
  return { enabled: false, intervalMonths: null, final: isSuperAdmin(state.session.id) };
}

export function getZaloAutoSendStatus(contractId) {
  const hit = autoStatusCache.get(contractId);
  if (hit && Date.now() - hit.at < AUTO_STATUS_TTL_MS) return Promise.resolve({ ...hit.status });
  if (autoStatusAsking.has(contractId)) return autoStatusAsking.get(contractId);
  const gen = autoStatusGen;
  const ask = callCreateAccountFunction(getSession()?.sbToken, { type: 'get-zalo-auto-send-status', contractId }).then((res) => {
    if (!res.ok) throw new Error(res.reason || 'Không kiểm tra được trạng thái gửi tự động.');
    const status = { enabled: res.enabled === true, intervalMonths: Number(res.intervalMonths) || 1 };
    if (gen === autoStatusGen) autoStatusCache.set(contractId, { at: Date.now(), status });
    return status;
  }).finally(() => { if (autoStatusAsking.get(contractId) === ask) autoStatusAsking.delete(contractId); });
  autoStatusAsking.set(contractId, ask);
  return ask;
}

function isOwnAutoRow(r) {
  const me = state.session?.id;
  if (!me) return false;
  return r.createdBy === me || (!r.createdBy && getAdmin(me)?.role === 'super');
}

export function listZaloAutoSend() {

  return (state.zaloAutoSendList || []).filter(isOwnAutoRow).sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
}

export function listZaloAutoOverview() {
  const meId = state.session?.id || null;
  const mine = (state.zaloAutoSendList || []).map((r) => ({ id: r.id, customerId: r.customerId, contractId: r.contractId, kind: r.kind, createdBy: r.createdBy || meId, createdByName: '' }));
  if (state.zaloAutoOverviewFor !== meId) return mine;
  const have = new Set(mine.map((r) => r.id));
  return mine.concat((state.zaloAutoOverview || []).filter((r) => !have.has(r.id)));
}

export function summarizeZaloAutoByOwner() {
  const meId = state.session?.id || null;
  const by = new Map();
  for (const r of listZaloAutoOverview()) {
    const key = r.createdBy || '';
    const cur = by.get(key) || { id: key, name: r.createdByName || getAdmin(key)?.name || 'Chưa rõ người thêm', count: 0, isMe: key === meId };
    if (r.createdByName && !cur.name) cur.name = r.createdByName;
    cur.count += 1;
    by.set(key, cur);
  }
  const owners = [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'vi'));
  return { total: owners.reduce((n, o) => n + o.count, 0), owners };
}

export function hasZaloAutoOverview() {
  return state.session?.role === 'admin' && (getAdmin(state.session.id)?.role === 'super' || state.zaloAutoOverviewFor === state.session.id);
}

export function zaloAutoSendOwnerOtherThanMe(customerId) {
  const meId = state.session?.id || null;
  const hit = listZaloAutoOverview().find((r) => r.customerId === customerId && r.createdBy !== meId);
  return hit ? { createdBy: hit.createdBy, createdByName: hit.createdByName || getAdmin(hit.createdBy)?.name || '' } : null;
}

export async function refreshZaloAutoOverview() {
  const session = getSession();
  if (!session?.sbToken || session.role !== 'admin') return false;
  try {
    const res = await callCreateAccountFunction(session.sbToken, { type: 'list-zalo-auto-overview' });
    if (!res?.ok || !Array.isArray(res.rows)) return false;
    const rows = res.rows.map((r) => ({ id: r.id, customerId: r.customerId, contractId: r.contractId, kind: r.kind, createdBy: r.createdBy || null, createdByName: r.createdByName || '' }));
    const changed = state.zaloAutoOverviewFor !== session.id || JSON.stringify(rows) !== JSON.stringify(state.zaloAutoOverview || []);
    state.zaloAutoOverview = rows;
    state.zaloAutoOverviewFor = session.id;
    return changed;
  } catch { return false; }
}
export function listZaloAutoSendByKind(kind) { return listZaloAutoSend().filter((r) => r.kind === kind); }
export function listZaloSendLog() { return state.zaloSendLog || []; }

export async function fetchOlderZaloSendLog({ before, limit = 500 }) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { data, error } = await sb.from('zalo_send_log').select('*').lte('sent_at', before).order('sent_at', { ascending: false }).limit(limit);
  if (error) throw new Error('Không tải được thêm lịch sử gửi tin, thử lại sau.');
  const rows = (data || []).map(mapZaloSendLogRow);
  return { rows, hasMore: rows.length >= limit };
}

export function lastSuccessfulZaloSend(contractId) {
  const rows = (state.zaloSendLog || []).filter((l) => l.contractId === contractId && l.status === 'success');
  const known = lastSendFromServer.get(contractId);
  if (known) rows.push(known);
  if (!rows.length) return null;
  return rows.reduce((a, b) => (new Date(a.sentAt) > new Date(b.sentAt) ? a : b));
}
const lastSendFromServer = new Map();

export async function fetchLastSuccessfulZaloSend(contractId) {
  if (!contractId) return null;
  try {
    const sb = getSupabaseClient(getSession()?.sbToken);
    const { data, error } = await sb.from('zalo_send_log').select('*').eq('contract_id', contractId).eq('status', 'success').order('sent_at', { ascending: false }).limit(1);
    if (error || !Array.isArray(data) || !data.length) return null;
    const row = mapZaloSendLogRow(data[0]);
    lastSendFromServer.set(contractId, row);
    return row;
  } catch { return null; }
}

export async function addZaloCustomer(customerId) {
  const blocked = oaAddBlockReason(customerId);
  if (blocked) throw new Error(blocked);
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'add-zalo-customer', customerId });
  if (!res.ok) throw new Error(res.reason || 'Không thêm được vào danh sách OA.');
  if (!state.zaloCustomers.some((r) => r.customerId === customerId)) {
    state.zaloCustomers.push({ customerId, addedBy: session?.id || null, addedAt: new Date().toISOString() });
  }
  notify();
}
export async function removeZaloCustomer(customerId) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'remove-zalo-customer', customerId });
  if (!res.ok) throw new Error(res.reason || 'Không xóa được khỏi danh sách OA.');
  state.zaloCustomers = state.zaloCustomers.filter((r) => r.customerId !== customerId);

  state.zaloAutoSendList = state.zaloAutoSendList.filter((r) => r.customerId !== customerId);
  state.zaloAutoOverview = (state.zaloAutoOverview || []).filter((r) => r.customerId !== customerId);
  dropAutoStatusCache();
  notify();
}

export async function addZaloAutoSend(contractId, kind = 'lai_hang_thang_auto', customDay = null, intervalMonths = 1) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'add-zalo-auto-send', contractId, kind, customDay, intervalMonths });
  if (!res.ok) throw new Error(res.reason || 'Không thêm được vào danh sách gửi tự động.');

  try {
    const sb = getSupabaseClient(session?.sbToken);
    const { data, error } = await sb.from('zalo_auto_send_list').select('*').eq('contract_id', contractId).maybeSingle();
    if (error || !data) throw new Error('không đọc được dòng vừa tạo');
    const row = mapZaloAutoSendRow(data);
    state.zaloAutoSendList = (state.zaloAutoSendList || []).filter((r) => r.id !== row.id && r.contractId !== row.contractId).concat(row);
    if (!state.zaloCustomers.some((r) => r.customerId === row.customerId)) {
      state.zaloCustomers.push({ customerId: row.customerId, addedBy: session?.id || null, addedAt: new Date().toISOString() });
    }
    notify();
  } catch {
    await refreshSessionData();
  }
}
export async function removeZaloAutoSend(id) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'remove-zalo-auto-send', id });
  if (!res.ok) throw new Error(res.reason || 'Không xóa được khỏi danh sách gửi tự động.');
  state.zaloAutoSendList = state.zaloAutoSendList.filter((r) => r.id !== id);
  state.zaloAutoOverview = (state.zaloAutoOverview || []).filter((r) => r.id !== id);
  dropAutoStatusCache();
  notify();
}

export async function updateZaloAutoSendSettings(id, patch) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'update-zalo-auto-send-settings', id, ...patch });
  if (!res.ok) throw new Error(res.reason || 'Không sửa được lựa chọn này.');
  const row = state.zaloAutoSendList.find((r) => r.id === id);
  if (row) {
    if (patch.customDay !== undefined) row.customDay = patch.customDay;
    if (patch.intervalMonths !== undefined) row.intervalMonths = patch.intervalMonths;
  }
  notify();
}

export async function sendZaloManual(contractId, { asOf = null } = {}) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, asOf ? { type: 'send-zalo-manual-asof', contractId, asOf } : { type: 'send-zalo-manual', contractId });
  if (asOf && !res.ok && /Thiếu hoặc sai "type"/.test(res.reason || '')) {
    return { ok: false, reason: 'Máy chủ chưa cập nhật để gửi theo ngày tính lãi đã chỉnh (cần deploy lại create-account) — chưa gửi tin nào.' };
  }

  refreshSessionData().catch(() => {});
  return res;
}

export async function deleteCustomer(id) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'delete-customer', customerId: id });
  if (!res.ok) throw new Error(res.reason || 'Không xóa được khách hàng.');
  state.customers = state.customers.filter((c) => c.id !== id);
  state.contracts = state.contracts.filter((c) => c.customerId !== id);
  notify();
}

export async function deleteContract(id) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'delete-contract', contractId: id });
  if (!res.ok) throw new Error(res.reason || 'Không xóa được hợp đồng.');
  state.contracts = state.contracts.filter((c) => c.id !== id);
  pruneEmptyCustomerProfiles();
  notify();
}

export function parseVNNumber(str) {
  let s = String(str ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!s) return 0;

  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');

  else if (/^-?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
  else if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
export function parseVNDate(str) {
  const s = String(str || '').trim();
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  if (/^\d{4,6}$/.test(s)) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
}

function pruneEmptyCustomerProfiles() {
  const balanceByCustomer = new Map();
  for (const ct of state.contracts) {
    balanceByCustomer.set(ct.customerId, (balanceByCustomer.get(ct.customerId) || 0) + (ct.balance || 0));
  }
  const keepIds = new Set(
    state.customers.filter((c) => (balanceByCustomer.get(c.id) || 0) > 0 || (c.salt && c.hash)).map((c) => c.id)
  );
  const before = state.customers.length;
  state.customers = state.customers.filter((c) => keepIds.has(c.id));
  state.contracts = state.contracts.filter((ct) => keepIds.has(ct.customerId));
  return before - state.customers.length;
}

const HEADER_HINTS = ['cccd', 'cmnd', 'người nhận nợ', 'nguoi nhan no', 'họ tên', 'ho ten', 'số hđtd', 'so hdtd'];

function parseImportLine(line) {
  const cells = line.includes('\t') ? line.split('\t') : line.split(',');
  if (cells.length < 2) return { error: 'skip' };
  const headerCheck = cells.slice(0, 2).join(' ').toLowerCase();
  if (HEADER_HINTS.some((h) => headerCheck.includes(h))) return { error: 'header' };

  const [code, name, address, cccdRaw, phone, disbursedDate, dueDate, interestPaidUntil, principal, balance, interestRate, agreementCode, installmentScheduleRaw, collateralValueRaw, collateralTypeRaw, loanTermRaw, loanPurposeRaw, heirNameRaw] = cells.map((c) => c.trim());
  const cccd = (cccdRaw || '').replace(/\s/g, '');
  if (!cccd || !/^\d{9,12}$/.test(cccd)) return { error: `Bỏ qua dòng (CCCD không hợp lệ): ${line.slice(0, 40)}...` };

  let installmentSchedule = null;
  if (installmentScheduleRaw) {
    try {
      const raw = JSON.parse(installmentScheduleRaw);
      const parsed = {};
      for (const [year, amtRaw] of Object.entries(raw)) {
        const amt = parseVNNumber(amtRaw);
        if (amt > 0) parsed[year] = amt;
      }
      if (Object.keys(parsed).length) installmentSchedule = parsed;
    } catch (e) {  }
  }

  const disbursed = parseVNDate(disbursedDate) || new Date().toISOString().slice(0, 10);
  const row = {
      cccd, name, address, phone, code: code || null,
      agreementCode: agreementCode || null,
      installmentSchedule,
      principal: principal ? parseVNNumber(principal) : null,
      disbursedDate: disbursed,
      dueDate: dueDate ? parseVNDate(dueDate) : null,
      interestRate: interestRate ? parseVNNumber(interestRate) : null,
      balance: parseVNNumber(balance),
      interestPaidUntil: parseVNDate(interestPaidUntil) || null,
    };

  if (cells.length >= 17) {
    const collateralCode = String(collateralTypeRaw || '').trim().toUpperCase();
    const purposeCode = String(loanPurposeRaw || '').trim();
    const termCode = String(loanTermRaw || '').trim().toUpperCase();
    row.collateralValue = parseVNNumber(collateralValueRaw);
    row.heirName = String(heirNameRaw || '').trim();
    row.collateralType = /^\d{1,2}$/.test(collateralCode) ? collateralCode.padStart(2, '0') : collateralCode;
    row.loanTerm = termCode.startsWith('NH') ? 'NH' : termCode.startsWith('TH') ? 'TH' : termCode;
    row.loanPurpose = purposeCode === '1' || purposeCode === '01' ? '01'
      : purposeCode === '4' || purposeCode === '04' ? '04'
        : purposeCode === '52' || purposeCode === '052' ? '052' : purposeCode;
  }
  return { row };
}

function prepareImportRows(text, fullSync) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  let skipped = 0;
  const parseErrors = [];
  for (const line of lines) {
    const { row, error } = parseImportLine(line);
    if (error === 'skip') { skipped++; continue; }
    if (error === 'header') continue;
    if (error) { parseErrors.push(error); continue; }
    rows.push(row);
  }

  if (fullSync && (skipped || parseErrors.length || !rows.length)) {
    throw new Error(parseErrors[0] || 'File có dòng không hợp lệ hoặc không có hợp đồng; đã hủy đồng bộ để tránh xóa nhầm dữ liệu.');
  }
  return { rows, skipped, parseErrors };
}

function throwIfServerLacksImportReview(res) {
  if (res && !res.ok && /sai "type"/.test(res.reason || '')) {
    throw new Error('Máy chủ chưa cập nhật chức năng xem trước và lịch sử nhập — cần triển khai lại Edge Function create-account rồi thử lại.');
  }
}

export async function previewImportFromPastedTable(text, { fullSync = false } = {}) {
  const { rows, skipped, parseErrors } = prepareImportRows(text, fullSync);
  if (!rows.length) throw new Error(parseErrors[0] || 'Không đọc được hợp đồng nào từ dữ liệu này.');
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'import-preview', rows, fullSync });
  throwIfServerLacksImportReview(res);
  if (!res.ok) throw new Error(res.reason || 'Không xem trước được dữ liệu.');
  return { summary: res.summary, details: res.details, localSkipped: skipped, parseErrors };
}

export async function importFromPastedTable(text, { fullSync = false, fileName = '' } = {}) {
  const { rows, skipped, parseErrors } = prepareImportRows(text, fullSync);

  const session = getSession();
  const res = await callImportDataFunction(session?.sbToken, { rows, fullSync, fileName });
  if (!res.ok) throw new Error(res.reason || 'Không nhập được dữ liệu.');

  await loadAdminSessionData(session.sbToken, { snapshots: res.snapshotsChanged !== false });

  notify();

  return {
    newProfiles: res.newProfiles || 0, existingCustomers: res.existingCustomers || 0, contracts: res.contracts || 0,
    deletedContracts: res.deletedContracts || 0, deletedCustomers: res.deletedCustomers || 0,
    zaloAutoSendMigrated: res.zaloAutoSendMigrated || 0,
    skipped: skipped + (res.skipped || 0), errors: [...parseErrors, ...(res.errors || [])],
    newAccounts: res.newAccounts || [],
    summary: res.summary || null, details: res.details || null, historyId: res.historyId || null,
    coBorrowerChanges: res.coBorrowerChanges || [],
  };
}

function buildSupplementRows(rawRows) {
  if (!Array.isArray(rawRows) || !rawRows.length) throw new Error('File số 2 không có hợp đồng hợp lệ.');
  return rawRows.map((raw) => {
    const code = String(raw.code || '').trim();
    if (!code) throw new Error('File số 2 có dòng thiếu Số HĐ.');
    const installmentSchedule = {};
    for (const [year, amountRaw] of Object.entries(raw.installmentSchedule || {})) {
      if (!/^\d{4}$/.test(year)) continue;
      const amount = parseVNNumber(amountRaw);
      if (amount > 0) installmentSchedule[year] = amount;
    }

    return { code, agreementCode: String(raw.agreementCode || '').trim() || null, installmentSchedule };
  });
}

export async function previewSupplementRows(rawRows) {
  const rows = buildSupplementRows(rawRows);
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'import-supplement-preview', rows });
  throwIfServerLacksImportReview(res);
  if (!res.ok) throw new Error(res.reason || 'Không xem trước được file số 2.');
  return { summary: res.summary, details: res.details };
}

export async function importSupplementRows(rawRows, { fileName = '' } = {}) {
  const rows = buildSupplementRows(rawRows);
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'import-supplement', rows, fileName });
  if (!res.ok) throw new Error(res.reason || 'Không bổ sung được file số 2.');
  await loadAdminSessionData(session.sbToken, { snapshots: false });
  notify();
  return {
    updated: res.updated || 0, unmatched: res.unmatched || 0, errors: res.errors || [],
    summary: res.summary || null, details: res.details || null, historyId: res.historyId || null,
    emptySchedules: rows.filter((row) => !Object.keys(row.installmentSchedule).length).length,
  };
}

export async function listImportHistory() {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'import-history' });
  throwIfServerLacksImportReview(res);
  if (!res.ok) throw new Error(res.reason || 'Không tải được lịch sử nhập.');
  return { items: res.items || [], latestActiveId: res.latestActiveId || null };
}

export async function getImportHistoryDetail(id) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'import-history-detail', id });
  if (!res.ok) throw new Error(res.reason || 'Không tải được chi tiết lần nhập.');
  return res.item;
}

export async function rollbackImportHistory(id) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'import-rollback', id });
  if (!res.ok) throw new Error(res.reason || 'Không quay lại được.');
  await loadAdminSessionData(session.sbToken);
  notify();
  return res.counts || {};
}

export function previewHistoricalSnapshot(tsvText, asOfDate) {
  if (!asOfDate) throw new Error('File không có dòng "Đến ngày ...". Hãy chọn Ngày chốt trong file để xác định tháng cần lưu.');
  const lines = tsvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const contracts = [];
  const parseErrors = [];
  for (const line of lines) {
    const { row, error } = parseImportLine(line);
    if (error === 'skip' || error === 'header') continue;
    if (error) { parseErrors.push(error); continue; }
    contracts.push(row);
  }
  if (!contracts.length) throw new Error('Không đọc được hợp đồng nào từ file — kiểm tra lại đúng mẫu chưa.');

  const currentByCode = new Map();
  const ambiguousCodes = new Set();
  for (const current of state.contracts || []) {
    const code = String(current.code || '').trim();
    if (!code) continue;
    const previous = currentByCode.get(code);
    if (previous && (previous.hasCollateral || current.hasCollateral)) ambiguousCodes.add(code);
    else if (!previous) currentByCode.set(code, current);
  }
  const importedCollateralCodes = new Set();
  let collateralMatchedCount = 0;
  let collateralUnmatchedCount = 0;
  for (const ct of contracts) {
    const code = String(ct.code || '').trim();
    const current = currentByCode.get(code);
    if (ambiguousCodes.has(code) || (current?.hasCollateral && importedCollateralCodes.has(code))) {
      throw new Error(`Số HĐTD ${code} bị trùng nên không thể xác định TSBĐ cho từng dòng. Hãy kiểm tra lại trước khi lưu.`);
    }
    ct.hasCollateral = ['01', '02', '04', '06'].includes(ct.collateralType);
    ct.collateralValue = Number(ct.collateralValue) || 0;
    Object.assign(ct, inheritCurrentCollateral(ct, current));
    ct.loanTerm = ct.loanTerm || current?.loanTerm || null;
    ct.loanPurpose = ct.loanPurpose || current?.loanPurpose || null;
    if (ct.hasCollateral) {
      importedCollateralCodes.add(code);
      collateralMatchedCount++;
    } else {
      collateralUnmatchedCount++;
    }
  }
  const asOf = new Date(asOfDate);
  const summary = debtGroupSummary(contracts, asOf);
  const yearMonth = asOfDate.slice(0, 7);
  const existing = (state.monthlySnapshots || []).find((s) => s.yearMonth === yearMonth);

  const contractsDetail = [];
  for (const ct of contracts) {
    const g = debtGroup(ct, asOf);
    if (g === null) continue;
    const attention = contractAttentionInfo(ct, asOf);
    contractsDetail.push({
      code: ct.code || null, name: ct.name || null, address: ct.address || null,
      balance: Number(ct.balance) || 0, group: g, daysOverdue: daysOverdue(ct, asOf),

      attention: attention.level, attentionDays: attention.days, attentionAmount: attention.dueAmount,
      hasCollateral: ct.hasCollateral, collateralValue: ct.collateralValue,
      collateralType: ct.collateralType || null,
      loanTerm: ct.loanTerm || null,
      loanPurpose: ct.loanPurpose || null,
    });
  }

  const provision = provisionSummary(contracts, asOf);
  return {
    yearMonth, snapshotDate: asOfDate, contractsCount: contracts.length, summary, contractsDetail, parseErrors, willOverwrite: !!existing,
    generalProvision: provision.generalProvision, specificProvision: provision.specificProvision,
    collateralMatchedCount, collateralUnmatchedCount,
  };
}

export async function saveHistoricalSnapshot({ yearMonth, snapshotDate, summary, contractsDetail, generalProvision, specificProvision }) {
  const session = state.session;
  const res = await callCreateAccountFunction(session?.sbToken, {
    type: 'import-historical-snapshot',
    yearMonth, snapshotDate,
    totalBalance: summary.totalBalance,
    interestReceivable: summary.interestReceivable,
    groupBalances: summary.groupBalances,
    badDebtBalance: summary.badDebtBalance,
    badDebtRatio: summary.badDebtRatio,
    contractsDetail: contractsDetail || [],
    generalProvision, specificProvision,
  });
  if (res.ok) { await loadAdminSessionData(session.sbToken); notify(); }
  return res;
}

export async function loginAdmin(username, password) {
  const res = await callLoginFunction({ role: 'admin', identifier: username, password, device: detectDeviceKind() });
  if (!res.ok) return { ok: false, reason: res.reason };
  await loadWithRetry(() => loadAdminSessionData(res.token));
  await syncHistoricalCollateralOnce(res.token, res.id);
  return { ok: true, adminId: res.id, mustChangePassword: !!res.mustChangePassword, sbToken: res.token };
}

let historicalCollateralSyncedFor = null;
async function syncHistoricalCollateralOnce(token, adminId) {
  if (!isSuperAdmin(adminId) || historicalCollateralSyncedFor === adminId) return;
  historicalCollateralSyncedFor = adminId;
  try {
    const res = await callCreateAccountFunction(token, { type: 'sync-historical-collateral' });
    if (!res.ok) { historicalCollateralSyncedFor = null; return; }
    if (res.updated > 0) {
      const { data, error } = await getSupabaseClient(token).from('monthly_snapshots').select('*').order('year_month');
      if (error) throw error;
      state.monthlySnapshots = (data || []).map(mapMonthlySnapshotRow);
    }
  } catch (error) {
    historicalCollateralSyncedFor = null;
    console.warn('Chưa đồng bộ được TSBĐ lịch sử, sẽ thử lại.', error);
  }
}

let refreshInFlight = null;
let refreshQueued = false;
let refreshFailStreak = 0;
let refreshRetryTimer = null;
let lastRefreshOkAt = 0;
let snapshotsLoadedAt = 0;
const SNAPSHOTS_STALE_MS = 10 * 60 * 1000;

const snapshotsStale = () => !(state.monthlySnapshots || []).length || Date.now() - snapshotsLoadedAt > SNAPSHOTS_STALE_MS;

export function refreshSessionData({ minAgeMs = 0 } = {}) {
  if (!state || !state.session) return Promise.resolve();
  if (minAgeMs && Date.now() - lastRefreshOkAt < minAgeMs) return refreshInFlight || Promise.resolve();
  if (refreshInFlight) { if (!minAgeMs) refreshQueued = true; return refreshInFlight; }
  const job = runSessionRefresh().finally(() => {
    if (refreshInFlight === job) refreshInFlight = null;
    if (refreshQueued) { refreshQueued = false; refreshSessionData(); }
  });
  refreshInFlight = job;
  return job;
}

function scheduleRefreshRetry() {
  refreshFailStreak += 1;

  if (refreshFailStreak === 4) window.dispatchEvent(new CustomEvent('qtd:refresh-failed'));
  if (refreshFailStreak > 3 || refreshRetryTimer) return;
  refreshRetryTimer = setTimeout(() => { refreshRetryTimer = null; refreshSessionData(); }, 3000 * refreshFailStreak);
}

const sessionFingerprint = () => JSON.stringify([state.admins, state.customers, state.contracts, state.requests, state.pushSubscribedCustomerIds,
  state.zaloCustomers, state.zaloAutoSendList, state.zaloSendLog, state.chatUnreadCount, state.monthlySnapshots]);

async function runSessionRefresh() {
  const session = state.session;
  const fingerprintBefore = sessionFingerprint();
  const active = document.activeElement;
  const isTypingOutsideModal = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) && !active.closest('.modal-overlay');
  const getSelf = () => (session.role === 'admin' ? getAdmin(session.id) : getCustomer(session.id));
  const wasMustChange = !!getSelf()?.mustChangePassword;
  const wasForceLogoutAt = getSelf()?.forceLogoutAt || null;
  let loaded = false;
  try {
    if (session.role === 'admin') {
      loaded = await loadAdminSessionData(session.sbToken, { snapshots: snapshotsStale() });
      if (loaded) await syncHistoricalCollateralOnce(session.sbToken, session.id);
    } else loaded = await loadCustomerSessionData(session.id, session.sbToken);
  } catch (e) {
    console.warn('Không tự làm mới được dữ liệu, sẽ thử lại ở lần sau.', e);
  }
  if (!loaded) { scheduleRefreshRetry(); return; }
  refreshFailStreak = 0;
  if (!wasMustChange && getSelf()?.mustChangePassword) { logout(); return; }

  const nowForceLogoutAt = getSelf()?.forceLogoutAt || null;
  if (nowForceLogoutAt && nowForceLogoutAt !== wasForceLogoutAt) { logout(); return; }
  if (sessionFingerprint() === fingerprintBefore) return;
  if (isTypingOutsideModal) persist();
  else notify();
}

let pendingForceLogoutSignal = null;

function sameInstant(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

export async function checkForceLogout() {
  if (!state || !state.session) { pendingForceLogoutSignal = null; return; }
  const session = state.session;
  const table = session.role === 'admin' ? 'admins' : 'customers';
  const sb = getSupabaseClient(session.sbToken);
  let data;
  try {
    const res = await sb.from(table).select('must_change_password, force_logout_at').eq('id', session.id).maybeSingle();
    data = res.data;
  } catch (e) { return; }
  if (!data) return;
  const getSelf = () => (session.role === 'admin' ? getAdmin(session.id) : getCustomer(session.id));
  const wasMustChange = !!getSelf()?.mustChangePassword;
  const wasForceLogoutAt = getSelf()?.forceLogoutAt || null;
  const nowForceLogoutAt = data.force_logout_at || null;
  const suspicious = (!wasMustChange && data.must_change_password) || (nowForceLogoutAt && !sameInstant(nowForceLogoutAt, wasForceLogoutAt));
  if (!suspicious) { pendingForceLogoutSignal = null; return; }
  const signal = `${session.id}:${!!data.must_change_password}:${nowForceLogoutAt}`;
  if (pendingForceLogoutSignal === signal) { pendingForceLogoutSignal = null; logout(); return; }
  pendingForceLogoutSignal = signal;
}

async function loadAdminSessionData(token, { snapshots = true } = {}) {
  const sb = getSupabaseClient(token);
  const [adminRes, customerRes, contractRes, requestRes, pushRes, zaloCustRes, zaloListRes, zaloLogRes, chatUnreadRes, snapshotRes] = await Promise.all([
    sb.from('admins').select('*'),
    sb.from('customers').select('*'),
    sb.from('contracts').select('*'),
    sb.from('requests').select('*'),

    sb.from('push_subscriptions').select('owner_type, owner_id').eq('owner_type', 'customer').then((r) => r, () => ({ data: [] })),

    sb.from('zalo_customers').select('*').then((r) => r, () => ({ data: [] })),

    sb.from('zalo_auto_send_list').select('*').then((r) => r, () => ({ data: [] })),

    sb.from('zalo_send_log').select('*').gte('sent_at', new Date(Date.now() - 31 * 86400000).toISOString()).order('sent_at', { ascending: false }).limit(1000).then((r) => r, () => ({ data: [] })),

    sb.from('chat_messages').select('id', { count: 'exact', head: true }).eq('sender_role', 'customer').is('read_at', null).then((r) => r, () => ({ count: 0 })),

    snapshots ? sb.from('monthly_snapshots').select('*').order('year_month').then((r) => r, () => ({ data: [] })) : Promise.resolve(null),
  ]);

  const failed = [['admins', adminRes], ['customers', customerRes], ['contracts', contractRes]].filter(([, r]) => !queryOk(r));
  if (failed.length) {
    console.warn('Tải dữ liệu chưa trọn vẹn, giữ nguyên dữ liệu cũ:', failed.map(([t, r]) => `${t} (${r?.error?.message || 'không có dữ liệu'})`).join('; '));
    return false;
  }
  state.admins = adminRes.data.map(mapAdminRow);
  state.customers = customerRes.data.map(mapCustomerRow);
  state.contracts = contractRes.data.map(mapContractRow);
  if (queryOk(requestRes)) state.requests = requestRes.data.map(mapRequestRow);
  if (queryOk(snapshotRes)) { state.monthlySnapshots = snapshotRes.data.map(mapMonthlySnapshotRow); snapshotsLoadedAt = Date.now(); }

  if (queryOk(pushRes)) state.pushSubscribedCustomerIds = [...new Set(pushRes.data.map((r) => r.owner_id))];
  if (queryOk(zaloCustRes)) state.zaloCustomers = zaloCustRes.data.map(mapZaloCustomerRow);
  if (queryOk(zaloListRes)) state.zaloAutoSendList = zaloListRes.data.map(mapZaloAutoSendRow);
  if (queryOk(zaloLogRes)) state.zaloSendLog = zaloLogRes.data.map(mapZaloSendLogRow);
  if (chatUnreadRes && !chatUnreadRes.error) state.chatUnreadCount = chatUnreadRes.count || 0;
  lastRefreshOkAt = Date.now();
  return true;
}

function mapMonthlySnapshotRow(row) {
  return {
    yearMonth: row.year_month, snapshotDate: row.snapshot_date,
    totalBalance: Number(row.total_balance) || 0,
    interestReceivable: Number(row.interest_receivable) || 0,
    groupBalances: row.group_balances || {},
    badDebtBalance: Number(row.bad_debt_balance) || 0,
    badDebtRatio: Number(row.bad_debt_ratio) || 0,

    generalProvision: row.general_provision != null ? Number(row.general_provision) : null,
    specificProvision: row.specific_provision != null ? Number(row.specific_provision) : null,

    contractsDetail: Array.isArray(row.contracts_detail) ? row.contracts_detail : [],
  };
}

export function listMonthlySnapshots() { return state.monthlySnapshots || []; }

export async function captureMonthlySnapshotNow() {
  const session = state.session;
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'capture-monthly-snapshot' });
  if (res.ok) { await loadAdminSessionData(session.sbToken); notify(); }
  return res;
}

function mapZaloCustomerRow(row) {
  return { customerId: row.customer_id, addedBy: row.added_by, addedAt: row.added_at };
}
function mapZaloAutoSendRow(row) {
  return { id: row.id, contractId: row.contract_id, customerId: row.customer_id, kind: row.kind, customDay: row.custom_day, intervalMonths: row.interval_months || 1, createdBy: row.created_by, createdAt: row.created_at };
}

function translateZaloError(msg) {
  if (msg && /account\s+not\s+exist/i.test(msg)) return 'Số điện thoại này chưa đăng ký Zalo';
  return msg;
}
function mapZaloSendLogRow(row) {
  return {
    id: row.id, contractId: row.contract_id, customerId: row.customer_id, kind: row.kind, templateId: row.template_id,
    phone: row.phone, status: row.status, errorMessage: translateZaloError(row.error_message),
    triggeredBy: row.triggered_by, triggeredByAdminId: row.triggered_by_admin_id, sentAt: row.sent_at,
    recipientWho: row.recipient_who === 'main' || row.recipient_who === 'co' ? row.recipient_who : null,
    recipientName: row.recipient_name ? String(row.recipient_name) : '',
  };
}

function mapAdminRow(row) {
  return {
    id: row.id, username: row.username, name: row.name, role: row.role,
    allowedThon: row.allowed_thon || [], allowedXom: row.allowed_xom || [],
    canManageUsers: !!row.can_manage_users,

    canManageZaloOA: !!row.can_manage_zalo_oa,
    canViewBalanceSheet: !!row.can_view_balance_sheet,
    salt: row.salt, hash: row.hash, mustChangePassword: !!row.must_change_password,
    forceLogoutAt: row.force_logout_at || null, createdAt: row.created_at,
  };
}
export function getAdmin(id) { return state.admins.find((a) => a.id === id); }
export function listAdmins() { return state.admins; }
export function isSuperAdmin(id) { return getAdmin(id)?.role === 'super'; }

export function canManageUsers(id) {
  const a = getAdmin(id);
  return !!a && (a.role === 'super' || !!a.canManageUsers);
}

export function canManageZaloOA(id) {
  const a = getAdmin(id);
  return !!a && (a.role === 'super' || !!a.canManageZaloOA);
}
export function canViewBalanceSheet(id) {
  const a = getAdmin(id);
  return !!a && (a.role === 'super' || !!a.canViewBalanceSheet);
}

export async function addStaffAdmin({ username, name, password, role, allowedThon, allowedXom, canManageUsers: canManage, canManageZaloOA: canManageZalo, canViewBalanceSheet: canViewBalance }) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, {
    type: 'staff', username, name, password, role, allowedThon, allowedXom, canManageUsers: !!canManage, canManageZaloOA: !!canManageZalo, canViewBalanceSheet: !!canViewBalance,
  });
  if (!res.ok) throw new Error(res.reason || 'Không tạo được tài khoản.');
  const sb = getSupabaseClient(session.sbToken);
  const { data: row } = await sb.from('admins').select('*').eq('id', res.id).maybeSingle();
  const staff = row ? mapAdminRow(row) : { id: res.id, username };
  const idx = state.admins.findIndex((a) => a.id === staff.id);
  if (idx >= 0) state.admins[idx] = staff; else state.admins.push(staff);
  notify();

  if (canManageZalo && role === 'staff' && !staff.canManageZaloOA) {
    try { await updateStaffPermissions(staff.id, allowedThon, allowedXom, canManage, true, canViewBalance); } catch (e) { console.warn('Chưa đặt được quyền quản lý OA cho tài khoản mới.', e); }
  }
  return { staff: getAdmin(staff.id) || staff, tempPassword: res.tempPassword };
}

export async function updateStaffPermissions(id, allowedThon, allowedXom, canManage, canManageZalo, canViewBalance) {
  const a = getAdmin(id);
  if (!a || a.role !== 'staff') return;
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, {
    type: 'update-staff-permissions', staffId: id, allowedThon, allowedXom,
    canManageUsers: !!canManage, canManageZaloOA: !!canManageZalo, canViewBalanceSheet: !!canViewBalance,
  });
  if (!res.ok) throw new Error(res.reason || 'Không cập nhật được quyền xem.');
  a.allowedThon = Array.isArray(allowedThon) ? allowedThon : [];
  a.allowedXom = Array.isArray(allowedXom) ? allowedXom : [];
  a.canManageUsers = !!canManage;
  a.canManageZaloOA = !!canManageZalo;
  a.canViewBalanceSheet = !!canViewBalance;
  notify();
}

export async function updateStaffRole(id, role) {
  const a = getAdmin(id);
  if (!a) return;
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'update-staff-role', staffId: id, role });
  if (!res.ok) throw new Error(res.reason || 'Không đổi được vai trò.');
  a.role = role;
  notify();
}

export async function updateStaffName(id, name) {
  const a = getAdmin(id);
  if (!a) return;
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Tên không được để trống.');
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'update-staff-name', staffId: id, name: trimmed });
  if (!res.ok) throw new Error(res.reason || 'Không sửa được tên.');
  a.name = trimmed;
  notify();
}

export async function resetStaffPassword(id, customPassword) {
  const a = getAdmin(id);
  if (!a) throw new Error('Không tìm thấy tài khoản');
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'reset-staff-password', staffId: id, password: customPassword });
  if (!res.ok) throw new Error(res.reason || 'Không cấp lại được mật khẩu.');
  a.mustChangePassword = true;
  notify();
  return res.tempPassword;
}

export async function forceLogoutStaff(id) {
  const a = getAdmin(id);
  if (!a) throw new Error('Không tìm thấy tài khoản');
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'force-logout-staff', staffId: id });
  if (!res.ok) throw new Error(res.reason || 'Không đăng xuất được tài khoản này.');
  a.forceLogoutAt = new Date().toISOString();
  notify();
}

export async function verifyAdminPassword(id, password) {
  const session = getSession();
  if (!session || session.id !== id) return false;
  const res = await callCreateAccountFunction(session.sbToken, { type: 'verify-own-password', password });
  return !!(res.ok && res.valid);
}

export async function setStaffPassword(id, newPassword, opts = {}) {
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'set-own-password', newPassword, mustChangePassword: !!opts.mustChangePassword });
  if (!res.ok) throw new Error(res.reason || 'Không đổi được mật khẩu.');
  logUiAction('change-password', 'Tự đổi mật khẩu đăng nhập');
  const a = getAdmin(id);
  if (a) a.mustChangePassword = !!opts.mustChangePassword;
  notify();
}

export async function deleteStaffAdmin(id) {
  const a = getAdmin(id);
  if (!a) return;
  const session = getSession();
  const res = await callCreateAccountFunction(session?.sbToken, { type: 'delete-staff', staffId: id });
  if (!res.ok) throw new Error(res.reason || 'Không xóa được tài khoản.');
  state.admins = state.admins.filter((x) => x.id !== id);
  notify();
}

export function isCustomerLocked(c) { return !!(c.lockedUntil && c.lockedUntil > Date.now()); }

const CUSTOMER_SESSION_HOURS = 24 * 365;

export function hasCustomerLoggedIn(c) {
  if (!c || !c.isOnline) return false;
  if (!c.lastLoginAt) return true;
  return (Date.now() - new Date(c.lastLoginAt).getTime()) < CUSTOMER_SESSION_HOURS * 3600 * 1000;
}

export function hasPushEnabled(customerId) { return !!(state.pushSubscribedCustomerIds && state.pushSubscribedCustomerIds.includes(customerId)); }

export function listRequests(filters = {}) {
  let list = [...state.requests];
  if (filters.customerId) list = list.filter((r) => r.customerId === filters.customerId);
  if (filters.status && filters.status !== 'all') list = list.filter((r) => r.status === filters.status);
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function createRequest({ customerId, type, amount, purpose, termMonths, note }) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const row = {
    id: genId('yc'), customer_id: customerId, type, amount: Number(amount) || 0, purpose: purpose || '',
    term_months: Number(termMonths) || null, note: note || '', status: 'moi',
  };
  const { error } = await sb.from('requests').insert(row);
  if (error) throw new Error('Không gửi được yêu cầu, thử lại sau.');
  const req = mapRequestRow({ ...row, created_at: new Date().toISOString() });
  state.requests.push(req);
  notify();
  return req;
}

export async function updateRequestStatus(id, status) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { error } = await sb.from('requests').update({ status }).eq('id', id);
  if (error) throw new Error('Không cập nhật được trạng thái, thử lại sau.');
  const r = state.requests.find((x) => x.id === id);
  if (r) r.status = status;
  notify();
  logAdminAction('update-request-status', { requestId: id });
}
function mapRequestRow(row) {
  return {
    id: row.id, customerId: row.customer_id, type: row.type, amount: row.amount,
    purpose: row.purpose || '', termMonths: row.term_months, note: row.note || '',
    status: row.status, createdAt: row.created_at, readAt: row.read_at || null,
  };
}

export function countUnreadRequests(adminId) {

  let list = state.requests.filter((r) => !r.readAt && r.status !== 'da_lien_he');
  const admin = getAdmin(adminId);
  if (admin && admin.role === 'staff') {
    const allowedIds = new Set(listCustomers({ adminId }).map((c) => c.id));
    list = list.filter((r) => allowedIds.has(r.customerId));
  }
  return list.length;
}

export async function markAllRequestsRead(adminId) {
  let unread = state.requests.filter((r) => !r.readAt && r.status !== 'da_lien_he');
  const admin = getAdmin(adminId);
  if (admin && admin.role === 'staff') {
    const allowedIds = new Set(listCustomers({ adminId }).map((c) => c.id));
    unread = unread.filter((r) => allowedIds.has(r.customerId));
  }
  if (!unread.length) return;
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { error } = await sb.from('requests').update({ read_at: new Date().toISOString() }).in('id', unread.map((r) => r.id));
  if (error) return;
  const now = new Date().toISOString();
  unread.forEach((r) => { r.readAt = now; });
  notify();
}

function mapChatMessageRow(row) {
  return {
    id: row.id, customerId: row.customer_id, senderRole: row.sender_role,
    senderAdminId: row.sender_admin_id || null, message: row.message,
    createdAt: row.created_at, readAt: row.read_at || null,
  };
}

export async function listChatMessages(customerId) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { data, error } = await sb.from('chat_messages').select('*').eq('customer_id', customerId).order('created_at', { ascending: true });
  if (error) throw new Error('Không tải được tin nhắn, thử lại sau.');
  return (data || []).map(mapChatMessageRow);
}

export async function sendChatMessage(customerId, message) {
  const session = getSession();
  const text = String(message || '').trim();
  if (!text) throw new Error('Chưa nhập nội dung.');
  const sb = getSupabaseClient(session?.sbToken);
  const row = {
    id: genId('chat'), customer_id: customerId,
    sender_role: session.role === 'admin' ? 'admin' : 'customer',
    sender_admin_id: session.role === 'admin' ? session.id : null,
    message: text,
  };
  const { error } = await sb.from('chat_messages').insert(row);
  if (error) throw new Error('Không gửi được tin nhắn, thử lại sau.');
  logAdminAction('reply-chat', { customerId });
  return mapChatMessageRow({ ...row, created_at: new Date().toISOString(), read_at: null });
}

export async function markChatRead(customerId) {
  const session = getSession();
  if (!session) return;
  const otherRole = session.role === 'admin' ? 'customer' : 'admin';
  const sb = getSupabaseClient(session.sbToken);
  const { data } = await sb.from('chat_messages').update({ read_at: new Date().toISOString() })
    .eq('customer_id', customerId).eq('sender_role', otherRole).is('read_at', null)
    .select('id');
  if (!data || !data.length) return;
  state.chatUnreadCount = Math.max(0, (state.chatUnreadCount || 0) - data.length);
  notify();
}

export async function listChatConversations() {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { data, error } = await sb.from('chat_messages').select('customer_id, sender_role, message, created_at, read_at').order('created_at', { ascending: false }).limit(500);
  if (error) throw new Error('Không tải được danh sách hội thoại, thử lại sau.');
  const map = new Map();
  for (const row of (data || [])) {
    const m = mapChatMessageRow(row);
    let conv = map.get(m.customerId);
    if (!conv) {

      conv = { customerId: m.customerId, lastMessage: m.message, lastAt: m.createdAt, lastSenderRole: m.senderRole, unreadCount: 0 };
      map.set(m.customerId, conv);
    }
    if (m.senderRole === 'customer' && !m.readAt) conv.unreadCount++;
  }
  return [...map.values()].sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
}

function mapActivityLogRow(row) {
  return {
    id: row.id, adminId: row.admin_id, adminName: row.admin_name,
    action: row.action, description: row.description, createdAt: row.created_at,
  };
}

export async function listActivityLog({ before, limit = 100 } = {}) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  let q = sb.from('activity_log').select('*').order('created_at', { ascending: false }).limit(limit);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) throw new Error('Không tải được nhật ký, thử lại sau.');
  return (data || []).map(mapActivityLogRow);
}

function mapCallLogRow(row) {
  return { id: row.id, customerId: row.customer_id, adminId: row.admin_id, adminName: row.admin_name, phone: row.phone || '', callee: row.callee === 'co' ? 'co' : 'main', createdAt: row.created_at };
}

export function listCallsByCustomer(customerId) {
  return (state.callLogs || []).filter((c) => c.customerId === customerId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function loadCallsForCustomer(customerId) {
  const session = getSession();
  if (!session || session.role !== 'admin') return false;
  try {
    const sb = getSupabaseClient(session.sbToken);
    const { data, error } = await sb.from('call_log').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(300);
    if (error) return false;
    const fromServer = (data || []).map(mapCallLogRow);
    const known = new Set(fromServer.map((c) => c.id));
    const fresh = (state.callLogs || []).filter((c) => c.customerId === customerId && !known.has(c.id) && Date.now() - new Date(c.createdAt).getTime() < 120000);
    state.callLogs = (state.callLogs || []).filter((c) => c.customerId !== customerId).concat(fromServer, fresh);
    return true;
  } catch { return false; }
}

export function logCall(customerId, phone, callee = 'main', coName = '') {
  const session = getSession();
  if (!session || session.role !== 'admin') return null;
  const admin = getAdmin(session.id);
  const row = { id: genId('call'), customer_id: customerId, admin_id: session.id, admin_name: (admin && admin.name) || 'Quản trị viên', phone: String(phone || ''), ...(callee === 'co' ? { callee: 'co' } : {}) };
  const entry = mapCallLogRow({ ...row, created_at: new Date().toISOString() });
  (state.callLogs = state.callLogs || []).push(entry);
  logAdminAction('call-customer', { customerId, ...(callee === 'co' ? { callee: 'co', coName: String(coName || '') } : {}) });
  try { getSupabaseClient(session.sbToken).from('call_log').insert(row).then(() => {}, () => {}); } catch {  }
  return entry;
}

function mapNoteRow(row) {
  return {
    id: row.id, customerId: row.customer_id, contractId: row.contract_id || null, text: row.body || '',
    kind: row.kind || 'none', afterDays: row.after_days ?? null, monthlyDay: row.monthly_day ?? null,
    remindOn: row.remind_on || null, amount: row.amount == null ? null : Number(row.amount),
    visibility: row.visibility === 'me' ? 'me' : 'all', status: row.status === 'done' ? 'done' : 'open',
    createdBy: row.created_by || null, createdByName: row.created_by_name || '', createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at, doneBy: row.done_by || null, doneByName: row.done_by_name || '', doneAt: row.done_at || null,
  };
}

function mapNoteLogRow(row) {
  return { id: row.id, noteId: row.note_id, customerId: row.customer_id, contractId: row.contract_id || null, action: row.action, text: row.body || '', dueOn: row.due_on || null, amount: row.amount == null ? null : Number(row.amount), byId: row.by_id || null, byName: row.by_name || '', createdAt: row.created_at };
}

function noteFailure(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || '');
  if (code === '42P01' || code === 'PGRST205' || /customer_notes|customer_note_log/.test(msg)) return { ok: false, reason: 'Chưa tạo bảng ghi chú trên máy chủ. Cần chạy SQL ghi chú (docs mục 10.92).' };
  return { ok: false, reason: 'Không lưu được ghi chú, thử lại.' };
}

function adminSeesCustomer(adminId, customerId) {
  const c = getCustomer(customerId);
  const a = getAdmin(adminId);
  if (!c || !a) return false;
  if (a.role !== 'staff') return true;
  return (a.allowedThon || []).includes(c.thon) || (a.allowedXom || []).includes(xomKey(c.thon, c.xom));
}

function noteVisible(n, sessionId) { return n.visibility === 'all' || n.createdBy === sessionId; }

export function noteView(n) {
  if (n.status === 'open' && n.contractId) {
    const ct = getContract(n.contractId);
    if (ct && effectiveContractStatus(ct) === 'da_tat_toan') return { ...n, remindOn: null, kind: 'none', settled: true };
  }
  return n;
}

export function listNotesByCustomer(customerId) {
  const sid = state.session?.id;
  return (state.customerNotes || []).filter((n) => n.customerId === customerId && noteVisible(n, sid)).map(noteView);
}

export function listNoteLogByCustomer(customerId) {
  const sid = state.session?.id;
  const visible = new Set((state.customerNotes || []).filter((n) => n.customerId === customerId && noteVisible(n, sid)).map((n) => n.id));
  return (state.customerNoteLog || []).filter((l) => l.customerId === customerId && visible.has(l.noteId)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function listDueNotes(today = todayIso()) {
  const session = state.session;
  if (!session || session.role !== 'admin') return [];
  return (state.customerNotes || [])
    .filter((n) => n.status === 'open' && noteVisible(n, session.id) && adminSeesCustomer(session.id, n.customerId))
    .map(noteView)
    .filter((n) => isDue(n, today));
}

export async function loadNotesForCustomer(customerId) {
  const session = getSession();
  if (!session || session.role !== 'admin') return false;
  try {
    const sb = getSupabaseClient(session.sbToken);
    const [notes, logs] = await Promise.all([
      sb.from('customer_notes').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(300),
      sb.from('customer_note_log').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(100),
    ]);
    if (notes.error) return false;
    state.customerNotes = (state.customerNotes || []).filter((n) => n.customerId !== customerId).concat((notes.data || []).map(mapNoteRow));
    notesRev += 1;
    if (!logs.error) state.customerNoteLog = (state.customerNoteLog || []).filter((l) => l.customerId !== customerId).concat((logs.data || []).map(mapNoteLogRow));
    return true;
  } catch { return false; }
}

let openNotesLoadedAt = 0;
let openNotesInflight = null;
let notesRev = 0;
let dueMapCache = { key: '', map: new Map() };

export function loadOpenNotes({ force = false } = {}) {
  const session = getSession();
  if (!session || session.role !== 'admin') return Promise.resolve(false);
  if (openNotesInflight) return openNotesInflight;
  if (!force && Date.now() - openNotesLoadedAt < 8000) return Promise.resolve(false);
  openNotesLoadedAt = Date.now();
  openNotesInflight = (async () => {
    try {
      const sb = getSupabaseClient(session.sbToken);
      const { data, error } = await sb.from('customer_notes').select('*').eq('status', 'open').order('remind_on', { ascending: true, nullsFirst: false }).limit(2000);
      if (error) return false;
      const fresh = (data || []).map(mapNoteRow);
      const ids = new Set(fresh.map((n) => n.id));
      state.customerNotes = (state.customerNotes || []).filter((n) => n.status === 'done' && !ids.has(n.id)).concat(fresh);
      notesRev += 1;
      return true;
    } catch { return false; }
  })().finally(() => { openNotesInflight = null; });
  return openNotesInflight;
}

export function dueNoteCounts(today = todayIso()) {
  const key = `${notesRev}|${today}|${state.session?.id || ''}|${(state.customerNotes || []).length}`;
  if (dueMapCache.key !== key) {
    const map = new Map();
    for (const n of listDueNotes(today)) map.set(n.customerId, (map.get(n.customerId) || 0) + 1);
    dueMapCache = { key, map };
  }
  return dueMapCache.map;
}

export async function saveNote(draft, id = null) {
  const session = getSession();
  if (!session || session.role !== 'admin') return { ok: false, reason: 'Chỉ quản trị viên được ghi chú.' };
  const v = validateDraft(draft);
  if (!v.ok) return v;
  const customer = getCustomer(draft.customerId);
  if (!customer || !adminSeesCustomer(session.id, customer.id)) return { ok: false, reason: 'Không tìm thấy khách hàng.' };
  const { clean } = v;
  const today = todayIso();
  const admin = getAdmin(session.id);
  const nowIso = new Date().toISOString();
  const sb = getSupabaseClient(session.sbToken);
  const plan = { kind: clean.kind, afterDays: clean.afterDays, monthlyDay: clean.monthlyDay, date: clean.date };
  try {
    if (!id) {
      const row = {
        id: genId('nt'), customer_id: customer.id, contract_id: clean.contractId, body: clean.text, kind: clean.kind,
        after_days: clean.afterDays, monthly_day: clean.monthlyDay, remind_on: firstRemindOn(plan, today), amount: clean.amount,
        visibility: clean.visibility, status: 'open', created_by: session.id, created_by_name: (admin && admin.name) || 'Quản trị viên',
      };
      const { error } = await sb.from('customer_notes').insert(row);
      if (error) return noteFailure(error);
      const note = mapNoteRow({ ...row, created_at: nowIso, updated_at: nowIso });
      (state.customerNotes = state.customerNotes || []).push(note);
      notesRev += 1;
      notify();
      logUiAction('note-add', `Thêm ghi chú nhắc việc cho khách hàng "${customer.name}"`);
      return { ok: true, note };
    }
    const old = (state.customerNotes || []).find((n) => n.id === id);
    if (!old) return { ok: false, reason: 'Không tìm thấy ghi chú.' };
    const patch = {
      contract_id: clean.contractId, body: clean.text, kind: clean.kind, after_days: clean.afterDays, monthly_day: clean.monthlyDay,
      remind_on: planChanged(old, clean) ? firstRemindOn(plan, today) : old.remindOn, amount: clean.amount, visibility: clean.visibility, updated_at: nowIso,
    };
    const { data, error } = await sb.from('customer_notes').update(patch).eq('id', id).select('id');
    if (error) return noteFailure(error);
    if (!data || !data.length) return { ok: false, reason: 'Bạn không có quyền sửa ghi chú này.' };
    Object.assign(old, mapNoteRow({ ...noteToRowShape(old), ...patch }));
    notesRev += 1;
    notify();
    logUiAction('note-edit', `Sửa ghi chú nhắc việc của khách hàng "${customer.name}"`);
    return { ok: true, note: old };
  } catch { return { ok: false, reason: 'Không lưu được ghi chú, thử lại.' }; }
}

function noteToRowShape(n) {
  return {
    id: n.id, customer_id: n.customerId, contract_id: n.contractId, body: n.text, kind: n.kind, after_days: n.afterDays, monthly_day: n.monthlyDay,
    remind_on: n.remindOn, amount: n.amount, visibility: n.visibility, status: n.status, created_by: n.createdBy, created_by_name: n.createdByName,
    created_at: n.createdAt, updated_at: n.updatedAt, done_by: n.doneBy, done_by_name: n.doneByName, done_at: n.doneAt,
  };
}

async function writeNoteEvent(note, action, patch, logExtra = {}) {
  const session = getSession();
  if (!session || session.role !== 'admin') return { ok: false, reason: 'Chỉ quản trị viên được thao tác.' };
  const admin = getAdmin(session.id);
  const sb = getSupabaseClient(session.sbToken);
  const nowIso = new Date().toISOString();
  try {
    const { data, error } = await sb.from('customer_notes').update({ ...patch, updated_at: nowIso }).eq('id', note.id).select('id');
    if (error) return noteFailure(error);
    if (!data || !data.length) return { ok: false, reason: 'Bạn không có quyền thao tác ghi chú này.' };
    const logRow = { id: genId('nl'), note_id: note.id, customer_id: note.customerId, contract_id: note.contractId, action, body: note.text, due_on: note.remindOn, amount: note.amount, by_id: session.id, by_name: (admin && admin.name) || 'Quản trị viên', ...logExtra };
    Object.assign(note, mapNoteRow({ ...noteToRowShape(note), ...patch, updated_at: nowIso }));
    (state.customerNoteLog = state.customerNoteLog || []).push(mapNoteLogRow({ ...logRow, created_at: nowIso }));
    notesRev += 1;
    notify();
    sb.from('customer_note_log').insert(logRow).then(() => {}, () => {});
    return { ok: true, note };
  } catch { return { ok: false, reason: 'Không lưu được, thử lại.' }; }
}

export async function completeNote(id) {
  const note = (state.customerNotes || []).find((n) => n.id === id);
  if (!note || note.status !== 'open' || !note.remindOn) return { ok: false, reason: 'Không tìm thấy việc cần làm.' };
  const session = getSession();
  const admin = session ? getAdmin(session.id) : null;
  const next = nextAfterDone(note, todayIso());
  const nowIso = new Date().toISOString();
  const patch = next ? { remind_on: next } : { status: 'done', done_by: session?.id || null, done_by_name: (admin && admin.name) || 'Quản trị viên', done_at: nowIso };
  const res = await writeNoteEvent(note, 'done', patch);
  if (res.ok) logUiAction('note-done', `Hoàn thành nhắc việc của khách hàng "${getCustomer(note.customerId)?.name || ''}"`);
  return res;
}

export async function snoozeNote(id, days) {
  const note = (state.customerNotes || []).find((n) => n.id === id);
  const n = Number(days);
  if (!note || note.status !== 'open' || !Number.isInteger(n) || n < 1 || n > 365) return { ok: false, reason: 'Không hoãn được.' };
  const res = await writeNoteEvent(note, 'snooze', { remind_on: addDaysIso(todayIso(), n) });
  if (res.ok) logUiAction('note-snooze', `Hoãn nhắc việc ${n} ngày của khách hàng "${getCustomer(note.customerId)?.name || ''}"`);
  return res;
}

export async function deleteNote(id) {
  const session = getSession();
  const note = (state.customerNotes || []).find((n) => n.id === id);
  if (!session || session.role !== 'admin' || !note) return { ok: false, reason: 'Không tìm thấy ghi chú.' };
  try {
    const { data, error } = await getSupabaseClient(session.sbToken).from('customer_notes').delete().eq('id', id).select('id');
    if (error) return noteFailure(error);
    if (!data || !data.length) return { ok: false, reason: 'Chỉ người tạo hoặc quản trị toàn quyền được xóa ghi chú.' };
    state.customerNotes = state.customerNotes.filter((n) => n.id !== id);
    state.customerNoteLog = (state.customerNoteLog || []).filter((l) => l.noteId !== id);
    notesRev += 1;
    notify();
    logUiAction('note-delete', `Xóa ghi chú nhắc việc của khách hàng "${getCustomer(note.customerId)?.name || ''}"`);
    return { ok: true };
  } catch { return { ok: false, reason: 'Không xóa được, thử lại.' }; }
}

export function logAdminAction(action, extra = {}) {
  const session = getSession();
  if (!session || session.role !== 'admin') return;
  callCreateAccountFunction(session.sbToken, { type: 'log-admin-action', action, ...extra }).catch(() => {});
}

export function logUiAction(kind, label) {
  logAdminAction('ui-action', { kind, label });
}

export function getSession() { return state.session; }
export function setSession(session) { state.session = session; notify(); }

export function logout() {
  const session = state.session;
  if (session && session.role === 'admin') logUiAction('logout', 'Đăng xuất khỏi hệ thống');
  if (session && session.role === 'customer') {
    callCreateAccountFunction(session.sbToken, { type: 'customer-logout' }).catch(() => {});
  }
  state.session = null;
  lastSendFromServer.clear();
  dropAutoStatusCache();
  lastRefreshOkAt = 0;
  refreshFailStreak = 0;
  clearTimeout(refreshRetryTimer); refreshRetryTimer = null;
  clearDeviceCaches().catch(() => {});
  notify();
}

async function seedDemoData() {
  const rng = mulberry32(7717);
  const org = {
    name: 'Quỹ Tín Dụng Nhân Dân Bình Nguyên',
    shortName: 'QTD Bình Nguyên',
    hotline: '1900 000 000',
    address: '01 Đường Mẫu, Phường Trung Tâm, Tỉnh Demo',
    bannerEnabled: true,
    bannerTitle: 'Ưu đãi lãi suất vay tiêu dùng',
    bannerText: 'Liên hệ quầy giao dịch hoặc gửi yêu cầu tư vấn ngay trên ứng dụng để được hỗ trợ.',

    ...BANK_INFO,
  };

  const adminCred = await makeCredential('Admin@123');
  const staffCred = await makeCredential('Staff@123');
  const admins = [
    { id: 'admin_1', username: 'admin', name: 'Quản trị viên', role: 'super', allowedThon: [], allowedXom: [], ...adminCred },
    { id: 'staff_1', username: 'nhanvien1', name: 'Nhân viên địa bàn Thôn 1', role: 'staff', allowedThon: ['Thôn 1'], allowedXom: [], ...staffCred, createdAt: new Date().toISOString() },
  ];

  const demoDefs = [
    ['079300012345', 'Trần Văn Mẫu', '0901 000 001', 'Xóm A, Thôn 1, Tỉnh Demo'],
    ['079300012346', 'Nguyễn Thị Mẫu', '0901 000 002', 'Xóm B, Thôn 1, Tỉnh Demo'],
    ['079300012347', 'Lê Văn Ví Dụ', '0901 000 003', 'Xóm A, Thôn 2, Tỉnh Demo'],
    ['079300012348', 'Phạm Thị Ví Dụ', '0901 000 004', 'Xóm B, Thôn 2, Tỉnh Demo'],
  ];
  const customers = [];
  for (const [cccd, name, phone, address] of demoDefs) {
    const temp = 'Demo@123';
    const cred = await makeCredential(temp);
    customers.push({
      id: genId('cust'), cccd, name, phone, address, ...parseAddress(address),
      ...cred, mustChangePassword: true, tempPassword: temp,
      failedAttempts: 0, lockedUntil: null, createdAt: new Date().toISOString(),
    });
  }

  const contracts = [];
  const now = new Date();
  customers.forEach((c, i) => {
    const nContracts = i === 0 ? 2 : 1;
    for (let k = 0; k < nContracts; k++) {
      const principal = randInt(rng, 20, 150) * 1_000_000;
      const disbursed = addDays(now, -randInt(rng, 30, 400));
      const due = addDays(disbursed, randInt(rng, 6, 24) * 30);

      const isPastDue = due < now;
      const status = isPastDue
        ? (rng() < 0.65 ? 'qua_han' : 'da_tat_toan')
        : (rng() < 0.85 ? 'dang_vay' : 'da_tat_toan');
      contracts.push({
        id: genId('hd'), customerId: c.id,
        code: `HD${2026}${String(1000 + contracts.length)}`,
        principal, disbursedDate: disbursed.toISOString().slice(0, 10),
        dueDate: due.toISOString().slice(0, 10),
        interestRate: [8.5, 9.2, 10.0][randInt(rng, 0, 2)],
        balance: status === 'da_tat_toan' ? 0 : Math.round((principal * (0.3 + rng() * 0.7)) / 100000) * 100000,
        status,

        interestPaidUntil: (() => {
          const lastPaid = addDays(now, -randInt(rng, 0, 45));
          return (lastPaid < disbursed ? disbursed : lastPaid).toISOString().slice(0, 10);
        })(),
      });
    }
  });

  const requests = [
    {
      id: genId('yc'), customerId: customers[1].id, type: 'vay_moi', amount: 50_000_000,
      purpose: 'Bổ sung vốn kinh doanh', termMonths: 12, note: '',
      status: 'moi', createdAt: addDays(now, -1).toISOString(),
    },
    {
      id: genId('yc'), customerId: customers[2].id, type: 'tu_van', amount: 0,
      purpose: 'Hỏi về lãi suất tất toán trước hạn', termMonths: null, note: 'Muốn tất toán hợp đồng HD20261000',
      status: 'dang_xu_ly', createdAt: addDays(now, -3).toISOString(),
    },
  ];

  state = { org, admins, customers, contracts, requests, session: null, pushSubscribedCustomerIds: [], zaloCustomers: [], zaloAutoSendList: [], zaloAutoOverview: [], zaloSendLog: [], callLogs: [], customerNotes: [], customerNoteLog: [], chatUnreadCount: 0 };
}
