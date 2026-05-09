import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Api, Endpoint } from '../types';
import { callApi } from './call';

const fetchMock = mock();
globalThis.fetch = fetchMock as unknown as typeof fetch;

function makeApi(overrides: Partial<Api> = {}): Api {
  return {
    name: 'test-api',
    url: 'https://api.example.com',
    timeout: 10_000,
    endpoints: [],
    ...overrides,
  };
}

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    name: 'test-endpoint',
    path: '/data',
    method: 'GET',
    parameters: [],
    ...overrides,
  } as Endpoint;
}

const DEFAULT_RESPONSE = { result: 42 };

function mockFetchResponse(data: unknown = DEFAULT_RESPONSE, status = 200): void {
  fetchMock.mockResolvedValue({
    text: () => Promise.resolve(JSON.stringify(data)),
    status,
  });
}

function fetchCallArguments(): { url: string; options: RequestInit } {
  const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, options };
}

describe('callApi', () => {
  beforeEach(() => {
    mockFetchResponse();
  });

  afterEach(() => {
    fetchMock.mockClear();
  });

  test('makes a basic GET request', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint();

    const result = await callApi(api, endpoint, {});

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ result: 42 });

    const { url, options } = fetchCallArguments();
    expect(url).toBe('https://api.example.com/data');
    expect(options.method).toBe('GET');
    expect(options.body).toBeUndefined();
  });

  test('makes a POST request with body parameters', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      method: 'POST',
      path: '/submit',
      parameters: [
        { name: 'symbol', in: 'body', required: true, secret: false },
        { name: 'interval', in: 'body', required: false, secret: false },
      ],
    });

    await callApi(api, endpoint, { symbol: 'ETH', interval: '1h' });

    const { url, options } = fetchCallArguments();
    expect(url).toBe('https://api.example.com/submit');
    expect(options.method).toBe('POST');
    expect(options.body).toBe(JSON.stringify({ symbol: 'ETH', interval: '1h' }));
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  test('does not set body for GET requests even with body parameters', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      parameters: [{ name: 'foo', in: 'body', required: false, secret: false }],
    });

    await callApi(api, endpoint, { foo: 'bar' });

    const { options } = fetchCallArguments();
    expect(options.body).toBeUndefined();
  });

  test('does not set Content-Type when POST has no body parameters', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({ method: 'POST' });

    await callApi(api, endpoint, {});

    const { options } = fetchCallArguments();
    expect(options.body).toBeUndefined();
    expect((options.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  test('does not override existing Content-Type header', async () => {
    const api = makeApi({ headers: { 'Content-Type': 'text/xml' } });
    const endpoint = makeEndpoint({
      method: 'POST',
      parameters: [{ name: 'data', in: 'body', required: true, secret: false }],
    });

    await callApi(api, endpoint, { data: 'test' });

    const { options } = fetchCallArguments();
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('text/xml');
  });

  test('appends query parameters to the URL', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      parameters: [
        { name: 'coinId', in: 'query', required: true, secret: false },
        { name: 'currency', in: 'query', required: false, secret: false },
      ],
    });

    await callApi(api, endpoint, { coinId: 'bitcoin', currency: 'usd' });

    const { url } = fetchCallArguments();
    const parsed = new URL(url);
    expect(parsed.searchParams.get('coinId')).toBe('bitcoin');
    expect(parsed.searchParams.get('currency')).toBe('usd');
  });

  test('substitutes path parameters into the URL', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      path: '/coins/{coinId}/market_chart',
      parameters: [{ name: 'coinId', in: 'path', required: true, secret: false }],
    });

    await callApi(api, endpoint, { coinId: 'bitcoin' });

    const { url } = fetchCallArguments();
    expect(url).toBe('https://api.example.com/coins/bitcoin/market_chart');
  });

  test('encodes path parameter values', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      path: '/search/{query}',
      parameters: [{ name: 'query', in: 'path', required: true, secret: false }],
    });

    await callApi(api, endpoint, { query: 'hello world' });

    const { url } = fetchCallArguments();
    expect(url).toBe('https://api.example.com/search/hello%20world');
  });

  test('sets header parameters', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      parameters: [{ name: 'X-Custom-Header', in: 'header', required: true, secret: false }],
    });

    await callApi(api, endpoint, { 'X-Custom-Header': 'custom-value' });

    const { options } = fetchCallArguments();
    expect((options.headers as Record<string, string>)['X-Custom-Header']).toBe('custom-value');
  });

  test('api-level headers override parameter headers with the same name', async () => {
    const api = makeApi({ headers: { 'X-Shared': 'from-api' } });
    const endpoint = makeEndpoint({
      parameters: [{ name: 'X-Shared', in: 'header', required: true, secret: false }],
    });

    await callApi(api, endpoint, { 'X-Shared': 'from-param' });

    const { options } = fetchCallArguments();
    expect((options.headers as Record<string, string>)['X-Shared']).toBe('from-api');
  });

  test('uses fixed parameter value, ignoring request parameters', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      parameters: [{ name: 'apiVersion', in: 'query', required: false, secret: false, fixed: 'v2' }],
    });

    await callApi(api, endpoint, { apiVersion: 'v3' });

    const { url } = fetchCallArguments();
    const parsed = new URL(url);
    expect(parsed.searchParams.get('apiVersion')).toBe('v2');
  });

  test('uses default parameter value when request parameter is missing', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      parameters: [{ name: 'currency', in: 'query', required: false, secret: false, default: 'usd' }],
    });

    await callApi(api, endpoint, {});

    const { url } = fetchCallArguments();
    const parsed = new URL(url);
    expect(parsed.searchParams.get('currency')).toBe('usd');
  });

  test('request parameter overrides default value', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      parameters: [{ name: 'currency', in: 'query', required: false, secret: false, default: 'usd' }],
    });

    await callApi(api, endpoint, { currency: 'eur' });

    const { url } = fetchCallArguments();
    const parsed = new URL(url);
    expect(parsed.searchParams.get('currency')).toBe('eur');
  });

  test('converts numeric fixed value to string', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      parameters: [{ name: 'limit', in: 'query', required: false, secret: false, fixed: 100 }],
    });

    await callApi(api, endpoint, {});

    const { url } = fetchCallArguments();
    const parsed = new URL(url);
    expect(parsed.searchParams.get('limit')).toBe('100');
  });

  test('omits parameter when no fixed, default, or request value exists', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      parameters: [{ name: 'optional', in: 'query', required: false, secret: false }],
    });

    await callApi(api, endpoint, {});

    const { url } = fetchCallArguments();
    const parsed = new URL(url);
    expect(parsed.searchParams.has('optional')).toBe(false);
  });

  test('passes upstream credentials via api.headers', async () => {
    const api = makeApi({ headers: { 'x-api-key': 'secret-key-123' } });
    const endpoint = makeEndpoint();

    await callApi(api, endpoint, {});

    const { options } = fetchCallArguments();
    expect((options.headers as Record<string, string>)['x-api-key']).toBe('secret-key-123');
  });

  test('sends body for PUT requests', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      method: 'PUT',
      parameters: [{ name: 'value', in: 'body', required: true, secret: false }],
    });

    await callApi(api, endpoint, { value: 'updated' });

    const { options } = fetchCallArguments();
    expect(options.method).toBe('PUT');
    expect(options.body).toBe(JSON.stringify({ value: 'updated' }));
  });

  test('sends body for PATCH requests', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      method: 'PATCH',
      parameters: [{ name: 'name', in: 'body', required: true, secret: false }],
    });

    await callApi(api, endpoint, { name: 'new-name' });

    const { options } = fetchCallArguments();
    expect(options.method).toBe('PATCH');
    expect(options.body).toBe(JSON.stringify({ name: 'new-name' }));
  });

  test('returns non-200 status from API', async () => {
    mockFetchResponse({ error: 'not found' }, 404);

    const api = makeApi();
    const endpoint = makeEndpoint();

    const result = await callApi(api, endpoint, {});

    expect(result.status).toBe(404);
    expect(result.data).toEqual({ error: 'not found' });
  });

  test('routes parameters to correct locations simultaneously', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      method: 'POST',
      path: '/coins/{coinId}',
      parameters: [
        { name: 'coinId', in: 'path', required: true, secret: false },
        { name: 'currency', in: 'query', required: true, secret: false },
        { name: 'X-Request-Id', in: 'header', required: true, secret: false },
        { name: 'amount', in: 'body', required: true, secret: false },
      ],
    });

    await callApi(api, endpoint, {
      coinId: 'ethereum',
      currency: 'usd',
      'X-Request-Id': 'req-001',
      amount: '1000',
    });

    const { url, options } = fetchCallArguments();
    const parsed = new URL(url);

    expect(parsed.pathname).toBe('/coins/ethereum');
    expect(parsed.searchParams.get('currency')).toBe('usd');
    expect((options.headers as Record<string, string>)['X-Request-Id']).toBe('req-001');
    expect(options.body).toBe(JSON.stringify({ amount: '1000' }));
  });

  test('sends cookie parameters as Cookie header', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      parameters: [
        { name: 'session', in: 'cookie', required: true, secret: false, fixed: 'abc123' },
        { name: 'tracking', in: 'cookie', required: false, secret: false },
      ],
    });

    await callApi(api, endpoint, { tracking: 'xyz' });

    const { options } = fetchCallArguments();
    expect((options.headers as Record<string, string>)['Cookie']).toBe('session=abc123; tracking=xyz');
  });

  test('omits Cookie header when no cookie parameters have values', async () => {
    const api = makeApi();
    const endpoint = makeEndpoint({
      parameters: [{ name: 'session', in: 'cookie', required: false, secret: false }],
    });

    await callApi(api, endpoint, {});

    const { options } = fetchCallArguments();
    expect((options.headers as Record<string, string>)['Cookie']).toBeUndefined();
  });

  test('returns null data for empty response body (204 No Content)', async () => {
    fetchMock.mockResolvedValue({
      text: () => Promise.resolve(''),
      status: 204,
    });

    const result = await callApi(makeApi(), makeEndpoint(), {});

    expect(result.status).toBe(204);
    expect(result.data).toBeUndefined();
  });

  test('returns null data for whitespace-only response body', async () => {
    fetchMock.mockResolvedValue({
      text: () => Promise.resolve('  \n  '),
      status: 200,
    });

    const result = await callApi(makeApi(), makeEndpoint(), {});

    expect(result.status).toBe(200);
    expect(result.data).toBeUndefined();
  });
});
