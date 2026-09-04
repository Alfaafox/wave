const DEFAULT_COUNTRY_CODE = '91';

export function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d+]/g, '');

  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = DEFAULT_COUNTRY_CODE + digits.slice(1);
  } else if (digits.length <= 10) {
    digits = DEFAULT_COUNTRY_CODE + digits;
  }

  return digits || null;
}
