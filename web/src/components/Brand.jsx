/** Wordmark. A single teal mark, no gradients. */
export function BrandMark() {
  return (
    <div className="brand" aria-label="HireTrack">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <rect width="28" height="28" rx="6" fill="var(--accent)" />
        <path d="M8 19V9m12 10V9M8 14h12" stroke="var(--accent-ink)" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <span>HireTrack</span>
    </div>
  );
}
