(function(root,factory){
  const api=typeof module==='object'&&module.exports
    ? factory(require('./financial-core'),require('./dashboard-financial-integration'),require('./goals-integration'))
    : factory(root?.MBCanonicalFinance,root?.MBDashboardFinancialV82,root?.MBGoalsV82);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MBReserveHealthV82=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(core,dashboard,goals){
'use strict';
if(!core||!dashboard||!goals)throw new Error('Canonical health dependencies unavailable');
const WEIGHTS=Object.freeze({budget:.25,investment:.25,reserve:.20,commitment:.15,goals:.15});
const TOTAL_COMPONENTS=5;
const clamp=value=>Math.min(100,Math.max(0,Number(value)||0));
function fixedForMonth(rows,year,month,now){return rows.reduce((sum,row)=>{const date=core.financialDate(row),state=core.temporalState(row,now).state,type=core.financialEffect(row,{now}).type,category=String(row.category||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();return date?.slice(0,7)===`${year}-${String(month).padStart(2,'0')}`&&state==='efetivado'&&type==='despesa'&&category==='gastos fixos'?sum+Number(row.amount||0):sum},0)}
function fixedAverage(rows,year,month,now){let total=0;for(let offset=1;offset<=6;offset++){const date=new Date(Date.UTC(year,month-1-offset,1));total+=fixedForMonth(rows,date.getUTCFullYear(),date.getUTCMonth()+1,now)}return total/6}
function reserveSnapshot(ledger,settings,fixed){const balance=ledger.reduce((sum,item)=>sum+(item.type==='retirada'?-Number(item.amount||0):Number(item.amount||0)),0),mode=settings.targetMode==='custom'?'custom':'fixed',months=Math.max(.5,Number(settings.months||6)),target=mode==='custom'?Math.max(0,Number(settings.customTarget||0)):fixed*months;return {balance,mode,months,target,remaining:Math.max(0,target-balance),coverage:fixed>0?balance/fixed:0,progress:target>0?clamp(balance/target*100):0}}
function component(key,score,evaluable,reason){return Object.freeze({key,score:evaluable?clamp(score):null,weight:WEIGHTS[key],evaluable,reason:evaluable?null:reason})}
function healthScore({plan,transactions,rules,goalsData,reserve,year,month,now}){
  const projection=dashboard.projectDashboardPeriod(transactions,rules,{year,month,now});
  const plannedIncome=Number(plan?.revenue||0),plannedOut=['fixed_expenses','investments','comfort','goals','leisure','knowledge'].reduce((sum,key)=>sum+Number(plan?.[key]||0),0),actualOut=projection.realized.consumptionExpense+projection.realized.investment;
  const fixedCurrent=fixedForMonth(transactions,year,month,now);
  const goalRows=goals.projectGoalsForView(goalsData.filter(goal=>!/reserva|emerg[eê]ncia|caixinha/i.test(String(goal.name||''))&&Number(goal.target)>0),transactions,rules,{now});
  const components=[
    component('budget',plannedOut>0?clamp((1-Math.max(0,actualOut-plannedOut)/plannedOut)*100):null,plannedOut>0,'missing_monthly_plan'),
    component('investment',plannedIncome>0?clamp(projection.realized.investment/plannedIncome*100):null,plannedIncome>0,'missing_planned_income'),
    component('reserve',reserve.target>0?clamp(reserve.balance/reserve.target*100):null,reserve.target>0,'missing_reserve_target'),
    component('commitment',plannedOut>0&&fixedCurrent>0?clamp((1-Math.max(0,fixedCurrent-plannedOut*.55)/Math.max(1,plannedOut*.55))*100):null,plannedOut>0&&fixedCurrent>0,'missing_realized_fixed_expenses'),
    component('goals',goalRows.length?goalRows.reduce((sum,goal)=>sum+clamp(goal.realizedTotal/goal.target*100),0)/goalRows.length:null,goalRows.length>0,'missing_goals')
  ];
  const evaluated=components.filter(item=>item.evaluable),weightSum=evaluated.reduce((sum,item)=>sum+item.weight,0);
  const score=evaluated.length?Math.round(evaluated.reduce((sum,item)=>sum+item.score*(item.weight/weightSum),0)):null;
  const evaluable=evaluated.length>0,partial=evaluable&&evaluated.length<TOTAL_COMPONENTS;
  return {score,evaluable,partial,evaluatedComponents:evaluated.length,totalComponents:TOTAL_COMPONENTS,message:evaluable?(partial?`Avaliação parcial: ${evaluated.length} de ${TOTAL_COMPONENTS} indicadores disponíveis.`:'Avaliação completa.'):'Ainda sem dados suficientes para calcular sua Saúde Financeira.',label:score===null?'Dados insuficientes':score<40?'Crítica':score<60?'Atenção':score<75?'Regular':score<90?'Boa':'Excelente',components,budgetScore:components[0].score,investScore:components[1].score,reserveScore:components[2].score,commitmentScore:components[3].score,goalScore:components[4].score,cov:reserve.coverage,mt:reserve.months,fixed:reserve.target&&reserve.months?reserve.target/reserve.months:0,t:projection.realized,weights:WEIGHTS};
}
return Object.freeze({WEIGHTS,TOTAL_COMPONENTS,fixedForMonth,fixedAverage,reserveSnapshot,healthScore});
});
