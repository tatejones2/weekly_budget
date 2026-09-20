import type { Expense } from '../../db/types';
import { spendDelta } from '../budget/calc';
import { normalizeName } from '../../lib/validation';

export type MerchantStat = {
  key: string;
  name: string; // display spelling (most recent)
  visits: number; // purchases (refunds don't count as visits)
  totalCents: number; // net of refunds
  lastDate: string;
  lastCategoryId: string;
  lastAmountCents: number;
};

export function buildMerchants(expenses: Expense[]): MerchantStat[] {
  const map = new Map<string, MerchantStat & { lastStamp: string }>();
  for (const e of expenses) {
    const key = normalizeName(e.merchantName);
    if (!key) continue;
    const stamp = `${e.date}|${e.createdAt}`;
    const isRefund = e.type === 'refund';
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        key,
        name: e.merchantName,
        visits: isRefund ? 0 : 1,
        totalCents: spendDelta(e),
        lastDate: e.date,
        lastCategoryId: e.categoryId,
        lastAmountCents: e.amountCents,
        lastStamp: stamp,
      });
      continue;
    }
    cur.visits += isRefund ? 0 : 1;
    cur.totalCents += spendDelta(e);
    if (!isRefund && stamp >= cur.lastStamp) {
      cur.lastStamp = stamp;
      cur.name = e.merchantName;
      cur.lastDate = e.date;
      cur.lastCategoryId = e.categoryId;
      cur.lastAmountCents = e.amountCents;
    }
  }
  return [...map.values()].map(({ lastStamp: _s, ...m }) => m);
}

/** Prefix matches first, then word-start, then substring; ties by visit count. */
export function suggestMerchants(stats: MerchantStat[], query: string, limit = 6): MerchantStat[] {
  const q = normalizeName(query);
  if (!q) return [];
  const scored: { m: MerchantStat; score: number }[] = [];
  for (const m of stats) {
    let score = -1;
    if (m.key === q) score = 0;
    else if (m.key.startsWith(q)) score = 1;
    else if (m.key.split(' ').some((w) => w.startsWith(q))) score = 2;
    else if (m.key.includes(q)) score = 3;
    if (score >= 0) scored.push({ m, score });
  }
  return scored.sort((a, b) => a.score - b.score || b.m.visits - a.m.visits || a.m.name.localeCompare(b.m.name)).slice(0, limit).map((s) => s.m);
}
