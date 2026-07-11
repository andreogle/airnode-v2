import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'introduction',
    {
      type: 'category',
      label: 'Run an Airnode',
      items: ['operators/index', 'operators/deployment', 'operators/publishing-endpoints'],
    },
    {
      type: 'category',
      label: 'Use an Airnode',
      items: ['consumers/getting-started', 'consumers/http-client', 'consumers/on-chain'],
    },
    {
      type: 'category',
      label: 'How it works',
      items: ['concepts/architecture', 'concepts/request-response', 'concepts/endpoint-ids', 'concepts/signing'],
    },
    {
      type: 'category',
      label: 'Optional features',
      items: ['concepts/proofs', 'concepts/fhe-encryption', 'plugins'],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        {
          type: 'category',
          label: 'Configuration',
          items: ['config/index', 'config/server', 'config/settings', 'config/apis', 'config/plugins'],
        },
        'cli',
        {
          type: 'category',
          label: 'Contracts',
          items: ['contracts/overview', 'contracts/verifier'],
        },
      ],
    },
    {
      type: 'category',
      label: 'Security',
      items: ['security/trust-model', 'security/identity-verification'],
    },
    'troubleshooting',
    {
      type: 'category',
      label: 'Project',
      items: ['v1-comparison', 'roadmap'],
    },
  ],
};

export default sidebars;
