import { PlatformShell } from '@/components/PlatformShell';
import { AuthGate } from '@/components/AuthGate';
import { ProductionAuthGate } from '@/components/ProductionAuthGate';
import { PreviewAuthGate } from '@/components/PreviewAuthGate';
import { getCurrentWorkspace, getCurrentUser } from '@/lib/api-client';
import { getPlatformAuthMode } from '@/lib/auth/platform-auth';

export default async function PlatformGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [workspace, user] = await Promise.all([getCurrentWorkspace(), getCurrentUser()]);

  // PHX-PLATFORM-010 — the platform auth mode picks which gate wraps the
  // shell. mock/real-dev keep AuthGate exactly as PHX-PLATFORM-006/008 left
  // it (mock session, "Alpha" framing, unauthenticated → mock /login).
  // production-auth uses ProductionAuthGate instead, which checks a real
  // Clerk session and never falls through to mock data.
  // PHX-DEPLOY-004C: vercel-supabase-preview uses PreviewAuthGate — same
  // fail-closed shape as ProductionAuthGate, but its Clerk session check
  // (and the Phoenix-user/role mapping underneath it) reads Supabase/
  // Postgres directly instead of calling an Express backend. workspaceName/
  // userName still come from the mock/real API layer either way — that is
  // unchanged display plumbing, not an auth decision.
  const authMode = getPlatformAuthMode();
  const Gate =
    authMode === 'production-auth' ? ProductionAuthGate : authMode === 'vercel-supabase-preview' ? PreviewAuthGate : AuthGate;

  return (
    <Gate>
      <PlatformShell workspaceName={workspace.data.name} userName={user.data.displayName}>
        {children}
      </PlatformShell>
    </Gate>
  );
}
