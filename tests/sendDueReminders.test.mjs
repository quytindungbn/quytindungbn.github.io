// Chạy THẬT supabase/functions/send-due-reminders/index.ts trong môi trường giả lập (xem helpers/reminderSim.mjs).
// Đặt REMINDER_SRC=<đường dẫn file .ts> để thử một bản khác (VD: bản cũ) với cùng các kịch bản.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim, canStrip } from './helpers/reminderSim.mjs';

const SOURCE = process.env.REMINDER_SRC ? readFileSync(process.env.REMINDER_SRC, 'utf8') : undefined;
const skip = canStrip ? false : 'Cần Node 22.13 trở lên (module.stripTypeScriptTypes)';
const MIN15 = 15 * 60 * 1000;

async function newSim(t) {
  const sim = await createSim({ source: SOURCE });
  t.after(() => sim.teardown());
  return sim;
}

test('gửi đúng hợp đồng đến lượt, mỗi người nhận một tin; chạy lại không gửi trùng', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.addDue(2);
  const c3 = sim.addDue(3); // có người cùng vay được tích → gửi cả 2 người
  c3.customer.co_people = [{ name: 'Lê Văn Khánh', phone: '0977111222' }];
  Object.assign(c3.contract, { heir_name: 'Lê Văn Khánh', oa_to_co: true, oa_co_key: 'Lê Văn Khánh' });
  sim.addCustomer({ id: 'c9', name: 'Khách 9', phone: '0910000009' }); // vay ngày 10 → chưa đến lượt
  sim.addContract({ id: 'k9', code: '9/26', customer_id: 'c9', disbursed_date: '2026-09-10', interest_paid_until: '2026-09-11' });
  sim.addAuto({ contract_id: 'k9', customer_id: 'c9' });
  sim.addCustomer({ id: 'c8', name: 'Khách 8', phone: '0910000008' }); // đã tất toán
  sim.addContract({ id: 'k8', code: '8/26', customer_id: 'c8', disbursed_date: '2026-09-04', interest_paid_until: '2026-09-05', balance: 0 });
  sim.addAuto({ contract_id: 'k8', customer_id: 'c8' });

  const first = await sim.invoke();
  assert.equal(first.status, 200);
  assert.deepEqual(sim.zalo.calls.map((c) => c.phone).sort(), ['84910000001', '84910000002', '84910000003', '84977111222']);
  assert.equal(first.body.zaloBaoLai, 3);
  assert.equal(sim.tables.zalo_send_log.filter((r) => r.status === 'success' && r.triggered_by === 'auto').length, 4);
  assert.equal(sim.tables.notification_log.filter((r) => r.kind === 'zalo_lai_hang_thang').length, 3);
  assert.equal(sim.zalo.calls[0].templateId, 'T_LAI');
  assert.ok(sim.zalo.calls.every((c) => c.data.SO_HDTD && c.data.TEN_KHACH_HANG));

  sim.advance(MIN15);
  const again = await sim.invoke();
  assert.equal(again.body.zaloBaoLai, 0);
  assert.equal(sim.zalo.calls.length, 4, 'lượt bù không được gửi trùng');
});

test('gửi song song tối đa 5 tin một lúc', { skip }, async (t) => {
  const sim = await newSim(t);
  for (let i = 1; i <= 20; i++) sim.addDue(i);
  sim.zalo.latencyMs = 10;
  const res = await sim.invoke();
  assert.equal(res.body.zaloBaoLai, 20);
  assert.equal(sim.zalo.maxInFlight, 5);
});

test('các hợp đồng của cùng một khách luôn được xử lý lần lượt', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addCustomer({ id: 'cx', name: 'Khách X', phone: '0910000099' });
  for (const n of [1, 2, 3]) {
    sim.addContract({ id: `kx${n}`, code: `${n}/27`, customer_id: 'cx', disbursed_date: '2026-09-04', interest_paid_until: '2026-09-05' });
    sim.addAuto({ contract_id: `kx${n}`, customer_id: 'cx' });
  }
  for (let i = 1; i <= 10; i++) sim.addDue(i);
  sim.zalo.latencyMs = 10;
  const res = await sim.invoke();
  assert.equal(res.body.zaloBaoLai, 13);
  assert.equal(sim.zalo.maxPerCustomer, 1);
});

test('một hợp đồng lỗi dữ liệu không làm dừng cả lượt', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1, { interest_rate: '10,5' }); // phép tính lãi báo lỗi
  for (const i of [2, 3, 4, 5]) sim.addDue(i);
  const res = await sim.invoke();
  assert.equal(res.status, 200, String(res.error?.message || ''));
  assert.equal(res.body.zaloBaoLai, 4);
  assert.ok(res.body.loiHeThong >= 1);
});

