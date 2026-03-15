import { describe, expect, test } from 'bun:test';

// =============================================================================
// Color support detection
// =============================================================================
describe('colors', () => {
  test('exports bold, dim, red, reset, yellow', async () => {
    const colors = await import('./colors');
    expect(typeof colors.bold).toBe('string');
    expect(typeof colors.dim).toBe('string');
    expect(typeof colors.red).toBe('string');
    expect(typeof colors.reset).toBe('string');
    expect(typeof colors.yellow).toBe('string');
  });

  test('all exports are strings (possibly empty for non-TTY)', async () => {
    const { bold, dim, red, reset, yellow } = await import('./colors');
    const values = [bold, dim, red, reset, yellow];
    const allStrings = values.every((v) => typeof v === 'string');
    expect(allStrings).toBe(true);
  });
});
