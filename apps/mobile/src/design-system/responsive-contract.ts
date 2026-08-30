import { breakpoints, componentTokens } from './tokens.ts';

export type ResponsiveMode = 'compact' | 'medium' | 'expanded';

export type ResponsiveLayout = Readonly<{
  mode: ResponsiveMode;
  width: number;
  columns: 1 | 8 | 12;
  horizontalPadding: number;
  contentMaxWidth: number;
  isCompact: boolean;
  isMedium: boolean;
  isExpanded: boolean;
}>;

export function resolveResponsiveMode(width: number): ResponsiveMode {
  if (width >= breakpoints.expandedMin) return 'expanded';
  if (width >= breakpoints.mediumMin) return 'medium';
  return 'compact';
}

export function resolveResponsiveLayout(width: number): ResponsiveLayout {
  const mode = resolveResponsiveMode(width);
  return Object.freeze({
    mode,
    width,
    columns: mode === 'expanded' ? 12 : mode === 'medium' ? 8 : 1,
    horizontalPadding: mode === 'expanded'
      ? componentTokens.screen.expandedPadding
      : mode === 'medium'
        ? componentTokens.screen.mediumPadding
        : componentTokens.screen.compactPadding,
    contentMaxWidth: mode === 'expanded'
      ? componentTokens.screen.contentMaxWidth
      : componentTokens.screen.readableMaxWidth,
    isCompact: mode === 'compact',
    isMedium: mode === 'medium',
    isExpanded: mode === 'expanded',
  });
}
