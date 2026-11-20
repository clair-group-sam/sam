/* FB-134 · one way to show a date everywhere: dd/mm/yyyy. Takes an ISO date or timestamp, keeps the day as written. */
export const fr = (d: string | null | undefined): string => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split("-").reverse().join("/") : d ? String(d) : "—");
/** A timestamp as dd/mm/yyyy hh:mm (the time as stored, UTC). */
export const frdt = (d: string | null | undefined): string => (d && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(d) ? `${fr(d)} ${d.slice(11, 16)}` : fr(d));
/** A text written earlier by S.A.M. (a task, a note, an exchange) may carry ISO dates: they are shown dd/mm/yyyy like every other date.
 *  Identifiers are left alone (a date is four digits, two, two, with nothing but a separator around it). */
export const frText = (s: string | null | undefined): string => (s ?? "").replace(/(?<![\w/-])(\d{4})-(\d{2})-(\d{2})(?![\w-])/g, (m, y, mo, d) => (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31 ? `${d}/${mo}/${y}` : m));
