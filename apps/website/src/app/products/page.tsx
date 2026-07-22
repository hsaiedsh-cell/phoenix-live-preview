import type { Metadata } from 'next';
import { PageHero, SectionHeader, ProductCard, CTAButton } from '@phoenix/ui';
import { PHOENIX_PRODUCTS } from '@phoenix/core';
import { IconShield, IconCompass, IconBadge, IconGears } from '@/components/shared/Icons';

export const metadata: Metadata = {
  title: 'Products',
  description: 'The Phoenix product suite — PBRS™ Engine, Phoenix Readiness™, Phoenix Verify™, and Phoenix Studio™.',
};

const productIcons: Record<string, React.ReactNode> = {
  'pbrs-engine': <IconShield />,
  'phoenix-readiness': <IconCompass />,
  'phoenix-verify': <IconBadge />,
  'phoenix-studio': <IconGears />,
};

export default function ProductsPage() {
  return (
    <>
      <PageHero
        eyebrow="Products"
        headline="The Phoenix product suite."
        subline="Four connected products built on a single readiness standard — from scoring to certification to enterprise-ready output."
        primaryCTA={{ label: 'Request Assessment', href: '/contact' }}
        secondaryCTA={{ label: 'View Platform', href: '/platform' }}
      />

      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            title="Built to work together, ready to work independently."
            description="Each product solves a distinct part of the AI readiness problem, and each connects to the same PBRS™ standard."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            {PHOENIX_PRODUCTS.map((product) => (
              <ProductCard
                key={product.id}
                name={product.name}
                tagline={product.tagline}
                problem={product.problem}
                description={product.description}
                audience={product.audience}
                value={product.value}
                icon={productIcons[product.id]}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-surface">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl lg:text-4xl font-extrabold text-phx-navy tracking-tight mb-5">
            Not sure where to start?
          </h2>
          <p className="text-gray-600 mb-8 max-w-xl mx-auto">
            Request an assessment and we&apos;ll help identify which product fits your current AI readiness needs.
          </p>
          <CTAButton label="Request Assessment" href="/contact" size="lg" />
        </div>
      </section>
    </>
  );
}
