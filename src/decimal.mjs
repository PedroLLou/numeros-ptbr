// Decimal values are carried as canonical strings ("1234.56", "0.5", "20"), never as floats,
// so "1.234,56" and "R$ 1234,560" compare exactly and large values never lose digits.

/** Canonical form: no leading zeros (except a single "0"), no trailing fraction zeros, no empty fraction. */
export function canonDecimal(intPart, fracPart = '') {
  let a = 0;
  while (a < intPart.length - 1 && intPart[a] === '0') a++;
  const i = intPart.slice(a) || '0';
  let b = fracPart.length;
  while (b > 0 && fracPart[b - 1] === '0') b--;
  const f = fracPart.slice(0, b);
  return f ? `${i}.${f}` : i;
}

/** Canonicalize a string already in "digits[.digits]" form. */
export function canonFromString(s) {
  const dot = s.indexOf('.');
  return dot < 0 ? canonDecimal(s) : canonDecimal(s.slice(0, dot), s.slice(dot + 1));
}

/** Multiply by 10^places (places may be negative) on the decimal string. */
export function shiftDecimal(value, places) {
  const dot = value.indexOf('.');
  const i = dot < 0 ? value : value.slice(0, dot);
  const f = dot < 0 ? '' : value.slice(dot + 1);
  if (places >= 0) {
    const g = f.padEnd(places, '0');
    return canonDecimal(i + g.slice(0, places), g.slice(places));
  }
  const k = -places;
  const p = i.padStart(k + 1, '0');
  return canonDecimal(p.slice(0, p.length - k), p.slice(p.length - k) + f);
}

/** Day count of a month; February has 29 days when the year is unknown or leap. */
export function daysInMonth(month, year) {
  if (month === 2) {
    if (year === null) return 29;
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** "2026-03-05" or, without a year, "--03-05" (ISO 8601 truncated form). Null if the calendar date is invalid. */
export function dateValue(year, month, day) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(month, year)) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return year === null ? `--${mm}-${dd}` : `${String(year).padStart(4, '0')}-${mm}-${dd}`;
}
