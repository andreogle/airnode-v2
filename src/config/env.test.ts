import { afterEach, describe, expect, test } from 'bun:test';
import { loadEnvFile } from './env';

const FIXTURE_DIR = `${import.meta.dirname}/__fixtures__`;

describe('loadEnvFile', () => {
  const testKeys = ['LOAD_ENV_A', 'LOAD_ENV_B', 'LOAD_ENV_EXISTING', 'LOAD_ENV_HEX'];

  afterEach(() => {
    for (const key of testKeys) {
      delete process.env[key]; // eslint-disable-line @typescript-eslint/no-dynamic-delete
    }
  });

  test('loads key-value pairs into process.env', async () => {
    const path = `${FIXTURE_DIR}/test.env`;
    await Bun.write(path, 'LOAD_ENV_A=alpha\nLOAD_ENV_B=beta\n');

    await loadEnvFile(path);

    expect(process.env['LOAD_ENV_A']).toBe('alpha');
    expect(process.env['LOAD_ENV_B']).toBe('beta');
  });

  test('skips comments and blank lines', async () => {
    const path = `${FIXTURE_DIR}/comments.env`;
    await Bun.write(path, '# this is a comment\n\nLOAD_ENV_A=value\n\n# another comment\n');

    await loadEnvFile(path);

    expect(process.env['LOAD_ENV_A']).toBe('value');
  });

  test('does not override existing variables', async () => {
    process.env['LOAD_ENV_EXISTING'] = 'original';

    const path = `${FIXTURE_DIR}/override.env`;
    await Bun.write(path, 'LOAD_ENV_EXISTING=overridden\n');

    await loadEnvFile(path);

    expect(process.env['LOAD_ENV_EXISTING']).toBe('original');
  });

  test('handles values containing equals signs', async () => {
    const path = `${FIXTURE_DIR}/equals.env`;
    await Bun.write(path, 'LOAD_ENV_A=base64==value\n');

    await loadEnvFile(path);

    expect(process.env['LOAD_ENV_A']).toBe('base64==value');
  });

  test('loads hex private key without quotes', async () => {
    const path = `${FIXTURE_DIR}/hex.env`;
    const hexKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
    await Bun.write(path, `LOAD_ENV_HEX=${hexKey}\n`);

    await loadEnvFile(path);

    expect(process.env['LOAD_ENV_HEX']).toBe(hexKey);
  });
});
