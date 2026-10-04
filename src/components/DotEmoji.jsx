// Dot emojis: little pictures of the mascot used instead of system emoji, so
// they look the same on every device and match the app. They're PNG images
// with transparent backgrounds in public/emoji/ (dot-*.png made from
// scripts/emoji/art.html by scripts/emoji/render.sh); replace a file with
// another of the same name to change the art.
//
//   mood: 'happy'  grinning (done, complete)
//         'talk'   talking, with sound waves (read aloud)
//         'sound'  sound waves on both sides (turn the sound on)
//   preset: a Dot color for profile pictures (round pictures, pfp-*.png)

const BASE = import.meta.env.BASE_URL;

// Dot color presets people can pick as their profile picture.
export const DOT_PRESETS = {
  yellow: { label: 'Yellow' },
  green: { label: 'Green' },
  blue: { label: 'Blue' },
  pink: { label: 'Pink' },
  purple: { label: 'Purple' },
  red: { label: 'Red' },
};

// Names the presets had before, so pictures people already picked still show.
const OLD_NAMES = { sunny: 'yellow', mint: 'green', sky: 'blue', berry: 'pink', grape: 'purple', tangerine: 'red' };

export function presetId(id) {
  const name = OLD_NAMES[id] ?? id;
  return DOT_PRESETS[name] ? name : 'yellow';
}

// The sound-wave pictures draw the face smaller to fit the waves, so they're
// shown a bit larger to keep the face the same size as the others.
const WAVE_SCALE = 1.24;

export default function DotEmoji({ mood = 'happy', size = 20, label, preset }) {
  const file = preset ? `pfp-${presetId(preset)}` : `dot-${mood}`;
  const px = Math.round(!preset && (mood === 'talk' || mood === 'sound') ? size * WAVE_SCALE : size);
  return (
    <img
      className={preset ? 'dot-emoji dot-pfp' : 'dot-emoji'}
      src={`${BASE}emoji/${file}.png`}
      width={px}
      height={px}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      draggable={false}
      decoding="async"
    />
  );
}
