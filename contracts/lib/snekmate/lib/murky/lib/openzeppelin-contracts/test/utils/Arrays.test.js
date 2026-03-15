const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { TYPES } = require('../../scripts/generate/templates/Arrays.opts');
const { capitalize } = require('../../scripts/helpers');
const { generators } = require('../helpers/random');

// See https://en.cppreference.com/w/cpp/algorithm/lower_bound
const lowerBound = (array, value) => {
  const index = array.findIndex(element => value <= element);
  return index == -1 ? array.length : index;
};

// See https://en.cppreference.com/w/cpp/algorithm/upper_bound
const upperBound = (array, value) => {
  const index = array.findIndex(element => value < element);
  return index == -1 ? array.length : index;
};

const bigintSign = x => (x > 0n ? 1 : (x < 0n ? -1 : 0));
const comparator = (a, b) => bigintSign(ethers.toBigInt(a) - ethers.toBigInt(b));
const hasDuplicates = array => array.some((v, index) => array.indexOf(v) != index);

describe('Arrays', function () {
  const fixture = async () => {
    return { mock: await ethers.deployContract('$Arrays') };
  };

  beforeEach(async function () {
    Object.assign(this, await loadFixture(fixture));
  });

  describe('search', function () {
    for (const [title, { array, tests }] of Object.entries({
      'Even number of elements': {
        array: [11n, 12n, 13n, 14n, 15n, 16n, 17n, 18n, 19n, 20n],
        tests: {
          'basic case': 16n,
          'first element': 11n,
          'last element': 20n,
          'searched value is over the upper boundary': 32n,
          'searched value is under the lower boundary': 2n,
        },
      },
      'Odd number of elements': {
        array: [11n, 12n, 13n, 14n, 15n, 16n, 17n, 18n, 19n, 20n, 21n],
        tests: {
          'basic case': 16n,
          'first element': 11n,
          'last element': 21n,
          'searched value is over the upper boundary': 32n,
          'searched value is under the lower boundary': 2n,
        },
      },
      'Array with gap': {
        array: [11n, 12n, 13n, 14n, 15n, 20n, 21n, 22n, 23n, 24n],
        tests: {
          'search value in gap': 17n,
        },
      },
      'Array with duplicated elements': {
        array: [0n, 10n, 10n, 10n, 10n, 10n, 10n, 10n, 20n],
        tests: {
          'search value is duplicated': 10n,
        },
      },
      'Array with duplicated first element': {
        array: [10n, 10n, 10n, 10n, 10n, 10n, 10n, 20n],
        tests: {
          'search value is duplicated first element': 10n,
        },
      },
      'Array with duplicated last element': {
        array: [0n, 10n, 10n, 10n, 10n, 10n, 10n, 10n],
        tests: {
          'search value is duplicated last element': 10n,
        },
      },
      'Empty array': {
        array: [],
        tests: {
          'always returns 0 for empty array': 10n,
        },
      },
    })) {
      describe(title, function () {
        const fixture = async () => {
          return { instance: await ethers.deployContract('Uint256ArraysMock', [array]) };
        };

        beforeEach(async function () {
          Object.assign(this, await loadFixture(fixture));
        });

        for (const [name, input] of Object.entries(tests)) {
          describe(name, function () {
            it('[deprecated] findUpperBound', async function () {
              // findUpperBound does not support duplicated
              if (hasDuplicates(array)) {
                expect(await this.instance.findUpperBound(input)).to.equal(upperBound(array, input) - 1);
              } else {
                expect(await this.instance.findUpperBound(input)).to.equal(lowerBound(array, input));
              }
            });

            it('lowerBound', async function () {
              expect(await this.instance.lowerBound(input)).to.equal(lowerBound(array, input));
              expect(await this.instance.lowerBoundMemory(array, input)).to.equal(lowerBound(array, input));
            });

            it('upperBound', async function () {
              expect(await this.instance.upperBound(input)).to.equal(upperBound(array, input));
              expect(await this.instance.upperBoundMemory(array, input)).to.equal(upperBound(array, input));
            });
          });
        }
      });
    }
  });

  for (const type of TYPES) {
    const elements = Array.from({ length: 10 }, generators[type]);

    describe(type, function () {
      const fixture = async () => {
        return { instance: await ethers.deployContract(`${capitalize(type)}ArraysMock`, [elements]) };
      };

      beforeEach(async function () {
        Object.assign(this, await loadFixture(fixture));
      });

      describe('sort', function () {
        for (const length of [0, 1, 2, 8, 32, 128]) {
          describe(`${type}[] of length ${length}`, function () {
            beforeEach(async function () {
              this.array = Array.from({ length }, generators[type]);
            });

            afterEach(async function () {
              const expected = [...this.array].sort(comparator);
              const reversed = [...expected].reverse();
              expect(await this.instance.sort(this.array)).to.deep.equal(expected);
              expect(await this.instance.sortReverse(this.array)).to.deep.equal(reversed);
            });

            it('sort array', async function () {
              // nothing to do here, beforeEach and afterEach already take care of everything.
            });

            if (length > 1) {
              it('sort array for identical elements', async function () {
                // duplicate the first value to all elements
                this.array.fill(this.array.at(0));
              });

              it('sort already sorted array', async function () {
                // pre-sort the elements
                this.array.sort(comparator);
              });

              it('sort reversed array', async function () {
                // pre-sort in reverse order
                this.array.sort(comparator).reverse();
              });

              it('sort almost sorted array', async function () {
                // pre-sort + rotate (move the last element to the front) for an almost sorted effect
                this.array.sort(comparator);
                this.array.unshift(this.array.pop());
              });
            }
          });
        }
      });

      describe('unsafeAccess', function () {
        describe('storage', function () {
          for (const index in elements) {
            it(`unsafeAccess within bounds #${index}`, async function () {
              expect(await this.instance.unsafeAccess(index)).to.equal(elements[index]);
            });
          }

          it('unsafeAccess outside bounds', async function () {
            await expect(this.instance.unsafeAccess(elements.length)).to.not.be.rejected;
          });

          it('unsafeSetLength changes the length or the array', async function () {
            const newLength = generators.uint256();

            expect(await this.instance.length()).to.equal(elements.length);
            await expect(this.instance.unsafeSetLength(newLength)).to.not.be.rejected;
            expect(await this.instance.length()).to.equal(newLength);
          });
        });

        describe('memory', function () {
          const fragment = `$unsafeMemoryAccess(${type}[] arr, uint256 pos)`;

          for (const index in elements) {
            it(`unsafeMemoryAccess within bounds #${index}`, async function () {
              expect(await this.mock[fragment](elements, index)).to.equal(elements[index]);
            });
          }

          it('unsafeMemoryAccess outside bounds', async function () {
            await expect(this.mock[fragment](elements, elements.length)).to.not.be.rejected;
          });

          it('unsafeMemoryAccess loop around', async function () {
            for (let index = 251n; index < 256n; ++index) {
              expect(await this.mock[fragment](elements, 2n ** index - 1n)).to.equal(BigInt(elements.length));
              expect(await this.mock[fragment](elements, 2n ** index + 0n)).to.equal(elements[0]);
              expect(await this.mock[fragment](elements, 2n ** index + 1n)).to.equal(elements[1]);
            }
          });
        });
      });
    });
  }
});
