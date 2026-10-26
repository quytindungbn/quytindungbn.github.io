import test from 'node:test';
import assert from 'node:assert/strict';
import { normPersonName, samePerson, samePhone, heirOfContract, heirNamesOf, coPhoneOf, contractOa, customerOaSummary, shortPersonName, checkCoPhone, sanitizeCoPhoneInput } from '../js/lib/coBorrower.js';

test('so sánh tên: bỏ qua hoa/thường và khoảng trắng thừa, giữ dấu', () => {
  assert.equal(normPersonName('  Trần   Văn  Bình '), 'trần văn bình');
  assert.ok(samePerson('TRẦN VĂN BÌNH', 'Trần Văn Bình'));
  assert.ok(!samePerson('Trần Văn Bình', 'Trần Văn Binh'));
  assert.ok(!samePerson('', ''));
  assert.ok(!samePerson(null, 'A'));
});

test('heirNamesOf: bỏ tên trống, tên trùng khách và tên lặp', () => {
  const cts = [{ heirName: 'ĐỖ THỊ HOA' }, { heirName: '' }, { heirName: 'LÊ QUANG NINH' }, { heirName: 'đỗ  thị hoa' }, { heirName: 'VÕ VĂN AN' }, {}];
  assert.deepEqual(heirNamesOf(cts, 'Lê Quang Ninh'), ['ĐỖ THỊ HOA', 'VÕ VĂN AN']);
  assert.deepEqual(heirNamesOf([], 'A'), []);
  assert.deepEqual(heirNamesOf(null, 'A'), []);
});

test('samePhone: so sánh số điện thoại bỏ ký tự lạ, +84/84 coi như 0', () => {
  assert.ok(samePhone('0988 777 666', '+84988777666'));
  assert.ok(samePhone('84988777666', '0988.777.666'));
  assert.ok(!samePhone('0988777666', '0988777667'));
  assert.ok(!samePhone('', ''));
});

test('heirOfContract: tên người cùng vay ghi trên hợp đồng; bỏ tên trống và tên trùng người vay', () => {
  assert.equal(heirOfContract({ heirName: '  Trần  Thị Bích ' }, 'LÊ VĂN A'), 'Trần Thị Bích');
  assert.equal(heirOfContract({ heirName: 'LÊ VĂN A' }, 'lê văn a'), '');
  assert.equal(heirOfContract({ heirName: null }, 'A'), '');
  assert.equal(heirOfContract({}, 'A'), '');
});

test('coPhoneOf: tìm số trong sổ người cùng vay không phân biệt hoa/thường', () => {
  const people = [{ name: 'TRẦN THỊ BÍCH', phone: '0988777666' }, { name: 'Lê Văn Khánh', phone: '' }];
  assert.equal(coPhoneOf(people, 'trần thị bích'), '0988777666');
  assert.equal(coPhoneOf(people, 'LÊ VĂN KHÁNH'), '');
  assert.equal(coPhoneOf(people, 'Người lạ'), '');
  assert.equal(coPhoneOf(null, 'A'), '');
});

const CUST = { name: 'NGUYỄN THỊ ÁI NHI', phone: '0912345678', coPeople: [{ name: 'TRẦN THỊ BÍCH', phone: '0988777666' }, { name: 'LÊ VĂN KHÁNH', phone: '' }] };
const ct = (o = {}) => ({ id: 'x', heirName: 'trần thị bích', oaEnabled: true, oaToMain: true, oaToCo: false, oaCoKey: null, ...o });

test('contractOa: mặc định chỉ gửi người vay', () => {
  const s = contractOa(ct(), CUST);
  assert.deepEqual([s.enabled, s.toMain, s.toCo], [true, true, false]);
  assert.deepEqual(s.recipients, [{ who: 'main', phone: '0912345678' }]);
  assert.equal(s.coName, 'trần thị bích');
});

test('contractOa: tick người cùng vay (đúng tên, có số) → gửi cả 2; chỉ người cùng vay khi bỏ tick người vay', () => {
  const both = contractOa(ct({ oaToCo: true, oaCoKey: 'trần thị bích' }), CUST);
  assert.deepEqual(both.recipients.map((r) => r.who), ['main', 'co']);
  const onlyCo = contractOa(ct({ oaToCo: true, oaCoKey: 'TRẦN THỊ BÍCH', oaToMain: false }), CUST);
  assert.deepEqual(onlyCo.recipients, [{ who: 'co', phone: '0988777666' }]);
  assert.equal(onlyCo.toMain, false);
});

test('contractOa: tick người cùng vay nhưng hợp đồng nay ghi người khác → tick mất hiệu lực, KHÔNG gửi cho người cũ', () => {
  const s = contractOa(ct({ heirName: 'LÊ VĂN KHÁNH', oaToCo: true, oaCoKey: 'trần thị bích', oaToMain: false }), CUST);
  assert.equal(s.toCo, false);
  assert.deepEqual(s.recipients.map((r) => r.who), ['main']); // luôn còn ít nhất 1 người nhận
});

