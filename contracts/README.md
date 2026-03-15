# Airnode v2 Contracts

## Overview

Two contracts. One verifies signed data and forwards it to a callback (pull). The other stores signed data feeds
on-chain for contracts to read (push). Both are Vyper 0.4+, targeting the **prague** EVM version.

| Contract             | Purpose                                               | Use case               |
| -------------------- | ----------------------------------------------------- | ---------------------- |
| `AirnodeVerifier.vy` | Verify signature, prevent replay, forward to callback | One-shot data delivery |
| `AirnodeDataFeed.vy` | Verify signature, store latest value, serve reads     | Continuous data feeds  |

## Architecture

Airnode is an HTTP server. It calls upstream APIs, signs the responses, and returns them to clients. The airnode never
touches the chain. These contracts let clients bring signed data on-chain.

```
Client → HTTP request → Airnode → upstream API → sign response → HTTP response
                                                                      │
                                    ┌─────────────────────────────────┘
                                    │
                              ┌─────┴─────┐
                              │ On-chain  │
           ┌──────────────────┤           ├──────────────────┐
           │                  └───────────┘                  │
    Pull (one-shot)                                   Push (data feed)
           │                                                 │
  AirnodeVerifier                                   AirnodeDataFeed
  verify → forward                                  verify → store
  to callback                                       → read latest
```

### Signature format

Both contracts verify the same signature:

```
message_hash = keccak256(encodePacked(endpoint_id, timestamp, data))
signature = EIP-191 personal sign over message_hash
```

The fields:

- **endpoint_id** — a specification-bound hash committing to the API URL, path, method, parameters, and encoding rules.
  Two independent airnodes serving the same API with the same config produce the same endpoint ID.
- **timestamp** — unix timestamp (seconds) of when the data was produced.
- **data** — ABI-encoded response. For data feeds, this is a single `int256` in 32 bytes. For the verifier, it can be
  arbitrary bytes up to 4096.

The endpoint ID is a separate field (not buried inside another hash) so future on-chain verifiers — including TLS proof
verifiers — can inspect it directly and check it against a proven API specification.

---

## AirnodeVerifier

**Location:** `src/AirnodeVerifier.vy`

Verifies an airnode's signature and forwards the data to a callback contract. This is the on-chain primitive for the
pull path — a client gets signed data from the HTTP server and submits it to trigger logic in their own contract.

### How it works

1. Anyone calls `verify_and_fulfill()` with signed data and a callback target.
2. The contract recovers the signer from the signature.
3. If the signer matches the provided airnode address, and the data hasn't been submitted before (replay protection),
   the data is forwarded to the callback contract.
4. If the callback reverts, the fulfillment is still recorded. This prevents griefing where a callback intentionally
   reverts to block fulfillment.

### Function

