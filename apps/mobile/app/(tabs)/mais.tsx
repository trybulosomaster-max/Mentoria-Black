import Constants from 'expo-constants';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import { appEnvironment } from '../../src/core/config/env';
import {
  AppButton,
  Card,
  PageHeader,
  Pill,
  Screen,
  SectionTitle,
  commonStyles,
} from '../../src/design-system/components';
import { componentTokens, primitives, semantic, spacing, textStyles } from '../../src/design-system/tokens';

const modules = [
  ['Metas', 'Acompanhamento detalhado na próxima onda'],
  ['Saúde financeira', 'Indicadores e diagnósticos após paridade'],
  ['Relatórios', 'Visualizações nativas após benchmark'],
  ['Conhecimento', 'Leitura, progresso e favoritos na Onda 3'],
] as const;

export default function MoreScreen() {
  const { user, entitlements, signOut } = useAuth();
  const version = Constants.expoConfig?.version ?? '0.1.0';

  return (
    <Screen>
      <PageHeader title="Mais" description="Conta, módulos e informações desta fundação móvel." />

      <SectionTitle title="Sua conta" />
      <Card style={styles.accountCard}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{String(user?.email ?? 'A').charAt(0).toUpperCase()}</Text></View>
        <View style={styles.accountCopy}>
          <Text style={styles.accountName}>{String(user?.user_metadata?.full_name ?? 'Cliente AVIORA')}</Text>
          <Text style={styles.accountEmail}>{user?.email ?? 'E-mail não informado'}</Text>
          <View style={commonStyles.wrap}>
            <Pill label={entitlements?.app.accessType === 'trial' ? 'Acesso APP trial' : 'Acesso APP'} tone="gold" />
            <Pill label={appEnvironment.readOnly ? 'Financeiro em leitura' : 'Financeiro habilitado'} tone="warning" />
          </View>
        </View>
      </Card>

      <SectionTitle title="Módulos" />
      {modules.map(([title, description]) => (
        <Card key={title} style={styles.moduleCard}>
          <View style={commonStyles.between}>
            <View style={styles.accountCopy}>
              <Text style={styles.moduleTitle}>{title}</Text>
              <Text style={styles.moduleDescription}>{description}</Text>
            </View>
            <Pill label="Em breve" />
          </View>
        </Card>
      ))}

      <SectionTitle title="Aplicativo" />
      <Card style={styles.infoCard}>
        <View style={commonStyles.between}><Text style={styles.infoLabel}>Versão</Text><Text style={styles.infoValue}>{version}</Text></View>
        <View style={commonStyles.between}><Text style={styles.infoLabel}>Ambiente</Text><Text style={styles.infoValue}>{appEnvironment.name}</Text></View>
        <View style={commonStyles.between}><Text style={styles.infoLabel}>Plataformas</Text><Text style={styles.infoValue}>iOS e Android</Text></View>
        <View style={commonStyles.between}><Text style={styles.infoLabel}>Stack</Text><Text style={styles.infoValue}>Expo SDK 57</Text></View>
      </Card>

      <AppButton label="Sair desta conta" variant="danger" onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  accountCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: componentTokens.avatar.size, height: componentTokens.avatar.size, borderRadius: primitives.radius.pill, backgroundColor: primitives.color.gold[900], borderWidth: primitives.size.border.thin, borderColor: semantic.action.primaryPressed, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...textStyles.section, color: semantic.text.accent },
  accountCopy: { flex: 1, minWidth: spacing.none, gap: spacing.xs },
  accountName: { ...textStyles.section, color: semantic.text.primary },
  accountEmail: { ...textStyles.bodySmall, color: semantic.text.secondary },
  moduleCard: { minHeight: componentTokens.avatar.size + spacing.xl, justifyContent: 'center' },
  moduleTitle: { ...textStyles.body, color: semantic.text.primary, fontFamily: primitives.typography.family.uiExtraBold },
  moduleDescription: { ...textStyles.caption, color: semantic.text.secondary },
  infoCard: { gap: spacing.md },
  infoLabel: { ...textStyles.bodySmall, color: semantic.text.secondary },
  infoValue: { ...textStyles.bodySmall, color: semantic.text.primary, fontFamily: primitives.typography.family.uiBold, textAlign: 'right' },
});
