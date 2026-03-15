import { goSync } from '@api3/promise-utils';
import { isNil } from '../guards';
import { logger } from '../logger';
import type { Api, Endpoint } from '../types';

interface ApiCallResult {
  readonly data: unknown;
  readonly status: number;
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

async function callApi(
  api: Api,
  endpoint: Endpoint,
  requestParameters: Record<string, string>
): Promise<ApiCallResult> {
  const parameterDefs = endpoint.parameters;

  const resolvedParameters = parameterDefs.map((parameter) => {
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

  const hasBody = endpoint.method === 'POST' || endpoint.method === 'PUT' || endpoint.method === 'PATCH';
  const body = hasBody && Object.keys(bodyParameters).length > 0 ? JSON.stringify(bodyParameters) : undefined;

  if (body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'; // eslint-disable-line functional/immutable-data
  }

  logger.debug(`Calling ${endpoint.method} ${url.origin}${url.pathname}`);

  const response = await fetch(url.toString(), {
    method: endpoint.method,
    headers,
    body,
    signal: AbortSignal.timeout(api.timeout),
  });

  const text = await response.text();
  const jsonResult = goSync(() => JSON.parse(text) as unknown);
  if (!jsonResult.success) {
    throw new Error(`API returned non-JSON response (status ${String(response.status)})`);
  }

  return { data: jsonResult.data, status: response.status };
}

export { callApi };
export type { ApiCallResult };
