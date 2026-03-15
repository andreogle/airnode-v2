/**
 * Load a .env file into process.env. Skips blank lines and comments.
 * Does not override variables that are already set.
 */
export async function loadEnvFile(path: string): Promise<void> {
  const text = await Bun.file(path).text();
  const lines = text.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));

  // eslint-disable-next-line functional/no-loop-statements
  for (const line of lines) {
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value; // eslint-disable-line functional/immutable-data
    }
  }
}
