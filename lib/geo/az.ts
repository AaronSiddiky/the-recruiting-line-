/**
 * Approximate centres of Arizona towns where techs and clients live, for
 * commute estimates. Good to a couple of miles, which is all matching needs.
 */
const CITIES: Record<string, [number, number]> = {
  phoenix: [33.4484, -112.074], mesa: [33.4152, -111.8315], gilbert: [33.3528, -111.789], chandler: [33.3062, -111.8413],
  tempe: [33.4255, -111.94], scottsdale: [33.4942, -111.9261], glendale: [33.5387, -112.186], peoria: [33.5806, -112.2374],
  surprise: [33.6292, -112.3679], goodyear: [33.4353, -112.3576], avondale: [33.4356, -112.3496], buckeye: [33.3703, -112.5838],
  tolleson: [33.45, -112.2593], waddell: [33.5642, -112.428], 'cave creek': [33.8333, -111.9507], carefree: [33.8223, -111.918],
  'casa grande': [32.8795, -111.7574], coolidge: [32.9778, -111.5176], 'queen creek': [33.2487, -111.6343], 'san tan valley': [33.1911, -111.528],
  'apache junction': [33.4151, -111.5496], 'fountain hills': [33.6117, -111.7174], 'sun city': [33.5975, -112.2718], 'sun city west': [33.662, -112.341],
  'el mirage': [33.6131, -112.3246], 'litchfield park': [33.4934, -112.358], laveen: [33.3628, -112.1693], anthem: [33.8672, -112.1466],
  maricopa: [33.0581, -112.0476], florence: [33.0314, -111.3873], tucson: [32.2226, -110.9747], prescott: [34.54, -112.4685],
  'prescott valley': [34.61, -112.3157], flagstaff: [35.1983, -111.6513], 'bullhead city': [35.1478, -114.5683], 'lake havasu city': [34.4839, -114.3225],
  kingman: [35.1894, -114.053], yuma: [32.6927, -114.6277], 'paradise valley': [33.5311, -111.9426], youngtown: [33.5939, -112.3029],
  ahwatukee: [33.3406, -111.9843], 'new river': [33.9159, -112.1360], wittmann: [33.7778, -112.5288], 'gold canyon': [33.3715, -111.4368],
}

export function cityPoint(city: string | null | undefined): [number, number] | null {
  if (!city) return null
  return CITIES[city.trim().toLowerCase()] ?? null
}

/** Straight-line miles between two towns, or null if either is unknown. */
export function milesBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  const p = cityPoint(a)
  const q = cityPoint(b)
  if (!p || !q) return null
  const R = 3958.8
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(q[0] - p[0])
  const dLon = rad(q[1] - p[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(p[0])) * Math.cos(rad(q[0])) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}
