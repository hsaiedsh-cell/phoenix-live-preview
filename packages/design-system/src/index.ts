// ============================================================
// @phoenix/design-system — Brand Tokens & Design Constants
// ============================================================
// Canonical hex values. These are mirrored as CSS custom properties
// in ./tokens.css (consumed globally via Tailwind's phx-* color
// scale). Update both files together if brand colors ever change.

export const colors = {
  // Primary
  navy: '#0C1929',
  navyLight: '#132238',
  navyMid: '#1A2D47',
  navySurface: '#0F1E30',

  // Accent
  cyan: '#03A7C7',
  cyanLight: '#05C8ED',
  cyanDark: '#028BA6',
  cyanMuted: 'rgba(3, 167, 199, 0.12)',

  // Neutrals
  white: '#FFFFFF',
  gray50: '#F8F9FA',
  gray100: '#F1F3F5',
  gray200: '#E9ECEF',
  gray300: '#DEE2E6',
  gray400: '#ADB5BD',
  gray500: '#6C757D',
  gray600: '#495057',
  gray700: '#343A40',
  gray800: '#212529',

  // Semantic
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
} as const;

export const typography = {
  fontFamily: {
    sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    mono: '"JetBrains Mono", "Fira Code", monospace',
  },
  fontSize: {
    xs: '0.75rem',    // 12px
    sm: '0.875rem',   // 14px
    base: '1rem',     // 16px
    lg: '1.125rem',   // 18px
    xl: '1.25rem',    // 20px
    '2xl': '1.5rem',  // 24px
    '3xl': '1.875rem',// 30px
    '4xl': '2.25rem', // 36px
    '5xl': '3rem',    // 48px
    '6xl': '3.75rem', // 60px
    '7xl': '4.5rem',  // 72px
  },
  fontWeight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  },
  lineHeight: {
    tight: '1.1',
    snug: '1.25',
    normal: '1.5',
    relaxed: '1.625',
    loose: '1.75',
  },
  letterSpacing: {
    tighter: '-0.03em',
    tight: '-0.02em',
    normal: '0',
    wide: '0.05em',
    wider: '0.1em',
    widest: '0.15em',
  },
} as const;

export const spacing = {
  section: {
    py: 'py-24 lg:py-32',
    px: 'px-6 lg:px-8',
  },
  container: 'max-w-7xl mx-auto',
  containerNarrow: 'max-w-5xl mx-auto',
  containerWide: 'max-w-[1400px] mx-auto',
} as const;

export const motion = {
  duration: {
    fast: '150ms',
    normal: '300ms',
    slow: '500ms',
    slower: '700ms',
  },
  easing: {
    default: 'cubic-bezier(0.4, 0, 0.2, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
} as const;

export const borderRadius = {
  sm: '0.375rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  '2xl': '1.25rem',
  full: '9999px',
} as const;
