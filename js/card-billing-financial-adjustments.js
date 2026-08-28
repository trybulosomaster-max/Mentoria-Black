(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MBCardBillingFinancialAdjustmentsV1=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';

const ENTRY_KINDS=Object.freeze({purchase_credit:-1,credit_reversal:1});

function dateOnly(value){
  const raw=String(value??'').trim(),match=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match)return '';
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?raw:'';
}

function cents(value){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value==='string'&&!/^(?:\d+\.?\d*|\.\d+)$/.test(value.trim()))return null;
  const number=Number(value);
  if(!Number.isFinite(number)||number<=0)return null;
  const rounded=Math.round(number*100);
  return rounded>0&&Math.abs(number-rounded/100)<1e-8?rounded:null;
}

function identifier(value){
  return value===null||value===undefined||value===''?'':String(value);
}

function categoryOf(row){
  return String(row?.category??'').trim()||'Sem categoria';
}

function warningIdentity(row,index){
  return identifier(row?.credit_entry_id??row?.id??row?.operation_id)||String(index);
}

function normalizeCardPurchaseCreditEffects(rows,options={}){
  if(!Array.isArray(rows))throw new TypeError('card purchase credit effects must be an array');
  const now=dateOnly(options.now),warnings=[],adjustments=[],entryIds=new Set(),operationIds=new Set();
  if(!now){
    warnings.push('invalid_card_credit_reference_date');
    return Object.freeze({adjustments:Object.freeze([]),warnings:Object.freeze(warnings),excludedCount:rows.length});
  }

  rows.forEach((row,index)=>{
    const identity=warningIdentity(row,index),entryId=identifier(row?.credit_entry_id??row?.id),operationId=identifier(row?.operation_id);
    if(!entryId&&!operationId){warnings.push(`missing_card_credit_identity:${identity}`);return}
    if((entryId&&entryIds.has(entryId))||(operationId&&operationIds.has(operationId))){warnings.push(`duplicate_card_credit_effect:${identity}`);return}

    const entryKind=String(row?.entry_kind??'').trim();
    if(!Object.prototype.hasOwnProperty.call(ENTRY_KINDS,entryKind)){warnings.push(`invalid_card_credit_entry_kind:${identity}`);return}
    const amountCents=cents(row?.amount);
    if(amountCents===null){warnings.push(`invalid_card_credit_amount:${identity}`);return}
    const effectiveDate=dateOnly(row?.effective_date);
    if(!effectiveDate){warnings.push(`invalid_card_credit_effective_date:${identity}`);return}
    if(effectiveDate>now){warnings.push(`future_card_credit_effect:${identity}`);return}

    const expectedDeltaCents=ENTRY_KINDS[entryKind]*amountCents;
    if(row?.consumption_expense_delta!==undefined&&row?.consumption_expense_delta!==null&&row?.consumption_expense_delta!==''){
      const supplied=Number(row.consumption_expense_delta);
      if(!Number.isFinite(supplied)||Math.round(supplied*100)!==expectedDeltaCents||Math.abs(supplied-expectedDeltaCents/100)>=1e-8){
        warnings.push(`card_credit_delta_mismatch:${identity}`);return;
      }
    }

    if(entryId)entryIds.add(entryId);
    if(operationId)operationIds.add(operationId);
    adjustments.push(Object.freeze({
      id:entryId||operationId,
      entryId:entryId||null,
      operationId:operationId||null,
      transactionId:identifier(row?.transaction_id)||null,
      userId:identifier(row?.user_id)||null,
      cardId:identifier(row?.card_id)||null,
      billingCycleId:identifier(row?.billing_cycle_id)||null,
      entryKind,
      effectiveDate,
      amount:amountCents/100,
      consumptionDelta:expectedDeltaCents/100,
      category:categoryOf(row),
      subcategory:String(row?.subcategory??'').trim()||null,
      kind:'card_purchase_credit_adjustment',
      readOnly:true
    }));
  });

  return Object.freeze({
    adjustments:Object.freeze(adjustments),
    warnings:Object.freeze(warnings),
    excludedCount:rows.length-adjustments.length
  });
}

return Object.freeze({normalizeCardPurchaseCreditEffects});
});
