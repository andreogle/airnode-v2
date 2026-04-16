---
slug: /concepts/fhe-encryption
sidebar_position: 6
sidebar_label: FHE Encryption
---

# FHE Encryption

Fully Homomorphic Encryption (FHE) lets smart contracts compute on encrypted data without decrypting it. When combined
with Airnode, API data can be delivered to the chain encrypted — contracts can compare, aggregate, and act on the values
while they remain opaque to everyone except explicitly authorized addresses.

## Why FHE for oracle data

Without FHE, signed oracle data becomes public the moment it lands on-chain. The value is visible in calldata before
inclusion, enabling front-running. Anyone can read it from storage after inclusion, making it impossible to sell
exclusive data or keep valuations private.

FHE changes this. The data is encrypted before signing, and the signature covers the ciphertext. On-chain, the value
exists as an opaque handle — a reference to encrypted data stored by the FHE coprocessor. The coprocessor can perform
arithmetic and comparisons on the encrypted values, but only addresses granted permission by the consuming contract can
decrypt and read the plaintext.

This is different from regular encryption (like the [encrypted channel plugin](/docs/plugins)). Regular encryption
requires decrypting before doing anything useful. FHE lets the contract use the data while it's still encrypted — a
lending protocol can check `is price < liquidation threshold` and get a boolean result without either value ever being
revealed.

## How it works

FHE encryption is implemented as an Airnode [plugin](/docs/plugins) that intercepts the ABI-encoded response in the
`onBeforeSign` hook:

