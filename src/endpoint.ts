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
function buildParameterSpec(parameters: Endpoint['parameters']): readonly Record<string, unknown>[] {
  return [...parameters]
    .toSorted((a, b) => `${a.name}:${a.in}`.localeCompare(`${b.name}:${b.in}`))
    .map((parameter) => {
      const isSecret =
        parameter.secret || (typeof parameter.fixed === 'string' && /\$\{[A-Z_][A-Z0-9_]*\}/i.test(parameter.fixed));
      return {
        name: parameter.name,
        in: parameter.in,
        required: parameter.required,
        secret: isSecret,
        ...(!isSecret && parameter.default !== undefined && { default: parameter.default }),
        ...(!isSecret && parameter.fixed !== undefined && { fixed: parameter.fixed }),
      };
    });
}

// Canonical string: `url|path|method|parameterSpec[|encodingSpec[|encryptSpec]]`.
// Parameter entries use JSON so location/default/required/secret markers cannot
// collapse into the same specification. Other segments retain the v2 format.
function deriveEndpointId(api: Api, endpoint: Endpoint): Hex {
  const parameterEntries = buildParameterSpec(endpoint.parameters);
  const parameterSpec = parameterEntries.length === 0 ? '' : JSON.stringify(parameterEntries);
  const encodingSpec = endpoint.encoding
    ? `type=${endpoint.encoding.type},path=${endpoint.encoding.path},times=${endpoint.encoding.times ?? ''}`
    : '';
  const encryptSpec = endpoint.encrypt
    ? `fhe=${endpoint.encrypt.type},contract=${endpoint.encrypt.contract.toLowerCase()}`
    : '';
  const tail = [encodingSpec, encryptSpec].filter((spec) => spec !== '');
  const canonical = [api.url, endpoint.path, endpoint.method, parameterSpec, ...tail].join('|');
  return keccak256(toHex(canonical));
}

// =============================================================================
// Endpoint map
//
// Two endpoints with identical specifications (URL, path, method, parameters,
// encoding, encryption) derive the same ID. Building the map silently with
// `new Map(entries)` would let the later one shadow the earlier — so we detect
// the collision and fail loudly instead.
// =============================================================================
function buildEndpointMap(config: Config): ReadonlyMap<Hex, ResolvedEndpoint> {
  const entries = config.apis.flatMap((api) =>
    api.endpoints.map((endpoint) => [deriveEndpointId(api, endpoint), { api, endpoint }] as const)
  );

  const ids = entries.map(([id]) => id);
  const duplicateId = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicateId) {
    const colliding = entries
      .filter(([id]) => id === duplicateId)
      .map(([, resolved]) => `"${resolved.api.name}/${resolved.endpoint.name}"`);
    throw new Error(
      `Endpoints ${colliding.join(' and ')} derive the same endpoint ID ${duplicateId} — their specifications are identical`
    );
  }

  return new Map(entries);
}

export { buildEndpointMap, deriveEndpointId };
export type { ResolvedEndpoint };
