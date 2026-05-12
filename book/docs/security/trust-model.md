---
slug: /security/trust-model
sidebar_position: 1
---

# Trust Model

Understanding what you are trusting when you consume data from an airnode.

## First-party oracle model

Airnode is designed around the **first-party oracle** principle: the entity that operates the API also operates the
airnode. When CoinGecko runs an airnode serving CoinGecko's API, the signature on every response traces directly back to
the data source. There is no intermediary oracle network, no third-party relaying the data, no trust gap between the
signer and the source.

This is important because it means the trust relationship is the same on-chain as it is off-chain. If you already trust
CoinGecko's API for off-chain use, an airnode operated by CoinGecko extends that exact same trust on-chain. The
signature is the API provider's signature.

### Why first-party matters

With a third-party oracle (someone other than the API provider running the node), consumers must trust that the
operator:

- Is actually calling the API they claim and not fabricating or caching responses
- Has legitimate access to the API and is not violating terms of service
- Is not modifying, delaying, or selectively omitting data
- Will keep the node running and the API credentials current

None of these properties can be verified on-chain today. The endpoint ID commits to _what_ API should be called, but it
does not prove the operator is actually calling it. DNS identity verification proves _who_ controls a domain, but a
third-party operator would only prove their own domain -- not the API provider's.

**First-party operation eliminates this entire class of trust assumptions.** The API provider has no incentive to
fabricate responses to their own API, already has legitimate access, and controls the infrastructure end-to-end.

Consumers should prefer airnodes operated by the API provider and verify this via
[DNS identity verification](/docs/security/identity-verification). If an airnode's identity cannot be traced to the API
provider's domain, treat it with the same skepticism you would apply to any unverified data source.

## What you are trusting

### 1. The airnode operator is calling the API they claim

The endpoint ID is a specification-bound hash that commits to the API URL, path, method, parameters, and encoding rules.
You can recompute the endpoint ID from the operator's published config and confirm it matches what you are integrating
against — this is a verifiable commitment to the configuration, but not on its own proof that the airnode is actually
running that config. With a first-party airnode, this is not a concern: the API provider has no reason to misrepresent
calls to their own API. TLS proofs close the remaining gap by attesting that each response really did come from the
declared HTTPS endpoint.

### 2. The airnode's private key is secure

The signature proves the airnode endorsed this data. If the private key is compromised, an attacker can sign arbitrary
data. Operators should use dedicated keys (not general-purpose wallets), store them securely (HSM, encrypted at rest),
and rotate them if exposure is suspected.

### 3. The data is genuine

The first-party trust model means the API provider is already trusted. If you use CoinGecko's price API off-chain, you
trust CoinGecko. Airnode extends that trust on-chain -- the data is signed by the API provider's key, not by a
third-party oracle network.

For higher assurance, use a quorum of multiple independent first-party airnodes -- each operated by a different API
provider serving comparable data. An attacker would need to compromise a majority of providers to manipulate the result.

## How trust is established

### DNS identity verification (ERC-7529)

Operators prove their identity by setting a DNS TXT record that associates their domain with their airnode address. This
proves **who** operates the airnode -- the entity controlling `api.coingecko.com` has explicitly claimed this airnode
address. See [Identity Verification](/docs/security/identity-verification) for details.

### Endpoint ID as verifiable commitment

The endpoint ID is `keccak256(apiUrl, path, method, parameters, encoding)`. Given a config file, anyone can recompute
the endpoint ID and confirm it matches what the airnode is serving. This does not prove the operator is running that
config, but it creates an auditable commitment.

### Quorum across providers

Different API providers each run their own airnode for their own API. A consumer can collect signed data from several
first-party airnodes — for example, a BTC/USD quorum composed of exchanges that each publish their own price feed — and
aggregate the results off-chain or submit them to an on-chain quorum verifier. The trust gain comes from independence at
the source: each airnode commits to its own specific endpoint, and an attacker would need to compromise multiple
unrelated providers to manipulate the aggregate.

### TLS proofs and third-party trust

zkTLS / TLS Notary produces cryptographic proof that the data came from a specific HTTPS endpoint, eliminating the need
to trust the operator's honesty -- the proof shows the data was not fabricated. Airnode integrates this today via the
Reclaim protocol: when `settings.proof` is configured and an endpoint declares `responseMatches`, each response carries
an attestation of the upstream call. See [TLS Proofs](/docs/concepts/proofs). (Proofs are non-fatal — a gateway outage
just omits the `proof` field rather than failing the request — and the consumer verifies the attestor signature
on-chain, not Airnode.)

TLS proofs are particularly significant for third-party operators. A third-party operator cannot, by signature alone,
prove it is actually calling the API it claims. With a TLS proof, the cryptographic proof itself demonstrates the data
came from the API provider's HTTPS endpoint -- regardless of who operates the airnode. This makes third-party operation
viable for use cases where the API provider does not want to run infrastructure, while still preserving verifiable data
provenance. Without a proof, first-party operation remains the only trust model where the data source is guaranteed.

### Future: TEE attestation

Running the airnode in a Trusted Execution Environment (AWS Nitro Enclaves, Intel SGX, AMD SEV-SNP) produces attestation
proofs that the running code matches a specific binary hash. Combined with DNS identity verification, this creates a
verifiable chain: the domain proves who operates the airnode, the attestation proves what code it runs.

## What is NOT trusted

### Who submits data on-chain

AirnodeVerifier is permissionless. Anyone can submit valid signed data -- the client, a relayer, the airnode itself, or
any third party. The contract verifies the signature, not the submitter.

### The transport layer

Responses are signed. A man-in-the-middle can observe the data but cannot modify it without invalidating the signature.
The signature is verified on-chain by the contracts and can be verified off-chain by any client.

## Off-chain trust: plugins

The airnode node supports a [plugin system](/docs/plugins) that can intercept and modify data at every stage of the
request lifecycle. Plugins run in the airnode process with no sandboxing. A malicious plugin can alter data before the
airnode signs it.

The trust placed in an airnode implicitly extends to all plugins it runs. Operators should audit plugin code and load
only plugins from trusted sources.

## On-chain verification

### Signature verification

```
messageHash = keccak256(encodePacked(endpointId, timestamp, data))
ethSignedHash = EIP-191 prefix + messageHash
recovered = ecrecover(ethSignedHash, signature)
assert recovered == airnode
```

AirnodeVerifier uses this verification. The `endpointId` is a top-level field (not buried inside another hash) so future
on-chain verifiers -- including TLS proof verifiers -- can inspect it directly.
