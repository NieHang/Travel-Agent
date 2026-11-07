const MAX_HOTELS = 10;
/** Hilda plans trips in Japan only. */
const JAPAN = 'JP';
// RollingGo answers some "city country" places with hotels elsewhere: "大阪 日本" and "大阪市 日本" return
// Shanghai, while "大阪" returns Osaka. The tool's own description asks for "城市 国家", so tell the model how to retry.
const NO_JAPAN_HOTELS =
  'No hotels in Japan: this search only matched hotels in other countries, which were removed. Search again with the place name alone, without the country (e.g. "大阪", not "大阪 日本").';

interface RawHotel {
  hotelId?: number;
  /** The provider's Chinese name. */
  name?: string;
  /** The hotel's official English name. */
  nameEn?: string;
  brand?: string | null;
  address?: string;
  /** ISO country code, e.g. "JP". */
  areaCode?: string;
  starRating?: number;
  distanceInMeters?: number;
  bookingUrl?: string;
  imageUrl?: string;
  hotelAmenities?: string[];
  tags?: string[];
  price?: { hasPrice?: boolean; lowestPrice?: number; currency?: string };
}

/**
 * Shrinks known provider payloads before the model reads them. Keeps what cards and follow-ups
 * need (ids, names, prices, links, amenities, tags, one image); drops descriptions, coordinates
 * and hotels the provider places outside Japan. Unrecognised output is returned unchanged, so
 * other MCP servers pass through.
 */
export function compactToolContent(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  const list = (parsed as { hotelInformationList?: unknown })?.hotelInformationList;
  if (!Array.isArray(list)) return text;
  // A hotel without an areaCode is kept.
  const japan = (list as RawHotel[]).filter((h) => h.areaCode === undefined || h.areaCode === JAPAN);
  return JSON.stringify({
    message: list.length && !japan.length ? NO_JAPAN_HOTELS : (parsed as { message?: unknown }).message,
    hotels: japan.slice(0, MAX_HOTELS).map((h) => ({
      hotelId: h.hotelId,
      name: h.name,
      nameEn: h.nameEn ?? null,
      brand: h.brand ?? null,
      address: h.address,
      starRating: h.starRating,
      distanceInMeters: h.distanceInMeters,
      lowestPrice: h.price?.hasPrice ? `${h.price.lowestPrice} ${h.price.currency}` : null,
      hotelAmenities: h.hotelAmenities ?? [],
      tags: h.tags ?? [],
      imageUrl: h.imageUrl ?? null,
      bookingUrl: h.bookingUrl,
    })),
  });
}
