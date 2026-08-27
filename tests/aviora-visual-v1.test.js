const assert=require('assert');
const fs=require('fs');
const path=require('path');
const visual=require('../js/aviora-visual-v1');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const css=read('assets/aviora-v82.css');
const index=read('index.html');
const preview=read('aviora-v82.preview.local.html');
const source=read('js/aviora-visual-v1.js');
let tests=0,assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions++;assert.strictEqual(actual,expected,message)};
const deep=(actual,expected,message)=>{assertions++;assert.deepStrictEqual(actual,expected,message)};
const test=(name,fn)=>{fn();tests++;};

test('resumo visual consome somente os motores canônicos e preserva os campos financeiros',()=>{
  const data={transactions:[{id:'t'}],recurring:[{id:'r'}]};
  const before=JSON.stringify(data);
  const result=visual.transactionSummary(data,{year:2026,month:8},{
    now:'2026-08-27',
    dashboard:{projectDashboardPeriod(rows,rules,options){
      deep(rows,data.transactions);deep(rules,data.recurring);deep(options,{year:2026,month:8,now:'2026-08-27'});
      return {realized:{consumptionExpense:600,investment:120},scheduled:{consumptionExpense:90,investment:10},projected:{consumptionExpense:200,investment:40}};
    }},
    planning:{projectPlanningPeriod(plan,rows,rules,options){
      equal(plan,null);deep(rows,data.transactions);deep(rules,data.recurring);deep(options,{year:2026,month:8,now:'2026-08-27'});
      return {planned:{totalOut:1000},forecast:{totalOut:1050}};
    }},
    monthlyPlan:()=>null
  });
  deep(result,{year:2026,month:8,realized:720,scheduled:100,projected:240,planned:1000,forecast:1050});
  equal(JSON.stringify(data),before,'presentation does not mutate financial rows');
});

test('moeda pt-BR usada no DOM pode ser lida sem artefato de ponto flutuante',()=>{
  equal(visual.parsePtBrCurrency('R$ 736,85'),736.85);
  equal(visual.parsePtBrCurrency('R$ 12.480,00'),12480);
  equal(visual.parsePtBrCurrency('—'),0);
});

test('accordions são semânticos, fechados por padrão e não persistem estado',()=>{
  for(const token of ['aria-controls','aria-expanded','panel.hidden','avioraaccordionready'])ok(source.toLowerCase().includes(token),`missing ${token}`);
  ok(source.includes('wireAccordion(wrapper.querySelector(\'button\'),wrapper.querySelector(\'.aviora-accordion-panel\'),false)'));
  ok(!/localStorage|sessionStorage/.test(source));
});

test('Lançamentos, Metas e Planejamento recebem resumo primeiro e detalhe sob demanda',()=>{
  for(const token of ['Acompanhamento do mês','Todos os lançamentos','aviora-goal-trigger','aviora-planning-bars','Ver comparação completa'])ok(source.includes(token),`missing ${token}`);
  ok(css.includes('.aviora-accordion-trigger'));
  ok(css.includes('.aviora-goal-panel[hidden]'));
});

test('cores configuráveis das categorias atravessam tabela, barra e drill-down',()=>{
  ok(source.includes("const color=dot?.style.background||dot?.style.backgroundColor"));
  ok(source.includes("card.style.setProperty('--category-color',color)"));
  ok(css.includes('background: var(--category-color)'));
  ok(index.includes('style="background:${categoryColor(category)}"'));
  ok(index.includes('x.color||categoryColor(x.name)'));
});

test('Dashboard usa quatro KPIs primários, alertas e gráficos no mesmo palco',()=>{
  ok(source.includes("index<4?'is-primary':'is-secondary'"));
  ok(source.includes('aviora-dashboard-alerts'));
  ok(source.includes("label=/categoria/i.test(raw)?'Distribuição':/evolu/i.test(raw)?'Evolução':'Comparação'"));
  ok(css.includes('.aviora-chart-stage'));
});

test('mobile 390/430 tem safe-area, touch e tabelas responsivas',()=>{
  ok(css.includes('env(safe-area-inset-top)'));
  ok(css.includes('@media (max-width: 430px)'));
  ok(css.includes('min-height: 44px'));
  ok(css.includes('content: attr(data-label)'));
  ok(css.includes('.report-table { min-width: 720px; }'),'reports keep essential tabular comparison');
  ok(css.includes('overflow-x: clip'));
});

test('Login, Conhecimento e Administração preservam contratos funcionais',()=>{
  ok(index.includes('commercial/access-contract.js'));
  ok(index.includes('js/admin-area.js'));
  ok(index.includes('js/account-security.js'));
  ok(index.includes('js/aviora-visual-v1.js'));
  ok(source.includes("if(active==='knowledge')enhanceKnowledge(view)"));
  ok(!source.includes('AVIORA_ADMIN_APP'));
  ok(!source.includes('supabase'));
});

test('preview local usa exatamente a mesma camada visual sem inicializar backend',()=>{
  ok(preview.includes('js/aviora-visual-v1.js'));
  ok(preview.includes('data-tab="dashboard"'));
  ok(!preview.includes('createClient('));
  ok(!/service[_-]?role|access[_-]?token|refresh[_-]?token/i.test(preview));
});

test('escopo não altera motores financeiros nem backend',()=>{
  const protectedNames=['financial-core.js','goal-projection.js','goals-integration.js','planning-integration.js'];
  for(const name of protectedNames)ok(!source.includes(`../${name}`)&&!source.includes(`./${name}`),`${name} is not reimplemented`);
  ok(!index.includes('type="module" src="js/aviora-visual-v1.js"'));
});

console.log(`aviora-visual-v1: ${tests} tests, ${assertions} assertions passed`);
