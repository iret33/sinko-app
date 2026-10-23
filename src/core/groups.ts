// Sinko's Pi-hole groups and which of them a child's device must be in.
//
// Port of Sinko web/app.js: the config (lines 13-15), kidGroupIds (line 758; it read the page's global model M, here it takes the model
// as an argument) and neededGroupIds (line 681; it read the page's global catalog, here it takes the catalog's services as an argument).
import type { CatalogService, Group } from './types';

/** app.js G (line 13): Sinko's own groups. The pb- prefix is historical and must not be renamed (architecture.md, "Pieces"). */
export const G = { kids: 'pb-kids', guard: 'pb-guard', offline: 'pb-offline', paused: 'pb-paused', state: 'pb-state' } as const;
/** app.js SVC (line 14): the prefix of an app's group, pb-svc-<service id>. */
export const SVC = 'pb-svc-';
/** app.js DEFAULT_GROUP (line 15): Pi-hole's Default group. */
export const DEFAULT_GROUP = 0;

/** The groups by name, as load() builds them (app.js line 722). */
export type GroupsByName = Record<string, Group>;

/**
 * app.js kidGroupIds (line 758): the groups a new child's device is put in. Default, pb-kids, pb-guard, pb-offline and every app's group.
 * `model` is what load() returns: its groups by name and its services (each with the group of that app).
 */
export function kidGroupIds(model: { groups: GroupsByName; services: { group: Group }[] }): number[] {
  const ids = [DEFAULT_GROUP];
  [G.kids, G.guard, G.offline].forEach((n) => { if (model.groups[n]) ids.push(model.groups[n].id); });
  model.services.forEach((s) => { ids.push(s.group.id); });
  return ids;
}

/** app.js neededGroupIds (line 681): the pb-* groups a child's row must have (not Default). `services` is services.json's list. */
export function neededGroupIds(byName: GroupsByName, paused: boolean, services: CatalogService[]): number[] {
  const ids: number[] = [];
  ([G.kids, G.guard, G.offline] as string[]).concat(paused ? [G.paused] : []).forEach((n) => { if (byName[n]) ids.push(byName[n].id); });
  services.forEach((s) => { const g = byName[SVC + s.id]; if (g) ids.push(g.id); });
  return ids;
}
