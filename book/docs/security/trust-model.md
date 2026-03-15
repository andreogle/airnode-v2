---
slug: /security/trust-model
sidebar_position: 1
---

# Trust Model

Understanding what you are trusting when you consume data from an airnode.

## What you are trusting

### 1. The airnode operator is calling the API they claim

The endpoint ID is a specification-bound hash that commits to the API URL, path, method, parameters, and encoding rules.
Two independent operators serving the same API with the same config produce the same endpoint ID. This is a verifiable
commitment -- you can inspect the config and confirm the endpoint ID matches -- but it is not proof that the operator is
actually running that config. Until TLS proofs mature, you trust the operator to be honest.

### 2. The airnode's private key is secure

The signature proves the airnode endorsed this data. If the private key is compromised, an attacker can sign arbitrary
data. Operators should use dedicated keys (not general-purpose wallets), store them securely (HSM, encrypted at rest),
and rotate them if exposure is suspected.

### 3. The data is genuine

The first-party trust model means the API provider is already trusted. If you use CoinGecko's price API off-chain, you
trust CoinGecko. Airnode extends that trust on-chain -- the data is signed by the API provider's key, not by a
third-party oracle network.

For higher assurance, use a quorum of multiple independent airnodes serving the same endpoint ID. An attacker would need
to compromise a majority to manipulate the result.

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

### Future: TLS proofs

TLS Notary (or zkTLS) can produce cryptographic proof that the data came from a specific HTTPS endpoint. This would
eliminate the need to trust the operator's honesty -- the proof shows the data was not fabricated. When TLS proof
technology matures, it can be integrated as a plugin or proof mode without changing the core architecture.

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