test('đọc đủ dữ liệu khi có hơn 1.000 hợp đồng (giới hạn 1.000 dòng mỗi lần đọc)', { skip }, async (t) => {
  const sim = await newSim(t);
  for (let i = 1; i <= 1150; i++) {
    sim.addCustomer({ id: `s${i}`, name: `Cũ ${i}`, phone: `08${String(10000000 + i).slice(-8)}` });
    sim.addContract({ id: `sk${i}`, code: `${i}/20`, customer_id: `s${i}`, disbursed_date: '2020-01-10', interest_paid_until: '2020-02-10', balance: 0 });
  }
  for (let i = 1; i <= 30; i++) sim.addDue(i); // nằm sau dòng thứ 1.000 của bảng
  const res = await sim.invoke();
  assert.equal(res.status, 200);
  assert.equal(res.body.zaloBaoLai, 30);
});

test('không lấy được mã truy cập Zalo: ghi rõ vào lịch sử, 15 phút sau gửi bù được', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.addDue(2);
  sim.tables.zalo_oa_tokens[0].updated_at = new Date(Date.now() - 2 * 3600e3).toISOString(); // hết hạn → phải làm mới
  sim.zalo.token = () => ({ error: -216, message: 'refresh token hết hạn' });
  const first = await sim.invoke();
  assert.equal(first.status, 200);
  assert.equal(sim.zalo.calls.length, 0);
  assert.equal(sim.tables.zalo_send_log.length, 2, 'mỗi hợp đồng đến lượt có 1 dòng báo lỗi');
  assert.ok(sim.tables.zalo_send_log.every((r) => r.status === 'error' && r.triggered_by === 'auto' && /Chưa lấy được mã truy cập Zalo OA/.test(r.error_message)));

  sim.advance(MIN15);
  sim.zalo.token = () => ({ access_token: 'AT3', refresh_token: 'RT3' });
  const second = await sim.invoke();
  assert.equal(second.body.zaloBaoLai, 2);
  assert.equal(sim.okLogsOf('k1').length, 1);
  assert.equal(sim.logsOf('k1').length, 2, '1 dòng lỗi lúc đầu + 1 dòng thành công khi gửi bù');
});

test('lần gửi đã thử mà Zalo báo lỗi thì không bị gửi lại ở lượt bù', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.zalo.respond = () => ({ error: -124, message: 'Access token invalid' });
  await sim.invoke();
  assert.equal(sim.logsOf('k1').length, 1);
  assert.equal(sim.logsOf('k1')[0].status, 'error');

  sim.advance(MIN15);
  sim.zalo.respond = null;
  const second = await sim.invoke();
  assert.equal(second.body.zaloBaoLai, 0);
  assert.equal(sim.logsOf('k1').length, 1);
});

test('hết giờ giữa chừng: phần chưa làm được gửi bù ở lượt sau, không ai nhận trùng', { skip }, async (t) => {
  const sim = await newSim(t);
  for (let i = 1; i <= 12; i++) sim.addDue(i);
  sim.zalo.onCall = async () => { sim.advance(40_000); }; // mỗi lần gọi Zalo "tốn" 40 giây
  const first = await sim.invoke();
  assert.equal(first.status, 200);
  const sent = first.body.zaloBaoLai;
  assert.ok(sent >= 1 && sent < 12, `lượt đầu gửi ${sent}`);
  assert.equal(first.body.chuaXuLy, 12 - sent);

  sim.zalo.onCall = null;
  sim.advance(MIN15);
  const second = await sim.invoke();
  assert.equal(second.body.zaloBaoLai, 12 - sent);
  assert.equal(second.body.chuaXuLy, 0);
  for (let i = 1; i <= 12; i++) assert.equal(sim.okLogsOf(`k${i}`).length, 1, `hợp đồng k${i}`);
});

test('tin gửi tay trong 5 ngày gần nhất vẫn chặn gửi tự động', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.addDue(2);
  sim.tables.zalo_send_log.push({ id: 'm1', contract_id: 'k1', customer_id: 'c1', kind: 'x', status: 'success', triggered_by: 'manual', sent_at: new Date(Date.now() - 2 * 86400e3).toISOString() });
  await sim.invoke();
  assert.deepEqual(sim.zalo.calls.map((c) => c.phone), ['84910000002']);
});

test('Zalo không phản hồi (quá thời gian chờ): ghi lý do dễ hiểu', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.zalo.onCall = async () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; };
  await sim.invoke();
  const row = sim.logsOf('k1')[0];
  assert.equal(row.status, 'error');
  assert.match(row.error_message, /không phản hồi/);
});

