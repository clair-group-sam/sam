/* FB-134 · one way to show a date everywhere: dd/mm/yyyy. Takes an ISO date or timestamp, keeps the day as written. */
export const fr = (d: string | null | undefined): string => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split("-").reverse().join("/") : d ? String(d) : "—");
