import {test,expect} from '@playwright/test';
import {monitorBrowser,openPreview,assertNoHorizontalOverflow} from './support/aviora-page.mjs';

test.describe('AVIORA — cenário financeiro sintético',()=>{
  let browserMonitor;
  test.beforeEach(async({page})=>{browserMonitor=await monitorBrowser(page)});
  test.afterEach(()=>browserMonitor.assertClean());

  test('expõe Realizado, Programado, Projetado, Previsão e resultado esperado sem misturar conceitos',async({page})=>{
    await openPreview(page,{tab:'dashboard'});
    const actual=await page.evaluate(()=>{
      const projection=financial(),expected=AVIORA_E2E_FIXTURE.SCENARIO.expected;
      const select=bucket=>({
        income:bucket.income,
        consumptionExpense:bucket.consumptionExpense,
        investment:bucket.investment,
        availableBalanceEffect:bucket.availableBalanceEffect
      });
      return {realized:select(projection.realized),scheduled:select(projection.scheduled),projected:select(projection.projected),forecast:select(projection.forecast),total:select(projection.expected),expected};
    });
    expect(actual.realized).toEqual(actual.expected.realized);
    expect(actual.scheduled).toEqual(actual.expected.scheduled);
    expect(actual.projected).toEqual(actual.expected.projected);
    expect(actual.forecast).toEqual(actual.expected.forecast);
    expect(actual.total).toEqual(actual.expected.total);

    const uiCases=[
      ['Receitas',['R$ 8.800,00','R$ 6.800,00','R$ 2.000,00']],
      ['Despesas',['R$ 3.740,00','R$ 1.290,00','R$ 2.450,00']],
      ['Resultado do mês',['R$ 4.710,00','R$ 5.510,00','-R$ 800,00']],
      ['Investimentos',['R$ 350,00','R$ 0,00','R$ 350,00']]
    ];
    for(const [label,values] of uiCases){const card=page.locator('.kpi').filter({hasText:label});for(const value of values)await expect(card).toContainText(value)}
    await assertNoHorizontalOverflow(page);
  });

  test('cartão, parcelas, cancelamento e competência mensal seguem transaction_date',async({page})=>{
    await openPreview(page,{tab:'dashboard'});
    const periods=await page.evaluate(()=>{
      const scenario=AVIORA_E2E_FIXTURE.createScenario();
      const project=(year,month)=>MBPlanningV82.projectPlanningPeriod(null,scenario.transactions,scenario.recurring,{year,month,now:scenario.now});
      const ids=bucket=>bucket.map(item=>item.id||item.sourceRuleId);
      const august=project(2026,8),september=project(2026,9);
      return {
        august:{realized:ids(august.details.realized),scheduled:ids(august.details.scheduledMaterialized),projected:ids(august.details.projectedVirtual)},
        september:{realized:ids(september.details.realized),scheduled:ids(september.details.scheduledMaterialized),projected:ids(september.details.projectedVirtual)}
      };
    });
    expect(periods.august.scheduled).toEqual(expect.arrayContaining(['card-pending','installment-current','utility-pending','investment-scheduled']));
    expect(periods.august.scheduled).not.toContain('installment-next');
    expect(periods.september.scheduled).toContain('installment-next');
    expect([...periods.august.realized,...periods.august.scheduled]).not.toContain('cancelled-expense');
    expect(periods.august.projected).toEqual(expect.arrayContaining(['recurring-rent','recurring-internet','recurring-income']));
  });

  test('ocorrência recorrente materializada e pagamento posterior entram uma única vez',async({page})=>{
    await openPreview(page,{tab:'dashboard'});
    const proof=await page.evaluate(()=>{
      const options={year:2026,month:8,now:'2026-08-27'};
      const rule={id:'e2e-rent',description:'Aluguel',transaction_type:'despesa',category:'Gastos Fixos',amount:1000,frequency:'monthly',interval:1,next_date:'2026-08-20',active:true};
      const before=MBPlanningV82.projectPlanningPeriod(null,[],[rule],options);
      const materialized={id:'e2e-rent-paid',description:'Aluguel',transaction_type:'despesa',category:'Gastos Fixos',amount:1000,status:'realizado',transaction_date:'2026-08-20',recurring_series_id:'e2e-rent',recurring_occurrence_date:'2026-08-20'};
      const after=MBPlanningV82.projectPlanningPeriod(null,[materialized],[rule],options);
      return {
        before:{realized:before.realized.totalOut,forecast:before.forecast.totalOut,total:before.realized.totalOut+before.forecast.totalOut,virtual:before.projectedVirtual.totalOut},
        after:{realized:after.realized.totalOut,forecast:after.forecast.totalOut,total:after.realized.totalOut+after.forecast.totalOut,virtual:after.projectedVirtual.totalOut}
      };
    });
    expect(proof.before).toEqual({realized:0,forecast:1000,total:1000,virtual:1000});
    expect(proof.after).toEqual({realized:1000,forecast:0,total:1000,virtual:0});
  });

  test('cores e identidade textual da categoria permanecem na interface e na projeção',async({page})=>{
    await openPreview(page,{tab:'planning'});
    const trigger=page.getByRole('button',{name:/Planejamento por categoria/});
    await expect(trigger).toHaveAttribute('aria-expanded','false');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded','true');
    const leisure=page.locator('.aviora-planning-row').filter({hasText:'Lazer'});
    for(const text of ['Lazer','Realizado','Compromissos','Esperado','Planejado'])await expect(leisure).toContainText(text);
    expect(await leisure.evaluate(node=>getComputedStyle(node).getPropertyValue('--category-color').trim())).toBe('rgb(79, 154, 104)');
    const categoryProof=await page.evaluate(()=>{
      const scenario=AVIORA_E2E_FIXTURE.createScenario();
      const projection=MBPlanningV82.projectPlanningPeriod(scenario.monthlyPlan,scenario.transactions,scenario.recurring,{year:2026,month:8,now:scenario.now});
      return {
        current:scenario.transactions.find(item=>item.id==='installment-current'),
        forecastLazer:projection.forecast.consumptionByCategory.Lazer,
        color:AVIORA_E2E_FIXTURE.CATEGORY_COLORS.Lazer
      };
    });
    expect(categoryProof.current).toMatchObject({category:'Conhecimento',subcategory:'Equipamentos'});
    expect(categoryProof.forecastLazer).toBe(420);
    expect(categoryProof.color).toBe('#4f9a68');
  });
});
