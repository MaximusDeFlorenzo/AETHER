import { PopulationNumberFormat } from '../../common/enums/domain.enum';
import {
  densityFormatExample,
  parseDensity,
  parseNonNegativeInt,
} from './number-parsing';

describe('parseNonNegativeInt', () => {
  it('parses a plain integer string', () => {
    expect(parseNonNegativeInt('220')).toEqual({ value: 220, error: null });
  });

  it('distinguishes an empty cell from zero', () => {
    expect(parseNonNegativeInt('')).toEqual({ value: null, error: null });
    expect(parseNonNegativeInt('   ')).toEqual({ value: null, error: null });
    expect(parseNonNegativeInt(undefined)).toEqual({
      value: null,
      error: null,
    });
  });

  it('parses an explicit zero as zero, not empty', () => {
    expect(parseNonNegativeInt('0')).toEqual({ value: 0, error: null });
  });

  it('trims surrounding whitespace', () => {
    expect(parseNonNegativeInt(' 220 ')).toEqual({ value: 220, error: null });
  });

  it('rejects a negative number', () => {
    const result = parseNonNegativeInt('-5');
    expect(result.value).toBeNull();
    expect(result.error).toMatch(/bukan bilangan bulat/);
  });

  it('rejects a decimal', () => {
    const result = parseNonNegativeInt('5.5');
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('rejects non-numeric text', () => {
    const result = parseNonNegativeInt('abc');
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });

  // Found live against a real ~67k-row Prodeskel export: any village with
  // 1,000+ residents/households writes this column with a "." thousands
  // separator too (not just Kepadatan) — the single-row example this
  // parser was originally built from happened to have every value under
  // 1,000, which hid this and caused ~98% of a real national file's rows
  // to be wrongly rejected as "invalid".
  it('accepts a "." thousands separator — "1.234" -> 1234', () => {
    expect(parseNonNegativeInt('1.234')).toEqual({
      value: 1234,
      error: null,
    });
  });

  it('accepts multiple thousands groups — "12.345.678" -> 12345678', () => {
    expect(parseNonNegativeInt('12.345.678').value).toBe(12345678);
  });

  it('still rejects a malformed grouping (not exactly 3 digits after a dot)', () => {
    const result = parseNonNegativeInt('12.34.567');
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe('parseDensity — DOT_THOUSANDS_SEPARATOR', () => {
  const format = PopulationNumberFormat.DOT_THOUSANDS_SEPARATOR;

  it('"26.000" -> 26000', () => {
    expect(parseDensity('26.000', format)).toEqual({
      raw: '26.000',
      converted: 26000,
      error: null,
    });
  });

  it('"1.234.567" -> 1234567 (multiple thousands groups)', () => {
    expect(parseDensity('1.234.567', format).converted).toBe(1234567);
  });

  it('"26" (no dot) -> 26, unaffected', () => {
    expect(parseDensity('26', format).converted).toBe(26);
  });

  it('rejects a malformed thousands grouping (e.g. two digits after the dot)', () => {
    const result = parseDensity('26.00', format);
    expect(result.converted).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.raw).toBe('26.00'); // raw preserved even on error
  });

  it('empty cell -> null, not zero', () => {
    expect(parseDensity('', format)).toEqual({
      raw: null,
      converted: null,
      error: null,
    });
  });

  // Found live against a real ~67k-row Prodeskel export: a handful of
  // rows have a Kepadatan value whose thousands-separator reading is
  // billions of jiwa/km² — a source data-quality defect, not a parsing
  // bug — which previously overflowed `density_converted NUMERIC(12,3)`
  // and crashed the entire validation job instead of just this one row.
  it('flags a value whose thousands-separator reading overflows the storage column, instead of crashing the insert', () => {
    const result = parseDensity('29.325.000.000', format);
    expect(result.converted).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.raw).toBe('29.325.000.000'); // preserved even when out of range
  });

  it('accepts a value right at the storage boundary', () => {
    expect(parseDensity('999.999.999', format).converted).toBe(999999999);
  });

  it('rejects a value one unit over the storage boundary', () => {
    const result = parseDensity('1.000.000.000', format);
    expect(result.converted).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe('parseDensity — DOT_DECIMAL_POINT', () => {
  const format = PopulationNumberFormat.DOT_DECIMAL_POINT;

  it('"26.000" -> 26 (three decimal places, still twenty-six)', () => {
    expect(parseDensity('26.000', format)).toEqual({
      raw: '26.000',
      converted: 26,
      error: null,
    });
  });

  it('"26.5" -> 26.5', () => {
    expect(parseDensity('26.5', format).converted).toBe(26.5);
  });

  it('rejects a value with more than one decimal point', () => {
    const result = parseDensity('1.234.567', format);
    expect(result.converted).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe('parseDensity — raw value is always preserved exactly, regardless of format or validity', () => {
  it.each([
    ['26.000', PopulationNumberFormat.DOT_THOUSANDS_SEPARATOR],
    ['26.000', PopulationNumberFormat.DOT_DECIMAL_POINT],
    ['not-a-number', PopulationNumberFormat.DOT_THOUSANDS_SEPARATOR],
  ])('raw("%s", %s) is untouched', (input, format) => {
    expect(parseDensity(input, format).raw).toBe(input);
  });
});

describe('densityFormatExample', () => {
  it('shows a different converted example per format, both grounded in the same source string', () => {
    const thousands = densityFormatExample(
      PopulationNumberFormat.DOT_THOUSANDS_SEPARATOR,
    );
    const decimal = densityFormatExample(
      PopulationNumberFormat.DOT_DECIMAL_POINT,
    );
    expect(thousands).toContain('26.000');
    expect(thousands).toContain('26000');
    expect(decimal).toContain('26.000');
    expect(decimal).not.toBe(thousands);
  });
});
