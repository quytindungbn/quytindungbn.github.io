// Chạy THẬT supabase/functions/send-due-reminders/index.ts trong môi trường giả lập (xem helpers/reminderSim.mjs).
// Đồng hồ giả bắt đầu đúng 8h00 giờ Việt Nam (01:00 UTC) ngày 04/11/2026; cron thật chạy mỗi phút từ 8h00 đến 8h15.
// Đặt REMINDER_SRC=<đường dẫn file .ts> để thử một bản khác (VD: bản cũ) với cùng các kịch bản.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim, canStrip } from './helpers/reminderSim.mjs';

const SOURCE = process.env.REMINDER_SRC ? readFileSync(process.env.REMINDER_SRC, 'utf8') : undefined;
const skip = canStrip ? false : 'Cần Node 22.13 trở lên (module.stripTypeScriptTypes)';
const MIN1 = 60 * 1000;
const TIEP = 'Chưa lấy được mã truy cập Zalo OA';

async function newSim(t, opts = {}) {
  const sim = await createSim({ source: SOURCE, ...opts });
  t.after(() => sim.teardown());
  return sim;
}
const doneMarks = (sim) => sim.tables.notification_log.filter((r) => r.kind === 'zalo_run_done');
const lockRows = (sim) => sim.tables.notification_log.filter((r) => r.kind === 'zalo_run_lock');
// Chạy mỗi phút từ 8h00 đến 8h15 (16 lượt) như Cron Job thật; trả về kết quả từng lượt.
async function runWindow(sim, opts = {}) {
  const outs = [];
  for (let minute = 0; minute <= 15; minute++) {
    outs.push(await sim.invoke('', opts));
    sim.advance(MIN1);
  }
  return outs;
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
  assert.equal(first.body.daXong, true);
  assert.equal(sim.tables.zalo_send_log.filter((r) => r.status === 'success' && r.triggered_by === 'auto').length, 4);
  assert.equal(sim.tables.notification_log.filter((r) => r.kind === 'zalo_lai_hang_thang').length, 3);
  assert.equal(sim.zalo.calls[0].templateId, 'T_LAI');
  assert.ok(sim.zalo.calls.every((c) => c.data.SO_HDTD && c.data.TEN_KHACH_HANG));
  assert.equal(doneMarks(sim).length, 1);
  assert.equal(lockRows(sim).length, 0, 'xong lượt là nhả khóa');

  sim.advance(MIN1);
  const again = await sim.invoke();
  assert.equal(again.body.daXong, true);
  assert.equal(sim.zalo.calls.length, 4);
  const forced = await sim.invoke('', { force: true }); // ép chạy lại cả khi đã xong
  assert.equal(forced.body.zaloBaoLai, 0);
  assert.equal(sim.zalo.calls.length, 4, 'chạy lại ép buộc cũng không được gửi trùng');
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

test('một hợp đồng lỗi dữ liệu không làm dừng cả lượt và không bắt chạy lặp vô ích', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1, { interest_rate: '10,5' }); // phép tính lãi báo lỗi
  for (const i of [2, 3, 4, 5]) sim.addDue(i);
  const res = await sim.invoke();
  assert.equal(res.status, 200, String(res.error?.message || ''));
  assert.equal(res.body.zaloBaoLai, 4);
  assert.ok(res.body.loiHeThong >= 1);
  assert.equal(res.body.daXong, true, 'lỗi dữ liệu là lỗi cố định, thử lại cũng vậy');
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

test('Zalo chưa cấp mã lúc 8h00 nhưng cấp lại sau vài phút: tự gửi, lịch sử không có dòng lỗi thừa', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.addDue(2);
  sim.tables.zalo_oa_tokens[0].updated_at = new Date(Date.now() - 2 * 3600e3).toISOString(); // hết hạn → phải làm mới
  sim.zalo.token = () => ({ error: -216, message: 'refresh token hết hạn' });
  const first = await sim.invoke();
  assert.equal(first.body.daXong, false);
  assert.equal(sim.zalo.calls.length, 0);
  assert.equal(sim.tables.zalo_send_log.length, 0, 'còn thời gian thử lại thì chưa ghi lỗi');
  assert.equal(doneMarks(sim).length, 0, 'chưa xong thì chưa đánh dấu');

  sim.advance(MIN1);
  assert.equal((await sim.invoke()).body.daXong, false); // 8h01 vẫn chưa có mã

  sim.advance(MIN1);
  sim.zalo.token = () => ({ access_token: 'AT3', refresh_token: 'RT3' }); // 8h02 Zalo cấp lại mã
  const third = await sim.invoke();
  assert.equal(third.body.zaloBaoLai, 2);
  assert.equal(third.body.daXong, true);
  assert.equal(sim.tables.zalo_send_log.length, 2);
  assert.ok(sim.tables.zalo_send_log.every((r) => r.status === 'success'));
  assert.equal(sim.okLogsOf('k1').length, 1);
});

