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
  const dateOnly=value=>{const match=String(value??'').match(/^(\d{4}-\d{2}-\d{2})/);return match?match[1]:''};
  const numericOrNull=value=>{
    if(value===null||value===undefined||value==='')return null;
    const number=Number(value);return Number.isFinite(number)?money(number):null;
  };
  const fold=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLocaleLowerCase('pt-BR');
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
    const structuredCurrent=Number(row?.installment_number??row?.installmentNumber);
    const structuredTotal=Number(row?.installment_total??row?.installmentTotal);
    if(Number.isInteger(structuredCurrent)&&Number.isInteger(structuredTotal)&&structuredCurrent>=1&&structuredTotal>=structuredCurrent){
      return Object.freeze({
        current:structuredCurrent,total:structuredTotal,remaining:Math.max(0,structuredTotal-structuredCurrent),
        purchaseDate:dateOnly(row?.purchase_date??row?.purchaseDate)||null
      });
    }
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
  function billingTransactionState(row){
    const status=finance.canonicalStatus(row).status;
    if(status==='realizado')return Object.freeze({status,label:'Realizado',included:true,knownCommitment:true,eligible:true,liquidatable:true});
    if(status==='programado')return Object.freeze({status,label:'Programado',included:true,knownCommitment:true,eligible:false,liquidatable:false});
    if(status==='cancelado')return Object.freeze({status,label:'Cancelado',included:false,knownCommitment:false,eligible:false,liquidatable:false});
    return Object.freeze({status:'nao_classificado',label:null,included:false,knownCommitment:false,eligible:false,liquidatable:false});
  }
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

  const settlementLabels=Object.freeze({
    open:'Em aberto',partially_paid:'Parcialmente paga',settled:'Quitada',
    CREDIT_BALANCE_REVIEW_REQUIRED:'Saldo credor requer revisão'
  });

  function normalizeBillingSummary(row){
    const normalizedCardId=cardId(row),cycleId=row?.cycle_id??row?.cycleId??row?.id??null;
    if(!normalizedCardId||!cycleId)return null;
    const result={
      cardId:normalizedCardId,cycleId,
      cycleKey:dateOnly(row?.cycle_key??row?.cycleKey)||null,
      closingDate:dateOnly(row?.closing_date??row?.closingDate)||null,
      dueDate:dateOnly(row?.due_date??row?.dueDate)||null
    };
    for(const [target,...sources] of [
      ['purchaseAmount','purchase_amount','purchaseAmount'],['creditedAmount','credited_amount','creditedAmount'],
      ['paidAmount','paid_amount','paidAmount'],['outstandingAmount','outstanding_amount','outstandingAmount'],
      ['creditBalance','credit_balance','creditBalance']
    ]){
      const value=numericOrNull(sources.map(source=>row?.[source]).find(source=>source!==undefined));
      if(value!==null)result[target]=value;
    }
    const review=row?.credit_balance_review_required??row?.creditBalanceReviewRequired;
    if(review!==null&&review!==undefined)result.creditBalanceReviewRequired=review===true;
    const state=String(row?.settlement_state??row?.settlementState??'').trim();
    if(state){result.settlementState=state;if(settlementLabels[state])result.stateLabel=settlementLabels[state]}
    return Object.freeze(result);
  }

  function normalizeManagedLimit(row){
    const normalizedCardId=cardId(row);if(!normalizedCardId)return null;
    const result={cardId:normalizedCardId};
    for(const [target,...sources] of [
      ['configuredLimit','configured_limit','configuredLimit'],['managedUsedLimit','managed_used_limit','managedUsedLimit'],
      ['managedAvailableLimit','managed_available_limit','managedAvailableLimit']
    ]){
      const value=numericOrNull(sources.map(source=>row?.[source]).find(source=>source!==undefined));
      if(value!==null)result[target]=value;
    }
    const metric=String(row?.metric_contract??row?.metricContract??'').trim();if(metric)result.metricContract=metric;
    const coverage=String(row?.coverage_state??row?.coverageState??'').trim();if(coverage)result.coverageState=coverage;
    const notice=String(row?.limitation_notice??row?.limitationNotice??'').trim();if(notice)result.limitationNotice=notice;
    for(const [target,...sources] of [
      ['relevantPurchaseCount','relevant_purchase_count','relevantPurchaseCount'],
      ['structuredPurchaseCount','structured_purchase_count','structuredPurchaseCount']
    ]){
      const raw=sources.map(source=>row?.[source]).find(source=>source!==undefined);
      const value=raw===null||raw===''||raw===undefined?NaN:Number(raw);
      if(Number.isInteger(value)&&value>=0)result[target]=value;
    }
    return Object.freeze(result);
  }

  function normalizeAccountPosition(row){
    const accountId=row?.account_id??row?.accountId??row?.id??null;if(!accountId)return null;
    const result={accountId};
    const normalizedCardId=cardId(row);if(normalizedCardId)result.cardId=normalizedCardId;
    const cycleId=row?.billing_cycle_id??row?.billingCycleId??row?.cycle_id??row?.cycleId;if(cycleId)result.cycleId=cycleId;
    const name=String(row?.account_name??row?.accountName??row?.name??'').trim();if(name)result.name=name;
    const institution=String(row?.institution??'').trim();if(institution)result.institution=institution;
    const balance=numericOrNull(row?.projected_balance??row?.projectedBalance??row?.available_balance??row?.availableBalance??row?.statement_balance??row?.statementBalance??row?.opening_balance??row?.openingBalance??row?.balance);
    if(balance!==null)result.balance=balance;
    const balanceAsOf=dateOnly(row?.balance_as_of??row?.balanceAsOf);if(balanceAsOf)result.balanceAsOf=balanceAsOf;
    return Object.freeze(result);
  }

  function ingestBillingData(input={}){
    const normalize=(rows,adapter)=>Object.freeze((Array.isArray(rows)?rows:[]).map(adapter).filter(Boolean));
    return Object.freeze({
      summaries:normalize(input.summaries??input.billingSummaries,normalizeBillingSummary),
      managedLimits:normalize(input.managedLimits??input.managed_limits,normalizeManagedLimit),
      accountPositions:normalize(input.accountPositions??input.account_positions,normalizeAccountPosition)
    });
  }

  function cyclesForCard(summaries,selectedCardId,period={}){
    const key=period.key||monthKey(period.year,period.month);
    if(!selectedCardId||!/^[0-9]{4}-[0-9]{2}$/.test(String(key)))return Object.freeze([]);
    return Object.freeze((Array.isArray(summaries)?summaries:[])
      .map(row=>row?.cardId&&row?.cycleId?row:normalizeBillingSummary(row)).filter(Boolean)
      .filter(row=>String(row.cardId)===String(selectedCardId)&&String(row.cycleKey||'').slice(0,7)===key)
      .sort((a,b)=>String(b.dueDate||'').localeCompare(String(a.dueDate||''))||String(a.cycleId).localeCompare(String(b.cycleId))));
  }

  function selectedCycleForCard(summaries,selectedCardId,period={}){
    const normalized=cyclesForCard(summaries,selectedCardId,period);
    const requested=period.cycleId??period.selectedCycleId;
    if(requested){
      const selected=normalized.find(cycle=>String(cycle.cycleId)===String(requested));
      if(selected)return selected;
    }
    return normalized[0]||null;
  }

  function searchMatches(row,query,cardNames){
    const q=fold(query);if(!q)return true;
    const id=cardId(row),cardName=cardNames.get(String(id))||'';
    return fold([
      row?.name,row?.description,row?.establishment,row?.establishment_name,row?.merchant,row?.merchant_name,
      row?.category,row?.subcategory,cardName
    ].filter(Boolean).join(' ')).includes(q);
  }

  function groupTransactionsByMonthDay(rows,options={}){
    const cardNames=new Map((Array.isArray(options.cards)?options.cards:[]).map(card=>[String(card.id),String(card.name||'')]));
    const included=(Array.isArray(rows)?rows:[]).filter(row=>isCardOutflow(row)&&billingTransactionState(row).included&&Boolean(finance.financialDate(row)));
    const sourceTotal=money(included.reduce((sum,row)=>sum+Number(row.amount||0),0));
    const visible=included.filter(row=>searchMatches(row,options.query,cardNames));
    const months=new Map();
    for(const row of visible){
      const financialDate=finance.financialDate(row);if(!financialDate)continue;
      const purchaseDate=dateOnly(row.purchase_date??row.purchaseDate)||financialDate;
      // A fatura continua organizada pela competência canônica. purchase_date é
      // contexto da compra, nunca a chave temporal do agrupamento financeiro.
      const mKey=financialDate.slice(0,7),dayKey=financialDate;
      const month=months.get(mKey)||{key:mKey,total:0,days:new Map(),legacyCount:0};
      const day=month.days.get(dayKey)||{date:dayKey,total:0,items:[]};
      const installment=parseInstallment(row),billingState=billingTransactionState(row),structured=Boolean(row?.card_billing_cycle_id??row?.cardBillingCycleId);
      const item=Object.freeze({
        transaction:Object.freeze({...row}),purchaseDate,financialDate,cardName:cardNames.get(String(cardId(row)))||null,
        installment,billingState,membership:structured?'structured':'legacy',legacyFallback:!structured
      });
      day.items.push(item);day.total=money(day.total+Number(row.amount||0));month.total=money(month.total+Number(row.amount||0));
      if(!structured)month.legacyCount+=1;
      month.days.set(dayKey,day);months.set(mKey,month);
    }
    const groups=[...months.values()].sort((a,b)=>b.key.localeCompare(a.key)).map(month=>Object.freeze({
      key:month.key,total:month.total,legacyFallback:month.legacyCount>0,
      fallbackLabel:month.legacyCount>0?'Competência legada — ciclo não estruturado':null,
      days:Object.freeze([...month.days.values()].sort((a,b)=>b.date.localeCompare(a.date)).map(day=>Object.freeze({
        date:day.date,total:day.total,items:Object.freeze(day.items.sort((a,b)=>String(b.financialDate).localeCompare(String(a.financialDate))||String(a.transaction.id||'').localeCompare(String(b.transaction.id||''))))
      })))
    }));
    const visibleTotal=money(groups.reduce((sum,month)=>sum+month.total,0));
    return Object.freeze({
      total:sourceTotal,count:included.length,visibleTotal,visibleCount:visible.length,
      groups:Object.freeze(groups),query:String(options.query??'')
    });
  }

  function joinCardBillingData(cards,transactions,sources={},options={}){
    const ingested=ingestBillingData(sources),period=Object.freeze({year:Number(options.year),month:Number(options.month),key:options.key||monthKey(options.year,options.month)});
    const allTransactions=Array.isArray(transactions)?transactions:[];
    const rows=(Array.isArray(cards)?cards:[]).map(card=>{
      const summaries=ingested.summaries.filter(summary=>String(summary.cardId)===String(card.id));
      const cycles=cyclesForCard(summaries,card.id,period);
      const selectedCycle=selectedCycleForCard(summaries,card.id,{...period,cycleId:options.cycleIds?.[String(card.id)]??options.cycleIds?.[card.id]});
      const periodRows=allTransactions.filter(row=>String(cardId(row))===String(card.id)&&periodMatches(row,period.year,period.month));
      const selectedRows=selectedCycle
        ?periodRows.filter(row=>{
          const linked=row?.card_billing_cycle_id??row?.cardBillingCycleId;
          return !linked||String(linked)===String(selectedCycle.cycleId);
        })
        :periodRows;
      const groups=groupTransactionsByMonthDay(selectedRows,{query:options.query,cards});
      const managedLimit=ingested.managedLimits.find(limit=>String(limit.cardId)===String(card.id))||null;
      const accountPositions=ingested.accountPositions.filter(position=>
        (!position.cardId||String(position.cardId)===String(card.id))&&
        (!position.cycleId||(selectedCycle&&String(position.cycleId)===String(selectedCycle.cycleId)))
      );
      const legacyCount=selectedRows.filter(row=>!(row?.card_billing_cycle_id??row?.cardBillingCycleId)&&billingTransactionState(row).included).length;
      return Object.freeze({
        card:Object.freeze({...card}),summaries:Object.freeze(summaries),cycles,selectedCycle,managedLimit,
        accountPositions:Object.freeze(accountPositions),groups,
        mode:selectedCycle?'structured':'legacy',
        legacyFallback:(!selectedCycle||legacyCount)?Object.freeze({reason:selectedCycle?'UNLINKED_ROWS_IN_PERIOD':'NO_PERSISTED_CYCLE',count:legacyCount,label:'Competência legada — ciclo não estruturado'}):null
      });
    });
    return Object.freeze({period,rows:Object.freeze(rows),sources:ingested});
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

  return Object.freeze({
    monthKey,nextMonth,parseInstallment,installmentSeriesKey,cardPeriodView,billingContracts,
    billingTransactionState,normalizeBillingSummary,normalizeManagedLimit,normalizeAccountPosition,
    ingestBillingData,ingestBillingSources:ingestBillingData,cyclesForCard,selectedCycleForCard,
    groupTransactionsByMonthDay,joinCardBillingData
  });
});
