import {test,expect} from '@playwright/test';
import {monitorBrowser,openPreview,assertNoHorizontalOverflow,assertTouchTargets,VIEWPORTS} from './support/aviora-page.mjs';

async function openFirstChapter(page){
  await page.getByRole('button',{name:/Começar leitura|Continuar leitura/}).click();
  await page.getByRole('button',{name:/Ler|Continuar/}).first().click();
  await expect(page.locator('.knowledge-reader')).toBeVisible();
}

async function selectText(page,selector,start=0,end=18){
  await page.locator(selector).first().evaluate((element,{start,end})=>{
    const node=[...element.childNodes].find(item=>item.nodeType===Node.TEXT_NODE&&item.data.trim());
    if(!node)throw new Error('Synthetic selectable text unavailable');
    const range=document.createRange();range.setStart(node,Math.min(start,node.data.length-1));range.setEnd(node,Math.min(end,node.data.length));
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));
  },{start,end});
}

test.describe('AVIORA — Reader avançado local e autorizado',()=>{
  let browserMonitor;
  test.beforeEach(async({page})=>{browserMonitor=await monitorBrowser(page)});
  test.afterEach(()=>browserMonitor.assertClean());

  test('preferências, retomada e busca permanecem na obra atual',async({page})=>{
    await openPreview(page,{tab:'knowledge',viewport:{width:390,height:844}});await openFirstChapter(page);
    await page.locator('.knowledge-reader-preferences summary').click();
    await page.locator('[data-knowledge-preference="theme"]').selectOption('sepia');
    await expect(page.locator('.knowledge-reader')).toHaveAttribute('data-reader-theme','sepia');
    await page.locator('.knowledge-reader-preferences summary').click();
    await page.locator('[data-knowledge-preference="fontSize"]').selectOption('large');
    await page.locator('.knowledge-reader-preferences summary').click();
    await page.locator('[data-knowledge-preference="lineHeight"]').selectOption('airy');
    await expect(page.locator('.knowledge-reader')).toHaveAttribute('data-reader-font-size','large');
    await expect(page.locator('.knowledge-reader')).toHaveAttribute('data-reader-line-height','airy');
    await page.locator('[data-knowledge-section-id]').last().scrollIntoViewIfNeeded();await page.waitForTimeout(750);
    const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('aviora_knowledge_reader_v1:e2e-preview')));
    expect(stored.preferences).toMatchObject({theme:'sepia',fontSize:'large',lineHeight:'airy'});
    expect(Object.values(stored.positions)[0].sectionId).toBeTruthy();
    await page.getByRole('button',{name:'← Sumário'}).click();
    await page.locator('[data-knowledge-search] input').fill('sintético');await page.locator('[data-knowledge-search]').getByRole('button',{name:'Buscar'}).click();
    await expect(page.getByRole('heading',{name:'Resultados'})).toBeVisible();
    expect(await page.locator('.knowledge-search-result').count()).toBeGreaterThan(0);
    await assertNoHorizontalOverflow(page);await assertTouchTargets(page,'.knowledge-root button');
  });

  test('grifo, nota, favorito de posição, edição e exclusão funcionam sem tocar conteúdo',async({page})=>{
    await openPreview(page,{tab:'knowledge'});await openFirstChapter(page);
    await selectText(page,'.knowledge-paragraph',0,18);await page.getByRole('button',{name:'Grifar'}).click();
    await expect(page.locator('.knowledge-user-annotation.highlight')).toHaveCount(1);
    await selectText(page,'.knowledge-highlight',0,20);await page.getByRole('button',{name:'Adicionar nota'}).click();
    await page.locator('[data-knowledge-note-compose] textarea').fill('Nota sintética do Reader');await page.locator('[data-knowledge-note-compose]').getByRole('button',{name:'Salvar nota'}).click();
    await expect(page.locator('.knowledge-user-annotation.note')).toHaveCount(1);
    const point=page.locator('.knowledge-section-bookmark').first();await point.click();await expect(page.locator('.knowledge-section-bookmark').first()).toContainText('Ponto salvo');
    await page.getByRole('button',{name:/Anotações \(2\)/}).click();
    await expect(page.getByRole('heading',{name:'Anotações'})).toBeVisible();await expect(page.locator('.knowledge-annotation-card')).toHaveCount(2);
    const note=page.locator('.knowledge-annotation-card.note');await expect(note).toContainText('Nota sintética do Reader');await note.getByRole('button',{name:'Editar'}).click();
    await note.locator('textarea').fill('Nota revisada');await note.getByRole('button',{name:'Salvar alteração'}).click();await expect(page.locator('.knowledge-annotation-card.note')).toContainText('Nota revisada');
    await page.locator('.knowledge-annotation-card.note').getByRole('button',{name:'Excluir'}).click();await expect(page.locator('.knowledge-annotation-card')).toHaveCount(1);
  });

  for(const viewport of VIEWPORTS){
    test(`Reader mantém controles e leitura íntegros em ${viewport.name}`,async({page})=>{
      await openPreview(page,{tab:'knowledge',viewport});await openFirstChapter(page);
      await expect(page.getByRole('button',{name:'← Sumário'})).toBeVisible();
      await expect(page.getByRole('button',{name:'Anotações (0)'})).toBeVisible();
      await expect(page.locator('.knowledge-reading-body')).toContainText('texto é exclusivamente sintético');
      await assertNoHorizontalOverflow(page);
      if(viewport.width<=900)await assertTouchTargets(page,'.knowledge-root button:visible');
    });
  }
});
