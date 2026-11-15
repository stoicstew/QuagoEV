export class ValidationError extends Error { constructor(message) { super(message); this.status = 400; } }
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export function numberOrNull(value, min = -Infinity, max = Infinity) {
  return finite(value) && value >= min && value <= max ? value : null;
}
export function timestamp(value) {
  if (!finite(value) || value <= 0) throw new ValidationError('Invalid timestamp');
  const result = value < 100_000_000_000 ? value * 1000 : value;
  if (result > 8_640_000_000_000_000) throw new ValidationError('Invalid timestamp');
  return Math.round(result);
}
export function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('Expected an object');
  return value;
}
export function text(value, max = 500) {
  if (typeof value !== 'string' || value.length > max) throw new ValidationError('Invalid text value');
  return value;
}
export function settingsPatch(input) {
  object(input);
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'homeRatePerKwh' || key === 'batteryCapacityKwh') {
      const min = key === 'batteryCapacityKwh' ? 1 : 0;
      const max = key === 'batteryCapacityKwh' ? 500 : 100;
      if (value !== null && numberOrNull(value, min, max) === null) throw new ValidationError(`Invalid ${key}`);
      result[key] = value;
    } else if (key === 'currency') {
      if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw new ValidationError('Use a three-letter currency');
      try { new Intl.NumberFormat('en-AU', { style: 'currency', currency: value }); } catch { throw new ValidationError('Invalid currency'); }
      result[key] = value;
    } else if (key === 'timeZone') {
      try { new Intl.DateTimeFormat('en-AU', { timeZone: text(value, 100) }); } catch { throw new ValidationError('Invalid time zone'); }
      result[key] = value;
    } else throw new ValidationError(`Unknown settings field: ${key}`);
  }
  return result;
}
export function tripPatch(input) {
  object(input); const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'tag' && ['personal', 'business', 'unclassified'].includes(value)) result.tag = value;
    else if (key === 'notes') result.notes = text(value, 4000);
    else throw new ValidationError('Invalid trip edit');
  }
  return result;
}
export function chargePatch(input) {
  object(input); const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'locationName') result[key] = value === null ? null : text(value, 200);
    else if (key === 'locationType' && ['home', 'work', 'public', 'unknown'].includes(value)) result[key] = value;
    else if (['cost', 'ratePerKwh'].includes(key) && (value === null || numberOrNull(value, 0, 100000) !== null)) result[key] = value;
    else throw new ValidationError('Invalid charging edit');
  }
  return result;
}
