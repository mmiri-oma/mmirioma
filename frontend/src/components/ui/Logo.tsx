import logoUrl from '../../assets/brand/mmirioma-logo.webp'

export interface LogoProps {
  /**
   * Width utilities, e.g. `w-44`. The full logo's smallest width is 120 px;
   * the height follows the image's 592 × 150 proportions.
   */
  className?: string
  /** Alt text; defaults to the brand name. */
  alt?: string
}

/**
 * Full MmiriOma logo (droplet, wave and wordmark), from the approved design
 * system ("Logo"). Always on a white surface; never stretched or recoloured.
 */
export function Logo({ className = 'w-44', alt = 'MmiriOma' }: LogoProps) {
  return (
    <img
      src={logoUrl}
      alt={alt}
      width={592}
      height={150}
      className={`block h-auto max-w-full ${className}`}
    />
  )
}
