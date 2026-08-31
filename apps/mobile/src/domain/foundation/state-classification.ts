export const STATE_AUTHORITIES = Object.freeze([
  'CANONICAL_REMOTE',
  'SYNCABLE',
  'DEVICE_LOCAL',
  'REBUILDABLE_CACHE',
  'SECRET',
  'EPHEMERAL',
] as const);

export type StateAuthority = (typeof STATE_AUTHORITIES)[number];

export const MOBILE_STATE_CLASSIFICATION = Object.freeze({
  financialFacts: 'CANONICAL_REMOTE',
  entitlements: 'CANONICAL_REMOTE',
  session: 'SECRET',
  refreshToken: 'SECRET',
  financialReadModels: 'REBUILDABLE_CACHE',
  knowledgeAuthorizedContent: 'REBUILDABLE_CACHE',
  reserveCurrent: 'DEVICE_LOCAL',
  uiPreferences: 'DEVICE_LOCAL',
  futureCrossDeviceNotes: 'SYNCABLE',
  filtersAndDrafts: 'EPHEMERAL',
} as const satisfies Readonly<Record<string, StateAuthority>>);
