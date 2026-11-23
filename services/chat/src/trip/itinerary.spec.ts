import { readFileSync } from 'node:fs';
import { ResultGroupSchema } from '@autix/contracts';
import { mergeStays, nightsOf, overviewLine, parseDraft, renderPlan, segments, splice, type Plan } from './itinerary.js';

const fixture = (name: string) => readFileSync(new URL(`../../test/fixtures/drafts/${name}`, import.meta.url), 'utf8');
// A draft and its grounded stays, recorded from a live Kyoto run.
const kyoto = fixture('kyoto.en.md');
const stays = ResultGroupSchema.parse(JSON.parse(fixture('kyoto.stays.json')));

function kyotoPlan(): Plan {
  const draft = parseDraft(kyoto, stays);
  return { ...draft, days: draft.days.map((d) => ({ ...d, stops: [] })), stays };
}

describe('parseDraft', () => {
  it('splits a live draft into preamble, days and footer, and links each night by hotel name', () => {
    const draft = parseDraft(kyoto, stays);
    expect(draft.preamble).toMatch(/^# Kyoto Itinerary Draft[\s\S]*\*\*Before you go\*\*[\s\S]*Pack layers; mornings and evenings are cool\.$/);
    expect(draft.days.map((d) => d.title)).toEqual([
      'Day 1 | Kyoto Station area · Nishiki Market (light)',
      'Day 2 | Fushimi Inari Taisha · Tofuku-ji · Gion (standard)',
      'Day 3 | Nijo Castle · Nishiki Market (light)',
      'Day 4 | Departure (light)',
    ]);
    expect(draft.days.map((d) => d.stayRef)).toEqual(['h1', 'h1', 'h1', null]);
    expect(draft.days.some((d) => d.body.includes('Tonight'))).toBe(false);
    expect(draft.days[3].body).toBe('- Morning: breakfast and souvenirs near the hotel only\n- 11:00 Hotel → Kyoto Station by subway; leave plenty of time for check-in');
    expect(draft.footer).toBe('Hotel prices are per night and may change — please confirm availability before booking.');
  });

  it('reads Chinese headers and hotel lines', () => {
    const zh = '# 京都草稿\n\n**第1天 | 二条城（轻松）**\n- 10:00 二条城\n- 今晚：hotel MONday Kyoto Marutamachi（每晚 1093 元起）\n\n**第2天 | 返程（轻松）**\n- 11:00 返程';
    expect(parseDraft(zh, stays).days).toEqual([
      { title: '第1天 | 二条城（轻松）', body: '- 10:00 二条城', stayRef: 'h1' },
      { title: '第2天 | 返程（轻松）', body: '- 11:00 返程', stayRef: null },
    ]);
  });

  it('drops footer paragraphs that name a stay, and a rule with nothing left after it', () => {
    const zh = '**第1天 | 二条城（轻松）**\n- 10:00 二条城\n- 今晚：hotel MONday Kyoto Marutamachi\n\n**第2天 | 返程（轻松）**\n- 11:00 返程\n\n---\n\n**关于住宿**：全程都住 hotel MONday Kyoto Marutamachi，离地铁站近。';
    expect(parseDraft(zh, stays).footer).toBe('');
  });

  it('reads a hotel list after the last day as footer, not as part of that day', () => {
    const zh = [
      '**第1天 | 二条城（轻松）**\n- 10:00 二条城\n- 今晚：hotel MONday Kyoto Marutamachi',
      '**第2天 | 返程（轻松）**\n- 11:00 返程',
      '---',
      '住宿备选（均为每晚价格）：\n- hotel MONday Kyoto Marutamachi：每晚 1093 CNY 起\n- Miyako Hotel Kyoto Hachijo：每晚 1395 CNY 起',
      '以上为草稿，出发前请再核对。',
    ].join('\n\n');
    const draft = parseDraft(zh, stays);
    expect(draft.days[1]).toEqual({ title: '第2天 | 返程（轻松）', body: '- 11:00 返程', stayRef: null });
    expect(draft.footer).toBe('---\n\n以上为草稿，出发前请再核对。');
  });

  it('keeps a hotel line that names no grounded stay as text', () => {
    const draft = parseDraft('**Day 1 | A (light)**\n- 10:00 A\n- Tonight: Invented Inn', stays);
    expect(draft.days[0]).toEqual({ title: 'Day 1 | A (light)', body: '- 10:00 A\n- Tonight: Invented Inn', stayRef: null });
  });

  it('treats text without day headers as preamble only', () => {
    expect(parseDraft('Live hotel data was unavailable.', stays)).toEqual({ preamble: 'Live hotel data was unavailable.', days: [], footer: '' });
  });
});

describe('renderPlan', () => {
  it('writes each hotel line from the stay, so a changed stay shows in the text', () => {
    const plan = kyotoPlan();
    const changed = { ...plan, ...splice(plan, { nights: nightsOf({ from: 0, to: 2 }, 'h3') }) };
    const text = renderPlan(changed, 'en', { numbered: true }) ?? '';
    expect(text).toContain('[D3] **Day 3 | Nijo Castle · Nishiki Market (light)**');
    expect(text.match(/- Tonight: Miyako Hotel Kyoto Hachijo/g)).toHaveLength(3);
    expect(text).not.toContain('MONday');
    expect(text.endsWith('please confirm availability before booking.')).toBe(true);
  });

  it('is null before there is a draft', () => {
    expect(renderPlan({ preamble: null, days: [], footer: '', stays: null }, 'en')).toBeNull();
  });
});

describe('splice', () => {
  it('returns untouched days as the same objects and keeps a rewritten day on its stay', () => {
    const plan = kyotoPlan();
    const next = splice(plan, { days: new Map([[2, { title: 'Day 3 | Nijo Castle (light)', body: '- 09:30 Nijo Castle', stops: [] }]]) });
    expect(next.days[0]).toBe(plan.days[0]);
    expect(next.days[1]).toBe(plan.days[1]);
    expect(next.days[3]).toBe(plan.days[3]);
    expect(next.days[2]).toEqual({ title: 'Day 3 | Nijo Castle (light)', body: '- 09:30 Nijo Castle', stops: [], stayRef: 'h1' });
    expect(next.preamble).toBe(plan.preamble);
  });
});

describe('segments', () => {
  it('groups consecutive nights on the same stay; the last day has no night', () => {
    const plan = kyotoPlan();
    expect(segments(plan)).toEqual([{ nights: { from: 0, to: 2 }, stayRef: 'h1' }]);
    const split = { ...plan, ...splice(plan, { nights: nightsOf({ from: 2, to: 2 }, 'h2') }) };
    expect(segments(split)).toEqual([{ nights: { from: 0, to: 1 }, stayRef: 'h1' }, { nights: { from: 2, to: 2 }, stayRef: 'h2' }]);
  });
});

describe('overviewLine', () => {
  it('takes the overview paragraph without its label', () => {
    expect(overviewLine(kyotoPlan().preamble)).toBe(
      'Kyoto 3 nights, one base, no hotel changes | light · standard · light · light\nDay 3 is now a light day: two places, both close to the hotel, with a long rest in between.',
    );
    expect(overviewLine('# Title')).toBeNull();
  });
});

describe('mergeStays', () => {
  it('keeps refs, refreshes a hotel seen again by provider id and numbers new ones after the highest ref', () => {
    const [monday, mEst] = stays.items;
    const merged = mergeStays(stays, { panel: 'hotels', items: [{ ...mEst, ref: 'r1', price: null }, { ...monday, id: '999', ref: 'r2' }] });
    expect(merged.items.map((h) => [h.ref, h.id])).toEqual([['h1', '1549991'], ['h2', '265237'], ['h3', '13249'], ['h4', '999']]);
    expect(merged.items[1].price).toBeNull();
  });

  it('drops the oldest stay no day uses when over 20', () => {
    const many = { panel: 'hotels' as const, items: Array.from({ length: 20 }, (_, i) => ({ ...stays.items[0], id: String(i), ref: `h${i + 1}` })) };
    const merged = mergeStays(many, { panel: 'hotels', items: [{ ...stays.items[0], id: 'new', ref: 'r1' }] }, new Set(['h1']));
    expect(merged.items).toHaveLength(20);
    expect(merged.items.map((h) => h.ref)).toContain('h1');
    expect(merged.items.map((h) => h.ref)).not.toContain('h2');
    expect(merged.items.at(-1)?.ref).toBe('h21');
  });
});
