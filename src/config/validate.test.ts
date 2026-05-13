import { describe, expect, test } from 'bun:test';
import { validateConfig } from './validate';

const MINIMAL_VALID = `
version: '1.0'
server:
  port: 3000
  rateLimit:
    window: 60000
    max: 100
settings:
  proof: none
apis:
  - name: TestApi
    url: https://api.example.com
    endpoints:
      - name: getPrice
        path: /price
`;

describe('validateConfig', () => {
  // ===========================================================================
  // Valid configs
  // ===========================================================================
  test('accepts a valid minimal config', () => {
    const result = validateConfig(MINIMAL_VALID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.config.version).toBe('1.0');
    expect(result.config.apis).toHaveLength(1);
  });

  test('applies defaults for optional fields', () => {
    const result = validateConfig(MINIMAL_VALID);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const api = result.config.apis[0];
    if (!api) return;
    expect(api.timeout).toBe(10_000);
    expect(api.endpoints[0]?.method).toBe('GET');
    expect(result.config.server.host).toBe('0.0.0.0');
  });

  // ===========================================================================
  // YAML parse errors
  // ===========================================================================
  test('rejects invalid YAML', () => {
    const result = validateConfig('{ invalid yaml: [}');

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0]).toContain('YAML parse error');
  });

  // ===========================================================================
  // Schema validation errors
  // ===========================================================================
  test('rejects missing version', () => {
    const yaml = `
server:
  port: 3000
  rateLimit:
    window: 60000
    max: 100
settings:
  proof: none
apis:
  - name: Test
    url: https://api.example.com
    endpoints:
      - name: test
        path: /test
`;
    const result = validateConfig(yaml);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.some((e) => e.includes('version'))).toBe(true);
  });

  test('rejects empty apis array', () => {
    const yaml = `
version: '1.0'
server:
  port: 3000
  rateLimit:
    window: 60000
    max: 100
settings:
  proof: none
apis: []
`;
    const result = validateConfig(yaml);

    expect(result.success).toBe(false);
  });

  test('rejects missing server', () => {
    const yaml = `
version: '1.0'
settings:
  proof: none
apis:
  - name: Test
    url: https://api.example.com
    endpoints:
      - name: test
        path: /test
`;
    const result = validateConfig(yaml);

    expect(result.success).toBe(false);
  });

  // ===========================================================================
  // Cross-field validation
  // ===========================================================================
  test('rejects duplicate API names', () => {
    const yaml = `
version: '1.0'
server:
  port: 3000
  rateLimit:
    window: 60000
    max: 100
settings:
  proof: none
apis:
  - name: Duplicate
    url: https://api.example.com
    endpoints:
      - name: a
        path: /a
  - name: Duplicate
    url: https://api2.example.com
    endpoints:
      - name: b
        path: /b
`;
    const result = validateConfig(yaml);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0]).toContain('Duplicate API name');
  });

  test('rejects duplicate endpoint names within an API', () => {
    const yaml = `
version: '1.0'
server:
  port: 3000
  rateLimit:
    window: 60000
    max: 100
settings:
  proof: none
apis:
  - name: Weather
    url: https://api.example.com
    endpoints:
      - name: forecast
        path: /a
      - name: forecast
        path: /b
`;
    const result = validateConfig(yaml);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.some((e) => e.includes('Duplicate endpoint name(s) in API "Weather": forecast'))).toBe(true);
  });

  test('rejects duplicate plugin sources', () => {
    const yaml = `
version: '1.0'
server:
  port: 3000
  rateLimit:
    window: 60000
    max: 100
settings:
  proof: none
  plugins:
    - source: ./heartbeat.js
      timeout: 5000
    - source: ./heartbeat.js
      timeout: 3000
apis:
  - name: Test
    url: https://api.example.com
    endpoints:
      - name: test
        path: /test
`;
    const result = validateConfig(yaml);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.some((e) => e.includes('Duplicate plugin source(s): ./heartbeat.js'))).toBe(true);
  });

  test('rejects endpoints with identical specifications (colliding endpoint IDs)', () => {
    const yaml = `
version: '1.0'
server:
  port: 3000
  rateLimit:
    window: 60000
    max: 100
settings:
  proof: none
apis:
  - name: Test
    url: https://api.example.com
    endpoints:
      - name: first
        path: /data
      - name: second
        path: /data
`;
    const result = validateConfig(yaml);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.some((e) => e.includes('identical specifications'))).toBe(true);
  });

  // ===========================================================================
  // Environment interpolation (interpolate = true)
  // ===========================================================================
  test('interpolates ${ENV_VAR} references when interpolate is true', () => {
    process.env['TEST_VALIDATE_API_URL'] = 'https://from-env.example.com';
    const yaml = `
version: '1.0'
server:
  port: 3000
  rateLimit:
    window: 60000
    max: 100
settings:
  proof: none
apis:
  - name: Test
    url: \${TEST_VALIDATE_API_URL}
    endpoints:
      - name: test
        path: /test
`;
    const result = validateConfig(yaml, true);
    delete process.env['TEST_VALIDATE_API_URL'];

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.config.apis[0]?.url).toBe('https://from-env.example.com');
  });

  test('reports an error when an interpolated env var is missing', () => {
    const yaml = `
version: '1.0'
server:
  port: 3000
  rateLimit:
    window: 60000
    max: 100
settings:
  proof: none
apis:
  - name: Test
    url: \${DEFINITELY_NOT_SET_ENV_VAR_XYZ}
    endpoints:
      - name: test
        path: /test
`;
    const result = validateConfig(yaml, true);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('DEFINITELY_NOT_SET_ENV_VAR_XYZ');
  });

  // ===========================================================================
  // Multiple errors
  // ===========================================================================
  test('reports schema errors', () => {
    const yaml = `
version: '1.0'
server:
  port: -1
settings:
  proof: none
apis: []
`;
    const result = validateConfig(yaml);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });
});
