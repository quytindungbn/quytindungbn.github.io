import { createClient } from 'npm:@supabase/supabase-js@2';
// @ts-ignore
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('CUSTOM_JWT_SECRET')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const ZALO_APP_ID = Deno.env.get('ZALO_APP_ID') || '';
const ZALO_SECRET_KEY = Deno.env.get('ZALO_SECRET_KEY') || '';

const LOCK_AFTER_FAILS = 5;
const LOCK_MINUTES = 15;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes: number): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function genTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const arr = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(arr).map((b) => chars[b % chars.length]).join('');
}
async function makeCredential(plainPassword: string): Promise<{ salt: string; hash: string }> {
  const salt = randomHex(8);
  const hash = await sha256Hex(salt + ':' + plainPassword);
  return { salt, hash };
}
async function verifyCredential(password: string, salt: string, hash: string): Promise<boolean> {
  return (await sha256Hex(salt + ':' + password)) === hash;
}
function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const REQUEST_STATUS_LABELS: Record<string, string> = { moi: 'Mới', dang_xu_ly: 'Đang xử lý', da_lien_he: 'Đã liên hệ' };

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}
function addDaysISO(iso: string, n: number): string {
  const dt = new Date(iso);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
}

async function logActivity(adminId: string, adminName: string, adminUsername: string, action: string, description: string): Promise<void> {
  if (String(adminUsername || '').trim().toLowerCase() === 'admin') return;
  try {
    await admin.from('activity_log').insert({ id: genId('log'), admin_id: adminId, admin_name: adminName, action, description });
  } catch (e) {
    console.error('Lỗi ghi activity_log:', e);
  }
}

function parseAddress(raw: string) {
  const text = String(raw || '').trim();
  const withoutNote = text.replace(/\([^)]*\)/g, '');
  const parts = withoutNote.split(',').map((s) => s.trim()).filter(Boolean);
  const result = { xom: '', thon: '', xa: '', tinh: '' } as Record<string, string>;
  const rest: string[] = [];
  let currentField: string | null = null;
  for (const p of parts) {
    const low = p.toLowerCase();
    let field: string | null = null;
    if (low.startsWith('xóm') || low.startsWith('xom')) field = 'xom';
    else if (low.startsWith('thôn') || low.startsWith('thon')) field = 'thon';
    else if (low.startsWith('xã') || low.startsWith('xa ') || low.startsWith('phường') || low.startsWith('thị trấn') || low.startsWith('huyện')) field = 'xa';
    else if (low.startsWith('tỉnh') || low.startsWith('tp') || low.startsWith('thành phố')) field = 'tinh';

    if (field) { result[field] = p; currentField = field; }
    else if (currentField) result[currentField] += ', ' + p;
    else rest.push(p);
  }
  if (!result.tinh && parts.length) result.tinh = parts[parts.length - 1];
  if (!result.xa && rest.length) result.xa = rest.shift()!;
  if (!result.thon && parts.length >= 2) result.thon = parts[1];
  if (!result.xom && parts.length >= 1) result.xom = parts[0];
  return result;
}

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));
  const toSign = `${encHeader}.${encPayload}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(toSign));
  return `${toSign}.${base64url(new Uint8Array(sigBuf))}`;
}
async function verifyJwt(token: string): Promise<Record<string, any> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encHeader, encPayload, encSig] = parts;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('HMAC', key, base64urlDecode(encSig), new TextEncoder().encode(`${encHeader}.${encPayload}`));
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(encPayload)));

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function daysBetweenZalo(a: Date, b: Date): number {
  const sa = new Date(a); sa.setHours(0, 0, 0, 0);
  const sb = new Date(b); sb.setHours(0, 0, 0, 0);
  return Math.round((sb.getTime() - sa.getTime()) / 86400000);
}
function effectiveStatusZalo(contract: any, asOf: Date): 'da_tat_toan' | 'qua_han' | 'dang_vay' {
  if ((contract.balance || 0) <= 0) return 'da_tat_toan';
  if (daysBetweenZalo(new Date(contract.due_date), asOf) > 0) return 'qua_han';
  return 'dang_vay';
}

const DEFAULT_NEAR_DUE_DAYS_ZALO = 15;

function isNearOrPastDueZalo(contract: any, asOf: Date, nearDueDays: number): boolean {
  const d = daysBetweenZalo(asOf, new Date(contract.due_date));
  if (d <= nearDueDays) return true;
  const inst = nextInstallmentInfoZalo(contract, asOf);
  return inst != null && inst.next.daysLeft <= nearDueDays;
}

function withYearZalo(date: Date, year: number): Date {
  const month = date.getMonth();
  const day = date.getDate();
  const d = new Date(year, month, day);
  if (d.getMonth() !== month) d.setDate(0);
  return d;
}

function toLocalISODateZalo(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function restoreLeadingInstallment(
  entries: { year: number; amount: number; restored?: boolean }[],
  info: { principal: number; balance: number; disbursedYear: number },
): { year: number; amount: number; restored?: boolean }[] {
  if (!entries.length || !Number.isFinite(info.disbursedYear)) return entries;
  const amountPaid = (Number(info.principal) || 0) - (Number(info.balance) || 0);
  const missing = (Number(info.principal) || 0) - entries.reduce((sum, e) => sum + e.amount, 0);
  if (entries[0].year === info.disbursedYear + 2 && missing > 0 && missing <= amountPaid) {
    return [{ year: info.disbursedYear + 1, amount: missing, restored: true }, ...entries];
  }
  return entries;
}

function mergeInstallmentSchedule(existing: any, incoming: Record<string, number>): Record<string, number> | null {
  const years = Object.keys(incoming || {}).map(Number).filter(Number.isFinite);
  if (!years.length) return existing || null;
  const firstYear = Math.min(...years);
  const merged: Record<string, number> = {};
  for (const [year, amount] of Object.entries(existing || {})) {
    if (Number(year) < firstYear && Number(amount) > 0) merged[year] = Number(amount);
  }
  for (const [year, amount] of Object.entries(incoming)) merged[year] = amount;
  return merged;
}

type InstallmentEntryZalo = { year: number; dueDate: string; amount: number; dueAmount: number; daysLeft: number };

function computeInstallmentPlanZalo(contract: any, asOf: Date): InstallmentEntryZalo[] | null {
  const schedule = contract.installment_schedule;
  if (!schedule) return null;
  const stored = Object.entries(schedule as Record<string, any>)
    .map(([year, amount]) => ({ year: Number(year), amount: Number(amount) }))
    .filter((e) => Number.isFinite(e.year) && e.amount > 0)
    .sort((a, b) => a.year - b.year);
  if (stored.length < 2) return null;

  const disbursed = new Date(contract.disbursed_date);
  const balance = Number(contract.balance) || 0;
  const amountPaid = (Number(contract.principal) || 0) - balance;
  const entries = restoreLeadingInstallment(stored, { principal: Number(contract.principal) || 0, balance, disbursedYear: Number(String(contract.disbursed_date || '').slice(0, 4)) });
  const sumBeforeLast = entries.slice(0, -1).reduce((s, e) => s + e.amount, 0);
  let cumulativeRequired = 0;
  return entries.map((e, idx) => {
    cumulativeRequired += e.amount;
    const isLast = idx === entries.length - 1;
    const dueDate = withYearZalo(disbursed, e.year);
    const daysLeft = daysBetweenZalo(asOf, dueDate);

    let dueAmount: number;
    if (isLast) {
      dueAmount = amountPaid > sumBeforeLast ? balance : e.amount;
    } else {
      const requiredBeforeThis = cumulativeRequired - e.amount;
      const coveredForThis = Math.max(0, amountPaid - requiredBeforeThis);
      dueAmount = Math.max(0, e.amount - coveredForThis);
    }

    return { year: e.year, dueDate: toLocalISODateZalo(dueDate), amount: e.amount, dueAmount, daysLeft };
  });
}

function nextInstallmentInfoZalo(contract: any, asOf: Date): { idx: number; next: InstallmentEntryZalo } | null {
  const plan = computeInstallmentPlanZalo(contract, asOf);
  if (!plan) return null;
  const idx = plan.findIndex((p) => p.dueAmount > 0);
  if (idx < 0) return null;
  return { idx, next: plan[idx] };
}
function interestDaysRawZalo(contract: any, asOf: Date): number {
  const paidUntil = contract.interest_paid_until || contract.disbursed_date;
  let days = daysBetweenZalo(new Date(paidUntil), asOf);
  if (contract.disbursed_date && daysBetweenZalo(new Date(contract.disbursed_date), new Date(paidUntil)) === 1) days += 1;
  return days;
}
function interestDaysAccruedZalo(contract: any, asOf: Date): number {
  return Math.max(0, interestDaysRawZalo(contract, asOf));
}

function interestRoundedToThousand(balance: number | string, days: number, annualRate: number | string): number {
  if (![balance, days, annualRate].every(v => Number.isFinite(Number(v)))) {
    throw new Error('Du lieu tinh lai khong hop le');
  }
  if (!Number.isSafeInteger(Number(days)) || Number(days) < 0) {
    throw new Error('So ngay tinh lai khong hop le');
  }
  if (Number(balance) <= 0 || Number(annualRate) <= 0 || Number(days) === 0) return 0;
  function fraction(value: number | string): [bigint, bigint] {
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

function accruedInterestZalo(contract: any, asOf: Date): number {
  if (effectiveStatusZalo(contract, asOf) === 'da_tat_toan') return 0;
  const days = interestDaysAccruedZalo(contract, asOf);
  return interestRoundedToThousand(contract.balance, days, contract.interest_rate);
}

function daysOverdueZalo(contract: any, asOf: Date): number | null {
  if ((Number(contract.balance) || 0) <= 0) return null;
  const mainOverdue = daysBetweenZalo(new Date(contract.due_date), asOf);
  const inst = nextInstallmentInfoZalo(contract, asOf);
  const instOverdue = inst ? -inst.next.daysLeft : -Infinity;
  return Math.max(0, mainOverdue, instOverdue);
}

const WIDE_NEAR_DUE_DAYS_ATTENTION = 45;

function contractAttentionZalo(contract: any, asOf: Date): { level: 'qua_han' | 'gan_den_han' | null; days: number; dueAmount: number } {
  const balance = Number(contract.balance) || 0;
  if (balance <= 0) return { level: null, days: 0, dueAmount: 0 };
  const d = daysBetweenZalo(asOf, new Date(contract.due_date));
  const contractLevel = d < 0 ? 'qua_han' : (d <= WIDE_NEAR_DUE_DAYS_ATTENTION ? 'gan_den_han' : null);
  const inst = nextInstallmentInfoZalo(contract, asOf);
  const instDays = inst ? inst.next.daysLeft : null;
  const instLevel = inst ? (instDays! < 0 ? 'qua_han' : (instDays! <= WIDE_NEAR_DUE_DAYS_ATTENTION ? 'gan_den_han' : null)) : null;
  const overdue: { days: number; amount: number }[] = [];
  if (contractLevel === 'qua_han') overdue.push({ days: Math.abs(d), amount: balance });
  if (instLevel === 'qua_han') overdue.push({ days: Math.abs(instDays!), amount: inst!.next.dueAmount });
  if (overdue.length) {
    const worst = overdue.reduce((a, b) => (b.days > a.days ? b : a));
    return { level: 'qua_han', days: worst.days, dueAmount: worst.amount };
  }
  const near: { days: number; amount: number }[] = [];
  if (contractLevel === 'gan_den_han') near.push({ days: d, amount: balance });
  if (instLevel === 'gan_den_han') near.push({ days: instDays!, amount: inst!.next.dueAmount });
  if (near.length) {
    const soonest = near.reduce((a, b) => (b.days < a.days ? b : a));
    return { level: 'gan_den_han', days: soonest.days, dueAmount: soonest.amount };
  }
  return { level: null, days: 0, dueAmount: balance };
}

function debtGroupZalo(contract: any, asOf: Date): number | null {
  const d = daysOverdueZalo(contract, asOf);
  if (d === null) return null;
  if (d < 10) return 1;
  if (d <= 90) return 2;
  if (d <= 180) return 3;
  if (d <= 360) return 4;
  return 5;
}

const PROVISION_SPECIFIC_RATE: Record<number, number> = { 2: 0.05, 3: 0.2, 4: 0.5, 5: 1 };

const PROVISION_GENERAL_RATE = 0.0075;

function collateralDeductionRate(ct: any): number {
  if (!ct.has_collateral) return 0;
  const type = String(ct.collateral_type || '').trim().toUpperCase();
  if (type === '01' || type === '02') return 0.5;
  if (type === '04') return 0.3;
  if (type === '06') return 1;
  return 0;
}

async function syncHistoricalCollateral(admin: any): Promise<{ updated: number; error?: string }> {
  const readAll = async (table: string, columns: string) => {
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from(table).select(columns).order(table === 'contracts' ? 'id' : 'year_month').range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if ((data || []).length < 1000) return rows;
    }
  };
  try {
    const contracts = await readAll('contracts', 'id, code, has_collateral, collateral_type, collateral_value');
    const snapshots = await readAll('monthly_snapshots', 'year_month, total_balance, contracts_detail');
    const byCode = new Map<string, any>(), duplicateCodes = new Set<string>();
    for (const ct of contracts) {
      const code = String(ct.code || '').trim();
      if (!code) continue;
      if (byCode.has(code)) duplicateCodes.add(code);
      else byCode.set(code, ct);
    }
    let updated = 0;
    for (const snap of snapshots) {
      const detail = snap.contracts_detail;
      if (!Array.isArray(detail) || !detail.length) continue;
      const total = detail.reduce((sum: number, row: any) => sum + (Number(row.balance) || 0), 0);
      if (Math.abs(total - (Number(snap.total_balance) || 0)) > 1) continue;
      const seen = new Set<string>(), duplicates = new Set<string>();
      for (const row of detail) {
        const code = String(row.code || '').trim();
        if (!code) continue;
        if (seen.has(code)) duplicates.add(code);
        seen.add(code);
      }
      let changed = false;
      const next = detail.map((row: any) => {
        const code = String(row.code || '').trim();
        const current = byCode.get(code);
        if (!code || duplicateCodes.has(code) || duplicates.has(code) || !current?.has_collateral ||
          !['01', '02', '04', '06'].includes(current.collateral_type)) return row;
        const value = Math.max(0, Number(current.collateral_value) || 0);
        if (row.hasCollateral === true && row.collateralType === current.collateral_type && Number(row.collateralValue) === value) return row;
        changed = true;
        return { ...row, hasCollateral: true, collateralType: current.collateral_type, collateralValue: value };
      });
      if (!changed) continue;
      const specific = next.reduce((sum: number, row: any) => {
        const rate = PROVISION_SPECIFIC_RATE[Number(row.group)] || 0;
        const factor = collateralDeductionRate({ has_collateral: row.hasCollateral, collateral_type: row.collateralType });
        return sum + Math.max(0, (Number(row.balance) || 0) - (Number(row.collateralValue) || 0) * factor) * rate;
      }, 0);
      const { error } = await admin.from('monthly_snapshots').update({ contracts_detail: next, specific_provision: specific })
        .eq('year_month', snap.year_month);
      if (error) throw error;
      updated++;
    }
    return { updated };
  } catch (error) {
    return { updated: 0, error: String((error as Error)?.message || error) };
  }
}
function formatDateVNZalo(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function formatVNDZaloTemplate(n: number): string {
  return String(Math.round(n));
}

function stripDiacriticsUpper(str: string): string {
  return str
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/\s*₫/g, 'd')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function normalizeZaloPhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('84')) return digits;
  if (digits.startsWith('0')) return '84' + digits.slice(1);
  return digits;
}

async function getZaloAccessToken(): Promise<string | null> {
  if (!ZALO_APP_ID || !ZALO_SECRET_KEY) return null;
  const { data: tokenRow } = await admin.from('zalo_oa_tokens').select('*').eq('id', 'default').maybeSingle();
  if (!tokenRow?.refresh_token) return null;
  if (tokenRow.access_token && tokenRow.updated_at) {
    const ageMinutes = (Date.now() - new Date(tokenRow.updated_at).getTime()) / 60000;
    if (ageMinutes < 50) return tokenRow.access_token as string;
  }
  try {
    const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: ZALO_SECRET_KEY },
      body: new URLSearchParams({ app_id: ZALO_APP_ID, grant_type: 'refresh_token', refresh_token: tokenRow.refresh_token }),
    });
    const json2 = await res.json();
    if (!json2.access_token) { console.error('Lỗi làm mới Zalo access token:', json2); return null; }
    await admin.from('zalo_oa_tokens').update({
      access_token: json2.access_token,
      refresh_token: json2.refresh_token || tokenRow.refresh_token,
      updated_at: new Date().toISOString(),
    }).eq('id', 'default');
    return json2.access_token as string;
  } catch (e) {
    console.error('Lỗi gọi API làm mới Zalo access token:', e);
    return null;
  }
}

const ZALO_NO_ACCOUNT_MESSAGE = 'Số điện thoại này chưa đăng ký Zalo';
function isZaloNoAccountError(resp: any): boolean {
  if (!resp) return false;
  if (resp.error === -118) return true;
  return /account\s+not\s+exist/i.test(String(resp.message || ''));
}
async function removeCustomerFromZaloLists(customerId: string): Promise<void> {
  try {
    await admin.from('zalo_auto_send_list').delete().eq('customer_id', customerId);
    await admin.from('zalo_customers').delete().eq('customer_id', customerId);
  } catch (e) {
    console.error('Lỗi tự bỏ khách không có Zalo khỏi danh sách OA:', e);
  }
}

async function sendZaloTemplateLogged(opts: {
  accessToken: string; phone: string; templateId: string; templateData: Record<string, string>;
  contractId: string; customerId: string; kind: string; triggeredBy: 'auto' | 'manual'; triggeredByAdminId?: string | null;

  who?: 'main' | 'co'; whoName?: string;

  deferNoAccount?: boolean;
}): Promise<{ ok: boolean; reason?: string; noAccount?: boolean }> {
  let status: 'success' | 'error' = 'error';
  let errorMessage = '';
  let noAccount = false;
  try {
    const res = await fetch('https://business.openapi.zalo.me/message/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', access_token: opts.accessToken },
      body: JSON.stringify({
        phone: normalizeZaloPhone(opts.phone),
        template_id: opts.templateId,
        template_data: opts.templateData,
        tracking_id: `qtd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }),
    });
    const respJson = await res.json();
    if (respJson.error === 0) { status = 'success'; }
    else if (isZaloNoAccountError(respJson)) { errorMessage = ZALO_NO_ACCOUNT_MESSAGE; noAccount = true; }
    else { errorMessage = respJson.message || JSON.stringify(respJson); }
  } catch (e: any) {
    errorMessage = String(e?.message || e);
  }
  if (noAccount && !opts.deferNoAccount) await removeCustomerFromZaloLists(opts.customerId);
  const logRow: Record<string, unknown> = {
    contract_id: opts.contractId, customer_id: opts.customerId, kind: opts.kind, template_id: opts.templateId,
    phone: opts.phone, status, error_message: errorMessage || null,
    triggered_by: opts.triggeredBy, triggered_by_admin_id: opts.triggeredByAdminId || null,
  };
  if (opts.who) { logRow.recipient_who = opts.who; logRow.recipient_name = opts.whoName || null; }
  const { error: logErr } = await admin.from('zalo_send_log').insert(logRow);
  if (logErr && opts.who && /recipient_(who|name)/i.test(String(logErr.message || ''))) {

    delete logRow.recipient_who; delete logRow.recipient_name;
    await admin.from('zalo_send_log').insert(logRow);
  }
  return status === 'success' ? { ok: true } : { ok: false, reason: errorMessage || 'Gửi thất bại.', noAccount };
}

