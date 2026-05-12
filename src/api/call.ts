import { goSync } from '@api3/promise-utils';
import { isNil } from '../guards';
import { logger } from '../logger';
import type { Api, Endpoint } from '../types';

interface ApiCallResult {
  readonly data: unknown;
  readonly status: number;
}

interface BuiltRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

function buildUrl(url: string, path: string, pathParameters: Record<string, string>): string {
  // eslint-disable-next-line functional/no-let
  let resolvedPath = path;
  // eslint-disable-next-line functional/no-loop-statements
  for (const [name, value] of Object.entries(pathParameters)) {
    resolvedPath = resolvedPath.replaceAll(`{${name}}`, encodeURIComponent(value));
  }

  return `${url}${resolvedPath}`;
}

// =============================================================================
// Resolve endpoint parameters into fetch-compatible URL, headers, and body.
// Used both for the real upstream call and for building identical proof-gateway
// requests so the attested transcript matches what Airnode actually sent.
// =============================================================================
function buildApiRequest(api: Api, endpoint: Endpoint, requestParameters: Record<string, string>): BuiltRequest {
  const resolvedParameters = endpoint.parameters.map((parameter) => {
    const value = isNil(parameter.fixed)
      ? (requestParameters[parameter.name] ?? (isNil(parameter.default) ? undefined : String(parameter.default)))
      : String(parameter.fixed);

    return { ...parameter, value };
  });

  const pathParameters = Object.fromEntries(
    resolvedParameters.filter((p) => p.in === 'path' && !isNil(p.value)).map((p) => [p.name, p.value as string])
  );
  const queryParameters = Object.fromEntries(
    resolvedParameters.filter((p) => p.in === 'query' && !isNil(p.value)).map((p) => [p.name, p.value as string])
  );
  const headerParameters = Object.fromEntries(
    resolvedParameters.filter((p) => p.in === 'header' && !isNil(p.value)).map((p) => [p.name, p.value as string])
  );
  const cookieParameters = resolvedParameters.filter((p) => p.in === 'cookie' && !isNil(p.value));
  const bodyParameters = Object.fromEntries(
    resolvedParameters.filter((p) => p.in === 'body' && !isNil(p.value)).map((p) => [p.name, p.value])
  );

  const urlString = buildUrl(api.url, endpoint.path, pathParameters);
  const url = new URL(urlString);

  // Prevent SSRF — the resolved URL origin must exactly match the configured API base
  if (url.origin !== new URL(api.url).origin) {
    throw new Error(`Resolved URL origin ${url.origin} does not match API base ${api.url}`);
  }

  // eslint-disable-next-line functional/no-loop-statements
  for (const [key, value] of Object.entries(queryParameters)) {
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {
    ...headerParameters,
    ...api.headers,
  };

  if (cookieParameters.length > 0) {
    // Cookie values are concatenated raw into the Cookie header, so a `;`, CR,
    // or LF in a (possibly requester-supplied) value would let it inject extra
    // cookie pairs or split the header — reject those outright. (Path/query are
    // percent-encoded and header values are validated by fetch; only cookies
    // are joined verbatim.)
    const invalidCookie = cookieParameters.find((p) => /[;\r\n]/.test(String(p.value)));
    if (invalidCookie) {
      throw new Error(`Cookie parameter "${invalidCookie.name}" value must not contain ';', CR, or LF`);
    }
    const cookieString = cookieParameters.map((p) => `${p.name}=${String(p.value)}`).join('; ');
    const existing = headers['Cookie'];
    headers['Cookie'] = existing ? `${existing}; ${cookieString}` : cookieString; // eslint-disable-line functional/immutable-data
  }

  const hasBody = endpoint.method === 'POST' || endpoint.method === 'PUT' || endpoint.method === 'PATCH';
  const body = hasBody && Object.keys(bodyParameters).length > 0 ? JSON.stringify(bodyParameters) : undefined;

  if (body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'; // eslint-disable-line functional/immutable-data
  }

  return { url: url.toString(), method: endpoint.method, headers, body };
}

async function callApi(
  api: Api,
  endpoint: Endpoint,
  requestParameters: Record<string, string>
): Promise<ApiCallResult> {
  const built = buildApiRequest(api, endpoint, requestParameters);
  const parsedUrl = new URL(built.url);

  logger.debug(`Calling ${built.method} ${parsedUrl.origin}${parsedUrl.pathname}`);

  const response = await fetch(built.url, {
    method: built.method,
    headers: built.headers,
    body: built.body,
    signal: AbortSignal.timeout(api.timeout),
  });

  const text = await response.text();

  // Empty body (e.g. 204 No Content) — return undefined data, let the pipeline decide
  if (text.trim() === '') {
    return { data: undefined, status: response.status };
  }

  const jsonResult = goSync(() => JSON.parse(text) as unknown);
  if (!jsonResult.success) {
    throw new Error(`API returned non-JSON response (status ${String(response.status)})`);
  }

  return { data: jsonResult.data, status: response.status };
}

export { buildApiRequest, callApi };
export type { ApiCallResult, BuiltRequest };
