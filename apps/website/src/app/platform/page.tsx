import type { Metadata } from 'next';
import { PageHero, SectionHeader, CTAButton, FeatureGridItem, WorkflowTimeline, PBRSScorePreview, ProductPreviewPanel } from '@phoenix/ui';
import { SAMPLE_PBRS_SCORE } from '@phoenix/pbrs';
import { IconShield, IconGears, IconChart, IconLayers, IconGrid, IconBadge, IconDocument } from '@/components/shared/Icons';

export const metadata: Metadata = {
  title: 'Platform',
  description: 'The Phoenix Platform is the operating layer for enterprise AI readiness — assessment, validation, certification, and governance in one system.',
};

export default function PlatformPage() {
  return (
    <>
      <PageHero
        eyebrow="Platform"
        headline="The operating layer for enterprise AI readiness."
        subline="Phoenix Platform brings assessment, validation, certification, and governance together in a single system built for enterprise scale."
        primaryCTA={{ label: 'Request Assessment', href: '/contact' }}
        secondaryCTA={{ label: 'View Products', href: '/products' }}
      />

      {/* Platform Overview */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="Overview"
            title="One platform, four connected capabilities."
            description="Every AI output that enters the platform is scored, validated, tracked, and — when ready — certified."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <FeatureGridItem icon={<IconShield />} title="PBRS Engine" description="Real-time scoring against the six PBRS dimensions." />
            <FeatureGridItem icon={<IconBadge />} title="Assessment Workflow" description="Structured intake, scoring, and review pipeline for every output." />
            <FeatureGridItem icon={<IconChart />} title="Dashboard" description="A live view of readiness scores, trends, and risk across the organization." />
            <FeatureGridItem icon={<IconDocument />} title="Passport & Certification" description="Portable readiness records that travel with every certified asset." />
          </div>
        </div>
      </section>

      {/* Product Preview Panels */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-surface">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="A First Look"
            title="What the platform looks like in practice."
            description="Lightweight previews of the core surfaces — full walkthroughs available in a live demo."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <ProductPreviewPanel
              kind="dashboard"
              title="Dashboard Preview"
              description="Readiness scores and risk trends across the organization."
            />
            <ProductPreviewPanel
              kind="workflow"
              title="Assessment Workflow Preview"
              description="Intake through certification in one repeatable pipeline."
            />
            <ProductPreviewPanel
              kind="passport"
              title="PBRS Passport Preview"
              description="A portable readiness record attached to every asset."
            />
            <ProductPreviewPanel
              kind="certification"
              title="Certification Status Preview"
              description="Live certification status and tier for any output."
            />
          </div>
        </div>
      </section>

      {/* PBRS Engine detail */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-phx-cyan text-xs font-semibold tracking-[0.15em] uppercase mb-3">PBRS Engine</p>
            <h2 className="text-3xl lg:text-4xl font-extrabold text-phx-navy tracking-tight leading-tight mb-5">
              Every output, scored the same way, every time.
            </h2>
            <p className="text-gray-600 leading-relaxed mb-6">
              The PBRS Engine evaluates AI-generated content against accuracy, compliance, brand alignment,
              structure, consistency, and completeness — producing a single, comparable readiness score with
              derived risk and automation signals.
            </p>
            <CTAButton label="See the PBRS™ standard" href="/pbrs" variant="ghost" />
          </div>
          <PBRSScorePreview score={SAMPLE_PBRS_SCORE} />
        </div>
      </section>

      {/* Assessment Workflow */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-surface">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="Assessment Workflow"
            title="A repeatable path from output to certified asset."
          />
          <WorkflowTimeline
            steps={[
              { label: 'Intake', description: 'AI output is submitted to the platform for evaluation.' },
              { label: 'Score', description: 'The PBRS Engine scores across all six dimensions.' },
              { label: 'Review', description: 'Flagged outputs route to the appropriate reviewer.' },
              { label: 'Certify', description: 'Qualifying outputs receive a PBRS certification and tier.' },
            ]}
          />
        </div>
      </section>

      {/* Dashboard + Passport concepts */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-navy">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div className="bg-phx-navy-light border border-phx-navy-mid rounded-2xl p-8">
            <div className="w-11 h-11 rounded-lg bg-phx-cyan/15 flex items-center justify-center text-phx-cyan mb-5">
              <IconChart />
            </div>
            <h3 className="text-xl font-bold text-white mb-3">Governance Dashboard</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              A live view of readiness scores, certification status, and risk signals across every team,
              product line, and output type in the organization.
            </p>
          </div>
          <div className="bg-phx-navy-light border border-phx-navy-mid rounded-2xl p-8">
            <div className="w-11 h-11 rounded-lg bg-phx-cyan/15 flex items-center justify-center text-phx-cyan mb-5">
              <IconBadge />
            </div>
            <h3 className="text-xl font-bold text-white mb-3">PBRS™ Passport</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              A portable readiness record attached to every certified asset — carrying its score, tier,
              evidence trail, and certification history wherever it is used.
            </p>
          </div>
        </div>
      </section>

      {/* Enterprise Integrations placeholder */}
      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <SectionHeader
            eyebrow="Integrations"
            title="Built to fit into existing enterprise systems."
            description="Phoenix is designed to connect with the content, governance, and compliance tools already in use across the organization."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <FeatureGridItem icon={<IconGrid />} title="Content Systems" description="Connect to the platforms where AI content is generated and stored." />
            <FeatureGridItem icon={<IconShield />} title="Compliance Tools" description="Align readiness assessment with existing compliance workflows." />
            <FeatureGridItem icon={<IconLayers />} title="Identity & Access" description="Enterprise-grade access control aligned with organizational roles." />
            <FeatureGridItem icon={<IconGears />} title="Workflow Automation" description="Integrate certification into existing approval and release pipelines." />
          </div>
          <p className="mt-8 text-sm text-gray-400">
            Specific integration partners will be announced as the platform reaches general availability.
          </p>
        </div>
      </section>

      <section className="py-24 lg:py-32 px-6 lg:px-8 bg-phx-surface">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl lg:text-4xl font-extrabold text-phx-navy tracking-tight mb-5">
            See the Phoenix Platform on your own AI outputs.
          </h2>
          <div className="mt-8">
            <CTAButton label="Request Assessment" href="/contact" size="lg" />
          </div>
        </div>
      </section>
    </>
  );
}
