import { PageHero } from '@phoenix/ui';

export default function DashboardComingSoonPage() {
  return (
    <PageHero
      eyebrow="Phoenix Dashboard"
      headline="The governance dashboard for AI readiness is coming soon."
      subline="A live view of readiness scores, certification status, and risk signals across every team, product line, and output type in the organization. This app is being built next."
      primaryCTA={{
        label: 'Request Assessment',
        href: 'mailto:hello@phoenixops.ai?subject=Phoenix%20Assessment%20Request',
      }}
      secondaryCTA={{ label: 'Visit phoenixops.ai', href: 'https://phoenixops.ai' }}
      variant="dark"
      size="large"
    />
  );
}
