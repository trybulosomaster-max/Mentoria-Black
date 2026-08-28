import {test,expect} from '@playwright/test';
import {
  monitorBrowser,
  openPreview,
  navigateTo,
  assertNoHorizontalOverflow,
  assertTouchTargets
} from './support/aviora-page.mjs';

const money=value=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

test.describe('AVIORA — caracterização sintética das áreas secundárias',()=>{
  let browserMonitor;
  test.beforeEach(async({page})=>{browserMonitor=await monitorBrowser(page)});
  test.afterEach(()=>browserMonitor.assertClean());

  test('Cartões replica o resumo real enquanto o motor valida a competência sintética',async({page})=>{
    await openPreview(page,{tab:'cards'});
    const card=page.locator('[data-card-id="card-gold"]');
    await expect(card).toBeVisible();
    for(const text of ['Cartão AVIORA','R$ 670,00','período'])await expect(card).toContainText(text);
    await expect(page.locator('#view')).not.toContainText(/Fatura atual|Limite|Fechamento|vencimento/);
    await expect(card.getByRole('button')).toHaveCount(0);

    const competence=await page.evaluate(()=>{
      const scenario=AVIORA_E2E_FIXTURE.createScenario();
      const project=(month)=>MBPlanningV82.projectPlanningPeriod(null,scenario.transactions,scenario.recurring,{year:2026,month,now:scenario.now});
      const cardRows=(projection)=>projection.details.scheduledMaterialized.filter(row=>row.card_id==='card-gold');
      const august=cardRows(project(8)),september=cardRows(project(9));
      return {
        model:scenario.cards[0],
        august:{ids:august.map(row=>row.id),total:august.reduce((sum,row)=>sum+row.amount,0)},
        september:{ids:september.map(row=>row.id),total:september.reduce((sum,row)=>sum+row.amount,0)}
      };
    });
    expect(competence.model).toMatchObject({limit:8000,currentInvoice:670,closingDay:22,dueDay:30});
    expect(competence.august).toEqual({ids:expect.arrayContaining(['card-pending','installment-current']),total:670});
    expect(competence.august.ids).not.toContain('installment-next');
    expect(competence.september).toEqual({ids:['installment-next'],total:250});
  });

  test('Categorias mantém nome, cor configurada e ação acessível sem depender só da cor',async({page})=>{
    await openPreview(page,{tab:'categories'});
    const colors=await page.evaluate(()=>AVIORA_E2E_FIXTURE.CATEGORY_COLORS);
    for(const [name,color] of Object.entries(colors)){
      const row=page.locator(`[data-category="${name}"]`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(name);
      await expect(row.getByRole('button',{name:'Editar'})).toBeVisible();
      const actual=await row.locator('.dot').evaluate(node=>getComputedStyle(node).backgroundColor);
      const expected=await page.evaluate(value=>{const node=document.createElement('i');node.style.color=value;document.body.append(node);const result=getComputedStyle(node).color;node.remove();return result},color);
      expect(actual).toBe(expected);
    }
  });

  test('Metas expõe valor, progresso, prazo e necessidade mensal sem NaN ou Infinity',async({page})=>{
    await openPreview(page,{tab:'goals'});
    const goal=page.locator('.goal-card');
    for(const text of ['Reserva de emergência','R$ 18.500,00','R$ 30.000,00','61,7%','31/12/2027','Necessidade mensal','R$ 650,00','Em andamento'])await expect(goal).toContainText(text);
    await expect(goal.getByRole('button',{name:'Adicionar valor'})).toBeVisible();
    await expect(goal.getByRole('button',{name:'Editar'})).toBeVisible();
    const progressWidth=await goal.locator('.bar > i').evaluate(node=>Number.parseFloat(node.style.width));
    expect(progressWidth).toBeCloseTo(61.6667,3);
    expect(await goal.textContent()).not.toMatch(/NaN|Infinity/);
  });

  test('Recorrências mantém mês, categoria e reconcilia ocorrência já materializada',async({page})=>{
    await openPreview(page,{tab:'recurring'});
    await expect(page.locator('[data-recurring-id]')).toHaveCount(4);
    const rent=page.locator('[data-recurring-id="recurring-rent"]');
    for(const text of ['Aluguel mensal','Gastos Fixos','29/08/2026','R$ 1.500,00','Ativa'])await expect(rent).toContainText(text);
    await expect(rent.getByRole('button',{name:'Editar'})).toBeVisible();

    const projection=await page.evaluate(()=>{
      const scenario=AVIORA_E2E_FIXTURE.createScenario();
      const result=MBPlanningV82.projectPlanningPeriod(null,scenario.transactions,scenario.recurring,{year:2026,month:8,now:scenario.now});
      return {
        projected:result.details.projectedVirtual.map(row=>row.id||row.sourceRuleId),
        realized:result.details.realized.map(row=>row.id),
        projectedConsumption:result.projectedVirtual.totalOut
      };
    });
    expect(projection.projected).toEqual(expect.arrayContaining(['recurring-rent','recurring-internet','recurring-income']));
    expect(projection.projected).not.toContain('recurring-streaming');
    expect(projection.realized).toContain('streaming-materialized');
    expect(projection.projectedConsumption).toBe(1600);
  });

  test('Contas e Patrimônio exibem agregados finitos e ações básicas',async({page})=>{
    await openPreview(page,{tab:'accounts'});
    const main=page.locator('[data-account-id="account-main"]'),reserve=page.locator('[data-account-id="account-reserve"]');
    await expect(main).toContainText(money(12500));
    await expect(reserve).toContainText(money(18500));
    for(const account of [main,reserve]){
      await expect(account.getByRole('button',{name:'Editar'})).toBeVisible();
      await expect(account.getByRole('button',{name:'Excluir'})).toBeVisible();
    }

    await navigateTo(page,'wealth');
    const text=await page.locator('#view').textContent();
    for(const value of [money(31000),money(18500)])expect(text).toContain(value);
    expect(text).not.toMatch(/NaN|Infinity/);
  });

  test('Relatórios abre o período sintético e mantém a tabela contida no mobile',async({page})=>{
    await openPreview(page,{tab:'reports',viewport:{width:390,height:844}});
    await expect(page.getByRole('heading',{name:'Relatórios'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Exportar relatório'})).toBeVisible();
    const row=page.locator('tbody tr');
    for(const text of ['Agosto',money(8800),money(3740),money(350),money(4710)])await expect(row).toContainText(text);
    await assertNoHorizontalOverflow(page);
    await assertTouchTargets(page,'#view button');
  });

  test('Saúde e Reserva não fabricam paridade quando exigem Beta autenticado',async({page})=>{
    await openPreview(page,{tab:'reserve-v52'});
    const reserve=page.locator('#view');
    await expect(reserve).toHaveAttribute('data-preview-parity','REQUIRES_AUTHENTICATED_BETA_SMOKE');
    for(const text of ['Reserva de Emergência','Validação autenticada necessária','não fabrica dados'])await expect(reserve).toContainText(text);
    await expect(reserve).not.toContainText(/R\$|Acumulado|Meta/);

    await navigateTo(page,'health-v53');
    const health=page.locator('#view');
    await expect(health).toHaveAttribute('data-preview-parity','REQUIRES_AUTHENTICATED_BETA_SMOKE');
    for(const text of ['Saúde Financeira','Validação autenticada necessária','não fabrica dados'])await expect(health).toContainText(text);
    await expect(health).not.toContainText(/Diagnóstico|42%|recomendações/);
  });

  test('áreas secundárias reutilizam estados vazio e erro seguros sem fabricar dados',async({page})=>{
    for(const tab of ['accounts','cards','categories','goals','recurring','wealth','reports','reserve-v52','health-v53']){
      await openPreview(page,{tab,state:'empty'});
      await expect(page.locator('[data-preview-state="empty"]')).toContainText('Nenhum dado por aqui');
      await openPreview(page,{tab,state:'error'});
      await expect(page.locator('[data-preview-state="error"]')).toContainText('Não foi possível carregar agora');
      await expect(page.locator('[data-preview-state="error"]')).not.toContainText(/SQLSTATE|RPC|stack|token/i);
    }
  });

  for(const viewport of [{name:'mobile',width:390,height:844},{name:'desktop',width:1440,height:900}]){
    test(`áreas secundárias permanecem alcançáveis e sem overflow em ${viewport.name}`,async({page})=>{
      await openPreview(page,{tab:'accounts',viewport});
      for(const tab of ['accounts','cards','categories','goals','recurring','wealth','reports','reserve-v52','health-v53']){
        if(tab!=='accounts')await navigateTo(page,tab);
        await expect(page.locator('#view .pagehead h1')).toBeVisible();
        await assertNoHorizontalOverflow(page);
        const unnamed=await page.locator('#view button:visible').evaluateAll(buttons=>buttons.filter(button=>!(button.getAttribute('aria-label')||button.textContent||'').trim()).map(button=>button.outerHTML));
        expect(unnamed,`${tab}: ações possuem nome acessível`).toEqual([]);
        if(viewport.width<=900&&await page.locator('#view button:visible').count())await assertTouchTargets(page,'#view button:visible');
      }
    });
  }
});
