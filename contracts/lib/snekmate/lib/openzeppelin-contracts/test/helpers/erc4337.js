const { ethers, config, entrypoint, senderCreator } = require('hardhat');

const SIG_VALIDATION_SUCCESS = '0x0000000000000000000000000000000000000000';
const SIG_VALIDATION_FAILURE = '0x0000000000000000000000000000000000000001';

function getAddress(account) {
  return account.target ?? account.address ?? account;
}

function pack(left, right) {
  return ethers.solidityPacked(['uint128', 'uint128'], [left, right]);
}

function packValidationData(validAfter, validUntil, authorizer) {
  return ethers.solidityPacked(
    ['uint48', 'uint48', 'address'],
    [
      validAfter,
      validUntil,
      typeof authorizer === 'boolean'
        ? (authorizer
          ? SIG_VALIDATION_SUCCESS
          : SIG_VALIDATION_FAILURE)
        : getAddress(authorizer),
    ],
  );
}

function packInitCode(factory, factoryData) {
  return ethers.solidityPacked(['address', 'bytes'], [getAddress(factory), factoryData]);
}

function packPaymasterAndData(paymaster, paymasterVerificationGasLimit, paymasterPostOpGasLimit, paymasterData) {
  return ethers.solidityPacked(
    ['address', 'uint128', 'uint128', 'bytes'],
    [getAddress(paymaster), paymasterVerificationGasLimit, paymasterPostOpGasLimit, paymasterData],
  );
}

/// Represent one user operation
class UserOperation {
  constructor(parameters) {
    this.sender = getAddress(parameters.sender);
    this.nonce = parameters.nonce;
    this.factory = parameters.factory ?? undefined;
    this.factoryData = parameters.factoryData ?? '0x';
    this.callData = parameters.callData ?? '0x';
    this.verificationGas = parameters.verificationGas ?? 10_000_000n;
    this.callGas = parameters.callGas ?? 100_000n;
    this.preVerificationGas = parameters.preVerificationGas ?? 100_000n;
    this.maxPriorityFee = parameters.maxPriorityFee ?? 100_000n;
    this.maxFeePerGas = parameters.maxFeePerGas ?? 100_000n;
    this.paymaster = parameters.paymaster ?? undefined;
    this.paymasterVerificationGasLimit = parameters.paymasterVerificationGasLimit ?? 0n;
    this.paymasterPostOpGasLimit = parameters.paymasterPostOpGasLimit ?? 0n;
    this.paymasterData = parameters.paymasterData ?? '0x';
    this.signature = parameters.signature ?? '0x';
  }

  get packed() {
    return {
      sender: this.sender,
      nonce: this.nonce,
      initCode: this.factory ? packInitCode(this.factory, this.factoryData) : '0x',
      callData: this.callData,
      accountGasLimits: pack(this.verificationGas, this.callGas),
      preVerificationGas: this.preVerificationGas,
      gasFees: pack(this.maxPriorityFee, this.maxFeePerGas),
      paymasterAndData: this.paymaster
        ? packPaymasterAndData(
            this.paymaster,
            this.paymasterVerificationGasLimit,
            this.paymasterPostOpGasLimit,
            this.paymasterData,
          )
        : '0x',
      signature: this.signature,
    };
  }

  hash(entrypoint) {
    return entrypoint.getUserOpHash(this.packed);
  }
}

const parseInitCode = initCode => ({
  factory: `0x${  initCode.replace(/0x/, '').slice(0, 40)}`,
  factoryData: `0x${  initCode.replace(/0x/, '').slice(40)}`,
});

/// Global ERC-4337 environment helper.
class ERC4337Helper {
  constructor() {
    this.factoryAsPromise = ethers.deployContract('$Create2');
  }

  async wait() {
    this.factory = await this.factoryAsPromise;
    return this;
  }

