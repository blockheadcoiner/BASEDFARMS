'use client';

import dynamic from 'next/dynamic';

// Wallet adapter touches browser-only APIs and validates RPC URLs at
// construction time. Skip SSR entirely so the build never tries to
// instantiate a Connection on the server.
const WalletProviderInner = dynamic(
  () => import('./WalletProvider').then((m) => m.WalletProvider),
  { ssr: false }
);

export function WalletProviderClient({ children }: { children: React.ReactNode }) {
  return <WalletProviderInner>{children}</WalletProviderInner>;
}
