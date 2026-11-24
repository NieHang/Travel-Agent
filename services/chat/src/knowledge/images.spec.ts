import { expect, it } from 'vitest';
import { imageLookup } from './images.js';
import { parsePage } from './page.js';

const page = (id: string, image: string) => parsePage(id, `---
title: Tofuku-ji
names: {zh: 东福寺, ja: 東福寺}
aliases: [Tsutenkyo]
type: place
updated: 2026-11-21
${image}---
Body`);

it('finds a page photo by any of its names, however they are spelled', () => {
  const find = imageLookup([page('kyoto/tofuku-ji', 'image: {source: "https://example.org/photo", credit: "A. Author, CC BY 4.0"}\n')]);
  expect(['东福寺', '東福寺', 'tofukuji', 'TSUTENKYO', 'Tofuku-ji '].map(find)).toEqual(Array(5).fill('/places/kyoto/tofuku-ji.webp'));
  expect(find('东福寺站')).toBeNull();
});

it('finds nothing for a page without a photo', () => {
  expect(imageLookup([page('kyoto/tofuku-ji', '')])('东福寺')).toBeNull();
});
