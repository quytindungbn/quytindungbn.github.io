import { samePhone } from './coBorrower.js';

export const SEND_GROUP_WINDOW_MS = 120000;

const timeOf = (l) => new Date(l.sentAt).getTime() || 0;

export function groupSendLogs(logs, windowMs = SEND_GROUP_WINDOW_MS) {
  const sorted = [...(logs || [])].sort((a, b) => timeOf(b) - timeOf(a));
  const open = new Map();
  const out = [];
  for (const l of sorted) {
    const key = [l.customerId || '', l.contractId || '', l.kind || '', l.triggeredBy || '', l.triggeredByAdminId || ''].join('|');
    const g = open.get(key);
    if (g && g.time - timeOf(l) <= windowMs && !g.logs.some((x) => samePhone(x.phone, l.phone) || (!x.phone && !l.phone))) g.logs.push(l);
    else {
      const ng = { key, time: timeOf(l), logs: [l] };
      open.set(key, ng);
      out.push(ng);
    }
  }
  return out;
}
