// ============================================================
// Campus Marketplace — Currency Utilities
// Safe conversions between decimal Rupees and integer Paise
// ============================================================

/**
 * Safely converts Rupee string or number (e.g. "800.00", 12.5) to exact integer paise.
 * Uses string splitting to completely avoid IEEE-754 floating-point inaccuracies.
 */
export function rupeesToPaise(rupees: string | number): bigint {
  const str = String(rupees).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    throw new Error(`Invalid currency amount format: "${str}"`);
  }
  const [whole, decimal = ''] = str.split('.');
  const paddedDecimal = (decimal + '00').slice(0, 2);
  return BigInt(whole) * 100n + BigInt(paddedDecimal);
}

/**
 * Formats integer paise to a 2-decimal Rupees display string (e.g. 80000n -> "800.00").
 */
export function paiseToRupees(paise: bigint | number): string {
  const p = BigInt(paise);
  const whole = p / 100n;
  const rem = (p % 100n).toString().padStart(2, '0');
  return `${whole}.${rem}`;
}