```vyper
verify_and_fulfill(
    airnode: address,          # expected signer
    endpoint_id: bytes32,      # specification-bound endpoint hash
    timestamp: uint256,        # data timestamp
    data: Bytes[4096],         # ABI-encoded response (up to 4KB)
    signature: Bytes[65],      # EIP-191 personal signature
    callback_address: address, # contract to forward data to
    callback_selector: bytes4, # function selector on the callback
)
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

The `requestHash` (which is the `message_hash` from the signature) serves as the replay key. Each unique combination of
`(endpoint_id, timestamp, data)` can only be fulfilled once. The `fulfilled` mapping is public — anyone can check
whether a particular hash has been submitted.

### Trust model

- **Permissionless.** Anyone can submit signed data — client, relayer, or the airnode itself. The contract doesn't care
  who pays gas.
- **No airnode registry.** The contract doesn't know which airnodes are legitimate. It only verifies the math: "did this
  address sign this data?" The callback contract is responsible for checking whether it trusts the airnode address.
- **Callback failure is safe.** If the callback reverts, the fulfillment is still recorded and the event is emitted. The
  submitter's transaction succeeds. This prevents a malicious callback from blocking fulfillment.

### Writing a consumer contract

Your contract receives the callback and decides what to do with the data. At minimum, check that you trust the airnode:

```solidity
contract MyConsumer {
  address public trustedAirnode;
  int256 public lastPrice;

  constructor(address _airnode) {
    trustedAirnode = _airnode;
  }

  function fulfill(
    bytes32, // requestHash (unused here)
    address airnode,
    bytes32, // endpointId (unused here)
    uint256, // timestamp (unused here)
    bytes calldata data
  ) external {
    require(airnode == trustedAirnode, 'Untrusted airnode');
    lastPrice = abi.decode(data, (int256));
  }
}
```

---

## AirnodeDataFeed

**Location:** `src/AirnodeDataFeed.vy`

Stores and serves signed data feeds. This is the on-chain primitive for the push path — a relayer reads signed data from
the airnode's HTTP server and pushes it on-chain so other contracts can read the latest value at any time.

### Concepts

**Beacon** — a single data point from a single airnode for a single endpoint.

```
beacon_id = keccak256(encodePacked(airnode_address, endpoint_id))
```

Two independent airnodes serving the same endpoint produce different beacon IDs (different airnode address) but the same
endpoint ID (same API spec). A beacon stores `(int224 value, uint32 timestamp)` — one storage slot.

**Beacon set** — a median aggregation of multiple beacons. Useful for getting a robust price from multiple independent
airnodes. The median is computed on-chain when `update_beacon_set()` is called.

```
beacon_set_id = keccak256(abi.encode(beacon_ids))
```

### Functions

**Updating:**

```vyper
update_beacon(
    airnode: address,       # the signer
    endpoint_id: bytes32,   # endpoint hash
    timestamp: uint256,     # data timestamp
    data: Bytes[32],        # ABI-encoded int256 (must be within int224 range)
    signature: Bytes[65],   # EIP-191 personal signature
) -> bytes32               # returns the beacon_id
```

```vyper
update_beacon_set(
    beacon_ids: DynArray[bytes32, 21]  # constituent beacon IDs (2-21)
) -> bytes32                           # returns the beacon_set_id
```

**Reading:**

```vyper
read_beacon(beacon_id: bytes32) -> (int224, uint32)  # value, timestamp
```

Beacons and beacon sets are read with the same function — both are stored in the same mapping.

**Derivation (pure, no state):**

```vyper
derive_beacon_id(airnode: address, endpoint_id: bytes32) -> bytes32
derive_beacon_set_id(beacon_ids: DynArray[bytes32, 21]) -> bytes32
```

### Data constraints

- **Data must be exactly 32 bytes** — one ABI-encoded `int256`.
- **Value must fit in `int224`** — the range is roughly ±1.3 × 10^67. This matches the API3 data feed format and packs
  value + timestamp into a single storage slot.
- **Timestamps must increase** — an update with a timestamp equal to or older than the stored value is rejected. This
  prevents stale data from overwriting fresh data.
- **Timestamps can't be more than 5 minutes in the future** — handles clock drift while preventing far-future timestamp
  attacks that could lock a beacon via timestamp monotonicity.
- **All feeds use 18 decimals** — ETH at $3000.50 is stored as `3000500000000000000000`.

### Median aggregation

Beacon sets compute the median of their constituent beacon values and timestamps. The median is calculated via insertion
sort, which is efficient for the small arrays involved (max 21 beacons). The lower-middle element is chosen for even
counts.

A beacon set update:

1. Reads all constituent beacons (all must be initialized).
2. Sorts values, takes the median.
3. Sorts timestamps, takes the median.
4. Stores the result under the beacon set ID.
5. Reverts if the result is identical to the currently stored value (no-op protection).

### Trust model

- **Permissionless updates.** Anyone can push a valid signed update. The contract only checks the airnode's signature.
- **No airnode registry.** The contract doesn't decide which airnodes are trustworthy. The consumer chooses which beacon
  IDs to read — that choice is their trust decision.
- **Timestamp monotonicity.** Each beacon's timestamp can only increase. A relayer cannot overwrite fresh data with
  stale data, even with a valid signature.

### Reading a data feed

Consumer contracts read the latest value by calling `read_beacon()` with a known beacon ID:

```solidity
interface IAirnodeDataFeed {
  function read_beacon(bytes32 beaconId) external view returns (int224 value, uint32 timestamp);
}

