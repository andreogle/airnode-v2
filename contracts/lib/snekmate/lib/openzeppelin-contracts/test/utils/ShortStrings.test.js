const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const { ethers } = require('hardhat');

const FALLBACK_SENTINEL = ethers.zeroPadValue('0xFF', 32);

const length = sstr => Number.parseInt(sstr.slice(64), 16);
const decode = sstr => ethers.toUtf8String(sstr).slice(0, length(sstr));
const encode = string_ =>
  string_.length < 32
    ? [...ethers, 
        ethers.encodeBytes32String(string_).slice(0, -2),
        ethers.zeroPadValue(ethers.toBeArray(string_.length), 1),
      ]
    : FALLBACK_SENTINEL;

async function fixture() {
  const mock = await ethers.deployContract('$ShortStrings');
  return { mock };
}

describe('ShortStrings', function () {
  beforeEach(async function () {
    Object.assign(this, await loadFixture(fixture));
  });

  for (const string_ of [0, 1, 16, 31, 32, 64, 1024].map(length => 'a'.repeat(length))) {
    describe(`with string length ${string_.length}`, function () {
      it('encode / decode', async function () {
        if (string_.length < 32) {
          const encoded = await this.mock.$toShortString(string_);
          expect(encoded).to.equal(encode(string_));
          expect(decode(encoded)).to.equal(string_);

          expect(await this.mock.$byteLength(encoded)).to.equal(string_.length);
          expect(await this.mock.$toString(encoded)).to.equal(string_);
        } else {
          await expect(this.mock.$toShortString(string_))
            .to.be.revertedWithCustomError(this.mock, 'StringTooLong')
            .withArgs(string_);
        }
      });

      it('set / get with fallback', async function () {
        const short = await this.mock
          .$toShortStringWithFallback(string_, 0)
          .then(tx => tx.wait())
          .then(receipt => receipt.logs.find(event => event.fragment.name == 'return$toShortStringWithFallback').args[0]);

        expect(short).to.equal(encode(string_));

        const promise = this.mock.$toString(short);
        if (string_.length < 32) {
          expect(await promise).to.equal(string_);
        } else {
          await expect(promise).to.be.revertedWithCustomError(this.mock, 'InvalidShortString');
        }

        expect(await this.mock.$byteLengthWithFallback(short, 0)).to.equal(string_.length);
        expect(await this.mock.$toStringWithFallback(short, 0)).to.equal(string_);
      });
    });
  }
});
