'use strict';

const NOW='2026-08-20';
const ids=Object.freeze({
  userA:'aaaaaaaa-1111-4111-8111-111111111111',userB:'bbbbbbbb-2222-4222-8222-222222222222',
  checkingA:'aaaaaaaa-1111-4111-8111-111111111101',savingsA:'aaaaaaaa-1111-4111-8111-111111111102',cardA:'aaaaaaaa-1111-4111-8111-111111111103',assetA:'aaaaaaaa-1111-4111-8111-111111111104',
  casamento:'aaaaaaaa-1111-4111-8111-111111111105',casamentoRule:'aaaaaaaa-1111-4111-8111-111111111106',
  viagem:'aaaaaaaa-1111-4111-8111-111111111107',viagemRule:'aaaaaaaa-1111-4111-8111-111111111108',viagemNoDeadline:'aaaaaaaa-1111-4111-8111-111111111109',viagemNoDeadlineRule:'aaaaaaaa-1111-4111-8111-111111111110',
  checkingB:'bbbbbbbb-2222-4222-8222-222222222201',cardB:'bbbbbbbb-2222-4222-8222-222222222202'
});

function addMonths(date,offset){const [y,m,d]=date.split('-').map(Number),index=y*12+m-1+offset,year=Math.floor(index/12),month=index%12+1,last=new Date(Date.UTC(year,month,0)).getUTCDate();return `${year}-${String(month).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`}
function materialized(rule,goal,count,prefix){return Array.from({length:count},(_,index)=>{const date=addMonths(rule.next_date,index);return {id:`${prefix}-${String(index+1).padStart(2,'0')}`,user_id:ids.userA,transaction_date:date,description:`${goal.name} programado`,category:'Metas',amount:rule.amount,transaction_type:'investimento',status:'programado',account_id:ids.checkingA,source_account_id:ids.checkingA,asset_id:ids.assetA,goal_id:goal.id,goal_effect:'contribution',recurring_series_id:rule.id,recurring_occurrence_date:date}})}

const casamento=Object.freeze({id:ids.casamento,user_id:ids.userA,name:'Casamento',target:50000,current:0,deadline:'2031-10-01'});
const casamentoRule=Object.freeze({id:ids.casamentoRule,user_id:ids.userA,name:'Aporte Casamento',transaction_type:'investimento',type:'investimento',category:'Metas',amount:550,frequency:'monthly',interval:1,next_date:'2026-09-01',start_date:'2026-09-01',active:true,goal_id:ids.casamento,goal_effect:'contribution',account_id:ids.checkingA,asset_id:ids.assetA});
const viagem=Object.freeze({id:ids.viagem,user_id:ids.userA,name:'Viagem JP',target:8000,current:0,deadline:'2028-08-01'});
const viagemRule=Object.freeze({id:ids.viagemRule,user_id:ids.userA,name:'Aporte Viagem JP',transaction_type:'investimento',type:'investimento',category:'Metas',amount:550,frequency:'monthly',interval:1,next_date:'2026-09-01',start_date:'2026-09-01',active:true,goal_id:ids.viagem,goal_effect:'contribution',account_id:ids.checkingA,asset_id:ids.assetA});
const viagemNoDeadline=Object.freeze({id:ids.viagemNoDeadline,user_id:ids.userA,name:'Viagem sem prazo',target:8000,current:0,deadline:null});
const viagemNoDeadlineRule=Object.freeze({...viagemRule,id:ids.viagemNoDeadlineRule,name:'Aporte Viagem sem prazo',goal_id:ids.viagemNoDeadline});

