/**
 * FB-024 · Test data lives next to real data on sam-dev (projects "test addition", manual "TEST OM", aircraft 9HTEST…).
 * Until a proper flag exists, an object whose title / code / registration says "test" is treated as test data:
 * it keeps working, but it is labelled, and it is left out of the counters people read at a glance.
 */
const RE = /(^|[^a-z])test(ing)?([^a-z]|$)/i;
export function isTestData(...fields: (string | null | undefined)[]): boolean {
  return fields.some((f) => !!f && RE.test(f));
}
export const TEST_PILL_TITLE = "Test data — left out of the counters";
