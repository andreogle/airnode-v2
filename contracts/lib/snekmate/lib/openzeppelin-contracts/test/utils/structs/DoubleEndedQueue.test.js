const { PANIC_CODES } = require('@nomicfoundation/hardhat-chai-matchers/panic');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const { ethers } = require('hardhat');

async function fixture() {
  const mock = await ethers.deployContract('$DoubleEndedQueue');

  /** Rebuild the content of the deque as a JS array. */
  const getContent = () =>
    mock.$length(0).then(length => Promise.all(Array.from({ length: Number(length) }, (_, index) => mock.$at(0, index))));

  return { mock, getContent };
}

describe('DoubleEndedQueue', function () {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const bytesA = coder.encode(['uint256'], [0xDE_AD_BE_EF]);
  const bytesB = coder.encode(['uint256'], [0x01_23_45_67_89]);
  const bytesC = coder.encode(['uint256'], [0x42_42_42_42]);
  const bytesD = coder.encode(['uint256'], [0x17_17_17]);

  beforeEach(async function () {
    Object.assign(this, await loadFixture(fixture));
  });

  describe('when empty', function () {
    it('getters', async function () {
      expect(await this.mock.$empty(0)).to.be.true;
      expect(await this.getContent()).to.have.ordered.members([]);
    });

    it('reverts on accesses', async function () {
      await expect(this.mock.$popBack(0)).to.be.revertedWithPanic(PANIC_CODES.POP_ON_EMPTY_ARRAY);
      await expect(this.mock.$popFront(0)).to.be.revertedWithPanic(PANIC_CODES.POP_ON_EMPTY_ARRAY);
      await expect(this.mock.$back(0)).to.be.revertedWithPanic(PANIC_CODES.ARRAY_ACCESS_OUT_OF_BOUNDS);
      await expect(this.mock.$front(0)).to.be.revertedWithPanic(PANIC_CODES.ARRAY_ACCESS_OUT_OF_BOUNDS);
    });
  });

  describe('when not empty', function () {
    beforeEach(async function () {
      await this.mock.$pushBack(0, bytesB);
      await this.mock.$pushFront(0, bytesA);
      await this.mock.$pushBack(0, bytesC);
      this.content = [bytesA, bytesB, bytesC];
    });

    it('getters', async function () {
      expect(await this.mock.$empty(0)).to.be.false;
      expect(await this.mock.$length(0)).to.equal(this.content.length);
      expect(await this.mock.$front(0)).to.equal(this.content[0]);
      expect(await this.mock.$back(0)).to.equal(this.content.at(-1));
      expect(await this.getContent()).to.have.ordered.members(this.content);
    });

    it('out of bounds access', async function () {
      await expect(this.mock.$at(0, this.content.length)).to.be.revertedWithPanic(
        PANIC_CODES.ARRAY_ACCESS_OUT_OF_BOUNDS,
      );
    });

    describe('push', function () {
      it('front', async function () {
        await this.mock.$pushFront(0, bytesD);
        this.content.unshift(bytesD); // add element at the beginning

        expect(await this.getContent()).to.have.ordered.members(this.content);
      });

      it('back', async function () {
        await this.mock.$pushBack(0, bytesD);
        this.content.push(bytesD); // add element at the end

        expect(await this.getContent()).to.have.ordered.members(this.content);
      });
    });

    describe('pop', function () {
      it('front', async function () {
        const value = this.content.shift(); // remove first element
        await expect(this.mock.$popFront(0)).to.emit(this.mock, 'return$popFront').withArgs(value);

        expect(await this.getContent()).to.have.ordered.members(this.content);
      });

      it('back', async function () {
        const value = this.content.pop(); // remove last element
        await expect(this.mock.$popBack(0)).to.emit(this.mock, 'return$popBack').withArgs(value);

        expect(await this.getContent()).to.have.ordered.members(this.content);
      });
    });

    it('clear', async function () {
      await this.mock.$clear(0);

      expect(await this.mock.$empty(0)).to.be.true;
      expect(await this.getContent()).to.have.ordered.members([]);
    });
  });
});
