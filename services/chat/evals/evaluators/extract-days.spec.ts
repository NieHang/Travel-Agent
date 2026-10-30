import type { TripDay } from '../../src/trip/state.js';
import { gradeExtractDays } from './extract-days.js';

const day = (names: string[], stayRef: string | null = null): TripDay => ({
  title: 'Day 1', stops: names.map((name) => ({ name, note: null, time: null })), stayRef,
});

it('normalizes width, whitespace, case and bracketed names', () => {
  expect(gradeExtractDays([day([' ＫＹＯＴＯ （京都）', 'Temple【本堂】', 'Park [West]', 'Gate〈南〉', 'Garden⟨East⟩', 'Tower（Main【North】）'])],
    { days: [{ stops: ['kyoto', 'Temple', 'Park', 'Gate', 'Garden', 'Tower'], stayRef: null }] })).toEqual([
    { name: 'day_count_exact', value: 1 }, { name: 'stop_f1', value: 1 },
    { name: 'stay_ref_acc', value: 1 }, { name: 'leg_as_stop', value: 0 },
  ]);
});

it('averages by day position over the longer list and counts travel legs', () => {
  expect(gradeExtractDays([day(['Park', 'Haruka'], 'h1'), day(['Temple'])],
    { days: [{ stops: ['Park', 'Gate'], stayRef: 'h1' }] })).toEqual([
    { name: 'day_count_exact', value: 0 }, { name: 'stop_f1', value: 0.25 },
    { name: 'stay_ref_acc', value: 0.5 }, { name: 'leg_as_stop', value: 1 },
  ]);
});

it('does not match stops on a different day or missing days with null stays', () => {
  expect(gradeExtractDays([day(['A']), day(['B'])], { days: [{ stops: ['B'], stayRef: null }, { stops: ['A'], stayRef: 'h2' }] }))
    .toEqual([{ name: 'day_count_exact', value: 1 }, { name: 'stop_f1', value: 0 }, { name: 'stay_ref_acc', value: 0.5 }, { name: 'leg_as_stop', value: 0 }]);
  expect(gradeExtractDays([], { days: [{ stops: [], stayRef: null }] }))
    .toContainEqual({ name: 'stay_ref_acc', value: 0 });
});

it('matches stops by containment, each label at most once, preferring exact matches', () => {
  expect(gradeExtractDays([day(['新宿御苑外', '涩谷', 'Hotel'])], { days: [{ stops: ['新宿御苑', '涩谷十字路口', '涩谷'], stayRef: null }] }))
    .toContainEqual({ name: 'stop_f1', value: 2 * 2 / 6 });
});

it('treats duplicate normalized stops as a set and empty lists as a match', () => {
  expect(gradeExtractDays([day(['Park', 'park'])], { days: [{ stops: ['park'], stayRef: null }] }))
    .toContainEqual({ name: 'stop_f1', value: 1 });
  expect(gradeExtractDays([], { days: [] })).toEqual([
    { name: 'day_count_exact', value: 1 }, { name: 'stop_f1', value: 1 },
    { name: 'stay_ref_acc', value: 1 }, { name: 'leg_as_stop', value: 0 },
  ]);
});
