import type { Cassette } from './cassette.js';
import { ReplayMcp } from './replay.js';
import { itineraryReplayKey } from './itinerary.js';

const args = {
  originQuery: 'Osaka couple trip', place: 'Osaka Japan', placeType: '城市', size: 8,
  checkInParam: { checkInDate: '2026-12-01', stayNights: 2, adultCount: 2 },
  filterOptions: { distanceInMeter: 2000 }, hotelTags: { maxPricePerNight: 1000, requiredTags: ['breakfast'] },
};
const cassette: Cassette = {
  tools: [{ name: 'mcp_rollingGo_searchHotels', description: 'Search hotels', schema: { type: 'object', properties: {} } }],
  calls: [{ tool: 'mcp_rollingGo_searchHotels', args, result: { content: 'Osaka fixture', isError: false } }],
};

it.each(['Osaka', '大阪', 'Osaka 大阪 日本'])('matches the same place alias %s and ignores scenario-scoped query prose', async (place) => {
  const replay = new ReplayMcp(cassette, undefined, itineraryReplayKey);
  expect(await replay.mcpManager.getTools()[0].invoke({ ...args, originQuery: 'Different phrasing of the same fixture request', place })).toEqual({ content: 'Osaka fixture', isError: false });
  expect(replay.misses).toEqual([]);
});

it.each([
  { place: 'Kyoto Japan' }, { place: '难波 大阪' }, { place: '大阪城 大阪' },
  // The provider answers these with Shanghai hotels, so they must not replay the Osaka snapshot.
  { place: '大阪 日本' }, { place: '大阪市 日本' },
  { placeType: '区/县' }, { size: 10 },
  { checkInParam: { ...args.checkInParam, checkInDate: '2026-12-02' } },
  { checkInParam: { ...args.checkInParam, stayNights: 3 } },
  { checkInParam: { ...args.checkInParam, adultCount: 4 } },
  { hotelTags: { ...args.hotelTags, maxPricePerNight: 500 } },
  { hotelTags: { ...args.hotelTags, requiredTags: ['family'] } },
  { filterOptions: { distanceInMeter: 1000 } },
])('keeps meaningful argument changes distinct: %j', async (patch) => {
  const replay = new ReplayMcp(cassette, undefined, itineraryReplayKey);
  await replay.mcpManager.getTools()[0].invoke({ ...args, ...patch });
  expect(replay.misses).toHaveLength(1);
});

it('keeps city and station searches distinct', () => {
  expect(itineraryReplayKey('mcp_rollingGo_searchHotels', { ...args, place: 'Kyoto Japan' }))
    .not.toEqual(itineraryReplayKey('mcp_rollingGo_searchHotels', { ...args, place: 'Kyoto Station Kyoto Japan' }));
});

it('uses the first canonical recording consistently instead of selecting different results by prose', async () => {
  const replay = new ReplayMcp({ ...cassette, calls: [...cassette.calls, { tool: 'mcp_rollingGo_searchHotels', args: { ...args, originQuery: 'Alternate prose', place: '大阪' }, result: { content: 'Later snapshot', isError: false } }] }, undefined, itineraryReplayKey);
  expect(await replay.mcpManager.getTools()[0].invoke({ ...args, originQuery: 'Alternate prose', place: '大阪' })).toEqual({ content: 'Osaka fixture', isError: false });
});

it('leaves P1 exact and does not remove fields from non-search tool arguments', async () => {
  const replay = new ReplayMcp(cassette);
  await replay.mcpManager.getTools()[0].invoke({ ...args, originQuery: 'Different prose' });
  expect(replay.misses).toHaveLength(1);
  expect(itineraryReplayKey('mcp_other_tool', { originQuery: 'A' })).not.toEqual(itineraryReplayKey('mcp_other_tool', { originQuery: 'B' }));
});
