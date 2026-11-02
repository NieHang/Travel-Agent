import { z } from 'zod';
import type { ItineraryEntry, Score } from '../schemas.js';
import type { TripState } from '../../src/trip/state.js';
import type { TurnOutput } from '../turn.js';
import { legDetails, TRAVEL_LEG } from '../travel-leg.js';

// Ends in a station or airport name, optionally with a bracketed code: "Kansai Airport (KIX)", "近铁奈良站".
// "Tokyo Station Character Street" is a shopping street and still counts as a place.
const TRANSIT_STOP = /(Station|Airport|駅|站|機場|机场|空港)\s*(?:[（(][^）)]*[）)])?$/i;
// The skill lets meals happen "nearby"; extraction still turns "lunch near the park" or "东福寺附近午餐" into a stop. The hotel is never a place.
const NEARBY_STOP = /\bnear(?:by)?\b|附近|^(?:hotel|酒店)$/i;
// Scenarios that stay in Osaka. The hotel server answered "大阪 日本" with Shanghai hotels; an Osaka stay names Osaka in its title or address.
const OSAKA_STAYS = ['family', 'tight-budget', 'multi-city'];
export const hasOsakaStay = (state: TripState) =>
  (state.stays?.items ?? []).some((h) =>
    /大阪|Osaka/i.test([h.title.original, h.title.translation, h.address?.original, h.address?.translation].join(' ')),
  );
const MEAL_STOP = /\b(?:breakfast|brunch|lunch|dinner|meal|snacks?|drinks?|coffee|rest)\b|\bcaf[eé]|早餐|午餐|晚餐|午饭|晚饭|用餐|吃饭|小吃|休息/i;

const LIVE_CHECKS: Record<string, string[]> = {
  refused: ['outside_refused', 'refusal_names_city', 'no_tools'], mixed: ['outside_refused', 'refusal_names_city', 'offers_japan_part'],
  'outside-hotel': ['hotel_intent_chat', 'no_tools'], family: ['reaches_review', 'destination_checked', 'has_stays', 'osaka_stays', 'stays_have_media', 'at_least_one_stay_link'],
  'day-trip': ['has_stays'], 'hotel-question': ['hotel_intent_chat', 'hotel_cards'], vague: ['destination_clarified'],
  'multi-city': ['reaches_review', 'skills_loaded', 'has_stays', 'osaka_stays', 'headings_present', 'legs_mode_only', 'every_day_covered', 'leg_as_stop', 'full_day_alternatives', 'city_min_nights'],
};

