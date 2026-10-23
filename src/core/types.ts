// The shapes Sinko reads from Pi-hole v6 (FTL's OpenAPI specs) and from its own files. Only the fields Sinko uses are named;
// answers come from the network, so every function that reads them still checks what it gets, like the original.

/** GET /api/groups: one group. Sinko's own are named pb-* (docs/maintainers/architecture.md, "Pieces"). */
export interface Group {
  id: number;
  name: string;
  enabled: boolean;
  comment: string | null;
}

/** GET /api/clients: one client row. `client` is a MAC, an IP, a subnet, a host name or an :interface. */
export interface ClientRow {
  id: number;
  client: string;
  comment: string | null;
  groups: number[];
  name?: string | null;
}

/** GET /api/network/devices: one device of FTL's network table. `hwaddr` is "ip-<addr>" when FTL has no MAC for it. */
export interface DeviceAddress {
  ip: string;
  name: string | null;
}
export interface Device {
  id: number;
  hwaddr: string;
  macVendor: string;
  lastQuery: number;
  numQueries?: number;
  ips: DeviceAddress[];
}

/** GET /api/domains: one domain or regex rule. */
export interface DomainRow {
  id?: number;
  domain: string;
  type: 'allow' | 'deny';
  kind: 'exact' | 'regex';
  comment: string | null;
  enabled: boolean;
  groups: number[];
}

/** /pb/services.json (lists/services.json in Sinko). */
export interface CatalogService {
  id: string;
  name: string;
  ar: string;
  category: string;
  homework: boolean;
  color: string;
}
export interface Catalog {
  version: number;
  categories: { id: string; en: string; ar: string }[];
  services: CatalogService[];
}

// ------------------------------------------------------------------ the shared state (pb-state group description)
export type TimerMode = 'free' | 'block';
export interface Timer {
  mode: TimerMode;
  until: number;
  snapshot: { services: Record<string, boolean>; offline: boolean };
}
export interface Schedule {
  enabled: boolean;
  start: string;
  end: string;
  days: number[];
}
/** A request marker: the time of the request in ms on the box's clock, or an opaque string of 1-40 characters. */
export type Marker = number | string | null;
export type UpdateStatus = 'idle' | 'running' | 'ok' | 'failed';
export interface UpdateState {
  auto: boolean;
  request: Marker;
  checkRequest: Marker;
  latest: string | null;
  notes: string | null;
  checked: number;
  status: UpdateStatus;
  from: string | null;
  to: string | null;
  at: number;
  error: string | null;
  rolledBack: boolean | null;
}
export type PowerAction = 'reboot' | 'poweroff';
export interface PowerState {
  request: Marker;
  action: PowerAction | null;
}
export interface SinkoState {
  v: number;
  timer: Timer | null;
  schedule: Schedule;
  scheduleActive: boolean;
  update: UpdateState;
  power: PowerState;
  telemetry: { on: boolean | null };
  community: { online: number; at: number } | null;
  setup: { done: boolean };
  learn: { on: boolean };
}

/** A rule the box learned (PBCore.learnedRules). */
export interface LearnedRule {
  app: string;
  day: string;
  zone: string;
  back: boolean;
  enabled: boolean;
  regex: string;
  groups: number[];
}
