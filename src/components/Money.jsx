import { formatCents } from '../api.js'

export function Money({ cents, className = '', tone = 'auto' }) {
  const color =
    tone === 'plain'
      ? ''
      : cents < 0
        ? 'text-brick'
        : tone === 'positive' && cents > 0
          ? 'text-spruce'
          : ''
  return <span className={`font-money tabular-nums ${color} ${className}`}>{formatCents(cents)}</span>
}

// Parses what a person actually types: 12, 12.5, $1,234.56, -8.99
export function parseAmount(input) {
  const cleaned = String(input).replace(/[$,\s]/g, '')
  if (!/^-?\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '-') return null
  return Math.round(parseFloat(cleaned) * 100)
}