test('không đọc được danh sách gửi tự động: vẫn chạy tiếp và báo cảnh báo', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.failure = (table) => table === 'zalo_auto_send_list' && 'khong doc duoc';
  const res = await sim.invoke();
  assert.equal(res.status, 200);
  assert.equal(sim.zalo.calls.length, 0);
  assert.ok(res.body.warnings?.length >= 1);
});

test('mục "Gửi theo ngày cụ thể" vẫn gửi đúng ngày đã chọn', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.tables.zalo_auto_send_list.length = 0;
  sim.addAuto({ contract_id: 'k1', customer_id: 'c1', kind: 'lai_hang_thang_custom_day', custom_day: 4, interval_months: 1 });
  sim.addDue(2);
  sim.tables.zalo_auto_send_list.pop();
  sim.addAuto({ contract_id: 'k2', customer_id: 'c2', kind: 'lai_hang_thang_custom_day', custom_day: 9, interval_months: 1 }); // ngày 9: chưa đến
  const res = await sim.invoke();
  assert.equal(res.body.zaloBaoLai, 1);
  assert.deepEqual(sim.zalo.calls.map((c) => c.phone), ['84910000001']);
  assert.ok(sim.tables.notification_log.some((r) => r.kind === 'zalo_lai_ngay_cu_the' && r.contract_id === 'k1'));
});

test('lượt chốt số liệu cuối tháng không gửi tin Zalo; sai mã bí mật bị từ chối', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  const close = await sim.invoke('monthly-close');
  assert.equal(close.status, 200);
  assert.equal(sim.zalo.calls.length, 0);
  const denied = await sim.invoke('', { secret: 'sai' });
  assert.equal(denied.status, 401);
});

test('chạy như lịch thật: trả lời ngay (202) rồi vẫn gửi đủ trong nền', { skip }, async (t) => {
  const sim = await newSim(t);
  for (let i = 1; i <= 8; i++) sim.addDue(i);
  sim.zalo.latencyMs = 20;
  const res = await sim.invoke('', { wait: false });
  assert.equal(res.status, 202);
  assert.deepEqual(res.body, { ok: true, started: true });
  assert.ok(res.callsAtResponse < 8, `lúc trả lời mới gọi Zalo ${res.callsAtResponse} lần`);
  assert.equal(res.outcome.status, 200);
  assert.equal(res.outcome.body.zaloBaoLai, 8);
  assert.equal(sim.zalo.calls.length, 8);
});

test('môi trường không có EdgeRuntime.waitUntil: chạy ngay trong lần gọi như trước', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.hasEdgeRuntime = false;
  sim.addDue(1);
  const res = await sim.invoke('', { wait: false });
  assert.equal(res.status, 200);
  assert.equal(res.body.zaloBaoLai, 1);
});

test('chốt số liệu cuối tháng luôn chạy trong lần gọi, không chạy nền', { skip }, async (t) => {
  const sim = await newSim(t);
  const res = await sim.invoke('monthly-close', { wait: false });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('lỗi đọc dữ liệu không làm hàm sập: trả 500 có lý do để lượt bù thử lại', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.failure = (table) => table === 'contracts' && 'mất kết nối';
  const res = await sim.invoke();
  assert.equal(res.status, 500);
  assert.equal(res.body.ok, false);
  assert.equal(sim.zalo.calls.length, 0);
  sim.failure = null;
  sim.advance(MIN15);
  const retry = await sim.invoke();
  assert.equal(retry.body.zaloBaoLai, 1);
});

test('thông báo đẩy cho khách vẫn gửi 1 lần mỗi ngày; lượt bù không gửi lại', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addCustomer({ id: 'c1', name: 'Khách 1', phone: '0910000001' });
  sim.addContract({ id: 'k1', code: '1/26', customer_id: 'c1', disbursed_date: '2026-09-04', interest_paid_until: '2026-09-05' }); // đúng ngày nhắc lãi hàng tháng, chưa vào gửi tự động
  sim.tables.push_subscriptions.push({ owner_type: 'customer', owner_id: 'c1', endpoint: 'https://push.test/1', p256dh: 'x', auth: 'y' });
  const first = await sim.invoke();
  assert.equal(first.body.laiHangThang, 1);
  assert.equal(sim.pushes.length, 1);
  assert.equal(sim.zalo.calls.length, 0);
  sim.advance(MIN15);
  const second = await sim.invoke();
  assert.equal(second.body.laiHangThang, 0);
  assert.equal(sim.pushes.length, 1);
});