  async newAccount(name, extraArguments = [], parameters = {}) {
    const environment = {
      entrypoint: parameters.entrypoint ?? entrypoint.v08,
      senderCreator: parameters.senderCreator ?? senderCreator.v08,
    };

    const { factory } = await this.wait();

    const accountFactory = await ethers.getContractFactory(name);

    if (parameters.erc7702signer) {
      const delegate = await accountFactory.deploy(...extraArguments);
      const instance = await parameters.erc7702signer.getAddress().then(address => accountFactory.attach(address));
      const authorization = await parameters.erc7702signer.authorize({ address: delegate.target });
      return new ERC7702SmartAccount(instance, authorization, environment);
    } 
      const initCode = await accountFactory
        .getDeployTransaction(...extraArguments)
        .then(tx =>
          factory.interface.encodeFunctionData('$deploy', [0, parameters.salt ?? ethers.randomBytes(32), tx.data]),
        )
        .then(deployCode => [...ethers, factory.target, deployCode]);

      const instance = await ethers.provider
        .call({
          from: environment.entrypoint,
          to: environment.senderCreator,
          data: environment.senderCreator.interface.encodeFunctionData('createSender', [initCode]),
        })
        .then(result => ethers.getAddress(ethers.hexlify(ethers.getBytes(result).slice(-20))))
        .then(address => accountFactory.attach(address));

      return new SmartAccount(instance, initCode, environment);
    
  }
}

/// Represent one ERC-4337 account contract.
class SmartAccount extends ethers.BaseContract {
  constructor(instance, initCode, environment) {
    super(instance.target, instance.interface, instance.runner, instance.deployTx);
    this.address = instance.target;
    this.initCode = initCode;
    this._env = environment;
  }

  async deploy(account = this.runner) {
    const { factory: to, factoryData: data } = parseInitCode(this.initCode);
    this.deployTx = await account.sendTransaction({ to, data });
    return this;
  }

  async createUserOp(userOp = {}) {
    userOp.sender ??= this;
    userOp.nonce ??= await this._env.entrypoint.getNonce(userOp.sender, 0);
    if (ethers.isAddressable(userOp.paymaster)) {
      userOp.paymaster = await ethers.resolveAddress(userOp.paymaster);
      userOp.paymasterVerificationGasLimit ??= 100_000n;
      userOp.paymasterPostOpGasLimit ??= 100_000n;
    }
    return new UserOperationWithContext(userOp, this._env);
  }
}

class ERC7702SmartAccount extends SmartAccount {
  constructor(instance, authorization, environment) {
    super(instance, undefined, environment);
    this.authorization = authorization;
  }

  async deploy() {
    // hardhat signers from @nomicfoundation/hardhat-ethers do not support type 4 txs.
    // so we rebuild it using "native" ethers
    await ethers.Wallet.fromPhrase(config.networks.hardhat.accounts.mnemonic, ethers.provider).sendTransaction({
      to: ethers.ZeroAddress,
      authorizationList: [this.authorization],
      gasLimit: 46_000n, // 21,000 base + PER_EMPTY_ACCOUNT_COST
    });

    return this;
  }
}

class UserOperationWithContext extends UserOperation {
  constructor(userOp, environment) {
    super(userOp);
    this._sender = userOp.sender;
    this._env = environment;
  }

  addInitCode() {
    if (this._sender?.initCode) {
      return Object.assign(this, parseInitCode(this._sender.initCode));
    } throw new Error('No init code available for the sender of this user operation');
  }

  getAuthorization() {
    if (this._sender?.authorization) {
      return this._sender.authorization;
    } throw new Error('No EIP-7702 authorization available for the sender of this user operation');
  }

  hash() {
    return super.hash(this._env.entrypoint);
  }
}

module.exports = {
  SIG_VALIDATION_SUCCESS,
  SIG_VALIDATION_FAILURE,
  packValidationData,
  packInitCode,
  packPaymasterAndData,
  UserOperation,
  ERC4337Helper,
};
