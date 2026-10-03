import { Component, useEffect, useId, useState } from 'react';
import { PauseIcon, PlayIcon } from './Icons.jsx';

// Dot: the app's mascot. The same little yellow face the eye test uses as
// its target, plus a helmet, arms, and legs, so the character that shows how
// a test works is the one the athlete follows in it.
//
// Drawn in SVG (scales, themes, tiny), posed with props, and animated by the
// demos below.

// Palette. One outline color and weight for every part keeps it looking
// like one drawing.
const BODY = '#fcc934';
const BODY_SHADE = '#f2a91c';
const LINE = '#4a2f17';
const LINE_W = 2.6;
const BAND = '#10b981';
const SHOE = '#10b981';
const CHEEK = '#ff8fa3';
const INK = LINE;

// Body: a slightly squashed ball.
const CX = 120, CY = 116, RX = 48, RY = 45;

const EYES = [{ x: 104, y: 117 }, { x: 136, y: 117 }];

// How far the eyes shift toward `lookAt` (SVG point in Dot's own frame).
function eyeShift(eye, lookAt) {
  if (!lookAt) return { dx: 0, dy: 0 };
  const dx = lookAt.x - eye.x, dy = lookAt.y - eye.y;
  const len = Math.hypot(dx, dy) || 1;
  return { dx: (dx / len) * 4.5, dy: (dy / len) * 3.5 };
}

// A rounded limb ("capsule") hanging from (x, y), rotated by `angle`
// degrees (0 = straight down, positive swings toward the left).
function Capsule({ x, y, angle, length, width }) {
  return (
    <rect x={-width / 2} y={-width / 2} width={width} height={length + width} rx={width / 2}
      transform={`translate(${x} ${y}) rotate(${angle})`}
      fill={BODY} stroke={LINE} strokeWidth={LINE_W} />
  );
}

// Where a capsule ends.
const tip = (x, y, angle, length) => {
  const r = (angle * Math.PI) / 180;
  return { x: x - length * Math.sin(r), y: y + length * Math.cos(r) };
};

// Chunky sneaker at a point; dir -1 points it left. back = the far foot.
function Sneaker({ x, y, dir = 1, back = false }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${dir} 1)`} opacity={back ? 0.75 : 1}>
      <path d="M-9 3 C-10 -6 -3 -9 3 -8 C9 -7 14 -3 14 3 Z" fill={SHOE} stroke={LINE} strokeWidth={LINE_W} strokeLinejoin="round" />
      <path d="M-10 3 H15 Q15 7 11 7 H-7 Q-10 7 -10 3 Z" fill="#fff" stroke={LINE} strokeWidth={LINE_W} strokeLinejoin="round" />
      <path d="M0 -5 L4 -1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </g>
  );
}

// Each leg: a hip, then one or more segments [angle, length] (two for a bent
// knee), then the shoe. back = the far foot in heel-to-toe.
const LEGS = {
  stand: [{ hip: [108, 150], segs: [[8, 32]], dir: -1 }, { hip: [132, 150], segs: [[-8, 32]], dir: 1 }],
  together: [{ hip: [113, 150], segs: [[1, 32]], dir: -1 }, { hip: [127, 150], segs: [[-1, 32]], dir: 1 }],
  // standing on the left leg; the right knee bends out and the foot lifts
  oneLeg: [{ hip: [114, 150], segs: [[1, 32]], dir: -1 }, { hip: [130, 154], segs: [[-82, 19], [12, 11]], dir: 1 }],
  tandem: [{ hip: [118, 150], segs: [[0, 25]], dir: 1, back: true }, { hip: [122, 150], segs: [[0, 33]], dir: 1 }],
};

function Legs({ pose }) {
  const legs = LEGS[pose] ?? LEGS.stand;
  return (
    <g className="dot-legs">
      {legs.map((leg, i) => {
        let [x, y] = leg.hip;
        const parts = [];
        let last = 0;
        leg.segs.forEach(([angle, length], j) => {
          parts.push(<Capsule key={j} x={x} y={y} angle={angle} length={length} width={12} />);
          ({ x, y } = tip(x, y, angle, length));
          last = angle;
        });
        return (
          <g key={i} opacity={leg.back ? 0.8 : 1}>
            {parts}
            {/* sock cuff just above the shoe */}
            <rect x="-6" y="-7" width="12" height="6" rx="2" fill="#fff" stroke={LINE} strokeWidth={LINE_W}
              transform={`translate(${x} ${y}) rotate(${last})`} />
            <Sneaker x={x} y={y + 2} dir={leg.dir} />
          </g>
        );
      })}
    </g>
  );
}

const ARMS = {
  // [shoulderX, shoulderY, angle, length]
  rest: [[76, 124, 38, 26], [164, 124, -38, 26]],
  wave: [[76, 124, 38, 26], [164, 120, -148, 26]],
  tap: [[76, 124, 38, 26], [164, 122, -88, 30]],
  phone: [[82, 128, -38, 30], [158, 128, 38, 30]],
};

function Arms({ pose }) {
  const arms = ARMS[pose] ?? ARMS.rest;
  return (
    <g className="dot-arms">
      {pose === 'phone' && (
        <g>
          <rect x="102" y="140" width="36" height="24" rx="5" fill="#2b2f36" stroke={LINE} strokeWidth={LINE_W} />
          <rect x="106" y="144" width="28" height="16" rx="2.5" fill="#7dd3fc" />
        </g>
      )}
      {arms.map(([x, y, angle, length], i) => (
        <Capsule key={i} x={x} y={y} angle={angle} length={length} width={12} />
      ))}
    </g>
  );
}

// Sporty headband, clipped to the head so it follows its curve exactly.
function Headband({ id }) {
  return (
    <g clipPath={`url(#body-${id})`}>
      <path d={`M60 84 Q${CX} 72 180 84 L180 98 Q${CX} 86 60 98 Z`} fill={BAND} />
      <path d={`M60 91 Q${CX} 79 180 91`} fill="none" stroke="#fff" strokeWidth="2.6" />
      <path d={`M60 84 Q${CX} 72 180 84 M60 98 Q${CX} 86 180 98`} fill="none" stroke={LINE} strokeWidth={LINE_W} />
    </g>
  );
}

