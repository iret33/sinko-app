// What test/state/signin.test.ts uses from src/state, in one place.
import { parseBoxInfo, type BoxInfo } from '../../src/core/box';

export { boxFeatures } from '../../src/state/compat';
export { ClaimTaken, createConnection, type Connection } from '../../src/state/connection';
export { createBoxesStore, type KeyValueStorage } from '../../src/state/boxes';
export { createSessions, type SecretStorage } from '../../src/state/session';

/** box.json of a box of this version. */
export function parseBoxInfoForTest(version: string): BoxInfo {
  return parseBoxInfo({ v: 1, version, at: 5 }) as BoxInfo;
}
