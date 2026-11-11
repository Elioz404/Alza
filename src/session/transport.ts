/**
 * How the tabs of a shared session reach each other: a Transport carries messages, nothing more.
 * It does not read them, order them or trust them: the session (runtime.ts) checks every message
 * it hears against its schema (messages.ts), and orders changes by their clocks (replica.ts), so
 * any transport that delivers some messages, late or twice, is enough.
 *
 * Two are here:
 *  - broadcastTransport: the tabs of this browser on this origin, over a BroadcastChannel. The
 *    browser never delivers it to another origin, and a tab never hears its own messages.
 *  - inPageHub: transports that hear each other inside one page, for the tests (two simulated
 *    tabs), and for a second view of the plan in the same page.
 *
 * The seam for more: a network relay (a WebSocket to a relay that forwards each message to the
 * other members of a room) is one more function returning a Transport — `send` serialises the
 * message as JSON, `subscribe` parses what arrives — and runtime.ts takes it in place of the
 * BroadcastChannel without the UI knowing. What it adds is what a network needs and this page
 * does not: who may join a room (accounts, invitations) and a relay to run; the messages, their
 * checks and the merge stay as they are.
 */

export interface Transport {
  /** Hand a message to every other member; never echoed back to this one. */
  send(message: unknown): void;
  /** Hear what the others send. Returns the way to stop hearing. */
  subscribe(listener: (message: unknown) => void): () => void;
  /** Leave: nothing is sent or heard any more. */
  close(): void;
}

/** The tabs of this browser on this origin, over the BroadcastChannel `name`; null where there is none. */
export function broadcastTransport(name: string): Transport | null {
  if (typeof BroadcastChannel !== "function") return null;
  const channel = new BroadcastChannel(name);
  const listeners = new Set<(message: unknown) => void>();
  channel.onmessage = (e: MessageEvent) => {
    for (const listener of listeners) listener(e.data);
  };
  // a message that could not be deserialised is dropped: it was never one of ours
  channel.onmessageerror = () => undefined;
  let open = true;
  return {
    send(message) {
      if (!open) return;
      try {
        channel.postMessage(message);
      } catch (err) {
        // a message the browser cannot clone is not sent; the next change carries the state on
        console.warn("[alza] a session message could not be sent", err);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      open = false;
      listeners.clear();
      channel.close();
    },
  };
}

/**
 * Transports that hear each other in one page. Delivery is asynchronous, as a channel's is, and
 * every message is copied (structuredClone) on its way, so a member never holds another's objects.
 */
export function inPageHub(): { connect(): Transport } {
  const members = new Set<(message: unknown) => void>();
  return {
    connect() {
      const listeners = new Set<(message: unknown) => void>();
      const deliver = (message: unknown) => {
        for (const listener of listeners) listener(message);
      };
      members.add(deliver);
      return {
        send(message) {
          if (!members.has(deliver)) return;
          for (const member of members) {
            if (member === deliver) continue;
            const copy = structuredClone(message);
            queueMicrotask(() => member(copy));
          }
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close() {
          members.delete(deliver);
          listeners.clear();
        },
      };
    },
  };
}