// legs: 'stand' | 'together' | 'oneLeg' | 'tandem'
// arms: 'rest' | 'wave' | 'phone' | 'tap'
// lookAt: { x, y } point (in the same SVG) the eyes follow
export function Dot({ lookAt = null, eyesClosed = false, legs = 'stand', arms = 'rest', sway = 0, x = 0, idle = true }) {
  const id = useId().replace(/:/g, '');
  const target = lookAt && { x: lookAt.x - x, y: lookAt.y };
  const front = arms === 'phone'; // arms cross in front of the body
  return (
    <g transform={`translate(${x} 0)`}>
      <defs>
        <clipPath id={`body-${id}`}><ellipse cx={CX} cy={CY} rx={RX} ry={RY} /></clipPath>
      </defs>
      <g className="dot-sway" style={{ transform: `rotate(${sway}deg)`, transformOrigin: '120px 190px' }}>
        <ellipse cx={CX} cy="191" rx="34" ry="5" fill="#000" opacity="0.08" />
        <Legs pose={legs} />
        <g className={idle ? 'dot-bob' : ''}>
          {!front && <Arms pose={arms} />}
          {/* body with a soft shadow and a highlight, then the outline */}
          <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill={BODY} />
          <g clipPath={`url(#body-${id})`}>
            <ellipse cx={CX + 14} cy={CY + 30} rx="56" ry="30" fill={BODY_SHADE} opacity="0.45" />
            <ellipse cx={CX - 22} cy={CY - 26} rx="12" ry="7" fill="#fff" opacity="0.45" transform={`rotate(-30 ${CX - 22} ${CY - 26})`} />
          </g>
          <Headband id={id} />
          <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill="none" stroke={LINE} strokeWidth={LINE_W} />
          {/* face */}
          <ellipse cx="94" cy="131" rx="7" ry="4.5" fill={CHEEK} opacity="0.7" />
          <ellipse cx="146" cy="131" rx="7" ry="4.5" fill={CHEEK} opacity="0.7" />
          {eyesClosed ? (
            EYES.map((e) => (
              <path key={e.x} d={`M${e.x - 6} ${e.y + 1} q6 5 12 0`} fill="none" stroke={INK} strokeWidth={LINE_W} strokeLinecap="round" />
            ))
          ) : (
            <g className={idle ? 'dot-blink' : ''}>
              {EYES.map((e) => {
                const { dx, dy } = eyeShift(e, target);
                return (
                  <g key={e.x} className="dot-eye" style={{ transform: `translate(${dx}px, ${dy}px)` }}>
                    <ellipse cx={e.x} cy={e.y} rx="6" ry="8" fill={INK} />
                    <circle cx={e.x + 2} cy={e.y - 3} r="2.6" fill="#fff" />
                    <circle cx={e.x - 2.2} cy={e.y + 3.2} r="1.2" fill="#fff" />
                  </g>
                );
              })}
            </g>
          )}
          {/* open smile with a little tongue */}
          <path d="M112 131 Q120 143 128 131 Z" fill={INK} stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
          <ellipse cx="120" cy="137.5" rx="4" ry="2.4" fill="#ff7a8a" />
          {front && <Arms pose={arms} />}
        </g>
      </g>
    </g>
  );
}

