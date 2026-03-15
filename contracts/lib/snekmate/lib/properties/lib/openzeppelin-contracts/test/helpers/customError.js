const { config } = require('hardhat');

const optimizationsEnabled = config.solidity.compilers.some(c => c.settings.optimizer.enabled);

/** Revert handler that supports custom errors. */
async function expectRevertCustomError(promise, reason) {
  try {
    await promise;
    expect.fail("Expected promise to throw but it didn't");
  } catch (error) {
    if (reason) {
      if (optimizationsEnabled) {
        // Optimizations currently mess with Hardhat's decoding of custom errors
        expect(error.message).to.include.oneOf([reason, 'unrecognized return data or custom error']);
      } else {
        expect(error.message).to.include(reason);
      }
    }
  }
}

module.exports = {
  expectRevertCustomError,
};
