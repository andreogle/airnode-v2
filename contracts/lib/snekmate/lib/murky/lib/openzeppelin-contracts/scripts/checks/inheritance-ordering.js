#!/usr/bin/env node

const path = require('node:path');
const graphlib = require('graphlib');
const { findAll } = require('solidity-ast/utils');
const { _: artifacts } = require('yargs').argv;

for (const artifact of artifacts) {
  const { output: solcOutput } = require(path.resolve(__dirname, '../..', artifact));

  const graph = new graphlib.Graph({ directed: true });
  const names = {};
  const linearized = [];

  for (const source in solcOutput.contracts) {
    if (['contracts-exposed/', 'contracts/mocks/'].some(pattern => source.startsWith(pattern))) {
      continue;
    }

    for (const contractDef of findAll('ContractDefinition', solcOutput.sources[source].ast)) {
      names[contractDef.id] = contractDef.name;
      linearized.push(contractDef.linearizedBaseContracts);

      contractDef.linearizedBaseContracts.forEach((c1, index, contracts) =>
        { for (const c2 of contracts.slice(index + 1)) {
          graph.setEdge(c1, c2);
        } },
      );
    }
  }

  /// graphlib.alg.findCycles will not find minimal cycles.
  /// We are only interested int cycles of lengths 2 (needs proof)
  graph.nodes().forEach((x, index, nodes) =>
    { for (const y of nodes
      .slice(index + 1)
      .filter(y => graph.hasEdge(x, y) && graph.hasEdge(y, x))) {
        console.log(`Conflict between ${names[x]} and ${names[y]} detected in the following dependency chains:`);
        for (const chain of linearized
          .filter(chain => chain.includes(Number.parseInt(x)) && chain.includes(Number.parseInt(y)))) {
            const comp = chain.indexOf(Number.parseInt(x)) < chain.indexOf(Number.parseInt(y)) ? '>' : '<';
            console.log(`- ${names[x]} ${comp} ${names[y]} in ${names[chain.find(Boolean)]}`);
            // console.log(`- ${names[x]} ${comp} ${names[y]}: ${chain.reverse().map(id => names[id]).join(', ')}`);
          }
        process.exitCode = 1;
      } },
  );
}

if (!process.exitCode) {
  console.log('Contract ordering is consistent.');
}
