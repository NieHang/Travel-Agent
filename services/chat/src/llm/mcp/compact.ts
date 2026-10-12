const MAX_HOTELS = 10;

interface RawHotel {
  hotelId?: number;
  name?: string;
  brand?: string | null;
  address?: string;
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
 * need (ids, names, prices, links, amenities, tags, one image); drops descriptions and coordinates.
 * Unrecognised output is returned unchanged, so other MCP servers pass through.
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
  return JSON.stringify({
    message: (parsed as { message?: unknown }).message,
    hotels: (list as RawHotel[]).slice(0, MAX_HOTELS).map((h) => ({
      hotelId: h.hotelId,
      name: h.name,
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
