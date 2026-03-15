import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';

export default function Home(): React.JSX.Element {
  return (
    <Layout title="Airnode" description="First-party oracle node for Web3 APIs">
      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 'calc(100vh - 60px)',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <p
          style={{
            fontSize: '0.8rem',
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            opacity: 0.6,
            marginBottom: '1rem',
          }}
        >
          by API3
        </p>
        <h1
          style={{
            fontSize: 'clamp(2.5rem, 6vw, 4rem)',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.1,
            marginBottom: '1.25rem',
          }}
        >
          Airnode
        </h1>
        <p
          style={{
            fontSize: '1.2rem',
            maxWidth: '520px',
            marginBottom: '2rem',
            opacity: 0.6,
            lineHeight: 1.6,
          }}
        >
          First-party oracle node. API providers serve data on-chain directly — no middlemen, no trust assumptions.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Link className="button button--primary button--lg" to="/docs">
            Get Started
          </Link>
          <Link className="button button--secondary button--lg" href="https://github.com/andreogle/airnode-v2">
            GitHub
          </Link>
        </div>
      </main>
    </Layout>
  );
}
