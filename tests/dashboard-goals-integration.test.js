const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const goalsV82=require('../js/goals-integration');

let testCount=0,assertionCount=0;
function equal(actual,expected,message){assertionCount+=1;assert.strictEqual(actual,expected,message)}
function ok(actual,message){assertionCount+=1;assert.ok(actual,message)}
function test(name,fn){try{fn();testCount+=1}catch(error){error.message=`${name}: ${error.message}`;throw error}}

const NOW='2026-01-01';
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const functionStart=html.indexOf('  function dashboardGoalsSummary(){');
const functionEnd=html.indexOf('\n\n  window.dashboard = function(){',functionStart);
assert(functionStart>=0&&functionEnd>functionStart,'dashboardGoalsSummary source must exist');

class FixedDate extends Date {
  constructor(...args){super(...(args.length?args:[`${NOW}T12:00:00Z`]))}
}

const baseGoal={id:'goal',name:'Meta teste',target:1000,current:0,deadline:'2026-12-31'};
const transaction=(overrides={})=>({id:'tx',goal_id:'goal',goal_effect:'contribution',amount:100,status:'realizado',transaction_date:'2025-12-01',...overrides});
const recurring=(overrides={})=>({id:'rule',goal_id:'goal',goal_effect:'contribution',amount:100,frequency:'monthly',interval:1,next_date:'2026-02-01',active:true,...overrides});

