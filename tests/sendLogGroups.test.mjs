import test from 'node:test';
import assert from 'node:assert/strict';
import { groupSendLogs } from '../js/lib/sendLogGroups.js';

const log = (id, phone, sec, o = {}) => ({ id, customerId: 'c1', contractId: 'k1', kind: 'lai_hang_thang_auto', triggeredBy: 'auto', triggeredByAdminId: null, phone, status: 'success', sentAt: new Date(Date.UTC(2026, 9, 26, 7, 0, sec)).toISOString(), ...o });

test('gửi cho 2 người (cách nhau vài giây) → gộp thành 1 lần gửi', () => {
  const g = groupSendLogs([log('a', '0910000000', 0), log('b', '0988777666', 1)]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].logs.map((l) => l.id).sort(), ['a', 'b']);
  assert.equal(g[0].time, Date.UTC(2026, 9, 26, 7, 0, 1));
});

test('khác hợp đồng / loại tin / cách gửi / người bấm → không gộp', () => {
  assert.equal(groupSendLogs([log('a', '0910000000', 0), log('b', '0988777666', 1, { contractId: 'k2' })]).length, 2);
  assert.equal(groupSendLogs([log('a', '0910000000', 0), log('b', '0988777666', 1, { kind: 'den_han' })]).length, 2);
  assert.equal(groupSendLogs([log('a', '0910000000', 0), log('b', '0988777666', 1, { triggeredBy: 'manual' })]).length, 2);
  assert.equal(groupSendLogs([log('a', '0910000000', 0, { triggeredBy: 'manual', triggeredByAdminId: 'x' }), log('b', '0988777666', 1, { triggeredBy: 'manual', triggeredByAdminId: 'y' })]).length, 2);
});

test('cách nhau quá 2 phút → không gộp (hai tháng khác nhau / lần gửi lại)', () => {
  assert.equal(groupSendLogs([log('a', '0910000000', 0), log('b', '0988777666', 180)]).length, 2);
});

test('gửi lại cùng 1 số (thử lại sau lỗi) là lần gửi khác, không gộp', () => {
  const g = groupSendLogs([log('a', '0910000000', 0, { status: 'error' }), log('b', '0910 000 000', 30)]);
  assert.equal(g.length, 2);
});

test('mới → cũ; một lần lỗi một lần thành công vẫn là 1 lần gửi (có 2 dòng)', () => {
  const g = groupSendLogs([
    log('old', '0910000000', 0, { sentAt: new Date(Date.UTC(2026, 8, 20)).toISOString() }),
    log('a', '0910000000', 5), log('b', '0988777666', 6, { status: 'error' }),
  ]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].logs.map((l) => l.status).sort(), ['error', 'success']);
  assert.equal(g[1].logs[0].id, 'old');
  assert.deepEqual(groupSendLogs([]), []);
});
