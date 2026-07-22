import type { Config } from 'tailwindcss';

// Brand colors are centralized in @phoenix/design-system (packages/design-system/src/tokens.css)
// and exposed globally as CSS custom properties. Do not hardcode hex values here.
const withOpacity = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
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
      },
      fontFamily: {
        sans: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
