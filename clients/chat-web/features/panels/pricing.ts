export const NIGHTS = 5
export function fullStayPrice(perNight: number): number { return Math.round(perNight * NIGHTS * 0.88) }
