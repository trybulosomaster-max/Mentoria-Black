import Constants from 'expo-constants';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import { appEnvironment } from '../../src/core/config/env';
import { AppButton, Card, PageHeader, Screen, SectionTitle, StatusPill } from '../../src/design-system/components';
import { PermissionBadge, ThemeRadioRow } from '../../src/design-system/financial-components';
import { useAvioraTheme } from '../../src/design-system/theme-provider';
import { componentTokens, primitives, spacing, textStyles, type ThemeTokens } from '../../src/design-system/tokens';

const modules = [
  ['Metas', 'Acompanhamento detalhado em uma onda própria'],
  ['Saúde financeira', 'Indicadores preservados até o gate de paridade'],
  ['Relatórios', 'Leitura nativa em uma onda posterior'],
  ['Conhecimento', 'Biblioteca e reader permanecem fora desta onda'],
] as const;

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
      <PageHeader title="Mais" description="Conta, aparência, módulos e informações do AVIORA Mobile." />

      <SectionTitle title="Sua conta" />
      <Card style={styles.accountCard}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{String(user?.email ?? 'A').charAt(0).toUpperCase()}</Text></View>
        <View style={styles.accountCopy}>
          <Text style={styles.accountName}>{String(user?.user_metadata?.full_name ?? 'Cliente AVIORA')}</Text>
          <Text style={styles.accountEmail}>{user?.email ?? 'E-mail não informado'}</Text>
          <View style={styles.badges}>
            <PermissionBadge label={entitlements?.app.accessType === 'trial' ? 'Acesso APP trial' : 'Acesso APP'} />
            <StatusPill label={appEnvironment.readOnly ? 'Financeiro em leitura' : 'Financeiro habilitado'} tone="warning" />
          </View>
        </View>
      </Card>

      <SectionTitle title="Aparência" />
      <View accessibilityRole="radiogroup" accessibilityLabel="Aparência" style={styles.appearanceGroup}>
        {appearanceOptions.map((option) => <ThemeRadioRow key={option.value} label={option.label} helper={option.helper} selected={preference === option.value} onPress={() => setPreference(option.value)} />)}
      </View>
      <Text style={styles.resolved}>Tema ativo: {resolvedTheme === 'light' ? 'Patrimônio Sereno' : 'Noite Executiva'}.</Text>

      <SectionTitle title="Módulos oficiais" />
      {modules.map(([title, description]) => <Card key={title} style={styles.moduleCard}><View style={styles.between}><View style={styles.accountCopy}><Text style={styles.moduleTitle}>{title}</Text><Text style={styles.moduleDescription}>{description}</Text></View><StatusPill label="Próxima onda" /></View></Card>)}

      <SectionTitle title="Aplicativo" />
      <Card style={styles.infoCard}>
        <InfoRow label="Versão" value={version} styles={styles} />
        <InfoRow label="Ambiente" value={appEnvironment.name} styles={styles} />
        <InfoRow label="Plataformas" value="iOS e Android" styles={styles} />
        <InfoRow label="Modo financeiro" value={appEnvironment.readOnly ? 'Somente leitura' : 'Habilitado'} styles={styles} />
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
    accountCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    avatar: { width: componentTokens.avatar.size, height: componentTokens.avatar.size, borderRadius: primitives.radius.pill, backgroundColor: tokens.background.surfaceMuted, borderWidth: primitives.size.border.thin, borderColor: tokens.brand.accent, alignItems: 'center', justifyContent: 'center' },
    avatarText: { ...textStyles.section, color: tokens.brand.accent },
    accountCopy: { flex: 1, minWidth: spacing.none, gap: spacing.xs },
    accountName: { ...textStyles.section, color: tokens.text.primary },
    accountEmail: { ...textStyles.bodySmall, color: tokens.text.secondary },
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    appearanceGroup: { gap: spacing.xs },
    resolved: { ...textStyles.caption, color: tokens.text.secondary },
    moduleCard: { minHeight: componentTokens.avatar.size + spacing.xl, justifyContent: 'center' },
    moduleTitle: { ...textStyles.body, color: tokens.text.primary, fontFamily: primitives.typography.family.uiBold },
    moduleDescription: { ...textStyles.caption, color: tokens.text.secondary },
    infoCard: { gap: spacing.md },
    between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    infoLabel: { ...textStyles.bodySmall, color: tokens.text.secondary },
    infoValue: { ...textStyles.bodySmall, color: tokens.text.primary, fontFamily: primitives.typography.family.uiBold, textAlign: 'right' },
  });
}
