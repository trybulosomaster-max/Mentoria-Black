(function(root,factory){
  const api=typeof module==='object'&&module.exports
    ?factory(require('./financial-core'),require('./recurrence-projection'))
    :factory(root?.MBCanonicalFinance,root?.MBRecurrenceProjection);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MBRecurringViewV2=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(finance,projection){
  'use strict';

  if(!finance||!projection)throw new Error('Canonical finance and recurrence dependencies are required');
  const money=value=>Math.round((Number(value)||0)*100)/100;
  const typeOf=row=>String(row?.transaction_type??row?.type??'').trim().toLowerCase();
  const sourceId=row=>{
    const structured=[row?.recurring_series_id,row?.recurringSeriesId,row?.source_rule_id]
      .find(value=>value!==undefined&&value!==null&&String(value).trim());
    if(structured!==undefined)return String(structured);
    return (String(row?.note||'').match(/Recorrência automática\s*•\s*([^\s•]+)/i)||[])[1]||'';
  };
  const startOf=(year,month)=>month?`${year}-${String(month).padStart(2,'0')}-01`:`${year}-01-01`;
  const endOf=(year,month)=>month
    ?new Date(Date.UTC(year,month,0)).toISOString().slice(0,10)
    :`${year}-12-31`;

  function ruleMatches(rule,filters={}){
    if(filters.status==='active'&&rule.active===false)return false;
    if(filters.status==='paused'&&rule.active!==false)return false;
    if(filters.type&&typeOf(rule)!==filters.type)return false;
    if(filters.category&&String(rule.category||'')!==String(filters.category))return false;
    return true;
  }

  function materializedForRule(rows,rule){
    return (Array.isArray(rows)?rows:[]).filter(row=>sourceId(row)===String(rule.id??rule.recurring_series_id??''));
  }

  function projectedOccurrences(rule,transactions,period){
    if(rule.active===false)return [];
    try{
      return projection.projectRecurringOccurrences(rule,{
        horizonStart:startOf(period.year,period.month),horizonEnd:endOf(period.year,period.month),
        now:period.now,materializedOccurrences:transactions
      });
    }catch(error){return Object.freeze({error:error.message,items:[]})}
  }

  function recurringView(rules,transactions,options={}){
    const period=Object.freeze({year:Number(options.year),month:options.mode==='year'?null:Number(options.month),now:options.now});
    const filters=options.filters||{};
    const rows=[];
    const warnings=[];
    for(const rule of (Array.isArray(rules)?rules:[]).filter(item=>ruleMatches(item,filters))){
      const materialized=materializedForRule(transactions,rule).filter(item=>{
        const date=finance.financialDate(item);return date>=startOf(period.year,period.month)&&date<=endOf(period.year,period.month);
      });
      const projectedResult=projectedOccurrences(rule,transactions,period);
      const projected=Array.isArray(projectedResult)?projectedResult:[];
      if(!Array.isArray(projectedResult))warnings.push(`${rule.id}:${projectedResult.error}`);
      const realized=money(materialized.filter(item=>finance.temporalState(item,period.now).state==='efetivado').reduce((sum,item)=>sum+Number(item.amount||0),0));
      const scheduled=money(materialized.filter(item=>finance.temporalState(item,period.now).state==='previsto_materializado').reduce((sum,item)=>sum+Number(item.amount||0),0));
      const projectedTotal=money(projected.reduce((sum,item)=>sum+Number(item.amount||0),0));
      rows.push(Object.freeze({
        rule:Object.freeze({...rule}),realized,scheduled,projected:projectedTotal,forecast:money(scheduled+projectedTotal),
        expected:money(realized+scheduled+projectedTotal),materializedCount:materialized.length,projectedCount:projected.length
      }));
    }
    const sum=field=>money(rows.reduce((total,row)=>total+Number(row[field]||0),0));
    const income=rows.filter(row=>typeOf(row.rule)==='receita');
    const outflows=rows.filter(row=>['despesa','investimento'].includes(typeOf(row.rule)));
    return Object.freeze({
      period,rows:Object.freeze(rows),warnings:Object.freeze(warnings),
      counts:Object.freeze({total:rows.length,active:rows.filter(row=>row.rule.active!==false).length,paused:rows.filter(row=>row.rule.active===false).length}),
      totals:Object.freeze({realized:sum('realized'),scheduled:sum('scheduled'),projected:sum('projected'),forecast:sum('forecast'),expected:sum('expected'),incomeExpected:money(income.reduce((sum,row)=>sum+row.expected,0)),outflowExpected:money(outflows.reduce((sum,row)=>sum+row.expected,0))})
    });
  }

  return Object.freeze({ruleMatches,recurringView});
});
