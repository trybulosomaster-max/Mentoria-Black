import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import { resolveResponsiveLayout, type ResponsiveLayout } from './responsive-contract';

export { resolveResponsiveLayout, resolveResponsiveMode } from './responsive-contract';
export type { ResponsiveLayout, ResponsiveMode } from './responsive-contract';

export function useResponsiveLayout(): ResponsiveLayout {
  const { width } = useWindowDimensions();
  return useMemo(() => resolveResponsiveLayout(width), [width]);
}
