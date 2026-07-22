import type { Metadata } from 'next';
import { PageHero, SectionHeader, CTAButton } from '@phoenix/ui';
import { PHOENIX_PRINCIPLES } from '@phoenix/core';

export const metadata: Metadata = {
  title: 'About',
  description: 'Phoenix — the AI Business Readiness platform. Our mission, vision, philosophy, and principles.',
};

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About Phoenix"
        headline="Building the global standard for AI Business Readiness."
        subline="Phoenix exists because enterprises needed a way to answer one question consistently: is this AI output actually ready to use?"
      />

      {/* Mission / Vision */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-phx-surface rounded-2xl p-8">
            <p className="text-xs font-semibold text-phx-cyan uppercase tracking-wider mb-3">Mission</p>
            <p className="text-xl font-bold text-phx-navy leading-snug">
              Transform AI-generated outputs into trusted business assets through standards, assessment, and
              automation.
            </p>
          </div>
          <div className="bg-phx-surface rounded-2xl p-8">
            <p className="text-xs font-semibold text-phx-cyan uppercase tracking-wider mb-3">Vision</p>
            <p className="text-xl font-bold text-phx-navy leading-snug">
              To become the global standard for AI Business Readiness.
            </p>
          </div>
        </div>
      </section>

      {/* Philosophy / Why Now */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-surface">
        <div className="max-w-4xl mx-auto">
          <SectionHeader eyebrow="Philosophy" title="Why Phoenix, why now." align="left" />
          <div className="space-y-6 text-gray-600 leading-relaxed">
            <p>
              Enterprises adopted AI generation faster than they built the infrastructure to trust it.
              The result is a widening gap: AI produces content at a pace no manual review process can
              sustainably keep up with, while the cost of an unreviewed error — compliance, brand, factual —
              keeps rising.
            </p>
            <p>
              Existing AI governance frameworks focus on how systems are built and managed. None of them
              answer the more immediate question every team asks every day: is this specific output, right
              now, ready for business use? Phoenix was built to answer that question — consistently,
              measurably, and at scale.
            </p>
          </div>
        </div>
      </section>

      {/* Principles */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <SectionHeader eyebrow="Principles" title="What we build by." align="center" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {PHOENIX_PRINCIPLES.map((principle) => (
              <div key={principle.label} className="border border-gray-200 rounded-xl p-7">
                <h3 className="text-base font-bold text-phx-navy mb-2">{principle.label}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{principle.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-navy">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl lg:text-4xl font-extrabold text-white tracking-tight mb-5">
            Let&apos;s build business-ready AI.
          </h2>
          <div className="mt-8">
            <CTAButton label="Request Assessment" href="/contact" size="lg" />
          </div>
        </div>
      </section>
    </>
  );
}
