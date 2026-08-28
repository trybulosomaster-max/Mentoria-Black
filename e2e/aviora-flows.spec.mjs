import {randomUUID} from 'node:crypto';
import {test,expect} from '@playwright/test';
import {DESTINATIONS,monitorBrowser,openPreview,navigateTo,assertAriaControlsResolve,assertNoHorizontalOverflow,snapshotBrowserStorage} from './support/aviora-page.mjs';

test.describe('AVIORA — fluxos sintéticos de usuário',()=>{
  let browserMonitor;
  test.beforeEach(async({page})=>{browserMonitor=await monitorBrowser(page)});
  test.afterEach(()=>browserMonitor.assertClean());

  test('login local sanitiza erro e inicia apenas a sessão sintética',async({page})=>{
    await openPreview(page,{view:'login',profile:'customer',viewport:{width:390,height:844}});
    const email=page.locator('#previewEmail'),password=page.locator('#previewPassword');
    await email.fill('erro@invalid.test');await password.fill(randomUUID());
    await page.getByRole('button',{name:'Entrar'}).click();
    await expect(page.getByRole('alert')).toHaveText('E-mail ou senha incorretos.');
    await expect(page.getByRole('alert')).not.toContainText(/invalid trial result|SQLSTATE|RPC|stack/i);

    await email.fill(`e2e-${randomUUID()}@invalid.test`);await password.fill(randomUUID());
    await page.getByRole('button',{name:'Entrar'}).click();
    await expect(page.locator('#appPreview')).not.toHaveClass(/hidden/);
    await expect(page.locator('#loginPreview')).toHaveClass(/hidden/);
    await expect(page.locator('#nav > [data-tab="administration"]')).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
  });

  test('perfil CUSTOMER sintético não alcança Administração nem por rota direta',async({page})=>{
    await openPreview(page,{tab:'administration',profile:'customer'});
    await expect(page.locator('#view')).toHaveAttribute('data-aviora-view','dashboard');
    await expect(page.locator('#nav > [data-tab="administration"]')).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'Administração'})).toHaveCount(0);
  });

  test('Conhecimento editorial permanece navegável no shell dedicado',async({page})=>{
    await openPreview(page,{view:'knowledge',viewport:{width:390,height:844}});
    await expect(page.getByRole('heading',{name:'Conhecimento'})).toBeVisible();
    await expect(page.locator('.knowledge-publication-card')).toBeVisible();
    await expect(page.getByRole('button',{name:'Começar leitura'})).toBeVisible();
    await page.getByRole('button',{name:'Começar leitura'}).click();
    await expect(page.getByRole('button',{name:'Meus favoritos'})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Mentoria Black'})).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test('desktop alcança todas as áreas autorizadas e preserva um destino ativo',async({page})=>{
    await page.setViewportSize({width:1440,height:900});
    await openPreview(page,{tab:'dashboard',profile:'owner'});
    await expect(page.locator('#nav > [data-tab]')).toHaveCount(DESTINATIONS.length);
    for(const [tab,label] of DESTINATIONS){
      await page.locator(`#nav > [data-tab="${tab}"]`).click();
      await expect(page.locator('#view')).toHaveAttribute('data-aviora-view',tab);
      await expect(page.locator('#view h1').first()).toHaveText(tab==='cards'?'Cartões de crédito':label);
      await expect(page.locator('#nav > [data-tab][aria-current="page"]')).toHaveCount(1);
    }
    await expect(page.locator('[data-admin-management-card]')).toHaveCount(9);
    await assertAriaControlsResolve(page);
  });

  test('menu mobile lista todas as áreas, contém foco e fecha com Escape',async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await openPreview(page,{tab:'dashboard',profile:'owner'});
    const trigger=page.locator('[data-aviora-mobile-nav-trigger]');
    await trigger.click();
    const dialog=page.getByRole('dialog',{name:'Áreas do AVIORA'});
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.aviora-mobile-nav-item')).toHaveCount(DESTINATIONS.length);
    await dialog.getByRole('button',{name:'Fechar menu'}).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.locator('.aviora-mobile-nav-item').last()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button',{name:'Fechar menu'})).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await dialog.locator('[data-tab="planning"]').click();
    await expect(page.locator('#view')).toHaveAttribute('data-aviora-view','planning');
    await expect(trigger.locator('strong')).toHaveText('Planejamento');
    await expect(dialog).toBeHidden();
  });

  test('accordions, filtros e ações percorrem a experiência sem mutar a fixture',async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await openPreview(page,{tab:'transactions'});
    const original=await page.evaluate(()=>JSON.stringify(AVIORA_E2E_FIXTURE.SCENARIO));
    const filters=page.getByRole('button',{name:/Filtros/});
    await expect(filters).toHaveAttribute('aria-expanded','false');await filters.click();
    await page.locator('[data-preview-filter]').fill('cartão pendente');
    const list=page.getByRole('button',{name:/Todos os lançamentos/});
    await list.click();
    await expect(page.locator('[data-transaction-row]:visible')).toHaveCount(1);
    for(const action of ['pay','edit','delete']){
      await page.locator(`[data-transaction-row="card-pending"] [data-preview-transaction-action="${action}"]`).click();
      await expect(page.locator('[data-preview-status]')).toContainText('fixture permanece imutável');
    }
    expect(await page.evaluate(()=>JSON.stringify(AVIORA_E2E_FIXTURE.SCENARIO))).toBe(original);

    await navigateTo(page,'account');
    const accountTriggers=page.locator('.account-security-trigger');
    await expect(accountTriggers).toHaveCount(3);
    for(let index=0;index<3;index++){
      const current=accountTriggers.nth(index);await expect(current).toHaveAttribute('aria-expanded','false');await current.click();await expect(current).toHaveAttribute('aria-expanded','true');await current.click();
    }
    await assertAriaControlsResolve(page);
  });

  test('Atualizar, PDF e Sair são alcançáveis e não executam operação remota',async({page})=>{
    await openPreview(page,{tab:'dashboard'});
    await page.getByRole('button',{name:'Atualizar'}).click();
    await expect(page.locator('[data-preview-status]')).toHaveText('Dados sintéticos atualizados.');
    await page.getByRole('button',{name:'PDF / Imprimir'}).click();
    await expect(page.locator('[data-preview-status]')).toHaveText('Pré-visualização do relatório pronta.');
    await page.getByRole('button',{name:'Sair'}).click();
    await expect(page.locator('#loginPreview')).not.toHaveClass(/hidden/);
  });

  test('estados vazio e erro permanecem legíveis, seguros e recuperáveis',async({page})=>{
    await openPreview(page,{tab:'accounts',state:'empty'});
    await expect(page.locator('[data-preview-state="empty"]')).toContainText('Nenhum dado por aqui');
    await openPreview(page,{tab:'accounts',state:'error'});
    await expect(page.getByRole('alert')).toContainText('Não foi possível carregar agora');
    await page.getByRole('button',{name:'Tentar novamente'}).click();
    await expect(page.locator('[data-preview-status]')).toHaveText('Tentativa sintética concluída.');
  });

  test('contexto não persiste autenticação, negócio, cache ou service worker',async({page})=>{
    await openPreview(page,{tab:'dashboard'});
    const before=await snapshotBrowserStorage(page);
    await navigateTo(page,'planning');
    await navigateTo(page,'categories');
    const after=await snapshotBrowserStorage(page);
    expect(after).toEqual(before);
    expect(after).toEqual({cookies:'',localStorage:{},sessionStorage:{},indexedDatabases:[],caches:[],serviceWorkers:0});
  });
});
