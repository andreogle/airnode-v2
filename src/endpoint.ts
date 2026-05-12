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
  return `type=${encoding.type ?? '*'},path=${encoding.path ?? '*'},times=${encoding.times ?? '*'}`;
}

// FHE-encrypted endpoints commit to the ciphertext type and the bound consumer
// contract so an on-chain verifier can tell from the endpoint ID alone that the
// signed `data` is an encrypted-input handle for a specific contract.
function buildEncryptSpec(encrypt?: { readonly type: string; readonly contract: string }): string {
  if (!encrypt) return '';
  return `fhe=${encrypt.type},contract=${encrypt.contract.toLowerCase()}`;
}

// Canonical string: `url|path|method|paramSpec[|encodingSpec[|encryptSpec]]`,
// joined by `|`, where paramSpec/encodingSpec/encryptSpec use `,` and `=` as
// internal delimiters. This is not a length-prefixed encoding, so in principle
// a config containing those characters in a path or parameter value could be
// crafted to collide with a different config — but the operator controls every
// segment and has no incentive to collide with themselves, so we accept the
// simpler form. (`buildEndpointMap` still catches accidental collisions.)
function deriveEndpointId(api: Api, endpoint: Endpoint): Hex {
  const paramSpec = buildParameterSpec(endpoint.parameters);
  const tail = [buildEncodingSpec(endpoint.encoding), buildEncryptSpec(endpoint.encrypt)].filter((spec) => spec !== '');
  const parts = [api.url, endpoint.path, endpoint.method, paramSpec, ...tail];
  const canonical = parts.join('|');
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
