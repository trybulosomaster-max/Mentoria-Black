export type FinancialEventIdentity = Readonly<{
  canonicalId: string;
  operationId?: string;
  externalId?: string;
}>;

export type EvidenceReference = Readonly<{
  evidenceId: string;
  source: 'manual' | 'assisted_ai' | 'image' | 'pdf' | 'csv' | 'ofx' | 'open_finance' | 'external_api';
  externalReference?: string;
}>;

export type Provenance = Readonly<{
  authority: 'user' | 'provider' | 'system';
  evidence: readonly EvidenceReference[];
  observedAt: string;
}>;

export type ReconciliationState = 'unmatched' | 'candidate' | 'matched' | 'divergent' | 'user_overridden';

export type ReconciliationReference = Readonly<{
  state: ReconciliationState;
  canonicalEventId?: string;
  confidence?: number;
}>;

export type FinancialEventReference = Readonly<{
  identity: FinancialEventIdentity;
  provenance?: Provenance;
  reconciliation?: ReconciliationReference;
}>;
