import { beforeAll, describe, expect, test } from 'bun:test';
import { loadEnvFile } from './env';
import { interpolateEnvironment, parseConfig } from './parser';

const CONFIGS_DIR = `${import.meta.dirname}/../../examples/configs/complete`;
const EXAMPLE_PATH = `${CONFIGS_DIR}/config.yaml`;

beforeAll(() => loadEnvFile(`${CONFIGS_DIR}/.env.example`));

async function loadExample(): Promise<string> {
  return Bun.file(EXAMPLE_PATH).text();
}

describe('parseConfig', () => {
  test('parses the example config', async () => {
    const raw = await loadExample();
    const config = parseConfig(raw);

    expect(config.version).toBe('1.0');
    expect(config.apis).toHaveLength(3);
  });

  test('parses server config', async () => {
    const raw = await loadExample();
    const config = parseConfig(raw);

    expect(config.server.port).toBe(3000);
    expect(config.server.host).toBe('0.0.0.0');
  });

  test('parses API timeout', async () => {
    const raw = await loadExample();
    const config = parseConfig(raw);

    const coingecko = config.apis.find((a) => a.name === 'CoinGecko');
    expect(coingecko?.timeout).toBe(15_000);

    const weather = config.apis.find((a) => a.name === 'WeatherAPI');
    expect(weather?.timeout).toBe(10_000);
  });

  test('parses fixed parameters', async () => {
    const raw = await loadExample();
    const config = parseConfig(raw);

    const coingecko = config.apis.find((a) => a.name === 'CoinGecko');
    const marketData = coingecko?.endpoints.find((endpoint) => endpoint.name === 'coinMarketData');
    const localization = marketData?.parameters.find((p) => p.name === 'localization');
    expect(localization?.fixed).toBe('false');
  });

  test('parses body parameters', async () => {
    const raw = await loadExample();
    const config = parseConfig(raw);

    const randomApi = config.apis.find((a) => a.name === 'RandomAPI');
    const endpoint = randomApi?.endpoints[0];
    const bodyParameters = endpoint?.parameters.filter((p) => p.in === 'body');
    expect(bodyParameters?.length).toBeGreaterThan(0);
    expect(bodyParameters?.find((p) => p.name === 'jsonrpc')?.fixed).toBe('2.0');
  });

  test('parses encoding', async () => {
    const raw = await loadExample();
    const config = parseConfig(raw);

    const coingecko = config.apis.find((a) => a.name === 'CoinGecko');
    const coinPrice = coingecko?.endpoints.find((endpoint) => endpoint.name === 'coinPrice');
    const encoding = coinPrice?.encoding;
    expect(encoding?.type).toBe('int256');
    expect(encoding?.path).toBe('$.ethereum.usd');
    expect(encoding?.times).toBe('1e18');
  });

  test('parses path parameters', async () => {
    const raw = await loadExample();
    const config = parseConfig(raw);

    const coingecko = config.apis.find((a) => a.name === 'CoinGecko');
    const marketData = coingecko?.endpoints.find((endpoint) => endpoint.name === 'coinMarketData');
    const pathParameter = marketData?.parameters.find((p) => p.in === 'path');
    expect(pathParameter?.name).toBe('coinId');
    expect(pathParameter?.required).toBe(true);
  });

  test('parses comma-separated encoding for multi-value encoding', async () => {
    const raw = await loadExample();
    const config = parseConfig(raw);

    const coingecko = config.apis.find((a) => a.name === 'CoinGecko');
    const multiEndpoint = coingecko?.endpoints.find((endpoint) => endpoint.name === 'coinPriceMulti');
    const encoding = multiEndpoint?.encoding;
    expect(encoding?.type).toBe('int256,uint256');
    expect(encoding?.path).toBe('$.ethereum.usd,$.ethereum.usd_24h_vol');
    expect(encoding?.times).toBe('1e18,1e18');
  });

  test('throws on invalid YAML content', () => {
    expect(() => parseConfig('not: valid: yaml: [')).toThrow();
  });

  test('interpolates header values from environment variables', async () => {
    const raw = await loadExample();
    const config = parseConfig(raw);

    const coingecko = config.apis.find((a) => a.name === 'CoinGecko');
    expect(coingecko?.headers?.['x-cg-pro-api-key']).toBe('test-coingecko-key');

    const weather = config.apis.find((a) => a.name === 'WeatherAPI');
    expect(weather?.headers?.['x-weather-key']).toBe('test-weather-key');
  });

  test('parses client-facing auth', async () => {
    const raw = await loadExample();
    const config = parseConfig(raw);

    const coingecko = config.apis.find((a) => a.name === 'CoinGecko');
    expect(coingecko?.auth).toMatchObject({ type: 'apiKey' });

    const weather = config.apis.find((a) => a.name === 'WeatherAPI');
    expect(weather?.auth).toMatchObject({ type: 'free' });
  });
});

describe('interpolateEnv', () => {
  test('replaces ${VAR} with env value', () => {
    process.env['TEST_INTERP'] = 'hello';
    expect(interpolateEnvironment('key: ${TEST_INTERP}')).toBe('key: hello');
  });

  test('replaces multiple variables', () => {
    process.env['A_VAR'] = 'aaa';
    process.env['B_VAR'] = 'bbb';
    expect(interpolateEnvironment('${A_VAR}-${B_VAR}')).toBe('aaa-bbb');
  });

  test('leaves text without variables unchanged', () => {
    expect(interpolateEnvironment('no variables here')).toBe('no variables here');
  });

  test('throws when env variable is not set', () => {
    delete process.env['MISSING_VAR'];
    expect(() => interpolateEnvironment('${MISSING_VAR}')).toThrow(
      'Environment variable MISSING_VAR is referenced in config but not set'
    );
  });
});
