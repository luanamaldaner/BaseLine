// Icons and small illustrations. The UI glyphs (check, close, arrows) take
// their color from CSS; the rest are hand-made in Dot's style.

const stroke = {
  fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
};

function Svg({ size = 24, children, label }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role={label ? 'img' : undefined}
      aria-label={label} aria-hidden={label ? undefined : true}>
      {children}
    </svg>
  );
}

// Hand-made icons in Dot's style: the same brown outline and flat colors as
// the mascot, so nothing looks like a stock icon pack.
const L = '#4a2f17'; // outline
const W = 1.6; // outline width
const Y = '#fcc934'; // Dot yellow
const G = '#10b981'; // headband green
// Free-standing lines (arms, legs, lashes, speed lines) switch to a light
// color in dark mode; outlines around filled shapes stay brown.
const LINE_FREE = 'var(--icon-line)';
const ln = { fill: 'none', stroke: LINE_FREE, strokeWidth: W, strokeLinecap: 'round', strokeLinejoin: 'round' };
const fillLine = (fill) => ({ fill, stroke: L, strokeWidth: W, strokeLinejoin: 'round' });

export const SymptomsIcon = (p) => (
  <Svg {...p}>
    <rect x="5" y="4" width="14" height="17" rx="2.5" {...fillLine('#c98a4b')} />
    <rect x="7.5" y="6.5" width="9" height="12.5" rx="1" fill="#fff" />
    <rect x="9" y="2.8" width="6" height="3" rx="1.2" {...fillLine('#e5e7eb')} />
    <path d="M9 11l1.5 1.5 3-3" fill="none" stroke={G} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 16h6" fill="none" stroke="#94a3b8" strokeWidth="1.6" strokeLinecap="round" />
  </Svg>
);

export const BalanceIcon = (p) => (
  <Svg {...p}>
    {/* a tiny Dot balancing on one leg */}
    <path d="M7 10.5L4.5 9M17 10.5l2.5-1.5" {...ln} />
    <path d="M11 14.5V20M13 14.5l3 1.8-2 1.5" {...ln} />
    <ellipse cx="10.4" cy="20.6" rx="2.2" ry="1.1" {...fillLine(G)} />
    <circle cx="12" cy="9.5" r="5.5" {...fillLine(Y)} />
    <path d="M6.8 7.6Q12 5.6 17.2 7.6" fill="none" stroke={G} strokeWidth="1.8" />
    <circle cx="10.2" cy="9.6" r="0.9" fill={L} />
    <circle cx="13.8" cy="9.6" r="0.9" fill={L} />
    <path d="M10.8 11.8q1.2 1 2.4 0" {...ln} strokeWidth="1.2" />
  </Svg>
);

export const ReactionIcon = (p) => (
  <Svg {...p}>
    <path d="M14 2.5L5.5 13.5h5.5l-1.5 8 9-11.5H13z" {...fillLine(Y)} />
    <path d="M3 6h3M2 9.5h2.5M19 16h2.5M18.5 19.5h3" {...ln} />
  </Svg>
);

export const EyeIcon = (p) => (
  <Svg {...p}>
    <path d="M2.5 13s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6z" {...fillLine('#fff')} />
    <circle cx="12" cy="13" r="3.6" fill={G} stroke={L} strokeWidth="1.2" />
    <circle cx="12" cy="13" r="1.6" fill={L} />
    <circle cx="13.2" cy="11.8" r="0.8" fill="#fff" />
    <path d="M7 6.5L6 4.5M12 5V3M17 6.5l1-2" {...ln} />
  </Svg>
);

export const UsersIcon = (p) => (
  <Svg {...p}>
    {/* two Dots: a teammate behind, one in front */}
    <circle cx="15.5" cy="10" r="4.8" {...fillLine('#fde68a')} />
    <path d="M11 8.4Q15.5 6.6 20 8.4" fill="none" stroke="#38bdf8" strokeWidth="1.6" />
    <circle cx="9" cy="13" r="6" {...fillLine(Y)} />
    <path d="M3.4 11Q9 8.8 14.6 11" fill="none" stroke={G} strokeWidth="1.8" />
    <circle cx="7.2" cy="13.4" r="0.9" fill={L} />
    <circle cx="10.8" cy="13.4" r="0.9" fill={L} />
    <path d="M7.8 15.6q1.2 1 2.4 0" {...ln} strokeWidth="1.2" />
  </Svg>
);

