import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { componentTokens } from './tokens';
import { useAvioraTheme } from './theme-provider';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export const iconMap = Object.freeze({
  home: 'home-outline',
  transactions: 'list-outline',
  planning: 'calendar-outline',
  patrimony: 'diamond-outline',
  more: 'ellipsis-horizontal',
  settings: 'settings-outline',
  search: 'search-outline',
  filter: 'options-outline',
  calendar: 'calendar-outline',
  wallet: 'wallet-outline',
  card: 'card-outline',
  eye: 'eye-outline',
  'eye-off': 'eye-off-outline',
  'trend-up': 'trending-up-outline',
  'trend-down': 'trending-down-outline',
  'arrow-up': 'arrow-up-outline',
  'arrow-down': 'arrow-down-outline',
  transfer: 'swap-horizontal-outline',
  goal: 'flag-outline',
  report: 'bar-chart-outline',
  knowledge: 'book-outline',
  profile: 'person-outline',
  security: 'shield-checkmark-outline',
  'chevron-left': 'chevron-back',
  'chevron-right': 'chevron-forward',
  'chevron-down': 'chevron-down',
  'chevron-up': 'chevron-up',
  close: 'close',
  plus: 'add',
  edit: 'create-outline',
  trash: 'trash-outline',
  info: 'information-circle-outline',
  warning: 'warning-outline',
  success: 'checkmark-circle-outline',
  error: 'close-circle-outline',
} satisfies Readonly<Record<string, IoniconName>>);

export type AppIconName = keyof typeof iconMap;

type AppIconProps = Readonly<{
  name: AppIconName;
  size?: number;
  color?: ColorValue;
  accessibilityLabel?: string;
}>;

export function AppIcon({
  name,
  size = componentTokens.iconButton.iconSize,
  color,
  accessibilityLabel,
}: AppIconProps) {
  const { tokens } = useAvioraTheme();
  return (
    <Ionicons
      name={iconMap[name]}
      size={size}
      color={color ?? tokens.text.secondary}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
    />
  );
}
