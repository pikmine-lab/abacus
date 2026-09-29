import { NfcIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The grounds a card is drawn on: deep and desaturated, so a wall of cards
 * stays in the night-blue family of the page while each one keeps a face of
 * its own. The copper accent is kept out on purpose, it marks what is active.
 */
const GROUNDS: [string, string][] = [
  ['#1e2d4a', '#0d1422'],
  ['#163d3e', '#0a1c1f'],
  ['#37243f', '#160e1c'],
  ['#2c3343', '#11151d'],
  ['#401e28', '#1a0c11'],
  ['#1e3628', '#0c1811'],
  ['#3b2d1a', '#19130a'],
  ['#292d5e', '#10122a'],
]

/** FNV-1a: the card's id always hashes to the same face, on the server and in the browser. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** A small seeded generator (mulberry32), so every parameter of a face derives from one id. */
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const W = 320
const H = 202

/**
 * One of four patterns, placed and tuned by the seed. Hairlines and specks
 * only: the face is a texture, not a picture. Each mark is keyed by where it
 * sits, which is what tells it apart.
 */
function Pattern({ random }: { random: () => number }) {
  const kind = Math.floor(random() * 4)
  const stroke = { stroke: 'white', strokeOpacity: 0.09, fill: 'none', strokeWidth: 1 }
  if (kind === 0) {
    // Rings spreading from a point off one edge.
    const cx = random() > 0.5 ? W * (0.8 + random() * 0.4) : W * (-0.2 + random() * 0.3)
    const cy = H * (random() * 1.2 - 0.1)
    const step = 14 + random() * 10
    const radii = Array.from({ length: 22 }, (_, i) => step * (i + 1))
    return (
      <g {...stroke}>
        {radii.map((r) => (
          <circle key={r} cx={cx} cy={cy} r={r} />
        ))}
      </g>
    )
  }
  if (kind === 1) {
    // Contour lines, the way a map draws a slope.
    const amplitude = 6 + random() * 14
    const frequency = (1 + random() * 2) / W
    const phase = random() * Math.PI * 2
    const drift = random() * 0.8
    const contours = Array.from({ length: 16 }, (_, i) => {
      const base = (i + 0.5) * (H / 14) - H * 0.05
      return Array.from({ length: 33 }, (_, j) => {
        const x = (j / 32) * W
        const y =
          base + amplitude * Math.sin(x * frequency * Math.PI * 2 + phase + i * drift) * (0.6 + i / 32)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      }).join(' ')
    })
    return (
      <g {...stroke}>
        {contours.map((points) => (
          <polyline key={points} points={points} />
        ))}
      </g>
    )
  }
  if (kind === 2) {
    // Parallel hairlines at an angle, denser on one side.
    const angle = -60 + random() * 120
    const gap = 7 + random() * 6
    return (
      <g {...stroke} transform={`rotate(${angle.toFixed(1)} ${W / 2} ${H / 2})`}>
        {Array.from({ length: 70 }, (_, i) => ({ x: -W + i * gap, opacity: 0.03 + (i / 70) * 0.09 })).map(
          ({ x, opacity }) => (
            <line key={x} x1={x} y1={-H} x2={x} y2={H * 2} strokeOpacity={opacity} />
          ),
        )}
      </g>
    )
  }
  // A dot grid fading away from one corner.
  const gap = 12 + random() * 6
  const ox = random() > 0.5 ? W : 0
  const oy = random() > 0.5 ? H : 0
  const reach = Math.hypot(W, H) * (0.7 + random() * 0.3)
  const dots: React.ReactNode[] = []
  for (let x = gap / 2; x < W; x += gap)
    for (let y = gap / 2; y < H; y += gap) {
      const fade = 1 - Math.hypot(x - ox, y - oy) / reach
      if (fade > 0)
        dots.push(<circle key={`${x}-${y}`} cx={x} cy={y} r={1.1} fill="white" fillOpacity={0.16 * fade} />)
    }
  return <g>{dots}</g>
}

/** The contact chip, in silver: gold would read as the copper accent. */
function Chip({ uid }: { uid: string }) {
  return (
    <svg viewBox="0 0 34 26" className="h-[26px] w-[34px]" aria-hidden="true">
      <defs>
        <linearGradient id={`chip-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e3e7ee" />
          <stop offset="0.5" stopColor="#aab2bf" />
          <stop offset="1" stopColor="#7b8494" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="33" height="25" rx="5" fill={`url(#chip-${uid})`} />
      <g stroke="#11151d" strokeOpacity="0.35" strokeWidth="0.8" fill="none">
        <path d="M0.5 9h10v8H0.5M33.5 9h-10v8h10M10.5 13h13M13 0.5v8.5M21 0.5v8.5M13 25.5V17M21 25.5V17" />
        <rect x="10.5" y="9" width="13" height="8" rx="2" />
      </g>
    </svg>
  )
}

/**
 * A payment card drawn as the object it is: a card is the one thing on these
 * screens a person recognises by its face before its name. The face is
 * generated from the card's id (ground, pattern and its placement), so it is
 * stable, distinct from the other cards, and needs nothing stored. It carries
 * what the physical card carries (a name, the account it debits, its expiry)
 * and never a number, not even a masked one: there is none behind it.
 */
export function BankCard({
  id,
  name,
  accountName,
  expiryMonth,
  deferred,
  expired,
  className,
}: {
  id: string
  name: string
  accountName: string
  /** "YYYY-MM-DD", the first day of the printed month. */
  expiryMonth: string
  deferred: boolean
  expired?: boolean
  className?: string
}) {
  const random = seeded(hash(id))
  const [from, to] = GROUNDS[Math.floor(random() * GROUNDS.length)]!
  const sheenX = 10 + random() * 40
  const expiry = `${expiryMonth.slice(5, 7)}/${expiryMonth.slice(2, 4)}`

  return (
    <div
      className={cn(
        'relative aspect-[1.586] w-full overflow-hidden rounded-xl text-white shadow-lg shadow-black/40 ring-1 ring-white/10 ring-inset',
        // A card that no longer works loses its colour, not its place: it is
        // still what paid the movements that name it.
        expired && 'opacity-55 grayscale',
        className,
      )}
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 size-full"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id={`sheen-${id}`} cx={`${sheenX}%`} cy="0%" r="90%">
            <stop offset="0" stopColor="white" stopOpacity="0.14" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </radialGradient>
        </defs>
        <Pattern random={random} />
        <rect width={W} height={H} fill={`url(#sheen-${id})`} />
      </svg>

      <div className="relative flex h-full flex-col justify-between p-4">
        <div className="flex items-start justify-between gap-3">
          <span className="truncate text-[14px] leading-tight font-semibold tracking-tight">{name}</span>
          <span className="shrink-0 pt-0.5 text-[9px] font-medium tracking-[0.16em] text-white/60 uppercase">
            {deferred ? 'Différé' : 'Immédiat'}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <Chip uid={id} />
          <NfcIcon className="size-5 text-white/45" aria-hidden="true" />
        </div>
        <div className="flex items-end justify-between gap-3">
          <span className="truncate font-mono text-[10.5px] tracking-[0.14em] text-white/75 uppercase">
            {accountName}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-0.5 leading-none">
            <span className="text-[7.5px] tracking-[0.18em] text-white/45 uppercase">
              {expired ? 'expirée' : 'expire fin'}
            </span>
            <span className="font-mono text-[12.5px] tabular">{expiry}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
