// Dot emojis: tiny versions of the mascot's face, used instead of system
// emoji so they look the same on every device and match the app.
//
//   mood: 'happy'  smiling eyes (done, complete)
//         'talk'   open mouth + sound waves (read aloud)
//         'sound'  wide eyes + sound waves on both sides (turn the sound on)

const BODY = '#fcc934';
const LINE = '#4a2f17';
const BAND = '#10b981';
const CHEEK = '#ff8fa3';

export default function DotEmoji({ mood = 'happy', size = 20, label }) {
  const waves = mood === 'talk' || mood === 'sound';
  return (
    <svg
      className="dot-emoji"
      viewBox={waves ? '-6 0 44 32' : '0 0 32 32'}
      width={waves ? size * 1.375 : size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <clipPath id={`dotemoji-${mood}`}><circle cx="16" cy="17" r="12.5" /></clipPath>
      </defs>
      <circle cx="16" cy="17" r="12.5" fill={BODY} />
      {/* headband */}
      <g clipPath={`url(#dotemoji-${mood})`}>
        <path d="M2 8.5 Q16 5 30 8.5 L30 12.5 Q16 9 2 12.5 Z" fill={BAND} />
        <path d="M2 10.5 Q16 7 30 10.5" fill="none" stroke="#fff" strokeWidth="1" />
      </g>
      <circle cx="16" cy="17" r="12.5" fill="none" stroke={LINE} strokeWidth="1.6" />
      <ellipse cx="9.5" cy="21" rx="2.2" ry="1.4" fill={CHEEK} opacity="0.75" />
      <ellipse cx="22.5" cy="21" rx="2.2" ry="1.4" fill={CHEEK} opacity="0.75" />

      {mood === 'happy' && (
        <>
          <path d="M9.5 17 q2 -2.4 4 0 M18.5 17 q2 -2.4 4 0" fill="none" stroke={LINE} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M12.5 21 Q16 25.5 19.5 21 Z" fill={LINE} />
        </>
      )}
      {mood === 'talk' && (
        <>
          <ellipse cx="11.5" cy="16.5" rx="1.6" ry="2.1" fill={LINE} />
          <ellipse cx="20.5" cy="16.5" rx="1.6" ry="2.1" fill={LINE} />
          <ellipse cx="16" cy="22.2" rx="2.2" ry="2.4" fill={LINE} />
        </>
      )}
      {mood === 'sound' && (
        <>
          <circle cx="11.5" cy="16.5" r="2.3" fill={LINE} />
          <circle cx="20.5" cy="16.5" r="2.3" fill={LINE} />
          <circle cx="12.2" cy="15.7" r="0.7" fill="#fff" />
          <circle cx="21.2" cy="15.7" r="0.7" fill="#fff" />
          <path d="M13.5 21.5 Q16 24 18.5 21.5" fill="none" stroke={LINE} strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}

      {waves && (
        <g fill="none" stroke={BAND} strokeWidth="1.8" strokeLinecap="round">
          <path d="M31.5 13 q2.5 4 0 8" />
          <path d="M34.5 10.5 q4 6.5 0 13" />
          {mood === 'sound' && (
            <>
              <path d="M0.5 13 q-2.5 4 0 8" />
              <path d="M-2.5 10.5 q-4 6.5 0 13" />
            </>
          )}
        </g>
      )}
    </svg>
  );
}
