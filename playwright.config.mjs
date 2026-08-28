import {defineConfig} from '@playwright/test';

const port=Number(process.env.E2E_PORT||4173);
const baseURL=`http://127.0.0.1:${port}`;

export default defineConfig({
  testDir:'./e2e',
  testMatch:/.*\.spec\.mjs/,
  outputDir:'test-results/e2e',
  fullyParallel:false,
  forbidOnly:Boolean(process.env.CI),
  retries:process.env.CI?1:0,
  workers:process.env.CI?1:undefined,
  timeout:30_000,
  expect:{timeout:5_000},
  reporter:[
    ['line'],
    ['html',{outputFolder:'playwright-report',open:'never'}],
    ['junit',{outputFile:'test-results/e2e/results.xml'}]
  ],
  use:{
    baseURL,
    locale:'pt-BR',
    timezoneId:'America/Sao_Paulo',
    colorScheme:'dark',
    reducedMotion:'reduce',
    deviceScaleFactor:1,
    serviceWorkers:'block',
    screenshot:'only-on-failure',
    trace:'retain-on-failure',
    video:'off',
    actionTimeout:5_000,
    navigationTimeout:10_000
  },
  projects:[
    {name:'chromium',use:{browserName:'chromium'}},
    {name:'webkit',use:{browserName:'webkit'}},
    {name:'firefox',use:{browserName:'firefox'}}
  ],
  webServer:{
    command:`python3 -m http.server ${port} --bind 127.0.0.1`,
    url:`${baseURL}/aviora-v82.preview.local.html?view=app&tab=dashboard`,
    reuseExistingServer:false,
    timeout:20_000,
    stdout:'ignore',
    stderr:'ignore'
  }
});
