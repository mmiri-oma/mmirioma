import { Link } from 'react-router-dom'
import type { LiveMapData } from './adminApi'

/**
 * Where each area sits on the drawn Enugu map, in percent of the map box.
 * The map is an illustration (decision 14): riders are drawn between their
 * station and the customer's area, not at a GPS position.
 */
const AREA_AT: Record<string, { x: number; y: number }> = {
  GRA: { x: 50, y: 22 },
  Ogui: { x: 13, y: 66 },
  'Independence Layout': { x: 31, y: 82 },
  'Trans-Ekulu': { x: 78, y: 36 },
  'New Haven': { x: 68, y: 74 },
  Abakpa: { x: 90, y: 18 },
  'Thinkers Corner': { x: 62, y: 12 },
  Anyika: { x: 40, y: 92 },
  Emene: { x: 94, y: 56 },
  Uwani: { x: 8, y: 40 },
}

/** A map position for an area; an unknown or missing area gets a spread-out spot, never a guessed name. */
function at(area: string | null, i: number) {
  return (area ? AREA_AT[area] : undefined) ?? { x: 20 + ((i * 17) % 60), y: 30 + ((i * 23) % 40) }
}

const VEHICLE_COLOR = { keke: '#11708C', tanker: '#7C3AED' } as const
/** A delivery whose order has no delivery type gets a neutral marker (admin-operations.md, live map). */
const NEUTRAL_COLOR = '#64748B'
const vehicleColor = (vehicle: 'keke' | 'tanker' | null) => (vehicle ? VEHICLE_COLOR[vehicle] : NEUTRAL_COLOR)
const STATUS_WORD: Record<string, { text: string; color: string }> = {
  assigned: { text: 'Assigned', color: '#11708C' },
  loading: { text: 'Loading', color: '#6D28D9' },
  on_the_way: { text: 'En route', color: '#15803D' },
}

function StationGlyph() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24" width="16">
      <path d="M4 21V8l8-5 8 5v13" />
    </svg>
  )
}

/**
 * Live map card body (`a-dashboard`): base drawing from the design, station
 * squares, a moving route and a labelled marker per active delivery.
 */