// ---------------------------------------------------------------- demos

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  });
  useEffect(() => {
    try {
      const mq = matchMedia('(prefers-reduced-motion: reduce)');
      const on = () => setReduced(mq.matches);
      mq.addEventListener('change', on);
      return () => mq.removeEventListener('change', on);
    } catch { return undefined; }
  }, []);
  return reduced;
}

// Milliseconds into a looping demo, ticking while `running` (~60 times a
// second; a timer rather than animation frames, so it also runs in
// screenshot and test browsers).
function useLoop(durationMs, running) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const start = performance.now() - t;
    const id = setInterval(() => {
      const now = performance.now();
      setT((((now - start) % durationMs) + durationMs) % durationMs);
    }, 16);
    return () => clearInterval(id);
  }, [running, durationMs]); // eslint-disable-line react-hooks/exhaustive-deps
  return t;
}

// Frame around every demo: the drawing, a caption, and a pause button
// (moving content longer than 5 seconds must be pausable). With "reduce
// motion" on, demos start paused on a representative frame.
function DemoFrame({ title, caption, running, setRunning, children, viewBox = '0 0 260 230' }) {
  return (
    <figure className="demo">
      <svg viewBox={viewBox} role="img" aria-label={title} className="demo-art">{children}</svg>
      <figcaption>
        <span className="demo-caption">{caption}</span>
        <button className="ghost small-btn demo-toggle" onClick={() => setRunning(!running)}
          aria-label={running ? `Pause the ${title.toLowerCase()}` : `Play the ${title.toLowerCase()}`}>
          {running ? <><PauseIcon size={14} /> Pause</> : <><PlayIcon size={14} /> Play</>}
        </button>
      </figcaption>
    </figure>
  );
}

function useDemoState() {
  const reduced = useReducedMotion();
  const [running, setRunning] = useState(!reduced);
  return [running, setRunning];
}

// Eye pursuit: a target glides side to side; Dot's eyes follow it while the
// head stays perfectly still.
function EyeDemoRaw() {
  const [running, setRunning] = useDemoState();
  const t = useLoop(5000, running);
  const phase = running ? Math.sin((2 * Math.PI * t) / 2500) : 0.8;
  const tx = 130 + 80 * phase;
  return (
    <DemoFrame title="Eye pursuit demo" running={running} setRunning={setRunning}
      caption="Head stays still. Only the eyes follow the moving face.">
      <line x1="50" y1="36" x2="210" y2="36" stroke="currentColor" strokeOpacity="0.15" strokeWidth="2" strokeDasharray="4 6" />
      <g transform={`translate(${tx} 36)`}>
        <circle r="13" fill={BODY} stroke={LINE} strokeWidth="2" />
        <ellipse cx="-4.5" cy="-1.5" rx="2" ry="2.6" fill={INK} />
        <ellipse cx="4.5" cy="-1.5" rx="2" ry="2.6" fill={INK} />
        <path d="M-3 4 Q0 7 3 4" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <Dot x={10} lookAt={{ x: tx, y: 36 }} />
    </DemoFrame>
  );
}