1. Airnode calls the upstream API and ABI-encodes the response as usual.
2. The `fhe-encrypt` plugin encrypts the encoded value with the chain's FHE public key using the
   [@zama-fhe/relayer-sdk](https://docs.zama.org/protocol/relayer-sdk-guides/fhevm-relayer) SDK, producing an encrypted
   input handle (`einput`) and a zero-knowledge proof (`inputProof`).
3. The plugin packs `abi.encode(einput, inputProof)` as the new `data` field.
4. Airnode signs the ciphertext — the EIP-191 signature proves the encrypted data is authentically from the API
   provider.
5. The client submits the signed response to `AirnodeVerifier` on-chain (the existing contract — no changes needed).
6. The callback contract unpacks the data, registers the FHE handle via `TFHE.asEuint256()`, and manages its own
   decryption access control.

```
API response → ABI encode → [fhe-encrypt plugin] → sign(ciphertext) → return to client
                                    ↓
                        encrypt with chain's FHE public key
                        pack (einput, inputProof) into data field
```

The existing `AirnodeVerifier` works unchanged — the `data` field is `bytes calldata`, and the verifier doesn't inspect
its contents. It just verifies the signature and forwards the bytes to the callback.

## Access control

Every encrypted value on-chain has an access control list (ACL) managed by the FHE coprocessor. The contract that
creates a handle is the only one that can grant or revoke access to it.

When the callback contract receives encrypted data from Airnode, it:

1. Registers the FHE handle — `TFHE.asEuint256(handleRef, inputProof)`
2. Grants itself access — `TFHE.allow(handle, address(this))`
3. Manages who else can decrypt through its own business logic

```solidity
// Only the contract owner can authorize decryption
function grantAccess(bytes32 endpointId, address account) external {
  require(msg.sender == OWNER, 'Only owner');
  TFHE.allow(prices[endpointId], account);
}
```

The submitter, the relayer, and other users have no ability to authorize themselves. Even if a malicious contract knows
the handle ID, it cannot call `TFHE.allow()` because only the handle's creator (the callback contract) has that
permission.

Decryption itself is performed by a distributed Key Management Service (KMS) — a set of nodes that hold shares of the
decryption key via threshold MPC. They check the on-chain ACL before cooperating to decrypt. No single node holds the
complete key.

## Configuration

### Plugin setup

The `fhe-encrypt` plugin lives in `examples/plugins/fhe-encrypt/` with its own `package.json` and
`@zama-fhe/relayer-sdk` dependency. Build it before use:

```bash
cd examples/plugins/fhe-encrypt
bun install
bun run build
```

Add it to your Airnode config:

```yaml
settings:
  plugins:
    - source: ./examples/plugins/fhe-encrypt/dist/index.js
      timeout: 30000
```

### Environment variables

| Variable               | Required | Description                                                                 |
| ---------------------- | -------- | --------------------------------------------------------------------------- |
| `FHE_NETWORK`          | No       | `'sepolia'` or `'mainnet'` — selects the chain preset. Default: `'sepolia'` |
| `FHE_API_KEY`          | No       | API key for Zama's relayer (not required for Sepolia testnet)               |
| `FHE_NETWORK_URL`      | Yes      | Ethereum JSON-RPC endpoint for the target chain (e.g. Sepolia RPC)          |
| `FHE_CONTRACT_ADDRESS` | Yes      | Contract that will receive the encrypted data                               |
| `AIRNODE_ADDRESS`      | Yes      | The airnode's address (binds encrypted inputs to signer)                    |

The preset (`FHE_NETWORK`) includes all Zama contract addresses, chain IDs, and relayer URLs for the target network. The
plugin fetches the chain's FHE public key from the relayer on first request and caches it for subsequent calls.

## Response format

The response has the same structure as a normal Airnode response. The `data` field contains the encrypted payload
instead of plaintext ABI-encoded data:

```json
{
  "airnode": "0x...",
  "endpointId": "0x...",
  "timestamp": 1711234567,
  "data": "0x...encrypted_handle_and_proof...",
  "signature": "0x..."
}
```

The `data` field is `abi.encode(bytes32 handleRef, bytes inputProof)`. The callback contract decodes it:

```solidity
(bytes32 handleRef, bytes memory inputProof) = abi.decode(data, (bytes32, bytes));
euint256 price = TFHE.asEuint256(handleRef, inputProof);
```

## Example consumer contract

An example `ConfidentialPriceFeed` contract is provided in
[`contracts/src/examples/`](https://github.com/api3dao/airnode-v2/tree/main/contracts/src/examples). It demonstrates:

- Receiving encrypted price data via the `AirnodeVerifier` callback pattern
- Registering FHE handles with the coprocessor
- Owner-controlled decryption access (grant and revoke)
- Timestamp monotonicity to reject stale data
- Airnode trust management

The contract uses an `ITFHE` interface for testability. On fhEVM-compatible chains, replace it with the real TFHE
library from [zama-ai/fhevm](https://github.com/zama-ai/fhevm).

## Use cases

**MEV-protected price feeds.** Price updates are encrypted in the mempool and on-chain. DeFi protocols compute
liquidations and swaps on encrypted values. Searchers cannot front-run because they cannot see the price.

**Paid data that stays private.** API providers sell premium data through Airnode's payment models. The callback
contract grants decryption access only to the buyer. Other users can see that data was delivered but not what it
contains.

**Confidential portfolio valuations.** Real-world asset protocols receive encrypted NAV per asset. Fund managers and
regulators get decrypt access. The public sees nothing, but contracts can still compute aggregates like
`TFHE.add(asset1, asset2)` on encrypted values.

**Sealed auctions with oracle reference pricing.** Airnode delivers an encrypted appraisal price. Bids are submitted
encrypted. The auction contract compares `TFHE.gt(bid, reservePrice)` without revealing either value.

## Limitations

- **Chain support.** FHE requires an fhEVM-compatible chain with the Zama coprocessor (Ethereum mainnet and Sepolia are
  supported). The plugin encrypts for a single target chain.
- **Throughput.** The Zama coprocessor currently handles ~20 TPS. High-frequency price feeds may hit this limit.
- **Encoded responses only.** The plugin operates on the `onBeforeSign` hook, which only fires for endpoints with
  `encoding` configured. Raw JSON responses are not encrypted (they are not submitted on-chain, so there is no privacy
  benefit).
- **Maturity.** The OpenZeppelin confidential contracts library is not yet formally audited. The Zama protocol is
  actively evolving.

## Comparison with encrypted channel

| Property                 | Encrypted channel plugin        | FHE encryption plugin                  |
| ------------------------ | ------------------------------- | -------------------------------------- |
| **Encryption type**      | ECIES (secp256k1 + AES-256-GCM) | Fully Homomorphic (TFHE)               |
| **On-chain computation** | No — must decrypt first         | Yes — compute on encrypted data        |
| **Access control**       | Requester's ephemeral key       | On-chain ACL per handle                |
| **Use case**             | Private HTTP transport          | Private on-chain data + computation    |
| **Chain requirement**    | Any EVM chain                   | fhEVM-compatible chains only           |
| **Dependency**           | `@noble/ciphers` (in core)      | `@zama-fhe/relayer-sdk` (plugin-local) |