export function AdminMap({ data, height = 330, fullMapLink = true }: { data: LiveMapData; height?: number; fullMapLink?: boolean }) {
  // Rider markers sit along their route (near the customer once on the way).
  // Markers that would land on top of each other are moved down a row so
  // every label stays readable.
  const riderSpots: { x: number; y: number }[] = []
  data.deliveries.forEach((d, i) => {
    const a = at(d.station_area, i)
    const b = at(d.customer_area, i + 3)
    const spot = d.status === 'on_the_way' ? { x: b.x, y: a.y + (b.y - a.y) * 0.7 } : { x: (a.x + b.x) / 2, y: a.y }
    while (riderSpots.some((o) => Math.abs(o.x - spot.x) < 16 && Math.abs(o.y - spot.y) < 12)) spot.y += 13
    riderSpots.push(spot)
  })
  const label = `${data.deliveries.length} active deliveries and ${data.stations.filter((s) => s.open).length} open stations`
  return (
    <div className="relative overflow-hidden rounded-stat bg-[#E9EEF2]" style={{ height }} role="img" aria-label={`Map (illustration): ${label}`}>
      <svg aria-hidden="true" preserveAspectRatio="xMidYMid slice" className="block size-full" viewBox="0 0 800 330">
        <rect fill="#E9EEF2" height="330" width="800" />
        <rect fill="#F4F7F9" height="90" rx="12" width="150" x="30" y="24" />
        <rect fill="#F4F7F9" height="100" rx="12" width="200" x="560" y="200" />
        <rect fill="#F4F7F9" height="90" rx="12" width="160" x="250" y="210" />
        <rect fill="#D3EDD8" height="100" rx="14" width="170" x="420" y="24" />
        <path d="M-10 180 C 120 150 220 220 360 190 S 600 140 810 160" fill="none" stroke="#BFDDF7" strokeWidth="22" />
        <path d="M0 140 H800 M220 0 V330 M520 0 V330 M0 260 H800" stroke="#FFFFFF" strokeWidth="12" />
        <path d="M0 320 L 800 40" stroke="#FBE7A1" strokeWidth="14" />
        <text fill="#5E6E80" fontSize="20" fontWeight="800" x="380" y="135">
          Enugu
        </text>
      </svg>
      {/* Routes in percent coordinates so they line up with the markers. */}
      <svg aria-hidden="true" className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {data.deliveries.map((d, i) => {
          const a = at(d.station_area, i)
          const b = at(d.customer_area, i + 3)
          return (
            <path
              key={d.reference}
              d={`M${a.x} ${a.y} L ${b.x} ${a.y} L ${b.x} ${b.y}`}
              fill="none"
              stroke={vehicleColor(d.vehicle)}
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray="2 1"
              vectorEffect="non-scaling-stroke"
              className="animate-route"
            />
          )
        })}
      </svg>
      {Object.entries(AREA_AT)
        .slice(0, 6)
        .map(([name, p]) => (
          <span key={name} className="absolute text-[12px] font-bold text-[#7A8797]" style={{ left: `${p.x}%`, top: `${p.y + 6}%` }} aria-hidden="true">
            {name}
          </span>
        ))}
      {data.stations.map((st, i) => {
        const p = at(st.area, i)
        return (
          <span
            key={st.id}
            title={`${st.name} (${st.open ? 'open' : 'closed'})`}
            className="absolute flex size-[30px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[10px] text-white shadow-[0_4px_10px_rgba(10,37,64,.3)]"
            style={{ left: `${p.x}%`, top: `${p.y}%`, background: st.open ? '#0E7C8F' : '#94A3B8' }}
            aria-hidden="true"
          >
            <StationGlyph />
          </span>
        )
      })}
      {data.deliveries.map((d, i) => {
        const b = at(d.customer_area, i + 3)
        const rider = riderSpots[i]
        const word = STATUS_WORD[d.status] ?? { text: d.status, color: '#33445A' }
        return (
          <div key={d.reference}>
            <svg aria-hidden="true" height="32" viewBox="0 0 24 30" width="26" className="absolute -translate-x-1/2 -translate-y-full" style={{ left: `${b.x}%`, top: `${b.y}%` }}>
              <path d="M12 29s-10-9-10-17a10 10 0 0 1 20 0c0 8-10 17-10 17Z" fill="#DC2626" />
              <circle cx="12" cy="12" fill="#fff" r="4" />
            </svg>
            <div className="absolute flex -translate-y-1/2 items-center gap-1.5" style={{ left: `calc(${rider.x}% - 16px)`, top: `${rider.y}%` }}>
              <span className="relative size-8">
                {d.status !== 'assigned' && <span className="animate-ping absolute inset-0 rounded-full" style={{ background: d.vehicle === 'keke' ? 'rgba(17,112,140,.4)' : d.vehicle === 'tanker' ? 'rgba(124,58,237,.4)' : 'rgba(100,116,139,.4)' }} />}
                <span
                  className="relative box-border flex size-8 items-center justify-center rounded-full border-[3px] border-solid border-white text-[10px] font-extrabold text-white"
                  style={{ background: vehicleColor(d.vehicle) }}
                  aria-hidden="true"
                >
                  {d.vehicle === 'keke' ? 'K' : d.vehicle === 'tanker' ? 'T' : ''}
                </span>
              </span>
              <span className="rounded-[9px] bg-white px-2 py-1 text-[11.5px] leading-[1.25] font-extrabold shadow-[0_4px_10px_rgba(10,37,64,.15)]">
                {d.code ?? d.partner}
                <br />
                <span className="font-bold" style={{ color: word.color }}>
                  {word.text}
                </span>
              </span>
            </div>
          </div>
        )
      })}
      {fullMapLink && (
        <Link
          to="/admin/map"
          className="absolute right-3 bottom-3 rounded-[10px] bg-white px-3 py-2 text-[13px] font-bold text-primary no-underline shadow-[0_4px_12px_rgba(10,37,64,.15)] hover:text-primary-dark"
        >
          Open full map
        </Link>
      )}
    </div>
  )
}

/** The map legend from the design. */
export function MapLegend() {
  const item = (color: string, text: string, square = false) => (
    <span className="flex items-center gap-[5px]">
      <span className="size-2.5" style={{ background: color, borderRadius: square ? 3 : '50%' }} aria-hidden="true" />
      {text}
    </span>
  )
  return (
    <div className="flex flex-wrap gap-3 text-[12px] font-semibold text-slate">
      {item('#11708C', 'Keke')}
      {item('#7C3AED', 'Tanker')}
      {item('#0E7C8F', 'Station', true)}
      {item('#DC2626', 'Customer')}
    </div>
  )
}
