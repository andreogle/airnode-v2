import { describe, expect, test } from 'bun:test';
import { VERSION } from './version';

describe('VERSION', () => {
  test('is a semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });

  test('matches package.json', () => {
    const pkg = import.meta.require('../package.json') as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
