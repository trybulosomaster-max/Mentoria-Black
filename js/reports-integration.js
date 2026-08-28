(function(root,factory){
  const api=typeof module==='object'&&module.exports
    ?factory(require('./financial-core'),require('./recurrence-projection'),require('./card-billing-financial-adjustments'))
    :factory(root?.MBCanonicalFinance,root?.MBRecurrenceProjection,root?.MBCardBillingFinancialAdjustmentsV1);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MBReportsV82=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(core,recurrence,cardBillingAdjustments){
'use strict';

if(!core||!recurrence)throw new Error('Canonical report dependencies are unavailable');
const {financialDate,temporalState,financialEffect}=core;
const {projectRecurringOccurrences}=recurrence;
const states={realizado:'efetivado',pendente:'previsto_materializado',programado:'previsto_materializado',projetado:'projetado_virtual',cancelado:'cancelado',nao_classificado:'nao_classificado'};
const list=value=>Array.isArray(value)?value:value?[value]:[];
const addMoney=(left,right)=>Math.round((Number(left||0)+Number(right||0))*100)/100;

function period(date,options){
  if(!date)return false;
  if(options.periodMode==='custom')return(!options.dateFrom||date>=options.dateFrom)&&(!options.dateTo||date<=options.dateTo);
  const year=Number(date.slice(0,4));
  if(options.periodMode==='multi')return !list(options.years).length||list(options.years).map(Number).includes(year);
  if(options.periodMode==='year')return year===Number(options.year);
  return year===Number(options.year)&&Number(date.slice(5,7))===Number(options.month);
}

function wanted(options){
  const raw=list(options.states||options.statuses);
  if(!raw.length)return ['efetivado','previsto_materializado'];
  return [...new Set(raw.map(value=>states[value]||value))];
}

function match(row,options,state){
  const type=row.type||financialEffect(row,{now:options.now}).type;
  return period(row.date,options)
    &&wanted(options).includes(state)
    &&(!list(options.types).length||list(options.types).includes(type))
    &&(!list(options.categories).length||list(options.categories).includes(row.category))
    &&(!options.category||options.category===row.category)
    &&(!options.accountId||String(row.account_id||'')===String(options.accountId))
    &&(!options.cardId||String(row.card_id||'')===String(options.cardId))
    &&(!options.goalId||String(row.goal_id||'')===String(options.goalId));
}

function aggregate(rows){
  const out={income:0,consumptionExpense:0,investment:0,transfer:0,rescue:0,movementTotal:0,netEffect:0,cardCreditAdjustment:0,byType:{},byCategory:{},byState:{}};
  for(const row of rows){
    const amount=Number(row.amount)||0,type=row.type;
    const aggregateAmount=row.kind==='card_purchase_credit_adjustment'?Number(row.consumptionDelta)||0:amount;
    out.movementTotal=addMoney(out.movementTotal,aggregateAmount);
    out.byType[type]=addMoney(out.byType[type],aggregateAmount);
    out.byCategory[row.category]=addMoney(out.byCategory[row.category],aggregateAmount);
    out.byState[row.state]=addMoney(out.byState[row.state],aggregateAmount);
    if(row.state!=='efetivado')continue;
    if(row.kind==='card_purchase_credit_adjustment'){
      out.cardCreditAdjustment=addMoney(out.cardCreditAdjustment,aggregateAmount);
      out.consumptionExpense=addMoney(out.consumptionExpense,aggregateAmount);
      out.netEffect=addMoney(out.netEffect,-aggregateAmount);
    }else if(type==='receita'){
      out.income=addMoney(out.income,amount);out.netEffect=addMoney(out.netEffect,amount);
    }else if(type==='despesa'){
      out.consumptionExpense=addMoney(out.consumptionExpense,amount);out.netEffect=addMoney(out.netEffect,-amount);
    }else if(type==='investimento')out.investment=addMoney(out.investment,amount);
    else if(type==='transferencia')out.transfer=addMoney(out.transfer,amount);
    else if(type==='resgate')out.rescue=addMoney(out.rescue,amount);
  }
  return out;
}

function cardCreditRows(options,warnings){
  const source=options.cardPurchaseCreditEffects;
  if(source===undefined||source===null)return [];
  if(!Array.isArray(source)){warnings.push('invalid_card_purchase_credit_effects');return []}
  if(!cardBillingAdjustments||typeof cardBillingAdjustments.normalizeCardPurchaseCreditEffects!=='function'){
    warnings.push('card_credit_adjustments_dependency_unavailable');return [];
  }
  const normalized=cardBillingAdjustments.normalizeCardPurchaseCreditEffects(source,{now:options.now});
  warnings.push(...normalized.warnings);
  return normalized.adjustments.map(adjustment=>({
    id:`card-credit:${adjustment.id}`,
    source_entry_id:adjustment.entryId,
    operation_id:adjustment.operationId,
    transaction_id:adjustment.transactionId,
    card_id:adjustment.cardId,
    billing_cycle_id:adjustment.billingCycleId,
    date:adjustment.effectiveDate,
    state:'efetivado',
    type:'despesa',
    category:adjustment.category,
    subcategory:adjustment.subcategory,
    amount:adjustment.amount,
    consumptionDelta:adjustment.consumptionDelta,
    entryKind:adjustment.entryKind,
    kind:'card_purchase_credit_adjustment',
    readOnly:true,
    description:adjustment.entryKind==='purchase_credit'?'Crédito de cartão':'Reversão de crédito do cartão'
  })).filter(row=>match(row,options,row.state));
}

function projectReport(transactions,rules,options={}){
  if(!Array.isArray(transactions)||!Array.isArray(rules))throw new TypeError('transactions and recurringRules must be arrays');
  if(!financialDate({transaction_date:options.now}))throw new TypeError('options.now is required');
  const warnings=[],rows=[],year=Number(options.year),month=Number(options.month||1),lastDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  for(const transaction of transactions){
    const date=financialDate(transaction),temporal=temporalState(transaction,options.now),effect=financialEffect(transaction,{now:options.now});
    if(!date){warnings.push(`invalid_financial_date:${transaction.id||'unknown'}`);continue}
    const state=temporal.state;
    const row={...transaction,date,state,type:effect.type,category:String(transaction.category||'Sem categoria'),amount:Number(transaction.amount)||0,kind:'materialized'};
    if(temporal.warnings.includes('future_realized'))warnings.push(`future_realized:${transaction.id||'unknown'}`);
    if(match(row,options,state))rows.push(row);
  }
  if(wanted(options).includes('projetado_virtual'))for(const rule of rules){
    for(const occurrence of projectRecurringOccurrences(rule,{
      horizonStart:options.dateFrom||`${year}-${String(month).padStart(2,'0')}-01`,
      horizonEnd:options.dateTo||`${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`,
      materializedOccurrences:transactions,maxOccurrences:options.maxOccurrences||1000
    })){
      const row={...rule,date:occurrence.occurrenceDate,state:'projetado_virtual',type:financialEffect({...rule,status:'programado',transaction_date:occurrence.occurrenceDate},{now:options.now}).type,category:String(rule.category||'Sem categoria'),amount:occurrence.amount,kind:'projected_virtual',key:occurrence.key};
      if(match(row,options,row.state))rows.push(row);
    }
  }
  rows.push(...cardCreditRows(options,warnings));
  rows.sort((left,right)=>right.date.localeCompare(left.date));
  return Object.freeze({rows,totals:aggregate(rows),warnings});
}

return Object.freeze({projectReport});
});
