// ============================================================
// @phoenix/config — Shared Configuration
// ============================================================

export const siteConfig = {
  name: 'Phoenix',
  tagline: 'Where AI Becomes Business Ready.',
  url: 'https://phoenixops.ai',
  description: 'Phoenix helps enterprises transform AI-generated outputs into trusted, validated, business-ready assets through structured assessments, enterprise standards, and intelligent workflows.',
  email: 'hello@phoenixops.ai',
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