test('Zalo không cấp được mã suốt khung giờ: đến lượt cuối (8h14) ghi rõ 1 dòng lỗi mỗi hợp đồng', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.addDue(2);
  sim.tables.zalo_oa_tokens[0].updated_at = new Date(Date.now() - 2 * 3600e3).toISOString();
  sim.zalo.token = () => ({ error: -216, message: 'refresh token hết hạn' });
  const outs = await runWindow(sim);
  assert.equal(sim.zalo.calls.length, 0);
  assert.deepEqual(outs.slice(0, 14).map((o) => o.body.daXong), Array(14).fill(false));
  assert.equal(outs[14].body.daXong, true, 'lượt cuối (8h14) ghi lỗi rồi hết việc để thử lại');
  assert.equal(outs[15].body.daXong, true, '8h15 chỉ kiểm tra nhẹ');
  assert.equal(sim.tables.zalo_send_log.length, 2);
  assert.ok(sim.tables.zalo_send_log.every((r) => r.status === 'error' && r.triggered_by === 'auto' && r.error_message.startsWith(TIEP)));
  assert.equal(sim.logsOf('k1').length, 1);
  const late = await sim.invoke(); // 8h16: hết khung giờ
  assert.equal(late.body.boQua, 'ngoài khung 8h00–8h15');
});

test('lần gửi mà Zalo báo lỗi thì không bị gửi lại và hôm đó tính là đã xong', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.zalo.respond = () => ({ error: -124, message: 'Access token invalid' });
  const first = await sim.invoke();
  assert.equal(first.body.daXong, true);
  assert.equal(sim.logsOf('k1').length, 1);
  assert.equal(sim.logsOf('k1')[0].status, 'error');

  sim.advance(MIN1);
  sim.zalo.respond = null;
  const second = await sim.invoke();
  assert.equal(second.body.daXong, true);
  assert.equal(sim.zalo.calls.length, 1);
  assert.equal(sim.logsOf('k1').length, 1);
});

test('hết giờ giữa chừng: lượt sau làm tiếp phần còn lại, không ai nhận trùng', { skip }, async (t) => {
  const sim = await newSim(t);
  for (let i = 1; i <= 12; i++) sim.addDue(i);
  sim.zalo.onCall = async () => { sim.advance(40_000); }; // mỗi lần gọi Zalo "tốn" 40 giây
  const first = await sim.invoke();
  assert.equal(first.status, 200);
  const sent = first.body.zaloBaoLai;
  assert.ok(sent >= 1 && sent < 12, `lượt đầu gửi ${sent}`);
  assert.equal(first.body.chuaXuLy, 12 - sent);
  assert.equal(first.body.daXong, false);
  assert.equal(doneMarks(sim).length, 0);

  sim.zalo.onCall = null;
  sim.advance(MIN1);
  const second = await sim.invoke();
  assert.equal(second.body.zaloBaoLai, 12 - sent);
  assert.equal(second.body.chuaXuLy, 0);
  assert.equal(second.body.daXong, true);
  for (let i = 1; i <= 12; i++) assert.equal(sim.okLogsOf(`k${i}`).length, 1, `hợp đồng k${i}`);
});

test('lượt nào cũng bị hết giờ: chạy lặp nhiều lượt đến khi xong, mỗi hợp đồng đúng một tin', { skip }, async (t) => {
  const sim = await newSim(t);
  for (let i = 1; i <= 12; i++) sim.addDue(i);
  sim.zalo.onCall = async () => { sim.advance(40_000); };
  let passes = 0;
  let last;
  do {
    last = await sim.invoke();
    passes += 1;
    sim.advance(MIN1);
  } while (!last.body.daXong && passes < 8);
  assert.equal(last.body.daXong, true);
  assert.ok(passes >= 2 && passes <= 4, `cần ${passes} lượt`);
  for (let i = 1; i <= 12; i++) assert.equal(sim.okLogsOf(`k${i}`).length, 1, `hợp đồng k${i}`);
  assert.equal(sim.zalo.calls.length, 12);
  assert.equal(doneMarks(sim).length, 1);
});

