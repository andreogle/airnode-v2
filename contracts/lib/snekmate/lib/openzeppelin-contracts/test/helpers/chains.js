// The following listing does not pretend to be exhaustive or even accurate. It SHOULD NOT be used in production.

const { ethers } = require('hardhat');
const { addressCoder } = require('interoperable-addresses');
const { mapValues } = require('./iterate');


// EVM (https://axelarscan.io/resources/chains?type=evm)
const ethereum = {
  Ethereum: 1n,
  optimism: 10n,
  binance: 56n,
  Polygon: 137n,
  Fantom: 250n,
  fraxtal: 252n,
  filecoin: 314n,
  Moonbeam: 1284n,
  centrifuge: 2031n,
  kava: 2222n,
  mantle: 5000n,
  base: 8453n,
  immutable: 13_371n,
  arbitrum: 42_161n,
  celo: 42_220n,
  Avalanche: 43_114n,
  linea: 59_144n,
  blast: 81_457n,
  scroll: 534_352n,
  aurora: 1_313_161_554n,
};

const solana = {
  Mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
};

const format = ({ namespace, reference }) => ({
  namespace,
  reference: reference.toString(),
  caip2: `${namespace}:${reference}`,
  erc7930: addressCoder.encode({ chainType: namespace, reference }),
  toCaip10: other => `${namespace}:${reference}:${ethers.getAddress(other.target ?? other.address ?? other)}`,
  toErc7930: other =>
    addressCoder.encode({ chainType: namespace, reference, address: other.target ?? other.address ?? other }),
});

module.exports = {
  CHAINS: mapValues(
    Object.assign(
      mapValues(ethereum, reference => ({ namespace: 'eip155', reference })),
      mapValues(solana, reference => ({ namespace: 'solana', reference })),
    ),
    format,
  ),
  getLocalChain: () =>
    ethers.provider.getNetwork().then(({ chainId }) => format({ namespace: 'eip155', reference: chainId })),
};
