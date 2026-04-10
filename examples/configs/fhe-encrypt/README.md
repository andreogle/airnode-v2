# FHE Encryption Example

Airnode config that encrypts API responses with Fully Homomorphic Encryption (FHE) before signing. The encrypted data
can be submitted to an fhEVM-compatible chain where smart contracts compute on it without decrypting — only addresses
explicitly authorized by the consuming contract can read the plaintext.

## Setup

1. Build the FHE plugin:

```bash
bun run examples:build
```

2. Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable               | Description                                                   |
| ---------------------- | ------------------------------------------------------------- |
| `AIRNODE_PRIVATE_KEY`  | Airnode signing key (use the example key for local dev only)  |
| `FHE_NETWORK`          | `'sepolia'` or `'mainnet'` (default: `'sepolia'`)             |
| `FHE_NETWORK_URL`      | Ethereum RPC endpoint for the target chain                    |
| `FHE_API_KEY`          | API key for Zama's relayer (if required)                      |
| `FHE_CONTRACT_ADDRESS` | Address of the contract that will receive the encrypted data  |
| `AIRNODE_ADDRESS`      | Airnode's public address (derived from `AIRNODE_PRIVATE_KEY`) |

3. Start Airnode:

```bash
bun run airnode start -c examples/configs/fhe-encrypt/config.yaml -e examples/configs/fhe-encrypt/.env
```

4. Call the endpoint:

```bash
curl -s -X POST http://localhost:3000/endpoints/<endpointId> \
  -H 'Content-Type: application/json' \
  -d '{"parameters": {"ids": "ethereum"}}' | jq
```

The `data` field in the response contains `abi.encode(bytes32 handle, bytes inputProof)` — the FHE-encrypted value and
its zero-knowledge proof, ready for on-chain submission.

## How it works

The `fhe-encrypt` plugin hooks into the Airnode pipeline at `onBeforeSign`. It takes the plaintext ABI-encoded response,
encrypts it with the chain's FHE public key via `@zama-fhe/relayer-sdk`, and replaces the `data` field with the
ciphertext. Airnode then signs the encrypted data as usual.

The existing `AirnodeVerifier` contract works unchanged — it verifies the signature and forwards the encrypted bytes to
the callback contract. See `contracts/src/examples/ConfidentialPriceFeed.sol` for an example consumer that registers FHE
handles and manages decryption access control.

See the [FHE Encryption docs](/concepts/fhe-encryption) for the full explanation.
