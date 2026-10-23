// The app's one connection: the boxes list in AsyncStorage, the session ids in the keychain (expo-secure-store).
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { createBoxesStore } from './boxes';
import { createConnection } from './connection';
import { createSessions } from './session';

export const boxes = createBoxesStore(AsyncStorage);
export const sessions = createSessions(SecureStore);
export const connection = createConnection({ boxes, sessions });
