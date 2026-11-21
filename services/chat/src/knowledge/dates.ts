import type { Requirements } from '@autix/contracts';

// Japanese public holidays from the Cabinet Office list, checked 2026-11-19.
// https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv
const holidays = new Set([
  '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20', '2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-05-06', '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22', '2027-04-29', '2027-05-03', '2027-05-04',
  '2027-05-05', '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23', '2027-10-11', '2027-11-03', '2027-11-23',
]);
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function tripDates({ departureDate, returnDate }: Requirements): string[] {
  if (!departureDate) return [];
  const dates: string[] = [];
  const end = Date.parse(returnDate ?? departureDate);
  for (let day = Date.parse(departureDate); day <= end; day += 86_400_000) {
    const instant = new Date(day);
    const date = instant.toISOString().slice(0, 10);
    dates.push(`${date} ${weekdays[instant.getUTCDay()]}${holidays.has(date) ? ' (public holiday)' : ''}`);
  }
  return dates;
}
