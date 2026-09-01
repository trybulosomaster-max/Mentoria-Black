import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const checks = [];

function ok(name, detail = '') {
  checks.push({ name, detail });
}

function fail(name, detail) {
  failures.push({ name, detail });
}

async function exists(relative) {
  try {
    return (await stat(path.join(root, relative))).isFile();
  } catch {
    return false;
  }
}

async function walk(relative) {
  const base = path.join(root, relative);
  const entries = await readdir(base, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const item = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walk(item));
    else files.push(item);
  }
  return files;
}

const required = [
  'package.json',
  'app.config.ts',
  'eas.json',
  '.env.example',
  'app/_layout.tsx',
  'app/index.tsx',
  'app/(tabs)/_layout.tsx',
  'app/(tabs)/index.tsx',
  'app/(tabs)/lancamentos.tsx',
  'app/(tabs)/planejamento.tsx',
  'app/(tabs)/patrimonio.tsx',
  'app/(tabs)/mais.tsx',
  'src/core/auth/AuthProvider.tsx',
  'src/core/config/public-client-credential.ts',
  'src/core/supabase/client.ts',
  'src/domain/access/access-contract.ts',
  'src/domain/finance/foundation-financial-read-model.ts',
  'src/features/quick-actions/quick-action-contract.ts',
  'src/features/quick-actions/quick-action-host.tsx',
  'tests/contracts.test.ts',
  'tests/web-financial-parity.test.ts',
  'tests/web-contract-parity.test.ts',
  'src/domain/foundation/access-context.ts',
  'src/domain/foundation/identity-bound-value.ts',
  'src/domain/foundation/capability-registry.ts',
  'src/ports/foundation-ports.ts',
  'src/application/foundation/identity-runtime.ts',
  'src/infrastructure/cache/memory-private-cache.ts',
  'src/infrastructure/observability/redacted-observability.ts',
  'tests/foundation-core.test.ts',
  'src/domain/bootstrap/app-bootstrap.ts',
  'src/presentation/bootstrap/BootstrapExperience.tsx',
  'src/presentation/navigation/AppRouteGate.tsx',
  'tests/app-shell-auth.test.ts',
  'tests/security-guards.test.ts',
  'tests/use-mobile-snapshot.integration.test.ts',
  'tests/quick-actions.test.ts',
];

for (const file of required) {
  if (await exists(file)) ok(`arquivo:${file}`);
  else fail(`arquivo:${file}`, 'ausente');
}

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (packageJson.dependencies?.expo === '~57.0.9') ok('stack:expo', packageJson.dependencies.expo);
else fail('stack:expo', `versão inesperada: ${packageJson.dependencies?.expo}`);
if (packageJson.dependencies?.['react-native'] === '0.86.3') ok('stack:react-native', packageJson.dependencies['react-native']);
else fail('stack:react-native', `versão inesperada: ${packageJson.dependencies?.['react-native']}`);
if (packageJson.dependencies?.['expo-router'] === '~57.0.16') ok('stack:expo-router', packageJson.dependencies['expo-router']);
else fail('stack:expo-router', `versão inesperada: ${packageJson.dependencies?.['expo-router']}`);

const env = await readFile(path.join(root, '.env.example'), 'utf8');
if (/EXPO_PUBLIC_AVIORA_READ_ONLY=true/.test(env)) ok('gate:read-only-default');
else fail('gate:read-only-default', 'a flag deve nascer true');
if (/EXPO_PUBLIC_AVIORA_ENABLE_TRIAL_START=false/.test(env)) ok('gate:trial-disabled-default');
else fail('gate:trial-disabled-default', 'trial deve nascer desabilitado');
if (!/https:\/\/[a-z0-9]{20}\.supabase\.co/i.test(env)) ok('gate:no-hardcoded-supabase-project');
else fail('gate:no-hardcoded-supabase-project', 'project ref encontrado');

const sourceFiles = [
  ...await walk('app'),
  ...await walk('src'),
  ...await walk('tests'),
].filter((file) => /\.(ts|tsx)$/.test(file));

