import { type Hex, encodeAbiParameters, getAddress, toHex } from 'viem';
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

const DECIMAL_REGEX = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const ADDRESS_REGEX = /^0x[\da-fA-F]{40}$/;
const HEX_BYTES_REGEX = /^0x([\da-fA-F]{2})*$/;

const INT256_MAX = 2n ** 255n - 1n;
const INT256_MIN = -(2n ** 255n);
const UINT256_MAX = 2n ** 256n - 1n;

// =============================================================================
// Lossless decimal math
//
// Multiplication is performed on BigInt mantissas to avoid JS float truncation
// above 2^53. Both the extracted value and the `times` multiplier are parsed
// as (mantissa, exp) pairs where value = mantissa * 10^exp. The product is
// scaled to an integer by truncating toward zero — matching v1 behaviour.
// =============================================================================
function parseDecimal(input: string): { readonly mantissa: bigint; readonly exp: number } {
  if (!DECIMAL_REGEX.test(input)) {
    throw new Error(`Cannot parse numeric value: ${input}`);
  }

  const negative = input.startsWith('-');
  const unsigned = negative ? input.slice(1) : input;

  const [baseRaw = '', expRaw] = unsigned.split(/[eE]/);
  const scientificExp = expRaw ? Number(expRaw) : 0;

  const [intPart = '0', fracPart = ''] = baseRaw.split('.');
  const mantissaDigits = `${intPart}${fracPart}`.replace(/^0+(?=\d)/, '') || '0';
  const mantissa = (negative ? -1n : 1n) * BigInt(mantissaDigits);

  return { mantissa, exp: scientificExp - fracPart.length };
}

function scaleToBigInt(mantissa: bigint, exp: number): bigint {
  if (exp >= 0) return mantissa * 10n ** BigInt(exp);
  return mantissa / 10n ** BigInt(-exp); // truncates toward zero
}

function applyMultiplier(value: string, multiply: string | undefined): bigint {
  const valueParts = parseDecimal(value);
  if (isNil(multiply) || multiply === '') {
    return scaleToBigInt(valueParts.mantissa, valueParts.exp);
  }
  const timesParts = parseDecimal(multiply);
  return scaleToBigInt(valueParts.mantissa * timesParts.mantissa, valueParts.exp + timesParts.exp);
}

// =============================================================================
// Raw value → canonical string
//
// Converting via `String(raw)` loses precision for JS numbers outside
// Number.MAX_SAFE_INTEGER. Upstream APIs that need full uint256 precision
// should return numeric values as JSON strings, which preserve every digit
// through JSON.parse and into parseDecimal.
// =============================================================================
function numericToString(raw: JsonValue): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      throw new TypeError(`Cannot convert ${String(raw)} to numeric`);
    }
    return raw.toString();
  }
  if (typeof raw === 'boolean') return raw ? '1' : '0';
  throw new TypeError(`Cannot convert ${typeof raw} to numeric`);
}

// =============================================================================
// Solidity value coercion
// =============================================================================
function castToInt256(raw: JsonValue, multiply: string | undefined): bigint {
  const value = applyMultiplier(numericToString(raw), multiply);
  if (value > INT256_MAX || value < INT256_MIN) {
    throw new RangeError(`Value ${value.toString()} does not fit in int256`);
  }
  return value;
}

function castToUint256(raw: JsonValue, multiply: string | undefined): bigint {
  const value = applyMultiplier(numericToString(raw), multiply);
  if (value < 0n) {
    throw new RangeError(`Cannot encode negative value ${value.toString()} as uint256`);
  }
  if (value > UINT256_MAX) {
    throw new RangeError(`Value ${value.toString()} does not fit in uint256`);
  }
  return value;
}

function castToBool(raw: JsonValue): boolean {
  return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

function castToBytes32(raw: JsonValue): Hex {
  if (typeof raw === 'string' && raw.startsWith('0x')) {
    if (!HEX_BYTES_REGEX.test(raw)) throw new Error(`Invalid hex bytes32: ${raw}`);
    if ((raw.length - 2) / 2 > 32) throw new RangeError(`Value exceeds 32 bytes: ${raw}`);
    return raw as Hex;
  }
  return toHex(String(raw as string | number | boolean), { size: 32 });
}

function castToAddress(raw: JsonValue): Hex {
  if (typeof raw !== 'string' || !ADDRESS_REGEX.test(raw)) {
    throw new Error(`Invalid EVM address: ${String(raw as string | number | boolean)}`);
  }
  return getAddress(raw);
}

function castToBytes(raw: JsonValue): Hex {
  if (typeof raw === 'string' && raw.startsWith('0x')) {
    if (!HEX_BYTES_REGEX.test(raw)) throw new Error(`Invalid hex bytes: ${raw}`);
    return raw as Hex;
  }
  return toHex(String(raw as string | number | boolean));
}

function castToSolidityValue(
  raw: JsonValue,
  solidityType: SolidityType,
  multiply: string | undefined
): bigint | boolean | string {
  if (isNil(raw)) throw new Error('Cannot encode nil value');

  switch (solidityType) {
    case 'int256': {
      return castToInt256(raw, multiply);
    }
    case 'uint256': {
      return castToUint256(raw, multiply);
    }
    case 'bool': {
      return castToBool(raw);
    }
    case 'bytes32': {
      return castToBytes32(raw);
    }
    case 'address': {
      return castToAddress(raw);
    }
    case 'string': {
      return String(raw as string | number | boolean);
    }
    case 'bytes': {
      return castToBytes(raw);
    }
  }
}

function validateSolidityType(solidityType: string): SolidityType {
  if (!VALID_SOLIDITY_TYPES.has(solidityType)) {
    throw new Error(`Invalid Solidity type: ${solidityType}`);
  }
  return solidityType as SolidityType;
}

function processResponse(data: unknown, encoding: ProcessEncoding): Hex {
  const types = encoding.type.split(',');
  const paths = encoding.path.split(',');
  const times = encoding.times?.split(',') ?? [];

  if (types.length !== paths.length) {
    throw new Error(`type has ${String(types.length)} entries but path has ${String(paths.length)}`);
  }

  const extractions = types.map((typeString, index) => {
    const solidityType = validateSolidityType(typeString.trim());
    const path = paths[index]?.trim() ?? '';
    const multiply = times[index]?.trim();

    const raw = query(data as JsonValue, path);
    if (isNil(raw)) {
      throw new Error(`No value found at path: ${path}`);
    }

    const value = castToSolidityValue(raw, solidityType, multiply);
    return { type: solidityType, value };
  });

  const abiTypes = extractions.map((extraction) => ({ type: extraction.type }));
  const abiValues = extractions.map((extraction) => extraction.value);

  return encodeAbiParameters(abiTypes as readonly { type: string }[], abiValues);
}

export { processResponse };
export type { SolidityType };
