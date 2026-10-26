import { addDays, daysBetween, startOfDay } from '../utils.js';

export const MAX_INTEREST_DAYS = 3650;

export function interestBonusDays(contract) {
  const paidUntil = contract.interestPaidUntil || contract.disbursedDate;
  return contract.disbursedDate && daysBetween(new Date(contract.disbursedDate), new Date(paidUntil)) === 1 ? 1 : 0;
}

export function interestDaysBetween(contract, asOf = new Date()) {
  const paidUntil = contract.interestPaidUntil || contract.disbursedDate;

  return Math.max(0, daysBetween(new Date(paidUntil), asOf) + interestBonusDays(contract));
}

export function interestAsOfForDays(contract, days) {
  const paidUntil = contract.interestPaidUntil || contract.disbursedDate;
  const n = Math.max(0, Math.round(Number(days) || 0));
  return addDays(startOfDay(new Date(paidUntil)), n - interestBonusDays(contract));
}
