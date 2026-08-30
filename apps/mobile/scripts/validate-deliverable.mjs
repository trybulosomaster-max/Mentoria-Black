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
  'src/core/supabase/client.ts',
  'src/domain/access/access-contract.ts',
  'src/domain/finance/foundation-financial-read-model.ts',
  'tests/contracts.test.ts',
  'tests/web-financial-parity.test.ts',
  'tests/web-contract-parity.test.ts',
];

for (const file of required) {
  if (await exists(file)) ok(`arquivo:${file}`);
  else fail(`arquivo:${file}`, 'ausente');
}

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (packageJson.dependencies?.expo === '~57.0.9') ok('stack:expo', packageJson.dependencies.expo);
else fail('stack:expo', `versão inesperada: ${packageJson.dependencies?.expo}`);
if (packageJson.dependencies?.['react-native'] === '0.86.2') ok('stack:react-native', packageJson.dependencies['react-native']);
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

const components = await readFile(path.join(root, 'src/design-system/components.tsx'), 'utf8');
if (/minHeight:\s*48/.test(components)) ok('accessibility:touch-target-48');
else fail('accessibility:touch-target-48', 'botão/input sem evidência de 48 pontos');

const authProviderSource = await readFile(path.join(root, 'src/core/auth/AuthProvider.tsx'), 'utf8');
const snapshotHookSource = await readFile(path.join(root, 'src/features/read-models/use-mobile-snapshot.ts'), 'utf8');

if (
  authProviderSource.includes('entitlementGeneration')
  && authProviderSource.includes('activeUserId')
  && authProviderSource.includes('requestIsCurrent')
) ok('isolation:entitlement-generation-guard');
else fail('isolation:entitlement-generation-guard', 'entitlement antigo pode atualizar sessão nova');

if (
  snapshotHookSource.includes('requestGeneration')
  && snapshotHookSource.includes('activeUserId')
  && snapshotHookSource.includes('requestIsCurrent')
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

for (const item of checks) console.log(`✓ ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
for (const item of failures) console.error(`✗ ${item.name} — ${item.detail}`);

console.log(`\nResultado: ${checks.length} verificações aprovadas; ${failures.length} falhas.`);
if (failures.length) process.exit(1);