const CONTRACT_WRITE_COLS = [
  'id', 'customer_id', 'code', 'principal', 'disbursed_date', 'due_date', 'interest_rate', 'balance',
  'interest_paid_until', 'has_collateral', 'collateral_value', 'collateral_type', 'loan_term',
  'loan_purpose', 'heir_name', 'agreement_code', 'installment_schedule',
];
const CUSTOMER_PROFILE_COLS = ['name', 'phone', 'address', 'xom', 'thon', 'xa', 'tinh'];
type FieldKind = 'money' | 'date' | 'percent' | 'text' | 'yesno' | 'schedule';
const CONTRACT_FIELD_META: Record<string, { label: string; kind: FieldKind }> = {
  principal: { label: 'Số tiền vay', kind: 'money' },
  disbursed_date: { label: 'Ngày vay', kind: 'date' },
  due_date: { label: 'Ngày đến hạn', kind: 'date' },
  interest_rate: { label: 'Lãi suất', kind: 'percent' },
  balance: { label: 'Dư nợ', kind: 'money' },
  interest_paid_until: { label: 'Đã trả lãi đến ngày', kind: 'date' },
  has_collateral: { label: 'Có TSBĐ', kind: 'yesno' },
  collateral_value: { label: 'Giá trị TSBĐ', kind: 'money' },
  collateral_type: { label: 'Loại TSBĐ', kind: 'text' },
  loan_term: { label: 'Loại vay', kind: 'text' },
  loan_purpose: { label: 'Mục đích vay', kind: 'text' },
  heir_name: { label: 'Người thừa kế', kind: 'text' },
  agreement_code: { label: 'Số khế ước', kind: 'text' },
  installment_schedule: { label: 'Phân kỳ trả nợ', kind: 'schedule' },
};
const CUSTOMER_FIELD_META: Record<string, { label: string; kind: FieldKind }> = {
  name: { label: 'Họ tên', kind: 'text' },
  phone: { label: 'SĐT', kind: 'text' },
  address: { label: 'Địa chỉ', kind: 'text' },
};
const IMPORT_HISTORY_KEEP = 30;

function normField(kind: FieldKind, v: any): string | number | boolean {
  if (kind === 'money' || kind === 'percent') return v == null || v === '' ? 0 : Math.round(Number(v) * 1e6) / 1e6;
  if (kind === 'yesno') return !!v;
  if (kind === 'date') return v ? String(v).slice(0, 10) : '';
  if (kind === 'schedule') {
    if (!v || typeof v !== 'object') return '';
    const keys = Object.keys(v).sort();
    return keys.length ? JSON.stringify(keys.map((k) => [k, Number((v as any)[k])])) : '';
  }
  return v == null ? '' : String(v).trim();
}

function diffFields(meta: Record<string, { label: string; kind: FieldKind }>, before: any, after: any) {
  const changes: { field: string; label: string; kind: FieldKind; from: unknown; to: unknown }[] = [];
  for (const [field, m] of Object.entries(meta)) {
    if (normField(m.kind, before?.[field]) !== normField(m.kind, after?.[field])) {
      changes.push({ field, label: m.label, kind: m.kind, from: before?.[field] ?? null, to: after?.[field] ?? null });
    }
  }
  return changes;
}
function pickCols(row: any, cols: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of cols) out[c] = row?.[c] ?? null;
  return out;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function normPersonName(name: unknown): string {
  return String(name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}
function samePerson(a: unknown, b: unknown): boolean {
  const x = normPersonName(a);
  return !!x && x === normPersonName(b);
}

function heirOfRow(ct: any, customerName: unknown): string {
  const n = String(ct?.heir_name ?? '').replace(/\s+/g, ' ').trim();
  return !n || samePerson(n, customerName) ? '' : n;
}

function heirNamesOfRows(contracts: any[], customerName: string): string[] {
  const out: string[] = [];
  for (const ct of contracts || []) {
    const n = heirOfRow(ct, customerName);
    if (n && !out.some((x) => samePerson(x, n))) out.push(n);
  }
  return out;
}

function coPhoneOfPeople(people: unknown, name: unknown): string {
  const p = (Array.isArray(people) ? people : []).find((x: any) => samePerson(x?.name, name));
  return p ? String((p as any).phone ?? '').trim() : '';
}

function customerHasOaPhone(contracts: any[], customer: any): boolean {
  if (String(customer?.phone ?? '').trim()) return true;
  return heirNamesOfRows(contracts, customer?.name).some((n) => !!coPhoneOfPeople(customer?.co_people, n));
}
type ZaloRecipient = { who: 'main' | 'co'; phone: string };

function contractRecipients(ct: any, customer: any): ZaloRecipient[] {
  if (ct?.oa_enabled === false) return [];
  const main = String(customer?.phone ?? '').trim();
  const coName = heirOfRow(ct, customer?.name);
  const coPhone = coName ? coPhoneOfPeople(customer?.co_people, coName) : '';
  const ticked = ct?.oa_to_co === true && !!coName && samePerson(ct?.oa_co_key, coName);
  const toCo = !!coName && !!coPhone && !samePhone(coPhone, main) && (ticked || !main);
  const toMain = ct?.oa_to_main !== false || !toCo;
  const out: ZaloRecipient[] = [];
  if (toMain && main) out.push({ who: 'main', phone: main });
  if (toCo) out.push({ who: 'co', phone: coPhone });
  return out;
}

function manualRecipients(ct: any, customer: any): ZaloRecipient[] {
  return contractRecipients(ct?.oa_enabled === false ? { ...ct, oa_enabled: true, oa_to_main: true, oa_to_co: false, oa_co_key: null } : ct, customer);
}

function cleanVnPhone(raw: unknown): string | null {

  const digits = String(raw ?? '').replace(/[\s.\-()]/g, '');
  return /^0\d{9}$/.test(digits) ? digits : null;
}

function phoneFromFile(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/[\s.\-()]/g, '');
  if (!d) return '';
  if (/^\+?84\d{9}$/.test(d)) d = '0' + d.replace(/^\+?84/, '');
  else if (/^[1-9]\d{8}$/.test(d)) d = '0' + d;
  return cleanVnPhone(d);
}
function samePhone(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => String(v ?? '').replace(/[^\d]/g, '').replace(/^84/, '0');
  return !!n(a) && n(a) === n(b);
}

async function clearCoPrevName(customerId: string): Promise<void> {
  try { await admin.from('customers').update({ co_prev_name: null }).eq('id', customerId).not('co_prev_name', 'is', null); } catch {  }
}

function planNoZaloUntick(cust: any, cts: any[], contractId: string, noAccountWho: Array<'main' | 'co'>): { patches: Map<string, Record<string, unknown>>; hasLeft: boolean } {
  const coPerson = heirOfRow(cts.find((c) => c.id === contractId), cust?.name);
  const patches = new Map<string, Record<string, unknown>>();
  for (const ct of cts) {
    const p: Record<string, unknown> = {};
    if (noAccountWho.includes('main')) p.oa_to_main = false;
    if (noAccountWho.includes('co') && coPerson && samePerson(heirOfRow(ct, cust?.name), coPerson)) { p.oa_to_co = false; p.oa_co_key = null; }
    if (Object.keys(p).length) patches.set(ct.id, p);
  }

  const coDead = noAccountWho.includes('co') ? coPerson : '';
  const main = String(cust?.phone ?? '').trim();
  const hasLeft = cts.some((ct) => {
    const a = { ...ct, ...(patches.get(ct.id) || {}) };
    if (a.oa_enabled === false) return false;
    const coName = heirOfRow(a, cust?.name);
    const coPhone = coName ? coPhoneOfPeople(cust?.co_people, coName) : '';
    const ticked = a.oa_to_co === true && !!coName && samePerson(a.oa_co_key, coName);
    const dead = !!coDead && samePerson(coName, coDead);
    const toCo = !!coName && !!coPhone && !samePhone(coPhone, main) && !dead && (ticked || !main);
    return toCo || (a.oa_to_main !== false && !!main);
  });
  return { patches, hasLeft };
}

async function applyNoZaloResults(customerId: string, contractId: string, noAccountWho: Array<'main' | 'co'>): Promise<{ unticked: Array<'main' | 'co'>; removed: boolean }> {
  if (!noAccountWho.length) return { unticked: [], removed: false };
  try {
    const { data: custRows } = await admin.from('customers').select('name, phone, co_people').eq('id', customerId);
    const cust = (custRows || [])[0];
    const { data: ctRows } = await admin.from('contracts').select('*').eq('customer_id', customerId).gt('balance', 0);
    if (!cust) return { unticked: noAccountWho, removed: false };
    const { patches, hasLeft } = planNoZaloUntick(cust, ctRows || [], contractId, noAccountWho);
    if (!hasLeft) {
      await removeCustomerFromZaloLists(customerId);
      await admin.from('contracts').update({ oa_to_main: true, oa_to_co: false, oa_co_key: null }).eq('customer_id', customerId);
      return { unticked: noAccountWho, removed: true };
    }
    for (const [id, p] of patches) await admin.from('contracts').update(p).eq('id', id);
  } catch (e) {
    console.error('Lỗi tự bỏ tick gửi OA người không có Zalo:', e);
  }
  return { unticked: noAccountWho, removed: false };
}

type CoPref = { toMain: boolean; toCo: boolean };
type CoEntry = { name: string; phone: string; oa?: CoPref };
function cleanCoPref(v: unknown): CoPref | undefined {
  return v && typeof v === 'object' ? { toMain: (v as any).toMain !== false, toCo: (v as any).toCo === true } : undefined;
}

