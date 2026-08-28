import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {monitorBrowser,openPreview,navigateTo,assertNoHorizontalOverflow} from './support/aviora-page.mjs';

test.describe('AVIORA — shell e primitives compartilhados',()=>{
  let browserMonitor;
  test.beforeEach(async({page})=>{browserMonitor=await monitorBrowser(page)});
  test.afterEach(()=>browserMonitor.assertClean());

  test('Dashboard recolhido não reserva altura e tabs respondem às setas',async({page})=>{
    await openPreview(page,{tab:'dashboard',viewport:{width:1440,height:900}});
    const latest=page.getByRole('button',{name:/Últimos lançamentos do período/});
    await expect(latest).toHaveAttribute('aria-expanded','false');
    const collapsedHeight=await latest.locator('xpath=..').evaluate(node=>node.getBoundingClientRect().height);
    expect(collapsedHeight).toBeLessThan(120);

    const distribution=page.getByRole('tab',{name:'Distribuição'});
    const evolution=page.getByRole('tab',{name:'Evolução'});
    await distribution.focus();await page.keyboard.press('ArrowRight');
    await expect(evolution).toBeFocused();await expect(evolution).toHaveAttribute('aria-selected','true');
    await expect(page.getByRole('tabpanel',{name:'Evolução'})).toBeVisible();
  });

  test('Dashboard concentra a semântica cromática no valor principal',async({page})=>{
    await openPreview(page,{tab:'dashboard',viewport:{width:1440,height:900}});
    const cases=[
      ['Receitas','rgb(116, 167, 132)'],
      ['Despesas','rgb(194, 118, 114)'],
      ['Resultado do mês','rgb(116, 167, 132)'],
      ['Investimentos','rgb(120, 168, 209)'],
      ['Reserva de emergência','rgb(229, 214, 173)'],
      ['Patrimônio líquido','rgb(229, 214, 173)']
    ];
    for(const [label,color] of cases){
      const card=page.locator('.aviora-dashboard-kpis .kpi').filter({has:page.locator('.lab',{hasText:label})});
      await expect(card.locator('.val')).toHaveCSS('color',color);
      expect(await card.evaluate(node=>getComputedStyle(node,'::before').content)).toBe('none');
      await expect(card.locator('.lab')).not.toHaveCSS('color',color);
      const contrast=await card.locator('.val').evaluate(node=>{
        const channels=getComputedStyle(node).color.match(/\d+/g).slice(0,3).map(Number),surface=[23,24,28];
        const luminance=rgb=>{const values=rgb.map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return .2126*values[0]+.7152*values[1]+.0722*values[2]};
        const foreground=luminance(channels),background=luminance(surface);
        return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
    const result=page.locator('.aviora-dashboard-kpis .kpi').filter({hasText:'Resultado do mês'});
    await result.evaluate(node=>{node.classList.remove('aviora-kpi-positive');node.classList.add('aviora-kpi-negative')});
    await expect(result.locator('.val')).toHaveCSS('color','rgb(194, 118, 114)');
    await result.evaluate(node=>{node.classList.remove('aviora-kpi-negative');node.classList.add('aviora-kpi-neutral')});
    await expect(result.locator('.val')).toHaveCSS('color','rgb(229, 214, 173)');
  });

  test('modal compartilhado contém foco, fecha com Escape e restaura o acionador',async({page})=>{
    await openPreview(page,{tab:'accounts',viewport:{width:390,height:844}});
    await page.evaluate(()=>{
      const opener=document.createElement('button');opener.id='primitiveDialogOpener';opener.textContent='Abrir diálogo de teste';
      const backdrop=document.createElement('div');backdrop.className='modal hidden';backdrop.setAttribute('aria-hidden','true');
      backdrop.innerHTML='<div class="modalbox" aria-labelledby="primitiveDialogTitle"><h2 id="primitiveDialogTitle">Diálogo sintético</h2><input aria-label="Primeiro campo"><button type="button" data-admin-action="dialog-close">Fechar diálogo</button></div>';
      opener.addEventListener('click',()=>{backdrop.classList.remove('hidden');backdrop.setAttribute('aria-hidden','false')});
      backdrop.querySelector('[data-admin-action]').addEventListener('click',()=>{backdrop.classList.add('hidden');backdrop.setAttribute('aria-hidden','true')});
      document.body.append(opener,backdrop);
    });
    const opener=page.locator('#primitiveDialogOpener');await opener.click();
    const dialog=page.getByRole('dialog',{name:'Diálogo sintético'});await expect(dialog).toBeVisible();
    await expect(page.getByRole('textbox',{name:'Primeiro campo'})).toBeFocused();
    await page.getByRole('button',{name:'Fechar diálogo'}).focus();await page.keyboard.press('Tab');
    await expect(page.getByRole('textbox',{name:'Primeiro campo'})).toBeFocused();
    await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(opener).toBeFocused();
  });

  test('Administração e títulos longos permanecem íntegros no shell mobile',async({page})=>{
    await openPreview(page,{tab:'reserve-v52',profile:'owner',viewport:{width:390,height:844}});
    const mobileTrigger=page.locator('[data-aviora-mobile-nav-trigger]');
    await expect(mobileTrigger.locator('strong')).toHaveText('Reserva de Emergência');
    const collision=await mobileTrigger.evaluate(node=>{
      const title=node.querySelector('strong').getBoundingClientRect(),menu=node.querySelector('.aviora-mobile-menu-label').getBoundingClientRect();
      return title.right>menu.left+1;
    });
    expect(collision).toBe(false);

    await navigateTo(page,'administration');await assertNoHorizontalOverflow(page);
    await expect(page.locator('.admin-tabs .btn')).toHaveCount(4);
    const geometry=await page.locator('.admin-tabs').evaluate(node=>({client:node.clientWidth,scroll:node.scrollWidth,buttons:[...node.querySelectorAll('.btn')].map(button=>button.getBoundingClientRect().height)}));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client+1);
    expect(geometry.buttons.every(height=>height>=44)).toBe(true);
  });

  test('cascata real do index preserva o grid desktop sem rolagem horizontal',async({page})=>{
    const avioraCss=readFileSync(new URL('../assets/aviora-v82.css',import.meta.url),'utf8');
    const indexSource=readFileSync(new URL('../index.html',import.meta.url),'utf8');
    const legacyInline=[...indexSource.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n');
    const destinations=Array.from({length:15},(_,index)=>`<button class="btn${index===0?' active':''}" data-tab="tab-${index}">Destino ${index+1}</button>`).join('');
    await page.setViewportSize({width:1200,height:800});
    await page.setContent(`<style>${avioraCss}</style><style>${legacyInline}</style><nav id="nav" class="nav" aria-label="Navegação principal">${destinations}</nav><main id="view"><article class="kpi"><div class="lab">Reserva</div><div class="val">Sem dados suficientes</div><div class="sub">proteção financeira</div></article></main>`);

    const geometry=await page.locator('#nav').evaluate(nav=>({
      display:getComputedStyle(nav).display,
      client:nav.clientWidth,
      scroll:nav.scrollWidth,
      visible:[...nav.querySelectorAll(':scope > [data-tab]')].filter(button=>getComputedStyle(button).display!=='none').length,
      firstWidth:nav.firstElementChild?.getBoundingClientRect().width||0
    }));
    expect(geometry.display).toBe('grid');
    expect(geometry.visible).toBe(15);
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client+1);
    expect(geometry.firstWidth).toBeLessThan(geometry.client/2);
    const metricValue=page.locator('#view .kpi .val');
    await expect(metricValue).toHaveCSS('white-space','normal');
    await expect(metricValue).toHaveCSS('text-overflow','clip');
  });
});
