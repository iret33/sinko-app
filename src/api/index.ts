// The client of the selected box. src/state sets it when a box is chosen (connectBox); everything else calls call().
import { ApiError, type CallOptions, type Client } from './client';

export * from './client';

let active: Client | null = null;

export function setActiveClient(client: Client | null): void { active = client; }
export function activeClient(): Client | null { return active; }

/** call(method, path, options) against the selected box (see createClient). Rejects with status 0 when no box is selected. */
export function call<T = unknown>(method: string, path: string, options?: CallOptions): Promise<T> {
  if (!active) return Promise.reject(new ApiError(0, 'No box is selected.'));
  return active.call<T>(method, path, options);
}

/** Now on the selected box's clock, in seconds (the phone's clock until the box has answered once). */
export function serverNowSec(): number {
  return active ? active.clock.nowSec() : Date.now() / 1000;
}
