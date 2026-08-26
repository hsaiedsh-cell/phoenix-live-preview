'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { realAcceptOnboardingInvitation } from '@/lib/real-api-client.client';

export function OnboardingInvitationAcceptance() {
  const [state, setState] = useState<'working' | 'accepted' | 'invalid' | 'failed'>('working');

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('token');
    window.history.replaceState(null, '', window.location.pathname);
    if (!token || !/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
      setState('invalid');
      return;
    }
    void realAcceptOnboardingInvitation(token)
      .then(() => setState('accepted'))
      .catch(() => setState('failed'));
  }, []);

  const content = {
    working: ['Accepting invitation…', 'Phoenix is validating your invitation securely.'],
    accepted: ['Invitation accepted', 'Your workspace membership is now active.'],
    invalid: ['Invalid invitation link', 'This invitation link is missing or malformed.'],
    failed: ['Invitation unavailable', 'The invitation may be expired, revoked, already used, or temporarily unavailable.'],
  }[state];

  return (
    <main className="min-h-screen bg-phx-surface flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-xs font-bold uppercase tracking-widest text-phx-cyan">Phoenix onboarding</p>
        <h1 className="mt-3 text-xl font-extrabold text-phx-navy">{content[0]}</h1>
        <p className="mt-3 text-sm leading-6 text-gray-500">{content[1]}</p>
        {state === 'accepted' && <Link href="/customer" className="mt-6 inline-flex rounded-lg bg-phx-navy px-5 py-3 text-sm font-semibold text-white">Open client portal</Link>}
      </div>
    </main>
  );
}
