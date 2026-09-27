/**
 * HakDaar mark: a protective shield holding the rupee sign, with a small check (your wages, verified).
 * Pure vector paths (no fonts), so it renders identically everywhere, including as the favicon.
 */
export default function Logo({ size = 40, className = '', tone = 'light' }) {
  const shield = tone === 'light' ? '#FFFFFF' : '#1F6F4A'
  const mark = tone === 'light' ? '#1F6F4A' : '#FFFFFF'
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} role="img" aria-label="HakDaar logo">
      <path d="M24 3.5 7.5 9.6v12.1c0 10.6 7 19.3 16.5 22.8 9.5-3.5 16.5-12.2 16.5-22.8V9.6L24 3.5Z" fill={shield} />
      <path d="M24 7.3 11 12.1v9.6c0 8.4 5.4 15.4 13 18.6 7.6-3.2 13-10.2 13-18.6v-9.6L24 7.3Z" fill={mark} opacity=".12" />
      {/* ₹ */}
      <g fill="none" stroke={mark} strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 14.5h14" />
        <path d="M17 20h14" />
        <path d="M19 14.5h3.5c3.3 0 5.3 2.3 5.3 5.2s-2 5.3-5.3 5.3H19l9.5 9" />
      </g>
      <circle cx="36.5" cy="36" r="6.2" fill="#D97706" stroke={shield} strokeWidth="2" />
      <path d="m33.7 36 2 2 3.6-3.8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
