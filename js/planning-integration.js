(function(root, factory) {
  const api = typeof module === 'object' && module.exports
    ? factory(require('./financial-core'), require('./recurrence-projection'))
    : factory(root?.MBCanonicalFinance, root?.MBRecurrenceProjection);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MBPlanningV82 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(financialCore, recurrenceProjection) {
'use strict';

if (!financialCore || !recurrenceProjection) throw new Error('Canonical planning dependencies are unavailable');
const {financialDate,temporalState,financialEffect} = financialCore;
const {projectRecurringOccurrences,materializedOccurrenceKey} = recurrenceProjection;

const PLAN_FIELDS=Object.freeze({
  fixed_expenses:'Gastos Fixos',comfort:'Conforto',goals:'Metas',leisure:'Lazer',knowledge:'Conhecimento'
});

function periodBounds(yearValue,monthValue) {
  const year=Number(yearValue),month=Number(monthValue);
  if(!Number.isInteger(year)||year<1||year>9999)throw new RangeError('year must be an integer from 1 to 9999');
  if(!Number.isInteger(month)||month<1||month>12)throw new RangeError('month must be an integer from 1 to 12');
  const lastDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  const prefix=`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}`;
  return Object.freeze({year,month,key:prefix,dateFrom:`${prefix}-01`,dateTo:`${prefix}-${String(lastDay).padStart(2,'0')}`});
}

function planForPeriod(plan,period) {
  if(Array.isArray(plan))return plan.find(row=>Number(row?.year)===period.year&&Number(row?.month)===period.month)||null;
  if(plan===null||plan===undefined)return null;
  if(typeof plan!=='object')throw new TypeError('plan must be an object, array, null, or undefined');
  if(plan.year!==undefined&&Number(plan.year)!==period.year)return null;
  if(plan.month!==undefined&&Number(plan.month)!==period.month)return null;
  return plan;
}

function moneyValue(value,field,warnings) {
  if(value===undefined||value===null||value==='')return 0;
  const number=Number(value);
  if(!Number.isFinite(number)||number<0){warnings.push(`invalid_plan_amount:${field}`);return 0}
  return number;
}

function plannedValues(plan,warnings) {
  const selected=plan||{};
  const consumptionByCategory={};
  for(const [field,category] of Object.entries(PLAN_FIELDS))consumptionByCategory[category]=moneyValue(selected[field],field,warnings);
  const investment=moneyValue(selected.investments,'investments',warnings);
  const fixedExpenses=consumptionByCategory['Gastos Fixos'];
  const comfort=consumptionByCategory.Conforto;
  const goals=consumptionByCategory.Metas;
  const leisure=consumptionByCategory.Lazer;
  const knowledge=consumptionByCategory.Conhecimento;
  return {
    revenue:moneyValue(selected.revenue,'revenue',warnings),consumptionByCategory,investment,goals,leisure,knowledge,comfort,fixedExpenses,
    totalOut:fixedExpenses+comfort+goals+leisure+knowledge+investment
  };
}

function emptyMovement() {
  return {income:0,consumptionByCategory:{},investment:0,totalOut:0};
}

function emptyNeutral() {
  return {realized:0,scheduledMaterialized:0,projectedVirtual:0,forecast:0};
}

function categoryOf(row) {
  const value=row?.category_name??row?.category??row?.category_id;
  return String(value??'').trim()||'Sem categoria';
}

function addMovement(bucket,type,amount,category) {
  if(type==='receita')bucket.income+=amount;
  else if(type==='despesa')bucket.consumptionByCategory[category]=(bucket.consumptionByCategory[category]||0)+amount;
  else if(type==='investimento')bucket.investment+=amount;
  bucket.totalOut=Object.values(bucket.consumptionByCategory).reduce((sum,value)=>sum+value,0)+bucket.investment;
}

function installmentDuplicateKey(row) {
  const note=String(row?.note||'');
  if(!/parcelado\s+\d+\/\d+/i.test(note))return null;
  const installment=note.match(/parcelado\s+(\d+)\/(\d+).*?compra\s+([0-9]{4}-[0-9]{2}(?:-[0-9]{2})?)/i);
  if(installment)return ['parcel',installment[3],installment[1],installment[2],String(row?.description||'').trim().toLowerCase(),String(row?.transaction_type??row?.type??''),String(row?.category||'').trim().toLowerCase(),row?.account_id||'',row?.card_id||''].join('|');
  return [row?.transaction_date,row?.purchase_date||'',row?.transaction_type??row?.type??'',String(row?.description||'').trim().toLowerCase(),String(row?.category||'').trim().toLowerCase(),Number(row?.amount||0).toFixed(2),row?.account_id||'',row?.card_id||''].join('|');
}

function dedupeTransactions(rows,warnings) {
  const installments=new Set(),recurrences=new Set(),result=[];
  for(const row of rows) {
    const installmentKey=installmentDuplicateKey(row);
    if(installmentKey&&installments.has(installmentKey)){warnings.push(`duplicate_installment:${row?.id??installmentKey}`);continue}
    if(installmentKey)installments.add(installmentKey);
    const recurrenceKey=materializedOccurrenceKey(row);
    if(recurrenceKey&&recurrences.has(recurrenceKey)){warnings.push(`duplicate_materialized:${recurrenceKey}`);continue}
    if(recurrenceKey)recurrences.add(recurrenceKey);
    result.push(row);
  }
  return result;
}

function inPeriod(date,period) {
  return !!date&&date>=period.dateFrom&&date<=period.dateTo;
}

function warningId(row) {
  return row?.id??materializedOccurrenceKey(row)??'unknown';
}

function classifyMaterialized(rows,period,now,result) {
  for(const row of rows) {
    const date=financialDate(row);
    if(!date){result.unclassified.push({row,reason:'invalid_financial_date'});result.warnings.push(`invalid_financial_date:${warningId(row)}`);continue}
    if(!inPeriod(date,period))continue;
    const temporal=temporalState(row,now);
    if(temporal.state==='cancelado')continue;
    if(temporal.state==='nao_classificado'){
      result.unclassified.push({row,reason:temporal.warnings.includes('missing_status')?'missing_status':'unknown_status'});
      result.warnings.push(`unclassified_transaction:${warningId(row)}`);continue;
    }
    const effect=financialEffect(row,{now});
    if(effect.type==='nao_classificado'||effect.amount===null){
      result.unclassified.push({row,reason:effect.type==='nao_classificado'?'unknown_type':'invalid_amount'});
      result.warnings.push(`${effect.type==='nao_classificado'?'unknown_type':'invalid_amount'}:${warningId(row)}`);continue;
    }
    const stage=temporal.state==='efetivado'?'realized':'scheduledMaterialized';
    if(temporal.warnings.includes('future_realized'))result.warnings.push(`future_realized:${warningId(row)}`);
    if(effect.type==='transferencia')result.transfers[stage]+=effect.amount;
    else if(effect.type==='resgate')result.rescues[stage]+=effect.amount;
    else addMovement(result[stage],effect.type,effect.amount,categoryOf(row));
    result.details[stage].push(row);
  }
}

function classifyProjected(rules,materialized,period,now,options,result) {
  for(const rule of rules) {
    let occurrences;
    try {
      occurrences=projectRecurringOccurrences(rule,{
        horizonStart:period.dateFrom,horizonEnd:period.dateTo,materializedOccurrences:materialized,
        maxOccurrences:options.maxOccurrences,maxIterations:options.maxIterations
      });
    } catch(error) {
      result.warnings.push(`invalid_recurring_rule:${rule?.id??'unknown'}:${error.message}`);
      continue;
    }
    for(const occurrence of occurrences) {
      const synthetic={...rule,amount:occurrence.amount,status:'programado',transaction_date:occurrence.occurrenceDate};
      const effect=financialEffect(synthetic,{now});
      if(effect.type==='nao_classificado'||effect.amount===null){
        result.unclassified.push({row:rule,occurrence,reason:effect.type==='nao_classificado'?'unknown_type':'invalid_amount'});
        result.warnings.push(`invalid_projected_occurrence:${occurrence.key}`);continue;
      }
      const item=Object.freeze({...occurrence,transactionType:effect.type,category:categoryOf(rule),categoryId:rule?.category_id??null,goalId:rule?.goal_id??occurrence.goalId??null});
      if(effect.type==='transferencia')result.transfers.projectedVirtual+=effect.amount;
      else if(effect.type==='resgate')result.rescues.projectedVirtual+=effect.amount;
      else addMovement(result.projectedVirtual,effect.type,effect.amount,item.category);
      result.details.projectedVirtual.push(item);
    }
  }
}

function combineMovement(left,right) {
  const categories={...left.consumptionByCategory};
  for(const [category,amount] of Object.entries(right.consumptionByCategory))categories[category]=(categories[category]||0)+amount;
  const investment=left.investment+right.investment;
  return {income:left.income+right.income,consumptionByCategory:categories,investment,totalOut:Object.values(categories).reduce((sum,value)=>sum+value,0)+investment};
}

function projectPlanningPeriod(plan,transactions,recurringRules,options={}) {
  if(!Array.isArray(transactions))throw new TypeError('transactions must be an array');
  if(!Array.isArray(recurringRules))throw new TypeError('recurringRules must be an array');
  const period=periodBounds(options.year,options.month);
  const now=financialDate({transaction_date:options.now});
  if(!now)throw new TypeError('options.now must be a valid date');
  const warnings=[];
  const selectedPlan=planForPeriod(plan,period);
  const result={
    period:Object.freeze({...period,planFound:!!selectedPlan}),planned:plannedValues(selectedPlan,warnings),
    realized:emptyMovement(),scheduledMaterialized:emptyMovement(),projectedVirtual:emptyMovement(),forecast:emptyMovement(),
    transfers:emptyNeutral(),rescues:emptyNeutral(),unclassified:[],warnings,
    details:{realized:[],scheduledMaterialized:[],projectedVirtual:[]}
  };
  const materialized=dedupeTransactions(transactions,warnings);
  classifyMaterialized(materialized,period,now,result);
  classifyProjected(recurringRules,materialized,period,now,options,result);
  result.forecast=combineMovement(result.scheduledMaterialized,result.projectedVirtual);
  result.transfers.forecast=result.transfers.scheduledMaterialized+result.transfers.projectedVirtual;
  result.rescues.forecast=result.rescues.scheduledMaterialized+result.rescues.projectedVirtual;
  return result;
}

return Object.freeze({projectPlanningPeriod});
});
