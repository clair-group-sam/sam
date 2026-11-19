/* FB-121 · a refusal the user must read (missing field, wrong step, no right). Next.js hides the message of an error thrown on
 * the server in production, but forwards its `digest`: the message travels there and app/(app)/error.tsx shows it in the page,
 * instead of the blank "Application error" screen. Synchronous and typed `never`, so it narrows like a throw. */
export const FAIL_PREFIX = "SAM:";
export function fail(message: string): never {
  const e = new Error(message) as Error & { digest: string };
  e.digest = FAIL_PREFIX + message.slice(0, 400);
  throw e;
}
