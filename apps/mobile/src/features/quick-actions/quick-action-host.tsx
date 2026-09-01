import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppIcon } from '../../design-system/icons';
import { useReducedMotion } from '../../design-system/system';
import { useAvioraTheme } from '../../design-system/theme-provider';
import {
  componentTokens,
  dynamicType,
  primitives,
  spacing,
  textStyles,
  type ThemeTokens,
} from '../../design-system/tokens';
import {
  QUICK_ACTIONS,
  type QuickActionDefinition,
  type QuickActionHandlers,
  type QuickActionTone,
} from './quick-action-contract';

const TRIGGER_SIZE = componentTokens.quickAction.triggerSize;
const ACTION_SIZE = componentTokens.quickAction.actionSize;
const ACTION_SLOT_WIDTH = componentTokens.quickAction.slotWidth;
const ACTION_SLOT_HEIGHT = componentTokens.quickAction.slotHeight;
const EMPTY_HANDLERS = Object.freeze({}) satisfies QuickActionHandlers;

type QuickActionHostProps = Readonly<{
  tabBarHeight: number;
  handlers?: QuickActionHandlers;
  actions?: readonly QuickActionDefinition[];
}>;

function toneColor(tone: QuickActionTone, tokens: ThemeTokens): string {
  if (tone === 'positive') return tokens.status.positiveText;
  if (tone === 'risk') return tokens.status.riskText;
  return tokens.action.text;
}

function radialTarget(action: QuickActionDefinition, sideRadius: number) {
  const upperPair = action.id === 'income' || action.id === 'card_purchase';
  const rightSide = action.id === 'card_purchase' || action.id === 'expense';
  const horizontalOffset = upperPair
    ? componentTokens.quickAction.topOffsetX
    : sideRadius;
  const verticalOffset = upperPair
    ? componentTokens.quickAction.topOffsetY
    : componentTokens.quickAction.sideOffsetY;
  return Object.freeze({
    x: rightSide ? horizontalOffset : -horizontalOffset,
    y: verticalOffset,
  });
}

function visibleActionLabel(action: QuickActionDefinition): string {
  return action.id === 'card_purchase' ? 'Despesa\nCartão' : action.label;
}

