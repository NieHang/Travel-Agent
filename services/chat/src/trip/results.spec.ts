import { ROLLINGGO_COMPACT } from '../llm/mcp/rollinggo.fixture.js';
import {
  appears,
  groundResults,
  hasNumber,
  linkStays,
  mergeStays,
  type ShowResultsInput,
  type ToolResult,
} from './results.js';

const results: ToolResult[] = [
  { callId: 'c1', tool: 'searchHotels', args: {}, content: ROLLINGGO_COMPACT, isError: false },
  { callId: 'c2', tool: 'searchHotels', args: {}, content: 'boom', isError: true },
];

const base = {
  source: 'c1',
  id: '43615',
  title: { original: 'Casa do Fado Alfama', translation: '阿尔法玛法朵之家' },
  address: { original: 'Rua de São Miguel 12, Lisboa', translation: '里斯本圣米格尔街 12 号' },
  price: { amount: 118, currency: 'EUR' },
  rating: 4,
  url: 'https://rollinggo.ai/h/43615',
  image: 'https://img.rollinggo.ai/43615.jpg',
  details: [{ label: 'Distance (m)', value: { original: '850', translation: null } }],
  amenities: [
    { original: 'Kitchen', translation: '厨房' },
    { original: 'Swimming pool', translation: '游泳池' },
  ],
  summary: '适合久住',
};
const input = (items: ShowResultsInput['items']): ShowResultsInput => ({ panel: 'hotels', items });

describe('appears / hasNumber', () => {
  it('matches raw, normalised and JSON-escaped text', () => {
    expect(appears('{"a":"Rua  de São\\nMiguel"}', 'Rua de São Miguel')).toBe(true);
    expect(appears('{"a":"Rua de Sao Miguel"}', 'Rua de São Miguel')).toBe(false);
    expect(appears('{"a":"Rua de S\\u00e3o Miguel"}', 'Rua de São Miguel')).toBe(true);
    expect(appears('{"u":"https:\\/\\/x.io\\/a"}', 'https://x.io/a')).toBe(true);
    expect(appears('anything', '   ')).toBe(false);
  });
  it('matches number tokens only', () => {
    expect(hasNumber('"lowestPrice":"118 EUR"', 118)).toBe(true);
    expect(hasNumber('118.0', 118)).toBe(true);
    expect(hasNumber('1180', 118)).toBe(false);
  });
});

describe('groundResults', () => {
  it('keeps copied facts and drops what the result does not contain', () => {
    const group = groundResults(input([base]), results);
    expect(group.panel).toBe('hotels');
    const [item] = group.items;
    expect(item.ref).toBe('r1');
    expect(item.id).toBe('43615');
    expect(item.title).toEqual(base.title);
    expect(item.address).toEqual(base.address);
    expect(item.price).toEqual({ amount: 118, currency: 'EUR' });
    expect(item.rating).toBe(4);
    expect(item.url).toBe(base.url);
    expect(item.image).toBe(base.image);
    expect(item.details).toEqual(base.details);
    expect(item.amenities).toEqual([{ original: 'Kitchen', translation: '厨房' }]);
    expect(item.summary).toBe('适合久住');
  });

  it('nulls invented price, image and a reformatted address with its translation', () => {
    const [item] = groundResults(
      input([
        {
          ...base,
          price: { amount: 99, currency: 'EUR' },
          image: 'https://img.example.com/fake.jpg',
          address: { original: 'São Miguel St 12', translation: '圣米格尔街' },
        },
      ]),
      results,
    ).items;
    expect(item.price).toBeNull();
    expect(item.image).toBeNull();
    expect(item.address).toBeNull();
  });

  it('drops items whose title is a translation or that cite unknown or errored calls', () => {
    const group = groundResults(
      input([
        { ...base, title: { original: '阿尔法玛法朵之家', translation: null } },
        { ...base, source: 'c2' },
        { ...base, source: 'earlier-turn' },
      ]),
      results,
    );
    expect(group.items).toEqual([]);
  });

  it('nulls a translation equal to its original', () => {
    const [item] = groundResults(
      input([{ ...base, title: { original: 'Casa do Fado Alfama', translation: 'Casa do Fado Alfama' } }]),
      results,
    ).items;
    expect(item.title.translation).toBeNull();
  });
});

describe('mergeStays / linkStays', () => {
  const one = groundResults(input([base]), results);
  it('appends groups and renumbers refs as h1…', () => {
    const merged = mergeStays(mergeStays(null, one), one);
    expect(merged.panel).toBe('hotels');
    expect(merged.items.map((i) => i.ref)).toEqual(['h1', 'h2']);
  });
  it('keeps only refs that exist in the stays', () => {
    const stays = mergeStays(null, one);
    const days = [
      { title: 'D1', stayRef: 'h1' },
      { title: 'D2', stayRef: 'h9' },
      { title: 'D3', stayRef: null },
    ];
    expect(linkStays(days, stays).map((d) => d.stayRef)).toEqual(['h1', null, null]);
    expect(linkStays(days, null).map((d) => d.stayRef)).toEqual([null, null, null]);
  });
});