// Reaction time: wait on red, tap the instant it turns green.
function ReactionDemoRaw() {
  const [running, setRunning] = useDemoState();
  // Slow enough to read every caption: wait 3 s, green ~2 s, result 2.6 s.
  const t = useLoop(8000, running);
  const ms = running ? t : 3600;
  const green = ms >= 3000 && ms < 4800;
  const tapped = ms >= 3350 && ms < 4800;
  const shown = ms >= 4800 && ms < 7400;
  const fill = green ? '#16a34a' : shown ? '#475569' : '#dc2626';
  return (
    <DemoFrame title="Reaction time demo" running={running} setRunning={setRunning}
      caption={green ? 'Green: tap right away!' : shown ? 'Nice: 280 ms.' : 'Red: wait for it…'}>
      <rect x="196" y="78" width="56" height="74" rx="12" fill={fill} />
      <text x="224" y="121" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff">
        {green ? 'TAP' : shown ? '280 ms' : 'WAIT'}
      </text>
      {tapped && ms < 3800 && (
        <g stroke="#fbbf24" strokeWidth="3" strokeLinecap="round">
          <path d="M258 104 l7 -6 M260 116 l8 0 M258 128 l7 6" />
        </g>
      )}
      <Dot x={-10} arms={tapped ? 'tap' : 'rest'} lookAt={{ x: 224, y: 115 }} />
    </DemoFrame>
  );
}

// Balance: phone flat on the chest; at the beep the eyes close; three
// stances, 20 seconds each (sped up here), with a little natural wobble.
const STANCE_DEMO = [
  { legs: 'together', label: 'Feet together' },
  { legs: 'oneLeg', label: 'One leg' },
  { legs: 'tandem', label: 'Heel to toe' },
];
function BalanceDemoRaw() {
  const [running, setRunning] = useDemoState();
  const each = 7600; // per stance: position 1.8 s, eyes closed 3.8 s, open 2 s
  const t = useLoop(each * STANCE_DEMO.length, running);
  const i = running ? Math.min(STANCE_DEMO.length - 1, Math.max(0, Math.floor(t / each))) : 1;
  const local = running ? t % each : 3000;
  const closed = local >= 1800 && local < 5600;
  const cue = local >= 1300 && local < 2200 ? 'close' : local >= 5600 && local < 7200 ? 'open' : null;
  const sway = closed ? 2.2 * Math.sin(local / 320) : 0;
  const stance = STANCE_DEMO[i];
  return (
    <DemoFrame title="Balance demo" running={running} setRunning={setRunning}
      caption={`${i + 1} of 3 · ${stance.label}: ${closed ? 'eyes closed, stay still' : local >= 5600 ? 'buzz! open your eyes' : 'get in position'}`}>
      {cue && (
        <g className="demo-cue" transform="translate(196 60)">
          <path d="M-12 -8 q-6 8 0 16 M-20 -14 q-10 14 0 28 M12 -8 q6 8 0 16 M20 -14 q10 14 0 28"
            fill="none" stroke={cue === 'close' ? '#38bdf8' : BAND} strokeWidth="3" strokeLinecap="round" />
          <circle r="5" fill={cue === 'close' ? '#38bdf8' : BAND} />
        </g>
      )}
      <Dot x={10} arms="phone" legs={stance.legs} eyesClosed={closed} sway={sway} />
    </DemoFrame>
  );
}

export const EyeDemo = safe(EyeDemoRaw);
export const ReactionDemo = safe(ReactionDemoRaw);
export const BalanceDemo = safe(BalanceDemoRaw);
const DEMOS = { eye: EyeDemoRaw, eyePhone: EyeDemoRaw, reaction: ReactionDemoRaw, balance: BalanceDemoRaw };

class DemoBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// Demos are decoration: if one ever throws, it disappears instead of
// blanking the screen around it.
function safe(Demo) {
  return function SafeDemo(props) {
    return <DemoBoundary><Demo {...props} /></DemoBoundary>;
  };
}

// The demo for a test id, if there is one.
export function TestDemo({ test }) {
  const Demo = DEMOS[test];
  return Demo ? <DemoBoundary><Demo /></DemoBoundary> : null;
}
