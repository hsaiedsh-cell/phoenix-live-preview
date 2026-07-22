import type { Metadata } from 'next';
import { PageHero, ContactFormShell, CTAButton } from '@phoenix/ui';
import { siteConfig } from '@phoenix/config';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Request an AI readiness assessment or book a demo with Phoenix.',
};

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        headline="Let's make your AI outputs business-ready."
        subline="Request an assessment or book time with our team to see the Phoenix Platform in action."
      />

      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16">
          <div>
            <h2 className="text-2xl font-bold text-phx-navy mb-6">Get started</h2>
            <div className="space-y-4 mb-10">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-phx-surface rounded-xl p-5">
                <div>
                  <p className="text-sm font-semibold text-phx-navy">Request Assessment</p>
                  <p className="text-sm text-gray-600 mt-1">
                    Get a structured readiness assessment of your current AI outputs against the PBRS™ standard.
                  </p>
                </div>
                <CTAButton
                  label="Request Assessment"
                  href="mailto:hello@phoenixops.ai?subject=Phoenix%20Assessment%20Request"
                  variant="secondary"
                  size="sm"
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-phx-navy rounded-xl p-5">
                <div>
                  <p className="text-sm font-semibold text-white">Book a Demo</p>
                  <p className="text-sm text-gray-400 mt-1">
                    See the Phoenix Platform, PBRS™ Engine, and certification workflow in a live walkthrough.
                  </p>
                </div>
                <CTAButton
                  label="Book a Demo"
                  href="mailto:hello@phoenixops.ai?subject=Phoenix%20Demo%20Request"
                  variant="primary"
                  size="sm"
                />
              </div>
            </div>

            <div className="border-t border-gray-200 pt-8">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Email</p>
              <p className="text-sm text-gray-700">{siteConfig.email}</p>
            </div>
          </div>

          <ContactFormShell />
        </div>
      </section>
    </>
  );
}
