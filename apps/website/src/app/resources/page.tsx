import type { Metadata } from 'next';
import { PageHero, SectionHeader, ResourceCard, CTAButton } from '@phoenix/ui';

export const metadata: Metadata = {
  title: 'Resources',
  description: 'The Phoenix Knowledge Hub — the research foundation behind the PBRS™ standard.',
};

export default function ResourcesPage() {
  return (
    <>
      <PageHero
        eyebrow="Knowledge Hub"
        headline="Research and knowledge hub."
        subline="The research foundation, standards mapping, and governance thinking behind the PBRS™ standard."
        primaryCTA={{ label: 'Request Assessment', href: '/contact' }}
        secondaryCTA={{ label: 'Read the PBRS™ Standard', href: '/pbrs' }}
      />

      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-16">
            <SectionHeader
              title="Foundational research."
              description="The Knowledge Hub is in active development. Previews below give a sense of what's coming."
            />
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-phx-navy bg-phx-surface border border-gray-200 px-3.5 py-2 rounded-full flex-shrink-0 w-fit mb-16 sm:mb-0">
              <span className="w-1.5 h-1.5 rounded-full bg-phx-cyan" />
              Knowledge Hub — Building Now
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <ResourceCard
              category="Research"
              title="PBRS™ Research Foundation"
              description="The underlying research and standards mapping that established the PBRS™ model, including gap analysis against existing AI governance frameworks."
              status="Preview"
            />
            <ResourceCard
              category="Governance"
              title="AI Output Governance"
              description="A framework for governing the quality, compliance, and trustworthiness of AI-generated outputs at enterprise scale."
              status="Coming Soon"
            />
            <ResourceCard
              category="Standards"
              title="Business Readiness Standard"
              description="The full PBRS™ v1.0 standard document, covering methodology, scoring, and certification criteria."
              status="Preview"
            />
            <ResourceCard
              category="Framework"
              title="Enterprise AI Trust Layer"
              description="How Phoenix positions as a trust layer between AI generation and enterprise deployment."
              status="Coming Soon"
            />
          </div>
        </div>
      </section>

      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-surface">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl lg:text-4xl font-extrabold text-phx-navy tracking-tight mb-5">
            Want early access to published research?
          </h2>
          <div className="mt-8">
            <CTAButton label="Contact Us" href="/contact" size="lg" />
          </div>
        </div>
      </section>
    </>
  );
}
