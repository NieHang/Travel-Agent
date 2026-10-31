import { normalizeArgs } from './replay.js';

const PLACES: Record<string, string[]> = {
  tokyo: ['Tokyo', 'Tokyo Japan', '东京', '东京 日本', '東京', '東京 日本'],
  osaka: ['Osaka', 'Osaka Japan', 'Osaka 大阪 日本', '大阪', '大阪 日本', '大阪市 日本'],
  kyoto: ['Kyoto', 'Kyoto Japan', '京都', '京都 日本'],
  'kyoto-station': ['Kyoto Station', 'Kyoto Station Kyoto', 'Kyoto Station Kyoto Japan', '京都站', '京都站 京都', '京都駅 京都'],
  'ueno-station': ['Ueno Station Tokyo', 'Ueno Station Tokyo Japan', '上野站 东京', '上野站 東京', '上野駅 東京'],
  namba: ['Namba Osaka', 'Namba Osaka Japan', '难波 大阪', '难波 大阪 日本', '大阪 难波 日本', '難波 大阪 日本'],
  'osaka-castle': ['Osaka Castle Osaka', 'Osaka Castle Osaka Japan', '大阪城 大阪'],
};
const aliases = new Map(Object.entries(PLACES).flatMap(([place, names]) => names.map((name) => [aliasKey(name), place] as const)));

/** Only used within one L3 scenario's cassette; all structured constraints remain part of the key. */
export function itineraryReplayKey(tool: string, args: Record<string, unknown>): unknown {
  if (!tool.endsWith('searchHotels')) return normalizeArgs(args);
  const values = Object.entries(args).filter(([key]) => key !== 'originQuery').map(([key, value]) => [
    key, key === 'place' && typeof value === 'string' ? aliases.get(aliasKey(value)) ?? value : value,
  ]);
  return normalizeArgs(Object.fromEntries(values));
}

function aliasKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