test('tin gửi tay trong 5 ngày gần nhất vẫn chặn gửi tự động', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.addDue(2);
  sim.tables.zalo_send_log.push({ id: 'm1', contract_id: 'k1', customer_id: 'c1', kind: 'x', status: 'success', triggered_by: 'manual', sent_at: new Date(Date.now() - 2 * 86400e3).toISOString() });
  await sim.invoke();
  assert.deepEqual(sim.zalo.calls.map((c) => c.phone), ['84910000002']);
});

test('Zalo không phản hồi (quá thời gian chờ): ghi lý do dễ hiểu và không gửi lại (có thể tin đã đi)', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.zalo.onCall = async () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; };
  const first = await sim.invoke();
  const row = sim.logsOf('k1')[0];
  assert.equal(row.status, 'error');
  assert.match(row.error_message, /không phản hồi/);
  assert.equal(first.body.daXong, true);
  sim.advance(MIN1);
  await sim.invoke();
  assert.equal(sim.zalo.calls.length, 1);
});

test('lỗi kết nối tới Zalo thoáng qua (tin chưa đi): lượt sau gửi được, lịch sử chỉ có dòng thành công', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  let broken = true;
  sim.zalo.onCall = async () => { if (broken) throw new TypeError('fetch failed'); };
  const first = await sim.invoke();
  assert.equal(first.body.daXong, false);
  assert.equal(first.body.zaloBaoLai, 0);
  assert.equal(sim.logsOf('k1').length, 0, 'còn thời gian thử lại thì chưa ghi lỗi');

  broken = false;
  sim.advance(MIN1);
  const second = await sim.invoke();
  assert.equal(second.body.zaloBaoLai, 1);
  assert.equal(second.body.daXong, true);
  assert.equal(sim.logsOf('k1').length, 1);
  assert.equal(sim.okLogsOf('k1').length, 1);
});

test('lỗi kết nối kéo dài suốt khung giờ: thử mỗi phút, đến lượt cuối (8h14) ghi 1 dòng lỗi', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.zalo.onCall = async () => { throw new TypeError('fetch failed'); };
  const outs = await runWindow(sim);
  assert.equal(sim.zalo.calls.length, 15, 'thử mỗi phút từ 8h00 đến 8h14');
  assert.deepEqual(outs.slice(0, 14).map((o) => o.body.daXong), Array(14).fill(false));
  assert.equal(outs[14].body.daXong, true);
  assert.equal(outs[15].body.daXong, true);
  assert.equal(sim.logsOf('k1').length, 1);
  assert.match(sim.logsOf('k1')[0].error_message, /^Lỗi kết nối Zalo: /);
});

test('người vay gửi được còn người cùng vay lỗi kết nối: ghi ngay dòng lỗi của người cùng vay, không bỏ sót im lặng', { skip }, async (t) => {
  const sim = await newSim(t);
  const d = sim.addDue(1);
  d.customer.co_people = [{ name: 'Lê Văn Khánh', phone: '0977111222' }];
  Object.assign(d.contract, { heir_name: 'Lê Văn Khánh', oa_to_co: true, oa_co_key: 'Lê Văn Khánh' });
  sim.zalo.onCall = async (body) => { if (body.phone === '84977111222') throw new TypeError('fetch failed'); };
  const res = await sim.invoke();
  assert.equal(res.body.zaloBaoLai, 1);
  assert.equal(res.body.daXong, true);
  const rows = sim.logsOf('k1');
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.status === 'success').length, 1);
  assert.equal(rows.filter((r) => /^Lỗi kết nối Zalo/.test(r.error_message || '')).length, 1);
});

test('đọc nhật ký bị lỗi thoáng qua: không gửi bừa, lượt sau gửi đủ', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.addDue(2);
  sim.failure = (table, op) => table === 'notification_log' && op === 'select' && 'mất kết nối';
  const first = await sim.invoke();
  assert.equal(sim.zalo.calls.length, 0);
  assert.equal(first.body.daXong, false);
  assert.ok(first.body.canThuLai >= 2);

  sim.failure = null;
  sim.advance(MIN1);
  const second = await sim.invoke();
  assert.equal(second.body.zaloBaoLai, 2);
  assert.equal(second.body.daXong, true);
});

