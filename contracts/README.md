# Airnode v2 Contracts

## Overview

One contract that verifies signed data and forwards it to a callback (pull). Solidity, targeting the **prague** EVM
version.

| Contract              | Purpose                                               | Use case               |
| --------------------- | ----------------------------------------------------- | ---------------------- |
| `AirnodeVerifier.sol` | Verify signature, prevent replay, forward to callback | One-shot data delivery |

## Architecture

Airnode is an HTTP server. It calls upstream APIs, signs the responses, and returns them to clients. The airnode never
touches the chain. This contract lets clients bring signed data on-chain.

```
Client → HTTP request → Airnode → upstream API → sign response → HTTP response
                                                                      │
                                    ┌─────────────────────────────────┘
                                    │
                              ┌─────┴─────┐
                              │ On-chain  │
                              │           │
                         AirnodeVerifier
                         verify → forward
                         to callback
```

### Signature format

The contract verifies:

```
messageHash = keccak256(encodePacked(endpointId, timestamp, data))
signature = EIP-191 personal sign over messageHash
```

The fields:

- **endpointId** — a specification-bound hash committing to the API URL, path, method, parameters, and encoding rules.
  Two independent airnodes serving the same API with the same config produce the same endpoint ID.
- **timestamp** — unix timestamp (seconds) of when the data was produced.
- **data** — the signed payload: an ABI-encoded value, an FHE ciphertext, or `keccak256` of the raw JSON response. The
  contract treats it as opaque `bytes` and forwards it to the callback unchanged (no size limit on-chain; the HTTP
  request body is capped at 64 KB by the server).

The endpoint ID is a separate field (not buried inside another hash) so future on-chain verifiers — including TLS proof
verifiers — can inspect it directly and check it against a proven API specification.

---

## AirnodeVerifier

**Location:** `src/AirnodeVerifier.sol`

Verifies an airnode's signature and forwards the data to a callback contract. This is the on-chain primitive for the
pull path — a client gets signed data from the HTTP server and submits it to trigger logic in their own contract.

### How it works

1. Anyone calls `verifyAndFulfill()` with signed data and a callback target.
2. The contract recovers the signer from the signature.
3. If the signer matches the provided airnode address, and the data hasn't been submitted before (replay protection),
   the data is forwarded to the callback contract.
4. If the callback reverts, the fulfillment is still recorded. This prevents griefing where a callback intentionally
   reverts to block fulfillment.

### Function

```solidity
function verifyAndFulfill(
    address airnode,          // expected signer
    bytes32 endpointId,       // specification-bound endpoint hash
    uint256 timestamp,        // data timestamp
    bytes calldata data,      // signed payload (opaque bytes — ABI value, FHE ciphertext, or JSON hash)
    bytes calldata signature, // EIP-191 personal signature
    address callbackAddress,  // contract to forward data to
    bytes4 callbackSelector   // function selector on the callback
) external
```

The callback receives:

```solidity
function fulfill(
  bytes32 requestHash, // keccak256(endpointId, timestamp, data) — unique per submission
  address airnode, // the signer's address
  bytes32 endpointId, // which API endpoint produced this data
  uint256 timestamp, // when the data was produced
  bytes calldata data // the ABI-encoded response
) external;
```

### Replay protection

The `requestHash` (which is the `messageHash` from the signature) serves as the replay key. Each unique combination of
`(endpointId, timestamp, data)` can only be fulfilled once. The `fulfilled` mapping is public — anyone can check whether
a particular hash has been submitted.

### Trust model

- **Permissionless.** Anyone can submit signed data — client, relayer, or the airnode itself. The contract doesn't care
  who pays gas.
- **No airnode registry.** The contract doesn't know which airnodes are legitimate. It only verifies the math: "did this
  address sign this data?" The callback contract is responsible for checking whether it trusts the airnode address.
- **Callback failure is safe.** If the callback reverts, the fulfillment is still recorded and the event is emitted. The
  submitter's transaction succeeds. This prevents a malicious callback from blocking fulfillment.

