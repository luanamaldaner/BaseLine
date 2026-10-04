// App name and logo in one place, so renaming is a one-line change.
export const APP_NAME = 'Baseline';
export const TAGLINE = 'Five-minute concussion screening for the sideline';

// Share Dot's static artwork with the favicon and installed app icons.
// The adjacent Baseline wordmark supplies the accessible brand name.
export function Logo({ size = 32 }) {
  return (
    <img className="logo-mark" src="/icon.svg?v=dot-1" width={size} height={size} alt="" aria-hidden="true" />
  );
}

export function Brand({ className = '' }) {
  return (
    <div className={`brand ${className}`}>
      <Logo /> <span>{APP_NAME}</span>
    </div>
  );
}
