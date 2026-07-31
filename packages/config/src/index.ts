// ============================================================
// @phoenix/config — Shared Configuration
// ============================================================

// PHX-LAUNCH-001: url and email are now environment-driven, falling
// back to the existing hard-coded defaults below. Every app in this
// monorepo that imports siteConfig (website, platform, dashboard)
// keeps its exact current behavior unless it explicitly sets
// NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_CONTACT_EMAIL in its own Vercel
// project — apps/platform and apps/dashboard are out of scope for
// this sprint and are not being given those variables, so their
// build output is unchanged. Next.js inlines NEXT_PUBLIC_* at each
// app's own build time, so this is safe to share across apps.
export const siteConfig = {
  name: 'Phoenix',
  tagline: 'Where AI Becomes Business Ready.',
  url: process.env.NEXT_PUBLIC_SITE_URL || 'https://phoenixops.ai',
  description: 'Phoenix helps enterprises transform AI-generated outputs into trusted, validated, business-ready assets through structured assessments, enterprise standards, and intelligent workflows.',
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'hello@phoenixops.ai',
  social: {
    linkedin: 'https://linkedin.com/company/phoenixops',
  },
} as const;

export const navigationItems = [
  { label: 'Platform', href: '/platform' },
  { label: 'PBRS™', href: '/pbrs' },
  { label: 'Products', href: '/products' },
  { label: 'Solutions', href: '/solutions' },
  { label: 'Resources', href: '/resources' },
  { label: 'About', href: '/about' },
] as const;

export const footerSections = [
  {
    title: 'Platform',
    links: [
      { label: 'Overview', href: '/platform' },
      { label: 'PBRS™ Standard', href: '/pbrs' },
      { label: 'Products', href: '/products' },
    ],
  },
  {
    title: 'Solutions',
    links: [
      { label: 'Corporate Communications', href: '/solutions#corporate-comms' },
      { label: 'Marketing', href: '/solutions#marketing' },
      { label: 'Legal', href: '/solutions#legal' },
      { label: 'Risk & Compliance', href: '/solutions#risk-compliance' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Research Foundation', href: '/resources' },
      { label: 'AI Output Governance', href: '/resources' },
      { label: 'Business Readiness', href: '/resources' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Contact', href: '/contact' },
    ],
  },
] as const;
