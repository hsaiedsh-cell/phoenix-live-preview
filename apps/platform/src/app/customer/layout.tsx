import Link from 'next/link';
import { resolveProductionAuthState } from '@/lib/auth/platform-auth.server';

export default async function CustomerPortalLayout({ children }: { children: React.ReactNode }) {
  const state = await resolveProductionAuthState();
  if (state.mode !== 'signed-in') {
    return <div className="min-h-screen bg-phx-surface flex items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-extrabold text-phx-navy">Sign in to your Phoenix portal</h1>
        <p className="mt-2 text-sm text-gray-500">Access your requests, quotations, approvals, and project messages securely.</p>
        <a href="/login?redirect_url=%2Fcustomer" className="mt-6 inline-flex rounded-lg bg-phx-cyan px-5 py-3 text-sm font-semibold text-white">Sign in</a>
      </div>
    </div>;
  }
  return <div className="min-h-screen bg-phx-surface">
    <header className="border-b border-white/10 bg-phx-navy text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Link href="/customer" className="text-lg font-extrabold tracking-tight">PHOENIX <span className="text-phx-cyan">Client Portal</span></Link>
        <span className="text-xs text-gray-400">{state.email ?? 'Secure customer account'}</span>
      </div>
    </header>
    <main className="mx-auto max-w-6xl px-5 py-10">{children}</main>
  </div>;
}
