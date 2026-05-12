import { describe, expect, test } from 'bun:test';

// =============================================================================
// Color support detection
//
// colors.ts decides at module-load time whether to emit ANSI codes, from
// NO_COLOR / FORCE_COLOR / stdout.isTTY. We can't re-evaluate that in this
// process (the module is a singleton, and another test may already have
// imported it), so the branching is exercised by importing it fresh in a
// subprocess with a controlled environment.
// =============================================================================
const ESC = 27; //  — the first byte of every ANSI escape sequence
const COLORS_PATH = `${import.meta.dirname}/colors.ts`;

async function colorsWithEnv(extraEnv: Record<string, string>): Promise<{ red: string; reset: string }> {
  const { NO_COLOR: _no, FORCE_COLOR: _force, ...baseEnv } = process.env;
  const proc = Bun.spawn(
    [
      'bun',
      '-e',
      `import(${JSON.stringify(COLORS_PATH)}).then((c) => process.stdout.write(JSON.stringify({ red: c.red, reset: c.reset })))`,
    ],
    { env: { ...baseEnv, ...extraEnv }, stdout: 'pipe', stderr: 'pipe' }
  );
  await proc.exited;
  return JSON.parse(await new Response(proc.stdout).text()) as { red: string; reset: string };
}

describe('colors', () => {
  test('emits ANSI escape sequences when FORCE_COLOR is set', async () => {
    const { red, reset } = await colorsWithEnv({ FORCE_COLOR: '1' });
    expect(red.codePointAt(0)).toBe(ESC);
    expect(red).toContain('38;2;243;0;75m'); // #f3004b as 24-bit true colour
    expect(reset.codePointAt(0)).toBe(ESC);
    expect(reset).toContain('0m');
  });

  test('emits empty strings when NO_COLOR is set (even alongside FORCE_COLOR)', async () => {
    const { red, reset } = await colorsWithEnv({ NO_COLOR: '1', FORCE_COLOR: '1' });
    expect(red).toBe('');
    expect(reset).toBe('');
  });

  test('emits empty strings on a non-TTY with neither flag set', async () => {
    // The subprocess's stdout is a pipe, not a TTY → no colour.
    const { red, reset } = await colorsWithEnv({});
    expect(red).toBe('');
    expect(reset).toBe('');
  });
});