export function gradeItinerary(item: ItineraryEntry, out: TurnOutput): Score[] {
  const scores: Score[] = [];
  const check = (name: string, pass: boolean) => scores.push({ name, value: Number(pass) });
  const { next, draft } = out;
  const kind = item.id.replace(/^l3-(zh|en)-/, '');
  const zh = item.locale === 'zh';
  const booked = kind === 'lodging-booked';
  const hotels = next.stays?.items ?? [];
  check('effect_match', out.effect === item.expected.effect);
  if (['refused', 'mixed'].includes(kind)) {
    check('outside_refused', out.effect === null && next.requirements.destination === undefined);
    const city = kind === 'mixed' ? (zh ? '首尔' : 'seoul') : (zh ? '成都' : 'lisbon');
    check('refusal_names_city', (next.outsideJapan?.places ?? []).some((p) => p.toLowerCase().includes(city)));
    if (kind === 'mixed') check('offers_japan_part', (next.outsideJapan?.japan ?? '').toLowerCase().includes(zh ? '福冈' : 'fukuoka'));
    if (kind === 'refused') check('no_tools', out.calls.length === 0);
  }
  if (kind === 'outside-hotel' || kind === 'hotel-question') {
    check('hotel_intent_chat', out.classified.intent === 'chat');
    if (kind === 'outside-hotel') check('no_tools', out.calls.length === 0);
    else check('hotel_cards', next.results.some((g) => g.items.length > 0));
  }
  if (kind === 'vague') check('destination_clarified', next.clarify?.field === 'destination');
  if (item.expected.effect === 'itinerary') {
    check('reaches_review', next.stage === 'review' && out.effect === 'itinerary');
    check('destination_checked', next.checkedDestination !== null);
    check('has_stays', item.expected.nights > 0 && !booked ? hotels.length > 0 : next.stays === null);
    if (item.expected.nights > 0 && !booked) {
      if (OSAKA_STAYS.includes(kind)) check('osaka_stays', hasOsakaStay(next));
      check('stays_have_media', hotels.some((h) => h.amenities.length > 0 || Boolean(h.image)));
      check('at_least_one_stay_link', next.days.some((d) => d.stayRef));
      check('every_night_linked', next.days.length >= item.expected.nights && next.days.slice(0, item.expected.nights).every((d) => hotels.some((h) => h.ref === d.stayRef)));
    } else check('no_lodging_search', !out.toolCalls.some((c) => /searchHotels|getHotelDetail/.test(c.name)));
    const skills = kind === 'multi-city' ? ['japan-tokyo', 'japan-osaka'] : kind === 'family' || kind === 'tight-budget' ? ['japan-osaka'] : kind === 'lodging-area' ? ['japan-tokyo'] : kind === 'day-trip' ? ['japan-nara'] : ['japan-kyoto'];
    check('skills_loaded', skills.every((s) => out.loaded.includes(s)));
    check('headings_present', (zh ? ['总览', '出发前要办'] : ['Overview', 'Before you go']).every((s) => draft.includes(s)));
    check('legs_mode_only', legDetails(draft).length === 0);
    check('every_day_covered', next.days.length >= item.expected.nights + 1);
    const blocks = draft.split(/^(?=[#*\s]*(?:Day\s*\d+|第\s*\d+\s*天|D\d+\b))/im).filter((b) => /^[#*\s]*(?:Day\s*\d+|第\s*\d+\s*天|D\d+\b)/i.test(b));
    check('full_day_alternatives', blocks.length >= item.expected.nights + 1 && blocks.slice(1, -1).every((b) => /备选|Alternative/i.test(b)));
    if (kind === 'multi-city') {
      const end = draft.search(zh ? /出发前要办/ : /Before you go/i);
      const overview = end < 0 ? '' : draft.slice(0, end);
      const nights = [...overview.matchAll(zh ? /(\d+)\s*晚/g : /(\d+)\s*nights?\b/gi)].map((m) => Number(m[1]));
      check('city_min_nights', nights.length >= 2 && nights.every((n) => n >= 2));
    }
    // Same rule as the japan-travel skill: restaurants and shops count as places; stations, airports, "nearby" meals and same-day repeats do not.
    // A meal at one of the day's places is a repeat: "Lunch in Gion" next to "Gion".
    const limit = kind === 'elderly' || next.requirements.tripType === 'family' ? 3 : 4;
    const counts = next.days.map((d) => {
      const names = d.stops.map((s) => s.name).filter((name) => !TRANSIT_STOP.test(name) && !NEARBY_STOP.test(name));
      const places = names.filter((name) => !MEAL_STOP.test(name)).map((name) => name.toLowerCase());
      return new Set(names.filter((name) => !MEAL_STOP.test(name) || !places.some((place) => name.toLowerCase().includes(place)))).size;
    });
    const middle = counts.slice(1, -1);
    check('pacing_ok', counts.length > 0 && counts.every((n) => n <= limit) && (!middle.length || (counts[0] <= Math.max(...middle) && counts.at(-1)! <= Math.max(...middle))));
    scores.push({ name: 'leg_as_stop', value: next.days.flatMap((d) => d.stops).filter((s) => TRAVEL_LEG.test(s.name)).length });
    check('tool_args_ok', lodgingArgsOk(item, out));
  }
  scores.push({ name: 'invented_hotel', value: Number(hasInventedHotel(out)) });
  if (item.expected.budget) {
    const prices = hotels.flatMap((h) => h.price?.currency === item.expected.budget!.currency ? [h.price.amount] : []);
    check('budget_checkable', prices.length > 0);
    if (prices.length) check('budget_ok', Math.min(...prices) * item.expected.nights <= item.expected.budget.amount);
  }
  const live = scores.filter((s) => LIVE_CHECKS[kind]?.includes(s.name)).map((s) => s.name === 'leg_as_stop' ? Number(s.value === 0) : s.value);
  if (live.length) {
    scores.push({ name: 'live_assertion_rate', value: live.reduce((a, b) => a + b, 0) / live.length });
    check('live_checks_pass', live.every((v) => v === 1));
  }
  check('code_checks_pass', scores.filter((s) => s.name !== 'budget_checkable').every((s) => ['invented_hotel', 'leg_as_stop'].includes(s.name) ? s.value === 0 : s.value === 1));
  if (live.length) scores.push({ name: 'live_assertion_count', value: live.length }, { name: 'live_assertion_passed', value: live.reduce((a, b) => a + b, 0) });
  return scores;
}

export function gradeLiveAssertions(scores: Score[]): Score[] {
  const sum = (name: string) => scores.filter((s) => s.name === name).reduce((total, s) => total + s.value, 0);
  const count = sum('live_assertion_count');
  return [{ name: 'live_assertion_accuracy', value: count ? sum('live_assertion_passed') / count : 0 }];
}

export function failedItineraryScores(item: ItineraryEntry): Score[] {
  const live = LIVE_CHECKS[item.id.replace(/^l3-(zh|en)-/, '')] ?? [];
  const names = new Set(['effect_match', 'code_checks_pass', ...live.filter((name) => name !== 'leg_as_stop')]);
  if (item.expected.effect === 'itinerary') {
    for (const name of ['reaches_review', 'destination_checked', 'has_stays', 'skills_loaded', 'headings_present', 'legs_mode_only', 'every_day_covered', 'full_day_alternatives', 'pacing_ok', 'tool_args_ok', 'geocode_coverage']) names.add(name);
    if (item.expected.nights > 0 && !item.id.endsWith('lodging-booked'))
      for (const name of ['stays_have_media', 'at_least_one_stay_link', 'every_night_linked', ...(OSAKA_STAYS.includes(item.id.replace(/^l3-(zh|en)-/, '')) ? ['osaka_stays'] : [])]) names.add(name);
    else names.add('no_lodging_search');
    if (item.expected.budget) { names.add('budget_ok'); names.add('budget_checkable'); }
  }
  return [...[...names].map((name) => ({ name, value: 0 })), ...(live.length ? [
    { name: 'live_checks_pass', value: 0 }, { name: 'live_assertion_rate', value: 0 },
    { name: 'live_assertion_count', value: live.length }, { name: 'live_assertion_passed', value: 0 },
  ] : [])];
}

function hasInventedHotel(out: TurnOutput): boolean {
  const hotels = [...out.next.stays?.items ?? [], ...out.next.results.filter((g) => g.panel === 'hotels').flatMap((g) => g.items)];
  const providerNames = out.toolResults.filter((r) => !r.isError).flatMap((r) => {
    try {
      const parsed = z.object({ hotels: z.array(z.object({ name: z.string() })) }).safeParse(JSON.parse(r.content));
      return parsed.success ? parsed.data.hotels.map((h) => h.name) : [];
    } catch { return []; }
  });
  const names = [...providerNames, ...hotels.flatMap((h) => [h.title.original, ...h.title.translation ? [h.title.translation] : []])];
  let dayIndex = -1;
  return out.draft.split('\n').some((line) => {
    const plain = line.normalize('NFKC').replace(/[*_`]/g, '').replace(/^\s*[-•]\s*/, '').trim();
    const heading = /^(?:#+\s*)?(?:Day\s*(\d+)|第\s*(\d+)\s*天|D(\d+)\b)/i.exec(plain);
    if (heading) dayIndex = Number(heading[1] ?? heading[2] ?? heading[3]) - 1;
    if (dayIndex < 0 && plain.startsWith('住宿')) return false;
    const night = /^(?:Tonight|Overnight(?: stay)?|今晚(?:住宿)?|住宿)\s*[:：]\s*(.+)$/i.exec(plain) ?? /^Stay at\s+(.+)$/i.exec(plain);
    if (!night) return false;
    const choice = night[1];
    const generic = choice.replace(/\([^)]*\)/g, '').trim();
    if (/^(?:(?:Tokyo|Osaka|Kyoto|Nara|东京|東京|大阪|京都|奈良)\s*)?(?:hotel|ryokan|酒店|旅馆|旅館)$/i.test(generic)
      || /no (?:hotel|overnight)|unavailable|already booked|已(?:经)?(?:预)?订|住宿待定|暂不指定酒店|实时(?:酒店)?数据.*(?:暂|未|不可用|没有)|(?:酒店|住宿).*(?:暂无|暂未|未返回|未查到|未搜到|没有查到|不可用|无法推荐)|(?:未搜到|未取到|没有找到|没有可推荐).*(?:酒店|住宿|房源)/i.test(choice)) return false;
    const linked = hotels.find((h) => h.ref === out.next.days[dayIndex]?.stayRef);
    const candidates = linked ? [linked.title.original, ...linked.title.translation ? [linked.title.translation] : [], ...names] : names;
    // A bilingual name is one choice; separate alternatives must each be grounded.
    return choice.split(/\s+(?:or|and)\s+|或者|或入住/i).some((name) => !candidates.some((known) => hotelNameKey(name).includes(hotelNameKey(known))));
  });
}

function hotelNameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

const SearchArgsSchema = z.object({
  place: z.string(), checkInParam: z.object({ checkInDate: z.string().date(), stayNights: z.number().int().positive(), adultCount: z.number().int().positive() }),
});

function lodgingArgsOk(item: ItineraryEntry, out: TurnOutput): boolean {
  const calls = out.toolCalls.filter((c) => c.name.endsWith('searchHotels'));
  if (item.expected.nights === 0 || item.id.endsWith('lodging-booked')) return calls.length === 0;
  if (!calls.length) return false;
  const parsed = calls.map((call) => SearchArgsSchema.safeParse(call.args));
  if (parsed.some((p) => !p.success)) return false;
  const searches = parsed.flatMap((p) => p.success ? [p.data] : []);
  const r = out.next.requirements;
  const dates = new Set<string>();
  const destinations = item.id.endsWith('multi-city') ? [['Tokyo', '东京', '東京'], ['Osaka', '大阪']]
    : item.id.endsWith('lodging-area') ? [['Ueno', '上野']]
    : item.id.endsWith('family') || item.id.endsWith('tight-budget') ? [['Osaka', '大阪']]
    : [['Kyoto', '京都']];
  if (!destinations.every((aliases) => searches.some((s) => aliases.some((city) => s.place.toLowerCase().includes(city.toLowerCase()))))) return false;
  return searches.every(({ place, checkInParam: p }) => {
    const start = Date.parse(p.checkInDate);
    const end = start + p.stayNights * 86_400_000;
    if (p.adultCount !== r.travelers || start < Date.parse(r.departureDate!) || end > Date.parse(r.returnDate!)) return false;
    const cityTokens = destinations.flat();
    if (!cityTokens.some((city) => city && place.toLowerCase().includes(city.toLowerCase()))) return false;
    for (let day = start; day < end; day += 86_400_000) dates.add(new Date(day).toISOString().slice(0, 10));
    return true;
  }) && dates.size === item.expected.nights;
}
