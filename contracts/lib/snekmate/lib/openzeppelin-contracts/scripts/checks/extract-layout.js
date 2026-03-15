const fs = require('node:fs');
const { extractStorageLayout } = require('@openzeppelin/upgrades-core/dist/storage/extract');
const { findAll, astDereferencer, srcDecoder } = require('solidity-ast/utils');
const { hideBin } = require('yargs/helpers');
const { argv } = require('yargs/yargs')(hideBin(process.argv));

const skipPath = ['contracts/mocks/', 'contracts-exposed/'];
const skipKind = new Set(['interface', 'library']);

function extractLayouts(path) {
  const layout = {};
  const { input, output } = JSON.parse(fs.readFileSync(path));

  const decoder = srcDecoder(input, output);
  const deref = astDereferencer(output);

  for (const source in output.contracts) {
    if (skipPath.some(prefix => source.startsWith(prefix))) {
      continue;
    }

    for (const contractDef of findAll('ContractDefinition', output.sources[source].ast)) {
      if (skipKind.has(contractDef.contractKind)) {
        continue;
      }

      layout[contractDef.name] = extractStorageLayout(
        contractDef,
        decoder,
        deref,
        output.contracts[source][contractDef.name].storageLayout,
      );
    }
  }
  return layout;
}

console.log(JSON.stringify(Object.assign(...argv._.map(extractLayouts))));
