/**
 * HakDaar emblem: the worker, the wage record and the shield (from the brand logo, text removed).
 * Shown on a black circle with a thin light border, matching the logo button on the landing page.
 */
export default function Logo({ size = 40, className = '' }) {
  return (
    <img src="/brand/hakdaar-mark.png" width={size} height={size} alt="" draggable="false"
      className={`select-none object-contain ${className}`} />
  )
}
