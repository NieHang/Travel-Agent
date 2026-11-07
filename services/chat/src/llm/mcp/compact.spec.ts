import { compactToolContent } from './compact.js';
import { ROLLINGGO_COMPACT, ROLLINGGO_RAW } from './rollinggo.fixture.js';

describe('compactToolContent', () => {
  it('keeps ids, both names, prices, links, amenities, every tag and the image', () => {
    expect(JSON.parse(compactToolContent(JSON.stringify(ROLLINGGO_RAW)))).toEqual(JSON.parse(ROLLINGGO_COMPACT));
  });
  describe('hotels outside Japan', () => {
    const [hotel] = ROLLINGGO_RAW.hotelInformationList;
    const shanghai = { ...hotel, hotelId: 29527, name: '上海裕景大饭店', areaCode: 'CN' };
    const osaka = { ...hotel, hotelId: 1603617, name: 'BRACKETS HOTEL 大阪本町', areaCode: 'JP' };
    const compact = (hotels: object[]) =>
      JSON.parse(compactToolContent(JSON.stringify({ message: '酒店搜索成功', hotelInformationList: hotels }))) as {
        message: string;
        hotels: { hotelId: number }[];
      };

    it('drops them and keeps the provider message when Japan hotels remain', () => {
      const result = compact([shanghai, osaka]);
      expect(result.hotels.map((h) => h.hotelId)).toEqual([1603617]);
      expect(result.message).toBe('酒店搜索成功');
    });

    it('tells the model to search without the country when none are in Japan', () => {
      const result = compact([shanghai, { ...shanghai, hotelId: 123640 }]);
      expect(result.hotels).toEqual([]);
      expect(result.message).toMatch(/^No hotels in Japan/);
      expect(result.message).toContain('"大阪", not "大阪 日本"');
    });

    it('keeps the provider message for an empty search', () => {
      expect(compact([])).toEqual({ message: '酒店搜索成功', hotels: [] });
    });
  });
  it('leaves other content untouched', () => {
    expect(compactToolContent('plain text')).toBe('plain text');
    expect(compactToolContent('{"tags":[]}')).toBe('{"tags":[]}');
  });
});
