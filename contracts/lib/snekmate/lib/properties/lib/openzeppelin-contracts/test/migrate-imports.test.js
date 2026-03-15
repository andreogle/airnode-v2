const {
  promises: fs,
  constants: { F_OK },
} = require('node:fs');
const path = require('node:path');
const { expect } = require('chai');
const { pathUpdates, updateImportPaths, getUpgradeablePath } = require('../scripts/migrate-imports.js');

describe('migrate-imports.js', function () {
  it('every new path exists', async function () {
    for (const p of Object.values(pathUpdates)) {
      try {
        await fs.access(path.join('contracts', p), F_OK);
      } catch {
        await fs.access(path.join('contracts', getUpgradeablePath(p)), F_OK);
      }
    }
  });

  it('replaces import paths in a file', async function () {
    const source = `
import '@openzeppelin/contracts/math/Math.sol';
import '@openzeppelin/contracts-upgradeable/math/MathUpgradeable.sol';
    `;
    const expected = `
import '@openzeppelin/contracts/utils/math/Math.sol';
import '@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol';
    `;
    expect(updateImportPaths(source)).to.equal(expected);
  });
});
