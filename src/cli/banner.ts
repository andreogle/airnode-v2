import { dim, red, reset } from './colors';

// =============================================================================
// Shared ASCII art
// =============================================================================
const LOGO_LINES = [
  ``,
  `${red}     ___    _                      __  ${reset}`,
  `${red}    /   |  (_)________  ____  ____/ /__ ${reset}`,
  `${red}   / /| | / / ___/ __ \\/ __ \\/ __  / _ \\${reset}`,
  `${red}  / ___ |/ / /  / / / / /_/ / /_/ /  __/${reset}`,
  String.raw`${red} /_/  |_/_/_/  /_/ /_/\____/\__,_/\___/${reset}`,
  ``,
];

// =============================================================================
// Banner
// =============================================================================
interface BannerOptions {
  readonly address: string;
  readonly version: string;
  readonly host: string;
  readonly port: number;
  readonly endpoints: number;
}

function printBanner(options: BannerOptions): void {
  const lines = [
    ...LOGO_LINES,
    `${dim}  Version:   ${options.version}${reset}`,
    `${dim}  Address:   ${options.address}${reset}`,
    `${dim}  Listen:    ${options.host}:${String(options.port)}${reset}`,
    `${dim}  Endpoints: ${String(options.endpoints)}${reset}`,
    ``,
  ];

  console.info(lines.join('\n'));
}

// =============================================================================
// Cache server banner
// =============================================================================
interface CacheServerBannerOptions {
  readonly version: string;
  readonly host: string;
  readonly port: number;
  readonly endpoints: number;
}

function printCacheServerBanner(options: CacheServerBannerOptions): void {
  const lines = [
    ...LOGO_LINES,
    `${dim}  Mode:      Cache Server${reset}`,
    `${dim}  Version:   ${options.version}${reset}`,
    `${dim}  Listen:    ${options.host}:${String(options.port)}${reset}`,
    `${dim}  Endpoints: ${String(options.endpoints)}${reset}`,
    ``,
  ];

  console.info(lines.join('\n'));
}

export { printBanner, printCacheServerBanner };
export type { BannerOptions, CacheServerBannerOptions };
