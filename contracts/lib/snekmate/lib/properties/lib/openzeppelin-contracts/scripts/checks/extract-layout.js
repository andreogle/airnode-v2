const fs = require('node:fs');
const { astDereferencer } = require('@openzeppelin/upgrades-core/dist/ast-dereferencer');
const { solcInputOutputDecoder } = require('@openzeppelin/upgrades-core/dist/src-decoder');
const { extractStorageLayout } = require('@openzeppelin/upgrades-core/dist/storage/extract');
const { findAll } = require('solidity-ast/utils');
const { _ } = require('yargs').argv;

const skipPath = ['contracts/mocks/', 'contracts-exposed/'];
const skipKind = new Set(['interface', 'library']);

function extractLayouts(path) {
  const layout = {};
  const { input, output } = JSON.parse(fs.readFileSync(path));

  const decoder = solcInputOutputDecoder(input, output);
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

console.log(JSON.stringify(Object.assign(..._.map(extractLayouts))));
