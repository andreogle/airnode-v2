import { type Hex, keccak256, toHex } from 'viem';
import type { Api, Config, Endpoint } from './types';

// =============================================================================
// Types
// =============================================================================
interface ResolvedEndpoint {
  readonly api: Api;
  readonly endpoint: Endpoint;
}

// =============================================================================
// Endpoint ID derivation
// =============================================================================
function isSecretParameter(param: { readonly secret?: boolean; readonly fixed?: string | number | boolean }): boolean {
  if (param.secret === true) return true;
  if (typeof param.fixed === 'string' && param.fixed.startsWith('${')) return true;
  return false;
}

function buildParameterSpec(
  parameters: readonly {
    readonly name: string;
    readonly fixed?: string | number | boolean;
    readonly secret?: boolean;
  }[]
): string {
  const specs = [...parameters]
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .filter((param) => !isSecretParameter(param))
    .map((param) => (param.fixed === undefined ? param.name : `${param.name}=${String(param.fixed)}`));
  return specs.join(',');
}

function buildEncodingSpec(encoding?: {
  readonly type?: string;
  readonly path?: string;
  readonly times?: string;
}): string {
  if (!encoding) return '';
  if (!encoding.type || !encoding.path) return '';
  const { type, path, times } = encoding;
  const parts = times === undefined ? [type, path] : [type, path, times];
  return parts.join('|');
}

function deriveEndpointId(api: Api, endpoint: Endpoint): Hex {
  const paramSpec = buildParameterSpec(endpoint.parameters);
  const encodingSpec = buildEncodingSpec(endpoint.encoding);
  const parts = encodingSpec
    ? [api.url, endpoint.path, endpoint.method, paramSpec, encodingSpec]
    : [api.url, endpoint.path, endpoint.method, paramSpec];
  const canonical = parts.join('|');
  return keccak256(toHex(canonical));
}

// =============================================================================
// Endpoint map
// =============================================================================
function buildEndpointMap(config: Config): ReadonlyMap<Hex, ResolvedEndpoint> {
  const entries = config.apis.flatMap((api) =>
    api.endpoints.map((endpoint) => {
      const endpointId = deriveEndpointId(api, endpoint);
      return [endpointId, { api, endpoint }] as const;
    })
  );

  return new Map(entries);
}

export { buildEndpointMap, deriveEndpointId };
export type { ResolvedEndpoint };
