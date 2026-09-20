/** All money is integer cents. These helpers are the only place dollars appear. */

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const MAX_CENTS = 100_000_000_00; // $100,000,000.00 — guards absurd input

const MINUS = '−'; // typographic minus, easier to see than a hyphen

/** `$1,234.50`, or `−$1,234.50` for negatives. */
export function formatCents(cents: number): string {
  const abs = usd.format(Math.abs(cents) / 100);
  return cents < 0 ? `${MINUS}${abs}` : abs;
}

/** Always shows a sign: `+$5.00`, `−$5.00`, `$0.00`. */
export function formatSignedCents(cents: number): string {
  if (cents === 0) return usd.format(0);
  return `${cents > 0 ? '+' : MINUS}${usd.format(Math.abs(cents) / 100)}`;
}

/** Shortened for tight spaces (day strip): `$15`, `$15.67`, `$1.2k`. */
export function formatCentsCompact(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? MINUS : '';
  if (abs >= 100_000) return `${sign}$${(abs / 100_000).toFixed(1).replace(/\.0$/, '')}k`;
  if (abs % 100 === 0) return `${sign}$${abs / 100}`;
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

export type ParseResult = { ok: true; cents: number } | { ok: false; error: string };

/**
 * Parse user-typed dollars ("15.67", "$1,234.5", ".99") into integer cents.
 * Uses string math — never floating point — so 19.99 is exactly 1999.
 */
export function parseDollars(input: string, opts: { allowNegative?: boolean; allowZero?: boolean } = {}): ParseResult {
  const raw = input.trim().replace(/\s+/g, '');
  if (raw === '') return { ok: false, error: 'Enter an amount.' };

  let s = raw.replace(/^\$/, '');
  let negative = false;
  if (s.startsWith('-') || s.startsWith(MINUS)) {
    negative = true;
    s = s.slice(1).replace(/^\$/, '');
  } else if (s.startsWith('+')) {
    s = s.slice(1).replace(/^\$/, '');
  }
  if (negative && !opts.allowNegative) return { ok: false, error: 'Amount must be greater than $0.00.' };

  // digits with optional thousands separators, optional decimal part
  if (!/^(\d{1,3}(,\d{3})+|\d+)?(\.\d*)?$/.test(s) || s === '' || s === '.') {
    return { ok: false, error: 'Use numbers only, like 15.67.' };
  }
  const [wholeRaw = '', frac = ''] = s.split('.');
  if (frac.length > 2) return { ok: false, error: 'Use at most two decimal places.' };
  const whole = wholeRaw.replace(/,/g, '') || '0';
  if (whole.length > 10) return { ok: false, error: 'That amount is too large.' };
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return { ok: false, error: 'That amount is too large.' };
  if (cents === 0 && !opts.allowZero) return { ok: false, error: 'Amount must be greater than $0.00.' };
  return { ok: true, cents: negative ? -cents : cents };
}

/** `1567` -> `"15.67"` for prefilling inputs (no currency symbol or grouping). */
export function centsToInput(cents: number): string {
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${s}` : s;
}

export function isValidCents(n: unknown, opts: { min?: number } = {}): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && Math.abs(n) <= MAX_CENTS && n >= (opts.min ?? -MAX_CENTS);
}
