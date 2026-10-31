export interface Point { lat: number; lon: number }

export function distanceKm(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function routeMetrics(hotel: Point, stops: Point[]): { km: number; detour: number; far: number } {
  if (!stops.length) return { km: 0, detour: 1, far: 0 };
  const route = [hotel, ...stops, hotel];
  const km = route.slice(1).reduce((sum, point, i) => sum + distanceKm(route[i], point), 0);
  // Held–Karp gives the exact shortest ordering, with the same hotel at both ends.
  const n = stops.length;
  const count = 1 << n;
  const dp = new Float64Array(count * n).fill(Infinity);
  const fromHotel = stops.map((stop) => distanceKm(hotel, stop));
  const between = stops.map((a) => stops.map((b) => distanceKm(a, b)));
  for (let i = 0; i < n; i++) dp[(1 << i) * n + i] = fromHotel[i];
  for (let mask = 1; mask < count; mask++)
    for (let last = 0; last < n; last++) {
      if (!(mask & (1 << last))) continue;
      const prev = mask ^ (1 << last);
      if (!prev) continue;
      for (let k = 0; k < n; k++)
        if (prev & (1 << k)) dp[mask * n + last] = Math.min(dp[mask * n + last], dp[prev * n + k] + between[k][last]);
    }
  const shortest = Math.min(...stops.map((_, i) => dp[(count - 1) * n + i] + fromHotel[i]));
  return { km, detour: shortest > 0 ? km / shortest : 1, far: Math.max(...fromHotel) };
}