export const ShieldIcon = (p) => (
  <Svg {...p}>
    <path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z" {...fillLine(G)} />
    <path d="M8.3 12l2.6 2.6 4.8-5.2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const PulseIcon = (p) => (
  <Svg {...p}>
    <path d="M12 20.5S3 15 3 8.8C3 6 5 4 7.4 4c2 0 3.4 1.2 4.6 3 1.2-1.8 2.6-3 4.6-3C19 4 21 6 21 8.8c0 6.2-9 11.7-9 11.7z" {...fillLine('#ff8fa3')} />
    <path d="M5 11h3.2l1.6-3 2.4 6 1.6-3H19" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const AlertIcon = (p) => (
  <Svg {...p}>
    <path d="M10.3 3.8L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.8a2 2 0 00-3.4 0z" {...fillLine('#fbbf24')} />
    <path d="M12 9v5" stroke={L} strokeWidth="2.2" strokeLinecap="round" />
    <circle cx="12" cy="17.3" r="1.3" fill={L} />
  </Svg>
);

export const ArrowIcon = (p) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" {...stroke} />
  </Svg>
);

// Each test's color and icon, used on cards, step headers, and the dashboard.
export const TEST_THEME = {
  symptoms: { color: '#a78bfa', Icon: SymptomsIcon },
  balance: { color: '#38bdf8', Icon: BalanceIcon },
  reaction: { color: '#fbbf24', Icon: ReactionIcon },
  eye: { color: '#34d399', Icon: EyeIcon },
  eyePhone: { color: '#34d399', Icon: EyeIcon },
};

// Colored rounded tile holding a test's icon.
export function TestBadge({ id, size = 44 }) {
  const theme = TEST_THEME[id];
  if (!theme) return null;
  const { Icon, color } = theme;
  return (
    <span className="test-badge" style={{ '--tc': color, width: size, height: size }}>
      <Icon size={Math.round(size * 0.74)} />
    </span>
  );
}

// ---- Balance stances, seen from above: where the feet go ----

function Foot({ x, y, rotate = 0, lifted = false }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`} className={lifted ? 'foot lifted' : 'foot'}>
      <path d="M0 -26c9 0 12 9 11 20-1 12-3 26-11 26s-10-14-11-26c-1-11 2-20 11-20z" />
      {[-7, -2.5, 2, 6].map((tx, i) => (
        <circle key={i} cx={tx} cy={-31 + Math.abs(tx) * 0.35} r={i === 0 ? 3.2 : 2.4} />
      ))}
    </g>
  );
}

export function StanceDiagram({ id, size = 140 }) {
  const label = {
    double: 'Feet side by side, touching',
    single: 'Standing on one foot, the other lifted',
    tandem: 'One foot directly in front of the other, heel to toe',
  }[id];
  return (
    <svg className="stance-diagram" width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={label}>
      <rect x="2" y="2" width="116" height="116" rx="18" className="stance-floor" />
      {id === 'double' && (<><Foot x={47} y={64} /><Foot x={73} y={64} /></>)}
      {id === 'single' && (<><Foot x={48} y={64} /><Foot x={76} y={58} lifted /></>)}
      {id === 'tandem' && (<><Foot x={60} y={36} rotate={0} /><Foot x={60} y={92} rotate={0} /></>)}
    </svg>
  );
}

export const HomeIcon = (p) => (
  <Svg {...p}>
    <path d="M5 10.5V20h14v-9.5" {...fillLine(Y)} />
    <path d="M2.5 11.5L12 3.5l9.5 8" {...fillLine(G)} />
    <rect x="10" y="14" width="4" height="6" rx="1" {...fillLine('#c98a4b')} />
  </Svg>
);
export const HistoryIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12.5" r="8.5" {...fillLine('#fff')} />
    <path d="M12 7.5v5l3.5 2" fill="none" stroke={G} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 2.8h8" {...ln} />
  </Svg>
);
export const BookIcon = (p) => (
  <Svg {...p}>
    <path d="M12 6.5C9.5 4.5 6 4.3 2.5 5v14c3.5-.7 7-.5 9.5 1.5z" {...fillLine('#fff')} />
    <path d="M12 6.5c2.5-2 6-2.2 9.5-1.5v14c-3.5-.7-7-.5-9.5 1.5z" {...fillLine(G)} />
    <path d="M5 9h4M5 12h4M15 9h4M15 12h4" fill="none" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
  </Svg>
);

// Small UI glyphs, drawn so they match the app instead of the device's
// emoji font.
export const CheckIcon = (p) => (
  <Svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" {...stroke} strokeWidth="2.6" /></Svg>
);
export const CloseIcon = (p) => (
  <Svg {...p}><path d="M6 6l12 12M18 6L6 18" {...stroke} strokeWidth="2.4" /></Svg>
);
export const BackIcon = (p) => (
  <Svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" {...stroke} /></Svg>
);
export const PlayIcon = (p) => (
  <Svg {...p}><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></Svg>
);
export const PauseIcon = (p) => (
  <Svg {...p}><g fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2" /><rect x="13.5" y="5" width="4" height="14" rx="1.2" /></g></Svg>
);
