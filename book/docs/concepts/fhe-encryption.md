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

FHE encryption is built into the Airnode pipeline. Configure the relayer connection once under `settings.fhe`, then add
an `encrypt` block to any endpoint you want encrypted. The pipeline runs the encryption right after encoding and before
signing:

1. Airnode calls the upstream API and ABI-encodes the response as usual.
2. The pipeline encrypts the encoded integer with the chain's FHE public key using the
   [@zama-fhe/relayer-sdk](https://docs.zama.org/protocol/relayer-sdk-guides/fhevm-relayer) SDK, producing an
   encrypted-input handle and a zero-knowledge proof.
3. It replaces the `data` field with `abi.encode(bytes32 handle, bytes inputProof)`.
4. Airnode signs the ciphertext — the EIP-191 signature proves the encrypted data is authentically from the API
   provider. (`onBeforeSign` plugins also see the ciphertext, not the plaintext.)
5. The client submits the signed response to `AirnodeVerifier` on-chain (the existing contract — no changes needed).
6. `AirnodeVerifier` verifies the signature and forwards the bytes to the consumer's callback, which unpacks the data,
   registers the FHE handle via `FHE.fromExternal(handle, inputProof)`, and manages its own decryption access control.

```
API response → ABI encode → FHE encrypt → sign(ciphertext) → return to client
                                 ↓
                  encrypt with chain's FHE public key
                  bound to (consumer contract, AirnodeVerifier)
                  pack (handle, inputProof) into data field
```

The existing `AirnodeVerifier` works unchanged — the `data` field is `bytes calldata`, and the verifier doesn't inspect
its contents.

### Address binding

An fhEVM encrypted input is cryptographically bound to two addresses, fixed at encryption time:

- **The consumer contract** — the contract that calls `FHE.fromExternal` to ingest the value. This is
  `endpoint.encrypt.contract`. A signed ciphertext can only be ingested by that contract.
- **The caller of the consumer** — the address that is `msg.sender` when the consumer ingests the value. In the Airnode
  flow the consumer's callback is invoked by `AirnodeVerifier`, so this is the `AirnodeVerifier` address —
  `settings.fhe.verifier`.

The airnode encrypts before anyone submits on-chain, so it can't bind to the requester's address — and it doesn't need
to. Both bound addresses are operator-controlled. The one constraint this places on requesters: they must submit through
the `AirnodeVerifier` deployment the operator configured; routing through a different one will make `FHE.fromExternal`
revert.

## Access control

Every encrypted value on-chain has an access control list (ACL) managed by the FHE coprocessor. The contract that
creates a handle is the only one that can grant or revoke access to it.

When the callback contract receives encrypted data from Airnode, it:

1. Registers the FHE handle — `FHE.fromExternal(handleRef, inputProof)`
2. Grants itself access — `FHE.allow(handle, address(this))`
3. Manages who else can decrypt through its own business logic

```solidity
// Only the contract owner can authorize decryption
function grantAccess(bytes32 endpointId, address account) external {
  require(msg.sender == OWNER, 'Only owner');
  FHE.allow(prices[endpointId], account);
}
```

The submitter, the relayer, and other users have no ability to authorize themselves. Even if a malicious contract knows
the handle ID, it cannot call `FHE.allow()` because only the handle's creator (the callback contract) has that
permission.

Decryption itself is performed by a distributed Key Management Service (KMS) — a set of nodes that hold shares of the
decryption key via threshold MPC. They check the on-chain ACL before cooperating to decrypt. No single node holds the
complete key.

## Configuration

### Relayer settings

```yaml
settings:
  fhe:
    network: sepolia # 'sepolia' or 'mainnet' — selects the Zama chain preset
    rpcUrl: ${FHE_RPC_URL} # Ethereum JSON-RPC endpoint for the target chain
    verifier: '0x...' # AirnodeVerifier deployed on that chain
    # apiKey: ${FHE_API_KEY}  # optional — Zama hosted relayer key (not needed on Sepolia)
```

| Field      | Required | Description                                                                                         |
| ---------- | -------- | --------------------------------------------------------------------------------------------------- |
| `network`  | Yes      | `sepolia` or `mainnet` — the preset includes Zama's contract addresses, chain IDs, and relayer URLs |
| `rpcUrl`   | Yes      | Ethereum JSON-RPC endpoint for the chain (used to read the FHE ACL/KMS contracts)                   |
| `verifier` | Yes      | `AirnodeVerifier` address on that chain — the encrypted input is bound to it (see Address binding)  |
| `apiKey`   | No       | API key for Zama's hosted relayer (not required for Sepolia testnet)                                |

The chain's FHE public key is fetched from the relayer on first use and cached for subsequent requests.

### Per-endpoint opt-in

Add an `encrypt` block to any endpoint. The endpoint must have an `encoding` block whose `type` is `int256` or `uint256`
with a `path` set — FHE integers are unsigned, so the encoded value must be a single non-negative integer that fits in
the chosen ciphertext type.

```yaml
endpoints:
  - name: coinPrice
    path: /simple/price
    encoding:
      type: int256
      path: $.ethereum.usd
      times: '1e18'
    encrypt:
      type: euint256 # euint8 | euint16 | euint32 | euint64 | euint128 | euint256
      contract: '0x...' # the consumer contract that will ingest this value
```

`encrypt.contract` is fixed by the operator — requesters cannot override it, and the endpoint ID commits to both the
ciphertext type and the consumer address.

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

The `data` field is `abi.encode(bytes32 handle, bytes inputProof)`. The callback contract decodes it:

```solidity
(bytes32 handle, bytes memory inputProof) = abi.decode(data, (bytes32, bytes));
euint256 price = FHE.fromExternal(handle, inputProof);
```

## Example consumer contract

An example `ConfidentialPriceFeed` contract is provided in
[`contracts/src/examples/`](https://github.com/api3dao/airnode-v2/tree/main/contracts/src/examples). It demonstrates:

- Receiving encrypted price data via the `AirnodeVerifier` callback pattern
- Registering FHE handles with the coprocessor
- Owner-controlled decryption access (grant and revoke)
- Timestamp monotonicity to reject stale data
- Airnode trust management

The contract uses an `ITFHE` interface for testability. On fhEVM-compatible chains, replace it with the real `FHE`
library from [zama-ai/fhevm-solidity](https://github.com/zama-ai/fhevm-solidity) — and make sure the airnode encrypted
the input with `settings.fhe.verifier` set to the `AirnodeVerifier` address (it's the `msg.sender` of the callback, so
it's the address the input proof must commit to).

## Use cases

**MEV-protected price feeds.** Price updates are encrypted in the mempool and on-chain. DeFi protocols compute
liquidations and swaps on encrypted values. Searchers cannot front-run because they cannot see the price.

**Paid data that stays private.** API providers sell premium data through Airnode's payment models. The callback
contract grants decryption access only to the buyer. Other users can see that data was delivered but not what it
contains.

**Confidential portfolio valuations.** Real-world asset protocols receive encrypted NAV per asset. Fund managers and
regulators get decrypt access. The public sees nothing, but contracts can still compute aggregates like
`FHE.add(asset1, asset2)` on encrypted values.

**Sealed auctions with oracle reference pricing.** Airnode delivers an encrypted appraisal price. Bids are submitted
encrypted. The auction contract compares `FHE.gt(bid, reservePrice)` without revealing either value.

## Limitations

- **Chain support.** FHE requires an fhEVM-compatible chain with the Zama coprocessor (Ethereum mainnet and Sepolia are
  supported). Each endpoint encrypts for a single target chain.
- **One consumer per endpoint.** The encrypted input is bound to `encrypt.contract`, so an endpoint feeds exactly one
  consumer contract. If several contracts need the same feed, deploy a shared registry contract (the
  `ConfidentialPriceFeed` pattern) that re-shares the handle via `FHE.allow`, or define one endpoint per consumer.
- **Throughput.** The Zama coprocessor currently handles a limited number of input verifications per second.
  High-frequency price feeds may hit this limit.
- **Numeric, encoded responses only.** `encrypt` requires an `encoding` block producing a single `int256`/`uint256`
  value. Raw JSON responses cannot be encrypted (they are not submitted on-chain, so there is no privacy benefit).
- **Maturity.** The Zama protocol and the surrounding contract libraries are actively evolving.

## Comparison with encrypted channel

| Property                 | Encrypted channel plugin        | FHE encryption (built-in)           |
| ------------------------ | ------------------------------- | ----------------------------------- |
| **Encryption type**      | ECIES (secp256k1 + AES-256-GCM) | Fully Homomorphic (TFHE)            |
| **On-chain computation** | No — must decrypt first         | Yes — compute on encrypted data     |
| **Access control**       | Requester's ephemeral key       | On-chain ACL per handle             |
| **Use case**             | Private HTTP transport          | Private on-chain data + computation |
| **Chain requirement**    | Any EVM chain                   | fhEVM-compatible chains only        |
| **Where it lives**       | Example plugin                  | Core pipeline (`settings.fhe`)      |
