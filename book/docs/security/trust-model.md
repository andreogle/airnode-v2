---
slug: /security/trust-model
sidebar_position: 1
---

# Trust model

An Airnode response has two separate questions:

1. Who signed it?
2. Why should you trust the signed value?

The signature answers only the first question. Consumers must decide the second.

## The intended setup

Airnode is designed for an API provider to operate the Airnode that serves its own API. For example, if an exchange runs
an Airnode for its own market data, the exchange controls both the API and the signing key.

This removes an extra relay from the trust path, but it does not make the data objectively true. You still trust the
provider, its API, its Airnode process, and its key management.

Before accepting data, confirm that the Airnode address belongs to the provider through
[DNS identity verification](/docs/security/identity-verification). DNS proves control of a domain and its association
with an address. It does not inspect the running code or the upstream request.

## What a signature proves

An EIP-191 signature proves that the holder of the Airnode private key signed:

```text
endpointId + timestamp + data
```

It does not prove that:

- the signer is the API provider
- the operator used the published configuration
- the operator called the configured API
- the upstream API returned that value
- the value is accurate or suitable for your application

The endpoint ID commits to a configuration. It is not runtime evidence. See [Endpoint IDs](/docs/concepts/endpoint-ids).

## What consumers trust

### The operator identity

Use the provider's published domain and DNS record to verify the expected Airnode address. Reading an address from
`/health` is not enough, because an untrusted server can return any address.

### The signing key

Anyone with the private key can produce valid signatures. Operators should use a dedicated key, restrict access to it,
and publish a recovery or rotation plan.

Key rotation changes the trusted signer address. It does not change endpoint IDs, because endpoint IDs are derived from
API configuration rather than the signing key.

### The provider and upstream data

A first-party Airnode carries the same basic provider trust as the provider's normal API. If the provider is wrong,
compromised, or dishonest, its signed response can also be wrong.

For higher resilience, a consumer can compare signed responses from independent providers. The consumer must define the
aggregation rule, freshness policy, and minimum number of acceptable providers.

## Third-party operators

If someone other than the API provider operates the Airnode, the consumer also trusts that operator to call the claimed
API and relay the result correctly. DNS verification of the operator's domain does not prove a relationship with the API
provider.

Do not describe a third-party Airnode as first-party data unless the API provider has explicitly authorized and
identified it.

## TLS proofs

Airnode can request a Reclaim TLS proof. The gateway and attestor make a separate HTTPS request and attest that the
response matched configured patterns.

This adds evidence about the attestor's request. It does not prove that Airnode's separately fetched and signed payload
is byte-for-byte the same response. Consumers also trust the proof system, gateway behavior, attestor set, matching
rules, and verification code.

Proof generation is optional and non-fatal. A response may be signed without a proof when the gateway fails. Consumers
that require a proof must reject responses that omit it.

See [TLS Proofs](/docs/concepts/proofs) for the exact boundary.

## Plugins

Plugins run in the Airnode process without a sandbox. Mutation hooks can change parameters or data before signing. Trust
in an Airnode therefore includes every loaded plugin.

Operators should review plugin code and keep the plugin list small.

## On-chain verification

`AirnodeVerifier` checks the EIP-191 signature, replay state, and callback flow. It does not verify the upstream API
call or decide whether the signer is trustworthy.

Anyone can submit a valid signed response. The contract verifies the signature, not the submitter.

## Consumer checklist

Before using an Airnode response:

- Verify the expected signer through a provider-controlled channel.
- Pin the signer and endpoint ID you intend to trust.
- Check the timestamp against your freshness limit.
- Decode the data using the expected ABI type.
- Decide whether a TLS proof is required, and reject missing proofs if it is.
- Define how key rotation, provider failure, and conflicting providers are handled.
