/**
 * Mock upstream API server. Returns configurable JSON responses and records
 * all incoming requests for assertion in tests.
 *
 * The default handler returns a response that satisfies all endpoints in the
 * complete example config — tests override it via MOCK_HANDLER env or by
 * calling the /mock/set-response control endpoint.
 */

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

interface MockApiHandle {
  readonly port: number;
  readonly calls: RecordedCall[];
  readonly reset: () => void;
  readonly stop: () => void;
}

// Default mock responses keyed by path prefix
const DEFAULT_RESPONSES: Record<string, unknown> = {
  '/simple/price': { ethereum: { usd: 3000.5, usd_24h_vol: 15_000_000 } },
  '/coins/': { market_data: { current_price: { usd: 67_000 } } },
  '/current.json': { current: { temp_c: 22.5 } },
  '/json-rpc/': { result: { random: { data: [42] } } },
};

function findDefaultResponse(pathname: string): unknown {
  // eslint-disable-next-line functional/no-loop-statements
  for (const [prefix, response] of Object.entries(DEFAULT_RESPONSES)) {
    if (pathname.startsWith(prefix)) return response;
  }
  return { mock: true };
}

// =============================================================================
// Control endpoint: POST /mock/set-response
//
// Tests can override the response for a specific path:
//   fetch('http://mock/mock/set-response', {
//     method: 'POST',
//     body: JSON.stringify({ path: '/simple/price', response: { ... } })
//   })
// =============================================================================

function startMockApi(port = 5123): MockApiHandle {
  const calls: RecordedCall[] = [];
  const overrides = new Map<string, unknown>();

  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',

    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const body = await request.text();

      // Control endpoints
      if (url.pathname === '/mock/set-response' && request.method === 'POST') {
        const payload = JSON.parse(body) as { path: string; response: unknown; status?: number };
        overrides.set(payload.path, payload); // eslint-disable-line functional/immutable-data
        return Response.json({ ok: true });
      }
      if (url.pathname === '/mock/calls' && request.method === 'GET') {
        return Response.json(calls);
      }
      if (url.pathname === '/mock/reset' && request.method === 'POST') {
        calls.length = 0; // eslint-disable-line functional/immutable-data
        overrides.clear(); // eslint-disable-line functional/immutable-data
        return Response.json({ ok: true });
      }

      // Record the call
      const headers = Object.fromEntries(request.headers.entries());
      calls.push({ url: request.url, method: request.method, headers, body }); // eslint-disable-line functional/immutable-data

      // Return override if set, otherwise default
      const override = overrides.get(url.pathname) as { response: unknown; status?: number } | undefined;
      if (override !== undefined) {
        return Response.json(override.response, { status: override.status ?? 200 });
      }

      return Response.json(findDefaultResponse(url.pathname));
    },
  });

  return {
    port: server.port ?? port,
    calls,
    reset: () => {
      calls.length = 0; // eslint-disable-line functional/immutable-data
      overrides.clear(); // eslint-disable-line functional/immutable-data
    },
    stop: () => {
      void server.stop();
    },
  };
}

export { startMockApi };
export type { MockApiHandle, RecordedCall };
