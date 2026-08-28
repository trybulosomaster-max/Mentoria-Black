(function(root,factory){
  const api=typeof module==='object'&&module.exports
    ?factory(require('./financial-core'),require('./recurrence-projection'))
    :factory(root?.MBCanonicalFinance,root?.MBRecurrenceProjection);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MBCardsV2=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(finance,recurrence){
  'use strict';

  if(!finance||!recurrence)throw new Error('Canonical finance and recurrence dependencies are required');

  const money=value=>Math.round((Number(value)||0)*100)/100;
  const cardId=row=>row?.card_id??row?.cardId??null;
  const transactionType=row=>String(row?.transaction_type??row?.type??'').trim().toLowerCase();
  const isCardOutflow=row=>Boolean(cardId(row))&&['despesa','investimento'].includes(transactionType(row));
  const monthKey=(year,month)=>`${Number(year)}-${String(Number(month)).padStart(2,'0')}`;
  const invoiceStates=Object.freeze(Object.fromEntries(
    ['OPEN','CLOSED','DUE','PARTIALLY_PAID','PAID','OVERDUE'].map(state=>[state,'BACKEND_REQUIRED'])
  ));
  const billingContracts=Object.freeze({
    gate:'REVIEW_REQUIRED',
    invoiceMembership:'DERIVED_FROM_TRANSACTION_DATE',
    invoiceBalance:'PENDENTE_DE_CONTRATO',
    invoiceLifecycle:'PERSISTED_INVOICE_REQUIRED',
    invoicePayment:'CARD_PAYMENT_CONTRACT_REQUIRED',
    availableLimit:'BACKEND_REQUIRED',
    installmentSeries:'STRUCTURED_INSTALLMENT_SERIES_REQUIRED',
    cardReversal:'CARD_REVERSAL_CONTRACT_REQUIRED',
    invoiceStates
  });
  const monthEnd=(year,month)=>new Date(Date.UTC(Number(year),Number(month),0)).toISOString().slice(0,10);
  const nextMonth=(year,month,offset=1)=>{
    const date=new Date(Date.UTC(Number(year),Number(month)-1+Number(offset),1));
    return {year:date.getUTCFullYear(),month:date.getUTCMonth()+1,key:monthKey(date.getUTCFullYear(),date.getUTCMonth()+1)};
  };
  const periodMatches=(row,year,month)=>{
    const date=finance.financialDate(row);return Boolean(date)&&Number(date.slice(0,4))===Number(year)&&Number(date.slice(5,7))===Number(month);
  };

  function parseInstallment(row){
    const note=String(row?.note||'');
    const match=note.match(/Parcelado\s+(\d+)\/(\d+)\s*•\s*Compra\s+(\d{4}-\d{2}(?:-\d{2})?)/i);
    if(!match)return null;
    const current=Number(match[1]),total=Number(match[2]);
    if(!Number.isInteger(current)||!Number.isInteger(total)||current<1||total<current)return null;
    return Object.freeze({current,total,remaining:Math.max(0,total-current),purchaseDate:match[3]});
  }

  function installmentSeriesKey(row){
    const structured=row?.installment_series_id??row?.installmentSeriesId;
    if(structured)return `structured:${structured}`;
    const part=parseInstallment(row);
    if(!part)return '';
    return ['legacy',cardId(row),part.purchaseDate,part.total,String(row?.description||'').trim().toLocaleLowerCase('pt-BR')].join('|');
  }

  function stateOf(row,now){return finance.temporalState(row,now).state}
  function validMaterialized(rows,now){
    return (Array.isArray(rows)?rows:[]).filter(isCardOutflow).filter(row=>{
      const state=stateOf(row,now);
      return state!=='cancelado'&&state!=='nao_classificado';
    });
  }

  function projectedForPeriod(rules,materialized,{year,month,now}){
    const horizonStart=`${monthKey(year,month)}-01`,horizonEnd=monthEnd(year,month);
    const projected=[];
    for(const rule of Array.isArray(rules)?rules:[]){
      if(!isCardOutflow(rule)||rule.active===false)continue;
      try{
        for(const item of recurrence.projectRecurringOccurrences(rule,{horizonStart,horizonEnd,now,materializedOccurrences:materialized})){
          projected.push(Object.freeze({
            id:item.key,card_id:cardId(rule),transaction_type:transactionType(rule),category:rule.category||null,
            subcategory:rule.subcategory||null,description:rule.name||'Recorrência',amount:item.amount,
            transaction_date:item.occurrenceDate,status:'projetado',state:'projetado_virtual',source_rule_id:item.sourceRuleId
          }));
        }
      }catch(_error){/* A regra inválida continua responsabilidade do contrato de recorrência. */}
    }
    return projected;
  }

  function summarize(items,now){
    const result={realized:0,scheduled:0,projected:0,expected:0};
    for(const row of items){
      const amount=money(row.amount);
      if(row.state==='projetado_virtual')result.projected+=amount;
      else if(stateOf(row,now)==='efetivado')result.realized+=amount;
      else result.scheduled+=amount;
    }
    result.realized=money(result.realized);result.scheduled=money(result.scheduled);result.projected=money(result.projected);
    result.expected=money(result.realized+result.scheduled+result.projected);
    return Object.freeze(result);
  }

  function futureCommitments(rows,card,period,now){
    const after=monthEnd(period.year,period.month);
    const future=validMaterialized(rows,now).filter(row=>cardId(row)===card.id&&finance.financialDate(row)>after);
    const series=new Map();
    for(const row of future){
      const key=installmentSeriesKey(row);if(!key)continue;
      const current=series.get(key)||{amount:0,count:0,lastDate:'',nextDate:'',description:row.description||'Compra parcelada'};
      current.amount=money(current.amount+Number(row.amount||0));current.count+=1;
      const date=finance.financialDate(row);if(!current.nextDate||date<current.nextDate)current.nextDate=date;if(date>current.lastDate)current.lastDate=date;
      series.set(key,current);
    }
    return Object.freeze({
      total:money(future.reduce((sum,row)=>sum+Number(row.amount||0),0)),
      count:future.length,
      nextDate:future.map(finance.financialDate).filter(Boolean).sort()[0]||null,
      lastDate:future.map(finance.financialDate).filter(Boolean).sort().at(-1)||null,
      installmentSeries:Object.freeze([...series.values()].map(Object.freeze))
    });
  }

  function cardPeriodView(cards,transactions,rules,options={}){
    const year=Number(options.year),month=Number(options.month),now=options.now;
    finance.temporalState({status:'cancelado'},now);
    const materialized=validMaterialized(transactions,now);
    const periodMaterialized=materialized.filter(row=>periodMatches(row,year,month));
    const projected=projectedForPeriod(rules,transactions,{year,month,now});
    const previous=nextMonth(year,month,-1);
    const previousMaterialized=materialized.filter(row=>periodMatches(row,previous.year,previous.month));
    const previousProjected=projectedForPeriod(rules,transactions,{year:previous.year,month:previous.month,now});
    const rows=(Array.isArray(cards)?cards:[]).map(card=>{
      const items=[...periodMaterialized.filter(row=>cardId(row)===card.id),...projected.filter(row=>cardId(row)===card.id)];
      const totals=summarize(items,now);
      const previousTotals=summarize([
        ...previousMaterialized.filter(row=>cardId(row)===card.id),
        ...previousProjected.filter(row=>cardId(row)===card.id)
      ],now);
      const limit=Number(card.limit??card.limit_amount);
      const limitKnown=Number.isFinite(limit)&&limit>0;
      const delta=money(totals.expected-previousTotals.expected);
      return Object.freeze({
        card:Object.freeze({...card}),items:Object.freeze(items),totals,previous:previousTotals,
        delta,deltaPercent:previousTotals.expected?delta/previousTotals.expected*100:null,
        limit:limitKnown?money(limit):null,limitKnown,
        future:futureCommitments(transactions,card,{year,month},now)
      });
    });
    const total=(field)=>money(rows.reduce((sum,row)=>sum+Number(row.totals[field]||0),0));
    return Object.freeze({
      period:Object.freeze({year,month,key:monthKey(year,month)}),rows:Object.freeze(rows),
      totals:Object.freeze({realized:total('realized'),scheduled:total('scheduled'),projected:total('projected'),expected:total('expected')}),
      totalRegisteredLimit:money(rows.filter(row=>row.limitKnown).reduce((sum,row)=>sum+row.limit,0)),
      registeredLimitCards:rows.filter(row=>row.limitKnown).length,
      contracts:billingContracts
    });
  }

  return Object.freeze({monthKey,nextMonth,parseInstallment,installmentSeriesKey,cardPeriodView,billingContracts});
});
