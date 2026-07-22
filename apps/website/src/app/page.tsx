import type { Metadata } from 'next';
import {
  PageHero,
  SectionHeader,
  CTAButton,
  ProductCard,
  ResourceCard,
  WorkflowTimeline,
  TrustLayerDiagram,
  DimensionGrid,
  FeatureGridItem,
  HeroPBRSProof,
} from '@phoenix/ui';
import { PBRS_DIMENSIONS, DERIVED_SIGNALS, PHOENIX_PRODUCTS, PHOENIX_SOLUTIONS } from '@phoenix/core';
import {
  IconShield,
  IconGears,
  IconChart,
  IconGrid,
  IconCompass,
  IconBadge,
} from '@/components/shared/Icons';

export const metadata: Metadata = {
  title: 'Where AI Becomes Business Ready',
  description:
    'Phoenix helps enterprises transform AI-generated outputs into trusted, validated, business-ready assets through the PBRS™ standard.',
};

const productIcons: Record<string, React.ReactNode> = {
  'pbrs-engine': <IconShield />,
  'phoenix-readiness': <IconCompass />,
  'phoenix-verify': <IconBadge />,
  'phoenix-studio': <IconGears />,
};

export default function HomePage() {
  return (
    <>
      {/* 1. Hero */}
      <PageHero
        eyebrow="Phoenix"
        headline="Where AI Becomes Business Ready."
        subline="Phoenix helps enterprises transform AI-generated outputs into trusted, validated, business-ready assets."
        primaryCTA={{ label: 'Request Assessment', href: '/contact' }}
        secondaryCTA={{ label: 'Explore PBRS™', href: '/pbrs' }}
        size="large"
        visual={<HeroPBRSProof />}
      />

      {/* 2. The Problem */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="The Problem"
            title="AI creates fast. Enterprise trust moves slowly."
            description="Every AI-generated output enters the enterprise carrying the same unresolved question: is this actually ready to use?"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <FeatureGridItem
              icon={<IconGears />}
              title="Manual Review"
              description="Teams spend significant time manually reviewing AI outputs before they can be trusted."
            />
            <FeatureGridItem
              icon={<IconShield />}
              title="Compliance Gaps"
              description="Outputs often miss regulatory and policy requirements that only surface after the fact."
            />
            <FeatureGridItem
              icon={<IconChart />}
              title="Quality Variance"
              description="The same prompt can produce wildly different quality outcomes across teams and tools."
            />
            <FeatureGridItem
              icon={<IconGrid />}
              title="No Standards"
              description="Without a shared readiness standard, every team invents its own review process."
            />
          </div>
        </div>
      </section>

      {/* 3. The Missing Layer */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-surface">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="The Missing Layer"
            title="Phoenix is the trust layer between AI and enterprise use."
            description="Every output passes through a structured readiness layer before it reaches the business."
          />
          <TrustLayerDiagram />
        </div>
      </section>

      {/* 4. What is PBRS */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="The Standard"
            title="What is PBRS™?"
            description="The Phoenix Business Readiness Standard evaluates AI-generated outputs across six weighted dimensions, producing a score, a grade, and a certification tier."
          />
          <DimensionGrid dimensions={PBRS_DIMENSIONS} />

          <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-5">
            {DERIVED_SIGNALS.map((signal) => (
              <div key={signal.key} className="bg-phx-navy rounded-xl p-6">
                <p className="text-xs text-phx-cyan font-semibold uppercase tracking-wider mb-2">
                  Derived Signal
                </p>
                <h3 className="text-base font-bold text-white mb-2">{signal.label}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{signal.description}</p>
              </div>
            ))}
          </div>

          <div className="mt-10">
            <CTAButton label="Read the full PBRS™ standard" href="/pbrs" variant="ghost" />
          </div>
        </div>
      </section>

      {/* 5. How Phoenix Works */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-navy">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="How Phoenix Works"
            title="From AI output to business ready."
            variant="dark"
          />
          <WorkflowTimeline
            variant="dark"
            steps={[
              { label: 'Discover', description: 'Assess current AI outputs, workflows, and enterprise standards.' },
              { label: 'Assess', description: 'Evaluate outputs against the six PBRS dimensions.' },
              { label: 'Validate', description: 'Verify accuracy, compliance, and operational fit.' },
              { label: 'Improve', description: 'Enhance outputs through structured, repeatable workflows.' },
              { label: 'Certify', description: 'Issue a PBRS™ certification with tier and evidence trail.' },
              { label: 'Deploy', description: 'Release business-ready assets into enterprise use.' },
            ]}
          />
        </div>
      </section>

      {/* 6. Products */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="Products"
            title="The Phoenix product suite."
            description="Four connected products, one readiness standard."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {PHOENIX_PRODUCTS.map((product) => (
              <ProductCard
                key={product.id}
                name={product.name}
                tagline={product.tagline}
                description={product.description}
                audience={product.audience}
                value={product.value}
                icon={productIcons[product.id]}
                compact
              />
            ))}
          </div>
          <div className="mt-10">
            <CTAButton label="Explore all products" href="/products" variant="ghost" />
          </div>
        </div>
      </section>

      {/* 7. Solutions */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-surface">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="Solutions"
            title="Built for every function that touches AI output."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {PHOENIX_SOLUTIONS.map((solution) => (
              <div key={solution.id} className="bg-white border border-gray-200 rounded-xl p-6">
                <h3 className="text-base font-bold text-phx-navy mb-2">{solution.function}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{solution.outcome}</p>
              </div>
            ))}
          </div>
          <div className="mt-10">
            <CTAButton label="See solutions by function" href="/solutions" variant="ghost" />
          </div>
        </div>
      </section>

      {/* 8. Resources Preview */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-16">
            <div>
              <p className="text-phx-cyan text-xs font-semibold tracking-[0.15em] uppercase mb-3">
                Knowledge Hub
              </p>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight text-phx-navy max-w-3xl">
                The research foundation behind PBRS™.
              </h2>
            </div>
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-phx-navy bg-phx-surface border border-gray-200 px-3.5 py-2 rounded-full flex-shrink-0 w-fit">
              <span className="w-1.5 h-1.5 rounded-full bg-phx-cyan" />
              Preview — Coming Soon
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <ResourceCard
              category="Research"
              title="Research Foundation"
              description="The standards and research corpus underpinning PBRS™."
            />
            <ResourceCard
              category="Methodology"
              title="PBRS™ Methodology"
              description="How the six dimensions and derived signals are calculated."
            />
            <ResourceCard
              category="Governance"
              title="AI Output Governance"
              description="Frameworks for governing AI output quality at enterprise scale."
            />
            <ResourceCard
              category="Standards"
              title="Enterprise AI Readiness"
              description="What it means for an organization to be AI business-ready."
            />
          </div>
          <div className="mt-10">
            <CTAButton label="Visit the Knowledge Hub" href="/resources" variant="ghost" />
          </div>
        </div>
      </section>

      {/* 9. Final CTA */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-navy relative overflow-hidden">
        <div className="absolute -bottom-[30%] -left-[10%] w-[60%] h-[100%] rounded-full bg-gradient-to-t from-phx-navy-light to-transparent opacity-50 pointer-events-none" />
        <div className="relative max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight">
            Ready to make AI business-ready?
          </h2>
          <p className="mt-5 text-lg text-gray-400 max-w-xl mx-auto">
            Request an assessment and see where your AI outputs stand against the PBRS™ standard.
          </p>
          <div className="mt-10">
            <CTAButton label="Request Assessment" href="/contact" size="lg" />
          </div>
        </div>
      </section>
    </>
  );
}
