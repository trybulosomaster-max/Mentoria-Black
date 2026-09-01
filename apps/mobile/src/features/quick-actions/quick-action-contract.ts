import type { AppIconName } from '../../design-system/icons.tsx';

export const QUICK_ACTION_IDS = Object.freeze([
  'income',
  'card_purchase',
  'transfer',
  'expense',
] as const);

export type QuickActionId = (typeof QUICK_ACTION_IDS)[number];
export type QuickActionTone = 'positive' | 'card' | 'transfer' | 'risk';

export type QuickActionDefinition = Readonly<{
  id: QuickActionId;
  label: string;
  accessibilityLabel: string;
  icon: AppIconName;
  tone: QuickActionTone;
}>;

/**
 * Contrato exclusivamente de apresentação. Destinos e comandos financeiros
 * serão registrados em gates próprios; esta fundação não conhece rotas,
 * repositories, RPCs nem persistência.
 */
export const QUICK_ACTIONS = Object.freeze([
  Object.freeze({
    id: 'income',
    label: 'Receitas',
    accessibilityLabel: 'Lançar receita',
    icon: 'arrow-up',
    tone: 'positive',
  }),
  Object.freeze({
    id: 'card_purchase',
    label: 'Despesa Cartão',
    accessibilityLabel: 'Lançar compra no cartão',
    icon: 'card',
    tone: 'card',
  }),
  Object.freeze({
    id: 'transfer',
    label: 'Transferência',
    accessibilityLabel: 'Transferir entre contas',
    icon: 'transfer',
    tone: 'transfer',
  }),
  Object.freeze({
    id: 'expense',
    label: 'Despesa',
    accessibilityLabel: 'Lançar despesa',
    icon: 'arrow-down',
    tone: 'risk',
  }),
] as const satisfies readonly QuickActionDefinition[]);

export type QuickActionHandlers = Readonly<
  Partial<Record<QuickActionId, () => void | Promise<void>>>
>;

export function isQuickActionId(value: unknown): value is QuickActionId {
  return typeof value === 'string' && QUICK_ACTION_IDS.some((id) => id === value);
}
