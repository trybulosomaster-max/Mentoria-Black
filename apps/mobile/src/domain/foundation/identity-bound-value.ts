export type IdentityBoundValue<T> = Readonly<{
  identityKey: string;
  value: T;
}>;

export function bindValueToIdentity<T>(identityKey: string, value: T): IdentityBoundValue<T> {
  if (!identityKey.trim()) throw new TypeError('Identidade obrigatória para vincular estado privado.');
  return Object.freeze({ identityKey, value });
}

export function valueForActiveIdentity<T>(
  bound: IdentityBoundValue<T> | null | undefined,
  activeIdentityKey: string | null | undefined,
): T | null {
  if (!bound || !activeIdentityKey || bound.identityKey !== activeIdentityKey) return null;
  return bound.value;
}
