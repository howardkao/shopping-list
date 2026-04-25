import { describe, it, expect } from 'vitest';
import { formatAisleNameForDisplay } from '../src/aisleDisplay.js';

describe('formatAisleNameForDisplay', () => {
  it('returns empty string for null', () => {
    expect(formatAisleNameForDisplay(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatAisleNameForDisplay(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatAisleNameForDisplay('')).toBe('');
  });

  it('uppercases a title-case name', () => {
    expect(formatAisleNameForDisplay('Produce')).toBe('PRODUCE');
  });

  it('uppercases a multi-word name', () => {
    expect(formatAisleNameForDisplay('Meat & Fish')).toBe('MEAT & FISH');
  });

  it('is idempotent on already-uppercase input', () => {
    expect(formatAisleNameForDisplay('DAIRY')).toBe('DAIRY');
  });

  it('coerces non-string values via String()', () => {
    expect(formatAisleNameForDisplay(42)).toBe('42');
  });
});
