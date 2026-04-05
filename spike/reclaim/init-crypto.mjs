// ESM preload script that initializes the TLS crypto implementation.
// Must run before attestor-core or zk-symmetric-crypto are imported.
//
// zk-symmetric-crypto has a nested copy of @reclaimprotocol/tls in its own
// node_modules — we must initialize both the top-level and nested instances.
import { setCryptoImplementation } from '@reclaimprotocol/tls';
import { webcryptoCrypto } from '@reclaimprotocol/tls/webcrypto';
setCryptoImplementation(webcryptoCrypto);

// Initialize the nested copy used by zk-symmetric-crypto
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const nestedTlsPath = require.resolve(
  '@reclaimprotocol/tls',
  { paths: [require.resolve('@reclaimprotocol/zk-symmetric-crypto')] }
);
const nestedTls = await import(nestedTlsPath);
nestedTls.setCryptoImplementation(webcryptoCrypto);