function mergeCoBooks(base: unknown, over: unknown): CoEntry[] {
  const out: CoEntry[] = [];
  for (const x of [...(Array.isArray(base) ? base : []), ...(Array.isArray(over) ? over : [])]) {
    const name = String((x as any)?.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const i = out.findIndex((y) => samePerson(y.name, name));
    const oa = cleanCoPref((x as any)?.oa) ?? (i >= 0 ? out[i].oa : undefined);
    const entry: CoEntry = { name, phone: String((x as any)?.phone ?? '').trim(), ...(oa ? { oa } : {}) };
    if (i >= 0) out[i] = entry; else out.push(entry);
  }
  return out;
}

function coPrefUpdates(customers: any[], contracts: any[]): { id: string; people: CoEntry[] }[] {
  const byCust = new Map<string, any[]>();
  for (const ct of contracts || []) {
    if (!(Number(ct?.balance) > 0)) continue;
    const arr = byCust.get(ct.customer_id) || [];
    arr.push(ct); byCust.set(ct.customer_id, arr);
  }
  const out: { id: string; people: CoEntry[] }[] = [];
  for (const cust of customers || []) {
    const people = mergeCoBooks(cust?.co_people, []);
    if (!people.length) continue;
    const cts = byCust.get(cust.id) || [];
    let changed = false;
    for (const p of people) {
      const named = cts.filter((ct) => samePerson(heirOfRow(ct, cust.name), p.name));
      if (!named.length) continue;
      const ticked = named.find((ct) => ct.oa_to_co === true && samePerson(ct.oa_co_key, p.name));
      const pref: CoPref = ticked ? { toMain: ticked.oa_to_main !== false, toCo: true } : { toMain: true, toCo: false };
      if (!p.oa && !pref.toCo) continue;
      if (!p.oa || p.oa.toMain !== pref.toMain || p.oa.toCo !== pref.toCo) { p.oa = pref; changed = true; }
    }
    if (changed) out.push({ id: cust.id, people });
  }
  return out;
}

async function applyCoPrefToNewContracts(custById: Map<string, any>, ctRows: any[], newContractIds: string[]): Promise<number> {
  const fresh = new Set(newContractIds || []);
  if (!fresh.size) return 0;
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  for (const ct of ctRows) {
    if (!fresh.has(ct.id) || ct.oa_to_co === true) continue;
    const cust = custById.get(ct.customer_id);
    if (!cust) continue;
    const name = heirOfRow(ct, cust.name);
    if (!name) continue;
    const entry = mergeCoBooks(cust.co_people, []).find((x) => samePerson(x.name, name));
    if (!entry?.oa || entry.oa.toCo !== true || !entry.phone || samePhone(entry.phone, cust.phone)) continue;
    updates.push({ id: ct.id, patch: { oa_to_co: true, oa_co_key: normPersonName(name), oa_to_main: entry.oa.toMain !== false } });
  }
  await mapLimit(updates, 8, async (u) => {
    const { error } = await admin.from('contracts').update(u.patch).eq('id', u.id);
    if (error) console.error('Lỗi tick lại người cùng vay cho hợp đồng mới:', error.message);
  });
  return updates.length;
}

async function archiveCoPeopleBeforePrune(customerIds: string[]): Promise<number> {
  let saved = 0;
  try {
    for (const part of chunkArray(customerIds, 150)) {
      const { data: custs, error } = await admin.from('customers').select('id, cccd, co_people').in('id', part);
      if (error) return saved;
      const withBook = (custs || []).filter((c: any) => String(c.cccd ?? '').trim() && mergeCoBooks(c.co_people, []).length);
      if (!withBook.length) continue;
      const { data: old, error: oldErr } = await admin.from('co_people_archive').select('cccd, people').in('cccd', withBook.map((c: any) => c.cccd));
      if (oldErr) return saved;
      const oldByCccd = new Map<string, unknown>((old || []).map((r: any) => [r.cccd, r.people]));
      const rows = withBook.map((c: any) => ({ cccd: c.cccd, people: mergeCoBooks(oldByCccd.get(c.cccd), c.co_people), updated_at: new Date().toISOString() }));
      const { error: upErr } = await admin.from('co_people_archive').upsert(rows, { onConflict: 'cccd' });
      if (upErr) console.error('Lỗi cất sổ người cùng vay:', upErr.message); else saved += rows.length;
    }
  } catch (e) {
    console.error('Lỗi cất sổ người cùng vay:', e);
  }
  return saved;
}

async function restoreCoPeopleFromArchive(custById: Map<string, any>, ctRows: any[]): Promise<number> {
  const namesByCust = new Map<string, any[]>();
  for (const ct of ctRows) { const a = namesByCust.get(ct.customer_id) || []; a.push(ct); namesByCust.set(ct.customer_id, a); }
  const need = new Map<string, string[]>();
  for (const [id, cust] of custById) {
    if (!String(cust?.cccd ?? '').trim()) continue;
    const names = heirNamesOfRows(namesByCust.get(id) || [], String(cust.name ?? ''))
      .filter((n) => !(Array.isArray(cust.co_people) ? cust.co_people : []).some((x: any) => samePerson(x?.name, n)));
    if (names.length) need.set(id, names);
  }
  if (!need.size) return 0;
  const archived = new Map<string, unknown>();
  for (const part of chunkArray([...need.keys()].map((id) => custById.get(id).cccd as string), 150)) {
    const { data, error } = await admin.from('co_people_archive').select('cccd, people').in('cccd', part);
    if (error) return 0;
    for (const r of data || []) archived.set((r as any).cccd, (r as any).people);
  }
  const updates: { id: string; people: { name: string; phone: string }[] }[] = [];
  for (const [id, names] of need) {
    const cust = custById.get(id);
    const book = archived.get(cust.cccd);
    if (!book) continue;
    const people = mergeCoBooks(cust.co_people, []);
    let changed = false;
    for (const n of names) {
      const saved = mergeCoBooks(book, []).find((x) => samePerson(x.name, n));
      if (!saved || !saved.phone || samePhone(saved.phone, cust.phone)) continue;
      people.push({ name: n, phone: saved.phone, ...(saved.oa ? { oa: saved.oa } : {}) });
      changed = true;
    }
    if (changed) { updates.push({ id, people }); cust.co_people = people; }
  }
  await mapLimit(updates, 8, async (u) => {
    const { error } = await admin.from('customers').update({ co_people: u.people }).eq('id', u.id);
    if (error) console.error('Lỗi điền lại số người cùng vay từ sổ đã cất:', error.message);
  });
  return updates.length;
}

async function reconcileCoBorrowersAfterImport(customerIds: string[], newContractIds: string[] = []): Promise<{ changes: { name: string; prev: string; now: string }[]; filled: number; ticked: number; skipped?: string }> {
  const out = { changes: [] as { name: string; prev: string; now: string }[], filled: 0, ticked: 0 };
  if (!customerIds.length) return out;
  try {
    const custById = new Map<string, any>();
    for (const part of chunkArray(customerIds, 150)) {
      const { data, error } = await admin.from('customers').select('id, name, cccd, phone, co_people').in('id', part);
      if (error) return { ...out, skipped: 'chưa chạy SQL gửi OA theo hợp đồng' };
      for (const c of data || []) custById.set((c as any).id, c);
    }
    const ctRows: any[] = [];
    for (const part of chunkArray(customerIds, 150)) {
      const { data, error } = await admin.from('contracts').select('id, customer_id, heir_name, oa_to_co, oa_co_key').in('customer_id', part).gt('balance', 0);
      if (error) return { ...out, skipped: error.message };
      ctRows.push(...(data || []));
    }

    try { out.filled = await restoreCoPeopleFromArchive(custById, ctRows); } catch (e) { console.error('Lỗi điền lại sổ người cùng vay:', e); }
    const toRemoveFromOa = new Set<string>();
    const prevByCustomer = new Map<string, string>();
    const ctUpdates: string[] = [];
    for (const ct of ctRows) {
      if (ct.oa_to_co !== true) continue;
      const cust = custById.get(ct.customer_id);
      if (!cust) continue;
      const now = heirOfRow(ct, cust.name);
      if (now && samePerson(ct.oa_co_key, now)) continue;
      ctUpdates.push(ct.id);
      toRemoveFromOa.add(ct.customer_id);
      if (!prevByCustomer.has(ct.customer_id)) {
        const saved = (Array.isArray(cust.co_people) ? cust.co_people : []).find((x: any) => samePerson(x?.name, ct.oa_co_key));
        const prev = String(saved?.name || ct.oa_co_key || '');
        prevByCustomer.set(ct.customer_id, prev);
        out.changes.push({ name: cust.name || '', prev, now: now || '(không còn ghi người cùng vay)' });
      }
    }
    await mapLimit(ctUpdates, 8, async (id) => {
      const { error } = await admin.from('contracts').update({ oa_to_co: false, oa_co_key: null, oa_to_main: true }).eq('id', id);
      if (error) console.error('Lỗi cập nhật tick người cùng vay sau khi nhập:', error.message);
    });
    await mapLimit([...prevByCustomer], 8, async ([customerId, prev]) => {
      const { error } = await admin.from('customers').update({ co_prev_name: prev }).eq('id', customerId);
      if (error) console.error('Lỗi ghi người cùng vay cũ:', error.message);
    });
    for (const part of chunkArray([...toRemoveFromOa], 150)) {
      await admin.from('zalo_auto_send_list').delete().in('customer_id', part);
      await admin.from('zalo_customers').delete().in('customer_id', part);
    }

    try { out.ticked = await applyCoPrefToNewContracts(custById, ctRows, newContractIds); } catch (e) { console.error('Lỗi tick lại người cùng vay:', e); }
  } catch (e: any) {
    console.error('Lỗi đối chiếu người cùng vay:', e);
    return { ...out, skipped: String(e?.message || e) };
  }
  return out;
}

async function importHistoryReady(): Promise<string | null> {
  const { error } = await admin.from('import_history').select('id').limit(1);
  return error ? 'Chưa tạo bảng lịch sử nhập (import_history) trên Supabase — chạy SQL tạo bảng trước; chưa thay đổi dữ liệu.' : null;
}

async function saveImportHistory(entry: {
  adminId: string; adminName: string; kind: 'import' | 'supplement'; fileName: string | null; fullSync: boolean;
  summary: unknown; details: unknown; snapshot: unknown;
}): Promise<{ id: string | null; error?: string }> {
  const id = crypto.randomUUID();
  const { error } = await admin.from('import_history').insert({
    id, admin_id: entry.adminId, admin_name: entry.adminName, kind: entry.kind, file_name: entry.fileName,
    full_sync: entry.fullSync, summary: entry.summary, details: entry.details, snapshot: entry.snapshot,
  });
  if (error) return { id: null, error: error.message };
  const { data: old } = await admin.from('import_history').select('id').order('created_at', { ascending: false }).range(IMPORT_HISTORY_KEEP, IMPORT_HISTORY_KEEP + 200);
  if (old && old.length) await admin.from('import_history').delete().in('id', old.map((r: any) => r.id));
  return { id };
}

async function rollbackImportSnapshot(snapshot: any): Promise<{ errors: string[]; counts: Record<string, number> }> {
  const errors: string[] = [];
  const counts: Record<string, number> = {
    restoredContracts: 0, revertedContracts: 0, removedContracts: 0,
    restoredCustomers: 0, revertedCustomers: 0, removedCustomers: 0,
  };
  const step = async (label: string, fn: () => Promise<void>) => {
    if (errors.length) return;
    try { await fn(); } catch (e: any) { errors.push(`${label}: ${e?.message || e}`); }
  };
  const must = (error: any) => { if (error) throw new Error(error.message || String(error)); };
  const upsertAll = async (table: string, rows: any[], size: number) => {
    for (const part of chunkArray(rows || [], size)) {
      const { error } = await admin.from(table).upsert(part, { onConflict: 'id' });
      must(error);
    }
  };

  if (snapshot?.kind === 'supplement') {
    await step('Trả số khế ước/phân kỳ về giá trị cũ', async () => {
      await upsertAll('contracts', snapshot.updatedContracts, 300);
      counts.revertedContracts = (snapshot.updatedContracts || []).length;
    });
    return { errors, counts };
  }

  await step('Tạo lại hồ sơ khách đã bị dọn', async () => {
    await upsertAll('customers', snapshot.deletedCustomers, 200);
    counts.restoredCustomers = (snapshot.deletedCustomers || []).length;
  });
  await step('Trả khách về danh sách OA', async () => {
    for (const part of chunkArray(snapshot.zaloCustomers || [], 200)) {
      const { error } = await admin.from('zalo_customers').upsert(part, { onConflict: 'customer_id' });
      must(error);
    }
  });
  await step('Tạo lại hợp đồng đã xóa', async () => {
    await upsertAll('contracts', snapshot.deletedContracts, 150);
    counts.restoredContracts = (snapshot.deletedContracts || []).length;
  });
  await step('Trả lại lựa chọn "Gửi tin tự động"', async () => {
    await upsertAll('zalo_auto_send_list', snapshot.zaloAutoSend, 200);
  });
  await step('Nối lại nhật ký gửi tin với hợp đồng cũ', async () => {
    for (const table of ['notification_log', 'zalo_send_log']) {
      const byContract = new Map<string, string[]>();
      for (const [logId, contractId] of (snapshot.logLinks?.[table] || []) as [string, string][]) {
        byContract.set(contractId, [...(byContract.get(contractId) || []), logId]);
      }
      for (const [contractId, ids] of byContract) {
        for (const part of chunkArray(ids, 150)) {
          const { error } = await admin.from(table).update({ contract_id: contractId }).in('id', part);
          must(error);
        }
      }
    }
  });
  await step('Trả hợp đồng về giá trị cũ', async () => {
    await upsertAll('contracts', snapshot.updatedContracts, 300);
    counts.revertedContracts = (snapshot.updatedContracts || []).length;
  });
  await step('Trả hồ sơ khách về giá trị cũ', async () => {
    for (const part of chunkArray(snapshot.updatedCustomers || [], 20)) {
      const results = await Promise.all(part.map((c: any) => {
        const { id, ...patch } = c;
        return admin.from('customers').update(patch).eq('id', id);
      }));
      for (const r of results) must(r.error);
    }
    counts.revertedCustomers = (snapshot.updatedCustomers || []).length;
  });
  await step('Xóa hợp đồng do lần nhập này tạo ra', async () => {
    for (const part of chunkArray(snapshot.createdContractIds || [], 150)) {

      for (const table of ['notification_log', 'zalo_send_log']) {
        const { error } = await admin.from(table).update({ contract_id: null }).in('contract_id', part);
        must(error);
      }
      const { error } = await admin.from('contracts').delete().in('id', part);
      must(error);
      counts.removedContracts += part.length;
    }
  });
  await step('Xóa khách do lần nhập này tạo ra', async () => {
    for (const part of chunkArray<string>(snapshot.createdCustomerIds || [], 150)) {
      const { data: stillUsed, error: usedError } = await admin.from('contracts').select('customer_id').in('customer_id', part);
      must(usedError);
      const used = new Set((stillUsed || []).map((r: any) => r.customer_id));
      const removable = part.filter((id) => !used.has(id));
      if (!removable.length) continue;
      const { error } = await admin.from('customers').delete().in('id', removable);
      must(error);
      counts.removedCustomers += removable.length;
    }
  });
  return { errors, counts };
}

async function loadContractWithCustomer(contractId: string): Promise<{ contract: any; customer: any } | null> {
  try {
    const { data, error } = await admin.from('contracts').select('*, customers(*)').eq('id', contractId).maybeSingle();
    if (!error && data) {
      const { customers, ...contract } = data as any;
      const customer = Array.isArray(customers) ? customers[0] : customers;
      if (customer && contract.customer_id === customer.id) return { contract, customer };
    }
  } catch {  }
  const { data: contract } = await admin.from('contracts').select('*').eq('id', contractId).maybeSingle();
  if (!contract) return null;
  const { data: customer } = await admin.from('customers').select('*').eq('id', contract.customer_id).maybeSingle();
  if (!customer) return null;
  return { contract, customer };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'Method not allowed' }, 405);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: 'Yêu cầu không hợp lệ.' }, 400);
  }

  if (body.type === 'login') {
    const { role, identifier, password } = body;
    if (!identifier || !password || (role !== 'customer' && role !== 'admin')) {
      return json({ ok: false, reason: 'Thiếu thông tin đăng nhập.' }, 400);
    }
    const table = role === 'customer' ? 'customers' : 'admins';
    const idTrim = String(identifier).trim();

    let row: Record<string, any> | null = null;
    if (role === 'customer') {
      const noSpace = idTrim.replace(/\s/g, '');
      const { data, error } = await admin.from('customers').select('*');
      if (error) { console.error('query customers error:', error); return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500); }
      row = (data || []).find((c) => c.cccd === idTrim || (c.phone && c.phone.replace(/\s/g, '') === noSpace)) || null;
    } else {

      const { data, error } = await admin.from('admins').select('*').ilike('username', escapeLike(idTrim)).maybeSingle();
      if (error) { console.error('query admins error:', error); return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500); }
      row = data;
    }

    const notFoundMsg = role === 'customer' ? 'Không tìm thấy tài khoản với số CCCD/số điện thoại này.' : 'Sai tên đăng nhập hoặc mật khẩu.';
    if (!row) return json({ ok: false, reason: notFoundMsg });
    if (!row.salt || !row.hash) return json({ ok: false, reason: 'Tài khoản này chưa được cấp mật khẩu đăng nhập — liên hệ quỹ tín dụng.' });
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      const mins = Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60000);
      return json({ ok: false, reason: `Tài khoản tạm khóa do nhập sai nhiều lần. Thử lại sau ${mins} phút.` });
    }

    const okPw = await verifyCredential(password, row.salt, row.hash);
    if (!okPw) {
      const failedAttempts = (row.failed_attempts || 0) + 1;
      const patch: Record<string, unknown> = { failed_attempts: failedAttempts };
      if (failedAttempts >= LOCK_AFTER_FAILS) { patch.locked_until = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString(); patch.failed_attempts = 0; }
      await admin.from(table).update(patch).eq('id', row.id);
      return json({ ok: false, reason: role === 'customer' ? 'Số CCCD/số điện thoại hoặc mật khẩu không đúng.' : 'Sai tên đăng nhập hoặc mật khẩu.' });
    }

    const loginPatch: Record<string, unknown> = { failed_attempts: 0, locked_until: null };
    if (role === 'customer') { loginPatch.last_login_at = new Date().toISOString(); loginPatch.is_online = true; }
    await admin.from(table).update(loginPatch).eq('id', row.id);

    const now = Math.floor(Date.now() / 1000);

    const token = await signJwt({
      sub: row.auth_user_id, role: 'authenticated', app_role: role, row_id: row.id,
      iat: now,
    });

    if (role === 'admin') {

      const deviceLabel = ({ phone: 'điện thoại', tablet: 'máy tính bảng', desktop: 'máy tính' } as Record<string, string>)[String(body.device || '')];
      await logActivity(row.id, row.name || row.username, row.username, 'login', `Đăng nhập hệ thống (**${row.username}**)${deviceLabel ? ` bằng **${deviceLabel}**` : ''}`);
    }
    return json({ ok: true, token, id: row.id, mustChangePassword: !!row.must_change_password });
  }

  if (body.type === 'forgot-password') {
    const cccd = String(body.cccd || '').trim();
    const phone = body.phone ? String(body.phone).replace(/\s/g, '') : '';
    if (!cccd || !phone) return json({ ok: false, reason: 'Cần nhập đủ số CCCD và số điện thoại.' }, 400);

    const { data: row, error } = await admin.from('customers').select('id, phone').eq('cccd', cccd).maybeSingle();
    if (error) { console.error('forgot-password lookup error:', error); return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500); }
    const notMatchMsg = 'Không tìm thấy tài khoản khớp với số CCCD và số điện thoại đã nhập. Vui lòng kiểm tra lại hoặc liên hệ trực tiếp quỹ tín dụng.';
    if (!row || !row.phone || row.phone.replace(/\s/g, '') !== phone) {
      return json({ ok: false, reason: notMatchMsg });
    }

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: recent } = await admin.from('requests').select('id')
      .eq('customer_id', row.id).eq('type', 'quen_mat_khau').eq('status', 'moi').gte('created_at', since).limit(1);
    if (!recent || !recent.length) {
      const { error: insErr } = await admin.from('requests').insert({
        id: genId('yc'), customer_id: row.id, type: 'quen_mat_khau',
        purpose: 'Khách hàng bấm "Quên mật khẩu" ở màn đăng nhập, đã xác minh khớp CCCD + SĐT.',
        status: 'moi',
      });
      if (insErr) { console.error('forgot-password insert error:', insErr); return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500); }
    }
    return json({ ok: true });
  }

  if (body.type === 'verify-own-password' || body.type === 'set-own-password') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || !selfClaims.app_role) {
      return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    }
    const selfTable = selfClaims.app_role === 'customer' ? 'customers' : 'admins';

    if (body.type === 'verify-own-password') {
      const { data: row } = await admin.from(selfTable).select('salt, hash').eq('id', selfClaims.row_id).maybeSingle();
      if (!row || !row.salt || !row.hash) return json({ ok: true, valid: false });
      const valid = await verifyCredential(body.password || '', row.salt, row.hash);
      return json({ ok: true, valid });
    }

    const newPw = String(body.newPassword || '').trim();
    if (newPw.length < 6) return json({ ok: false, reason: 'Mật khẩu mới phải từ 6 ký tự.' }, 400);
    const cred = await makeCredential(newPw);
    const patch: Record<string, unknown> = { ...cred, must_change_password: !!body.mustChangePassword };
    const { error } = await admin.from(selfTable).update(patch).eq('id', selfClaims.row_id);
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    return json({ ok: true });
  }

  if (body.type === 'save-push-subscription' || body.type === 'delete-push-subscription') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || !selfClaims.app_role) {
      return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    }

    if (body.type === 'delete-push-subscription') {
      const endpoint = String(body.endpoint || '').trim();
      if (!endpoint) return json({ ok: false, reason: 'Thiếu endpoint.' }, 400);

      await admin.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('owner_id', selfClaims.row_id);
      return json({ ok: true });
    }

    const endpoint = String(body.endpoint || '').trim();
    const p256dh = String(body.p256dh || '').trim();
    const authKey = String(body.auth || '').trim();
    if (!endpoint || !p256dh || !authKey) return json({ ok: false, reason: 'Thiếu thông tin đăng ký nhận thông báo.' }, 400);
    const { error } = await admin.from('push_subscriptions').upsert({
      endpoint, p256dh, auth: authKey,
      owner_type: selfClaims.app_role, owner_id: selfClaims.row_id,
    }, { onConflict: 'endpoint' });
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    return json({ ok: true });
  }

  if (body.type === 'customer-logout') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || selfClaims.app_role !== 'customer') {
      return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    }
    await admin.from('customers').update({ is_online: false }).eq('id', selfClaims.row_id);
    return json({ ok: true });
  }

  if (body.type === 'log-admin-action') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || selfClaims.app_role !== 'admin') {
      return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    }
    const { data: selfAdmin } = await admin.from('admins').select('id, name, username').eq('id', selfClaims.row_id).maybeSingle();
    if (!selfAdmin) return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    const actorName = selfAdmin.name || selfAdmin.username;

    if (body.action === 'reply-chat') {
      const customerId = String(body.customerId || '').trim();
      if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
      const { data: cust } = await admin.from('customers').select('name').eq('id', customerId).maybeSingle();
      await logActivity(selfAdmin.id, actorName, selfAdmin.username, 'reply-chat', `Trả lời chat với khách hàng "**${cust?.name || customerId}**"`);
      return json({ ok: true });
    }

    if (body.action === 'update-request-status') {
      const requestId = String(body.requestId || '').trim();
      if (!requestId) return json({ ok: false, reason: 'Thiếu mã yêu cầu.' }, 400);
      const { data: reqRow } = await admin.from('requests').select('status, customer_id').eq('id', requestId).maybeSingle();
      const { data: cust } = reqRow?.customer_id ? await admin.from('customers').select('name').eq('id', reqRow.customer_id).maybeSingle() : { data: null };
      const statusLabel = REQUEST_STATUS_LABELS[reqRow?.status as string] || reqRow?.status || '';
      await logActivity(selfAdmin.id, actorName, selfAdmin.username, 'update-request-status', `Cập nhật trạng thái yêu cầu của khách hàng "**${cust?.name || reqRow?.customer_id || '—'}**" thành "**${statusLabel}**"`);
      return json({ ok: true });
    }

    if (body.action === 'view-customer') {
      const customerId = String(body.customerId || '').trim();
      if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
      const { data: cust } = await admin.from('customers').select('name').eq('id', customerId).maybeSingle();
      await logActivity(selfAdmin.id, actorName, selfAdmin.username, 'view-customer', `Xem chi tiết khách hàng "**${cust?.name || customerId}**"`);
      return json({ ok: true });
    }

    if (body.action === 'view-contract') {
      const contractId = String(body.contractId || '').trim();
      if (!contractId) return json({ ok: false, reason: 'Thiếu mã hợp đồng.' }, 400);
      const { data: ct } = await admin.from('contracts').select('code, customer_id').eq('id', contractId).maybeSingle();
      const { data: cust } = ct?.customer_id ? await admin.from('customers').select('name').eq('id', ct.customer_id).maybeSingle() : { data: null };
      await logActivity(selfAdmin.id, actorName, selfAdmin.username, 'view-contract', `Xem chi tiết hợp đồng **${ct?.code || contractId}**${cust?.name ? ` (khách hàng "**${cust.name}**")` : ''}`);
      return json({ ok: true });
    }

    if (body.action === 'filter-customers') {

      const filterDesc = String(body.filterDesc || '').trim().slice(0, 200);
      if (!filterDesc) return json({ ok: false, reason: 'Thiếu mô tả bộ lọc.' }, 400);
      await logActivity(selfAdmin.id, actorName, selfAdmin.username, 'filter-customers', `Lọc danh sách khách hàng — ${filterDesc}`);
      return json({ ok: true });
    }

    if (body.action === 'nav-page') {

      const pageLabel = String(body.pageLabel || '').trim().slice(0, 100);
      if (!pageLabel) return json({ ok: false, reason: 'Thiếu tên trang.' }, 400);
      await logActivity(selfAdmin.id, actorName, selfAdmin.username, 'nav-page', `Vào trang "**${pageLabel}**"`);
      return json({ ok: true });
    }

    if (body.action === 'call-customer') {

      const customerId = String(body.customerId || '').trim();
      if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
      let { data: cust, error: custErr } = await admin.from('customers').select('name, phone, co_people').eq('id', customerId).maybeSingle();
      if (custErr) ({ data: cust } = await admin.from('customers').select('name, phone').eq('id', customerId).maybeSingle());
      if (body.callee === 'co') {

        const coName = String(body.coName || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        const coPhone = coName ? coPhoneOfPeople((cust as any)?.co_people, coName) : '';
        await logActivity(selfAdmin.id, actorName, selfAdmin.username, 'call-customer', `Bấm gọi người cùng vay "**${coName || 'người cùng vay'}**" của khách hàng "**${cust?.name || customerId}**"${coPhone ? ` (số **${coPhone}**)` : ''}`);
        return json({ ok: true });
      }
      await logActivity(selfAdmin.id, actorName, selfAdmin.username, 'call-customer', `Bấm gọi khách hàng "**${cust?.name || customerId}**"${cust?.phone ? ` (số **${cust.phone}**)` : ''}`);
      return json({ ok: true });
    }

    if (body.action === 'ui-action') {

      const kind = String(body.kind || '').trim().toLowerCase();
      if (!/^[a-z0-9-]{1,40}$/.test(kind)) return json({ ok: false, reason: 'Sai loại thao tác.' }, 400);
      const label = String(body.label || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!label) return json({ ok: false, reason: 'Thiếu mô tả thao tác.' }, 400);
      await logActivity(selfAdmin.id, actorName, selfAdmin.username, `ui-${kind}`, label);
      return json({ ok: true });
    }

    return json({ ok: false, reason: 'Thiếu hoặc sai "action".' }, 400);
  }

  if (body.type === 'send-manual-notification') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || selfClaims.app_role !== 'admin') {
      return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    }
    const { data: caller, error: callerErr } = await admin.from('admins').select('*').eq('id', selfClaims.row_id).maybeSingle();
    if (callerErr || !caller) {
      return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return json({ ok: false, reason: 'Chưa cấu hình thông báo đẩy trên server (thiếu secret VAPID) — xem docs/supabase-migration.md mục "Thông báo đẩy".' }, 500);
    }
    const customerId = String(body.customerId || '').trim();
    const title = String(body.title || '').trim();
    const msgBody = String(body.body || '').trim();
    if (!customerId || !title || !msgBody) return json({ ok: false, reason: 'Cần nhập đủ tiêu đề và nội dung thông báo.' }, 400);

    if (caller.role !== 'super') {
      const { data: cust } = await admin.from('customers').select('thon, xom').eq('id', customerId).maybeSingle();
      if (!cust) return json({ ok: false, reason: 'Không tìm thấy khách hàng.' }, 404);
      const allowedThon: string[] = caller.allowed_thon || [];
      const allowedXom: string[] = caller.allowed_xom || [];
      const inScope = allowedThon.includes(cust.thon) || allowedXom.includes(`${cust.thon}||${cust.xom}`);
      if (!inScope) return json({ ok: false, reason: 'Bạn không có quyền gửi thông báo cho khách hàng này.' }, 403);
    }

    const { data: subs, error: subsErr } = await admin.from('push_subscriptions').select('*').eq('owner_type', 'customer').eq('owner_id', customerId);
    if (subsErr) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    if (!subs || !subs.length) return json({ ok: false, reason: 'Khách hàng này chưa bật thông báo trên thiết bị nào.' });

    let sentCount = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body: msgBody, tag: 'thong-bao-thu-cong', url: './' })
        );
        sentCount++;
      } catch (e: any) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        } else {
          console.error('manual push send error:', e?.statusCode, e?.body || e);
        }
      }
    }
    if (!sentCount) return json({ ok: false, reason: 'Gửi không thành công — thiết bị của khách có thể đã tắt/gỡ đăng ký nhận thông báo, nhờ khách vào lại app bật lại thông báo.' });
    const { data: notifiedCust } = await admin.from('customers').select('name').eq('id', customerId).maybeSingle();
    await logActivity(caller.id, caller.name || caller.username, caller.username, 'send-manual-notification',
      `Gửi thông báo đẩy "**${title}**" cho khách hàng "**${notifiedCust?.name || customerId}**" (${sentCount} thiết bị)`);
    return json({ ok: true, sentCount });
  }

  if (body.type === 'save-contract-oa') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || selfClaims.app_role !== 'admin') return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    const { data: caller, error: callerErr } = await admin.from('admins').select('*').eq('id', selfClaims.row_id).maybeSingle();
    if (callerErr || !caller) return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    const isSuperCaller = caller.role === 'super';
    if (!(isSuperCaller || caller.can_manage_zalo_oa === true)) return json({ ok: false, reason: 'Chỉ quản trị viên có quyền Quản lý OA mới đổi được cấu hình gửi Zalo OA.' }, 403);
    const contractId = String(body.contractId || '').trim();
    if (!contractId) return json({ ok: false, reason: 'Thiếu mã hợp đồng.' }, 400);
    const { data: ct } = await admin.from('contracts').select('*').eq('id', contractId).maybeSingle();
    if (!ct) return json({ ok: false, reason: 'Không tìm thấy hợp đồng.' }, 404);
    if (!('oa_enabled' in ct)) return json({ ok: false, reason: 'Chưa chạy SQL gửi Zalo OA theo từng hợp đồng trên Supabase (docs mục 10.83).' }, 500);
    const { data: customer } = await admin.from('customers').select('*').eq('id', ct.customer_id).maybeSingle();
    if (!customer) return json({ ok: false, reason: 'Không tìm thấy khách hàng.' }, 404);
    if (!isSuperCaller) {
      const allowedThon: string[] = caller.allowed_thon || [];
      const allowedXom: string[] = caller.allowed_xom || [];
      if (!(allowedThon.includes(customer.thon) || allowedXom.includes(`${customer.thon}||${customer.xom}`))) {
        return json({ ok: false, reason: 'Bạn không có quyền với khách hàng này.' }, 403);
      }
    }
    const coName = heirOfRow(ct, customer.name);
    const enabled = body.enabled !== undefined ? body.enabled === true : ct.oa_enabled !== false;
    const toMain = body.toMain !== undefined ? body.toMain === true : ct.oa_to_main !== false;
    let toCo = body.toCo !== undefined ? body.toCo === true : (ct.oa_to_co === true && !!coName && samePerson(ct.oa_co_key, coName));
    if (body.toMain === true && !String(customer.phone ?? '').trim()) return json({ ok: false, reason: 'Người vay chưa có số điện thoại.' });
    if (body.toCo === true) {
      if (!coName) return json({ ok: false, reason: 'Hợp đồng này không ghi người cùng vay.' });
      const coPhone = coPhoneOfPeople(customer.co_people, coName);
      if (!coPhone) return json({ ok: false, reason: `Cần nhập số điện thoại của ${coName} trước khi bật gửi Zalo OA.` });
      if (samePhone(coPhone, customer.phone)) return json({ ok: false, reason: 'Số người cùng vay trùng số người vay.' });
    }
    if (!coName) toCo = false;

    const coPhoneNow = coName ? coPhoneOfPeople(customer.co_people, coName) : '';
    const autoCo = !String(customer.phone ?? '').trim() && !!coName && !!coPhoneNow;
    if (enabled && autoCo && body.toCo === false) return json({ ok: false, reason: 'Người vay chưa có số điện thoại nên phải giữ gửi cho người cùng vay — hoặc tắt hợp đồng này bằng công tắc bên trái.' });
    if (enabled && !toMain && !toCo && !autoCo) return json({ ok: false, reason: 'Cần giữ ít nhất 1 người nhận Zalo OA — hoặc tắt hợp đồng này bằng công tắc bên trái.' });
    const patch = { oa_enabled: enabled, oa_to_main: toMain, oa_to_co: toCo, oa_co_key: toCo ? normPersonName(coName) : null };
    const { error } = await admin.from('contracts').update(patch).eq('id', contractId);
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    const sendTo = !enabled ? 'tắt gửi OA' : toMain && toCo ? 'người vay và người cùng vay' : toCo ? 'chỉ người cùng vay' : 'chỉ người vay';
    await logActivity(caller.id, caller.name || caller.username, caller.username, 'save-contract-oa',
      `Gửi Zalo OA hợp đồng "**${ct.code || contractId}**" của khách hàng "**${customer.name || ct.customer_id}**": ${sendTo}`);
    return json({ ok: true, contract: { id: contractId, oaEnabled: enabled, oaToMain: toMain, oaToCo: toCo, oaCoKey: patch.oa_co_key } });
  }

  if (body.type === 'save-co-phone') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || selfClaims.app_role !== 'admin') return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    const { data: caller, error: callerErr } = await admin.from('admins').select('*').eq('id', selfClaims.row_id).maybeSingle();
    if (callerErr || !caller) return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    const isSuperCaller = caller.role === 'super';
    const canOa = isSuperCaller || caller.can_manage_zalo_oa === true;
    if (!canOa && caller.can_manage_users !== true) return json({ ok: false, reason: 'Bạn không có quyền sửa thông tin người cùng vay.' }, 403);
    const customerId = String(body.customerId || '').trim();
    const personName = String(body.name || '').replace(/\s+/g, ' ').trim();
    if (!customerId || !personName) return json({ ok: false, reason: 'Thiếu thông tin người cùng vay.' }, 400);
    const { data: customer } = await admin.from('customers').select('*').eq('id', customerId).maybeSingle();
    if (!customer) return json({ ok: false, reason: 'Không tìm thấy khách hàng.' }, 404);
    if (!isSuperCaller) {
      const allowedThon: string[] = caller.allowed_thon || [];
      const allowedXom: string[] = caller.allowed_xom || [];
      if (!(allowedThon.includes(customer.thon) || allowedXom.includes(`${customer.thon}||${customer.xom}`))) {
        return json({ ok: false, reason: 'Bạn không có quyền với khách hàng này.' }, 403);
      }
    }
    if (!('co_people' in customer)) return json({ ok: false, reason: 'Chưa chạy SQL gửi Zalo OA theo từng hợp đồng trên Supabase (docs mục 10.83).' }, 500);
    const { data: ctRows } = await admin.from('contracts').select('id, heir_name, oa_to_co, oa_co_key').eq('customer_id', customerId).gt('balance', 0);
    const named = (ctRows || []).filter((c: any) => samePerson(heirOfRow(c, customer.name), personName));
    if (!named.length) return json({ ok: false, reason: `Hợp đồng của khách này không ghi người cùng vay "${personName}".` });
    const raw = String(body.phone ?? '').trim();
    let phone = '';
    if (raw) {
      const clean = cleanVnPhone(raw);
      if (!clean) return json({ ok: false, reason: 'Số điện thoại phải đủ 10 số và bắt đầu bằng số 0.' });
      phone = clean;
    }
    const people: CoEntry[] = (Array.isArray(customer.co_people) ? customer.co_people : [])
      .map((x: any) => ({ name: String(x?.name ?? ''), phone: String(x?.phone ?? ''), ...(cleanCoPref(x?.oa) ? { oa: cleanCoPref(x?.oa) } : {}) })).filter((x: any) => x.name);
    const idx = people.findIndex((x) => samePerson(x.name, personName));
    if (idx >= 0) people[idx] = { ...people[idx], name: people[idx].name, phone };
    else people.push({ name: String((named[0] as any).heir_name || personName).replace(/\s+/g, ' ').trim(), phone });
    const { error: upErr } = await admin.from('customers').update({ co_people: people }).eq('id', customerId);
    if (upErr) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    const changed: { id: string; oaToMain: boolean; oaToCo: boolean; oaCoKey: string | null }[] = [];
    if (!phone) {
      for (const c of named as any[]) {
        if (c.oa_to_co !== true) continue;
        await admin.from('contracts').update({ oa_to_co: false, oa_co_key: null, oa_to_main: true }).eq('id', c.id);
        changed.push({ id: c.id, oaToMain: true, oaToCo: false, oaCoKey: null });
      }
    }
    await logActivity(caller.id, caller.name || caller.username, caller.username, 'save-co-phone',
      `${phone ? 'Lưu' : 'Xóa'} số điện thoại người cùng vay "**${personName}**" của khách hàng "**${customer.name || customerId}**"`);
    return json({ ok: true, people, contracts: changed });
  }

  if (body.type === 'save-main-phone') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || selfClaims.app_role !== 'admin') return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    const { data: caller, error: callerErr } = await admin.from('admins').select('*').eq('id', selfClaims.row_id).maybeSingle();
    if (callerErr || !caller) return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    const isSuperCaller = caller.role === 'super';
    const canOa = isSuperCaller || caller.can_manage_zalo_oa === true;
    if (!canOa && caller.can_manage_users !== true) return json({ ok: false, reason: 'Bạn không có quyền nhập số điện thoại cho khách hàng.' }, 403);
    const customerId = String(body.customerId || '').trim();
    if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
    const { data: customer } = await admin.from('customers').select('*').eq('id', customerId).maybeSingle();
    if (!customer) return json({ ok: false, reason: 'Không tìm thấy khách hàng.' }, 404);
    if (!isSuperCaller) {
      const allowedThon: string[] = caller.allowed_thon || [];
      const allowedXom: string[] = caller.allowed_xom || [];
      if (!(allowedThon.includes(customer.thon) || allowedXom.includes(`${customer.thon}||${customer.xom}`))) {
        return json({ ok: false, reason: 'Bạn không có quyền với khách hàng này.' }, 403);
      }
    }
    if (String(customer.phone ?? '').trim()) return json({ ok: false, reason: 'Người vay đã có số điện thoại.' });
    const clean = cleanVnPhone(body.phone);
    if (!clean) return json({ ok: false, reason: 'Số điện thoại phải đủ 10 số và bắt đầu bằng số 0.' });
    const coPeople: any[] = Array.isArray(customer.co_people) ? customer.co_people : [];
    if (coPeople.some((x: any) => samePhone(x?.phone, clean))) return json({ ok: false, reason: 'Trùng số của người cùng vay.' });
    const { error: upErr } = await admin.from('customers').update({ phone: clean }).eq('id', customerId);
    if (upErr) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(caller.id, caller.name || caller.username, caller.username, 'save-main-phone',
      `Nhập số điện thoại cho người vay "**${customer.name || customerId}**" (chưa có số)`);
    return json({ ok: true, phone: clean });
  }

  if (body.type === 'import-co-phones') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || selfClaims.app_role !== 'admin') return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    const { data: caller, error: callerErr } = await admin.from('admins').select('*').eq('id', selfClaims.row_id).maybeSingle();
    if (callerErr || !caller) return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    const isSuperCaller = caller.role === 'super';
    if (!(isSuperCaller || caller.can_manage_zalo_oa === true || caller.can_manage_users === true)) return json({ ok: false, reason: 'Bạn không có quyền nhập số điện thoại người cùng vay.' }, 403);
    const items: any[] = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return json({ ok: false, reason: 'File không có dòng nào để nhập.' }, 400);
    if (items.length > 5000) return json({ ok: false, reason: 'File quá nhiều dòng (tối đa 5000 dòng một lần).' }, 400);
    const previewOnly = body.preview === true;
    const overwrite = body.overwrite === true;

    const codes = [...new Set(items.map((it) => String(it?.code ?? '').trim()).filter(Boolean))];
    const ctByCode = new Map<string, any>();
    for (const part of chunkArray(codes, 150)) {
      const { data, error } = await admin.from('contracts').select('id, code, customer_id, heir_name, balance').in('code', part);
      if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
      for (const c of data || []) {
        const old = ctByCode.get((c as any).code);
        if (!old || (!(Number(old.balance) > 0) && Number((c as any).balance) > 0)) ctByCode.set((c as any).code, c);
      }
    }
    const custIds = [...new Set([...ctByCode.values()].map((c: any) => c.customer_id as string))];
    const custById = new Map<string, any>();
    for (const part of chunkArray(custIds, 150)) {
      const { data, error } = await admin.from('customers').select('*').in('id', part);
      if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
      for (const c of data || []) custById.set((c as any).id, c);
    }
    if ([...custById.values()].some((c: any) => !('co_people' in c))) return json({ ok: false, reason: 'Chưa chạy SQL gửi Zalo OA theo từng hợp đồng trên Supabase (docs mục 10.83).' }, 500);
    const allowedThon: string[] = caller.allowed_thon || [];
    const allowedXom: string[] = caller.allowed_xom || [];
    const inScope = (cust: any) => isSuperCaller || allowedThon.includes(cust.thon) || allowedXom.includes(`${cust.thon}||${cust.xom}`);
    const working = new Map<string, CoEntry[]>();
    const touched = new Set<string>();
    const counts: Record<string, number> = {};
    const rows: any[] = [];
    for (const it of items) {
      const code = String(it?.code ?? '').trim();
      if (!code) continue;
      const row = Number(it?.row) || 0;
      const bump = (status: string, extra: Record<string, unknown> = {}) => { counts[status] = (counts[status] || 0) + 1; rows.push({ row, code, status, ...extra }); };
      const phone = phoneFromFile(it?.phone);
      if (phone === '') { bump('nophone'); continue; }
      const ct = ctByCode.get(code);
      if (!ct) { bump('nocontract'); continue; }
      const cust = custById.get(ct.customer_id);
      if (!cust) { bump('nocontract'); continue; }
      if (!inScope(cust)) { bump('noscope', { customer: cust.name }); continue; }
      if (!(Number(ct.balance) > 0)) { bump('settled', { customer: cust.name }); continue; }
      const coName = heirOfRow(ct, cust.name);
      if (!coName) { bump('noheir', { customer: cust.name }); continue; }
      if (phone === null) { bump('badphone', { customer: cust.name, person: coName }); continue; }
      if (samePhone(phone, cust.phone)) { bump('samemain', { customer: cust.name, person: coName, phone }); continue; }
      const people = working.get(cust.id) || mergeCoBooks(cust.co_people, []);
      working.set(cust.id, people);
      const entry = people.find((x) => samePerson(x.name, coName));
      const current = entry ? entry.phone : '';
      if (current && samePhone(current, phone)) { bump('same', { customer: cust.name, person: coName, phone }); continue; }
      if (current && !overwrite) { bump('conflict', { customer: cust.name, person: coName, phone, current }); continue; }
      if (entry) entry.phone = phone; else people.push({ name: coName, phone });
      touched.add(cust.id);
      bump(current ? 'replaced' : 'added', { customer: cust.name, person: coName, phone, ...(current ? { current } : {}) });
    }
    const updated = [...touched].map((id) => ({ id, people: (working.get(id) || []).map((x) => ({ name: x.name, phone: x.phone })) }));
    if (!previewOnly && updated.length) {
      let failed = 0;
      await mapLimit([...touched], 8, async (id) => {
        const { error } = await admin.from('customers').update({ co_people: working.get(id) }).eq('id', id);
        if (error) { failed++; console.error('Lỗi lưu số người cùng vay từ file:', error.message); }
      });
      if (failed) return json({ ok: false, reason: `Lưu chưa trọn vẹn: ${failed}/${updated.length} khách bị lỗi — bấm lưu lại (số đã lưu được giữ nguyên).` }, 500);
      await logActivity(caller.id, caller.name || caller.username, caller.username, 'import-co-phones',
        `Nhập số điện thoại người cùng vay từ file: lưu **${(counts.added || 0) + (counts.replaced || 0)}** số cho **${updated.length}** khách hàng`);
    }
    return json({ ok: true, preview: previewOnly, overwrite, total: rows.length, customers: touched.size, counts, rows: rows.filter((r) => r.status !== 'same' && r.status !== 'nophone').slice(0, 400), updated: previewOnly ? [] : updated });
  }

  if (body.type === 'list-zalo-auto-overview') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || selfClaims.app_role !== 'admin') {
      return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    }
    const { data: caller, error: callerError } = await admin.from('admins')
      .select('role, can_manage_zalo_oa').eq('id', selfClaims.row_id).maybeSingle();
    if (callerError || !caller) return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    if (caller.role !== 'super' && caller.can_manage_zalo_oa !== true) {
      return json({ ok: false, reason: 'Bạn không có quyền quản lý gửi tin Zalo OA.' }, 403);
    }
    const { data: rows, error: rowsError } = await admin.from('zalo_auto_send_list')
      .select('id, customer_id, contract_id, kind, created_by').limit(5000);
    if (rowsError) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    const ownerIds = [...new Set((rows || []).map((r: any) => r.created_by).filter(Boolean))];
    const { data: owners } = ownerIds.length
      ? await admin.from('admins').select('id, name, username').in('id', ownerIds)
      : { data: [] };
    const ownerName = new Map((owners || []).map((a: any) => [a.id, a.name || a.username || '']));
    return json({
      ok: true,
      rows: (rows || []).map((r: any) => ({
        id: r.id, customerId: r.customer_id, contractId: r.contract_id, kind: r.kind,
        createdBy: r.created_by || null, createdByName: ownerName.get(r.created_by) || '',
      })),
    });
  }

  if (body.type === 'get-zalo-auto-send-status') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || selfClaims.app_role !== 'admin') {
      return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    }
    const { data: caller, error: callerError } = await admin.from('admins')
      .select('role, allowed_thon, allowed_xom').eq('id', selfClaims.row_id).maybeSingle();
    if (callerError || !caller) return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    const contractId = String(body.contractId || '').trim();
    if (!contractId) return json({ ok: false, reason: 'Thiếu mã hợp đồng.' }, 400);
    const { data: contract, error: contractError } = await admin.from('contracts')
      .select('customer_id').eq('id', contractId).maybeSingle();
    if (contractError) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    if (!contract) return json({ ok: false, reason: 'Không tìm thấy hợp đồng.' }, 404);
    if (caller.role !== 'super') {
      const { data: customer, error: customerError } = await admin.from('customers')
        .select('thon, xom').eq('id', contract.customer_id).maybeSingle();
      if (customerError) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
      const allowedThon: string[] = caller.allowed_thon || [];
      const allowedXom: string[] = caller.allowed_xom || [];
      if (!customer || !(allowedThon.includes(customer.thon) || allowedXom.includes(`${customer.thon}||${customer.xom}`))) {
        return json({ ok: false, reason: 'Bạn không có quyền xem hợp đồng này.' }, 403);
      }
    }
    const { data: selection, error: selectionError } = await admin.from('zalo_auto_send_list')
      .select('interval_months').eq('contract_id', contractId).maybeSingle();
    if (selectionError) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    return json({ ok: true, enabled: !!selection, intervalMonths: selection?.interval_months || null });
  }

  if (body.type === 'add-zalo-auto-send' || body.type === 'remove-zalo-auto-send' || body.type === 'send-zalo-manual' || body.type === 'send-zalo-manual-asof'
    || body.type === 'add-zalo-customer' || body.type === 'remove-zalo-customer' || body.type === 'update-zalo-auto-send-settings') {
    const authHeader = req.headers.get('Authorization') || '';
    const selfToken = authHeader.replace(/^Bearer\s+/i, '');
    const selfClaims = selfToken ? await verifyJwt(selfToken) : null;
    if (!selfClaims || selfClaims.app_role !== 'admin') {
      return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    }

    const prefetchContractId = body.type === 'add-zalo-auto-send' ? String(body.contractId || '').trim() : '';
    const [{ data: caller, error: callerErr }, prefetched] = await Promise.all([
      admin.from('admins').select('*').eq('id', selfClaims.row_id).maybeSingle(),
      prefetchContractId ? loadContractWithCustomer(prefetchContractId) : Promise.resolve(null),
    ]);
    if (callerErr || !caller) return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
    if (caller.role !== 'super' && caller.can_manage_zalo_oa !== true) {
      return json({ ok: false, reason: 'Bạn không có quyền quản lý gửi tin Zalo OA — liên hệ quản trị viên toàn quyền để được cấp quyền.' }, 403);
    }

    async function checkContractInScope(contractId: string): Promise<{ ok: boolean; contract?: any; customer?: any }> {
      const loaded = prefetched && contractId === prefetchContractId ? prefetched : await loadContractWithCustomer(contractId);
      if (!loaded) return { ok: false };
      const { contract, customer } = loaded;
      if (caller.role !== 'super') {
        const allowedThon: string[] = caller.allowed_thon || [];
        const allowedXom: string[] = caller.allowed_xom || [];
        const inScope = allowedThon.includes(customer.thon) || allowedXom.includes(`${customer.thon}||${customer.xom}`);
        if (!inScope) return { ok: false };
      }
      return { ok: true, contract, customer };
    }

    async function checkCustomerInScope(customerId: string): Promise<{ ok: boolean; customer?: any }> {
      const { data: customer } = await admin.from('customers').select('*').eq('id', customerId).maybeSingle();
      if (!customer) return { ok: false };
      if (caller.role !== 'super') {
        const allowedThon: string[] = caller.allowed_thon || [];
        const allowedXom: string[] = caller.allowed_xom || [];
        const inScope = allowedThon.includes(customer.thon) || allowedXom.includes(`${customer.thon}||${customer.xom}`);
        if (!inScope) return { ok: false };
      }
      return { ok: true, customer };
    }

    async function ensureZaloCustomer(customerId: string) {
      await admin.from('zalo_customers').insert({ customer_id: customerId, added_by: caller.id }).select().maybeSingle();

      await clearCoPrevName(customerId);
    }

    if (body.type === 'add-zalo-customer') {
      const customerId = String(body.customerId || '').trim();
      if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
      const scope = await checkCustomerInScope(customerId);
      if (!scope.ok) return json({ ok: false, reason: 'Không tìm thấy khách hàng hoặc bạn không có quyền với khách hàng này.' }, 403);
      const { data: existing } = await admin.from('zalo_customers').select('customer_id').eq('customer_id', customerId).maybeSingle();
      if (existing) return json({ ok: false, reason: 'Khách hàng này đã có trong danh sách OA rồi.' });

      if (!String(scope.customer?.phone ?? '').trim()) {
        const { data: ctRows } = await admin.from('contracts').select('heir_name').eq('customer_id', customerId).gt('balance', 0);
        if (!customerHasOaPhone(ctRows || [], scope.customer)) {
          const hasCo = heirNamesOfRows(ctRows || [], String(scope.customer?.name ?? '')).length > 0;
          return json({ ok: false, reason: hasCo ? 'Người vay và người cùng vay đều chưa có số điện thoại nên chưa thêm được vào danh sách OA.' : 'Khách hàng chưa có số điện thoại nên chưa thêm được vào danh sách OA.' });
        }
      }
      const { error } = await admin.from('zalo_customers').insert({ customer_id: customerId, added_by: caller.id });
      if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
      await clearCoPrevName(customerId);
      await logActivity(caller.id, caller.name || caller.username, caller.username, 'add-zalo-customer', `Thêm khách hàng "**${scope.customer?.name || customerId}**" vào Danh sách OA`);
      return json({ ok: true });
    }

    if (body.type === 'remove-zalo-customer') {
      const customerId = String(body.customerId || '').trim();
      if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
      const scope = await checkCustomerInScope(customerId);
      if (!scope.ok) return json({ ok: false, reason: 'Bạn không có quyền với khách hàng này.' }, 403);

      const { error } = await admin.from('zalo_customers').delete().eq('customer_id', customerId);
      if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
      await logActivity(caller.id, caller.name || caller.username, caller.username, 'remove-zalo-customer', `Bỏ khách hàng "**${scope.customer?.name || customerId}**" khỏi Danh sách OA`);
      return json({ ok: true });
    }

    if (body.type === 'add-zalo-auto-send') {
      const contractId = String(body.contractId || '').trim();

      const kind = body.kind === 'lai_hang_thang_custom_day' ? 'lai_hang_thang_custom_day' : 'lai_hang_thang_auto';
      const customDay = kind === 'lai_hang_thang_custom_day' ? Number(body.customDay) || null : null;

      const intervalMonths = [1, 2, 3, 4].includes(Number(body.intervalMonths)) ? Number(body.intervalMonths) : 1;
      if (!contractId) return json({ ok: false, reason: 'Thiếu mã hợp đồng.' }, 400);

      if (kind === 'lai_hang_thang_custom_day' && (!customDay || customDay < 1 || customDay > 30)) {
        return json({ ok: false, reason: 'Ngày gửi không hợp lệ (1-30).' }, 400);
      }
      const scope = await checkContractInScope(contractId);
      if (!scope.ok) return json({ ok: false, reason: 'Không tìm thấy hợp đồng hoặc bạn không có quyền với hợp đồng này.' }, 403);
      if (scope.contract.oa_enabled === false) return json({ ok: false, reason: 'Hợp đồng này đang tắt gửi OA — bật lại ở chi tiết khách hàng (mục Gửi Zalo OA theo từng hợp đồng) rồi mới thêm vào gửi tự động.' });

      let customerAlreadyInOA = false;
      {
        const [{ data: sameCustomerRows, error: sameCustomerErr }, { data: zaloCustomerRow }] = await Promise.all([
          admin.from('zalo_auto_send_list').select('created_by').eq('customer_id', scope.contract.customer_id),
          admin.from('zalo_customers').select('customer_id').eq('customer_id', scope.contract.customer_id).maybeSingle(),
        ]);
        if (sameCustomerErr) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
        customerAlreadyInOA = !!zaloCustomerRow;
        const otherOwnerRow = (sameCustomerRows || []).find((r: any) => r.created_by !== caller.id);
        if (otherOwnerRow) {
          const { data: ownerAdmin } = otherOwnerRow.created_by
            ? await admin.from('admins').select('name, username').eq('id', otherOwnerRow.created_by).maybeSingle()
            : { data: null };
          const ownerName = ownerAdmin?.name || ownerAdmin?.username;
          return json({ ok: false, reason: `Khách hàng này đã được ${ownerName ? `"${ownerName}"` : 'người khác'} thêm vào gửi tự động rồi — mỗi khách hàng chỉ một người được thêm.` });
        }
      }

      if (!customerAlreadyInOA) await ensureZaloCustomer(scope.contract.customer_id);
      const { error } = await admin.from('zalo_auto_send_list').insert({
        id: genId('zas'), contract_id: contractId, customer_id: scope.contract.customer_id, kind, custom_day: customDay,
        interval_months: intervalMonths, created_by: caller.id,
      });
      if (error) {
        if (String(error.message || '').toLowerCase().includes('duplicate')) {

          const { data: existingRow } = await admin.from('zalo_auto_send_list').select('created_by, kind').eq('contract_id', contractId).maybeSingle();
          const { data: existingAdmin } = existingRow?.created_by
            ? await admin.from('admins').select('name').eq('id', existingRow.created_by).maybeSingle()
            : { data: null };
          const who = existingAdmin?.name ? `nhân viên "${existingAdmin.name}"` : 'người khác';
          const kindLabel = existingRow?.kind === 'lai_hang_thang_custom_day' ? 'Gửi theo ngày cụ thể' : 'Báo lãi tự động hàng tháng';
          return json({ ok: false, reason: `Hợp đồng này đã được ${who} thêm vào mục "${kindLabel}" rồi (1 hợp đồng chỉ ở được 1 trong 2 mục).` });
        }
        return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
      }
      const logPromise = logActivity(caller.id, caller.name || caller.username, caller.username, 'add-zalo-auto-send',
        `Thêm hợp đồng **${scope.contract?.code || contractId}** vào gửi tự động (**${kind === 'lai_hang_thang_custom_day' ? 'Gửi theo ngày cụ thể' : 'Báo lãi tự động hàng tháng'}**)`);

      const edgeRuntime = (globalThis as any).EdgeRuntime;
      if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') edgeRuntime.waitUntil(logPromise); else await logPromise;
      return json({ ok: true });
    }

    if (body.type === 'remove-zalo-auto-send') {
      const id = String(body.id || '').trim();
      if (!id) return json({ ok: false, reason: 'Thiếu mã.' }, 400);
      const { data: row } = await admin.from('zalo_auto_send_list').select('*').eq('id', id).maybeSingle();
      if (!row) return json({ ok: true });

      if (caller.role !== 'super' && row.created_by !== caller.id) {
        return json({ ok: false, reason: 'Bạn không có quyền bỏ lựa chọn của người khác.' }, 403);
      }
      const { error } = await admin.from('zalo_auto_send_list').delete().eq('id', id);
      if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
      const { data: rowContract } = await admin.from('contracts').select('code').eq('id', row.contract_id).maybeSingle();
      await logActivity(caller.id, caller.name || caller.username, caller.username, 'remove-zalo-auto-send', `Bỏ hợp đồng **${rowContract?.code || row.contract_id}** khỏi gửi tự động`);
      return json({ ok: true });
    }

    if (body.type === 'update-zalo-auto-send-settings') {
      const id = String(body.id || '').trim();
      if (!id) return json({ ok: false, reason: 'Thiếu mã.' }, 400);
      const { data: row } = await admin.from('zalo_auto_send_list').select('*').eq('id', id).maybeSingle();
      if (!row) return json({ ok: false, reason: 'Không tìm thấy lựa chọn này (có thể đã bị xóa).' }, 404);
      if (caller.role !== 'super' && row.created_by !== caller.id) {
        return json({ ok: false, reason: 'Bạn không có quyền sửa lựa chọn của người khác.' }, 403);
      }
      const patch: Record<string, unknown> = {};
      if (body.intervalMonths !== undefined) {
        const intervalMonths = Number(body.intervalMonths);
        if (![1, 2, 3, 4].includes(intervalMonths)) return json({ ok: false, reason: 'Định kỳ không hợp lệ (chỉ 1-4 tháng).' }, 400);
        patch.interval_months = intervalMonths;
      }
      if (body.customDay !== undefined) {
        if (row.kind !== 'lai_hang_thang_custom_day') return json({ ok: false, reason: 'Chỉ mục "Gửi theo ngày cụ thể" mới sửa được ngày.' }, 400);
        const customDay = Number(body.customDay) || null;
        if (!customDay || customDay < 1 || customDay > 30) return json({ ok: false, reason: 'Ngày không hợp lệ (1-30).' }, 400);
        patch.custom_day = customDay;
      }
      if (!Object.keys(patch).length) return json({ ok: false, reason: 'Không có gì để sửa.' }, 400);
      const { error } = await admin.from('zalo_auto_send_list').update(patch).eq('id', id);
      if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
      const { data: rowContract } = await admin.from('contracts').select('code').eq('id', row.contract_id).maybeSingle();
      await logActivity(caller.id, caller.name || caller.username, caller.username, 'update-zalo-auto-send-settings', `Sửa cài đặt gửi tự động của hợp đồng **${rowContract?.code || row.contract_id}**`);
      return json({ ok: true });
    }

    if (body.type === 'send-zalo-manual' || body.type === 'send-zalo-manual-asof') {
      const contractId = String(body.contractId || '').trim();
      if (!contractId) return json({ ok: false, reason: 'Thiếu thông tin.' }, 400);
      const now = new Date();
      const wantsAsOf = body.type === 'send-zalo-manual-asof';
      const asOfText = wantsAsOf ? String(body.asOf || '') : '';
      const asOfDate = asOfText ? new Date(asOfText) : null;
      if (wantsAsOf && (!/^\d{4}-\d{2}-\d{2}$/.test(asOfText) || !asOfDate || Number.isNaN(asOfDate.getTime()) || asOfDate.toISOString().slice(0, 10) !== asOfText)) {
        return json({ ok: false, reason: 'Ngày tính lãi không hợp lệ.' }, 400);
      }

      const [contractRes, lastLogRes, orgRowRes, accessToken] = await Promise.all([
        admin.from('contracts').select('*').eq('id', contractId).maybeSingle(),
        admin.from('zalo_send_log').select('sent_at')
          .eq('contract_id', contractId).eq('status', 'success')
          .order('sent_at', { ascending: false }).limit(1).maybeSingle(),
        admin.from('orgs').select('zalo_template_due_id, zalo_template_interest_id, zalo_near_due_days').limit(1).maybeSingle(),
        getZaloAccessToken(),
      ]);
      const contract = contractRes.data;
      if (!contract) return json({ ok: false, reason: 'Không tìm thấy hợp đồng hoặc bạn không có quyền với hợp đồng này.' }, 403);
      if (!accessToken) return json({ ok: false, reason: 'Chưa cấu hình kết nối Zalo OA trên server (thiếu Secret/Refresh Token) — liên hệ để cấu hình trước.' }, 500);

      const [customerRes, zaloCustRes] = await Promise.all([
        admin.from('customers').select('*').eq('id', contract.customer_id).maybeSingle(),
        admin.from('zalo_customers').select('customer_id').eq('customer_id', contract.customer_id).maybeSingle(),
      ]);
      const customer = customerRes.data;
      if (!customer) return json({ ok: false, reason: 'Không tìm thấy hợp đồng hoặc bạn không có quyền với hợp đồng này.' }, 403);
      if (caller.role !== 'super') {
        const allowedThon: string[] = caller.allowed_thon || [];
        const allowedXom: string[] = caller.allowed_xom || [];
        const inScope = allowedThon.includes(customer.thon) || allowedXom.includes(`${customer.thon}||${customer.xom}`);
        if (!inScope) return json({ ok: false, reason: 'Không tìm thấy hợp đồng hoặc bạn không có quyền với hợp đồng này.' }, 403);
      }

      const recipients = manualRecipients(contract, customer);
      if (!recipients.length) return json({ ok: false, reason: 'Khách hàng này chưa có số điện thoại.' });

      if (!zaloCustRes.data) {
        return json({ ok: false, reason: 'Khách hàng chưa có trong Danh sách OA — vào chi tiết khách hàng (mục Khách hàng & Hợp đồng) để thêm vào OA trước khi gửi.' });
      }

      const lastLog = lastLogRes.data;
      if (lastLog?.sent_at) {
        const daysSinceLast = daysBetweenZalo(new Date(lastLog.sent_at), now);
        if (daysSinceLast < 5) {
          return json({ ok: false, reason: `Hợp đồng này đã gửi Zalo gần nhất vào ngày ${formatDateVNZalo(lastLog.sent_at)} — phải đợi đủ 5 ngày mới gửi lại được (còn ${5 - daysSinceLast} ngày nữa).` });
        }
      }

      const orgRow = orgRowRes.data;
      const usesDueTemplate = isNearOrPastDueZalo(contract, now, orgRow?.zalo_near_due_days || DEFAULT_NEAR_DUE_DAYS_ZALO);
      const templateId = usesDueTemplate ? orgRow?.zalo_template_due_id : orgRow?.zalo_template_interest_id;
      const kind = usesDueTemplate ? 'den_han' : 'lai_hang_thang';
      if (!templateId) {
        return json({ ok: false, reason: `Chưa cấu hình Template ID cho mẫu "${usesDueTemplate ? 'Đến hạn' : 'Báo lãi'}" — vào Quản lý OA > Cấu hình để điền trước.` }, 500);
      }

      if (asOfDate) {
        const asOfDays = interestDaysRawZalo(contract, asOfDate);
        if (asOfDays < 0 || asOfDays > 3650) return json({ ok: false, reason: 'Ngày tính lãi nằm ngoài khoảng cho phép của hợp đồng này.' }, 400);
      }
      const interest = accruedInterestZalo(contract, asOfDate || now);

      const instForGoc = usesDueTemplate ? nextInstallmentInfoZalo(contract, now) : null;
      const goc = usesDueTemplate ? (instForGoc ? instForGoc.next.dueAmount : Number(contract.balance)) : 0;
      const total = goc + interest;
      const dueDateForZalo = asOfText || (instForGoc ? instForGoc.next.dueDate : contract.due_date);
      const nameNoDiacritics = stripDiacriticsUpper(customer.name || '');
      const templateData = {
        TEN_KHACH_HANG: customer.name || '',
        SO_HDTD: contract.code,
        SO_KHE_UOC: contract.code,
        SO_DU: formatVNDZaloTemplate(contract.balance),
        GOC_PHAI_TRA: formatVNDZaloTemplate(goc),
        LAI_PHAI_TRA: formatVNDZaloTemplate(interest),
        SO_TIEN_CHUYEN_KHOAN: formatVNDZaloTemplate(total),
        NOI_DUNG_CHUYEN_KHOAN: stripDiacriticsUpper(`TRA ${usesDueTemplate ? '' : 'LAI '}HDTD ${contract.code} ${nameNoDiacritics}`),
        NGAY_DAO_HAN: formatDateVNZalo(dueDateForZalo),

        NGAY_KE_HOACH: formatDateVNZalo(now.toISOString()),
      };
      const results = await Promise.all(recipients.map((r) => sendZaloTemplateLogged({
        accessToken, phone: r.phone, templateId, templateData,
        contractId, customerId: customer.id, kind, triggeredBy: 'manual', triggeredByAdminId: caller.id,
        who: r.who, whoName: r.who === 'co' ? heirOfRow(contract, customer.name) : String(customer.name || ''),
        deferNoAccount: true,
      })));
      const sentCount = results.filter((r) => r.ok).length;
      const failedRecipients = recipients.map((r, i) => ({ who: r.who, res: results[i] })).filter((x) => !x.res.ok);

      const { unticked, removed } = await applyNoZaloResults(customer.id, contractId, failedRecipients.filter((x) => x.res.noAccount).map((x) => x.who));
      const untickNote = removed ? ' Không còn số nào có Zalo — đã tự bỏ khách khỏi danh sách OA.'
        : unticked.length ? ` Đã tự bỏ tích gửi OA cho ${unticked.map((w) => (w === 'co' ? 'người cùng vay' : 'người vay')).join(' và ')}.` : '';
      const result: { ok: boolean; reason?: string } = sentCount
        ? { ok: true }
        : { ok: false, reason: [...new Set(failedRecipients.map((x) => `${recipients.length > 1 ? (x.who === 'co' ? 'Người cùng vay: ' : 'Người vay: ') : (x.who === 'co' ? 'Người cùng vay: ' : '')}${x.res.reason || 'Gửi thất bại.'}`))].join(' · ') + untickNote };

      if (result.ok) {
        const sentWho = recipients.filter((_, i) => results[i].ok).map((r) => (r.who === 'co' ? 'người cùng vay' : 'người vay'));
        logActivity(caller.id, caller.name || caller.username, caller.username, 'send-zalo-manual',
          `Gửi tay Zalo OA (mẫu **${usesDueTemplate ? 'Đến hạn' : 'Báo lãi'}**) cho khách hàng "**${customer.name || contractId}**"${recipients.length > 1 || recipients[0].who === 'co' ? ` — tới ${sentWho.join(' và ')}` : ''}${asOfText ? `, tính lãi đến **${formatDateVNZalo(asOfText)}**` : ''}`)
          .catch((e) => console.error('Lỗi ghi activity_log (send-zalo-manual):', e));
      }
      if (!result.ok) return json({ ok: false, reason: result.reason });
      const failNote = failedRecipients.length
        ? `Chưa gửi được cho ${failedRecipients.map((x) => (x.who === 'co' ? 'người cùng vay' : 'người vay')).join(', ')}: ${failedRecipients[0].res.reason || 'Gửi thất bại.'}.${untickNote}`
        : '';
      return json({ ok: true, sent: sentCount, sentTo: sentCount > 1 ? 'both' : recipients[results.findIndex((r) => r.ok)].who, ...(asOfText ? { asOf: asOfText } : {}), ...(failNote ? { note: failNote } : {}) });
    }
  }

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const claims = token ? await verifyJwt(token) : null;
  if (!claims || claims.app_role !== 'admin') {
    return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
  }
  const { data: callerAdmin, error: callerErr } = await admin.from('admins').select('*').eq('id', claims.row_id).maybeSingle();
  if (callerErr || !callerAdmin) {
    return json({ ok: false, reason: 'Chưa đăng nhập hoặc phiên đã hết hạn.' }, 401);
  }
  const isSuper = callerAdmin.role === 'super';

  const canManageUsers = isSuper || callerAdmin.can_manage_users === true;

  if (body.type === 'get-management-provision') {
    if (!isSuper && callerAdmin.can_view_balance_sheet !== true) {
      return json({ ok: false, reason: 'Không có quyền xem số liệu Quản trị.' }, 403);
    }
    const yearMonth = String(body.yearMonth || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
      return json({ ok: false, reason: 'Tháng không hợp lệ.' }, 400);
    }
    const { data: snapshot, error: snapshotError } = await admin.from('monthly_snapshots')
      .select('total_balance, group_balances, general_provision, specific_provision, contracts_detail')
      .eq('year_month', yearMonth).maybeSingle();
    if (snapshotError) return json({ ok: false, reason: 'Không đọc được số dự phòng đã chốt.' }, 500);
    if (snapshot?.general_provision != null && snapshot?.specific_provision != null) {
      return json({ ok: true, generalProvision: Number(snapshot.general_provision), specificProvision: Number(snapshot.specific_provision) });
    }
    const details = snapshot?.contracts_detail;
    if (Array.isArray(details) && details.length && snapshot?.group_balances) {
      const detailBalance = details.reduce((sum: number, ct: any) => sum + (Number(ct.balance) || 0), 0);
      if (Math.abs(detailBalance - (Number(snapshot.total_balance) || 0)) <= 1) {
        const generalBase = [1, 2, 3, 4].reduce((sum, group) => sum + (Number(snapshot.group_balances[String(group)]) || 0), 0);
        const specificProvision = details.reduce((sum: number, ct: any) => {
          const rate = PROVISION_SPECIFIC_RATE[Number(ct.group)] || 0;
          const factor = collateralDeductionRate({ has_collateral: ct.hasCollateral, collateral_type: ct.collateralType });
          return sum + Math.max(0, (Number(ct.balance) || 0) - (Number(ct.collateralValue) || 0) * factor) * rate;
        }, 0);
        return json({ ok: true, generalProvision: generalBase * PROVISION_GENERAL_RATE, specificProvision });
      }
    }

    let generalBase = 0;
    let specificProvision = 0;
    const now = new Date();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from('contracts')
        .select('id, principal, balance, disbursed_date, due_date, installment_schedule, has_collateral, collateral_type, collateral_value')
        .order('id').range(from, from + 999);
      if (error) return json({ ok: false, reason: 'Không đọc đủ hợp đồng để tính dự phòng.' }, 500);
      for (const ct of data || []) {
        const group = debtGroupZalo(ct, now);
        if (group === null) continue;
        const balance = Number(ct.balance) || 0;
        if (group <= 4) generalBase += balance;
        const rate = PROVISION_SPECIFIC_RATE[group];
        if (rate) specificProvision += Math.max(0, balance - (Number(ct.collateral_value) || 0) * collateralDeductionRate(ct)) * rate;
      }
      if ((data || []).length < 1000) break;
    }
    return json({ ok: true, generalProvision: generalBase * PROVISION_GENERAL_RATE, specificProvision });
  }

  const SUPER_ONLY_TYPES = [
    'update-customer-profile', 'delete-contract', 'import', 'import-supplement', 'update-staff-role',
    'import-preview', 'import-supplement-preview', 'import-history', 'import-history-detail', 'import-rollback',
    'staff', 'reset-staff-password', 'update-staff-permissions', 'delete-staff', 'force-logout-staff',
    'update-staff-name',

    'deactivate-customer', 'delete-customer',

    'capture-monthly-snapshot', 'sync-historical-collateral',

    'import-historical-snapshot',
  ];
  if (SUPER_ONLY_TYPES.includes(body.type) && !isSuper) {
    return json({ ok: false, reason: 'Chỉ quản trị viên toàn quyền mới được thực hiện thao tác này.' }, 403);
  }

  if (!canManageUsers) {
    return json({ ok: false, reason: 'Bạn không có quyền thực hiện thao tác này — liên hệ quản trị viên toàn quyền để được cấp quyền "Quản lý User".' }, 403);
  }

  if (body.type === 'sync-historical-collateral') {
    const result = await syncHistoricalCollateral(admin);
    return result.error
      ? json({ ok: false, reason: 'Không đồng bộ được TSBĐ các tháng cũ: ' + result.error }, 500)
      : json({ ok: true, updated: result.updated });
  }

  if (body.type === 'update-staff-role') {
    const staffId = String(body.staffId || '').trim();
    const newRole = body.role === 'super' ? 'super' : 'staff';
    if (!staffId) return json({ ok: false, reason: 'Thiếu mã tài khoản.' }, 400);
    const { data: target } = await admin.from('admins').select('role, name, username').eq('id', staffId).maybeSingle();
    if (!target) return json({ ok: false, reason: 'Không tìm thấy tài khoản.' }, 404);
    if (target.role === 'super' && newRole === 'staff') {
      const { count } = await admin.from('admins').select('id', { count: 'exact', head: true }).eq('role', 'super');
      if ((count || 0) <= 1) return json({ ok: false, reason: 'Phải giữ lại ít nhất 1 quản trị viên toàn quyền.' }, 409);
    }
    const { error } = await admin.from('admins').update({ role: newRole }).eq('id', staffId);
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'update-staff-role',
      `Đổi vai trò tài khoản "**${target.name || target.username}**" thành **${newRole === 'super' ? 'Toàn quyền' : 'Nhân viên'}**`);
    return json({ ok: true });
  }

  if (body.type === 'capture-monthly-snapshot') {
    const now = new Date();
    async function readAllForSnapshot(table: 'contracts' | 'customers', columns: string) {
      const rows: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await admin.from(table).select(columns).order('id').range(from, from + 999);
        if (error) return { data: null, error };
        rows.push(...(data || []));
        if ((data || []).length < 1000) return { data: rows, error: null };
      }
    }
    const [{ data: allContracts, error: ctErr }, { data: customers, error: customersError }] = await Promise.all([
      readAllForSnapshot('contracts', '*'), readAllForSnapshot('customers', 'id, name, thon, xom, tinh, address'),
    ]);
    if (ctErr || customersError) return json({ ok: false, reason: 'Không đọc đủ dữ liệu để chốt tháng; chưa lưu số liệu.' }, 500);

    const custMap = new Map<string, any>((customers || []).map((c: any) => [c.id, c]));
    const groupBalances: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    let totalBalance = 0;
    let interestReceivable = 0;

    let generalBase = 0;
    let specificProvision = 0;
    const contractsDetail: any[] = [];
    for (const ct of allContracts || []) {
      const g = debtGroupZalo(ct, now);
      if (g === null) continue;
      const balance = Number(ct.balance) || 0;
      groupBalances[String(g)] += balance;
      totalBalance += balance;

      if (g === 1) interestReceivable += accruedInterestZalo(ct, now);
      if (g <= 4) generalBase += balance;
      const rate = PROVISION_SPECIFIC_RATE[g];
      if (rate) {
        const deductible = (Number(ct.collateral_value) || 0) * collateralDeductionRate(ct);
        specificProvision += Math.max(0, balance - deductible) * rate;
      }
      const cust = custMap.get(ct.customer_id);
      const attention = contractAttentionZalo(ct, now);
      contractsDetail.push({
        code: ct.code || null,
        name: cust?.name || null,
        address: (cust && [cust.thon, cust.xom, cust.tinh].filter(Boolean).join(', ')) || cust?.address || null,
        balance,
        group: g,
        daysOverdue: daysOverdueZalo(ct, now),

        attention: attention.level,
        attentionDays: attention.days,
        attentionAmount: attention.dueAmount,
        hasCollateral: !!ct.has_collateral,
        collateralValue: Number(ct.collateral_value) || 0,
        collateralType: ct.collateral_type || null,
        loanTerm: ct.loan_term || null,
        loanPurpose: ct.loan_purpose || null,
      });
    }
    const badDebtBalance = groupBalances['3'] + groupBalances['4'] + groupBalances['5'];
    const badDebtRatio = totalBalance > 0 ? (badDebtBalance / totalBalance) * 100 : 0;
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const { error } = await admin.from('monthly_snapshots').upsert({
      year_month: yearMonth,
      snapshot_date: toLocalISODateZalo(now),
      total_balance: totalBalance,
      interest_receivable: interestReceivable,
      group_balances: groupBalances,
      bad_debt_balance: badDebtBalance,
      bad_debt_ratio: badDebtRatio,
      general_provision: generalBase * PROVISION_GENERAL_RATE,
      specific_provision: specificProvision,
      contracts_detail: contractsDetail,
    }, { onConflict: 'year_month' });
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'capture-monthly-snapshot',
      `Chốt số liệu dashboard Tổng quan cho tháng **${yearMonth}**`);
    return json({ ok: true });
  }

  if (body.type === 'import-historical-snapshot') {
    const yearMonth = String(body.yearMonth || '');
    const snapshotDate = String(body.snapshotDate || '');
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) return json({ ok: false, reason: 'Tháng không hợp lệ.' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) return json({ ok: false, reason: 'Ngày chốt không hợp lệ.' }, 400);
    const totalBalance = Number(body.totalBalance);
    const interestReceivable = Number(body.interestReceivable);
    const badDebtBalance = Number(body.badDebtBalance);
    const badDebtRatio = Number(body.badDebtRatio);
    const groupBalancesIn = body.groupBalances && typeof body.groupBalances === 'object' ? body.groupBalances : {};
    const groupBalances: Record<string, number> = {};
    for (const g of ['1', '2', '3', '4', '5']) {
      const v = Number(groupBalancesIn[g]);
      if (!Number.isFinite(v) || v < 0) return json({ ok: false, reason: 'Số liệu nhóm nợ không hợp lệ.' }, 400);
      groupBalances[g] = v;
    }
    if (![totalBalance, interestReceivable, badDebtBalance, badDebtRatio].every((n) => Number.isFinite(n) && n >= 0)) {
      return json({ ok: false, reason: 'Số liệu không hợp lệ.' }, 400);
    }

    const generalProvision = Number.isFinite(Number(body.generalProvision)) && Number(body.generalProvision) >= 0 ? Number(body.generalProvision) : null;
    const specificProvision = Number.isFinite(Number(body.specificProvision)) && Number(body.specificProvision) >= 0 ? Number(body.specificProvision) : null;

    const contractsDetail = Array.isArray(body.contractsDetail) ? body.contractsDetail : [];
    const { error } = await admin.from('monthly_snapshots').upsert({
      year_month: yearMonth,
      snapshot_date: snapshotDate,
      total_balance: totalBalance,
      interest_receivable: interestReceivable,
      group_balances: groupBalances,
      bad_debt_balance: badDebtBalance,
      bad_debt_ratio: badDebtRatio,
      general_provision: generalProvision,
      specific_provision: specificProvision,
      contracts_detail: contractsDetail,
    }, { onConflict: 'year_month' });
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'import-historical-snapshot',
      `Nạp dữ liệu cũ cho tháng **${yearMonth}** (đến ngày ${snapshotDate.split('-').reverse().join('/')})`);
    return json({ ok: true });
  }

  if (body.type === 'update-staff-name') {
    const staffId = String(body.staffId || '').trim();
    const name = String(body.name || '').trim();
    if (!staffId) return json({ ok: false, reason: 'Thiếu mã tài khoản.' }, 400);
    if (!name) return json({ ok: false, reason: 'Tên không được để trống.' }, 400);
    const { data: target } = await admin.from('admins').select('name, username').eq('id', staffId).maybeSingle();
    if (!target) return json({ ok: false, reason: 'Không tìm thấy tài khoản.' }, 404);
    const { error } = await admin.from('admins').update({ name }).eq('id', staffId);
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'update-staff-name',
      `Đổi tên hiển thị tài khoản "${target.name || target.username}" thành "**${name}**"`);
    return json({ ok: true });
  }

  if (body.type === 'customer') {
    const cccd = String(body.cccd || '').trim();
    if (!cccd) return json({ ok: false, reason: 'Cần nhập số CCCD.' }, 400);
    const phone = body.phone ? String(body.phone).replace(/\s/g, '') : '';
    const finalPassword = body.password && String(body.password).trim() ? String(body.password).trim() : genTempPassword();
    const cred = await makeCredential(finalPassword);

    const { data: existing } = await admin.from('customers').select('*').eq('cccd', cccd).maybeSingle();
    if (existing && existing.salt && existing.hash) {
      return json({ ok: false, reason: 'Số CCCD này đã có tài khoản rồi — dùng chức năng cấp lại mật khẩu nếu cần đặt lại.' }, 409);
    }

    let customerId: string;
    if (existing) {
      customerId = existing.id;
      const patch: Record<string, unknown> = { ...cred, must_change_password: true, failed_attempts: 0, locked_until: null };
      if (body.name) patch.name = body.name;
      if (phone) patch.phone = phone;
      const { error } = await admin.from('customers').update(patch).eq('id', customerId);
      if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    } else {
      customerId = genId('cust');
      const { error } = await admin.from('customers').insert({
        id: customerId, cccd, name: body.name || cccd, phone,
        salt: cred.salt, hash: cred.hash, must_change_password: true,
        failed_attempts: 0, locked_until: null,
      });
      if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    }

    const { data: newRow } = await admin.from('customers').select('*').eq('id', customerId).maybeSingle();
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'customer',
      `${existing ? 'Cấp lại mật khẩu (qua màn tạo tài khoản)' : 'Tạo tài khoản mới'} cho khách hàng "**${newRow?.name || cccd}**" (CCCD **${cccd}**)`);
    return json({ ok: true, id: customerId, tempPassword: finalPassword, customer: newRow });
  }

  if (body.type === 'staff') {
    const username = String(body.username || '').trim();
    if (!username) return json({ ok: false, reason: 'Cần nhập tên đăng nhập.' }, 400);

    const { data: existing } = await admin.from('admins').select('id').ilike('username', escapeLike(username)).maybeSingle();
    if (existing) return json({ ok: false, reason: 'Tên đăng nhập đã tồn tại.' }, 409);

    const finalRole = (isSuper && body.role === 'super') ? 'super' : 'staff';
    const finalPassword = body.password && String(body.password).trim() ? String(body.password).trim() : genTempPassword();
    const cred = await makeCredential(finalPassword);
    const staffId = genId('staff');

    const { error } = await admin.from('admins').insert({
      id: staffId, username, name: body.name || username, role: finalRole,
      allowed_thon: finalRole === 'staff' && Array.isArray(body.allowedThon) ? body.allowedThon : [],
      allowed_xom: finalRole === 'staff' && Array.isArray(body.allowedXom) ? body.allowedXom : [],
      can_manage_users: finalRole === 'staff' ? !!body.canManageUsers : false,
      can_manage_zalo_oa: finalRole === 'staff' ? !!body.canManageZaloOA : false,
      can_view_balance_sheet: finalRole === 'staff' ? !!body.canViewBalanceSheet : false,
      salt: cred.salt, hash: cred.hash, must_change_password: true,
    });
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'staff',
      `Tạo tài khoản ${finalRole === 'super' ? 'quản trị viên toàn quyền' : 'nhân viên'} "**${body.name || username}**" (đăng nhập: **${username}**)`);
    return json({ ok: true, id: staffId, tempPassword: finalPassword });
  }

  if (body.type === 'update-customer-profile') {
    const cccd = String(body.cccd || '').trim();
    if (!cccd) return json({ ok: false, reason: 'Cần nhập số CCCD.' }, 400);
    const patch: Record<string, unknown> = {};
    if (body.name) patch.name = body.name;
    if (body.phone) patch.phone = String(body.phone).replace(/\s/g, '');
    if (body.address) { patch.address = body.address; Object.assign(patch, parseAddress(body.address)); }
    const { error } = await admin.from('customers').update(patch).eq('cccd', cccd);
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'update-customer-profile', `Cập nhật hồ sơ khách hàng (CCCD **${cccd}**)`);
    return json({ ok: true });
  }

  if (body.type === 'reset-customer-password') {
    const customerId = String(body.customerId || '').trim();
    if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
    const finalPassword = body.password && String(body.password).trim() ? String(body.password).trim() : genTempPassword();
    const cred = await makeCredential(finalPassword);

    const { data: updated, error } = await admin.from('customers')
      .update({ ...cred, must_change_password: true, failed_attempts: 0, locked_until: null })
      .eq('id', customerId).select('name').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'reset-customer-password', `Cấp lại mật khẩu khách hàng "**${updated?.name || customerId}**"`);
    return json({ ok: true, tempPassword: finalPassword });
  }

  if (body.type === 'force-logout-customer') {
    const customerId = String(body.customerId || '').trim();
    if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
    const { data: updated, error } = await admin.from('customers').update({ force_logout_at: new Date().toISOString() }).eq('id', customerId).select('name').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'force-logout-customer', `Đăng xuất ngay khách hàng "**${updated?.name || customerId}**"`);
    return json({ ok: true });
  }

  if (body.type === 'deactivate-customer') {
    const customerId = String(body.customerId || '').trim();
    if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
    const { data: updated, error } = await admin.from('customers').update({ salt: null, hash: null, must_change_password: false, failed_attempts: 0, locked_until: null }).eq('id', customerId).select('name').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'deactivate-customer', `Vô hiệu hóa tài khoản khách hàng "**${updated?.name || customerId}**"`);
    return json({ ok: true });
  }

  if (body.type === 'delete-customer') {
    const customerId = String(body.customerId || '').trim();
    if (!customerId) return json({ ok: false, reason: 'Thiếu mã khách hàng.' }, 400);
    const { data: deleted, error } = await admin.from('customers').delete().eq('id', customerId).select('name, cccd').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'delete-customer', `Xóa tài khoản khách hàng "**${deleted?.name || customerId}**"${deleted?.cccd ? ` (CCCD **${deleted.cccd}**)` : ''}`);
    return json({ ok: true });
  }

  if (body.type === 'delete-contract') {
    const contractId = String(body.contractId || '').trim();
    if (!contractId) return json({ ok: false, reason: 'Thiếu mã hợp đồng.' }, 400);
    const { data: deleted, error } = await admin.from('contracts').delete().eq('id', contractId).select('code').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'delete-contract', `Xóa hợp đồng **${deleted?.code || contractId}**`);
    return json({ ok: true });
  }

  if (body.type === 'force-logout-staff') {
    const staffId = String(body.staffId || '').trim();
    if (!staffId) return json({ ok: false, reason: 'Thiếu mã tài khoản.' }, 400);
    const { data: updated, error } = await admin.from('admins').update({ force_logout_at: new Date().toISOString() }).eq('id', staffId).select('name, username').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'force-logout-staff', `Đăng xuất ngay tài khoản "**${updated?.name || updated?.username || staffId}**"`);
    return json({ ok: true });
  }

  if (body.type === 'reset-staff-password') {
    const staffId = String(body.staffId || '').trim();
    if (!staffId) return json({ ok: false, reason: 'Thiếu mã tài khoản.' }, 400);
    if (!isSuper) {
      const { data: target } = await admin.from('admins').select('role').eq('id', staffId).maybeSingle();
      if (target?.role === 'super') return json({ ok: false, reason: 'Không có quyền với tài khoản toàn quyền.' }, 403);
    }
    const finalPassword = body.password && String(body.password).trim() ? String(body.password).trim() : genTempPassword();
    const cred = await makeCredential(finalPassword);
    const { data: updated, error } = await admin.from('admins').update({ ...cred, must_change_password: true, failed_attempts: 0, locked_until: null }).eq('id', staffId).select('name, username').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'reset-staff-password', `Cấp lại mật khẩu tài khoản "**${updated?.name || updated?.username || staffId}**"`);
    return json({ ok: true, tempPassword: finalPassword });
  }

  if (body.type === 'update-staff-permissions') {
    const staffId = String(body.staffId || '').trim();
    if (!staffId) return json({ ok: false, reason: 'Thiếu mã tài khoản.' }, 400);
    const { data: updated, error } = await admin.from('admins').update({
      allowed_thon: Array.isArray(body.allowedThon) ? body.allowedThon : [],
      allowed_xom: Array.isArray(body.allowedXom) ? body.allowedXom : [],
      can_manage_users: !!body.canManageUsers,
      can_manage_zalo_oa: !!body.canManageZaloOA,
      can_view_balance_sheet: !!body.canViewBalanceSheet,
    }).eq('id', staffId).eq('role', 'staff').select('name, username').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'update-staff-permissions', `Sửa quyền tài khoản "**${updated?.name || updated?.username || staffId}**"`);
    return json({ ok: true });
  }

  if (body.type === 'delete-staff') {
    const staffId = String(body.staffId || '').trim();
    if (!staffId) return json({ ok: false, reason: 'Thiếu mã tài khoản.' }, 400);
    const { data: target } = await admin.from('admins').select('role').eq('id', staffId).maybeSingle();
    if (target && target.role === 'super') {
      if (!isSuper) return json({ ok: false, reason: 'Không có quyền với tài khoản toàn quyền.' }, 403);
      const { count } = await admin.from('admins').select('id', { count: 'exact', head: true }).eq('role', 'super');
      if ((count || 0) <= 1) return json({ ok: false, reason: 'Phải giữ lại ít nhất 1 quản trị viên toàn quyền.' }, 409);
    }
    const { data: deleted, error } = await admin.from('admins').delete().eq('id', staffId).select('name, username').maybeSingle();
    if (error) return json({ ok: false, reason: 'Lỗi hệ thống, thử lại sau.' }, 500);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'delete-staff', `Xóa tài khoản "**${deleted?.name || deleted?.username || staffId}**"`);
    return json({ ok: true });
  }

  if (body.type === 'import-history') {
    const { data, error } = await admin.from('import_history')
      .select('id, created_at, admin_name, kind, file_name, full_sync, summary, rolled_back_at, rolled_back_by')
      .order('created_at', { ascending: false }).limit(IMPORT_HISTORY_KEEP);
    if (error) return json({ ok: false, reason: 'Chưa tạo bảng lịch sử nhập (import_history) trên Supabase — chạy SQL tạo bảng trước.' }, 500);
    const items = data || [];

    const latestActive = items.find((it: any) => !it.rolled_back_at);
    return json({ ok: true, items, latestActiveId: latestActive ? latestActive.id : null });
  }
  if (body.type === 'import-history-detail') {
    const id = String(body.id || '');
    if (!id) return json({ ok: false, reason: 'Thiếu mã lần nhập.' }, 400);
    const { data, error } = await admin.from('import_history')
      .select('id, created_at, admin_name, kind, file_name, full_sync, summary, details, rolled_back_at, rolled_back_by').eq('id', id).maybeSingle();
    if (error || !data) return json({ ok: false, reason: 'Không tìm thấy lần nhập này.' }, 404);
    return json({ ok: true, item: data });
  }
  if (body.type === 'import-rollback') {
    const id = String(body.id || '');
    if (!id) return json({ ok: false, reason: 'Thiếu mã lần nhập.' }, 400);
    const { data: entry, error: entryError } = await admin.from('import_history').select('*').eq('id', id).maybeSingle();
    if (entryError || !entry) return json({ ok: false, reason: 'Không tìm thấy lần nhập này.' }, 404);
    if (entry.rolled_back_at) return json({ ok: false, reason: 'Lần nhập này đã được quay lại trước đó.' }, 409);
    const { data: newer } = await admin.from('import_history').select('id, created_at').is('rolled_back_at', null)
      .gt('created_at', entry.created_at).limit(1);
    if (newer && newer.length) {
      return json({ ok: false, reason: 'Đã có lần nhập mới hơn. Hãy quay lại lần nhập mới nhất trước, rồi mới quay lại lần này (đúng thứ tự từ mới đến cũ).' }, 409);
    }
    const { errors, counts } = await rollbackImportSnapshot(entry.snapshot);
    if (errors.length) {
      return json({ ok: false, reason: 'Quay lại chưa xong, dừng ở bước: ' + errors[0] + ' — dữ liệu chưa bị mất, có thể bấm quay lại lần nữa.' }, 500);
    }
    await admin.from('import_history').update({ rolled_back_at: new Date().toISOString(), rolled_back_by: callerAdmin.name || callerAdmin.username }).eq('id', id);
    await logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'import-rollback',
      `Quay lại bản trước lần nhập ${entry.kind === 'supplement' ? 'file số 2' : 'file số 1'}${entry.file_name ? ` "**${entry.file_name}**"` : ''} lúc ${entry.created_at}`);
    return json({ ok: true, counts });
  }

  if (body.type === 'import-supplement' || body.type === 'import-supplement-preview') {
    const isPreview = body.type === 'import-supplement-preview';
    const fileName = String(body.fileName || '').trim().slice(0, 200) || null;
    const incoming = Array.isArray(body.rows) ? body.rows : [];
    if (!incoming.length || incoming.length > 5000) {
      return json({ ok: false, reason: 'File bổ sung không có hợp đồng hoặc vượt quá 5.000 dòng.' }, 400);
    }
    const seen = new Set<string>();
    const rows: { code: string; agreementCode: string | null; installmentSchedule: Record<string, number> }[] = [];
    for (const raw of incoming) {
      const code = String(raw?.code || '').trim();
      const agreementCode = String(raw?.agreementCode || '').trim() || null;
      const schedule = raw?.installmentSchedule;
      if (!code || seen.has(code) || (schedule != null && (typeof schedule !== 'object' || Array.isArray(schedule)))) {
        return json({ ok: false, reason: 'File bổ sung có số HĐTD trống, trùng hoặc phân kỳ không hợp lệ.' }, 400);
      }
      seen.add(code);
      const installments: Record<string, number> = {};
      for (const [year, amount] of Object.entries(schedule || {})) {
        const value = Number(amount);
        if (!/^\d{4}$/.test(year) || !Number.isFinite(value) || value < 0) {
          return json({ ok: false, reason: `Phân kỳ không hợp lệ ở hợp đồng ${code}.` }, 400);
        }
        if (value > 0) installments[year] = value;
      }

      rows.push({ code, agreementCode, installmentSchedule: installments });
    }

    const contractsByCode = new Map<string, any[]>();

    const foundParts = await mapLimit(chunkArray(rows.map((r) => r.code), 150), 6, (part) => admin.from('contracts').select('*').in('code', part));
    if (foundParts.some((p: any) => p.error)) return json({ ok: false, reason: 'Không đọc được hợp đồng hiện có; chưa thay đổi dữ liệu.' }, 500);
    for (const { data: found } of foundParts as any[]) {
      for (const ct of found || []) contractsByCode.set(ct.code, [...(contractsByCode.get(ct.code) || []), ct]);
    }
    const ownerIds = [...new Set([...contractsByCode.values()].flat().map((ct: any) => ct.customer_id as string))];
    const ownerById = new Map<string, any>();
    const ownerParts = await mapLimit(chunkArray(ownerIds, 150), 6, (part) => admin.from('customers').select('id, name, cccd').in('id', part));
    for (const { data: owners } of ownerParts as any[]) {
      for (const o of owners || []) ownerById.set(o.id, o);
    }
    const suppDetails = { matched: [] as any[], unchangedContracts: 0, unmatched: [] as any[] };
    const suppSnapshot: any = { kind: 'supplement', updatedContracts: [] as any[] };
    const SUPP_FIELDS = { agreement_code: CONTRACT_FIELD_META.agreement_code, installment_schedule: CONTRACT_FIELD_META.installment_schedule };
    for (const row of rows) {
      const sameCode = contractsByCode.get(row.code) || [];
      const active = sameCode.filter((ct: any) => (Number(ct.balance) || 0) > 0);
      if (active.length > 1) return json({ ok: false, reason: `Cơ sở dữ liệu có số HĐTD ${row.code} bị trùng; chưa thay đổi dữ liệu.` }, 409);
      const ct = active[0];
      if (!ct) {
        suppDetails.unmatched.push({ code: row.code, reason: sameCode.length ? 'Hợp đồng đã tất toán (dư nợ 0)' : 'Không có hợp đồng này trong hệ thống' });
        continue;
      }

      if (Object.keys(row.installmentSchedule).length) row.installmentSchedule = mergeInstallmentSchedule(ct.installment_schedule, row.installmentSchedule) || row.installmentSchedule;

      const after = {
        ...ct,
        agreement_code: row.agreementCode || ct.agreement_code || ct.code,
        installment_schedule: Object.keys(row.installmentSchedule).length ? row.installmentSchedule : null,
      };
      const changes = diffFields(SUPP_FIELDS, ct, after);
      if (!changes.length) { suppDetails.unchangedContracts++; continue; }
      const owner = ownerById.get(ct.customer_id) || {};
      suppDetails.matched.push({ code: ct.code, name: owner.name || '', cccd: owner.cccd || '', changes });
      suppSnapshot.updatedContracts.push(pickCols(ct, CONTRACT_WRITE_COLS));
    }
    const suppSummary = {
      fileRows: rows.length, matched: suppDetails.matched.length + suppDetails.unchangedContracts,
      changedContracts: suppDetails.matched.length, unchangedContracts: suppDetails.unchangedContracts, unmatched: suppDetails.unmatched.length,
    };
    if (isPreview) return json({ ok: true, preview: true, summary: suppSummary, details: suppDetails });
    const historyNotReady = await importHistoryReady();
    if (historyNotReady) return json({ ok: false, reason: historyNotReady }, 500);

    const { data, error } = await admin.rpc('apply_contract_supplement', { p_rows: rows });
    if (error) return json({ ok: false, reason: `Không lưu được file bổ sung: ${error.message}` }, 500);
    const updated = Number(data?.updated) || 0;
    const unmatched = Number(data?.unmatched) || 0;
    const [, savedSupp] = await Promise.all([
      logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'import-supplement',
        `Bổ sung khế ước và phân kỳ: **${updated} hợp đồng**${unmatched ? `, **${unmatched} dòng** không khớp hoặc đã tất toán` : ''}`),
      saveImportHistory({
        adminId: callerAdmin.id, adminName: callerAdmin.name || callerAdmin.username, kind: 'supplement', fileName, fullSync: false,
        summary: suppSummary, details: suppDetails, snapshot: suppSnapshot,
      }),
    ]);
    return json({
      ok: true, updated, unmatched,
      errors: savedSupp.error ? ['Đã bổ sung xong nhưng chưa lưu được lịch sử nhập: ' + savedSupp.error] : [],
      summary: suppSummary, details: suppDetails, historyId: savedSupp.id,
    });
  }

  if (body.type === 'import' || body.type === 'import-preview') {

    const isPreview = body.type === 'import-preview';
    const fileName = String(body.fileName || '').trim().slice(0, 200) || null;
    const rows = Array.isArray(body.rows)
      ? body.rows.map((row: any) => ({ ...(row || {}), code: String(row?.code || '').trim() })) : [];
    const fullSync = !!body.fullSync;
    if (!rows.length || rows.length > 5000) return json({ ok: false, reason: 'File không có hợp đồng hoặc vượt quá 5.000 dòng.' }, 400);
    if (rows.some((row: any) => row.balance == null || !Number.isFinite(Number(row.balance)) || Number(row.balance) < 0)) {
      return json({ ok: false, reason: 'File có dư nợ trống, âm hoặc không hợp lệ; chưa thay đổi dữ liệu.' }, 400);
    }

    const activeRows = rows.filter((row: any) => (Number(row.balance) || 0) > 0);
    if (fullSync && !activeRows.length) return json({ ok: false, reason: 'File không có hợp đồng còn dư nợ; chưa đồng bộ để tránh xóa nhầm toàn bộ dữ liệu.' }, 400);
    if (fullSync) {
      const codes = new Set<string>();
      for (const row of rows) {
        const code = String(row?.code || '').trim();
        const cccd = String(row?.cccd || '').trim();
        if (!code || !/^\d{9,12}$/.test(cccd) || codes.has(code)) {
          return json({ ok: false, reason: 'File chính có số HĐTD/CCCD trống, không hợp lệ hoặc số HĐTD bị trùng; chưa thay đổi dữ liệu.' }, 400);
        }
        codes.add(code);
      }
    }
    const result = {
      newProfiles: 0, existingCustomers: 0, contracts: 0,
      deletedContracts: 0, deletedCustomers: 0, skipped: 0, zaloAutoSendMigrated: 0,
      newAccounts: [] as { name: string; cccd: string; tempPassword: string }[],
      errors: [] as string[],
    };

    async function readAll(table: 'customers' | 'contracts') {
      const all: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await admin.from(table).select('*').order('id').range(from, from + 999);
        if (error) return { data: null, error };
        all.push(...(data || []));
        if ((data || []).length < 1000) return { data: all, error: null };
      }
    }

    const [schemaCheck, historyNotReady, [{ data: allCustomers, error: customersError }, { data: allContracts, error: contractsError }]] = await Promise.all([
      admin.from('contracts').select('id, collateral_type, loan_term, loan_purpose, heir_name').limit(1),
      isPreview ? Promise.resolve(null) : importHistoryReady(),
      Promise.all([readAll('customers'), readAll('contracts')]),
    ]);

    if (schemaCheck.error) return json({ ok: false, reason: 'Chưa cập nhật cấu trúc bảng contracts trên Supabase; chưa thay đổi dữ liệu.' }, 500);
    if (historyNotReady) return json({ ok: false, reason: historyNotReady }, 500);
    if (customersError || contractsError) return json({ ok: false, reason: 'Không đọc được dữ liệu hiện có; chưa thay đổi dữ liệu.' }, 500);
    const customerByCccd = new Map((allCustomers || []).map((c: any) => [c.cccd, c]));
    const contractByCode = new Map((allContracts || []).filter((c: any) => c.code).map((c: any) => [c.code, c]));
    if (fullSync) {
      const requestedCodes = new Set(activeRows.map((row: any) => String(row.code).trim()));
      const existingCodes = new Set<string>();
      for (const ct of allContracts || []) {
        if (!requestedCodes.has(ct.code)) continue;
        if (existingCodes.has(ct.code)) {
          return json({ ok: false, reason: 'Cơ sở dữ liệu có số HĐTD trùng; chưa thay đổi dữ liệu. Cần xử lý trùng trước khi nhập lại.' }, 409);
        }
        existingCodes.add(ct.code);
      }
    }

    const newCustomerUpserts: Record<string, unknown>[] = [];
    const existingCustomerUpserts: Record<string, unknown>[] = [];
    const contractUpserts: Record<string, unknown>[] = [];
    const touchedContractIds = new Set<string>();
    const settledContractIds = new Set<string>();
    const usedCodes = new Set<string>();
    const skippedRows: { code: string; name: string; cccd: string; reason: string }[] = [];
    const zeroBalanceCodes = new Set<string>();

    const originalCccds = new Set(customerByCccd.keys());
    const touchedCccds = new Set<string>();
    const newTempPasswords = new Map<string, string>();

    for (const row of rows) {
      const cccd = String(row.cccd || '').trim();
      if (!cccd || !/^\d{9,12}$/.test(cccd)) {
        result.skipped++;
        skippedRows.push({ code: String(row.code || ''), name: String(row.name || ''), cccd, reason: 'CCCD trống hoặc không hợp lệ' });
        continue;
      }
      if ((Number(row.balance) || 0) <= 0) {
        if (row.code) zeroBalanceCodes.add(String(row.code));

        const existing = row.code ? contractByCode.get(row.code) : null;
        const owner = customerByCccd.get(cccd);
        if (existing && owner?.id === existing.customer_id) settledContractIds.add(existing.id);
        continue;
      }
      touchedCccds.add(cccd);

      let cust: any = customerByCccd.get(cccd);
      const parsedAddr = row.address ? parseAddress(row.address) : null;

      if (cust) {
        const patch: Record<string, unknown> = {};
        if (row.name) patch.name = row.name;
        if (row.phone) patch.phone = String(row.phone).replace(/\s/g, '');
        if (row.address) { patch.address = row.address; Object.assign(patch, parsedAddr); }
        cust = { ...cust, ...patch };
        customerByCccd.set(cccd, cust);
      } else {
        const custId = genId('cust');
        const temp = genTempPassword();
        const cred = await makeCredential(temp);
        cust = {
          id: custId, cccd, name: row.name || '', phone: row.phone ? String(row.phone).replace(/\s/g, '') : '',
          address: row.address || '', ...(parsedAddr || { xom: '', thon: '', xa: '', tinh: '' }),
          salt: cred.salt, hash: cred.hash, must_change_password: true,
          failed_attempts: 0, locked_until: null,
        };
        customerByCccd.set(cccd, cust);
        newTempPasswords.set(cccd, temp);
      }

      const disbursed = row.disbursedDate || new Date().toISOString().slice(0, 10);
      const bal = Number(row.balance) || 0;
      let ct: any = row.code ? contractByCode.get(row.code) : null;
      if (ct && ct.customer_id !== cust.id) {
        return json({ ok: false, reason: `Số HĐTD ${row.code} đang thuộc CCCD khác; chưa thay đổi dữ liệu. Hãy kiểm tra lại file.` }, 409);
      }
      let code = row.code || (ct ? ct.code : null);
      if (!code) {
        do { code = `HD-${cccd}-${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`; }
        while (contractByCode.has(code) || usedCodes.has(code));
      }
      usedCodes.add(code);

      const contractId = ct ? ct.id : genId('hd');
      const hasCollateralType = Object.prototype.hasOwnProperty.call(row, 'collateralType');
      const collateralType = hasCollateralType ? String(row.collateralType || '').trim().toUpperCase() || null : (ct?.collateral_type || null);
      const hasCollateral = hasCollateralType ? ['01', '02', '04', '06'].includes(collateralType || '') : !!ct?.has_collateral;

      const collateralValue = hasCollateralType ? Math.max(0, Number(row.collateralValue) || 0) : (Number(ct?.collateral_value) || 0);
      const loanTerm = Object.prototype.hasOwnProperty.call(row, 'loanTerm') ? (row.loanTerm || null) : (ct?.loan_term || null);
      const loanPurpose = Object.prototype.hasOwnProperty.call(row, 'loanPurpose') ? (row.loanPurpose || null) : (ct?.loan_purpose || null);

      const heirName = Object.prototype.hasOwnProperty.call(row, 'heirName') ? (String(row.heirName || '').trim().slice(0, 200) || null) : (ct?.heir_name || null);
      const contractRow = {
        id: contractId, customer_id: cust.id, code,
        principal: row.principal != null && row.principal !== '' ? Number(row.principal) || 0 : bal,
        disbursed_date: disbursed,
        due_date: row.dueDate || addDaysISO(disbursed, 365),
        interest_rate: row.interestRate != null && row.interestRate !== '' ? Number(row.interestRate) || 0 : (ct ? ct.interest_rate : 0),
        balance: bal,
        interest_paid_until: row.interestPaidUntil || disbursed,

        has_collateral: hasCollateral,
        collateral_value: collateralValue,
        collateral_type: collateralType,
        loan_term: loanTerm,
        loan_purpose: loanPurpose,
        heir_name: heirName,
        agreement_code: bal > 0 ? (row.agreementCode || ct?.agreement_code || code) : code,
        installment_schedule: bal > 0
          ? (row.installmentSchedule && Object.keys(row.installmentSchedule).length ? mergeInstallmentSchedule(ct?.installment_schedule, row.installmentSchedule) : ct?.installment_schedule || null)
          : null,
      };
      contractByCode.set(code, contractRow);
      contractUpserts.push(contractRow);
      touchedContractIds.add(contractId);
      result.contracts++;
    }

    for (const cccd of touchedCccds) {
      const cust = customerByCccd.get(cccd)!;
      if (originalCccds.has(cccd)) {
        existingCustomerUpserts.push(cust);
        result.existingCustomers++;
      } else {
        newCustomerUpserts.push(cust);
        result.newProfiles++;
        result.newAccounts.push({ name: (cust as any).name, cccd, tempPassword: newTempPasswords.get(cccd)! });
      }
    }

    function dedupeById(rows: Record<string, unknown>[]): Record<string, unknown>[] {
      const map = new Map<unknown, Record<string, unknown>>();
      for (const r of rows) map.set((r as any).id, r);
      return [...map.values()];
    }
    const contractUpsertsDeduped = dedupeById(contractUpserts);

    const toDeleteIds = fullSync
      ? (allContracts || []).filter((c: any) => !touchedContractIds.has(c.id)).map((c: any) => c.id)
      : [...settledContractIds];
    const allContractById = new Map<string, any>((allContracts || []).map((c: any) => [c.id, c]));
    const allCustomerById = new Map<string, any>((allCustomers || []).map((c: any) => [c.id, c]));
    const originalCustomerByCccd = new Map<string, any>((allCustomers || []).map((c: any) => [c.cccd, c]));
    const finalCustomerById = new Map<string, any>();
    for (const c of customerByCccd.values()) finalCustomerById.set((c as any).id, c);
    const personOf = (customerId: string): any => finalCustomerById.get(customerId) || allCustomerById.get(customerId) || {};
    const importDetails = {
      newContracts: [] as any[], changedContracts: [] as any[], unchangedContracts: 0, deletedContracts: [] as any[],
      newCustomers: [] as any[], changedCustomers: [] as any[], deletedCustomers: [] as any[], skipped: skippedRows,
    };
    const importSnapshot: any = {
      kind: 'import', createdContractIds: [], createdCustomerIds: [], updatedContracts: [], updatedCustomers: [],
      deletedContracts: [], deletedCustomers: [], zaloCustomers: [], zaloAutoSend: [], logLinks: { notification_log: [], zalo_send_log: [] },
    };

    const contractWrites: any[] = [];
    let collateralChanged = false;
    const COLLATERAL_FIELDS = new Set(['has_collateral', 'collateral_value', 'collateral_type']);
    for (const row of contractUpsertsDeduped as any[]) {
      const before = allContractById.get(row.id);
      const person = personOf(row.customer_id);
      if (!before) {
        importDetails.newContracts.push({ code: row.code, name: person.name || '', cccd: person.cccd || '', balance: row.balance, principal: row.principal, dueDate: row.due_date });
        importSnapshot.createdContractIds.push(row.id);
        contractWrites.push(row);
        if (row.has_collateral || Number(row.collateral_value) > 0) collateralChanged = true;
        continue;
      }
      const changes = diffFields(CONTRACT_FIELD_META, before, row);
      if (!changes.length) { importDetails.unchangedContracts++; continue; }
      importDetails.changedContracts.push({ code: row.code, name: person.name || '', cccd: person.cccd || '', changes });
      importSnapshot.updatedContracts.push(pickCols(before, CONTRACT_WRITE_COLS));
      contractWrites.push(row);
      if (changes.some((c) => COLLATERAL_FIELDS.has(c.field))) collateralChanged = true;
    }
    for (const id of toDeleteIds) {
      const ct = allContractById.get(id);
      if (!ct) continue;
      const person = personOf(ct.customer_id);
      importDetails.deletedContracts.push({
        code: ct.code, name: person.name || '', cccd: person.cccd || '', balance: Number(ct.balance) || 0,
        reason: zeroBalanceCodes.has(ct.code) ? 'Dư nợ về 0 (đã tất toán)' : 'Không còn trong file mới',
      });
      importSnapshot.deletedContracts.push(ct);
    }
    for (const cccd of touchedCccds) {
      const cust: any = customerByCccd.get(cccd);
      if (!originalCccds.has(cccd)) {
        importDetails.newCustomers.push({ name: cust.name || '', cccd, phone: cust.phone || '' });
        importSnapshot.createdCustomerIds.push(cust.id);
        continue;
      }
      const changes = diffFields(CUSTOMER_FIELD_META, originalCustomerByCccd.get(cccd), cust);
      if (!changes.length) continue;
      importDetails.changedCustomers.push({ name: cust.name || '', cccd, changes });
      importSnapshot.updatedCustomers.push({ id: cust.id, ...pickCols(originalCustomerByCccd.get(cccd), CUSTOMER_PROFILE_COLS) });
    }

    const predictedPrune: any[] = [];
    if (fullSync || toDeleteIds.length) {
      const finalContracts = new Map<string, any>(allContractById);
      for (const id of toDeleteIds) finalContracts.delete(id);
      for (const r of contractUpsertsDeduped as any[]) finalContracts.set(r.id, r);
      const balByCustomer = new Map<string, number>();
      for (const c of finalContracts.values()) balByCustomer.set(c.customer_id, (balByCustomer.get(c.customer_id) || 0) + (Number(c.balance) || 0));
      const finalCustomers = new Map<string, any>(allCustomerById);
      for (const [id, c] of finalCustomerById) finalCustomers.set(id, c);
      for (const c of finalCustomers.values()) {
        if ((balByCustomer.get(c.id) || 0) <= 0 && !(c.salt && c.hash)) {
          importDetails.deletedCustomers.push({ name: c.name || '', cccd: c.cccd || '' });
          predictedPrune.push(c);
        }
      }
    }
    const buildImportSummary = () => ({
      fileRows: rows.length, activeRows: result.contracts,
      newContracts: importDetails.newContracts.length, changedContracts: importDetails.changedContracts.length,
      unchangedContracts: importDetails.unchangedContracts, deletedContracts: importDetails.deletedContracts.length,
      newCustomers: importDetails.newCustomers.length, changedCustomers: importDetails.changedCustomers.length,
      deletedCustomers: importDetails.deletedCustomers.length, skipped: result.skipped, zaloAutoSendMigrated: result.zaloAutoSendMigrated,
    });
    if (isPreview) return json({ ok: true, preview: true, fullSync, summary: buildImportSummary(), details: importDetails });

    try {
      const prefUpdates = coPrefUpdates(allCustomers || [], allContracts || []);
      for (const u of prefUpdates) {
        const orig = allCustomerById.get(u.id);
        if (orig) orig.co_people = u.people;
        const cur = orig ? customerByCccd.get(orig.cccd) : null;
        if (cur) (cur as any).co_people = u.people;
      }
      await mapLimit(prefUpdates, 8, async (u) => {
        const { error } = await admin.from('customers').update({ co_people: u.people }).eq('id', u.id);
        if (error) console.error('Lỗi ghi lựa chọn gửi của người cùng vay:', error.message);
      });
    } catch (e) { console.error('Lỗi ghi lựa chọn gửi của người cùng vay:', e); }

    const existingCustomerWrites = existingCustomerUpserts.filter((cust: any) => {
      const orig = originalCustomerByCccd.get(cust.cccd);
      return !orig || CUSTOMER_PROFILE_COLS.some((col) => String(orig[col] ?? '') !== String(cust[col] ?? ''));
    });

    if (newCustomerUpserts.length) {
      const { error } = await admin.from('customers').upsert(newCustomerUpserts, { onConflict: 'id' });
      if (error) return json({ ok: false, reason: 'Lỗi ghi hồ sơ khách hàng mới; chưa xóa hợp đồng nào: ' + error.message }, 500);
    }
    if (existingCustomerWrites.length) {
      const { error } = await admin.from('customers').upsert(existingCustomerWrites, { onConflict: 'id' });
      if (error) return json({ ok: false, reason: 'Lỗi cập nhật hồ sơ khách hàng; chưa xóa hợp đồng nào: ' + error.message }, 500);
    }
    if (contractWrites.length) {
      const { error } = await admin.from('contracts').upsert(contractWrites, { onConflict: 'id' });
      if (error) return json({ ok: false, reason: 'Lỗi ghi hợp đồng; chưa xóa hợp đồng nào: ' + error.message }, 500);
    }

    const historySync: { updated: number; error?: string } = collateralChanged ? await syncHistoricalCollateral(admin) : { updated: 0 };
    if (historySync.error) result.errors.push('Chưa đồng bộ TSBĐ lịch sử: ' + historySync.error);

    if (toDeleteIds.length) {

        const orphanEntries: any[] = [];
        for (const part of chunkArray(toDeleteIds, 150)) {
          const { data } = await admin.from('zalo_auto_send_list').select('*').in('contract_id', part);
          orphanEntries.push(...(data || []));
        }
        importSnapshot.zaloAutoSend = orphanEntries.map((e: any) => ({ ...e }));
        if (orphanEntries && orphanEntries.length) {
          const { data: existingAutoRows } = await admin.from('zalo_auto_send_list').select('contract_id');
          const alreadyInAuto = new Set((existingAutoRows || []).map((r: any) => r.contract_id));

          const remainingContracts = new Map<string, any>();
          if (!fullSync) for (const ct of allContracts || []) {
            if (!toDeleteIds.includes(ct.id)) remainingContracts.set(ct.id, ct);
          }
          for (const ct of contractUpsertsDeduped) remainingContracts.set((ct as any).id, ct);
          const remainingByCustomer = new Map<string, string[]>();
          for (const cr of remainingContracts.values()) {
            const cid = (cr as any).id as string;
            if (alreadyInAuto.has(cid)) continue;
            if ((Number((cr as any).balance) || 0) <= 0) continue;
            const custId = (cr as any).customer_id as string;
            const arr = remainingByCustomer.get(custId) || [];
            arr.push(cid);
            remainingByCustomer.set(custId, arr);
          }
          for (const entry of orphanEntries) {
            const candidates = (remainingByCustomer.get((entry as any).customer_id) || []).filter((cid) => !alreadyInAuto.has(cid));
            if (candidates.length !== 1) continue;
            const { error: migErr } = await admin.from('zalo_auto_send_list').update({ contract_id: candidates[0] }).eq('id', (entry as any).id);
            if (!migErr) { alreadyInAuto.add(candidates[0]); result.zaloAutoSendMigrated++; }
          }
        }

        for (const table of ['notification_log', 'zalo_send_log'] as const) {

          const links: [string, string][] = [];
          for (const part of chunkArray(toDeleteIds, 150)) {
            const { data } = await admin.from(table).select('id, contract_id').in('contract_id', part);
            for (const r of data || []) links.push([(r as any).id, (r as any).contract_id]);
          }
          importSnapshot.logLinks[table] = links;
          for (const part of chunkArray(toDeleteIds, 150)) {
            const { error: logError } = await admin.from(table).update({ contract_id: null }).in('contract_id', part);
            if (logError) return json({ ok: false, reason: `Không giữ được lịch sử ${table}; chưa xóa hợp đồng: ${logError.message}` }, 500);
          }
        }
        for (const part of chunkArray(toDeleteIds, 150)) {
          const { error } = await admin.from('contracts').delete().in('id', part);
          if (error) return json({ ok: false, reason: 'Lỗi xóa hợp đồng đã tất toán hoặc rời file chính: ' + error.message }, 500);
        }
        result.deletedContracts = toDeleteIds.length;
    }
    if (fullSync || toDeleteIds.length) {

      let pruneRows = predictedPrune;
      if (pruneRows.length) {
        const stillOwning = new Set<string>();
        let checkFailed = false;
        for (const part of chunkArray(pruneRows.map((c: any) => c.id as string), 150)) {
          const { data, error } = await admin.from('contracts').select('customer_id').in('customer_id', part).gt('balance', 0);
          if (error) { checkFailed = true; break; }
          for (const r of data || []) stillOwning.add((r as any).customer_id);
        }
        if (checkFailed) return json({ ok: false, reason: 'Không kiểm tra được hợp đồng còn lại; chưa dọn hồ sơ khách hàng.' }, 500);
        pruneRows = pruneRows.filter((c: any) => !stillOwning.has(c.id));
      }
      importDetails.deletedCustomers = [];
      if (pruneRows.length) {
        const deletedIds = new Set<string>();
        for (const part of chunkArray(pruneRows.map((c: any) => c.id as string), 150)) {
          const { data: zaloRows } = await admin.from('zalo_customers').select('*').in('customer_id', part);
          await archiveCoPeopleBeforePrune(part);
          const { error } = await admin.from('customers').delete().in('id', part);
          if (error) break;
          part.forEach((id) => deletedIds.add(id));
          importSnapshot.zaloCustomers.push(...(zaloRows || []));
        }
        result.deletedCustomers = deletedIds.size;
        importSnapshot.deletedCustomers = pruneRows.filter((c: any) => deletedIds.has(c.id));
        importDetails.deletedCustomers = importSnapshot.deletedCustomers.map((c: any) => ({ name: c.name || '', cccd: c.cccd || '' }));
      }
    }

    const coReconcile = await reconcileCoBorrowersAfterImport([...touchedCccds].map((cccd) => (customerByCccd.get(cccd) as any)?.id as string).filter(Boolean), importSnapshot.createdContractIds as string[]);
    if (coReconcile.changes.length) (importDetails as any).coBorrowerChanges = coReconcile.changes;
    const importSummary = { ...buildImportSummary(), coBorrowerChanged: coReconcile.changes.length };

    const [, savedHistory] = await Promise.all([
      logActivity(callerAdmin.id, callerAdmin.name || callerAdmin.username, callerAdmin.username, 'import',
        `Nhập dữ liệu Excel${fullSync ? ' (đồng bộ toàn bộ)' : ''}: **${result.contracts} hợp đồng, ${result.newAccounts.length} tài khoản mới**` +
        (result.deletedContracts ? `, xóa **${result.deletedContracts} hợp đồng**` : '') +
        (result.deletedCustomers ? `, xóa **${result.deletedCustomers} khách hàng**` : '') +
        (result.skipped ? `, bỏ qua **${result.skipped} dòng lỗi**` : '') +
        (coReconcile.changes.length ? `, đổi người cùng vay **${coReconcile.changes.length} khách** (đã bỏ khỏi danh sách OA)` : '')),
      saveImportHistory({
        adminId: callerAdmin.id, adminName: callerAdmin.name || callerAdmin.username, kind: 'import', fileName, fullSync,
        summary: importSummary, details: importDetails, snapshot: importSnapshot,
      }),
    ]);
    if (savedHistory.error) result.errors.push('Đã nhập xong nhưng chưa lưu được lịch sử nhập: ' + savedHistory.error);

    return json({ ok: true, ...result, summary: importSummary, details: importDetails, historyId: savedHistory.id, snapshotsChanged: historySync.updated > 0, coBorrowerChanges: coReconcile.changes });
  }

  return json({ ok: false, reason: 'Thiếu hoặc sai "type".' }, 400);
});
