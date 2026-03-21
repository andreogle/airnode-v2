import { type Hex, encodeAbiParameters, toHex } from 'viem';
import { isNil } from '../guards';
import { query } from '../json-path';
import type { JsonValue } from '../json-path';
// Accepts both operator-fixed encoding (from config) and resolved encoding
// (merged config + requester params). Only requires the fields that are
// needed for processing — type and path must be present.
interface ProcessEncoding {
  readonly type: string;
  readonly path: string;
  readonly times?: string;
}

type SolidityType = 'int256' | 'uint256' | 'bool' | 'bytes32' | 'address' | 'string' | 'bytes';

const VALID_SOLIDITY_TYPES = new Set<string>(['int256', 'uint256', 'bool', 'bytes32', 'address', 'string', 'bytes']);

function applyMultiplier(value: number, multiply: string | undefined): bigint {
  if (isNil(multiply) || multiply === '') return BigInt(Math.trunc(value));

  const multiplier = Number(multiply);
  const result = value * multiplier;

  return BigInt(Math.trunc(result));
}

function castToSolidityValue(
  raw: JsonValue,
  type: SolidityType,
  multiply: string | undefined
): bigint | boolean | string {
  if (isNil(raw)) {
    throw new Error('Cannot encode nil value');
  }

  switch (type) {
    case 'int256':
    case 'uint256': {
      const number_ = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isNaN(number_)) {
        throw new TypeError(`Cannot convert "${String(raw as string | number | boolean)}" to ${type}`);
      }
      return applyMultiplier(number_, multiply);
    }
    case 'bool': {
      return raw === true || raw === 'true' || raw === 1;
    }
    case 'bytes32': {
      return typeof raw === 'string' && raw.startsWith('0x')
        ? raw
        : toHex(String(raw as string | number | boolean), { size: 32 });
    }
    case 'address': {
      return raw as string;
    }
    case 'string': {
      return String(raw as string | number | boolean);
    }
    case 'bytes': {
      return typeof raw === 'string' && raw.startsWith('0x') ? raw : toHex(String(raw as string | number | boolean));
    }
  }
}

function validateSolidityType(type: string): SolidityType {
  if (!VALID_SOLIDITY_TYPES.has(type)) {
    throw new Error(`Invalid Solidity type: ${type}`);
  }
  return type as SolidityType;
}

function processResponse(data: unknown, encoding: ProcessEncoding): Hex {
  const types = encoding.type.split(',');
  const paths = encoding.path.split(',');
  const times = encoding.times?.split(',') ?? [];

  if (types.length !== paths.length) {
    throw new Error(`type has ${String(types.length)} entries but path has ${String(paths.length)}`);
  }

  const extractions = types.map((typeString, index) => {
    const type = validateSolidityType(typeString.trim());
    const path = paths[index]?.trim() ?? '';
    const multiply = times[index]?.trim();

    const raw = query(data as JsonValue, path);
    if (isNil(raw)) {
      throw new Error(`No value found at path: ${path}`);
    }

    const value = castToSolidityValue(raw, type, multiply);
    return { type, value };
  });

  const abiTypes = extractions.map((extraction) => ({ type: extraction.type }));
  const abiValues = extractions.map((extraction) => extraction.value);

  return encodeAbiParameters(abiTypes as readonly { type: string }[], abiValues);
}

export { processResponse };
export type { SolidityType };
