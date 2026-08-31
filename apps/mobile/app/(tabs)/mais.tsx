import Constants from 'expo-constants';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import { AppButton, Card, PageHeader, Screen, SectionTitle, StatusPill } from '../../src/design-system/components';
import { ThemeRadioRow } from '../../src/design-system/financial-components';
import { useAvioraTheme } from '../../src/design-system/theme-provider';
import { primitives, spacing, textStyles, type ThemeTokens } from '../../src/design-system/tokens';

const modules = ['Metas', 'Saúde financeira', 'Relatórios', 'Conhecimento'] as const;

const appearanceOptions = [
  { value: 'system', label: 'Sistema', helper: 'Usa a preferência do dispositivo.' },
  { value: 'light', label: 'Claro', helper: 'Patrimônio Sereno.' },
  { value: 'dark', label: 'Escuro', helper: 'Noite Executiva.' },
] as const;

export default function MoreScreen() {
  const { user, entitlements, signOut } = useAuth();
  const { preference, resolvedTheme, setPreference, tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const version = Constants.expoConfig?.version ?? '0.1.0';

  return (
    <Screen>
      <PageHeader title="Mais" description="Sua conta e preferências." />

      <SectionTitle title="Sua conta" />
      <View style={styles.accountCard}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{String(user?.email ?? 'A').charAt(0).toUpperCase()}</Text></View>
        <View style={styles.accountCopy}>
          <Text style={styles.accountName}>{String(user?.user_metadata?.full_name ?? 'Cliente AVIORA')}</Text>
          <Text style={styles.accountEmail}>{user?.email ?? 'E-mail não informado'}</Text>
          <View style={styles.badges}>
            <StatusPill label={entitlements?.app.accessType === 'trial' ? 'Acesso temporário' : 'Acesso ativo'} tone="positive" />
          </View>
        </View>
      </View>

      <SectionTitle title="Aparência" />
      <View accessibilityRole="radiogroup" accessibilityLabel="Aparência" style={styles.appearanceGroup}>
        {appearanceOptions.map((option) => <ThemeRadioRow key={option.value} label={option.label} helper={option.helper} selected={preference === option.value} onPress={() => setPreference(option.value)} />)}
      </View>
      <Text style={styles.resolved}>Aparência atual: {resolvedTheme === 'light' ? 'Patrimônio Sereno' : 'Noite Executiva'}.</Text>

      <SectionTitle title="Outras áreas" />
      <Card style={styles.moduleGroup}>{modules.map((title, index) => <View key={title} style={[styles.moduleRow, index < modules.length - 1 && styles.moduleDivider]}><Text style={styles.moduleTitle}>{title}</Text><StatusPill label="Em breve" /></View>)}</Card>

      <SectionTitle title="Sobre" />
      <Card style={styles.infoCard}>
        <InfoRow label="Versão" value={version} styles={styles} />
        <InfoRow label="Experiência" value="Beta" styles={styles} />
      </Card>
      <AppButton label="Sair desta conta" variant="danger" onPress={signOut} />
    </Screen>
  );
}

function InfoRow({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.between}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>;
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    accountCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xs, paddingVertical: spacing.xxs },
    avatar: { width: primitives.size.touch.default, height: primitives.size.touch.default, borderRadius: primitives.radius.pill, backgroundColor: tokens.background.surfaceMuted, borderWidth: primitives.size.border.thin, borderColor: tokens.brand.accent, alignItems: 'center', justifyContent: 'center' },
    avatarText: { ...textStyles.section, color: tokens.brand.accent },
    accountCopy: { flex: 1, minWidth: spacing.none, gap: spacing.xs },
    accountName: { ...textStyles.section, color: tokens.text.primary },
    accountEmail: { ...textStyles.bodySmall, color: tokens.text.secondary },
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    appearanceGroup: { gap: spacing.xs },
    resolved: { ...textStyles.caption, color: tokens.text.secondary },
    moduleGroup: { padding: spacing.none },
    moduleRow: { minHeight: primitives.size.touch.comfortable, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
    moduleDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.border.default },
    moduleTitle: { ...textStyles.body, color: tokens.text.primary, fontFamily: primitives.typography.family.uiBold },
    infoCard: { gap: spacing.md },
    between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    infoLabel: { ...textStyles.bodySmall, color: tokens.text.secondary },
    infoValue: { ...textStyles.bodySmall, color: tokens.text.primary, fontFamily: primitives.typography.family.uiBold, textAlign: 'right' },
  });
}
