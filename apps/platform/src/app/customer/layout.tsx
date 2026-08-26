import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveProductionAuthState } from '@/lib/auth/platform-auth.server';

export default async function CustomerPortalLayout({ children }: { children: React.ReactNode }) {
  const state = await resolveProductionAuthState();
  if (state.mode !== 'signed-in') {
    redirect('/login?redirect_url=%2Fcustomer');
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
