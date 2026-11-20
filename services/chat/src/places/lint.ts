import type { PlaceRecordInput } from './record.js';

export function lintRecords(records: PlaceRecordInput[], today: string, staleAfterDays: number): string[] {
  const findings: string[] = [];
  for (const record of records) {
    if (record.pin.status === 'unpinned') findings.push(record.slug + ': unpinned');
    const facts = [
      ...(record.hours.type === 'not_recorded' ? [] : [record.hours]),
      ...record.closures, ...(record.access ? [record.access] : []),
    ];
    for (const fact of facts) {
      if (Date.parse(today) - Date.parse(fact.checkedOn) > staleAfterDays * 86_400_000)
        findings.push(record.slug + ': stale fact checked ' + fact.checkedOn + ' ' + fact.source);
    }
    for (const { when, source } of record.closures) {
      if (when.type === 'range' && when.until < today) findings.push(record.slug + ': works ended ' + when.until + ' ' + source);
    }
  }
  return findings;
}
