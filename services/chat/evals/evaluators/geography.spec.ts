import { distanceKm, routeMetrics } from './geography.js';

it('uses straight-line kilometers and computes the shortest closed route', () => {
  expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.195, 2);
  const a = { lat: 35, lon: 135 };
  const b = { lat: 35, lon: 135.1 };
  const c = { lat: 35, lon: 135.2 };
  const d = { lat: 35, lon: 135.3 };
  const optimal = routeMetrics(a, [b, c, d]);
  const detour = routeMetrics(a, [c, b, d]);
  expect(optimal.detour).toBeCloseTo(1, 5);
  expect(detour.detour).toBeGreaterThan(1.2);
  expect(detour.km).toBeGreaterThan(optimal.km);
});
