// Icons and small illustrations. All inherit color from CSS (currentColor).

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

export const SymptomsIcon = (p) => (
  <Svg {...p}>
    <g {...stroke}>
      <rect x="5" y="4" width="14" height="17" rx="2.5" />
      <path d="M9 4.5V3h6v1.5" />
      <path d="M8.5 10.5l1.5 1.5 3-3M8.5 16h7" />
    </g>
  </Svg>
);

export const BalanceIcon = (p) => (
  <Svg {...p}>
    <g {...stroke}>
      <circle cx="12" cy="4.5" r="2" />
      <path d="M12 7.5v7M12 14.5l-1 6.5M12 14.5l4.5 1.5 1.5-3M5 10l7-1.5 7 1.5" />
    </g>
  </Svg>
);

export const ReactionIcon = (p) => (
  <Svg {...p}>
    <path d="M13.5 2.5L5 13.5h6l-1.5 8 8.5-11h-6z" {...stroke} />
  </Svg>
);

export const EyeIcon = (p) => (
  <Svg {...p}>
    <g {...stroke}>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </g>
  </Svg>
);

export const UsersIcon = (p) => (
  <Svg {...p}>
    <g {...stroke}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.8a3.5 3.5 0 010 6.4M18 14.8c1.8.7 3 2.4 3.5 5.2" />
    </g>
  </Svg>
);

export const ShieldIcon = (p) => (
  <Svg {...p}>
    <g {...stroke}>
      <path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </g>
  </Svg>
);

export const PulseIcon = (p) => (
  <Svg {...p}>
    <path d="M2 12h4l3-7 4 14 3-7h6" {...stroke} />
  </Svg>
);

export const AlertIcon = (p) => (
  <Svg {...p}>
    <g {...stroke}>
      <path d="M10.3 3.8L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.8a2 2 0 00-3.4 0z" />
      <path d="M12 9.5v4.5M12 17.5h.01" />
    </g>
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
      <Icon size={Math.round(size * 0.55)} />
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
  <Svg {...p}><path d="M3 10l9-7 9 7v11h-6v-7H9v7H3z" {...stroke} /></Svg>
);
export const HistoryIcon = (p) => (
  <Svg {...p}><g {...stroke}><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></g></Svg>
);
export const BookIcon = (p) => (
  <Svg {...p}><path d="M12 5v16M12 5C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 1z" {...stroke} /></Svg>
);
