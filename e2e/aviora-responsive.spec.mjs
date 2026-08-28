import {test,expect} from '@playwright/test';
import {VIEWPORTS,monitorBrowser,openPreview,navigateTo,assertNoHorizontalOverflow,assertHeaderDoesNotOverlap,assertTouchTargets,assertAriaControlsResolve} from './support/aviora-page.mjs';

test.describe('AVIORA — responsividade e regressão visual estrutural',()=>{
  for(const viewport of VIEWPORTS){
    test(`${viewport.name} preserva header, navegação, accordions e superfícies críticas`,async({page})=>{
      const browserMonitor=await monitorBrowser(page);
      await openPreview(page,{tab:'dashboard',viewport});
      expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
      await assertHeaderDoesNotOverlap(page);
      await assertNoHorizontalOverflow(page);
      await expect(page.locator('#view > .kpis .kpi')).toHaveCount(6);
      const latest=page.getByRole('button',{name:/Últimos lançamentos do período/});
      await expect(latest).toHaveAttribute('aria-expanded','false');
      await latest.click();await expect(latest).toHaveAttribute('aria-expanded','true');

      for(const tab of ['transactions','planning','account']){
        await navigateTo(page,tab);
        await assertNoHorizontalOverflow(page);
        await assertAriaControlsResolve(page);
      }
      await expect(page.locator('.account-security-trigger')).toHaveCount(3);
      await expect(page.locator('.account-security-trigger[aria-expanded="false"]')).toHaveCount(3);

      if(viewport.width<=900){
        await assertTouchTargets(page,'.header .actions button,[data-aviora-mobile-nav-trigger],.aviora-accordion-trigger,.account-security-trigger');
        const trigger=page.locator('[data-aviora-mobile-nav-trigger]');
        await expect(trigger).toBeVisible();
        await trigger.click();
        await expect(page.getByRole('dialog',{name:'Áreas do AVIORA'})).toBeVisible();
        await page.keyboard.press('Escape');
      }else{
        await expect(page.locator('#nav > [data-tab]')).toHaveCount(15);
        for(const destination of await page.locator('#nav > [data-tab]').all())await expect(destination).toBeVisible();
      }
      const safeGeometry=await page.evaluate(()=>{
        const header=document.querySelector('#appPreview .header').getBoundingClientRect();
        const title=document.querySelector('#view .pagehead h1').getBoundingClientRect();
        return {headerTop:header.top,titleTop:title.top,viewportHeight:innerHeight};
      });
      expect(safeGeometry.headerTop).toBeGreaterThanOrEqual(-1);
      expect(safeGeometry.titleTop).toBeGreaterThan(0);
      expect(safeGeometry.titleTop).toBeLessThan(safeGeometry.viewportHeight);
      browserMonitor.assertClean();
    });

    test(`${viewport.name} mantém o resumo da Meta Casamento legível e sem redundância`,async({page})=>{
      const browserMonitor=await monitorBrowser(page);
      await openPreview(page,{tab:'goals',viewport});
      await assertNoHorizontalOverflow(page);
      const goal=page.locator('.goal-card');
      await expect(goal.locator('.goal-values .goal-value')).toHaveCount(4);
      await expect(goal.locator('.goal-values')).not.toContainText('Programado');
      await expect(goal.locator('.goal-values')).not.toContainText('Projeção adicional');
      const composition=goal.locator('.goal-coverage-composition');
      await expect(composition).not.toHaveAttribute('open','');
      expect(await composition.locator('summary').evaluate(node=>node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      await composition.locator('summary').click();
      await expect(composition).toContainText('R$ 4.400,00');
      await expect(composition).toContainText('R$ 20.000,00');
      const columns=await goal.locator('.goal-values').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length);
      expect(columns).toBe(viewport.width<=900?2:4);
      browserMonitor.assertClean();
    });
  }

  test('rerenders não acumulam menu, accordions, IDs ou trabalho visual oculto',async({page})=>{
    const browserMonitor=await monitorBrowser(page);
    await openPreview(page,{tab:'dashboard',viewport:{width:390,height:844}});
    const samples=[];
    for(let cycle=0;cycle<4;cycle++){
      for(const tab of ['transactions','planning','dashboard']){
        await navigateTo(page,tab);
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        samples.push(await page.evaluate(()=>({
          trigger:document.querySelectorAll('[data-aviora-mobile-nav-trigger]').length,
          sheet:document.querySelectorAll('#aviora-mobile-navigation').length,
          duplicateIds:[...document.querySelectorAll('[id]')].map(node=>node.id).filter((id,index,all)=>all.indexOf(id)!==index),
          visibleCanvases:[...document.querySelectorAll('canvas')].filter(canvas=>!canvas.closest('[hidden]')).length,
          hiddenCanvases:[...document.querySelectorAll('canvas')].filter(canvas=>canvas.closest('[hidden]')).length,
          charts:previewChartStats()
        })));
      }
    }
    for(const sample of samples){expect(sample.trigger).toBe(1);expect(sample.sheet).toBe(1);expect(sample.duplicateIds).toEqual([]);expect(sample.visibleCanvases).toBeLessThanOrEqual(1);expect(sample.charts.created-sample.charts.destroyed).toBe(sample.charts.active);expect(sample.charts.active).toBeLessThanOrEqual(sample.visibleCanvases)}
    browserMonitor.assertClean();
  });

  test('troca de análise reutiliza cada instância Chart.js e não multiplica canvases ou listeners',async({page})=>{
    const browserMonitor=await monitorBrowser(page);
    await openPreview(page,{tab:'dashboard',viewport:{width:1440,height:900}});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const initial=await page.evaluate(()=>previewChartStats());
    expect(initial).toMatchObject({active:1,canvasCount:2});
    const initialChart=await page.locator('canvas[data-preview-chart-rendered="true"]').evaluate(canvas=>({aria:canvas.getAttribute('aria-label'),colors:Chart.getChart(canvas).data.datasets[0].backgroundColor}));
    expect(initialChart.aria).toContain('Distribuição por categoria');
    expect(initialChart.colors).toEqual(['#c96565','#b88f4a','#4f9a68','#d5b84d']);
    const evolution=page.getByRole('tab',{name:'Evolução'}),distribution=page.getByRole('tab',{name:'Distribuição'});
    await evolution.click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const afterFirstSwitch=await page.evaluate(()=>previewChartStats());
    expect(afterFirstSwitch.active).toBe(2);expect(afterFirstSwitch.created).toBe(initial.created+1);
    for(let index=0;index<3;index++){await distribution.click();await evolution.click()}
    await page.evaluate(()=>{drawCharts();drawCharts()});
    expect(await page.evaluate(()=>previewChartStats())).toEqual(afterFirstSwitch);
    await expect(page.locator('canvas[data-preview-chart-rendered="true"]')).toHaveCount(2);
    browserMonitor.assertClean();
  });
});
