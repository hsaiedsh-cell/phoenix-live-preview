'use client';

// ============================================================
// IntakeForm — real Request Assessment / Book a Demo / General form
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Replaces packages/ui's ContactFormShell (a non-submitting UI
// preview) on the /contact page. Submits to POST /api/intake.
//
// Client + server validation deliberately agree on every required
// field and every max-length, by both importing from the same
// intakeRequestSchema-shaped constants — see the FIELD_LIMITS below
// mirroring src/lib/intake/schema.ts.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '@/lib/intake/config';

type RequestType = 'assessment' | 'demo' | 'general';

interface IntakeFormProps {
  initialRequestType: RequestType;
}

const FIELD_LIMITS = {
  firstName: 100,
  lastName: 100,
  company: 200,
  role: 200,
  message: 5000,
};

type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; publicReference: string }
  | { status: 'rate_limited' }
  | { status: 'in_progress' }
  | { status: 'error'; message: string };

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function IntakeForm({ initialRequestType }: IntakeFormProps) {
  const [requestType, setRequestType] = useState<RequestType>(initialRequestType);
  const [state, setState] = useState<SubmitState>({ status: 'idle' });
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const idempotencyKeyRef = useRef(generateIdempotencyKey());
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
  const turnstileWidgetRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string>('');
  const [turnstileError, setTurnstileError] = useState<string>('');

  useEffect(() => {
    setRequestType(initialRequestType);
  }, [initialRequestType]);

  useEffect(() => {
    if (!turnstileSiteKey) return;
    const w = window as unknown as {
      turnstile?: {
        render: (el: HTMLElement, opts: Record<string, unknown>) => string;
        reset: (widgetId?: string) => void;
      };
    };
    if (w.turnstile && turnstileWidgetRef.current) {
      turnstileWidgetIdRef.current = w.turnstile.render(turnstileWidgetRef.current, {
        sitekey: turnstileSiteKey,
        callback: (token: string) => {
          setTurnstileToken(token);
          setTurnstileError('');
        },
        // R1 §2.5: client-side expired/error callbacks, so a stale
        // or failed challenge is surfaced to the person immediately
        // rather than silently submitting a dead token.
        'expired-callback': () => {
          setTurnstileToken('');
          setTurnstileError('Verification expired — please complete it again.');
        },
        'error-callback': () => {
          setTurnstileToken('');
          setTurnstileError('Verification failed to load. Please refresh and try again.');
        },
      });
    }
  }, [turnstileSiteKey]);

  /** R1 §2.5: resets the Turnstile widget (forcing a fresh token) after the server reports a rejected/expired token. */
  function resetTurnstile(): void {
    setTurnstileToken('');
    const w = window as unknown as { turnstile?: { reset: (widgetId?: string) => void } };
    if (w.turnstile && turnstileWidgetIdRef.current) {
      w.turnstile.reset(turnstileWidgetIdRef.current);
    }
  }

  const isSubmitting = state.status === 'submitting';

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return; // loading state prevents duplicate submit

    const form = event.currentTarget;
    const formData = new FormData(form);

    if (!privacyConsent) {
      setState({ status: 'error', message: 'Please accept the Privacy Policy and Terms to continue.' });
      return;
    }
    if (turnstileSiteKey && !turnstileToken) {
      setState({ status: 'error', message: 'Please complete the verification challenge.' });
      return;
    }

    setState({ status: 'submitting' });

    try {
      const response = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestType,
          firstName: formData.get('firstName'),
          lastName: formData.get('lastName'),
          workEmail: formData.get('workEmail'),
          company: formData.get('company'),
          role: formData.get('role'),
          message: formData.get('message'),
          phone: formData.get('phone') || undefined,
          country: formData.get('country') || undefined,
          privacyConsent: true,
          privacyVersion: CURRENT_PRIVACY_VERSION,
          termsVersion: CURRENT_TERMS_VERSION,
          marketingConsent,
          turnstileToken: turnstileToken || 'unconfigured',
          idempotencyKey: idempotencyKeyRef.current,
        }),
      });

      if (response.status === 429) {
        setState({ status: 'rate_limited' });
        return;
      }
      if (response.status === 202) {
        // R2: a prior submission with this same idempotency key is
        // still being processed by another in-flight attempt. Not an
        // error -- do not resubmit, do not rotate the idempotency
        // key.
        setState({ status: 'in_progress' });
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (response.status === 400 || response.status === 503) {
          // 400 = Turnstile rejected this token, 503 = Turnstile
          // provider was unreachable -- either way the token is
          // spent/unusable, so force a fresh challenge before the
          // person can retry (PHX-LAUNCH-001-R1 §2.5).
          resetTurnstile();
        }
        setState({ status: 'error', message: body?.error || 'Something went wrong. Please try again.' });
        return;
      }
      const body = (await response.json()) as { publicReference: string };
      setState({ status: 'success', publicReference: body.publicReference });
      idempotencyKeyRef.current = generateIdempotencyKey();
    } catch {
      setState({ status: 'error', message: 'Network error. Please try again — you can safely resubmit.' });
    }
  }

  if (state.status === 'success') {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-8 lg:p-10" role="status">
        <h3 className="text-xl font-bold text-phx-navy mb-3">Request received</h3>
        <p className="text-sm text-gray-600 mb-4">
          Thanks — we&apos;ve received your request. Your reference number is:
        </p>
        <p className="text-lg font-mono font-semibold text-phx-cyan-dark mb-4">{state.publicReference}</p>
        <p className="text-xs text-gray-500">
          We&apos;ll follow up by email. Please keep this reference for any correspondence.
        </p>
      </div>
    );
  }

  return (
    <form
      className="bg-white border border-gray-200 rounded-2xl p-8 lg:p-10 space-y-6"
      onSubmit={handleSubmit}
      aria-busy={isSubmitting}
    >
      {turnstileSiteKey && (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" async defer />
      )}

      <div>
        <label htmlFor="requestType" className="block text-sm font-medium text-phx-navy mb-2">
          What would you like to do?
        </label>
        <select
          id="requestType"
          name="requestType"
          value={requestType}
          onChange={(e) => setRequestType(e.target.value as RequestType)}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-phx-cyan focus:border-transparent bg-white"
        >
          <option value="assessment">Request an Assessment</option>
          <option value="demo">Book a Demo</option>
          <option value="general">General Inquiry</option>
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label htmlFor="firstName" className="block text-sm font-medium text-phx-navy mb-2">
            First name
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            required
            maxLength={FIELD_LIMITS.firstName}
            autoComplete="given-name"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-phx-cyan focus:border-transparent"
            placeholder="Jane"
          />
        </div>
        <div>
          <label htmlFor="lastName" className="block text-sm font-medium text-phx-navy mb-2">
            Last name
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            required
            maxLength={FIELD_LIMITS.lastName}
            autoComplete="family-name"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-phx-cyan focus:border-transparent"
            placeholder="Doe"
          />
        </div>
      </div>

      <div>
        <label htmlFor="workEmail" className="block text-sm font-medium text-phx-navy mb-2">
          Work email
        </label>
        <input
          id="workEmail"
          name="workEmail"
          type="email"
          required
          autoComplete="email"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-phx-cyan focus:border-transparent"
          placeholder="jane@company.com"
        />
      </div>

      <div>
        <label htmlFor="company" className="block text-sm font-medium text-phx-navy mb-2">
          Company
        </label>
        <input
          id="company"
          name="company"
          type="text"
          required
          maxLength={FIELD_LIMITS.company}
          autoComplete="organization"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-phx-cyan focus:border-transparent"
          placeholder="Company name"
        />
      </div>

      <div>
        <label htmlFor="role" className="block text-sm font-medium text-phx-navy mb-2">
          Role
        </label>
        <select
          id="role"
          name="role"
          required
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-phx-cyan focus:border-transparent bg-white"
        >
          <option>Chief AI Officer</option>
          <option>Enterprise Architect</option>
          <option>AI Governance Lead</option>
          <option>Internal Audit</option>
          <option>Digital Transformation Leader</option>
          <option>Other</option>
        </select>
      </div>

      <div>
        <label htmlFor="message" className="block text-sm font-medium text-phx-navy mb-2">
          What would you like to assess?
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          required
          maxLength={FIELD_LIMITS.message}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-phx-cyan focus:border-transparent resize-none"
          placeholder="Tell us about your AI outputs and readiness goals..."
        />
      </div>

      {turnstileSiteKey ? (
        <div>
          <div ref={turnstileWidgetRef} />
          {turnstileError && (
            <p className="text-xs text-red-600 mt-2" role="alert">
              {turnstileError}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-amber-600">
          Bot verification is not configured in this environment (NEXT_PUBLIC_TURNSTILE_SITE_KEY unset).
        </p>
      )}

      <div className="space-y-3">
        <label className="flex items-start gap-3 text-xs text-gray-600">
          <input
            type="checkbox"
            required
            checked={privacyConsent}
            onChange={(e) => setPrivacyConsent(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I agree to the{' '}
            <a href="/privacy" className="underline text-phx-cyan-dark">
              Privacy Policy
            </a>{' '}
            and{' '}
            <a href="/terms" className="underline text-phx-cyan-dark">
              Terms
            </a>
            . <span className="text-red-500">Required.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={marketingConsent}
            onChange={(e) => setMarketingConsent(e.target.checked)}
            className="mt-0.5"
          />
          <span>I&apos;d like to receive occasional product updates from Phoenix. (Optional.)</span>
        </label>
      </div>

      {state.status === 'error' && (
        <p className="text-sm text-red-600" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'rate_limited' && (
        <p className="text-sm text-amber-600" role="alert">
          You&apos;ve submitted a few requests recently — please wait a bit before trying again.
        </p>
      )}
      {state.status === 'in_progress' && (
        <p className="text-sm text-amber-600" role="status">
          Your previous submission is still being processed. Please wait a moment rather than submitting again.
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full inline-flex items-center justify-center px-7 py-3.5 bg-phx-cyan text-white text-sm font-semibold rounded-lg hover:bg-phx-cyan-dark transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isSubmitting ? 'Submitting…' : 'Submit request'}
      </button>
      <p className="text-xs text-gray-400 text-center">
        This is a Private Beta. A member of the Phoenix team will follow up by email.
      </p>
    </form>
  );
}