for (const relative of sourceFiles) {
  const source = await readFile(path.join(root, relative), 'utf8');
  const result = ts.transpileModule(source, {
    fileName: relative,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      isolatedModules: true,
    },
  });
  const syntax = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (syntax.length) {
    fail(`sintaxe:${relative}`, syntax.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join(' | '));
  }
}
if (!failures.some((item) => item.name.startsWith('sintaxe:'))) ok('sintaxe:typescript', `${sourceFiles.length} arquivos`);

const combined = await Promise.all(sourceFiles.map(async (file) => ({ file, source: await readFile(path.join(root, file), 'utf8') })));
const secretCandidates = combined.filter(({ file, source }) => {
  if (file.endsWith('src/core/config/env.ts')) return false; // contém apenas bloqueios explícitos.
  return /sb_secret_|service_role|eyJ[a-zA-Z0-9_-]{40,}\.[a-zA-Z0-9_-]{20,}/.test(source);
});
if (!secretCandidates.length) ok('gate:no-client-secrets');
else fail('gate:no-client-secrets', secretCandidates.map((item) => item.file).join(', '));

const repository = await readFile(path.join(root, 'src/features/read-models/mobile-read.repository.ts'), 'utf8');
const forbiddenWrites = ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc('].filter((token) => repository.includes(token));
if (!forbiddenWrites.length) ok('gate:read-repository-has-no-write');
else fail('gate:read-repository-has-no-write', forbiddenWrites.join(', '));

function databaseBoundaryViolations(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.ES2022,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations = [];
  const hasRuntimeSupabaseImport = sourceFile.statements.some((statement) => (
    ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && /supabase/i.test(statement.moduleSpecifier.text)
    && statement.importClause?.isTypeOnly !== true
  ));
  if (hasRuntimeSupabaseImport) violations.push('import Supabase em runtime');
  if (/(?:require|import)\s*\(\s*['"][^'"]*supabase/i.test(source)) {
    violations.push('import Supabase dinâmico');
  }
  if (/\b(?:requireSupabaseClient|getSupabaseClient|createClient|supabaseAdmin)\b/.test(source)) {
    violations.push('acesso a cliente Supabase');
  }
  const operations = new Set();
  function collectDatabaseOperations(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const operation = node.expression.name.text;
      const receiver = node.expression.expression;
      const isNativeArrayFrom = operation === 'from'
        && ts.isIdentifier(receiver)
        && receiver.text === 'Array';
      if (
        !isNativeArrayFrom
        && ['from', 'rpc', 'insert', 'update', 'upsert', 'delete'].includes(operation)
      ) {
        operations.add(`.${operation}(`);
      }
    }
    ts.forEachChild(node, collectDatabaseOperations);
  }
  collectDatabaseOperations(sourceFile);
  if (operations.size) violations.push(...operations);
  return violations;
}

const dashboardSources = combined.filter(({ file }) => file.startsWith('src/features/dashboard/'));
const dashboardBoundaryViolations = dashboardSources.flatMap(({ file, source }) => {
  const violations = databaseBoundaryViolations(file, source);
  return violations.length ? [{ file, violations }] : [];
});
if (dashboardSources.length && !dashboardBoundaryViolations.length) {
  ok('gate:dashboard-read-only-boundary', `${dashboardSources.length} arquivos`);
} else if (!dashboardSources.length) {
  fail('gate:dashboard-read-only-boundary', 'nenhum arquivo encontrado em src/features/dashboard');
} else {
  fail(
    'gate:dashboard-read-only-boundary',
    dashboardBoundaryViolations
      .map(({ file, violations }) => `${file}: ${violations.join(', ')}`)
      .join(' | '),
  );
}

const quickActionSources = combined.filter(({ file }) => (
  file === 'app/(tabs)/_layout.tsx'
  || file.startsWith('src/features/quick-actions/')
));
const quickActionBoundaryViolations = quickActionSources.flatMap(({ file, source }) => {
  const violations = databaseBoundaryViolations(file, source);
  return violations.length ? [{ file, violations }] : [];
});
if (quickActionSources.length >= 3 && !quickActionBoundaryViolations.length) {
  ok('gate:quick-actions-read-only-boundary', `${quickActionSources.length} arquivos`);
} else if (quickActionSources.length < 3) {
  fail('gate:quick-actions-read-only-boundary', `escopo inesperado: ${quickActionSources.length} arquivos`);
} else {
  fail(
    'gate:quick-actions-read-only-boundary',
    quickActionBoundaryViolations
      .map(({ file, violations }) => `${file}: ${violations.join(', ')}`)
      .join(' | '),
  );
}

const components = await readFile(path.join(root, 'src/design-system/components.tsx'), 'utf8');
const designTokens = await readFile(path.join(root, 'src/design-system/tokens.ts'), 'utf8');
if (
  /touch: Object\.freeze\(\{ minimum: 44, default: 48, comfortable: 52 \}\)/.test(designTokens)
  && components.includes('minHeight: componentTokens.button.minHeight')
  && components.includes('minHeight: componentTokens.input.minHeight')
) ok('accessibility:touch-target-48');
else fail('accessibility:touch-target-48', 'botão/input sem evidência de 48 pontos');

const authProviderSource = await readFile(path.join(root, 'src/core/auth/AuthProvider.tsx'), 'utf8');
const snapshotHookSource = await readFile(path.join(root, 'src/features/read-models/use-mobile-snapshot.ts'), 'utf8');
const credentialGuardSource = await readFile(path.join(root, 'src/core/config/public-client-credential.ts'), 'utf8');

if (
  credentialGuardSource.includes('assertPublicClientCredential')
  && credentialGuardSource.includes('PUBLISHABLE_KEY_PATTERN')
  && credentialGuardSource.includes('legacyJwtRole')
) ok('security:public-client-credential-guard');
else fail('security:public-client-credential-guard', 'classificação pública/legada ausente');

if (
  authProviderSource.includes('entitlementGeneration')
  && authProviderSource.includes('activeUserId')
  && authProviderSource.includes('requestIsCurrent')
  && authProviderSource.includes('valueForActiveIdentity')
) ok('isolation:entitlement-generation-guard');
else fail('isolation:entitlement-generation-guard', 'entitlement antigo pode atualizar sessão nova');

if (
  snapshotHookSource.includes('requestGeneration')
  && snapshotHookSource.includes('activeIdentity')
  && snapshotHookSource.includes('identityKey')
  && snapshotHookSource.includes('requestIsCurrent')
  && snapshotHookSource.includes('state.identityKey === identityKey')
) ok('isolation:snapshot-generation-guard');
else fail('isolation:snapshot-generation-guard', 'snapshot antigo pode atualizar usuário novo');

if (
  repository.includes('loadMobileSnapshot(userId: string)')
  && repository.includes(".eq('user_id', userId)")
) ok('isolation:repository-explicit-user');
else fail('isolation:repository-explicit-user', 'repository deve exigir userId explicitamente além de RLS');

const tabLayout = await readFile(path.join(root, 'app/(tabs)/_layout.tsx'), 'utf8');
const tabLabels = ['Início', 'Lançamentos', 'Planejamento', 'Patrimônio', 'Mais'];
const missingTabs = tabLabels.filter((label) => !tabLayout.includes(label));
if (!missingTabs.length) ok('navigation:five-frozen-tabs');
else fail('navigation:five-frozen-tabs', missingTabs.join(', '));

const bootstrapContract = await readFile(path.join(root, 'src/domain/bootstrap/app-bootstrap.ts'), 'utf8');
const routeGuard = await readFile(path.join(root, 'src/presentation/navigation/AppRouteGate.tsx'), 'utf8');
const bootstrapStates = [
  'BOOTING',
  'UNAUTHENTICATED',
  'AUTHENTICATED_CHECKING_ACCESS',
  'AUTHORIZED',
  'UNAUTHORIZED',
  'RECOVERABLE_ERROR',
];
const missingBootstrapStates = bootstrapStates.filter((state) => !bootstrapContract.includes(`'${state}'`));
if (!missingBootstrapStates.length) ok('bootstrap:six-state-contract');
else fail('bootstrap:six-state-contract', missingBootstrapStates.join(', '));
if (routeGuard.includes('resolveRouteDecision') && routeGuard.includes('retryBootstrap')) ok('bootstrap:central-route-guard');
else fail('bootstrap:central-route-guard', 'guard central ou retry ausente');

for (const item of checks) console.log(`✓ ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
for (const item of failures) console.error(`✗ ${item.name} — ${item.detail}`);

console.log(`\nResultado: ${checks.length} verificações aprovadas; ${failures.length} falhas.`);
if (failures.length) process.exit(1);
