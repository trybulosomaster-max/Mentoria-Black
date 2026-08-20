(function(root,factory){
  const core=typeof module==='object'&&module.exports?require('./financial-core'):root.MBCanonicalFinance;
  const api=factory(core);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MBAccountsNetWorthV82=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(core){
'use strict';

if(!core||typeof core.financialEffect!=='function')throw new Error('MBCanonicalFinance is required');

const cents=value=>{
  if(value===null||value===undefined||value==='')return null;
  if(typeof value==='string'&&!/^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim()))return null;
  const number=Number(value);
  return Number.isFinite(number)?Math.round(number*100):null;
};
const money=value=>value===null?null:value/100;
const id=value=>value===undefined||value===null||value===''?null:String(value);
const cloneRows=rows=>{
  if(!Array.isArray(rows))throw new TypeError('entity collections must be arrays');
  return rows.map(row=>({...row}));
};
const uniqueWarnings=warnings=>[...new Set(warnings)];

function indexRows(rows,label){
  const map=new Map(),warnings=[];
  for(const row of rows){
    const key=id(row?.id);
    if(!key){warnings.push(`missing_${label}_id`);continue}
    if(map.has(key))warnings.push(`duplicate_${label}_id:${key}`);
    else map.set(key,row);
  }
  return {map,warnings};
}

function entityExists(collection,entityId){return !!entityId&&collection.has(String(entityId))}

function validation(effect,warnings){
  return Object.freeze({valid:effect.valid!==false&&warnings.length===0,type:effect.type,temporalState:effect.temporalState,warnings:uniqueWarnings(warnings),effect});
}

function validateTransfer(tx,context={}){
  const effect=core.financialEffect(tx,{now:context.now}),accounts=indexRows(context.accounts||[],'account').map;
  const warnings=[...effect.warnings];
  if(effect.type!=='transferencia')warnings.push('not_transfer');
  if(effect.sourceAccountId&&!entityExists(accounts,effect.sourceAccountId))warnings.push('unknown_source_account');
  if(effect.destinationAccountId&&!entityExists(accounts,effect.destinationAccountId))warnings.push('unknown_destination_account');
  return validation(effect,warnings);
}

function validateInvestment(tx,context={}){
  const effect=core.financialEffect(tx,{now:context.now}),accounts=indexRows(context.accounts||[],'account').map,assets=indexRows(context.assets||[],'asset').map;
  const warnings=[...effect.warnings];
  if(effect.type!=='investimento')warnings.push('not_investment');
  if(!effect.sourceAccountId)warnings.push('missing_source_account');
  else if(!entityExists(accounts,effect.sourceAccountId))warnings.push('unknown_source_account');
  if(!effect.assetId)warnings.push('missing_asset_destination');
  else if(!entityExists(assets,effect.assetId))warnings.push('unknown_asset_destination');
  return validation(effect,warnings);
}

function validateRescue(tx,context={}){
  const effect=core.financialEffect(tx,{now:context.now}),accounts=indexRows(context.accounts||[],'account').map,assets=indexRows(context.assets||[],'asset').map;
  const warnings=[...effect.warnings];
  if(effect.type!=='resgate')warnings.push('not_rescue');
  if(!effect.destinationAccountId)warnings.push('missing_destination_account');
  else if(!entityExists(accounts,effect.destinationAccountId))warnings.push('unknown_destination_account');
  if(!effect.assetId)warnings.push('missing_asset_source');
  else if(!entityExists(assets,effect.assetId))warnings.push('unknown_asset_source');
  return validation(effect,warnings);
}

function buildState(accounts,assets,liabilities,options){
  const warnings=[];
  const accountRows=cloneRows(accounts),assetRows=cloneRows(assets),liabilityRows=cloneRows(liabilities);
  const accountField=options.accountBaseField||'opening_balance',assetField=options.assetBaseField||'opening_value',liabilityField=options.liabilityBaseField||'balance';
  const normalize=(rows,field,label,projectedField)=>rows.map(row=>{
    const base=cents(row?.[field]);
    if(base===null)warnings.push(`missing_${label}_base:${id(row?.id)||'unknown'}`);
    return {...row,baseField:field,baseValue:money(base),movementDelta:0,adjustmentDelta:0,[projectedField]:money(base)};
  });
  const normalizedAccounts=normalize(accountRows,accountField,'account','projectedBalance');
  const normalizedAssets=normalize(assetRows,assetField,'asset','projectedValue');
  const normalizedLiabilities=normalize(liabilityRows,liabilityField,'liability','projectedBalance');
  return {accounts:normalizedAccounts,assets:normalizedAssets,liabilities:normalizedLiabilities,warnings};
}

function updateEntity(rows,entityId,projectedField,delta,reverse){
  const key=id(entityId),deltaCents=cents(delta);
  if(!key||deltaCents===null)return false;
  const row=rows.find(item=>id(item.id)===key);
  if(!row||row[projectedField]===null)return false;
  const signed=reverse?-deltaCents:deltaCents;
  row.movementDelta=money(cents(row.movementDelta)+signed);
  row[projectedField]=money(cents(row[projectedField])+signed);
  return true;
}

function applyCanonicalMovement(snapshot,tx,options={}){
  const state={accounts:cloneRows(snapshot.accounts||[]),assets:cloneRows(snapshot.assets||[]),liabilities:cloneRows(snapshot.liabilities||[]),warnings:[...(snapshot.warnings||[])]};
  const effect=core.financialEffect(tx,{now:options.now}),context={now:options.now,accounts:state.accounts,assets:state.assets};
  if(effect.temporalState!=='efetivado')return {...state,applied:false,effect,warnings:uniqueWarnings([...state.warnings,...effect.warnings])};

  let checked=validation(effect,[...effect.warnings.filter(warning=>!['missing_destination_account','missing_source_account'].includes(warning))]);
  if(effect.type==='transferencia')checked=validateTransfer(tx,context);
  else if(effect.type==='investimento')checked=validateInvestment(tx,context);
  else if(effect.type==='resgate')checked=validateRescue(tx,context);
  else if(effect.type==='receita'){
    const exists=entityExists(indexRows(state.accounts,'account').map,effect.destinationAccountId);
    checked=validation(effect,[...effect.warnings,...(!effect.destinationAccountId?['missing_destination_account']:exists?[]:['unknown_destination_account'])]);
  }else if(effect.type==='despesa'){
    const exists=entityExists(indexRows(state.accounts,'account').map,effect.sourceAccountId);
    checked=validation(effect,[...effect.warnings,...(!effect.sourceAccountId?['missing_source_account']:exists?[]:['unknown_source_account'])]);
  }
  if(!checked.valid)return {...state,applied:false,effect,warnings:uniqueWarnings([...state.warnings,...checked.warnings])};

  const reverse=options.reverse===true;
  let complete=true;
  if(effect.sourceAccountDelta)complete=updateEntity(state.accounts,effect.sourceAccountId,'projectedBalance',effect.sourceAccountDelta,reverse)&&complete;
  if(effect.destinationAccountDelta)complete=updateEntity(state.accounts,effect.destinationAccountId,'projectedBalance',effect.destinationAccountDelta,reverse)&&complete;
  if(effect.assetDelta)complete=updateEntity(state.assets,effect.assetId,'projectedValue',effect.assetDelta,reverse)&&complete;
  if(!complete)return {...snapshot,accounts:cloneRows(snapshot.accounts||[]),assets:cloneRows(snapshot.assets||[]),liabilities:cloneRows(snapshot.liabilities||[]),applied:false,effect,warnings:uniqueWarnings([...(snapshot.warnings||[]),'missing_reconstructible_base'])};
  return {...state,applied:true,effect,warnings:uniqueWarnings([...state.warnings,...effect.warnings])};
}

function applyAdjustment(state,adjustment){
  const type=String(adjustment?.entityType||''),key=id(adjustment?.entityId),amount=cents(adjustment?.amount),direction=adjustment?.direction;
  const warnings=[];
  if(!['account','asset','liability'].includes(type))warnings.push('invalid_adjustment_entity_type');
  if(!key)warnings.push('missing_adjustment_entity_id');
  if(amount===null||amount<=0)warnings.push('invalid_adjustment_amount');
  if(!['increase','decrease'].includes(direction))warnings.push('invalid_adjustment_direction');
  if(warnings.length)return {state,applied:false,warnings};
  const rows=type==='account'?state.accounts:type==='asset'?state.assets:state.liabilities;
  const field=type==='asset'?'projectedValue':'projectedBalance',row=rows.find(item=>id(item.id)===key);
  if(!row)return {state,applied:false,warnings:['unknown_adjustment_entity']};
  if(row[field]===null)return {state,applied:false,warnings:['missing_reconstructible_base']};
  const delta=direction==='increase'?amount:-amount;
  row.adjustmentDelta=money(cents(row.adjustmentDelta)+delta);
  row[field]=money(cents(row[field])+delta);
  return {state,applied:true,warnings:[]};
}

function projectNetWorth(input,options={}){
  const accounts=cloneRows(input?.accounts||[]),assets=cloneRows(input?.assets||[]),liabilities=cloneRows(input?.liabilities||[]),warnings=[];
  const accountField=options.accountValueField||'projectedBalance',assetField=options.assetValueField||'projectedValue',liabilityField=options.liabilityValueField||'projectedBalance';
  const entries=[];
  const add=(rows,kind,field,sign)=>rows.forEach(row=>{
    const value=cents(row?.[field]);
    if(value===null){warnings.push(`missing_${kind}_value:${id(row?.id)||'unknown'}`);return}
    entries.push({kind,id:id(row?.id),resourceId:id(row?.resource_id),value,sign});
  });
  add(accounts,'account',accountField,1);add(assets,'asset',assetField,1);add(liabilities,'liability',liabilityField,-1);
  const resources=new Map();
  for(const entry of entries.filter(item=>item.sign>0&&item.resourceId)){
    if(resources.has(entry.resourceId))warnings.push(`duplicate_resource:${entry.resourceId}`);
    else resources.set(entry.resourceId,entry);
  }
  const duplicates=warnings.filter(warning=>warning.startsWith('duplicate_resource:'));
  let counted=entries;
  if(duplicates.length&&options.duplicateResourcePolicy==='prefer_asset'){
    const seen=new Set();
    counted=entries.filter(entry=>{
      if(entry.sign<0||!entry.resourceId)return true;
      const same=entries.filter(item=>item.sign>0&&item.resourceId===entry.resourceId);
      const preferred=same.find(item=>item.kind==='asset')||same[0];
      if(entry!==preferred||seen.has(entry.resourceId))return false;
      seen.add(entry.resourceId);return true;
    });
  }else if(duplicates.length&&options.duplicateResourcePolicy==='prefer_account'){
    const seen=new Set();
    counted=entries.filter(entry=>{
      if(entry.sign<0||!entry.resourceId)return true;
      const same=entries.filter(item=>item.sign>0&&item.resourceId===entry.resourceId);
      const preferred=same.find(item=>item.kind==='account')||same[0];
      if(entry!==preferred||seen.has(entry.resourceId))return false;
      seen.add(entry.resourceId);return true;
    });
  }
  const raw=entries.reduce((sum,entry)=>sum+entry.value*entry.sign,0),total=counted.reduce((sum,entry)=>sum+entry.value*entry.sign,0);
  const valid=!warnings.some(warning=>warning.startsWith('missing_'))&&(!duplicates.length||['prefer_asset','prefer_account'].includes(options.duplicateResourcePolicy));
  return {netWorth:valid?money(total):null,rawNetWorth:money(raw),valid,warnings:uniqueWarnings(warnings),totals:{accounts:money(entries.filter(x=>x.kind==='account').reduce((s,x)=>s+x.value,0)),assets:money(entries.filter(x=>x.kind==='asset').reduce((s,x)=>s+x.value,0)),liabilities:money(entries.filter(x=>x.kind==='liability').reduce((s,x)=>s+x.value,0))}};
}

function projectAccountBalances(accounts,transactions,options={}){
  if(!Array.isArray(transactions))throw new TypeError('transactions must be an array');
  let state=buildState(accounts,options.assets||[],options.liabilities||[],options),applied=0,skipped=0;
  for(const tx of transactions){
    const result=applyCanonicalMovement(state,tx,{now:options.now});
    state={accounts:result.accounts,assets:result.assets,liabilities:result.liabilities,warnings:uniqueWarnings(result.warnings)};
    if(result.applied)applied++;else skipped++;
  }
  let adjustmentsApplied=0;
  for(const adjustment of options.adjustments||[]){
    const result=applyAdjustment(state,adjustment);
    state=result.state;state.warnings=uniqueWarnings([...state.warnings,...result.warnings]);
    if(result.applied)adjustmentsApplied++;
  }
  const netWorth=projectNetWorth(state);
  return {...state,appliedMovements:applied,skippedMovements:skipped,adjustmentsApplied,netWorth};
}

function legacyNetWorth(accounts,assets,liabilities){
  const sum=(rows,field)=>rows.reduce((total,row)=>total+(cents(row?.[field])||0),0);
  const accountTotal=accounts.reduce((total,row)=>total+(cents(row?.statement_balance??row?.opening_balance)||0),0);
  return money(accountTotal+sum(assets,'current_value')-sum(liabilities,'balance'));
}

return Object.freeze({projectAccountBalances,projectNetWorth,applyCanonicalMovement,validateTransfer,validateInvestment,validateRescue,legacyNetWorth});
});
