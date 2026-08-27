(function(root,factory){
  const api=typeof module==='object'&&module.exports
    ?factory(require('./planning-integration'))
    :factory(root?.MBPlanningV82);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MBDashboardFinancialV82=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(planning){
  'use strict';

  if(!planning)throw new Error('Canonical planning dependency unavailable');

  function effect(bucket){return bucket.income-bucket.totalOut}

  function mapBucket(bucket){
    return Object.freeze({
      income:Number(bucket?.income||0),
      consumptionExpense:Object.values(bucket?.consumptionByCategory||{}).reduce((sum,value)=>sum+Number(value||0),0),
      investment:Number(bucket?.investment||0),
      availableBalanceEffect:effect(bucket||{income:0,totalOut:0})
    });
  }

  function combineFinancialBuckets(realized,forecast){
    return Object.freeze({
      income:Number(realized?.income||0)+Number(forecast?.income||0),
      consumptionExpense:Number(realized?.consumptionExpense||0)+Number(forecast?.consumptionExpense||0),
      investment:Number(realized?.investment||0)+Number(forecast?.investment||0),
      availableBalanceEffect:Number(realized?.availableBalanceEffect||0)+Number(forecast?.availableBalanceEffect||0)
    });
  }

  function combineCategoryBuckets(realized,forecast){
    const expected={...realized};
    for(const [category,amount] of Object.entries(forecast||{})){
      expected[category]=Number(expected[category]||0)+Number(amount||0);
    }
    return Object.freeze(expected);
  }

  function projectDashboardPeriod(transactions,rules,options={}){
    const period=planning.projectPlanningPeriod(null,transactions,rules,options);
    const realized=mapBucket(period.realized);
    const scheduled=mapBucket(period.scheduledMaterialized);
    const projected=mapBucket(period.projectedVirtual);
    const forecast=mapBucket(period.forecast);
    const expected=combineFinancialBuckets(realized,forecast);
    const byCategory=Object.freeze({
      realized:Object.freeze({...period.realized.consumptionByCategory}),
      scheduled:Object.freeze({...period.scheduledMaterialized.consumptionByCategory}),
      projected:Object.freeze({...period.projectedVirtual.consumptionByCategory}),
      forecast:Object.freeze({...period.forecast.consumptionByCategory}),
      expected:combineCategoryBuckets(period.realized.consumptionByCategory,period.forecast.consumptionByCategory)
    });
    return Object.freeze({
      realized:Object.freeze({...realized,availableBalance:realized.availableBalanceEffect}),
      scheduled,
      projected,
      forecast,
      expected,
      transfers:period.transfers,
      rescues:period.rescues,
      unclassified:period.unclassified,
      warnings:period.warnings,
      byCategory
    });
  }

  return Object.freeze({projectDashboardPeriod,combineFinancialBuckets});
});
