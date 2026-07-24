import type { Metadata } from 'next';
import { PageHero } from '@phoenix/ui';
import { CURRENT_PRIVACY_VERSION } from '@/lib/intake/config';

export const metadata: Metadata = {
  title: 'Privacy Policy (Draft)',
  description: 'Phoenix Private Beta Privacy Policy draft.',
};

// ============================================================
// DRAFT — NOT LEGAL ADVICE — REQUIRES QUALIFIED UAE LEGAL REVIEW
// ------------------------------------------------------------
// Per the PHX-LAUNCH-001 execution package:
//   - "PheonixOPS" is preserved EXACTLY as supplied by the owner.
//     Do not "correct" it to "PhoenixOPS" without explicit owner
//     confirmation of the intended spelling and legal entity form.
//   - Governing law is drafted as a UAE placeholder only. No court,
//     emirate, ADGM, DIFC, or other specific forum has been invented
//     or selected — see PHX-LAUNCH-001-LEGAL-DRAFT-REVIEW-NOTES.md.
//   - This page must NOT be published to production until the owner
//     confirms both of the above. See index metadata below.
// ============================================================

export default function PrivacyPolicyPage() {
  return (
    <>
      <PageHero
        eyebrow="Legal — Draft"
        headline="Privacy Policy"
        subline="Private Beta draft. This page is not final legal advice and requires qualified UAE legal review before publication."
      />
      <section className="py-16 lg:py-24 px-6 lg:px-8 bg-white">
        <div className="max-w-3xl mx-auto prose prose-sm">
          <div className="mb-10 p-4 border border-amber-300 bg-amber-50 rounded-lg text-sm text-amber-800">
            <strong>Draft notice.</strong> This Privacy Policy is a Private Beta draft prepared for internal
            and legal review. It does not constitute legal advice and must not be treated as final or
            binding until reviewed and approved by qualified counsel and confirmed by the business owner.
            Policy version: <code>{CURRENT_PRIVACY_VERSION}</code>.
          </div>

          <p>
            This Privacy Policy describes how PheonixOPS (&quot;PheonixOPS&quot;, &quot;we&quot;, &quot;us&quot;, or
            &quot;our&quot;) collects, uses, and safeguards information in connection with the Phoenix Private
            Beta website and request-intake service (the &quot;Service&quot;).
          </p>

          <h2>1. Information we collect</h2>
          <p>When you submit a request through the Service, we collect:</p>
          <ul>
            <li>Identity and contact details you provide: first name, last name, work email, company, role, and optional phone number and country.</li>
            <li>The content of your message and any estimated timeline you provide.</li>
            <li>Consent records: whether you accepted this Privacy Policy and our Terms, the version accepted, and whether you opted in to marketing communications, together with the date and time of consent.</li>
            <li>Files you choose to upload, only after we have invited you to do so through a private, single-use upload link.</li>
            <li>Limited technical information used solely for abuse prevention: a one-way cryptographic hash of your IP address and a rate-limiting counter. We do not store your raw IP address.</li>
          </ul>

          <h2>2. How we use this information</h2>
          <ul>
            <li>To review your request and respond to you by email.</li>
            <li>To invite you to a private upload flow if we accept your request for further review.</li>
            <li>To prepare a manual quotation and, where applicable, a payment link.</li>
            <li>To protect the Service against abuse, spam, and unauthorized access.</li>
            <li>To send you optional marketing communications, only if you have opted in.</li>
          </ul>

          <h2>3. Service providers</h2>
          <p>We use the following categories of service providers to operate the Service. Each processes data only as necessary to provide its function to us:</p>
          <ul>
            <li>Hosting and infrastructure (Vercel).</li>
            <li>Database and private file storage (Supabase).</li>
            <li>Transactional email delivery (Resend).</li>
            <li>Bot and abuse protection (Cloudflare Turnstile).</li>
            <li>Error monitoring (Sentry).</li>
          </ul>

          <h2>4. Storage and retention</h2>
          <p>During the Private Beta, our default retention practice is:</p>
          <ul>
            <li>Files uploaded but not finalized: deleted after 48 hours.</li>
            <li>Expired upload session metadata: retained for 30 days, then deleted.</li>
            <li>Rejected or unqualified requests and any associated files: deleted after 30 days.</li>
            <li>Data relating to an accepted client engagement: retained under the terms of a signed client agreement and our project retention policy.</li>
            <li>Operational security logs: retained for up to 90 days where our tooling permits.</li>
          </ul>

          <h2>5. Security controls and limitations</h2>
          <p>
            Uploaded files are stored in a private storage bucket that is never exposed through a public URL and
            are not automatically parsed, rendered, or processed by any automated system, including AI systems,
            during Private Beta. Files remain in a pending-review state until a member of our team has manually
            reviewed them, including endpoint/antivirus scanning before any file is opened. No security control is
            perfect, and we cannot guarantee absolute security of any information transmitted to us.
          </p>

          <h2>6. Cross-border processing</h2>
          <p>
            Our service providers may process personal data in countries other than your own, including the
            United Arab Emirates and other jurisdictions in which our providers operate infrastructure. Where
            required by applicable law, we rely on appropriate safeguards for such transfers.
          </p>

          <h2>7. Your rights</h2>
          <p>
            You may request access to, correction of, or deletion of your personal data, or withdraw marketing
            consent at any time, by contacting us at the address below. Because this is a Private Beta, some
            requests may take additional time to fulfill manually.
          </p>

          <h2>8. Private Beta limitations</h2>
          <p>
            The Service is an early-stage Private Beta. Workflows, retention practices, and this Policy may
            change as the Service develops. We will note material changes to this Policy by updating the
            version number above.
          </p>

          <h2>9. Governing law</h2>
          <p>
            <strong>[DRAFT PLACEHOLDER — PENDING OWNER CONFIRMATION]</strong> This Policy is intended to be
            governed by the laws of the United Arab Emirates. The specific Emirate, court, or free-zone forum
            (for example, Abu Dhabi courts, Dubai courts, ADGM, or DIFC) has not yet been selected and must be
            confirmed by the business owner and reviewed by qualified UAE counsel before this Policy is
            published as final.
          </p>

          <h2>10. Contact</h2>
          <p>
            For questions about this Privacy Policy, or to exercise your rights, contact us at{' '}
            <a href="mailto:hello@phoenixops.ai">hello@phoenixops.ai</a>.
          </p>
        </div>
      </section>
    </>
  );
}
