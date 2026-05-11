# FHE Encryption Example

Airnode config that encrypts API responses with Fully Homomorphic Encryption (FHE) before signing. The encrypted data
can be submitted to an fhEVM-compatible chain where smart contracts compute on it without decrypting — only addresses
explicitly authorized by the consuming contract can read the plaintext.

FHE encryption is a built-in feature: configure the relayer once under `settings.fhe`, then flag any endpoint with an
`encrypt` block. No plugin build step.

## Setup

1. Copy `.env.example` to `.env` and set `AIRNODE_PRIVATE_KEY` (the example key is for local dev only):

```bash
cp .env.example .env
```

2. Edit `config.yaml`:

| Field                         | Description                                                                |
| ----------------------------- | -------------------------------------------------------------------------- |
| `settings.fhe.network`        | `sepolia` or `mainnet` — selects the Zama chain preset                     |
| `settings.fhe.rpcUrl`         | Ethereum JSON-RPC endpoint for the target chain                            |
| `settings.fhe.verifier`       | AirnodeVerifier address on that chain (the encrypted input is bound to it) |
| `settings.fhe.apiKey`         | (optional) API key for Zama's hosted relayer (not needed on Sepolia)       |
| `<endpoint>.encrypt.type`     | FHE ciphertext type (`euint256`, `euint64`, …)                             |
| `<endpoint>.encrypt.contract` | Address of the consumer contract that will receive the encrypted data      |

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

When an endpoint has an `encrypt` block, the pipeline encrypts the ABI-encoded value with the target chain's FHE public
key (via `@zama-fhe/relayer-sdk`) right after encoding and before signing — so `onBeforeSign` plugins and the signature
both see the ciphertext. The encrypted input is bound to `encrypt.contract` (the consumer) and to
`settings.fhe.verifier` (the AirnodeVerifier that calls the consumer's callback), so it can't be replayed against a
different contract.

The existing `AirnodeVerifier` contract works unchanged — it verifies the signature and forwards the encrypted bytes to
the callback contract. See `contracts/src/examples/ConfidentialPriceFeed.sol` for an example consumer that registers FHE
handles and manages decryption access control.

See the [FHE Encryption docs](/concepts/fhe-encryption) for the full explanation.
