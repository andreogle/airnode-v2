import { encodeAbiParameters, decodeAbiParameters, concatHex, sliceHex, type Hex } from 'viem';

const ENCODING_VERSION = 1;
const VERSION_BYTE_LENGTH = 1;

const abiParameterTypes = [
  { name: 'names', type: 'string[]' },
  { name: 'values', type: 'string[]' },
] as const;

export function encode(parameters: { name: string; value: string }[]): Hex {
  const names = parameters.map((p) => p.name);
  const values = parameters.map((p) => p.value);

  const versionHex: Hex = `0x${ENCODING_VERSION.toString(16).padStart(2, '0')}`;
  const encodedData = encodeAbiParameters(abiParameterTypes, [names, values]);

  return concatHex([versionHex, encodedData]);
}

export function decode(data: Hex): Record<string, string> {
  // "0x" = empty, less than version byte + minimal ABI data = too short to be valid
  if (data === '0x') {
    return {};
  }

  if (data.length < 260) {
    throw new Error(`Data too short to be valid encoded parameters (${String(data.length)} chars)`);
  }

  const versionByte = Number.parseInt(sliceHex(data, 0, VERSION_BYTE_LENGTH), 16);
  if (versionByte !== ENCODING_VERSION) {
    throw new Error(`Unsupported encoding version: ${String(versionByte)}. Expected ${String(ENCODING_VERSION)}`);
  }

  const encodedData = sliceHex(data, VERSION_BYTE_LENGTH);
  const [names, values] = decodeAbiParameters(abiParameterTypes, encodedData);

  const entries = names.map((name, index) => [name, values[index] ?? ''] as const);

  return Object.fromEntries(entries);
}
