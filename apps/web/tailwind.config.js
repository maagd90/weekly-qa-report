/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        qa: {
          bg: '#F5F3ED',
          outer: '#EDEAE2',
          ink: '#1C1B18',
          accent: '#15605E',
          muted: '#78736A',
          'muted-light': '#9c978c',
          border: '#e2ded4',
          'border-mid': '#d8d3c7',
          track: '#f0ede5',
          pass: '#2F7D5A',
          fail: '#C24533',
          blocked: '#C2891E',
          ne: '#B3AEA3',
          na: '#6E89A6',
        },
      },
      fontFamily: {
        spectral: ['Spectral', 'Georgia', 'serif'],
        sans: ['Public Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      maxWidth: {
        qa: '1280px',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