test('không đọc được danh sách gửi tự động: vẫn chạy tiếp, báo cảnh báo và chưa tính là xong', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.failure = (table) => table === 'zalo_auto_send_list' && 'khong doc duoc';
  const res = await sim.invoke();
  assert.equal(res.status, 200);
  assert.equal(sim.zalo.calls.length, 0);
  assert.ok(res.body.warnings?.length >= 1);
  assert.equal(res.body.daXong, false);
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

test('lượt chốt số liệu cuối tháng không gửi tin Zalo, không khóa, không đánh dấu; sai mã bí mật bị từ chối', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  const close = await sim.invoke('monthly-close');
  assert.equal(close.status, 200);
  assert.equal(sim.zalo.calls.length, 0);
  assert.equal(doneMarks(sim).length, 0, 'lượt chốt tháng không đánh dấu "đã xong"');
  assert.equal(lockRows(sim).length, 0);
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

test('lỗi đọc dữ liệu không làm hàm sập: trả 500 có lý do, lượt sau chạy lại bình thường', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.failure = (table) => table === 'contracts' && 'mất kết nối';
  const res = await sim.invoke();
  assert.equal(res.status, 500);
  assert.equal(res.body.ok, false);
  assert.equal(sim.zalo.calls.length, 0);
  assert.equal(doneMarks(sim).length, 0);
  assert.equal(lockRows(sim).length, 0, 'lỗi cũng phải nhả khóa');
  sim.failure = null;
  sim.advance(MIN1);
  const retry = await sim.invoke();
  assert.equal(retry.body.zaloBaoLai, 1);
});

test('thông báo đẩy cho khách vẫn gửi 1 lần mỗi ngày, chạy lại không gửi lại', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addCustomer({ id: 'c1', name: 'Khách 1', phone: '0910000001' });
  sim.addContract({ id: 'k1', code: '1/26', customer_id: 'c1', disbursed_date: '2026-09-04', interest_paid_until: '2026-09-05' }); // đúng ngày nhắc lãi hàng tháng, chưa vào gửi tự động
  sim.tables.push_subscriptions.push({ owner_type: 'customer', owner_id: 'c1', endpoint: 'https://push.test/1', p256dh: 'x', auth: 'y' });
  const first = await sim.invoke();
  assert.equal(first.body.laiHangThang, 1);
  assert.equal(sim.pushes.length, 1);
  assert.equal(sim.zalo.calls.length, 0);
  sim.advance(MIN1);
  const forced = await sim.invoke('', { force: true });
  assert.equal(forced.body.laiHangThang, 0);
  assert.equal(sim.pushes.length, 1);
});

test('chỉ chạy trong khung 8h00–8h15 giờ Việt Nam; ép buộc thì chạy', { skip }, async (t) => {
  const early = await newSim(t, { now: '2026-11-04T00:59:00Z' }); // 7h59
  early.addDue(1);
  const e1 = await early.invoke();
  assert.equal(e1.body.boQua, 'ngoài khung 8h00–8h15');
  assert.equal(early.zalo.calls.length, 0);
  assert.equal(early.queryLog.length, 0, 'không đụng tới cơ sở dữ liệu');
  assert.equal((await early.invoke('', { force: true })).body.zaloBaoLai, 1);
  early.teardown();

  const edge = await createSim({ source: SOURCE, now: '2026-11-04T01:15:30Z' }); // 8h15 phút 30 giây: vẫn trong khung
  t.after(() => edge.teardown());
  edge.addDue(1);
  assert.equal((await edge.invoke()).body.zaloBaoLai, 1);
  edge.teardown();

  const late = await createSim({ source: SOURCE, now: '2026-11-04T01:16:00Z' }); // 8h16: hết khung
  t.after(() => late.teardown());
  late.addDue(1);
  assert.equal((await late.invoke()).body.boQua, 'ngoài khung 8h00–8h15');
  assert.equal(late.zalo.calls.length, 0);
  late.teardown();

  const noon = await createSim({ source: SOURCE, now: '2026-11-04T05:00:00Z' }); // 12h
  t.after(() => noon.teardown());
  noon.addDue(1);
  assert.equal((await noon.invoke()).body.boQua, 'ngoài khung 8h00–8h15');
});

test('đã xong hôm nay: các lượt sau trong khung chỉ kiểm tra rất nhẹ, không đọc lại hợp đồng', { skip }, async (t) => {
  const sim = await newSim(t);
  for (let i = 1; i <= 5; i++) sim.addDue(i);
  const first = await sim.invoke();
  assert.equal(first.body.daXong, true);
  const before = sim.queryLog.length;
  sim.advance(MIN1);
  const next = await sim.invoke();
  assert.equal(next.body.daXong, true);
  const used = sim.queryLog.slice(before);
  assert.ok(used.length <= 3, used.join(', '));
  assert.ok(!used.includes('select contracts') && !used.includes('select customers'));
  assert.equal(sim.zalo.calls.length, 5);
});

