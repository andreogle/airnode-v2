// Replaced at build time via --define. Falls back to package.json for dev (bun run dev).
// globalThis lookup is safe — returns undefined for undeclared globals without throwing.
const VERSION: string =
  (globalThis as Record<string, unknown>)['__AIRNODE_VERSION__'] === undefined
    ? (import.meta.require('../package.json') as { version: string }).version
    : String((globalThis as Record<string, unknown>)['__AIRNODE_VERSION__']);

export { VERSION };