function renderDashboard(goals,transactions=[],rules=[]){
  const context={
    DATA:{goals,transactions,recurring:rules},Date:FixedDate,console,
    esc:value=>String(value),money:value=>`$${Number(value)}`,pct:value=>`${Number(value)}%`,
    MBGoalsV82:goalsV82,
    monthlyPlan:()=>({goals:0})
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(`${html.slice(functionStart,functionEnd)};this.renderDashboardGoals=dashboardGoalsSummary;`,context);
  return context.renderDashboardGoals();
}

function canonical(goal,transactions=[],rules=[]){
  return goalsV82.goalViewModel(goal,transactions,rules,{now:NOW,maxOccurrences:500});
}

test('Dashboard usa os mesmos números do view model da página Metas',()=>{
  const goal={...baseGoal,current:50};
  const rows=[transaction({amount:150}),transaction({id:'future',status:'pending',transaction_date:'2026-02-01',amount:200})];
  const metric=canonical(goal,rows,[recurring()]);
  const output=renderDashboard([goal],rows,[recurring()]);
  ok(output.includes(`Realizado: $${metric.realizedTotal} / $${metric.target}`));
  ok(output.includes(`Cobertura prevista até o prazo: $${metric.projectedCovered}`));
  ok(output.includes(`Programado: $${metric.programmed}`));
  ok(output.includes(`Projeção adicional: $${metric.projected}`));
  ok(output.includes(`Falta realizar: $${metric.remainingReal}`));
});

test('Meta 2046 aparece com cobertura além da materialização',()=>{
  const goal={...baseGoal,name:'Meta 2046',target:200000,current:1000,deadline:'2046-12-01'};
  const materialized=Array.from({length:12},(_,index)=>transaction({id:`m${index}`,status:'pending',amount:500,transaction_date:`2026-${String(index+1).padStart(2,'0')}-01`,recurring_series_id:'long',recurring_occurrence_date:`2026-${String(index+1).padStart(2,'0')}-01`}));
  const rules=[recurring({id:'long',amount:500,next_date:'2026-01-01'})];
  const metric=canonical(goal,materialized,rules);
  const output=renderDashboard([goal],materialized,rules);
  equal(metric.programmed,6000);equal(metric.projected,120000);equal(metric.projectedCovered,127000);
  ok(output.includes('Meta 2046'));ok(output.includes('Cobertura prevista até o prazo: $127000'));ok(output.includes('Projeção adicional: $120000'));
});

test('Meta posterior a 2046 também usa horizonte real',()=>{
  const goal={...baseGoal,name:'Meta 2056',target:999999,deadline:'2056-12-01'};
  const rules=[recurring({amount:500,next_date:'2026-01-01'})];
  const metric=canonical(goal,[],rules);
  const output=renderDashboard([goal],[],rules);
  equal(metric.projectedOccurrences.at(-1).occurrenceDate,'2056-12-01');equal(metric.projected,186000);
  ok(output.includes('Meta 2056'));ok(output.includes('Cobertura prevista até o prazo: $186000'));
});

test('materializado substitui virtual equivalente no Dashboard',()=>{
  const row=transaction({status:'pending',transaction_date:'2026-02-01',amount:175,recurring_series_id:'rule',recurring_occurrence_date:'2026-02-01'});
  const metric=canonical(baseGoal,[row],[recurring()]);
  const output=renderDashboard([baseGoal],[row],[recurring()]);
  equal(metric.programmed,175);equal(metric.projected,1000);
  ok(output.includes('Programado: $175'));ok(output.includes('Projeção adicional: $1000'));
});

test('withdrawal reduz realizado e cobertura igualmente',()=>{
  const goal={...baseGoal,current:500};
  const rows=[transaction({amount:200}),transaction({id:'out',amount:50,goal_effect:'withdrawal'})];
  const rules=[recurring({id:'withdraw',amount:10,goal_effect:'withdrawal'})];
  const metric=canonical(goal,rows,rules);
  const output=renderDashboard([goal],rows,rules);
  equal(metric.realizedTotal,650);equal(metric.projected,-110);equal(metric.projectedCovered,540);
  ok(output.includes('Realizado: $650'));ok(output.includes('Projeção adicional: $-110'));ok(output.includes('Cobertura prevista até o prazo: $540'));
});

test('Meta concluída permanece na indicação de alcançadas',()=>{
  const goal={...baseGoal,name:'Meta concluída',target:500,current:400};
  const rows=[transaction({amount:100})];
  const output=renderDashboard([goal],rows,[]);
  ok(output.includes('✓ Meta alcançada: Meta concluída'));ok(output.includes('Nenhuma meta em andamento.'));
});

test('Meta sem deadline não inventa projeção',()=>{
  const goal={...baseGoal,name:'Sem prazo',deadline:null,current:100};
  const metric=canonical(goal,[],[]);
  const output=renderDashboard([goal],[],[]);
  equal(metric.projected,0);equal(metric.projectedCovered,100);
  ok(output.includes('Cobertura prevista até o prazo: $100'));ok(output.includes('sem prazo'));
});

test('Meta sem recorrência usa somente realizado e programado',()=>{
  const rows=[transaction({status:'pending',transaction_date:'2026-02-01',amount:250})];
  const metric=canonical(baseGoal,rows,[]);
  const output=renderDashboard([baseGoal],rows,[]);
  equal(metric.projected,0);equal(metric.programmed,250);equal(metric.projectedCovered,250);
  ok(output.includes('Projeção adicional: $0'));ok(output.includes('Programado: $250'));
});

test('múltiplas recorrências permanecem separadas e somadas uma vez',()=>{
  const rules=[recurring({id:'a',amount:100}),recurring({id:'b',amount:50})];
  const metric=canonical(baseGoal,[],rules);
  const output=renderDashboard([baseGoal],[],rules);
  equal(metric.projectedOccurrences.length,22);equal(new Set(metric.projectedOccurrences.map(item=>item.key)).size,22);equal(metric.projected,1650);
  ok(output.includes('Projeção adicional: $1650'));
});

test('Dashboard mostra conclusão de Casamento após o prazo sem alterar cobertura',()=>{
  const goal={...baseGoal,name:'Casamento',target:50000,current:0,deadline:'2031-10-01'};
  const materialized=Array.from({length:11},(_,index)=>{
    const occurrence=new Date(Date.UTC(2026,9+index,1)).toISOString().slice(0,10);
    return transaction({id:`wedding-${index+1}`,status:'pending',transaction_date:occurrence,amount:400,recurring_series_id:'wedding-monthly',recurring_occurrence_date:occurrence});
  });
  const rules=[recurring({id:'wedding-monthly',amount:400,next_date:'2026-10-01'})];
  const metric=canonical(goal,materialized,rules),output=renderDashboard([goal],materialized,rules);
  equal(metric.programmed,4400);equal(metric.projected,20000);equal(metric.projectedCovered,24400);equal(metric.estimatedCompletionDate,'2037-02-01');equal(metric.status,'behind');
  ok(output.includes('Cobertura prevista até o prazo: $24400'));ok(output.includes('Projeção adicional: $20000'));ok(output.includes('Conclusão após o prazo'));ok(output.includes('previsão: fev. de 2037'));
});

test('navegação Ver todas as metas conserva handler existente',()=>{
  const output=renderDashboard([baseGoal],[],[]);
  ok(output.includes('Ver todas as metas'));ok(output.includes("onclick=\"TAB='goals';render()\""));
});

test('Dashboard usa fonte canônica também no orçamento de Metas',()=>{
  const source=html.slice(functionStart,functionEnd);
  ok(source.includes('MBGoalsV82.projectGoalsForView'));
  ok(!source.includes('MBGoals.all()'));
  ok(!source.includes('MBGoals.budget()'));
  ok(source.includes('MBGoalsV82.goalBudgetViewModel'));
});

console.log(`dashboard-goals-integration: ${testCount} tests, ${assertionCount} assertions passed`);
