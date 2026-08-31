import {
  createAccessContext,
  type AccessContext,
  type AccessContextInput,
} from '../../domain/foundation/access-context.ts';
import type { PrivateCachePort } from '../../ports/foundation-ports.ts';

export class StaleAccessContextError extends Error {
  readonly code = 'STALE_ACCESS_CONTEXT';
}

export class IdentityRuntime {
  #current: AccessContext | null = null;
  #generation = 0;
  readonly #cache: PrivateCachePort;
  readonly #clock: () => number;

  constructor(cache: PrivateCachePort, clock: () => number = Date.now) {
    this.#cache = cache;
    this.#clock = clock;
  }

  current(): AccessContext | null {
    return this.#current;
  }

  async activate(input: Omit<AccessContextInput, 'generation'>): Promise<AccessContext> {
    const previous = this.#current;
    if (previous && (
      previous.actingUserId !== input.actingUserId
      || previous.environment !== input.environment
    )) {
      this.#current = null;
      await this.#cache.purgeIdentity(previous.environment, previous.actingUserId);
    }

    const context = createAccessContext({
      ...input,
      generation: ++this.#generation,
    }, this.#clock());
    this.#current = context;
    return context;
  }

  async logout(): Promise<void> {
    const previous = this.#current;
    this.#current = null;
    this.#generation += 1;
    if (previous) await this.#cache.purgeIdentity(previous.environment, previous.actingUserId);
  }

  isCurrent(context: AccessContext): boolean {
    return this.#current === context
      && this.#current.generation === context.generation
      && this.#current.actingUserId === context.actingUserId
      && Date.parse(context.sessionExpiresAt) > this.#clock();
  }

  requireCurrent(context: AccessContext): void {
    if (!this.isCurrent(context)) throw new StaleAccessContextError('Contexto de acesso expirado ou substituído.');
  }
}
