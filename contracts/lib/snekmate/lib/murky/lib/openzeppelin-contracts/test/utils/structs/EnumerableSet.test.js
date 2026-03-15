const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { ethers } = require('hardhat');
const { TYPES } = require('../../../scripts/generate/templates/EnumerableSet.opts');
const { mapValues } = require('../../helpers/iterate');
const { generators } = require('../../helpers/random');
const { shouldBehaveLikeSet } = require('./EnumerableSet.behavior');

const getMethods = (mock, functionSigs) => {
  return mapValues(
    functionSigs,
    functionSig =>
      (...arguments_) =>
        mock.getFunction(functionSig)(0, ...arguments_),
  );
};

async function fixture() {
  const mock = await ethers.deployContract('$EnumerableSet');

  const environment = Object.fromEntries(
    TYPES.map(({ name, type }) => [
      type,
      {
        values: Array.from({ length: 3 }, generators[type]),
        methods: getMethods(mock, {
          add: `$add(uint256,${type})`,
          remove: `$remove(uint256,${type})`,
          contains: `$contains(uint256,${type})`,
          length: `$length_EnumerableSet_${name}(uint256)`,
          at: `$at_EnumerableSet_${name}(uint256,uint256)`,
          values: `$values_EnumerableSet_${name}(uint256)`,
        }),
        events: {
          addReturn: `return$add_EnumerableSet_${name}_${type}`,
          removeReturn: `return$remove_EnumerableSet_${name}_${type}`,
        },
      },
    ]),
  );

  return { mock, env: environment };
}

describe('EnumerableSet', function () {
  beforeEach(async function () {
    Object.assign(this, await loadFixture(fixture));
  });

  for (const { type } of TYPES) {
    describe(type, function () {
      beforeEach(function () {
        Object.assign(this, this.env[type]);
        [this.valueA, this.valueB, this.valueC] = this.values;
      });

      shouldBehaveLikeSet();
    });
  }
});
