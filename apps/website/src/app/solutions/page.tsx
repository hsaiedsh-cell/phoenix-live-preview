import type { Metadata } from 'next';
import { PageHero, SectionHeader, SolutionCard, CTAButton } from '@phoenix/ui';
import { PHOENIX_SOLUTIONS } from '@phoenix/core';
import {
  IconDocument,
  IconBolt,
  IconShield,
  IconBadge,
  IconChart,
  IconCompass,
} from '@/components/shared/Icons';

export const metadata: Metadata = {
  title: 'Solutions',
  description: 'Phoenix solutions by function — Corporate Communications, Marketing, HR, Legal, Risk & Compliance, and Executive Offices.',
};

const solutionIcons: Record<string, React.ReactNode> = {
  'corporate-comms': <IconDocument />,
  marketing: <IconBolt />,
  hr: <IconShield />,
  legal: <IconBadge />,
  'risk-compliance': <IconChart />,
  executive: <IconCompass />,
};

export default function SolutionsPage() {
  return (
    <>
      <PageHero
        eyebrow="Solutions"
        headline="Built for every function that touches AI output."
        subline="Every business function faces the same question: is this AI output ready to use? Phoenix answers it consistently, wherever the output originates."
        primaryCTA={{ label: 'Request Assessment', href: '/contact' }}
        secondaryCTA={{ label: 'View Products', href: '/products' }}
      />

      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {PHOENIX_SOLUTIONS.map((solution) => (
              <div key={solution.id} id={solution.id}>
                <SolutionCard
                  functionName={solution.function}
                  problem={solution.problem}
                  solution={solution.solution}
                  outcome={solution.outcome}
                  icon={solutionIcons[solution.id]}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-navy">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl lg:text-4xl font-extrabold text-white tracking-tight mb-5">
            Don&apos;t see your function listed?
          </h2>
          <p className="text-gray-400 mb-8 max-w-xl mx-auto">
            The PBRS™ standard applies across any team producing AI-generated content. Talk to us about your
            specific use case.
          </p>
          <CTAButton label="Request Assessment" href="/contact" size="lg" />
        </div>
      </section>
    </>
  );
}
