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
