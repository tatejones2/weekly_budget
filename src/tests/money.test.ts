import { centsToInput, formatCents, formatCentsCompact, formatSignedCents, parseDollars } from '../lib/money';

describe('parseDollars', () => {
  it.each([
    ['15.67', 1567],
    ['$15.67', 1567],
    ['1,234.5', 123450],
    ['.99', 99],
    ['19.99', 1999], // classic float trap: 19.99 * 100 = 1998.9999…
    ['0.29', 29],
    ['150', 15000],
    ['  42  ', 4200],
  ])('parses %s', (input, cents) => {
    expect(parseDollars(input)).toEqual({ ok: true, cents });
  });

  it.each(['', '  ', 'abc', '1.234', '1.2.3', '$', '.', '0', '0.00', '-5', '12e3', '1,23.00', 'NaN', 'Infinity', '99999999999'])(
    'rejects %j',
    (input) => {
      expect(parseDollars(input).ok).toBe(false);
    },
  );

  it('allows negatives and zero when asked (opening carryover)', () => {
    expect(parseDollars('-20', { allowNegative: true, allowZero: true })).toEqual({ ok: true, cents: -2000 });
    expect(parseDollars('−20.50', { allowNegative: true })).toEqual({ ok: true, cents: -2050 });
    expect(parseDollars('0', { allowZero: true })).toEqual({ ok: true, cents: 0 });
  });
});

describe('formatting', () => {
  it('formats with a typographic minus', () => {
    expect(formatCents(1567)).toBe('$15.67');
    expect(formatCents(-1067)).toBe('−$10.67');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(123456789)).toBe('$1,234,567.89');
  });
  it('signs carryover explicitly', () => {
    expect(formatSignedCents(3000)).toBe('+$30.00');
    expect(formatSignedCents(-2000)).toBe('−$20.00');
    expect(formatSignedCents(0)).toBe('$0.00');
  });
  it('compacts', () => {
    expect(formatCentsCompact(1500)).toBe('$15');
    expect(formatCentsCompact(1567)).toBe('$15.67');
    expect(formatCentsCompact(125000)).toBe('$1.3k');
  });
  it('round-trips through input text', () => {
    expect(centsToInput(1567)).toBe('15.67');
    expect(centsToInput(5)).toBe('0.05');
    expect(centsToInput(-2000)).toBe('-20.00');
  });
});
