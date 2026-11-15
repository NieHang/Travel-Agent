import { TurnTraceSchema } from '@autix/contracts';
import { lookupSubject } from './copy.js';
import { lookupCount, TurnTraceBuilder } from './trace.js';

const at = '2026-11-15T12:00:00.000Z';
const later = '2026-11-15T12:00:01.000Z';
const endedAt = '2026-11-15T12:00:02.000Z';
const lookup = { tool: 'searchHotels', subject: '大阪酒店', at: later, ok: true, count: 2 };

describe('TurnTraceBuilder', () => {
  it('folds phases, lookups and grounding into a trace with consecutive phases collapsed', () => {
    const builder = new TurnTraceBuilder();
    builder.record({ type: 'phase', phase: 'understanding', at });
    builder.record({ type: 'phase', phase: 'searching', at });
    builder.record({ type: 'phase', phase: 'searching', at: later });
    builder.record({ type: 'lookup', lookup });
    builder.record({ type: 'grounding', kept: 2, dropped: 1, at: later });
    builder.record({ type: 'grounding', kept: 1, dropped: 2, at: later });
    builder.record({ type: 'phase', phase: 'writing', at: later });
    builder.record({ type: 'phase', phase: 'searching', at: later });
    expect(builder.finish(endedAt)).toEqual({
      steps: [
        { phase: 'understanding', at },
        { phase: 'searching', at },
        { phase: 'writing', at: later },
        { phase: 'searching', at: later },
      ],
      endedAt,
      verification: { lookups: [lookup], grounding: { kept: 3, dropped: 3 } },
    });
  });

  it('distinguishes no show_results call from one that kept no items', () => {
    const builder = new TurnTraceBuilder();
    expect(builder.started).toBe(false);
    expect(builder.finish(endedAt)).toEqual({ steps: [], endedAt, verification: { lookups: [], grounding: null } });
    builder.record({ type: 'phase', phase: 'understanding', at });
    builder.record({ type: 'grounding', kept: 0, dropped: 2, at });
    expect(builder.started).toBe(true);
    expect(builder.finish(endedAt).verification).toEqual({ lookups: [], grounding: { kept: 0, dropped: 2 } });
  });

  it('caps both arrays at the contract maxima and keeps the first entries', () => {
    const builder = new TurnTraceBuilder();
    for (const i of Array.from({ length: 50 }, (_, i) => i)) {
      builder.record({ type: 'phase', phase: i % 2 ? 'searching' : 'writing', at });
      builder.record({ type: 'lookup', lookup: { ...lookup, subject: `lookup ${i}` } });
    }
    const trace = TurnTraceSchema.parse(builder.finish(endedAt));
    expect(trace.steps).toHaveLength(40);
    expect(trace.steps[39]).toEqual({ phase: 'searching', at });
    expect(trace.verification?.lookups).toHaveLength(20);
    expect(trace.verification?.lookups[19]).toEqual({ ...lookup, subject: 'lookup 19' });
    expect(trace.endedAt).toBe(endedAt);
  });

  it('returns a snapshot that later events do not change', () => {
    const builder = new TurnTraceBuilder();
    builder.record({ type: 'phase', phase: 'understanding', at });
    const trace = builder.finish(later);
    builder.record({ type: 'phase', phase: 'writing', at: later });
    builder.record({ type: 'lookup', lookup });
    expect(trace).toEqual({ steps: [{ phase: 'understanding', at }], endedAt: later, verification: { lookups: [], grounding: null } });
  });
});

describe('lookupCount', () => {
  it.each([
    ['{"hotels":[{},{}]}', 2],
    ['{"hotels":[]}', 0],
    ['{"places":[{},{}]}', null],
    ['{"hotels":2}', null],
    ['Tool failed', null],
  ])('counts only known result shapes: %s', (content, expected) => {
    expect(lookupCount(content)).toBe(expected);
  });
});

describe('lookupSubject', () => {
  const args = { place: '大阪', checkInParam: { checkInDate: '2026-12-31', stayNights: 2, adultCount: 2 } };

  it('localizes hotel lookups and derives the checkout date across year boundaries', () => {
    expect(lookupSubject('mcp_rollingGo_searchHotels', args, 'zh')).toBe('大阪酒店 · 12/31–01/02');
    expect(lookupSubject('mcp_rollingGo_searchHotels', { ...args, place: 'Osaka' }, 'en')).toBe('Hotels in Osaka · 12/31–01/02');
  });

  it('uses useful generic arguments and returns null when none are available', () => {
    expect(lookupSubject('places', { query: 'Kyoto temples' }, 'en')).toBe('Kyoto temples');
    expect(lookupSubject('searchHotels', { city: 'Kyoto' }, 'en')).toBe('Hotels in Kyoto');
    expect(lookupSubject('unknown', {}, 'en')).toBeNull();
    expect(lookupSubject('searchHotels', { place: 42 }, 'en')).toBeNull();
  });
});
