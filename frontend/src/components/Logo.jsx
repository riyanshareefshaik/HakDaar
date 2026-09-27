/**
 * HakDaar emblem: the worker, the wage record and the shield (from the brand logo, text removed).
 * It is a detailed colour mark, so it is always placed on a white circle (see Header, replies, welcome card).
 */
export default function Logo({ size = 40, className = '' }) {
  return (
    <img src="/brand/hakdaar-mark.png" width={size} height={size} alt="" draggable="false"
      className={`select-none object-contain ${className}`} />
  )
}
