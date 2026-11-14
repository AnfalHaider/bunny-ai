/**
 * Offline stand-ins for the two network calls a connection makes.
 *
 * Test mode (`BUNNY_FAKE_UPSTREAM=1`) uses these so the whole app can be
 * exercised — connect, pick a model, chat — with no provider, no key and no
 * network. They are never used when the flag is off.
 */

const MODELS = [
  { id: 'offline/bunny-code', displayName: 'Bunny Code (offline)', ownedBy: 'bunny', contextLength: 200000 },
  { id: 'offline/bunny-large', displayName: 'Bunny Large (offline)', ownedBy: 'bunny', contextLength: 200000 },
  { id: 'offline/bunny-small', displayName: 'Bunny Small (offline)', ownedBy: 'bunny', contextLength: 128000 },
];

/** Same contract as defaultProbe: accepts any key, reports it as unverified. */
export async function offlineProbe() {
  return { ok: true, keyVerified: false };
}

/** Same contract as discoverModels: a fixed, already-normalised list. */
export async function offlineDiscover() {
  return MODELS.map((m) => ({ ...m }));
}
