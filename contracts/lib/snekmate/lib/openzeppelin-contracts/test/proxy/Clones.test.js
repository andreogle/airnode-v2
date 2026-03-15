const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { generators } = require('../helpers/random');
const shouldBehaveLikeClone = require('./Clones.behaviour');

const cloneInitCode = (instance, arguments_) =>
  arguments_
    ? [...ethers, 
        '0x61',
        ethers.toBeHex(0x2D + ethers.getBytes(arguments_).length, 2),
        '0x3d81600a3d39f3363d3d373d3d3d363d73',
        instance.target ?? instance.address ?? instance,
        '0x5af43d82803e903d91602b57fd5bf3',
        arguments_,
      ]
    : [...ethers, 
        '0x3d602d80600a3d3981f3363d3d373d3d3d363d73',
        instance.target ?? instance.address ?? instance,
        '0x5af43d82803e903d91602b57fd5bf3',
      ];

async function fixture() {
  const [deployer] = await ethers.getSigners();

  const factory = await ethers.deployContract('$Clones');
  const implementation = await ethers.deployContract('DummyImplementation');

  const newClone =
    arguments_ =>
    async (options = {}) => {
      const clone = await (
        arguments_
          ? factory.$cloneWithImmutableArgs.staticCall(implementation, arguments_)
          : factory.$clone.staticCall(implementation)
      ).then(address => implementation.attach(address));
      const tx = await (arguments_
        ? (options.deployValue
          ? factory.$cloneWithImmutableArgs(implementation, arguments_, ethers.Typed.uint256(options.deployValue))
          : factory.$cloneWithImmutableArgs(implementation, arguments_))
        : (options.deployValue
          ? factory.$clone(implementation, ethers.Typed.uint256(options.deployValue))
          : factory.$clone(implementation)));
      if (options.initData || options.initValue) {
        await deployer.sendTransaction({ to: clone, value: options.initValue ?? 0n, data: options.initData ?? '0x' });
      }
      return Object.assign(clone, { deploymentTransaction: () => tx });
    };

  const newCloneDeterministic =
    arguments_ =>
    async (options = {}) => {
      const salt = options.salt ?? ethers.randomBytes(32);
      const clone = await (
        arguments_
          ? factory.$cloneDeterministicWithImmutableArgs.staticCall(implementation, arguments_, salt)
          : factory.$cloneDeterministic.staticCall(implementation, salt)
      ).then(address => implementation.attach(address));
      const tx = await (arguments_
        ? (options.deployValue
          ? factory.$cloneDeterministicWithImmutableArgs(
              implementation,
              arguments_,
              salt,
              ethers.Typed.uint256(options.deployValue),
            )
          : factory.$cloneDeterministicWithImmutableArgs(implementation, arguments_, salt))
        : (options.deployValue
          ? factory.$cloneDeterministic(implementation, salt, ethers.Typed.uint256(options.deployValue))
          : factory.$cloneDeterministic(implementation, salt)));
      if (options.initData || options.initValue) {
        await deployer.sendTransaction({ to: clone, value: options.initValue ?? 0n, data: options.initData ?? '0x' });
      }
      return Object.assign(clone, { deploymentTransaction: () => tx });
    };

  return { deployer, factory, implementation, newClone, newCloneDeterministic };
}

describe('Clones', function () {
  beforeEach(async function () {
    Object.assign(this, await loadFixture(fixture));
  });

  for (const arguments_ of [undefined, '0x', '0x11223344']) {
    describe(arguments_ ? `with immutable args: ${arguments_}` : 'without immutable args', function () {
      describe('clone', function () {
        beforeEach(async function () {
          this.createClone = this.newClone(arguments_);
        });

        shouldBehaveLikeClone();

        it('get immutable arguments', async function () {
          const instance = await this.createClone();
          expect(await this.factory.$fetchCloneArgs(instance)).to.equal(arguments_ ?? '0x');
        });
      });

      describe('cloneDeterministic', function () {
        beforeEach(async function () {
          this.createClone = this.newCloneDeterministic(arguments_);
        });

        shouldBehaveLikeClone();

        it('get immutable arguments', async function () {
          const instance = await this.createClone();
          expect(await this.factory.$fetchCloneArgs(instance)).to.equal(arguments_ ?? '0x');
        });

        it('revert if address already used', async function () {
          const salt = ethers.randomBytes(32);

          const deployClone = () =>
            arguments_
              ? this.factory.$cloneDeterministicWithImmutableArgs(this.implementation, arguments_, salt)
              : this.factory.$cloneDeterministic(this.implementation, salt);

          // deploy once
          await expect(deployClone()).to.not.be.reverted;

          // deploy twice
          await expect(deployClone()).to.be.revertedWithCustomError(this.factory, 'FailedDeployment');
        });

        it('address prediction', async function () {
          const salt = ethers.randomBytes(32);

          const expected = ethers.getCreate2Address(
            this.factory.target,
            salt,
            ethers.keccak256(cloneInitCode(this.implementation, arguments_)),
          );

          if (arguments_) {
            const predicted = await this.factory.$predictDeterministicAddressWithImmutableArgs(
              this.implementation,
              arguments_,
              salt,
            );
            expect(predicted).to.equal(expected);

            await expect(this.factory.$cloneDeterministicWithImmutableArgs(this.implementation, arguments_, salt))
              .to.emit(this.factory, 'return$cloneDeterministicWithImmutableArgs_address_bytes_bytes32')
              .withArgs(predicted);
          } else {
            const predicted = await this.factory.$predictDeterministicAddress(this.implementation, salt);
            expect(predicted).to.equal(expected);

            await expect(this.factory.$cloneDeterministic(this.implementation, salt))
              .to.emit(this.factory, 'return$cloneDeterministic_address_bytes32')
              .withArgs(predicted);
          }
        });
      });
    });
  }

  it('EIP-170 limit on immutable args', async function () {
    // EIP-170 limits the contract code size to 0x6000
    // This limits the length of immutable args to 0x5fd3
    const arguments_ = generators.hexBytes(0x5F_D4);
    const salt = ethers.randomBytes(32);

    await expect(
      this.factory.$predictDeterministicAddressWithImmutableArgs(this.implementation, arguments_, salt),
    ).to.be.revertedWithCustomError(this.factory, 'CloneArgumentsTooLong');

    await expect(this.factory.$cloneWithImmutableArgs(this.implementation, arguments_)).to.be.revertedWithCustomError(
      this.factory,
      'CloneArgumentsTooLong',
    );
  });
});
