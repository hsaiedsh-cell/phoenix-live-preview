import type { Metadata } from 'next';
import { PageHero, SectionHeader, CTAButton, DimensionGrid, PBRSScorePreview, PBRSFlowDiagram } from '@phoenix/ui';
import { PBRS_DIMENSIONS, DERIVED_SIGNALS, NORMATIVE_REFERENCES } from '@phoenix/core';
import { SAMPLE_PBRS_SCORE, PBRS_MATURITY_LEVELS } from '@phoenix/pbrs';
import { IconBadge, IconDocument, IconCheck } from '@/components/shared/Icons';

export const metadata: Metadata = {
  title: 'PBRS™ Standard',
  description: 'The Phoenix Business Readiness Standard (PBRS™) — a scoring and certification system for AI-generated outputs across six weighted dimensions.',
};

export default function PBRSPage() {
  return (
    <>
      <PageHero
        eyebrow="The Standard"
        headline="PBRS™ — the Phoenix Business Readiness Standard."
        subline="A structured scoring and certification system that evaluates AI-generated outputs for enterprise use."
        primaryCTA={{ label: 'Request Assessment', href: '/contact' }}
        secondaryCTA={{ label: 'View Platform', href: '/platform' }}
      />

      {/* Definition */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-4xl mx-auto">
          <SectionHeader
            eyebrow="Definition"
            title="What PBRS™ is."
            align="left"
          />
          <p className="text-lg text-gray-600 leading-relaxed">
            PBRS™ is a proprietary scoring and certification standard that evaluates AI-generated outputs
            across six weighted dimensions of business readiness. Every assessment produces an overall score,
            a letter grade, and a certification tier — giving enterprises a consistent, repeatable way to
            determine whether an AI output is ready for business use.
          </p>
        </div>
      </section>

      {/* Why PBRS exists */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-surface">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-phx-cyan text-xs font-semibold tracking-[0.15em] uppercase mb-3">Why PBRS Exists</p>
            <h2 className="text-3xl lg:text-4xl font-extrabold text-phx-navy tracking-tight leading-tight mb-5">
              Existing frameworks govern AI systems. None govern AI output.
            </h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              Standards like ISO/IEC 42001, the NIST AI RMF, and the EU AI Act establish how AI systems
              should be built, managed, and governed. But none of them assess whether a specific piece of
              AI-generated content is ready for a specific business use.
            </p>
            <p className="text-gray-600 leading-relaxed">
              PBRS™ fills that gap — sitting on top of existing governance frameworks as an output-level
              readiness layer.
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-8">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Normative References
            </p>
            <ul className="space-y-3">
              {NORMATIVE_REFERENCES.map((ref) => (
                <li key={ref} className="flex items-center gap-3 text-sm text-gray-700">
                  <span className="text-phx-cyan"><IconCheck /></span>
                  {ref}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Six Dimensions */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="The Model"
            title="Six weighted dimensions."
            description="Every PBRS™ assessment scores an output across these six dimensions, then combines them into a single weighted readiness score."
          />
          <DimensionGrid dimensions={PBRS_DIMENSIONS} scores={SAMPLE_PBRS_SCORE.dimensions} />
        </div>
      </section>

      {/* Derived Signals */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-navy">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="Derived Signals"
            title="Beyond the score."
            description="PBRS™ also derives three additional signals from the six-dimension assessment."
            variant="dark"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {DERIVED_SIGNALS.map((signal) => (
              <div key={signal.key} className="bg-phx-navy-light border border-phx-navy-mid rounded-xl p-7">
                <h3 className="text-base font-bold text-white mb-2">{signal.label}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{signal.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PBRS Score */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-phx-cyan text-xs font-semibold tracking-[0.15em] uppercase mb-3">PBRS Score™</p>
            <h2 className="text-3xl lg:text-4xl font-extrabold text-phx-navy tracking-tight leading-tight mb-5">
              One number. Six dimensions. Full transparency.
            </h2>
            <p className="text-gray-600 leading-relaxed">
              The PBRS Score™ combines all six weighted dimensions into a single 0–100 readiness score,
              mapped to a letter grade (A+ through F) and a certification tier (Platinum, Gold, Silver, or
              Bronze).
            </p>
          </div>
          <PBRSScorePreview score={SAMPLE_PBRS_SCORE} />
        </div>
      </section>

      {/* Score → Passport → Certification Flow */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-surface">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="How It Connects"
            title="From score to certified asset."
            description="Every assessment moves through the same path — a score, a portable record, and a formal certification."
          />
          <PBRSFlowDiagram />
        </div>
      </section>

      {/* Passport & Certification */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white border border-gray-200 rounded-2xl p-8">
            <div className="w-11 h-11 rounded-lg bg-phx-cyan/10 flex items-center justify-center text-phx-cyan mb-5">
              <IconDocument />
            </div>
            <h3 className="text-xl font-bold text-phx-navy mb-3">PBRS™ Passport</h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              A portable record of an asset&apos;s readiness history — its scores over time, review notes, and
              certification status — that travels with the asset wherever it&apos;s used.
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-8">
            <div className="w-11 h-11 rounded-lg bg-phx-cyan/10 flex items-center justify-center text-phx-cyan mb-5">
              <IconBadge />
            </div>
            <h3 className="text-xl font-bold text-phx-navy mb-3">PBRS™ Certification</h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              A formal certification issued when an output meets its tier threshold, identified by a unique
              certification ID in the format PBRS-[ORG]-[YEAR]-[SEQUENCE]-[LEVEL].
            </p>
          </div>
        </div>
      </section>

      {/* Maturity Path */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-surface">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="Maturity Path"
            title="From ad-hoc to fully governed."
            description="Organizations progress through five maturity levels as PBRS™ becomes embedded in how AI output is produced and reviewed."
          />
          <div className="space-y-4">
            {PBRS_MATURITY_LEVELS.map((level) => (
              <div
                key={level.level}
                className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 bg-white border border-gray-200 rounded-xl p-6"
              >
                <div className="flex items-center gap-4 sm:w-56 flex-shrink-0">
                  <span className="w-9 h-9 rounded-full bg-phx-navy text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
                    {level.level}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-phx-navy">{level.name}</p>
                    <p className="text-xs text-gray-400">Score {level.scoreRange}</p>
                  </div>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">{level.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-navy">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl lg:text-4xl font-extrabold text-white tracking-tight mb-5">
            See where your outputs score against PBRS™.
          </h2>
          <div className="mt-8">
            <CTAButton label="Request Assessment" href="/contact" size="lg" />
          </div>
        </div>
      </section>
    </>
  );
}
