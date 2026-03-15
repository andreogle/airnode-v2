# @version ^0.4.0
# @title AirnodeVerifier
# @notice Verifies Airnode-signed data and forwards it to a callback contract.
#         This is the on-chain primitive for the "pull" path — a client gets signed
#         data from an Airnode HTTP server and submits it on-chain to trigger a
#         callback on their contract.
#
#   How it works:
#   1. Client calls an Airnode's HTTP endpoint, receives signed data.
#   2. Client (or a relayer) calls verify_and_fulfill() with the signed data.
#   3. This contract recovers the signer from the signature.
#   4. If the signer matches the provided airnode address, and the request hasn't
#      been fulfilled before, the data is forwarded to the callback contract.
#
#   Signature format:
#     hash = keccak256(abi.encodePacked(endpointId, timestamp, data))
#     signature = EIP-191 personal sign over hash
#
#   Trust model:
#   - Permissionless: anyone can submit signed data (client, relayer, airnode).
#   - The contract only verifies the signature. It does NOT check whether the
#     airnode is "legitimate" — that is the callback contract's responsibility.
#     The callback contract should maintain its own trust set of airnode addresses.
#   - Replay protection: each (endpointId, timestamp, data) combination can only
#     be fulfilled once.
#   - The callback is called with revert_on_failure=False — if the callback reverts,
#     the fulfillment is still recorded. This prevents griefing where a callback
#     intentionally reverts to block fulfillment.
#   - The callback receives (request_hash, airnode, endpoint_id, timestamp, data)
#     so it has all the context it needs to validate and process the data.

from snekmate.utils import ecdsa as ec
from snekmate.utils import message_hash_utils as mhu

# ==============================================================================
# Events
# ==============================================================================
event Fulfilled:
    request_hash: indexed(bytes32)
    airnode: indexed(address)
    endpoint_id: bytes32
    timestamp: uint256
    callback_address: address

# ==============================================================================
# Storage
# ==============================================================================
# Tracks fulfilled requests to prevent replay. The key is the hash of the
# signed message, which is unique per (endpointId, timestamp, data) combination.
fulfilled: public(HashMap[bytes32, bool])

# ==============================================================================
# Constants
# ==============================================================================
MAX_DATA_LENGTH: constant(uint256) = 4096
MAX_CALLBACK_LENGTH: constant(uint256) = 4 + 32 + 32 + 32 + 32 + 32 + MAX_DATA_LENGTH + 32

# ==============================================================================
# External functions
# ==============================================================================
@external
def verify_and_fulfill(
    airnode: address,
    endpoint_id: bytes32,
    timestamp: uint256,
    data: Bytes[MAX_DATA_LENGTH],
    signature: Bytes[65],
    callback_address: address,
    callback_selector: bytes4,
):
    """
    @notice Verify an Airnode signature and forward the data to a callback.
    @param airnode The airnode address that should have signed the data.
    @param endpoint_id The specification-bound endpoint ID.
    @param timestamp The timestamp included in the signature.
    @param data The ABI-encoded response data.
    @param signature The EIP-191 personal signature over the message hash.
    @param callback_address The contract to forward the data to.
    @param callback_selector The function selector on the callback contract.
    """
    # Derive the message hash: keccak256(encodePacked(endpointId, timestamp, data))
    # In Vyper, concat() produces packed encoding for fixed-size types.
    # timestamp is uint256 (32 bytes), so convert to bytes32 for packing.
    message_hash: bytes32 = keccak256(
        concat(endpoint_id, convert(timestamp, bytes32), data)
    )

    # Apply EIP-191 prefix and recover the signer
    eth_signed_hash: bytes32 = mhu._to_eth_signed_message_hash(message_hash)
    recovered: address = ec._recover_sig(eth_signed_hash, signature)
    assert recovered == airnode, "Signature mismatch"

    # Prevent replay — each unique message can only be fulfilled once
    request_hash: bytes32 = message_hash
    assert not self.fulfilled[request_hash], "Already fulfilled"
    self.fulfilled[request_hash] = True

    # Forward to callback. revert_on_failure=False prevents griefing where
    # a callback intentionally reverts to block fulfillment.
    _success: bool = empty(bool)
    _response: Bytes[MAX_CALLBACK_LENGTH] = b""
    _success, _response = raw_call(
        callback_address,
        concat(
            callback_selector,
            abi_encode(request_hash, airnode, endpoint_id, timestamp, data),
        ),
        max_outsize=MAX_CALLBACK_LENGTH,
        revert_on_failure=False,
    )

    log Fulfilled(
        request_hash=request_hash,
        airnode=airnode,
        endpoint_id=endpoint_id,
        timestamp=timestamp,
        callback_address=callback_address,
    )
