const { PANIC_CODES } = require('@nomicfoundation/hardhat-chai-matchers/panic');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { generators } = require('../../helpers/random');

const LENGTH = 4;

async function fixture() {
  const mock = await ethers.deployContract('$CircularBuffer');
  await mock.$setup(0, LENGTH);
  return { mock };
}

describe('CircularBuffer', function () {
  beforeEach(async function () {
    Object.assign(this, await loadFixture(fixture));
  });

  it('reverts on invalid setup', async function () {
    await expect(this.mock.$setup(0, 0)).to.be.revertedWithCustomError(this.mock, 'InvalidBufferSize');
  });

  it('starts empty', async function () {
    expect(await this.mock.$count(0)).to.equal(0n);
    expect(await this.mock.$length(0)).to.equal(LENGTH);
    expect(await this.mock.$includes(0, ethers.ZeroHash)).to.be.false;
    await expect(this.mock.$last(0, 0)).to.be.revertedWithPanic(PANIC_CODES.ARRAY_ACCESS_OUT_OF_BOUNDS);
  });

  it('push', async function () {
    const values = Array.from({ length: LENGTH + 3 }, generators.bytes32);

    for (const [index, value] of values.map((v, index_) => [index_, v])) {
      // push value
      await this.mock.$push(0, value);

      // view of the values
      const pushed = values.slice(0, index + 1);
      const stored = pushed.slice(-LENGTH);
      const dropped = pushed.slice(0, -LENGTH);

      // check count
      expect(await this.mock.$length(0)).to.equal(LENGTH);
      expect(await this.mock.$count(0)).to.equal(stored.length);

      // check last
      for (const index in stored) {
        expect(await this.mock.$last(0, index)).to.equal(stored.at(-index - 1));
      }
      await expect(this.mock.$last(0, stored.length + 1)).to.be.revertedWithPanic(
        PANIC_CODES.ARRAY_ACCESS_OUT_OF_BOUNDS,
      );

      // check included and non-included values
      for (const v of stored) {
        expect(await this.mock.$includes(0, v)).to.be.true;
      }
      for (const v of dropped) {
        expect(await this.mock.$includes(0, v)).to.be.false;
      }
      expect(await this.mock.$includes(0, ethers.ZeroHash)).to.be.false;
    }
  });

  it('clear', async function () {
    const value = generators.bytes32();
    await this.mock.$push(0, value);

    expect(await this.mock.$count(0)).to.equal(1n);
    expect(await this.mock.$length(0)).to.equal(LENGTH);
    expect(await this.mock.$includes(0, value)).to.be.true;
    await this.mock.$last(0, 0); // not revert

    await this.mock.$clear(0);

    expect(await this.mock.$count(0)).to.equal(0n);
    expect(await this.mock.$length(0)).to.equal(LENGTH);
    expect(await this.mock.$includes(0, value)).to.be.false;
    await expect(this.mock.$last(0, 0)).to.be.revertedWithPanic(PANIC_CODES.ARRAY_ACCESS_OUT_OF_BOUNDS);
  });
});
