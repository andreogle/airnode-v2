import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { printBanner } from './banner';

const infoMock = mock();
const originalInfo = console.info;

beforeEach(() => {
  console.info = infoMock;
});

afterEach(() => {
  console.info = originalInfo;
  infoMock.mockClear();
});

const bannerOptions = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  version: '2.0.0',
  host: '0.0.0.0',
  port: 3000,
  endpoints: 5,
};

describe('printBanner', () => {
  test('prints the Airnode ASCII art', () => {
    printBanner(bannerOptions);

    expect(infoMock).toHaveBeenCalledTimes(1);
    const output = infoMock.mock.calls[0]?.[0] as string;
    expect(output).toContain('___');
  });

  test('includes the version', () => {
    printBanner(bannerOptions);

    const output = infoMock.mock.calls[0]?.[0] as string;
    expect(output).toContain('Version:');
    expect(output).toContain('2.0.0');
  });

  test('includes the address with label', () => {
    printBanner(bannerOptions);

    const output = infoMock.mock.calls[0]?.[0] as string;
    expect(output).toContain('Address:');
    expect(output).toContain(bannerOptions.address);
  });

  test('includes the listen address', () => {
    printBanner(bannerOptions);

    const output = infoMock.mock.calls[0]?.[0] as string;
    expect(output).toContain('Listen:');
    expect(output).toContain('0.0.0.0:3000');
  });

  test('includes the endpoint count', () => {
    printBanner(bannerOptions);

    const output = infoMock.mock.calls[0]?.[0] as string;
    expect(output).toContain('Endpoints:');
    expect(output).toContain('5');
  });
});