### Writing a consumer contract

Your contract receives the callback. Because `verifyAndFulfill` is **permissionless** and signed payloads are
**public**, a consumer must run four checks — see `src/examples/AirnodePriceConsumer.sol` for a documented reference.
The essentials:

```solidity
function fulfill(
  bytes32 requestHash,
  address attestedAirnode,
  bytes32 attestedEndpointId,
  uint256 attestedAt,
  bytes calldata data
) external {
  require(msg.sender == verifier, 'Not the verifier'); // 1. only AirnodeVerifier checked the signature
  require(attestedAirnode == airnode, 'Untrusted airnode'); // 2. the Airnode you trust
  require(attestedEndpointId == endpointId, 'Wrong endpoint'); // 3. the feed you trust (pins the encoding)
  require(attestedAt <= block.timestamp, 'Future timestamp'); // 4a. not from the future
  require(block.timestamp - attestedAt <= maxStaleness, 'Stale'); // 4b. fresh enough

  int256 price = abi.decode(data, (int256));
  // ...use price
}
```

Dropping check **1** is the worst mistake — without it anyone can call `fulfill(...)` directly with made-up arguments,
since the consumer itself never verifies a signature. Dropping **2** or **3** lets an attacker feed you a different
Airnode's (or a different endpoint's) data. Dropping **4** lets anyone replay an old signed payload forever.

---

## Setup

### Prerequisites

| Tool                                  | Version | Install                                                     |
| ------------------------------------- | ------- | ----------------------------------------------------------- |
| [Foundry](https://book.getfoundry.sh) | >= 1.0  | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |

### Install dependencies

```bash
cd contracts
forge install
```

---

## Testing

```bash
forge test         # run all tests
forge test -vvv    # with gas and traces
forge test --match-path test/AirnodeVerifier.t.sol   # one file
forge test --match-test test_fulfills_with_valid      # one test
```

### Test files

| File                              | Type      | What it covers                                               |
| --------------------------------- | --------- | ------------------------------------------------------------ |
| `AirnodeVerifier.t.sol`           | Unit      | Fulfillment, replay, wrong airnode, tampered data, reverting |
|                                   |           | callback, uniqueness across data and timestamps (8 tests)    |
| `AirnodeVerifier.invariant.t.sol` | Invariant | Callback count matches fulfillments across random sequences  |
| `AirnodeVerifier.symbolic.t.sol`  | Symbolic  | Fulfilled flag always set, replay always reverts (Halmos)    |

**Unit tests** verify specific scenarios with known inputs. **Invariant tests** verify properties across random
sequences of operations — the fuzzer calls handler functions in random order and checks that global invariants hold
after each sequence. **Symbolic tests** prove properties hold for ALL possible inputs using Halmos — run them with
`halmos --contract AirnodeVerifierSymbolicTest`.

### Test helpers

| File               | Purpose                                             |
| ------------------ | --------------------------------------------------- |
| `MockCallback.sol` | Records callback arguments for assertion.           |
|                    | Also includes `RevertingCallback` for failure tests |

---

## File layout

```
contracts/
  src/
    AirnodeVerifier.sol                 Signature verification + callback forwarding
    examples/
      AirnodePriceConsumer.sol          Reference consumer (the four required checks)
      ConfidentialPriceFeed.sol         FHE-ciphertext consumer (ingests an encrypted value)
      ITFHE.sol                         Minimal fhEVM interface used by the FHE example
  test/
    AirnodeVerifier.{t,invariant.t,symbolic.t}.sol     Unit / invariant / symbolic tests
    AirnodePriceConsumer.t.sol          Consumer tests (the four checks, out-of-order, fuzz)
    ConfidentialPriceFeed.{t,invariant.t,symbolic.t}.sol
    MockCallback.sol / MockTFHE.sol     Test doubles
  lib/
    forge-std/                          Foundry standard library
  foundry.toml                          Foundry config (prague EVM)
```
