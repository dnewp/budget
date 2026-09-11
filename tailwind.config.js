/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F7F8F6',
        ink: '#1B2733',
        'ink-soft': '#5A6672',
        spruce: '#1E5C4A',
        'spruce-deep': '#154234',
        'spruce-soft': '#E4F0EA',
        brick: '#B3382C',
        'brick-soft': '#F6E7E5',
        mist: '#DCE2DD',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        sans: ['"Instrument Sans"', 'system-ui', 'sans-serif'],
        money: ['"Spline Sans Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
