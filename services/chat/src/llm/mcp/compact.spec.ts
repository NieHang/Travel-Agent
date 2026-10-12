import { compactToolContent } from './compact.js';
import { ROLLINGGO_COMPACT, ROLLINGGO_RAW } from './rollinggo.fixture.js';

describe('compactToolContent', () => {
  it('keeps ids, names, prices, links, amenities, every tag and the image', () => {
    expect(JSON.parse(compactToolContent(JSON.stringify(ROLLINGGO_RAW)))).toEqual(JSON.parse(ROLLINGGO_COMPACT));
  });
  it('leaves other content untouched', () => {
    expect(compactToolContent('plain text')).toBe('plain text');
    expect(compactToolContent('{"tags":[]}')).toBe('{"tags":[]}');
  });
});
