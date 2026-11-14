export function Mark({ className = "" }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M3 21V5h3v13h12V5h3v16z" fill="currentColor" />
      <path d="M3 1h18v2H3z" fill="#3ddc84" />
    </svg>
  );
}
