import { useSession } from '../lib/session.js';
import DotEmoji from './DotEmoji.jsx';

// Someone's profile picture: their photo, the Dot they picked, or (until
// they choose one) their initials on a color picked from their name.
const COLORS = ['#34d399', '#38bdf8', '#a78bfa', '#fbbf24', '#f472b6', '#fb923c'];

export default function Avatar({ name, uid, size }) {
  const { avatars } = useSession();
  const avatar = uid ? avatars?.get(uid) : null;
  const style = size ? { width: size, height: size, fontSize: size * 0.36 } : undefined;

  if (avatar?.kind === 'photo' && avatar.photo) {
    return <img className="avatar avatar-photo" src={avatar.photo} alt="" style={style} />;
  }
  if (avatar?.kind === 'dot') {
    return (
      <span className="avatar avatar-dot" style={style} aria-hidden>
        <DotEmoji mood="happy" preset={avatar.dot} size={size || 44} />
      </span>
    );
  }
  const initials = name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
  return (
    <span className="avatar" style={{ '--ac': COLORS[hash % COLORS.length], ...style }} aria-hidden>
      {initials}
    </span>
  );
}