contract MyDeFiProtocol {
  IAirnodeDataFeed public dataFeed;
  bytes32 public ethUsdBeaconId;

  function getPrice() external view returns (int224) {
    (int224 value, uint32 timestamp) = dataFeed.read_beacon(ethUsdBeaconId);
    require(value > 0, 'Invalid price');
    require(timestamp + 24 hours > block.timestamp, 'Stale price');
    return value;
  }
}
```

---

## How this differs from Api3ServerV1

The existing API3 data feed infrastructure (`Api3ServerV1`) and Airnode v2's contracts serve different models. This
section explains the key differences for readers familiar with the current system.

### Architecture

| Aspect                         | Api3ServerV1                                | Airnode v2                                      |
| ------------------------------ | ------------------------------------------- | ----------------------------------------------- |
| **Who submits on-chain?**      | Airseeker (API3-operated push oracle)       | Anyone — client, relayer, or the airnode itself |
| **Airnode touches the chain?** | Yes (airnode-feed signs, Airseeker pushes)  | No. Airnode is a pure HTTP server               |
| **On-chain request-response?** | No (removed in ServerV1; was in AirnodeRrp) | Yes, via AirnodeVerifier callback               |
| **Data feed storage?**         | Yes, `(int224, uint32)` per beacon          | Yes, same format in AirnodeDataFeed             |
| **Contracts**                  | ~15 contracts across deep inheritance chain | 2 flat contracts, no inheritance                |
| **Language**                   | Solidity 0.8.17                             | Vyper 0.4+                                      |

### Signature format

Api3ServerV1 signs `keccak256(abi.encodePacked(templateId, timestamp, data))` where
`templateId = keccak256(endpointId, encodedParameters)`. The `endpointId` is a name-based hash
(`keccak256(oisTitle, endpointName)`) that says nothing about what API is actually called.

Airnode v2 signs `keccak256(encodePacked(endpointId, timestamp, data))` where the `endpointId` is a
**specification-bound hash** of the API URL, path, method, parameters, and encoding rules. This means:

- The endpoint ID is a verifiable commitment to the API spec, not just a label.
- Two independent operators serving the same API produce the same endpoint ID.
- Future TLS proof verifiers can check the endpoint ID against a proven HTTP request.
- The endpoint ID is a top-level field in the signature, not buried inside a `templateId` hash. On-chain contracts can
  inspect it directly.

The signatures are **not compatible** — data signed by Airnode v2 cannot be submitted to Api3ServerV1, and vice versa.

### What Api3ServerV1 has that we don't

| Feature                     | Purpose                                                          | Our approach                                                                            |
| --------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **dAPI names**              | Human-readable name → beacon ID mapping, managed by DAO          | Not built. Can be added as a separate contract later                                    |
| **Proxy factory**           | Deploys per-dAPI proxy contracts for consumers                   | Not built. Consumers read `AirnodeDataFeed` directly                                    |
| **OEV extension**           | Separate feed for auction winners to update ahead of base feed   | Not built. OEV is an operational layer, not a contract concern for individual operators |
| **Access control registry** | Role-based permissions across contracts                          | Not needed. Two permissionless contracts with no admin functions                        |
| **Airseeker registry**      | On-chain config for the push oracle (deviation thresholds, URLs) | Off-chain. Relayer reads config from the airnode's HTTP server                          |
| **Api3 Market**             | On-chain subscription marketplace for data feeds                 | Not built. Monetization is at the HTTP layer (API keys, x402)                           |

These are all additive features that can be layered on top without changing the base contracts. The base contracts are
intentionally minimal — verify signatures, store values, forward callbacks. Everything else is either off-chain or a
future extension.

### What we have that Api3ServerV1 doesn't

| Feature                              | Purpose                                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Pull path (AirnodeVerifier)**      | One-shot signature verification with callback forwarding. Api3ServerV1 is push-only — there is no way for a contract to receive arbitrary signed data via callback |
| **Arbitrary data in callbacks**      | The verifier accepts up to 4KB of any ABI-encoded data. Api3ServerV1 only stores a single `int224`                                                                 |
| **Specification-bound endpoint IDs** | The endpoint ID commits to the full API spec. Enables cross-operator comparability and future TLS proof verification                                               |
| **No admin functions**               | Both contracts are fully permissionless with no owner, no roles, no configuration. Api3ServerV1 has access control for dAPI name setting, OEV management, and more |

### Consumer integration

**Api3ServerV1:** Consumers read through a per-dAPI proxy contract (`Api3ReaderProxyV1`). The proxy is deployed by the
Api3 Market when the consumer buys a subscription. The proxy implements `IApi3ReaderProxy` with a single `read()`
function that returns `(int224 value, uint32 timestamp)`.

**Airnode v2:** Consumers call `read_beacon(beaconId)` directly on the `AirnodeDataFeed` contract. Same return type:
`(int224, uint32)`. No proxy, no subscription, no marketplace. The consumer chooses which beacon ID to read — that's
their trust decision.

For pull (one-shot data), consumers deploy a callback contract and anyone submits signed data to the `AirnodeVerifier`,
which forwards it. There is no equivalent in Api3ServerV1.

### Data feed access and monetization

Api3ServerV1 data is public on-chain. The "access control" is economic — consumers buy subscriptions through the Api3
Market, and the resulting proxy contract is tied to their dApp ID for OEV reward distribution. Anyone can read the raw
storage slots directly.

Airnode v2 takes the same pragmatic view: on-chain data is public. Monetization happens at the HTTP layer. Operators
charge for real-time API access (API keys, x402 payment) and can optionally delay public data feed updates via the
`cache.delay` config to create a time-based access tier. Real-time data is a paid service. Delayed data is a public
good.

---

## Setup

### Prerequisites

| Tool                                  | Version  | Install                                                     |
| ------------------------------------- | -------- | ----------------------------------------------------------- |
| [Foundry](https://book.getfoundry.sh) | >= 1.0   | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| [Vyper](https://docs.vyperlang.org)   | >= 0.4.0 | `pip install vyper`                                         |

### Install dependencies

```bash
cd contracts
forge install pcaversaccio/snekmate
```

[snekmate](https://github.com/pcaversaccio/snekmate) provides ECDSA signature recovery and EIP-191 message hashing for
Vyper.

### How Vyper compilation works

Foundry cannot resolve Vyper imports across packages. The workaround:

1. `foundry.toml` skips `.vy` and `.vyi` files: `skip = ["src/**/*.vy", "src/**/*.vyi"]`
2. Tests inherit from `test/VyperDeploy.sol` and call `deployVyper("ContractName")`
3. `VyperDeploy` FFI-calls `vyper` directly with `-p lib/snekmate/src` to resolve snekmate imports
4. The compiled bytecode is returned and deployed via `CREATE`

---

## Testing

```bash
forge test         # run all tests
forge test -vvv    # with gas and traces
forge test --match-path test/AirnodeVerifier.t.sol   # one file
forge test --match-test test_fulfills_with_valid      # one test
```

### Test files

| File                              | Type      | What it covers                                                 |
| --------------------------------- | --------- | -------------------------------------------------------------- |
| `AirnodeVerifier.t.sol`           | Unit      | Fulfillment, replay, wrong airnode, tampered data, reverting   |
|                                   |           | callback, uniqueness across data and timestamps (8 tests)      |
| `AirnodeVerifier.invariant.t.sol` | Invariant | Callback count matches fulfillments across random sequences    |
| `AirnodeVerifier.symbolic.t.sol`  | Symbolic  | Fulfilled flag always set, replay always reverts (Halmos)      |
| `AirnodeDataFeed.t.sol`           | Unit      | Beacon CRUD, timestamps, int224 bounds, beacon sets, median,   |
|                                   |           | negative values, ID derivation (18 tests)                      |
| `AirnodeDataFeed.invariant.t.sol` | Invariant | Timestamp ghost state matches storage, future timestamp bounds |
| `AirnodeDataFeed.symbolic.t.sol`  | Symbolic  | Value/timestamp storage correctness, stale reverts, ID         |
|                                   |           | determinism, different airnodes produce different IDs (Halmos) |

**Unit tests** verify specific scenarios with known inputs. **Invariant tests** verify properties across random
sequences of operations — the fuzzer calls handler functions in random order and checks that global invariants hold
after each sequence. **Symbolic tests** prove properties hold for ALL possible inputs using Halmos — run them with
`halmos --contract AirnodeVerifierSymbolicTest` or `halmos --contract AirnodeDataFeedSymbolicTest`.

### Test helpers

| File               | Purpose                                             |
| ------------------ | --------------------------------------------------- |
| `VyperDeploy.sol`  | FFI-based Vyper compilation and deployment          |
| `MockCallback.sol` | Records callback arguments for assertion.           |
|                    | Also includes `RevertingCallback` for failure tests |

---

## File layout

```
contracts/
  src/
    AirnodeVerifier.vy                  Signature verification + callback forwarding
    AirnodeDataFeed.vy                  Beacon storage + median aggregation
  test/
    AirnodeVerifier.t.sol               Unit tests
    AirnodeVerifier.invariant.t.sol     Invariant (stateful fuzz) tests
    AirnodeVerifier.symbolic.t.sol      Symbolic execution tests (Halmos)
    AirnodeDataFeed.t.sol               Unit tests
    AirnodeDataFeed.invariant.t.sol     Invariant (stateful fuzz) tests
    AirnodeDataFeed.symbolic.t.sol      Symbolic execution tests (Halmos)
    MockCallback.sol                    Mock + reverting callback contracts
    VyperDeploy.sol                     Vyper compilation via FFI
  lib/
    forge-std/                          Foundry standard library
    snekmate/                           ECDSA + EIP-191 for Vyper
  foundry.toml                          Foundry config (prague EVM, FFI enabled)
```
