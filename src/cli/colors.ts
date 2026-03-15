// =============================================================================
// ANSI color helpers — degrade gracefully on terminals without color support
// =============================================================================
const supportsColor =
  process.env['NO_COLOR'] === undefined && (process.env['FORCE_COLOR'] !== undefined || process.stdout.isTTY);

// #f3004b via 24-bit true color
const red = supportsColor ? '\u001B[38;2;243;0;75m' : '';
const green = supportsColor ? '\u001B[32m' : '';
const yellow = supportsColor ? '\u001B[33m' : '';
const dim = supportsColor ? '\u001B[2m' : '';
const bold = supportsColor ? '\u001B[1m' : '';
const reset = supportsColor ? '\u001B[0m' : '';

export { bold, dim, green, red, reset, yellow };
