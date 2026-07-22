import type { Config } from 'tailwindcss';

// Brand colors are centralized in @phoenix/design-system (packages/design-system/src/tokens.css)
// and exposed globally as CSS custom properties. Tailwind maps them here as an
// rgb(var(...) / <alpha-value>) scale so opacity modifiers (e.g. bg-phx-cyan/10) work.
// Do not hardcode hex values in this file or in components — extend tokens.css instead.
const withOpacity = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Phoenix brand scale (preferred going forward)
        phx: {
          navy: withOpacity('--phx-navy-rgb'),
          'navy-light': withOpacity('--phx-navy-light-rgb'),
          'navy-mid': withOpacity('--phx-navy-mid-rgb'),
          'navy-surface': withOpacity('--phx-navy-surface-rgb'),
          cyan: withOpacity('--phx-cyan-rgb'),
          'cyan-light': withOpacity('--phx-cyan-light-rgb'),
          'cyan-dark': withOpacity('--phx-cyan-dark-rgb'),
          surface: withOpacity('--phx-surface-rgb'),
        },
        // Legacy aliases kept for compatibility with any existing references;
        // both scales resolve to the same centralized tokens.
        navy: {
          DEFAULT: withOpacity('--phx-navy-rgb'),
          light: withOpacity('--phx-navy-light-rgb'),
          mid: withOpacity('--phx-navy-mid-rgb'),
          surface: withOpacity('--phx-navy-surface-rgb'),
        },
        cyan: {
          DEFAULT: withOpacity('--phx-cyan-rgb'),
          light: withOpacity('--phx-cyan-light-rgb'),
          dark: withOpacity('--phx-cyan-dark-rgb'),
        },
      },
      fontFamily: {
        sans: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
