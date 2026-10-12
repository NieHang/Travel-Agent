/** Shape of a RollingGo hotel search response, as in the existing compaction test. */
export const ROLLINGGO_RAW = {
  message: 'Hotel search succeeded',
  hotelInformationList: [
    {
      hotelId: 43615,
      bookingUrl: 'https://rollinggo.ai/h/43615',
      name: 'Casa do Fado Alfama',
      brand: null,
      address: 'Rua de São Miguel 12, Lisboa',
      latitude: 38.71,
      longitude: -9.13,
      distanceInMeters: 850,
      starRating: 4,
      price: { hasPrice: true, currency: 'EUR', lowestPrice: 118 },
      description: 'long text',
      imageUrl: 'https://img.rollinggo.ai/43615.jpg',
      hotelAmenities: ['Free WiFi', 'Kitchen', 'Bathtub'],
      tags: ['Near Tram 28', 'Free WiFi', 'Rooftop terrace', 'Family rooms', 'Lift', 'Garden'],
    },
  ],
};

/** What compactToolContent (Task 6) returns for ROLLINGGO_RAW. */
export const ROLLINGGO_COMPACT = JSON.stringify({
  message: 'Hotel search succeeded',
  hotels: [
    {
      hotelId: 43615,
      name: 'Casa do Fado Alfama',
      brand: null,
      address: 'Rua de São Miguel 12, Lisboa',
      starRating: 4,
      distanceInMeters: 850,
      lowestPrice: '118 EUR',
      hotelAmenities: ['Free WiFi', 'Kitchen', 'Bathtub'],
      tags: ['Near Tram 28', 'Free WiFi', 'Rooftop terrace', 'Family rooms', 'Lift', 'Garden'],
      imageUrl: 'https://img.rollinggo.ai/43615.jpg',
      bookingUrl: 'https://rollinggo.ai/h/43615',
    },
  ],
});
