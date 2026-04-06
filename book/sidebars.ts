import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'introduction',
    'v1-comparison',
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'concepts/architecture',
        'concepts/request-response',
        'concepts/endpoint-ids',
        'concepts/signing',
        'concepts/proofs',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: ['guides/system-overview'],
    },
    {
      type: 'category',
      label: 'Config',
      items: ['config/index', 'config/server', 'config/settings', 'config/apis', 'config/plugins'],
    },
    {
      type: 'category',
      label: 'Airnode Operators',
      items: ['operators/index', 'operators/deployment'],
    },
    {
      type: 'category',
      label: 'Consumers',
      items: ['consumers/getting-started', 'consumers/http-client', 'consumers/on-chain'],
    },
    'plugins',
    {
      type: 'category',
      label: 'Contracts',
      items: ['contracts/overview', 'contracts/verifier'],
    },
    {
      type: 'category',
      label: 'Security',
      items: ['security/trust-model', 'security/identity-verification'],
    },
    'troubleshooting',
    'cli',
    'roadmap',
  ],
};

export default sidebars;
