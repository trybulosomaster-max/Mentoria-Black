import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`✓ ${name}`);
}

function fail(name, detail) {
  failed += 1;
  console.error(`✗ ${name} — ${detail}`);
}

async function source(relative) {
  return readFile(path.join(root, relative), 'utf8');
}

async function filesUnder(relative) {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(child));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(child);
  }
  return files;
}

const tokenSource = await source('src/design-system/tokens.ts');
for (const token of ['primitives', 'semantic', 'componentTokens', 'textStyles', 'breakpoints']) {
  tokenSource.includes(`export const ${token}`) ? ok(`tokens:${token}`) : fail(`tokens:${token}`, 'export ausente');
}
for (const group of ['neutral', 'gold', 'green', 'red', 'yellow', 'blue']) {
  tokenSource.includes(`${group}: Object.freeze`) ? ok(`color:${group}`) : fail(`color:${group}`, 'primitive ausente');
}

const componentSource = await source('src/design-system/components.tsx');
for (const component of ['AppButton', 'IconButton', 'TextField', 'SearchField', 'Card', 'MetricCard', 'StatusPill', 'FilterChip', 'InlineNotice', 'StateView', 'Divider', 'PageHeader', 'SectionTitle', 'ProgressBar', 'BottomSheet', 'Dialog']) {
  new RegExp(`export (?:function|const) ${component}\\b`).test(componentSource) ? ok(`component:${component}`) : fail(`component:${component}`, 'componente ausente');
}
componentSource.includes("'tab' | 'stack' | 'modal' | 'auth'") ? ok('screen:variants') : fail('screen:variants', 'contrato incompleto');
componentSource.includes('KeyboardAvoidingView') && componentSource.includes('useSafeAreaInsets') ? ok('screen:safe-area-keyboard') : fail('screen:safe-area-keyboard', 'infraestrutura ausente');
componentSource.includes('accessibilityViewIsModal') ? ok('accessibility:modal') : fail('accessibility:modal', 'isolamento modal ausente');
componentSource.includes('accessibilityRole="progressbar"') ? ok('accessibility:progress') : fail('accessibility:progress', 'sem role de progresso');
/<Text\b[^>]*\bonPress=/.test(componentSource) ? fail('accessibility:no-text-onpress', 'Text interativo encontrado') : ok('accessibility:no-text-onpress');

const iconSource = await source('src/design-system/icons.tsx');
iconSource.includes('@expo/vector-icons/Ionicons') ? ok('icons:ionicons') : fail('icons:ionicons', 'sistema vetorial ausente');
for (const name of ['home', 'transactions', 'planning', 'patrimony', 'more', 'settings', 'search', 'filter', 'calendar', 'wallet', 'card', 'goal', 'report', 'knowledge', 'profile', 'security', 'close', 'plus', 'edit', 'trash', 'info', 'warning', 'success', 'error']) {
  new RegExp(`\\b${name}:|'${name}':`).test(iconSource) ? ok(`icon:${name}`) : fail(`icon:${name}`, 'mapping ausente');
}

const responsiveSource = await source('src/design-system/responsive-contract.ts');
responsiveSource.includes('resolveResponsiveMode') && responsiveSource.includes('resolveResponsiveLayout') ? ok('responsive:helpers') : fail('responsive:helpers', 'helpers ausentes');

const appFiles = [...await filesUnder('app'), ...await filesUnder('src')];
const hardcodeExclusions = new Set(['src/design-system/tokens.ts']);
const hardcodePattern = /#[0-9a-f]{3,8}\b|rgba?\s*\(/i;
const localVisualPattern = /\b(?:fontSize|borderRadius|opacity|shadowOpacity|shadowRadius|elevation)\s*:\s*-?\d/;
const structuralGlyphPattern = /[⌂≡▦◇]|•••/;
const designSystemForbiddenImport = /(?:domain\/finance|features\/read-models|core\/supabase)/;

for (const file of appFiles) {
  const content = await source(file);
  if (!hardcodeExclusions.has(file) && hardcodePattern.test(content)) fail(`hardcode:color:${file}`, 'cor literal fora de tokens');
  if (!hardcodeExclusions.has(file) && localVisualPattern.test(content)) fail(`hardcode:visual:${file}`, 'valor visual local fora de tokens');
  if (structuralGlyphPattern.test(content)) fail(`icons:glyph:${file}`, 'glyph estrutural encontrado');
  if (file.startsWith('src/design-system/') && designSystemForbiddenImport.test(content)) fail(`boundary:${file}`, 'Design System importou regra financeira/backend');
}
if (failed === 0) ok('scan:zero-hardcode-glyph-boundary');

const configSource = await source('app.config.ts');
const configColors = configSource.match(/#[0-9a-f]{6}\b/gi) ?? [];
configColors.length === 3 && configColors.every((value) => value.toUpperCase() === '#0D0D0D')
  ? ok('hardcode:manifest-exception')
  : fail('hardcode:manifest-exception', 'manifest contém cor não documentada');

console.log(`\nGate 0B: ${passed} verificações aprovadas; ${failed} falhas.`);
if (failed) process.exitCode = 1;
