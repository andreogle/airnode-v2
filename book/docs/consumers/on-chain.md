---
slug: /consumers/on-chain
sidebar_position: 2
---

# On-Chain Integration

Airnode provides an on-chain contract for consuming signed data. The contract is permissionless -- anyone can submit
signed data, and it verifies the airnode's signature.

## AirnodeVerifier

The verifier is for one-shot data delivery. You fetch signed data from the airnode's HTTP server and submit it to the
AirnodeVerifier contract, which verifies the signature and forwards the data to your callback contract.

### Flow

1. Your off-chain client calls the airnode HTTP endpoint and receives signed data.
2. Your client calls `verifyAndFulfill()` on AirnodeVerifier with the signed data and your callback address.
3. AirnodeVerifier recovers the signer, checks replay protection, and calls your callback.
4. Your callback receives the data and acts on it.

### Consumer contract

Your contract receives the callback. `verifyAndFulfill` is **permissionless** (anyone can submit any valid
Airnode-signed payload and point the callback anywhere) and signed payloads are **public**, so your `fulfill` must run
four checks before trusting the data. A documented reference is
[`AirnodePriceConsumer.sol`](https://github.com/api3dao/airnode-v2/blob/main/contracts/src/examples/AirnodePriceConsumer.sol);
the essentials:

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
  require(attestedEndpointId == endpointId, 'Wrong endpoint'); // 3. the feed you trust (this also pins the encoding)
  require(attestedAt <= block.timestamp, 'Future timestamp'); // 4a. not from the future
  require(block.timestamp - attestedAt <= maxStaleness, 'Stale'); // 4b. fresh enough

  int256 price = abi.decode(data, (int256));
  // ...use price
}
```

(`requestHash` is `keccak256(endpointId, timestamp, data)` and is AirnodeVerifier's replay key — each unique payload can
only be fulfilled once, globally.)

### Security checklist

The single most likely place a consumer loses money is forgetting one of these. In `fulfill`:

- **`msg.sender == verifier`** — your contract does **not** verify the signature itself; it trusts that AirnodeVerifier
  did. So it must reject calls that didn't come from AirnodeVerifier — otherwise anyone can call `fulfill(...)` directly
  with fabricated arguments. This is the worst one to skip.
- **`airnode == trustedAirnode`** — AirnodeVerifier confirms the signature recovers to the supplied `airnode`, but that
  address is chosen by the submitter. Pin the specific Airnode you trust. (Check this even though you also check the
  endpoint ID — a rogue Airnode that knows the public endpoint-ID formula can sign under any endpoint ID.)
- **`endpointId == trustedEndpointId`** — one Airnode signs many endpoints. Without this, an attacker feeds you a
  different endpoint's data (a different asset, a feed with different encoding). The endpoint ID also commits to the
  endpoint's encoding spec, so pinning it pins the `abi.decode` shape you use.
- **Freshness** — `attestedAt <= block.timestamp` (reject future-dated, clock-skewed/manipulated timestamps) and
  `block.timestamp - attestedAt <= maxStaleness` (a signed payload never expires on its own — anyone can replay an old
  one forever).
- **Encoding** — `abi.decode` `data` with the exact type the endpoint produces. Don't assume `int256` for an endpoint
  you haven't pinned; an endpoint with open/requester-controlled encoding (`_type`/`_path`/`_times`) signs whatever
  shape the requester picked.

If a check fails, **revert** (or ignore) — and note that a revert inside `fulfill` does not revert AirnodeVerifier's
`verifyAndFulfill`: the request is still marked fulfilled (anti-griefing), your state just stays put.

### When to use

- Your dApp needs data on demand (user-initiated actions like swaps, mints, settlements).
- You want to pay gas only when data is actually consumed.
- You need arbitrary ABI-encoded data, not just a single numeric value.
