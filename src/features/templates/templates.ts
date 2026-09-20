import type { PurchaseTemplate } from '../../db/types';
import { centsToInput } from '../../lib/money';
import { normalizeName } from '../../lib/validation';

export type TemplateDefaults = {
  merchantName: string;
  /** Empty string for variable shortcuts — the amount must never be copied from history. */
  amountText: string;
  categoryId: string;
  templateId: string;
};

/** What the Add form should be prefilled with when a shortcut is chosen. */
export function templateDefaults(t: PurchaseTemplate): TemplateDefaults {
  return {
    merchantName: t.merchantName,
    amountText: t.kind === 'fixed' && t.amountCents !== null ? centsToInput(t.amountCents) : '',
    categoryId: t.categoryId,
    templateId: t.id,
  };
}

export function sortTemplates(list: PurchaseTemplate[]): PurchaseTemplate[] {
  return [...list].sort(
    (a, b) =>
      b.usageCount - a.usageCount ||
      (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') ||
      a.label.localeCompare(b.label),
  );
}

export function templatesForMerchant(list: PurchaseTemplate[], merchantName: string): PurchaseTemplate[] {
  const key = normalizeName(merchantName);
  if (!key) return [];
  return sortTemplates(list.filter((t) => normalizeName(t.merchantName) === key));
}
