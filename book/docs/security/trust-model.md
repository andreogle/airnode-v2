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

With a third-party oracle (someone other than the API provider running the node), consumers must trust that the operator:

- Is actually calling the API they claim and not fabricating or caching responses
- Has legitimate access to the API and is not violating terms of service
- Is not modifying, delaying, or selectively omitting data
- Will keep the node running and the API credentials current

None of these properties can be verified on-chain today. The endpoint ID commits to *what* API should be called, but it
does not prove the operator is actually calling it. DNS identity verification proves *who* controls a domain, but a
third-party operator would only prove their own domain -- not the API provider's.

**First-party operation eliminates this entire class of trust assumptions.** The API provider has no incentive to
fabricate responses to their own API, already has legitimate access, and controls the infrastructure end-to-end.

Consumers should prefer airnodes operated by the API provider and verify this via
[DNS identity verification](/docs/security/identity-verification). If an airnode's identity cannot be traced to the API
provider's domain, treat it with the same skepticism you would apply to any unverified data source.

## What you are trusting

### 1. The airnode operator is calling the API they claim

The endpoint ID is a specification-bound hash that commits to the API URL, path, method, parameters, and encoding rules.
Two independent operators serving the same API with the same config produce the same endpoint ID. This is a verifiable
commitment -- you can inspect the config and confirm the endpoint ID matches -- but it is not proof that the operator is
actually running that config. With a first-party airnode, this is not a concern: the API provider has no reason to
misrepresent calls to their own API. Until TLS proofs mature, third-party operators require out-of-band trust.

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

### Quorum via multiple airnodes

Multiple independent airnodes can serve the same endpoint ID. On-chain, you can aggregate their responses using beacon
sets (median of N independent values via AirnodeDataFeed). Off-chain, your client can query multiple airnodes and
compare results. No single operator can manipulate the aggregated feed.

### Future: TLS proofs and third-party trust

TLS Notary (or zkTLS) can produce cryptographic proof that the data came from a specific HTTPS endpoint. This would
eliminate the need to trust the operator's honesty -- the proof shows the data was not fabricated. When TLS proof
technology matures, it can be integrated as a plugin or proof mode without changing the core architecture.

TLS proofs are particularly significant for third-party operators. Today, a third-party operator cannot prove they are
actually calling the API they claim. With TLS proofs, the cryptographic proof itself demonstrates the data came from
the API provider's HTTPS endpoint -- regardless of who operates the airnode. This could make third-party operation
viable for use cases where the API provider does not want to run infrastructure, while still preserving verifiable
data provenance. Until then, first-party operation remains the only trust model where the data source is guaranteed.

### Future: TEE attestation

Running the airnode in a Trusted Execution Environment (AWS Nitro Enclaves, Intel SGX, AMD SEV-SNP) produces attestation
proofs that the running code matches a specific binary hash. Combined with DNS identity verification, this creates a
verifiable chain: the domain proves who operates the airnode, the attestation proves what code it runs.

## What is NOT trusted

### Who submits data on-chain

Both AirnodeVerifier and AirnodeDataFeed are permissionless. Anyone can submit valid signed data -- the client, a
relayer, the airnode itself, or any third party. The contracts verify the signature, not the submitter.

### The relayer

A relayer is just transport. It reads signed data from the airnode's HTTP server and pushes it on-chain. It cannot forge
signatures. If a relayer omits data or goes offline, anyone else can submit the same signed data. The relayer has no
special privileges.

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

Both AirnodeVerifier and AirnodeDataFeed use this same verification. The `endpointId` is a top-level field (not buried
inside another hash) so future on-chain verifiers -- including TLS proof verifiers -- can inspect it directly.
