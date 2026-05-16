import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// Audience-first navigation: a reader landing on the docs picks "I'm an
// operator" or "I'm a consumer" first, then drills into concepts /
// reference / security as needed. Concepts come after the audience tracks
// because they make more sense once you know what you're building.
const sidebars: SidebarsConfig = {
  docs: [
    'introduction',
    {
      type: 'category',
      label: 'Operators',
      items: ['operators/index', 'operators/deployment', 'operators/publishing-endpoints'],
    },
    {
      type: 'category',
      label: 'Consumers',
      items: ['consumers/getting-started', 'consumers/http-client', 'consumers/on-chain'],
    },
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'concepts/architecture',
        'concepts/request-response',
        'concepts/endpoint-ids',
        'concepts/signing',
        'concepts/proofs',
        'concepts/fhe-encryption',
      ],
    },
    {
      type: 'category',
      label: 'Config Reference',
      items: ['config/index', 'config/server', 'config/settings', 'config/apis', 'config/plugins'],
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
    'v1-comparison',
    'roadmap',
  ],
};

export default sidebars;
