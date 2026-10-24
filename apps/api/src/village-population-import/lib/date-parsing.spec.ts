import { parseStrictDate } from './date-parsing';

describe('parseStrictDate', () => {
  it('parses a valid DD/MM/YYYY date to ISO', () => {
    expect(parseStrictDate('17/06/2014')).toEqual({
      value: '2014-06-17',
      error: null,
    });
  });

  it('treats an empty cell as "not reported", not an error', () => {
    expect(parseStrictDate('')).toEqual({ value: null, error: null });
    expect(parseStrictDate(undefined)).toEqual({ value: null, error: null });
  });

  it('rejects a calendar-invalid date (31 February) rather than letting it roll over to March', () => {
    const result = parseStrictDate('31/02/2020');
    expect(result.value).toBeNull();
    expect(result.error).toMatch(/tidak valid di kalender/);
  });

  it('rejects a nonexistent leap day on a non-leap year', () => {
    const result = parseStrictDate('29/02/2021');
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('accepts a valid leap day', () => {
    expect(parseStrictDate('29/02/2020').value).toBe('2020-02-29');
  });

  it('rejects month 13', () => {
    expect(parseStrictDate('01/13/2020').value).toBeNull();
  });

  it('rejects a wrong format (YYYY-MM-DD)', () => {
    const result = parseStrictDate('2014-06-17');
    expect(result.value).toBeNull();
    expect(result.error).toMatch(/DD\/MM\/YYYY/);
  });

  it('rejects a single-digit day/month (requires zero-padding)', () => {
    expect(parseStrictDate('7/6/2014').value).toBeNull();
  });

  it('rejects garbage text', () => {
    expect(parseStrictDate('not a date').value).toBeNull();
  });
});
