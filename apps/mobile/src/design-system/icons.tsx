import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { componentTokens, semantic } from './tokens';

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
  goal: 'flag-outline',
  report: 'bar-chart-outline',
  knowledge: 'book-outline',
  profile: 'person-outline',
  security: 'shield-checkmark-outline',
  'chevron-left': 'chevron-back',
  'chevron-right': 'chevron-forward',
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
  color = semantic.text.secondary,
  accessibilityLabel,
}: AppIconProps) {
  return (
    <Ionicons
      name={iconMap[name]}
      size={size}
      color={color}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
    />
  );
}
