import { createClient } from 'npm:@supabase/supabase-js@2';
// @ts-ignore
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;

const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
const CRON_SECRET = Deno.env.get('CRON_SECRET');

const ZALO_APP_ID = Deno.env.get('ZALO_APP_ID');
const ZALO_SECRET_KEY = Deno.env.get('ZALO_SECRET_KEY');

const NEAR_DUE_START_DAYS = 10;
const NEAR_DUE_REPEAT_DAYS = 3;
const MONTHLY_REMINDER_OFFSETS = [0, 2];

const DEFAULT_NEAR_DUE_DAYS_ZALO = 15;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function daysBetween(a: Date, b: Date): number {
  const sa = new Date(a); sa.setHours(0, 0, 0, 0);
  const sb = new Date(b); sb.setHours(0, 0, 0, 0);
  return Math.round((sb.getTime() - sa.getTime()) / 86400000);
}

function effectiveStatus(contract: any, asOf: Date): 'da_tat_toan' | 'qua_han' | 'dang_vay' {
  if ((contract.balance || 0) <= 0) return 'da_tat_toan';
  if (daysBetween(new Date(contract.due_date), asOf) > 0) return 'qua_han';
  return 'dang_vay';
}

function interestDaysAccrued(contract: any, asOf: Date): number {
  const paidUntil = contract.interest_paid_until || contract.disbursed_date;
  let days = daysBetween(new Date(paidUntil), asOf);
  if (contract.disbursed_date && daysBetween(new Date(contract.disbursed_date), new Date(paidUntil)) === 1) days += 1;
  return Math.max(0, days);
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

function accruedInterest(contract: any, asOf: Date): number {
  if (effectiveStatus(contract, asOf) === 'da_tat_toan') return 0;
  const days = interestDaysAccrued(contract, asOf);
  return interestRoundedToThousand(contract.balance, days, contract.interest_rate);
}

function withYear(date: Date, year: number): Date {
  const month = date.getMonth();
  const day = date.getDate();
  const d = new Date(year, month, day);
  if (d.getMonth() !== month) d.setDate(0);
  return d;
}

function toLocalISODate(date: Date): string {
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

type InstallmentEntry = { year: number; dueDate: string; amount: number; dueAmount: number; daysLeft: number; shouldWarn: boolean };

function computeInstallmentPlan(contract: any, asOf: Date): InstallmentEntry[] | null {
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
    const dueDate = withYear(disbursed, e.year);
    const daysLeft = daysBetween(asOf, dueDate);
    const isPastOrToday = daysLeft <= 0;

    let dueAmount: number;
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
      daysLeft,
      shouldWarn: isPastOrToday && dueAmount > 0,
    };
  });
}

function nextInstallmentInfo(contract: any, asOf: Date): { idx: number; next: InstallmentEntry } | null {
  const plan = computeInstallmentPlan(contract, asOf);
  if (!plan) return null;
  const idx = plan.findIndex((p) => p.dueAmount > 0);
  if (idx < 0) return null;
  return { idx, next: plan[idx] };
}

function daysOverdue(contract: any, asOf: Date): number | null {
  if ((Number(contract.balance) || 0) <= 0) return null;
  const mainOverdue = daysBetween(new Date(contract.due_date), asOf);
  const inst = nextInstallmentInfo(contract, asOf);
  const instOverdue = inst ? -inst.next.daysLeft : -Infinity;
  return Math.max(0, mainOverdue, instOverdue);
}

const WIDE_NEAR_DUE_DAYS_ATTENTION = 45;

