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
  for(const token of ['Acompanhamento do mês','Todos os lançamentos','aviora-goal-trigger','aviora-planning-bars','Planejamento por categoria'])ok(source.includes(token),`missing ${token}`);
  ok(css.includes('.aviora-accordion-trigger'));
  ok(css.includes('.aviora-goal-panel[hidden]'));
});

test('cores configuráveis das categorias atravessam tabela, barra e drill-down',()=>{
  ok(source.includes("const color=dot?.style.background||dot?.style.backgroundColor"));
  ok(source.includes("card.style.setProperty('--category-color',color)"));
  ok(css.includes('background: var(--category-color)'));
  ok(index.includes('style="background:${categoryColor(category)}"'));
  ok(index.includes('x.color||categoryColor(x.name)'));
  ok(index.includes('categories.Investimentos=Number(view.expected.investment)'));
});

test('Dashboard usa quatro KPIs primários, alertas e gráficos no mesmo palco',()=>{
  ok(source.includes("index<4?'is-primary':'is-secondary'"));
  ok(source.includes('aviora-dashboard-alerts'));
  ok(source.includes("label=/categoria/i.test(raw)?'Distribuição':/evolu/i.test(raw)?'Evolução':'Comparação'"));
  ok(css.includes('.aviora-chart-stage'));
  ok(source.includes('Últimos lançamentos do período ·'));
  ok(source.includes("wireAccordion(trigger,panel,false)"));
  ok(css.includes('.card:not(.aviora-accordion):not(.aviora-chart-stage)'),'collapsed dashboard cards are excluded from desktop minimum height');
  ok(source.includes('wireTabs(tabs,index=>'),'chart analyses use the shared keyboard tab primitive');
});

test('foundations, shell e primitives compartilham contratos sem nova paleta',()=>{
  for(const token of ['--aviora-surface-input','--aviora-space-4','--aviora-touch','--aviora-font-ui','--aviora-focus-ring','--aviora-elevation-card','--aviora-motion-fast'])ok(css.includes(token),`missing ${token}`);
  ok(css.includes('grid-template-columns: repeat(8,minmax(0,1fr))'),'desktop navigation uses a stable shared grid');
  ok(css.includes('.aviora-mobile-nav-trigger > span:first-child { min-width: 0; }'),'long mobile titles cannot collide with Menu');
  ok(!css.includes('backdrop-filter: blur(14px)'),'shell avoids a persistent heavyweight blur');
  for(const primitive of ['.aviora-surface','.aviora-metric','.aviora-accordion-trigger','.tag,','.modalbox:focus'])ok(css.includes(primitive),`missing primitive ${primitive}`);
});

test('modal genérico e tabs seguem acessibilidade compartilhada',()=>{
  ok(index.includes('class="modalbox" role="dialog" aria-modal="true" aria-labelledby="modalTitle" tabindex="-1"'));
  ok(index.includes('setAttribute("aria-hidden","false")')&&index.includes('setAttribute("aria-hidden","true")'));
  for(const token of ['wireDialog(root,dialog)','dialogControls(dialog)','event.key===\'Escape\'','event.key!==\'Tab\'','__avioraReturnFocus'])ok(source.includes(token),`missing dialog behavior ${token}`);
  for(const token of ['ArrowRight','ArrowLeft','Home','End','aria-labelledby'])ok(source.includes(token),`missing tab behavior ${token}`);
});

test('navegação mobile mantém todos os destinos autorizados acessíveis em menu semântico',()=>{
  ok(source.includes("nav.querySelectorAll(':scope > [data-tab]')"));
  ok(source.includes("trigger.setAttribute('aria-controls',panelId)"));
  ok(source.includes("sheet.addEventListener('keydown'"));
  ok(source.includes("event.key==='Escape'"));
  ok(source.includes("item.addEventListener('click'"));
  ok(css.includes('.aviora-mobile-nav-sheet'));
  ok(css.includes('.nav.aviora-mobile-nav-ready > [data-tab] { display: none; }'));
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
  equal((preview.match(/data-tab="/g)||[]).length,15);
  for(const tab of ['dashboard','transactions','planning','categories','recurring','wealth','account','reserve-v52','health-v53','administration'])ok(preview.includes(`data-tab="${tab}"`),`preview missing ${tab}`);
  for(const hook of ['data-dashboard-latest','v22-tx-filters','planning-canonical','renderAccountSecurity'])ok(preview.includes(hook),`preview missing ${hook}`);
  ok(preview.includes("params.get('tab')||'dashboard'"));
  ok(!preview.includes('createClient('));
  ok(!/service[_-]?role|access[_-]?token|refresh[_-]?token/i.test(preview));
});

test('escopo não altera motores financeiros nem backend',()=>{
  const protectedNames=['financial-core.js','goal-projection.js','goals-integration.js','planning-integration.js'];
  for(const name of protectedNames)ok(!source.includes(`../${name}`)&&!source.includes(`./${name}`),`${name} is not reimplemented`);
  ok(!index.includes('type="module" src="js/aviora-visual-v1.js"'));
});

console.log(`aviora-visual-v1: ${tests} tests, ${assertions} assertions passed`);
