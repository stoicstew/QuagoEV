import raw from '../../fixtures/demo-snapshot.json';
import { validateSnapshot } from './types';
export function demoSnapshot() { return validateSnapshot(structuredClone(raw)); }
