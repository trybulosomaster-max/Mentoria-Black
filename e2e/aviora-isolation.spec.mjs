import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {test,expect} from '@playwright/test';

test('harness E2E não contém conexão, credencial ou referência de projeto remoto',async({browserName})=>{
  test.skip(browserName!=='chromium','guarda estática executada uma vez');
  const files=[
    'aviora-v82.preview.local.html',
    'e2e/fixtures/aviora-synthetic-fixture.js',
    'playwright.config.mjs',
    '.github/workflows/aviora-e2e-daily.yml'
  ];
  const sources=await Promise.all(files.map(async file=>[file,await readFile(resolve(file),'utf8')]));
  const forbidden=[
    /(?:mwjq|amzg)[a-z]{16}/i,
    /https?:\/\/[^\s'"`]*supabase\.(?:co|in)/i,
    /createClient\s*\(/,
    /service[_-]?role/i,
    /authorization\s*[:=]\s*['"`]bearer/i,
    /SUPABASE_(?:ACCESS_TOKEN|SERVICE_ROLE_KEY|DB_URL)/
  ];
  for(const [file,source] of sources){
    for(const pattern of forbidden)expect(pattern.test(source),`${file} não contém ${pattern}`).toBe(false);
  }
  const workflow=sources.find(([file])=>file.endsWith('.yml'))[1];
  expect(workflow).toContain('permissions:\n  contents: read');
  expect(workflow).not.toContain('pull_request_target');
  expect(workflow).not.toMatch(/\b(?:deploy|push|supabase)\b/i);
});

test('fixture canônica é congelada e cada cenário recebe uma cópia descartável',async({page,browserName})=>{
  test.skip(browserName!=='chromium','guarda de fixture executada uma vez');
  await page.goto('/aviora-v82.preview.local.html?view=app&tab=dashboard&cache=e2e-isolation');
  const proof=await page.evaluate(()=>{
    const original=AVIORA_E2E_FIXTURE.SCENARIO;
    const first=AVIORA_E2E_FIXTURE.createScenario();
    const second=AVIORA_E2E_FIXTURE.createScenario();
    first.transactions[0].amount=1;
    return {frozen:Object.isFrozen(original)&&Object.isFrozen(original.transactions),originalAmount:original.transactions[0].amount,secondAmount:second.transactions[0].amount};
  });
  expect(proof).toEqual({frozen:true,originalAmount:6000,secondAmount:6000});
});