function contractAttention(contract: any, asOf: Date): { level: 'qua_han' | 'gan_den_han' | null; days: number; dueAmount: number } {
  const balance = Number(contract.balance) || 0;
  if (balance <= 0) return { level: null, days: 0, dueAmount: 0 };
  const d = daysBetween(asOf, new Date(contract.due_date));
  const contractLevel = d < 0 ? 'qua_han' : (d <= WIDE_NEAR_DUE_DAYS_ATTENTION ? 'gan_den_han' : null);
  const inst = nextInstallmentInfo(contract, asOf);
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

function debtGroup(contract: any, asOf: Date): number | null {
  const d = daysOverdue(contract, asOf);
  if (d === null) return null;
  if (d < 10) return 1;
  if (d <= 90) return 2;
  if (d <= 180) return 3;
  if (d <= 360) return 4;
  return 5;
}

const SPECIFIC_PROVISION_RATE: Record<number, number> = { 2: 0.05, 3: 0.2, 4: 0.5, 5: 1 };

const GENERAL_PROVISION_RATE = 0.0075;

function collateralDeductionRate(ct: any): number {
  if (!ct.has_collateral) return 0;
  const type = String(ct.collateral_type || '').trim().toUpperCase();
  if (type === '01' || type === '02') return 0.5;
  if (type === '04') return 0.3;
  if (type === '06') return 1;
  return 0;
}

function previousMonthEndInVietnam(now: Date): Date | null {
  const vietnamNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  if (vietnamNow.getUTCDate() !== 1) return null;
  const startOfMonthUTC = Date.UTC(vietnamNow.getUTCFullYear(), vietnamNow.getUTCMonth(), 1) - 7 * 60 * 60 * 1000;
  return new Date(startOfMonthUTC - 1);
}

async function captureMonthlySnapshot(adminClient: any, asOf: Date): Promise<void> {

  async function readAll(table: 'contracts' | 'customers', columns: string): Promise<any[]> {
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await adminClient.from(table).select(columns).order('id').range(from, from + 999);
      if (error) throw new Error(`Không đọc được ${table} để chốt tháng: ${error.message}`);
      rows.push(...(data || []));
      if ((data || []).length < 1000) return rows;
    }
  }

  const [snapshotContracts, customers] = await Promise.all([
    readAll('contracts', '*'), readAll('customers', 'id, name, thon, xom, tinh, address'),
  ]);
  const custMap = new Map<string, any>((customers || []).map((c: any) => [c.id, c]));

  const groupBalances: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let totalBalance = 0;
  let interestReceivable = 0;
  let generalBase = 0;
  let specificProvision = 0;
  const contractsDetail: any[] = [];
  for (const ct of snapshotContracts) {
    const g = debtGroup(ct, asOf);
    if (g === null) continue;
    const balance = Number(ct.balance) || 0;
    groupBalances[String(g)] += balance;
    totalBalance += balance;
    if (g === 1) interestReceivable += accruedInterest(ct, asOf);
    if (g <= 4) generalBase += balance;
    const rate = SPECIFIC_PROVISION_RATE[g];
    if (rate) {
      const deductible = (Number(ct.collateral_value) || 0) * collateralDeductionRate(ct);
      specificProvision += Math.max(0, balance - deductible) * rate;
    }
    const cust = custMap.get(ct.customer_id);
    const attention = contractAttention(ct, asOf);
    contractsDetail.push({
      code: ct.code || null,
      name: cust?.name || null,
      address: (cust && [cust.thon, cust.xom, cust.tinh].filter(Boolean).join(', ')) || cust?.address || null,
      balance,
      group: g,
      daysOverdue: daysOverdue(ct, asOf),

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
  const yearMonth = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, '0')}`;
  const { error: snapshotError } = await adminClient.from('monthly_snapshots').upsert({
    year_month: yearMonth,
    snapshot_date: toLocalISODate(asOf),
    total_balance: totalBalance,
    interest_receivable: interestReceivable,
    group_balances: groupBalances,
    bad_debt_balance: badDebtBalance,
    bad_debt_ratio: badDebtRatio,
    general_provision: generalBase * GENERAL_PROVISION_RATE,
    specific_provision: specificProvision,
    contracts_detail: contractsDetail,
  }, { onConflict: 'year_month' });
  if (snapshotError) throw new Error(`Không lưu được số liệu tháng ${yearMonth}: ${snapshotError.message}`);
}

function formatVND(n: number): string {
  return Math.round(n).toLocaleString('vi-VN') + 'đ';
}
function formatDateVN(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

const BOLD_DIGITS = ['𝟎', '𝟏', '𝟐', '𝟑', '𝟒', '𝟓', '𝟔', '𝟕', '𝟖', '𝟗'];
function boldDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => BOLD_DIGITS[Number(d)]);
}
function formatVNDBold(n: number): string { return boldDigits(formatVND(n)); }
function formatDateVNBold(iso: string): string { return boldDigits(formatDateVN(iso)); }

const DEFAULT_PUSH_TEMPLATES = {
  title: '<Ten_quy> thông báo:',
  interest: 'Số tiền lãi hợp đồng <Ma_HD> của quý khách đến hôm nay là: <So_tien_lai>. Quý khách vui lòng thanh toán đúng hạn.',
  nearDue: 'Hợp đồng <Ma_HD> của quý khách đã GẦN ĐẾN HẠN. Số tiền gốc là <So_tien_goc> và lãi đến nay là: <So_tien_lai>. Quý khách vui lòng thanh toán trước ngày <Ngay_dao_han>.',
  overdue: 'Hợp đồng <Ma_HD> ĐÃ TRỄ HẠN. Số tiền gốc là <So_tien_goc>, lãi đến nay là: <So_tien_lai>. Yêu cầu quý khách thanh toán và thực hiện đúng như cam kết.',
};
function renderNotificationTemplate(str: string, tokens: Record<string, string>): string {
  return String(str || '').replace(/<([A-Za-z0-9_]+)>/g, (m, key) => (key in tokens ? String(tokens[key]) : m));
}

function interestAnchorDate(contract: any): Date {
  const disbursed = new Date(contract.disbursed_date);
  const paidUntil = new Date(contract.interest_paid_until || contract.disbursed_date);
  if (contract.disbursed_date && daysBetween(disbursed, paidUntil) === 1) return disbursed;
  return paidUntil;
}

function latestMonthlyOccurrence(anchorDate: Date, today: Date): Date | null {
  const ay = anchorDate.getFullYear(), am = anchorDate.getMonth(), ad = anchorDate.getDate();
  const ty = today.getFullYear(), tm = today.getMonth();
  const occDayThisMonth = Math.min(ad, new Date(ty, tm + 1, 0).getDate());
  let occ = new Date(ty, tm, occDayThisMonth);
  if (occ > today) {

    const py = tm === 0 ? ty - 1 : ty, pm = tm === 0 ? 11 : tm - 1;
    occ = new Date(py, pm, Math.min(ad, new Date(py, pm + 1, 0).getDate()));
  }
  const monthDiff = (occ.getFullYear() - ay) * 12 + (occ.getMonth() - am);
  if (monthDiff < 1) return null;
  return occ;
}

function isMonthlyReminderDay(anchorDate: Date, today: Date): boolean {
  const occ = latestMonthlyOccurrence(anchorDate, today);
  if (!occ) return false;
  const d = daysBetween(occ, today);
  return MONTHLY_REMINDER_OFFSETS.includes(d);
}

function isMonthlyReminderDayOnce(anchorDate: Date, today: Date, intervalMonths = 1): boolean {
  const occ = latestMonthlyOccurrence(anchorDate, today);
  if (!occ) return false;
  if (daysBetween(occ, today) !== 0) return false;
  const monthDiff = (occ.getFullYear() - anchorDate.getFullYear()) * 12 + (occ.getMonth() - anchorDate.getMonth());
  return monthDiff >= intervalMonths;
}

function isCustomDayDue(customDay: number, anchorDate: Date, today: Date, intervalMonths = 1): boolean {
  if (today.getDate() !== customDay) return false;
  const targetMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + intervalMonths, 1);
  const anniversary = new Date(targetMonth.getFullYear(), targetMonth.getMonth(),
    Math.min(anchorDate.getDate(), new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate()));
  return daysBetween(anniversary, today) >= 0;
}

async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: Record<string, unknown>): Promise<boolean> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return true;
  } catch (e: any) {

    if (e && (e.statusCode === 404 || e.statusCode === 410)) {
      await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    } else {
      console.error('push send error:', e?.statusCode, e?.body || e);
    }
    return false;
  }
}

async function pushToCustomer(customerId: string, title: string, body: string, tag: string): Promise<boolean> {
  const { data: subs } = await admin.from('push_subscriptions').select('*').eq('owner_type', 'customer').eq('owner_id', customerId);
  if (!subs || !subs.length) return false;
  let anyOk = false;
  for (const sub of subs) {
    const ok = await sendPush(sub as any, { title, body, tag, url: './' });
    if (ok) anyOk = true;
  }
  return anyOk;
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
    const json = await res.json();
    if (!json.access_token) { console.error('Lỗi làm mới Zalo access token:', json); return null; }
    await admin.from('zalo_oa_tokens').update({
      access_token: json.access_token,
      refresh_token: json.refresh_token || tokenRow.refresh_token,
      updated_at: new Date().toISOString(),
    }).eq('id', 'default');
    return json.access_token as string;
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

const noZaloCustomerIds = new Set<string>();

async function sendZaloTemplate(opts: {
  accessToken: string; phone: string; templateId: string; templateData: Record<string, string>;
  contractId: string; customerId: string; kind: string;

  who?: 'main' | 'co'; whoName?: string;

  deferNoAccount?: boolean;
}): Promise<{ ok: boolean; noAccount: boolean }> {
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
    const json = await res.json();
    if (json.error === 0) { status = 'success'; }
    else if (isZaloNoAccountError(json)) { errorMessage = ZALO_NO_ACCOUNT_MESSAGE; noAccount = true; console.error('SĐT không có Zalo:', json); }
    else { errorMessage = json.message || JSON.stringify(json); console.error('Lỗi gửi tin Zalo:', json); }
  } catch (e: any) {
    errorMessage = String(e?.message || e);
    console.error('Lỗi gọi API gửi tin Zalo:', e);
  }
  if (noAccount && !opts.deferNoAccount) { noZaloCustomerIds.add(opts.customerId); await removeCustomerFromZaloLists(opts.customerId); }
  const logRow: Record<string, unknown> = {
    contract_id: opts.contractId, customer_id: opts.customerId, kind: opts.kind, template_id: opts.templateId,
    phone: opts.phone, status, error_message: errorMessage || null, triggered_by: 'auto',
  };
  if (opts.who) { logRow.recipient_who = opts.who; logRow.recipient_name = opts.whoName || null; }
  const { error: logErr } = await admin.from('zalo_send_log').insert(logRow);
  if (logErr && opts.who && /recipient_(who|name)/i.test(String(logErr.message || ''))) {

    delete logRow.recipient_who; delete logRow.recipient_name;
    await admin.from('zalo_send_log').insert(logRow);
  }
  return { ok: status === 'success', noAccount };
}

type ZaloCustomer = { name: string; phone: string; co_people?: unknown };
type ZaloRecipient = { who: 'main' | 'co'; phone: string };
function normPersonName(name: unknown): string {
  return String(name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}
function samePerson(a: unknown, b: unknown): boolean {
  const x = normPersonName(a);
  return !!x && x === normPersonName(b);
}
function samePhone(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => String(v ?? '').replace(/[^\d]/g, '').replace(/^84/, '0');
  return !!n(a) && n(a) === n(b);
}

function heirOfRow(ct: any, customerName: unknown): string {
  const n = String(ct?.heir_name ?? '').replace(/\s+/g, ' ').trim();
  return !n || samePerson(n, customerName) ? '' : n;
}

function coPhoneOfPeople(people: unknown, name: unknown): string {
  const p = (Array.isArray(people) ? people : []).find((x: any) => samePerson(x?.name, name));
  return p ? String((p as any).phone ?? '').trim() : '';
}

function contractRecipients(ct: any, customer: ZaloCustomer | undefined): ZaloRecipient[] {
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

async function sendZaloToCustomer(opts: {
  accessToken: string; customer: ZaloCustomer; contract: any; contractsOfCustomer: any[]; templateId: string; templateData: Record<string, string>;
  contractId: string; customerId: string; kind: string;
}): Promise<boolean> {
  const recipients = contractRecipients(opts.contract, opts.customer);
  if (!recipients.length) return false;
  const results = await Promise.all(recipients.map((r) => sendZaloTemplate({
    accessToken: opts.accessToken, phone: r.phone, templateId: opts.templateId, templateData: opts.templateData,
    contractId: opts.contractId, customerId: opts.customerId, kind: opts.kind, deferNoAccount: true,
    who: r.who, whoName: r.who === 'co' ? heirOfRow(opts.contract, opts.customer.name) : String(opts.customer.name || ''),
  })));
  const noWho = recipients.filter((_, i) => results[i].noAccount).map((r) => r.who);
  if (noWho.length) {
    try {
      const cts = opts.contractsOfCustomer.filter((c) => Number(c.balance) > 0);
      const { patches, hasLeft } = planNoZaloUntick(opts.customer, cts, opts.contractId, noWho);
      if (!hasLeft) {

        noZaloCustomerIds.add(opts.customerId);
        await removeCustomerFromZaloLists(opts.customerId);
        const reset = { oa_to_main: true, oa_to_co: false, oa_co_key: null };
        await admin.from('contracts').update(reset).eq('customer_id', opts.customerId);
        for (const ct of opts.contractsOfCustomer) Object.assign(ct, reset);
      } else {
        for (const [id, p] of patches) {
          await admin.from('contracts').update(p).eq('id', id);
          const ct = opts.contractsOfCustomer.find((c) => c.id === id);
          if (ct) Object.assign(ct, p);
        }
      }
    } catch (e) {
      console.error('Lỗi tự bỏ tick gửi OA người không có Zalo:', e);
    }
  }
  return results.some((r) => r.ok);
}

function formatVNDZaloTemplate(n: number): string {
  return String(Math.round(n));
}

function isNearOrPastDueZalo(contract: any, asOf: Date, nearDueDays: number): boolean {
  const d = daysBetween(asOf, new Date(contract.due_date));
  if (d <= nearDueDays) return true;
  const inst = nextInstallmentInfo(contract, asOf);
  return inst != null && inst.next.daysLeft <= nearDueDays;
}

function pickZaloTemplate(ct: any, now: Date, orgRow: { zalo_template_due_id?: string | null; zalo_template_interest_id?: string | null; zalo_near_due_days?: number | null } | null): { templateId: string; dueTemplate: boolean } | null {
  const nearDueDays = orgRow?.zalo_near_due_days || DEFAULT_NEAR_DUE_DAYS_ZALO;
  const dueTemplate = isNearOrPastDueZalo(ct, now, nearDueDays);
  const templateId = dueTemplate ? orgRow?.zalo_template_due_id : orgRow?.zalo_template_interest_id;
  if (!templateId) return null;
  return { templateId, dueTemplate };
}

function buildZaloTemplateData(ct: any, customer: { name: string; phone: string }, now: Date, dueTemplate: boolean): Record<string, string> {
  const interest = accruedInterest(ct, now);
  const inst = dueTemplate ? nextInstallmentInfo(ct, now) : null;
  const goc = dueTemplate ? (inst ? inst.next.dueAmount : Number(ct.balance)) : 0;
  const total = goc + interest;
  const dueDate = inst ? inst.next.dueDate : ct.due_date;
  const nameNoDiacritics = stripDiacriticsUpper(customer.name || '');
  return {
    TEN_KHACH_HANG: customer.name || '',
    SO_HDTD: ct.code,
    SO_KHE_UOC: ct.code,
    SO_DU: formatVNDZaloTemplate(ct.balance),
    GOC_PHAI_TRA: formatVNDZaloTemplate(goc),
    LAI_PHAI_TRA: formatVNDZaloTemplate(interest),
    SO_TIEN_CHUYEN_KHOAN: formatVNDZaloTemplate(total),
    NGAY_KE_HOACH: formatDateVN(now.toISOString()),
    NOI_DUNG_CHUYEN_KHOAN: stripDiacriticsUpper(`TRA ${dueTemplate ? '' : 'LAI '}HDTD ${ct.code} ${nameNoDiacritics}`),
    NGAY_DAO_HAN: formatDateVN(dueDate),
  };
}

Deno.serve(async (req) => {
  if (CRON_SECRET) {
    const provided = req.headers.get('x-cron-secret') || '';
    if (provided !== CRON_SECRET) return new Response('Unauthorized', { status: 401 });
  }

  const purpose = new URL(req.url).searchParams.get('purpose') || 'daily-reminders';
  noZaloCustomerIds.clear();

  const now = new Date();
  const result = { laiHangThang: 0, ganDenHanQuaHan: 0, zaloBaoLai: 0 };

  const { data: orgRow } = await admin.from('orgs').select('short_name, zalo_template_interest_id, zalo_template_due_id, zalo_near_due_days, push_templates').limit(1).maybeSingle();
  const pushTpl = (orgRow?.push_templates as typeof DEFAULT_PUSH_TEMPLATES | null) || DEFAULT_PUSH_TEMPLATES;
  const shortName = orgRow?.short_name || 'Quỹ tín dụng';
  const NOTI_TITLE = renderNotificationTemplate(pushTpl.title, { Ten_quy: shortName });

  const { data: contracts, error: ctErr } = await admin.from('contracts').select('*');
  if (ctErr) return new Response(JSON.stringify({ ok: false, reason: ctErr.message }), { status: 500 });

  let customersRes = await admin.from('customers').select('id, name, phone, co_people');
  if (customersRes.error) customersRes = await admin.from('customers').select('id, name, phone');
  const customersData = customersRes.data;
  const customerMap = new Map<string, ZaloCustomer>(
    (customersData || []).map((c: any) => [c.id, { name: c.name, phone: c.phone, co_people: c.co_people ?? null }])
  );

  const contractsByCustomer = new Map<string, any[]>();
  for (const c of contracts || []) contractsByCustomer.set((c as any).customer_id, [...(contractsByCustomer.get((c as any).customer_id) || []), c]);

  const zaloAccessToken = (purpose !== 'monthly-close' && (orgRow?.zalo_template_interest_id || orgRow?.zalo_template_due_id)) ? await getZaloAccessToken() : null;

  const { data: autoSendRows } = await admin.from('zalo_auto_send_list').select('contract_id, kind, custom_day, interval_months');
  const autoSendMap = new Map<string, { kind: string; customDay: number | null; intervalMonths: number }>(
    (autoSendRows || []).map((r: any) => [r.contract_id, { kind: r.kind, customDay: r.custom_day, intervalMonths: r.interval_months || 1 }])
  );

  async function shouldSend(contractId: string, kind: string): Promise<boolean> {
    const { data } = await admin.from('notification_log').select('sent_at')
      .eq('contract_id', contractId).eq('kind', kind)
      .order('sent_at', { ascending: false }).limit(1);
    if (!data || !data.length) return true;
    return daysBetween(new Date(data[0].sent_at), now) >= 1;
  }

  async function shouldSendAutoZalo(contractId: string, kind: string): Promise<boolean> {
    if (!await shouldSend(contractId, kind)) return false;
    const { data, error } = await admin.from('zalo_send_log').select('sent_at')
      .eq('contract_id', contractId).eq('triggered_by', 'manual').eq('status', 'success')
      .order('sent_at', { ascending: false }).limit(1).maybeSingle();
    if (error) {
      console.error('Không kiểm tra được lịch sử gửi tay Zalo OA:', error);
      return false;
    }
    return !data?.sent_at || now.getTime() - new Date(data.sent_at).getTime() >= 5 * 24 * 60 * 60 * 1000;
  }
  async function logSent(customerId: string, contractId: string, kind: string) {
    await admin.from('notification_log').insert({ owner_id: customerId, contract_id: contractId, kind, sent_at: now.toISOString() });
  }

  for (const ct of (purpose === 'monthly-close' ? [] : contracts || [])) {
    const status = effectiveStatus(ct, now);
    if (status === 'da_tat_toan') continue;

    if (isMonthlyReminderDay(interestAnchorDate(ct), now)) {
      if (await shouldSend(ct.id, 'lai_hang_thang')) {
        const custName = customerMap.get(ct.customer_id)?.name || '';
        const tokens = {
          Ten_KH: custName, Ma_HD: ct.code,
          So_tien_goc: formatVNDBold(Number(ct.balance)),
          So_tien_lai: formatVNDBold(accruedInterest(ct, now)),
          So_du: formatVNDBold(Number(ct.balance)),
          Ngay_dao_han: formatDateVNBold(ct.due_date),
          Ten_quy: shortName,
        };
        const ok = await pushToCustomer(
          ct.customer_id, NOTI_TITLE,
          renderNotificationTemplate(pushTpl.interest, tokens),
          'lai-hang-thang'
        );
        if (ok) { await logSent(ct.customer_id, ct.id, 'lai_hang_thang'); result.laiHangThang++; }
      }
    }

    {
      const autoEntry = autoSendMap.get(ct.id);
      if (autoEntry?.kind === 'lai_hang_thang_auto' && zaloAccessToken
        && isMonthlyReminderDayOnce(interestAnchorDate(ct), now, autoEntry.intervalMonths)) {
        const picked = pickZaloTemplate(ct, now, orgRow);
        if (picked) {
          const customer = customerMap.get(ct.customer_id);
          if (customer && contractRecipients(ct, customer).length && !noZaloCustomerIds.has(ct.customer_id) && await shouldSendAutoZalo(ct.id, 'zalo_lai_hang_thang')) {
            const zaloOk = await sendZaloToCustomer({
              accessToken: zaloAccessToken, customer, contract: ct, contractsOfCustomer: contractsByCustomer.get(ct.customer_id) || [ct], templateId: picked.templateId,
              templateData: buildZaloTemplateData(ct, customer, now, picked.dueTemplate),
              contractId: ct.id, customerId: ct.customer_id, kind: 'lai_hang_thang_auto',
            });
            if (zaloOk) { await logSent(ct.customer_id, ct.id, 'zalo_lai_hang_thang'); result.zaloBaoLai++; }
          }
        }
      }
    }

    {
      const autoEntry = autoSendMap.get(ct.id);
      if (autoEntry?.kind === 'lai_hang_thang_custom_day' && autoEntry.customDay
        && isCustomDayDue(autoEntry.customDay, interestAnchorDate(ct), now, autoEntry.intervalMonths)
        && interestDaysAccrued(ct, now) > 20 && zaloAccessToken) {
        const picked = pickZaloTemplate(ct, now, orgRow);
        if (picked) {
          const customer = customerMap.get(ct.customer_id);
          if (customer && contractRecipients(ct, customer).length && !noZaloCustomerIds.has(ct.customer_id) && await shouldSendAutoZalo(ct.id, 'zalo_lai_ngay_cu_the')) {
            const zaloOk = await sendZaloToCustomer({
              accessToken: zaloAccessToken, customer, contract: ct, contractsOfCustomer: contractsByCustomer.get(ct.customer_id) || [ct], templateId: picked.templateId,
              templateData: buildZaloTemplateData(ct, customer, now, picked.dueTemplate),
              contractId: ct.id, customerId: ct.customer_id, kind: 'lai_hang_thang_custom_day',
            });
            if (zaloOk) { await logSent(ct.customer_id, ct.id, 'zalo_lai_ngay_cu_the'); result.zaloBaoLai++; }
          }
        }
      }
    }

    const inst = nextInstallmentInfo(ct, now);
    const mainDaysToDue = daysBetween(now, new Date(ct.due_date));
    const useInstallment = inst != null && inst.next.daysLeft < mainDaysToDue;
    const daysToDue = useInstallment ? inst!.next.daysLeft : mainDaysToDue;
    const goc = useInstallment ? inst!.next.dueAmount : Number(ct.balance);
    const dueDateForMsg = useInstallment ? inst!.next.dueDate : ct.due_date;
    if (daysToDue <= NEAR_DUE_START_DAYS && (NEAR_DUE_START_DAYS - daysToDue) % NEAR_DUE_REPEAT_DAYS === 0) {
      if (await shouldSend(ct.id, 'gan_den_han')) {
        const custName = customerMap.get(ct.customer_id)?.name || '';
        const tokens = {
          Ten_KH: custName, Ma_HD: ct.code,
          So_tien_goc: formatVNDBold(goc),
          So_tien_lai: formatVNDBold(accruedInterest(ct, now)),
          So_du: formatVNDBold(Number(ct.balance)),
          Ngay_dao_han: formatDateVNBold(dueDateForMsg),
          Ten_quy: shortName,
        };
        const body = renderNotificationTemplate(daysToDue > 0 ? pushTpl.nearDue : pushTpl.overdue, tokens);
        const ok = await pushToCustomer(ct.customer_id, NOTI_TITLE, body, 'gan-den-han');
        if (ok) { await logSent(ct.customer_id, ct.id, 'gan_den_han'); result.ganDenHanQuaHan++; }

      }
    }
  }

  try {
    const cutoff = new Date(now.getTime() - 60 * 24 * 3600 * 1000).toISOString();
    await admin.from('activity_log').delete().lt('created_at', cutoff);
  } catch (e) {
    console.error('Lỗi dọn activity_log cũ:', e);
  }

  if (purpose === 'monthly-close') {
    try {
      const monthEnd = previousMonthEndInVietnam(now);
      if (monthEnd) {
        await captureMonthlySnapshot(admin, monthEnd);
        console.info('Đã chốt số liệu tháng:', toLocalISODate(monthEnd));
      }
    } catch (e) {
      console.error('Lỗi chốt số liệu tháng:', e);
      return new Response(JSON.stringify({ ok: false, reason: 'Không chốt được số liệu tháng.' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const { data: aug2026 } = await admin.from('monthly_snapshots').select('year_month').eq('year_month', '2026-08').maybeSingle();
    if (!aug2026) await captureMonthlySnapshot(admin, new Date(2026, 7, 31));
  } catch (e) {
    console.error('Lỗi chốt bù tháng 08/2026:', e);
  }

  return new Response(JSON.stringify({ ok: true, ...result }), { headers: { 'Content-Type': 'application/json' } });
});
