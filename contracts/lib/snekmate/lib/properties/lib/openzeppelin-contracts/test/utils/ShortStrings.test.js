const { expect } = require('chai');
const { expectRevertCustomError } = require('../helpers/customError');

const ShortStrings = artifacts.require('$ShortStrings');

function decode(sstr) {
  const length = Number.parseInt(sstr.slice(64), 16);
  return web3.utils.toUtf8(sstr).slice(0, length);
}

contract('ShortStrings', function () {
  before(async function () {
    this.mock = await ShortStrings.new();
  });

  for (const string_ of [0, 1, 16, 31, 32, 64, 1024].map(length => 'a'.repeat(length))) {
    describe(`with string length ${string_.length}`, function () {
      it('encode / decode', async function () {
        if (string_.length < 32) {
          const encoded = await this.mock.$toShortString(string_);
          expect(decode(encoded)).to.be.equal(string_);

          const length = await this.mock.$length(encoded);
          expect(length.toNumber()).to.be.equal(string_.length);

          const decoded = await this.mock.$toString(encoded);
          expect(decoded).to.be.equal(string_);
        } else {
          await expectRevertCustomError(this.mock.$toShortString(string_), `StringTooLong("${string_}")`);
        }
      });

      it('set / get with fallback', async function () {
        const { logs } = await this.mock.$toShortStringWithFallback(string_, 0);
        const { ret0 } = logs.find(({ event }) => event == 'return$toShortStringWithFallback').args;

        expect(await this.mock.$toString(ret0)).to.be.equal(string_.length < 32 ? string_ : '');

        const recovered = await this.mock.$toStringWithFallback(ret0, 0);
        expect(recovered).to.be.equal(string_);
      });
    });
  }
});
