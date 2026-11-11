const RULES = [
  [/account\s+not\s+exist/i, 'Số điện thoại này chưa đăng ký Zalo'],
  [/OA\s+does\s+not\s+have\s+permission\s+to\s+use\s+this\s+feature/i, 'OA không có quyền sử dụng tính năng này'],
];

export function translateZaloError(msg) {
  if (!msg) return msg;
  const text = String(msg);
  const hit = RULES.find(([pattern]) => pattern.test(text));
  return hit ? hit[1] : msg;
}