const transactions=[
  {id:'income-a',user_id:ids.userA,transaction_date:'2026-08-05',description:'Receita Beta',category:'Salário',amount:8000,transaction_type:'receita',status:'realizado',account_id:ids.checkingA},
  {id:'expense-a',user_id:ids.userA,transaction_date:'2026-08-06',description:'Despesa Beta',category:'Gastos Fixos',amount:1200,transaction_type:'despesa',status:'realizado',account_id:ids.checkingA},
  {id:'card-a',user_id:ids.userA,transaction_date:'2026-08-10',purchase_date:'2026-08-02',description:'Cartão Beta',category:'Conforto',amount:250,transaction_type:'despesa',status:'realizado',card_id:ids.cardA,account_id:ids.checkingA},
  {id:'investment-a',user_id:ids.userA,transaction_date:'2026-08-12',description:'Investimento Beta',category:'Investimentos',amount:500,transaction_type:'investimento',status:'realizado',source_account_id:ids.checkingA,asset_id:ids.assetA},
  {id:'casamento-real-1',user_id:ids.userA,transaction_date:'2026-07-01',description:'Casamento realizado',category:'Metas',amount:550,transaction_type:'investimento',status:'realizado',source_account_id:ids.checkingA,asset_id:ids.assetA,goal_id:ids.casamento,goal_effect:'contribution'},
  {id:'casamento-real-2',user_id:ids.userA,transaction_date:'2026-08-01',description:'Casamento realizado',category:'Metas',amount:550,transaction_type:'investimento',status:'realizado',source_account_id:ids.checkingA,asset_id:ids.assetA,goal_id:ids.casamento,goal_effect:'contribution'},
  {id:'viagem-real-1',user_id:ids.userA,transaction_date:'2026-08-01',description:'Viagem realizada',category:'Metas',amount:550,transaction_type:'investimento',status:'realizado',source_account_id:ids.checkingA,asset_id:ids.assetA,goal_id:ids.viagem,goal_effect:'contribution'},
  ...materialized(casamentoRule,casamento,12,'casamento-programado'),
  ...materialized(viagemRule,viagem,6,'viagem-programada'),
  {id:'income-b',user_id:ids.userB,transaction_date:'2026-08-05',description:'Receita isolada B',category:'Salário',amount:4000,transaction_type:'receita',status:'realizado',account_id:ids.checkingB},
  {id:'expense-b',user_id:ids.userB,transaction_date:'2026-08-07',description:'Despesa isolada B',category:'Lazer',amount:300,transaction_type:'despesa',status:'realizado',account_id:ids.checkingB}
];

const fixture=Object.freeze({
  now:NOW,ids,
  users:[{id:ids.userA,email:'beta-a@example.invalid'},{id:ids.userB,email:'beta-b@example.invalid'}],
  accounts:[{id:ids.checkingA,user_id:ids.userA,name:'Conta Beta A',opening_balance:10000},{id:ids.savingsA,user_id:ids.userA,name:'Reserva Beta A',opening_balance:2000},{id:ids.checkingB,user_id:ids.userB,name:'Conta Beta B',opening_balance:5000}],
  cards:[{id:ids.cardA,user_id:ids.userA,name:'Cartão Beta A',limit:3000},{id:ids.cardB,user_id:ids.userB,name:'Cartão Beta B',limit:1500}],
  assets:[{id:ids.assetA,user_id:ids.userA,name:'Fundo Beta A',opening_value:3000,current_value:3000}],
  liabilities:[],categories:[{id:'cat-fixed',user_id:ids.userA,name:'Gastos Fixos',kind:'despesa'},{id:'cat-income',user_id:ids.userA,name:'Salário',kind:'receita'}],
  goals:[casamento,viagem,viagemNoDeadline],recurring:[casamentoRule,viagemRule,viagemNoDeadlineRule],transactions,
  monthly:[{user_id:ids.userA,year:2026,month:8,revenue:8000,fixed_expenses:1500,comfort:500,goals:1100,leisure:400,knowledge:300,investments:1000}],
  reserveLedger:[{id:'reserve-a-1',type:'aporte',amount:3000,date:'2026-06-01'},{id:'reserve-a-2',type:'retirada',amount:500,date:'2026-07-01'}],
  reserveSettings:{targetMode:'custom',customTarget:12000,months:6}
});

module.exports=fixture;
