import {test,expect} from '@playwright/test';
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
});
