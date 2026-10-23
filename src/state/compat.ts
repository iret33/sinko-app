// What this app may do with a box, from its /pb/box.json.
//
// `api` is the contract number between the box and the app (Sinko docs/maintainers/architecture.md, "The app's contract number"): it
// goes up whenever pb-state gains or changes a key. Every parser of pb-state drops the keys it does not know, so an app that wrote back
// what it read from a newer box would wipe the box's new fields: on such a box the app reads, never writes, and asks to be updated. A
// lower or missing api (a box older than 3.2) is fine: the app knows everything those boxes have.
import { isNewer, parseSemver, type BoxInfo } from '../core/box';

/** The highest api this app knows (bin/sinko BOX_API). */
export const APP_API = 1;

/** The app may write pb-state to this box. An unknown box (no box.json) is judged when its box.json is read. */
export function stateWritable(info: BoxInfo | null | undefined): boolean {
  return !info || info.api <= APP_API;
}

/** The box speaks a newer contract than this app: the screens say "Please update the app". */
export function appTooOld(info: BoxInfo | null | undefined): boolean {
  return !stateWritable(info);
}

/** The box runs at least `version` (x.y.z). False when its version is not known. */
export function atLeast(info: BoxInfo | null | undefined, version: string): boolean {
  return !!info && !!parseSemver(info.version) && !isNewer(version, info.version);
}

/** The features that depend on the box's version. Learning (learn.on and the learned rules) came with Sinko 3.1.0. */
export function boxFeatures(info: BoxInfo | null | undefined): { learning: boolean } {
  return { learning: atLeast(info, '3.1.0') };
}
