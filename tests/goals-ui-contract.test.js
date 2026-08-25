const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const goalsV82=require('../js/goals-integration');

let tests=0,assertions=0;
const ok=(value,message)=>{assertions+=1;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions+=1;assert.strictEqual(actual,expected,message)};
function test(name,fn){try{fn();tests+=1}catch(error){error.message=`${name}: ${error.message}`;throw error}}

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('function goals(){');
const end=html.indexOf('\nfunction recurring(){',start);
assert(start>=0&&end>start,'goals renderer must exist');
const source=html.slice(start,end);
const NOW='2026-08-25';

class FixedDate extends Date {
  constructor(...args){super(...(args.length?args:[`${NOW}T12:00:00Z`]))}
}

const goal={id:'casamento',name:'Casamento',target:50000,current:0,deadline:'2031-10-01'};
const transactions=Array.from({length:11},(_,index)=>{
  const occurrence=new Date(Date.UTC(2026,9+index,1)).toISOString().slice(0,10);
  return {id:`wedding-${index+1}`,goal_id:'casamento',goal_effect:'contribution',amount:400,status:'pending',transaction_date:occurrence,recurring_series_id:'wedding-monthly',recurring_occurrence_date:occurrence};
});
const recurring=[{id:'wedding-monthly',goal_id:'casamento',goal_effect:'contribution',amount:400,frequency:'monthly',interval:1,next_date:'2026-10-01',active:true}];

function render(){
  const context={
    window:null,Date:FixedDate,console,
    DATA:{goals:[goal],transactions,recurring},
    MBGoalsV82:goalsV82,
    monthlyPlan:()=>({goals:500}),
    money:value=>`R$ ${Number(value).toFixed(2)}`,
    pct:value=>`${Number(value).toFixed(1)}%`,
    esc:value=>String(value),
    pageHead:(_title,_description,_actions)=>''
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(`${source};this.renderGoals=goals;`,context);
  return context.renderGoals();
}

test('card Casamento comunica as métricas financeiras sem ambiguidade',()=>{
  const output=render();
  ok(output.includes('Realizado</span><strong>R$ 0.00'));
  ok(output.includes('Programado</span><strong>R$ 4400.00'));
  ok(output.includes('Projeção adicional</span><strong>R$ 20000.00'));
  ok(output.includes('Cobertura prevista</span><strong>R$ 24400.00'));
  ok(output.includes('48.8%'));
  ok(output.includes('Falta realizar</span><strong>R$ 50000.00'));
  ok(output.includes('Falta planejar</span><strong>R$ 25600.00'));
  ok(output.includes('Média mensal necessária'));
  ok(output.includes('R$ 819.67/mês'));
});

test('card Casamento mostra previsão posterior ao prazo',()=>{
  const output=render();
  ok(output.includes('Conclusão após o prazo'));
  ok(output.includes('Previsão de conclusão'));
  ok(output.includes('fevereiro de 2037'));
  ok(!output.includes('Ainda sem cobertura suficiente'));
  ok(!output.includes('Sem previsão</span>'));
});

test('renderer usa apenas fonte canônica para métricas e orçamento',()=>{
  ok(source.includes('engine.projectGoalsForView'));
  ok(source.includes('engine.goalBudgetViewModel(metrics,monthlyPlan()?.goals)'));
  ok(!source.includes('legacyEngine.budget'));
  equal(goalsV82.goalViewModel(goal,transactions,recurring,{now:NOW}).estimatedCompletionDate,'2037-02-01');
});

console.log(`goals-ui-contract: ${tests} tests, ${assertions} assertions passed`);
