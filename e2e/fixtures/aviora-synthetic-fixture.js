(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AVIORA_E2E_FIXTURE=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const CATEGORY_COLORS=Object.freeze({
    'Gastos Fixos':'#c96565',
    Investimentos:'#4e86d8',
    Conforto:'#b88f4a',
    Metas:'#8d63c7',
    Lazer:'#4f9a68',
    Conhecimento:'#d5b84d',
    Receitas:'#62a874'
  });

  const SCENARIO=Object.freeze({
    id:'aviora-e2e-2026-08',
    now:'2026-08-27',
    period:Object.freeze({year:2026,month:8}),
    profile:Object.freeze({id:'E2E_OWNER',role:'OWNER',email:'e2e-owner@invalid.test'}),
    accounts:Object.freeze([
      Object.freeze({id:'account-main',name:'Conta principal',balance:12500,opening_balance:12500}),
      Object.freeze({id:'account-reserve',name:'Reserva',balance:18500,opening_balance:18500})
    ]),
    assets:Object.freeze([
      Object.freeze({id:'asset-fund',name:'Fundo sintético',institution:'Instituição local',current_value:5000})
    ]),
    liabilities:Object.freeze([
      Object.freeze({id:'liability-loan',name:'Dívida sintética',balance:2000})
    ]),
    cards:Object.freeze([
      Object.freeze({id:'card-gold',name:'Cartão AVIORA',institution:'Banco sintético',brand:'Visa',closing_day:22,due_day:30,limit:8000,note:'Fixture local sem dados reais'})
    ]),
    transactions:Object.freeze([
      Object.freeze({id:'salary-realized',description:'Receita mensal',transaction_type:'receita',category:'Receitas',subcategory:'Salário',amount:6000,status:'realizado',transaction_date:'2026-08-02',account_id:'account-main'}),
      Object.freeze({id:'extra-income-realized',description:'Receita extraordinária',transaction_type:'receita',category:'Receitas',subcategory:'Extraordinária',amount:800,status:'realizado',transaction_date:'2026-08-05',account_id:'account-main'}),
      Object.freeze({id:'expense-realized',description:'Conta já paga',transaction_type:'despesa',category:'Gastos Fixos',subcategory:'Moradia',amount:1200,status:'realizado',transaction_date:'2026-08-03',account_id:'account-main'}),
      Object.freeze({id:'streaming-materialized',description:'Streaming mensal pago',transaction_type:'despesa',category:'Conforto',subcategory:'Assinaturas',amount:90,status:'realizado',transaction_date:'2026-08-10',recurring_series_id:'recurring-streaming',recurring_occurrence_date:'2026-08-10',account_id:'account-main'}),
      Object.freeze({id:'utility-pending',description:'Conta de energia pendente',transaction_type:'despesa',category:'Gastos Fixos',subcategory:'Moradia',amount:180,status:'pendente',transaction_date:'2026-08-28',account_id:'account-main'}),
      Object.freeze({id:'card-pending',description:'Compra no cartão pendente',transaction_type:'despesa',category:'Lazer',subcategory:'Passeios',amount:420,status:'pendente',transaction_date:'2026-08-30',purchase_date:'2026-08-20',card_id:'card-gold'}),
      Object.freeze({id:'installment-current',description:'Notebook parcelado',transaction_type:'despesa',category:'Conhecimento',subcategory:'Equipamentos',amount:250,status:'pendente',transaction_date:'2026-08-15',purchase_date:'2026-07-25',card_id:'card-gold',note:'Parcelado 1/2 • Compra 2026-07-25'}),
      Object.freeze({id:'installment-next',description:'Notebook parcelado',transaction_type:'despesa',category:'Conhecimento',subcategory:'Equipamentos',amount:250,status:'pendente',transaction_date:'2026-09-15',purchase_date:'2026-07-25',card_id:'card-gold',note:'Parcelado 2/2 • Compra 2026-07-25'}),
      Object.freeze({id:'investment-scheduled',description:'Aporte programado',transaction_type:'investimento',category:'Investimentos',subcategory:'Reserva',amount:350,status:'programado',transaction_date:'2026-08-30',account_id:'account-main'}),
      Object.freeze({id:'cancelled-expense',description:'Compra cancelada',transaction_type:'despesa',category:'Conforto',subcategory:'Compras',amount:999,status:'cancelado',transaction_date:'2026-08-18',account_id:'account-main'})
    ]),
    recurring:Object.freeze([
      Object.freeze({id:'recurring-rent',description:'Aluguel mensal',transaction_type:'despesa',category:'Gastos Fixos',subcategory:'Moradia',amount:1500,frequency:'monthly',interval:1,next_date:'2026-08-29',active:true,source_account_id:'account-main'}),
      Object.freeze({id:'recurring-internet',description:'Internet mensal',transaction_type:'despesa',category:'Gastos Fixos',subcategory:'Serviços',amount:100,frequency:'monthly',interval:1,next_date:'2026-08-28',active:true,source_account_id:'account-main'}),
      Object.freeze({id:'recurring-income',description:'Receita recorrente conhecida',transaction_type:'receita',category:'Receitas',subcategory:'Serviços',amount:2000,frequency:'monthly',interval:1,next_date:'2026-08-28',active:true,source_account_id:'account-main'}),
      Object.freeze({id:'recurring-streaming',description:'Streaming mensal',transaction_type:'despesa',category:'Conforto',subcategory:'Assinaturas',amount:90,frequency:'monthly',interval:1,next_date:'2026-08-10',active:true,source_account_id:'account-main'})
    ]),
    goals:Object.freeze([
      Object.freeze({id:'goal-reserve',name:'Reserva de emergência',target:30000,current:18500,deadline:'2027-12-31',status:'active'})
    ]),
    monthlyPlan:Object.freeze({year:2026,month:8,revenue:9000,fixed_expenses:3500,investments:900,comfort:700,goals:600,leisure:700,knowledge:500}),
    expected:Object.freeze({
      realized:Object.freeze({income:6800,consumptionExpense:1290,investment:0,availableBalanceEffect:5510}),
      scheduled:Object.freeze({income:0,consumptionExpense:850,investment:350,availableBalanceEffect:-1200}),
      projected:Object.freeze({income:2000,consumptionExpense:1600,investment:0,availableBalanceEffect:400}),
      forecast:Object.freeze({income:2000,consumptionExpense:2450,investment:350,availableBalanceEffect:-800}),
      total:Object.freeze({income:8800,consumptionExpense:3740,investment:350,availableBalanceEffect:4710})
    })
  });

  function clone(value){return JSON.parse(JSON.stringify(value))}
  function createScenario(){return clone(SCENARIO)}

  return Object.freeze({CATEGORY_COLORS,SCENARIO,createScenario});
});