test('hợp đồng thêm vào gửi tự động trong lúc 8h00–8h15 được gửi ở lượt kế tiếp; thêm sau 8h15 thì không', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  const first = await sim.invoke();
  assert.equal(first.body.daXong, true);
  sim.advance(7 * MIN1); // 8h07
  sim.addDue(99); // anh/chị vừa thêm vào danh sách, hôm nay là ngày đến lượt của hợp đồng này
  const second = await sim.invoke();
  assert.equal(second.body.zaloBaoLai, 1);
  assert.equal(second.body.daXong, true);
  assert.equal(sim.zalo.calls.length, 2);
  assert.equal(sim.okLogsOf('k1').length, 1);
  assert.equal(sim.okLogsOf('k99').length, 1);

  sim.advance(10 * MIN1); // 8h17: hết khung
  sim.addDue(100);
  assert.equal((await sim.invoke()).body.boQua, 'ngoài khung 8h00–8h15');
  assert.equal(sim.zalo.calls.length, 2);
});

test('chưa chọn mẫu tin Zalo trong Cài đặt: ghi lý do vào lịch sử, không bỏ qua im lặng', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.tables.orgs[0].zalo_template_interest_id = null; // chưa chọn mẫu "Báo lãi"
  sim.addDue(1); // đến lượt, còn xa hạn → cần mẫu "Báo lãi"
  const first = await sim.invoke();
  assert.equal(sim.zalo.calls.length, 0);
  assert.equal(sim.logsOf('k1').length, 1);
  assert.match(sim.logsOf('k1')[0].error_message, /Chưa chọn mẫu tin Zalo "Báo lãi" trong Cài đặt/);
  assert.equal(first.body.daXong, true, 'lỗi cài đặt, chạy lại cũng không khác');
  sim.advance(MIN1);
  await sim.invoke('', { force: true });
  assert.equal(sim.logsOf('k1').length, 1, 'mỗi hợp đồng chỉ ghi một dòng trong ngày');
});

test('hai lượt cron chồng nhau: chỉ một lượt làm việc, hợp đồng nào cũng đúng một tin', { skip }, async (t) => {
  const sim = await newSim(t);
  for (let i = 1; i <= 10; i++) sim.addDue(i);
  sim.zalo.latencyMs = 10;
  const both = await sim.invokeParallel(2);
  const worked = both.filter((r) => r.body.zaloBaoLai > 0);
  const skipped = both.filter((r) => r.body.boQua === 'đang có lượt khác chạy');
  assert.equal(worked.length, 1);
  assert.equal(skipped.length, 1);
  assert.equal(sim.zalo.calls.length, 10);
  for (let i = 1; i <= 10; i++) assert.equal(sim.okLogsOf(`k${i}`).length, 1, `hợp đồng k${i}`);
  assert.equal(lockRows(sim).length, 0);
});

test('khóa chạy còn hạn (lượt khác đang làm) thì bỏ qua; khóa cũ quá 150 giây (lượt đó đã chết) thì bỏ qua khóa và chạy', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.tables.notification_log.push({ id: 'zz1', owner_id: 'system', kind: 'zalo_run_lock', contract_id: null, sent_at: new Date(Date.now() - 30_000).toISOString() });
  const blocked = await sim.invoke();
  assert.equal(blocked.body.boQua, 'đang có lượt khác chạy');
  assert.equal(sim.zalo.calls.length, 0);

  sim.advance(3 * 60_000); // khóa cũ đã hơn 150 giây
  const ran = await sim.invoke();
  assert.equal(ran.body.zaloBaoLai, 1);
  assert.equal(lockRows(sim).filter((r) => r.id !== 'zz1').length, 0, 'lượt này nhả khóa của chính nó');
});

test('không ghi được nhật ký thông báo (khóa/dấu xong/tin đã gửi): vẫn không gửi trùng nhờ lịch sử gửi Zalo', { skip }, async (t) => {
  const sim = await newSim(t);
  sim.addDue(1);
  sim.addDue(2);
  sim.failure = (table, op) => table === 'notification_log' && op === 'insert' && 'cấm ghi';
  for (let i = 0; i < 3; i++) {
    const res = await sim.invoke();
    assert.equal(res.status, 200);
    sim.advance(MIN1);
  }
  assert.equal(sim.zalo.calls.length, 2, 'mỗi hợp đồng đúng một tin dù 3 lượt');
  assert.equal(sim.okLogsOf('k1').length, 1);
  assert.ok(sim.consoleErrors.some((m) => m.includes('Không đặt được dấu "đang chạy"')));
});
