// FB-158 · a batch that creates many tasks at once (a portal reading) must not send one Teams card per task.
// Inside quietTeams(), the tasks created by syncTasks are kept in the Inbox, marked as told, and handed back to the caller, which
// sends one card of synthesis. Server only (node:async_hooks): import it dynamically from files a client component can reach.
import { AsyncLocalStorage } from "node:async_hooks";
type Store = { tasks: { id: string; title: string; entity: string }[] };
const als = new AsyncLocalStorage<Store>();
export async function quietTeams<T>(fn: () => Promise<T>): Promise<{ result: T; tasks: Store["tasks"] }> {
  const store: Store = { tasks: [] };
  const result = await als.run(store, fn);
  return { result, tasks: store.tasks };
}
export const quietStore = (): Store | undefined => als.getStore();
