const { forward } = require('../helpers/time');

function zip(...arguments_) {
  return Array.from({length: Math.max(...arguments_.map(array => array.length))})
    .fill()
    .map((_, index) => arguments_.map(array => array[index]));
}

function concatHex(...arguments_) {
  return web3.utils.bytesToHex(arguments_.flatMap(h => web3.utils.hexToBytes(h || '0x')));
}

function concatOptions(arguments_, options = null) {
  return options ? arguments_.concat(options) : arguments_;
}

class GovernorHelper {
  constructor(governor, mode = 'blocknumber') {
    this.governor = governor;
    this.mode = mode;
  }

  delegate(delegation = {}, options = null) {
    return Promise.all([
      delegation.token.delegate(delegation.to, { from: delegation.to }),
      delegation.value && delegation.token.transfer(...concatOptions([delegation.to, delegation.value]), options),
      delegation.tokenId &&
        delegation.token
          .ownerOf(delegation.tokenId)
          .then(owner =>
            delegation.token.transferFrom(...concatOptions([owner, delegation.to, delegation.tokenId], options)),
          ),
    ]);
  }

  propose(options = null) {
    const proposal = this.currentProposal;

    return this.governor.methods[
      proposal.useCompatibilityInterface
        ? 'propose(address[],uint256[],string[],bytes[],string)'
        : 'propose(address[],uint256[],bytes[],string)'
    ](...concatOptions(proposal.fullProposal, options));
  }

  queue(options = null) {
    const proposal = this.currentProposal;

    return proposal.useCompatibilityInterface
      ? this.governor.methods['queue(uint256)'](...concatOptions([proposal.id], options))
      : this.governor.methods['queue(address[],uint256[],bytes[],bytes32)'](
          ...concatOptions(proposal.shortProposal, options),
        );
  }

  execute(options = null) {
    const proposal = this.currentProposal;

    return proposal.useCompatibilityInterface
      ? this.governor.methods['execute(uint256)'](...concatOptions([proposal.id], options))
      : this.governor.methods['execute(address[],uint256[],bytes[],bytes32)'](
          ...concatOptions(proposal.shortProposal, options),
        );
  }

  cancel(visibility = 'external', options = null) {
    const proposal = this.currentProposal;

    switch (visibility) {
      case 'external': {
        if (proposal.useCompatibilityInterface) {
          return this.governor.methods['cancel(uint256)'](...concatOptions([proposal.id], options));
        } 
          return this.governor.methods['cancel(address[],uint256[],bytes[],bytes32)'](
            ...concatOptions(proposal.shortProposal, options),
          );
      }
        
      case 'internal': {
        return this.governor.methods['$_cancel(address[],uint256[],bytes[],bytes32)'](
          ...concatOptions(proposal.shortProposal, options),
        );
      }
      default: {
        throw new Error(`unsuported visibility "${visibility}"`);
      }
    }
  }

  vote(vote = {}, options = null) {
    const proposal = this.currentProposal;

    return vote.signature
      ? // if signature, and either params or reason →
        (vote.params || vote.reason
        ? vote
            .signature(this.governor, {
              proposalId: proposal.id,
              support: vote.support,
              reason: vote.reason || '',
              params: vote.params || '',
            })
            .then(({ v, r, s }) =>
              this.governor.castVoteWithReasonAndParamsBySig(
                ...concatOptions([proposal.id, vote.support, vote.reason || '', vote.params || '', v, r, s], options),
              ),
            )
        : vote
            .signature(this.governor, {
              proposalId: proposal.id,
              support: vote.support,
            })
            .then(({ v, r, s }) =>
              this.governor.castVoteBySig(...concatOptions([proposal.id, vote.support, v, r, s], options)),
            ))
      : vote.params
      ? // otherwise if params
        this.governor.castVoteWithReasonAndParams(
          ...concatOptions([proposal.id, vote.support, vote.reason || '', vote.params], options),
        )
      : vote.reason
      ? // otherwise if reason
        this.governor.castVoteWithReason(...concatOptions([proposal.id, vote.support, vote.reason], options))
      : this.governor.castVote(...concatOptions([proposal.id, vote.support], options));
  }

  async waitForSnapshot(offset = 0) {
    const proposal = this.currentProposal;
    const timepoint = await this.governor.proposalSnapshot(proposal.id);
    return forward[this.mode](timepoint.addn(offset));
  }

  async waitForDeadline(offset = 0) {
    const proposal = this.currentProposal;
    const timepoint = await this.governor.proposalDeadline(proposal.id);
    return forward[this.mode](timepoint.addn(offset));
  }

  async waitForEta(offset = 0) {
    const proposal = this.currentProposal;
    const timestamp = await this.governor.proposalEta(proposal.id);
    return forward.timestamp(timestamp.addn(offset));
  }

  /**
   * Specify a proposal either as
   * 1) an array of objects [{ target, value, data, signature? }]
   * 2) an object of arrays { targets: [], values: [], data: [], signatures?: [] }
   */
  setProposal(actions, description) {
    let targets, values, signatures, data, useCompatibilityInterface;

    if (Array.isArray(actions)) {
      useCompatibilityInterface = actions.some(a => 'signature' in a);
      targets = actions.map(a => a.target);
      values = actions.map(a => a.value || '0');
      signatures = actions.map(a => a.signature || '');
      data = actions.map(a => a.data || '0x');
    } else {
      useCompatibilityInterface = Array.isArray(actions.signatures);
      ({ targets, values, signatures = [], data } = actions);
    }

    const fulldata = zip(
      signatures.map(s => s && web3.eth.abi.encodeFunctionSignature(s)),
      data,
    ).map(hexs => concatHex(...hexs));

    const descriptionHash = web3.utils.keccak256(description);

    // condensed version for queueing end executing
    const shortProposal = [targets, values, fulldata, descriptionHash];

    // full version for proposing
    const fullProposal = [targets, values, ...(useCompatibilityInterface ? [signatures] : []), data, description];

    // proposal id
    const id = web3.utils.toBN(
      web3.utils.keccak256(
        web3.eth.abi.encodeParameters(['address[]', 'uint256[]', 'bytes[]', 'bytes32'], shortProposal),
      ),
    );

    this.currentProposal = {
      id,
      targets,
      values,
      signatures,
      data,
      fulldata,
      description,
      descriptionHash,
      shortProposal,
      fullProposal,
      useCompatibilityInterface,
    };

    return this.currentProposal;
  }
}

module.exports = {
  GovernorHelper,
};
