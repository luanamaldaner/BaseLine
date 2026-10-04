// App name and logo in one place, so renaming is a one-line change.
export const APP_NAME = 'Baseline';
export const TAGLINE = 'Five-minute concussion screening for the sideline';

// Rounded tile with a pulse line that resolves into a check mark.
export function Logo({ size = 32 }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="#10b981" />
      <path
        d="M6 21h6l3-7 5 14 3.5-9 2.5 4.5L34 12"
        fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

export function Brand({ className = '' }) {
  return (
    <div className={`brand ${className}`}>
      <Logo /> <span>{APP_NAME}</span>
    </div>
  );
}
