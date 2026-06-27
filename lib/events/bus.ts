// Minimal typed in-process event bus. Handlers are best-effort and isolated:
// a throwing listener never breaks the action that emitted the event.

import type { DomainEvent, DomainEventType, EventHandler } from "./types";

const handlers = new Map<DomainEventType, Set<EventHandler>>();

export function on<K extends DomainEventType>(
  type: K,
  handler: EventHandler<Extract<DomainEvent, { type: K }>>,
): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(handler as EventHandler);
  return () => {
    set.delete(handler as EventHandler);
  };
}

export async function emit(event: DomainEvent): Promise<void> {
  const set = handlers.get(event.type);
  if (!set) return;
  await Promise.all(
    [...set].map(async (h) => {
      try {
        await h(event);
      } catch (err) {
        console.error(`[events] handler for "${event.type}" failed:`, err);
      }
    }),
  );
}
