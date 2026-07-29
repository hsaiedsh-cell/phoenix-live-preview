import type { Metadata } from 'next';
import { PageHero } from '@phoenix/ui';
import { CURRENT_TERMS_VERSION } from '@/lib/intake/config';

export const metadata: Metadata = {
  title: 'Terms (Draft)',
  description: 'Phoenix Private Beta Terms draft.',
};

// ============================================================
// DRAFT — NOT LEGAL ADVICE — REQUIRES QUALIFIED LEGAL REVIEW
// Public-facing draft uses the approved independent private-beta
// wording. Governing-law and dispute-resolution provisions must be
// completed and legally reviewed before any commercial launch.
// ============================================================

export default function TermsPage() {
  return (
    <>
      <PageHero
        eyebrow="Legal — Draft"
        headline="Terms"
        subline="Private Beta draft. This page is not final legal advice and requires qualified legal review before commercial publication."
      />
      <section className="py-16 lg:py-24 px-6 lg:px-8 bg-white">
        <div className="legal-content mx-auto max-w-4xl">
          <div className="mb-10 p-4 border border-amber-300 bg-amber-50 rounded-lg text-sm text-amber-800">
            <strong>Draft notice.</strong> These Terms are a Private Beta draft prepared for internal and legal
            review. They do not constitute legal advice and must not be treated as final or binding until
            reviewed and approved by qualified counsel and confirmed by the business owner. Terms version:{' '}
            <code>{CURRENT_TERMS_VERSION}</code>.
          </div>

          <p>
            PhoenixOPS is a private-beta project operated independently by its founder. These Terms govern
            access to and use of the PhoenixOPS Private Beta website and request-intake service
            (the &quot;Service&quot;). By submitting a request through the Service, you agree to these Terms.
          </p>

          <h2>1. Private Beta status</h2>
          <p>
            The Service is an early-stage Private Beta operated on a limited, invitation-adjacent basis. It is
            not a general commercial release. Features, availability, and these Terms may change without the
            same notice period a generally-available product would provide.
          </p>

          <h2>2. No guarantee of acceptance</h2>
          <p>
            Submitting a request does not guarantee that we will accept it, invite you to upload files, or
            provide a quotation. We may decline any request at our discretion, including where we determine a
            request falls outside the current Private Beta cohort or scope.
          </p>

          <h2>3. Manual quotation and payment</h2>
          <p>
            Pricing during Private Beta is handled manually. If we accept your request, we may provide a
            quotation and a payment link outside of this Service. No automated checkout or automated pricing is
            part of the Private Beta.
          </p>

          <h2>4. Your authority to upload content</h2>
          <p>
            If invited to upload files, you confirm that you have the right to share those files with us and
            that doing so does not violate any third party&apos;s rights or any applicable law.
          </p>

          <h2>5. Prohibited and unlawful content</h2>
          <p>
            You must not submit or upload content that is unlawful, infringing, malicious (including executable
            files, scripts, or macro-enabled documents), or that you do not have the right to share. We may
            reject, quarantine, or delete such content, and may decline to continue processing your request.
          </p>

          <h2>6. Confidentiality before a signed agreement</h2>
          <p>
            Information you share with us before we have entered into a signed client agreement with you is
            handled in good faith but is not subject to a formal confidentiality obligation beyond what is
            described in our Privacy Policy, unless and until a signed agreement between us states otherwise.
          </p>

          <h2>7. Intellectual property</h2>
          <p>
            You retain ownership of the content and files you submit. We retain ownership of the Service itself,
            including the Phoenix name, PBRS™ standard, and all associated software, methodology, and materials.
          </p>

          <h2>8. Service limitations</h2>
          <p>
            The Service is provided on an &quot;as is&quot; and &quot;as available&quot; basis during Private Beta,
            without warranties of any kind, to the fullest extent permitted by applicable law.
          </p>

          <h2>9. Cancellation and refunds</h2>
          <p>
            Where a manual quotation and payment link have been issued, cancellation and refund terms will be
            confirmed in writing at the time of quotation, and, where applicable, in a signed client agreement.
          </p>

          <h2>10. Acceptable use</h2>
          <p>
            You must not attempt to circumvent rate limits, bot-protection, or upload restrictions, or otherwise
            interfere with the proper operation of the Service.
          </p>

          <h2>11. Limitation of liability</h2>
          <p>
            To the fullest extent permitted by applicable law, PhoenixOPS shall not be liable for any indirect,
            incidental, special, consequential, or punitive damages arising out of or relating to your use of
            the Service.
          </p>

          <h2>12. Governing law</h2>
          <p>
            This private-beta draft does not specify a governing law or dispute-resolution forum. Final
            commercial terms will include those provisions before any commercial launch.
          </p>

          <h2>13. Contact</h2>
          <p>
            Questions about these Terms can be sent to{' '}
            <a href="mailto:hello@phoenixops.ai">hello@phoenixops.ai</a>.
          </p>
        </div>
      </section>
    </>
  );
}