export function QuickActionHost({
  tabBarHeight,
  handlers = EMPTY_HANDLERS,
  actions = QUICK_ACTIONS,
}: QuickActionHostProps) {
  const { tokens } = useAvioraTheme();
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const progress = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const triggerBottom = tabBarHeight + spacing.xs;
  const sideRadius = Math.min(
    componentTokens.quickAction.sideOffsetXMax,
    Math.max(
      componentTokens.quickAction.sideOffsetXMin,
      (width - ACTION_SLOT_WIDTH - spacing.xs) / 2,
    ),
  );

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    progress.stopAnimation();
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: primitives.motion.duration.fast,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, reducedMotion, visible]);

  const open = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setVisible(true);
  }, []);

  const close = useCallback((afterClose?: () => void) => {
    void Haptics.selectionAsync().catch(() => undefined);
    progress.stopAnimation();
    if (reducedMotion) {
      progress.setValue(0);
      setVisible(false);
      afterClose?.();
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: primitives.motion.duration.fast,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setVisible(false);
      afterClose?.();
    });
  }, [progress, reducedMotion]);

  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => subscription.remove();
  }, [close, visible]);

  const choose = useCallback((action: QuickActionDefinition) => {
    const handler = handlers[action.id];
    if (!handler) return;
    close(() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      void handler();
    });
  }, [close, handlers]);

  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const contentOpacity = progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 0, 1] });
  const actionScale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] });
  const triggerRotation = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });

  return (
    <>
      {!visible && !keyboardVisible ? (
        <View pointerEvents="box-none" style={[styles.triggerDock, { bottom: triggerBottom }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir ações rápidas"
            accessibilityHint="Mostra os atalhos de Receitas, Despesa Cartão, Transferência e Despesa."
            accessibilityState={{ expanded: false }}
            hitSlop={spacing.xs}
            onPress={open}
            style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
            testID="quick-action-trigger"
          >
            <AppIcon name="plus" size={primitives.size.icon.md} color={tokens.action.onPrimary} />
          </Pressable>
        </View>
      ) : null}

      {visible ? (
        <View accessibilityViewIsModal style={styles.overlayLayer} testID="quick-action-menu">
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar ações rápidas"
            onPress={() => close()}
            style={StyleSheet.absoluteFill}
          />

          <View
            accessibilityLabel="Ações rápidas"
            accessibilityRole="menu"
            style={[styles.actionOrbit, { bottom: triggerBottom + (TRIGGER_SIZE / 2) }]}
          >
            {actions.map((action) => {
              const enabled = Boolean(handlers[action.id]);
              const color = toneColor(action.tone, tokens);
              const target = radialTarget(action, sideRadius);
              const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, target.x] });
              const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, target.y] });
              return (
                <Animated.View
                  key={action.id}
                  style={[
                    styles.actionMotion,
                    {
                      opacity: contentOpacity,
                      transform: [{ translateX }, { translateY }, { scale: actionScale }],
                    },
                  ]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={action.accessibilityLabel}
                    accessibilityHint={enabled ? 'Abre o fluxo oficial correspondente.' : 'Fluxo ainda não conectado.'}
                    accessibilityState={{ disabled: !enabled }}
                    disabled={!enabled}
                    onPress={() => choose(action)}
                    style={({ pressed }) => [styles.action, pressed && enabled && styles.pressed]}
                    testID={`quick-action-${action.id}`}
                  >
                    <View style={[styles.actionIcon, { borderColor: color }]}>
                      <AppIcon name={action.icon} size={primitives.size.icon.md} color={color} />
                    </View>
                    <View style={styles.actionLabelBox}>
                      <Text
                        maxFontSizeMultiplier={dynamicType.tabLabelMaxFontSizeMultiplier}
                        numberOfLines={2}
                        style={styles.actionLabel}
                      >
                        {visibleActionLabel(action)}
                      </Text>
                    </View>
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>

          <View pointerEvents="box-none" style={[styles.triggerDock, { bottom: triggerBottom }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fechar ações rápidas"
              accessibilityState={{ expanded: true }}
              hitSlop={spacing.xs}
              onPress={() => close()}
              style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
              testID="quick-action-close"
            >
              <Animated.View style={{ transform: [{ rotate: triggerRotation }] }}>
                <AppIcon name="plus" size={primitives.size.icon.md} color={tokens.action.onPrimary} />
              </Animated.View>
            </Pressable>
          </View>
        </View>
      ) : null}
    </>
  );
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    overlayLayer: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 30,
      elevation: componentTokens.quickAction.overlayElevation,
    },
    backdrop: { backgroundColor: tokens.overlay },
    triggerDock: {
      position: 'absolute',
      left: 0,
      right: 0,
      zIndex: 20,
      alignItems: 'center',
    },
    trigger: {
      width: TRIGGER_SIZE,
      height: TRIGGER_SIZE,
      borderRadius: primitives.radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: primitives.size.border.thin,
      borderColor: tokens.focus.ring,
      backgroundColor: tokens.action.primary,
      ...tokens.elevation.overlay,
    },
    actionOrbit: {
      position: 'absolute',
      left: '50%',
      zIndex: 21,
      width: 0,
      height: 0,
      overflow: 'visible',
    },
    actionMotion: {
      position: 'absolute',
      top: -(ACTION_SIZE / 2),
      left: -(ACTION_SLOT_WIDTH / 2),
      width: ACTION_SLOT_WIDTH,
      minHeight: ACTION_SLOT_HEIGHT,
    },
    action: {
      width: ACTION_SLOT_WIDTH,
      minHeight: ACTION_SLOT_HEIGHT,
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: spacing.xs,
    },
    actionIcon: {
      width: ACTION_SIZE,
      height: ACTION_SIZE,
      borderRadius: primitives.radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: primitives.size.border.thin,
      backgroundColor: tokens.background.surfaceMuted,
    },
    actionLabelBox: {
      width: '100%',
      minHeight: primitives.typography.lineHeight.button * 2,
      alignItems: 'center',
    },
    actionLabel: {
      ...textStyles.buttonLabel,
      width: '100%',
      alignSelf: 'center',
      color: tokens.text.primary,
      textAlign: 'center',
    },
    pressed: { opacity: primitives.opacity.pressed },
  });
}