test('contractOa: người cùng vay chưa có số → bị khóa, không nhận tin dù có tick', () => {
  const s = contractOa(ct({ heirName: 'Lê Văn Khánh', oaToCo: true, oaCoKey: 'lê văn khánh' }), CUST);
  assert.deepEqual([s.coLocked, s.toCo, s.coPhone], [true, false, '']);
  assert.deepEqual(s.recipients.map((r) => r.who), ['main']);
});

test('contractOa: hợp đồng tắt → không gửi cho ai', () => {
  const s = contractOa(ct({ oaEnabled: false, oaToCo: true, oaCoKey: 'trần thị bích' }), CUST);
  assert.deepEqual([s.enabled, s.toMain, s.toCo, s.recipients.length], [false, false, false, 0]);
});

test('contractOa: hợp đồng không ghi người cùng vay thì không có người cùng vay nào để gửi', () => {
  const s = contractOa(ct({ heirName: null, oaToCo: true, oaCoKey: 'trần thị bích' }), CUST);
  assert.deepEqual([s.coName, s.toCo], ['', false]);
});

test('contractOa: người vay chưa có số bị khóa; số người cùng vay trùng số người vay thì không gửi 2 lần', () => {
  const noPhone = contractOa(ct(), { ...CUST, phone: '' });
  assert.deepEqual([noPhone.mainLocked, noPhone.toMain, noPhone.recipients.length], [true, false, 0]);
  const dup = contractOa(ct({ oaToCo: true, oaCoKey: 'trần thị bích' }), { ...CUST, phone: '0988777666' });
  assert.deepEqual(dup.recipients.map((r) => r.who), ['main']);
});

test('customerOaSummary: mặc định không cần dòng "Gửi tới"; có người cùng vay nhận hoặc hợp đồng tắt thì có', () => {
  const plain = customerOaSummary([ct(), ct({ id: 'y', heirName: 'LÊ VĂN KHÁNH' })], CUST);
  assert.deepEqual([plain.mode, plain.custom, plain.offCount], ['main', false, 0]);
  const withCo = customerOaSummary([ct({ oaToCo: true, oaCoKey: 'trần thị bích' }), ct({ id: 'y', heirName: 'LÊ VĂN KHÁNH' })], CUST);
  assert.deepEqual([withCo.mode, withCo.custom, withCo.anyCo], ['both', true, true]);
  const off = customerOaSummary([ct(), ct({ id: 'y', oaEnabled: false })], CUST);
  assert.deepEqual([off.mode, off.custom, off.offCount], ['main', true, 1]);
  const allOff = customerOaSummary([ct({ oaEnabled: false })], CUST);
  assert.deepEqual([allOff.mode, allOff.custom], ['none', true]);
  const coOnly = customerOaSummary([ct({ oaToCo: true, oaCoKey: 'trần thị bích', oaToMain: false })], CUST);
  assert.equal(coOnly.mode, 'co');
  const noPhone = customerOaSummary([ct()], { ...CUST, phone: '' }); // người vay chưa có số, không có ai khác → báo chưa có số để gửi
  assert.deepEqual([noPhone.mode, noPhone.noRecipient, noPhone.custom], ['none', true, true]);
});

test('shortPersonName: tên gọi ngắn là từ cuối, viết hoa chữ đầu', () => {
  assert.equal(shortPersonName('TRẦN THỊ BÍCH'), 'Bích');
  assert.equal(shortPersonName('lê văn khánh'), 'Khánh');
  assert.equal(shortPersonName(''), '');
});

test('checkCoPhone: đúng 10 số và có số 0 đứng đầu', () => {
  assert.deepEqual(checkCoPhone('0988777666'), { ok: true, empty: false, phone: '0988777666' });
  assert.deepEqual(checkCoPhone('0988 777 666'), { ok: true, empty: false, phone: '0988777666' });
  assert.deepEqual(checkCoPhone('0988.777.666'), { ok: true, empty: false, phone: '0988777666' });
  assert.equal(checkCoPhone('098877766').ok, false); // thiếu 1 số
  assert.equal(checkCoPhone('09887776666').ok, false); // thừa 1 số
  assert.equal(checkCoPhone('988777666').ok, false); // 9 số, thiếu số 0
  assert.equal(checkCoPhone('9887776660').reason, 'Số điện thoại phải bắt đầu bằng số 0.'); // đủ 10 số nhưng không có 0 đầu
  assert.equal(checkCoPhone('+84988777666').ok, false); // không nhận dạng +84
  assert.equal(checkCoPhone('0988abc666').ok, false);
});

test('checkCoPhone: để trống là hợp lệ (xóa số)', () => {
  for (const v of ['', '   ', null, undefined]) assert.deepEqual(checkCoPhone(v), { ok: true, empty: true, phone: '' });
});

test('sanitizeCoPhoneInput: chỉ giữ chữ số, tối đa 10 số, đổi +84 thành 0', () => {
  assert.equal(sanitizeCoPhoneInput('0988 777 666'), '0988777666');
  assert.equal(sanitizeCoPhoneInput('09ab88-777.666 123'), '0988777666');
  assert.equal(sanitizeCoPhoneInput('+84 988 777 666'), '0988777666');
  assert.equal(sanitizeCoPhoneInput('84988777666'), '0988777666');
  assert.equal(sanitizeCoPhoneInput('098'), '098');
  assert.equal(sanitizeCoPhoneInput(''), '');
});
