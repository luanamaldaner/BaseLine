// Round initials badge with a color picked from the name.
const COLORS = ['#34d399', '#38bdf8', '#a78bfa', '#fbbf24', '#f472b6', '#fb923c'];

export default function Avatar({ name }) {
  const initials = name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
  return (
    <span className="avatar" style={{ '--ac': COLORS[hash % COLORS.length] }} aria-hidden>
      {initials}
    </span>
  );
}
