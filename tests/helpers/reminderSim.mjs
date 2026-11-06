// Môi trường giả lập để chạy THẬT file supabase/functions/send-due-reminders/index.ts trong Node:
// bỏ kiểu TypeScript, thay 2 import npm bằng bản giả, giả Deno / Supabase / Zalo / đồng hồ.
import * as nodeModule from 'node:module';
import { mock } from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.TZ = 'UTC'; // Edge Function chạy ở múi giờ UTC; các phép tính ngày của hàm dùng giờ địa phương của môi trường chạy

export const canStrip = typeof nodeModule.stripTypeScriptTypes === 'function';
export const FUNCTION_PATH = new URL('../../supabase/functions/send-due-reminders/index.ts', import.meta.url);

let loadCounter = 0;
const tmpRoot = () => (tmpRoot.dir ||= mkdtempSync(join(tmpdir(), 'reminder-sim-')));

function compare(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return a < b ? -1 : 1;
}

class Query {
  constructor(sim, table) {
    Object.assign(this, { sim, table, op: 'select', filters: [], orders: [], limitN: null, rangeAB: null, single: false, payload: null, returning: false });
  }
  select() { if (this.op !== 'select') this.returning = true; return this; }
  insert(p) { this.op = 'insert'; this.payload = p; return this; }
  update(p) { this.op = 'update'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
  gt(c, v) { this.filters.push((r) => r[c] > v); return this; }
  gte(c, v) { this.filters.push((r) => r[c] >= v); return this; }
  lt(c, v) { this.filters.push((r) => r[c] < v); return this; }
  order(c, o = {}) { this.orders.push([c, o.ascending !== false]); return this; }
  limit(n) { this.limitN = n; return this; }
  range(a, b) { this.rangeAB = [a, b]; return this; }
  maybeSingle() { this.single = true; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.exec()).then(res, rej); }
  exec() {
    const { sim, table: name } = this;
    sim.queryLog.push(`${this.op} ${name}`);
    const injected = sim.failure?.(name, this.op, this);
    if (injected) return { data: null, error: { message: String(injected) } };
    const table = sim.tables[name];
    if (!table) return { data: null, error: { message: `relation "${name}" does not exist` } };
    const match = (r) => this.filters.every((f) => f(r));
    if (this.op === 'insert') {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r) => ({ ...sim.defaults(name), ...r }));
      table.push(...rows);
      return { data: this.returning ? rows : null, error: null };
    }
    if (this.op === 'update') {
      const hit = table.filter(match);
      hit.forEach((r) => Object.assign(r, this.payload));
      return { data: this.returning ? hit : null, error: null };
    }
    if (this.op === 'delete') {
      const keep = table.filter((r) => !match(r));
      table.length = 0;
      table.push(...keep);
      return { data: null, error: null };
    }
    let rows = table.filter(match);
    if (this.orders.length) {
      rows = [...rows].sort((x, y) => {
        for (const [c, asc] of this.orders) { const k = compare(x[c], y[c]); if (k) return asc ? k : -k; }
        return 0;
      });
    }
    if (this.rangeAB) rows = rows.slice(this.rangeAB[0], this.rangeAB[1] + 1);
    rows = rows.slice(0, sim.maxRows); // PostgREST mặc định chỉ trả tối đa 1.000 dòng một lần
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    rows = rows.map((r) => ({ ...r }));
    return { data: this.single ? (rows[0] ?? null) : rows, error: null };
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createSim({ source, now = '2026-11-04T01:00:00Z', maxRows = 1000 } = {}) {
  if (!canStrip) throw new Error('Cần Node có module.stripTypeScriptTypes (22.13 trở lên)');
  const src = source ?? readFileSync(FUNCTION_PATH, 'utf8');
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: new Date(now) });
  const realFetch = globalThis.fetch;
  const realDeno = globalThis.Deno;
  let seq = 0;

  const sim = {
    maxRows,
    queryLog: [],
    failure: null, // (table, op, query) => chuỗi lỗi | falsy
    env: {
      SUPABASE_URL: 'http://db.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv',
      CRON_SECRET: 'bi-mat', ZALO_APP_ID: 'app', ZALO_SECRET_KEY: 'sec',
    },
    tables: {
      orgs: [{ short_name: 'Quỹ thử', zalo_template_interest_id: 'T_LAI', zalo_template_due_id: 'T_HAN', zalo_near_due_days: 15, push_templates: null }],
      contracts: [], customers: [], zalo_auto_send_list: [], zalo_send_log: [], notification_log: [], push_subscriptions: [],
      zalo_customers: [], activity_log: [], monthly_snapshots: [{ year_month: '2026-08' }],
      zalo_oa_tokens: [{ id: 'default', access_token: 'AT', refresh_token: 'RT', updated_at: new Date(now).toISOString() }],
    },
    defaults(table) {
      const stamp = new Date().toISOString();
      if (table === 'zalo_send_log') return { id: `log${++seq}`, sent_at: stamp };
      if (table === 'notification_log') return { id: `nl${++seq}`, sent_at: stamp };
      return { created_at: stamp };
    },
    zalo: {
      calls: [], tokenCalls: 0, inFlight: 0, maxInFlight: 0, latencyMs: 2,
      inFlightByCustomer: new Map(), maxPerCustomer: 0,
      onCall: null, // async (body, init) => void — chèn độ trễ / cho đồng hồ chạy
      respond: null, // (body) => { error, message } | undefined
      token: () => ({ access_token: 'AT2', refresh_token: 'RT2' }),
    },
    handler: null,
    pushes: [],
  };

  async function fakeFetch(url, init = {}) {
    const u = String(url);
    if (u.startsWith('https://business.openapi.zalo.me/message/template')) {
      const body = JSON.parse(init.body);
      const z = sim.zalo;
      const owner = body.__customerId || body.phone;
      z.calls.push({ at: Date.now(), phone: body.phone, templateId: body.template_id, data: body.template_data });
      z.inFlight += 1; z.maxInFlight = Math.max(z.maxInFlight, z.inFlight);
      const per = (z.inFlightByCustomer.get(owner) || 0) + 1;
      z.inFlightByCustomer.set(owner, per); z.maxPerCustomer = Math.max(z.maxPerCustomer, per);
      try {
        if (z.onCall) await z.onCall(body, init);
        await delay(z.latencyMs);
        const r = z.respond?.(body) ?? { error: 0, message: 'Success' };
        return { ok: true, json: async () => r };
      } finally {
        z.inFlight -= 1; z.inFlightByCustomer.set(owner, per - 1);
      }
    }
    if (u.startsWith('https://oauth.zaloapp.com/v4/oa/access_token')) {
      sim.zalo.tokenCalls += 1;
      const r = sim.zalo.token();
      return { ok: true, json: async () => r };
    }
    throw new Error(`fetch chưa được giả lập: ${u}`);
  }

  globalThis.__reminderSim = {
    createClient: () => ({ from: (t) => new Query(sim, t) }),
    webpush: { setVapidDetails() {}, async sendNotification(sub, payload) { sim.pushes.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }); return { statusCode: 201 }; } },
  };
  globalThis.Deno = { env: { get: (k) => sim.env[k] }, serve: (fn) => { sim.handler = fn; } };
  sim.background = [];
  sim.hasEdgeRuntime = true; // đặt false để mô phỏng môi trường không có EdgeRuntime.waitUntil
  globalThis.EdgeRuntime = { waitUntil: (promise) => { sim.background.push(promise); } };

  let code = nodeModule.stripTypeScriptTypes(src);
  code = code
    .replace(/^import \{ createClient \} from 'npm:@supabase\/supabase-js@2';$/m, 'const { createClient } = globalThis.__reminderSim;')
    .replace(/^import webpush from 'npm:web-push@3.6.7';$/m, 'const webpush = globalThis.__reminderSim.webpush;');
  const file = join(tmpRoot(), `fn-${++loadCounter}.mjs`);
  writeFileSync(file, code);
  await import(`${pathToFileURL(file).href}?v=${loadCounter}`);
  if (!sim.handler) throw new Error('Hàm không đăng ký Deno.serve');

  sim.consoleErrors = [];
  // wait=true (mặc định): chạy ngay trong lần gọi và trả về bảng số liệu — dễ kiểm tra.
  // wait=false: gọi như lịch chạy thật (hàm trả lời 202 ngay, việc chạy tiếp qua EdgeRuntime.waitUntil).
  sim.invoke = async (purpose = '', { secret = 'bi-mat', wait = true, force = false } = {}) => {
    globalThis.fetch = fakeFetch;
    if (sim.hasEdgeRuntime) globalThis.EdgeRuntime = { waitUntil: (promise) => { sim.background.push(promise); } };
    else delete globalThis.EdgeRuntime;
    const query = [purpose && `purpose=${purpose}`, wait && 'wait=1', force && 'force=1'].filter(Boolean).join('&');
    const url = `https://p.supabase.co/functions/v1/send-due-reminders${query ? `?${query}` : ''}`;
    const realError = console.error, realInfo = console.info;
    console.error = (...a) => { sim.consoleErrors.push(a.map(String).join(' ')); };
    console.info = () => {};
    try {
      const res = await sim.handler(new Request(url, { headers: { 'x-cron-secret': secret } }));
      const callsAtResponse = sim.zalo.calls.length;
      let body = null;
      try { body = await res.json(); } catch { /* không phải JSON */ }
      const settled = await Promise.allSettled(sim.background.splice(0));
      return { status: res.status, body, callsAtResponse, outcome: settled[0]?.value ?? null };
    } catch (error) {
      return { status: 'THROWN', body: null, error };
    } finally {
      console.error = realError; console.info = realInfo;
    }
  };
  sim.advance = (ms) => mock.timers.tick(ms);
  sim.teardown = () => {
    mock.timers.reset();
    globalThis.fetch = realFetch;
    if (realDeno === undefined) delete globalThis.Deno; else globalThis.Deno = realDeno;
    delete globalThis.__reminderSim;
    delete globalThis.EdgeRuntime;
  };

  // ── tiện ích dựng dữ liệu ──
  sim.addCustomer = (c) => { const row = { co_people: null, ...c }; sim.tables.customers.push(row); return row; };
  sim.addContract = (ct) => {
    const row = {
      principal: 50e6, balance: 50e6, interest_rate: 10.95, due_date: '2027-09-04', installment_schedule: null,
      oa_enabled: true, oa_to_main: true, oa_to_co: false, oa_co_key: null, heir_name: null, has_collateral: false,
      ...ct,
    };
    sim.tables.contracts.push(row); return row;
  };
  sim.addAuto = (a) => { const row = { id: `a${++seq}`, kind: 'lai_hang_thang_auto', custom_day: null, interval_months: 2, created_at: new Date().toISOString(), ...a }; sim.tables.zalo_auto_send_list.push(row); return row; };
  // Hợp đồng vay 04/09/2026, lãi trả đến 05/09 → mốc ngày 04: định kỳ 2 tháng thì đến lượt đúng 04/11/2026.
  sim.addDue = (i, over = {}) => {
    const customer = sim.addCustomer({ id: `c${i}`, name: `Khách ${i}`, phone: `09${String(10000000 + i).slice(-8)}` });
    const contract = sim.addContract({ id: `k${i}`, code: `${i}/26`, customer_id: customer.id, disbursed_date: '2026-09-04', interest_paid_until: '2026-09-05', ...over });
    sim.addAuto({ contract_id: contract.id, customer_id: customer.id });
    return { customer, contract };
  };
  sim.logsOf = (contractId) => sim.tables.zalo_send_log.filter((r) => r.contract_id === contractId);
  sim.okLogsOf = (contractId) => sim.logsOf(contractId).filter((r) => r.status === 'success');
  return sim;
}
