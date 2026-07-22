'use client';

// PHX-PLATFORM-006 — optional mock role selector on the login screen.
// PHX-PLATFORM-008 — handles the session's `loading` state safely: the
// select is disabled and shows a neutral placeholder until the client
// has resolved the mock session, rather than assuming a role is always
// already available.
// Lets QA pick which WorkspaceRole to preview before continuing to the
// workspace. Purely a mock-session convenience — see mock-session.ts.
// No credentials are validated; there is nothing to authenticate against.

import React from 'react';
import { useRouter } from 'next/navigation';
import { usePhoenixSession } from '@/hooks/usePhoenixSession';
import { getAvailableMockUsers } from '@/lib/mock-session';

export function LoginRoleSelector() {
  const { role, switchRole, isLoading } = usePhoenixSession();
  const router = useRouter();
  const mockUsers = getAvailableMockUsers();

  return (
    <div className="space-y-2">
      <label htmlFor="mock-role" className="block text-sm font-semibold text-phx-navy mb-1.5">
        Preview role (mock alpha)
      </label>
      <select
        id="mock-role"
        value={role ?? ''}
        disabled={isLoading}
        onChange={(e) => switchRole(e.target.value as (typeof mockUsers)[number]['role'])}
        className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-phx-navy focus:outline-none focus:ring-2 focus:ring-phx-cyan/40 focus:border-phx-cyan transition-colors disabled:opacity-60 disabled:cursor-default"
      >
        {isLoading && <option value="">Resolving role...</option>}
        {mockUsers.map((mockUser) => (
          <option key={mockUser.id} value={mockUser.role}>
            {mockUser.role} — {mockUser.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        disabled={isLoading}
        onClick={() => router.push('/dashboard')}
        className="w-full inline-flex items-center justify-center px-6 py-3 rounded-lg text-sm font-semibold bg-phx-cyan text-white hover:bg-phx-cyan-dark transition-colors shadow-sm mt-1 disabled:opacity-60 disabled:cursor-default"
      >
        Continue to Workspace
      </button>
    </div>
  );
}
