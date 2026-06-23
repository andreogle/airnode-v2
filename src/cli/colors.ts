// =============================================================================
// ANSI color helpers — degrade gracefully on terminals without color support
// =============================================================================
const isSupportsColor =
  process.env['NO_COLOR'] === undefined && (process.env['FORCE_COLOR'] !== undefined || process.stdout.isTTY);

// #f3004b via 24-bit true color
const red = isSupportsColor ? '\u{1B}[38;2;243;0;75m' : '';
const green = isSupportsColor ? '\u{1B}[32m' : '';
const yellow = isSupportsColor ? '\u{1B}[33m' : '';
const dim = isSupportsColor ? '\u{1B}[2m' : '';
const bold = isSupportsColor ? '\u{1B}[1m' : '';
const reset = isSupportsColor ? '\u{1B}[0m' : '';

export { bold, dim, green, red, reset, yellow };
