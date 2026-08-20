(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MBStructuredRecurringV82=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const aliases=Object.freeze({
    receita:'receita',income:'receita',revenue:'receita',
    despesa:'despesa',expense:'despesa',
    investimento:'investimento',investment:'investimento',
    transferencia:'transferencia','transferência':'transferencia',transfer:'transferencia',
    resgate:'resgate',rescue:'resgate',withdrawal:'resgate'
  });

  function normalizeType(value){return aliases[String(value||'').trim().toLowerCase()]||null}
  function cleanId(value){const id=String(value||'').trim();return id||null}

  function validateRecurring(draft){
    const type=normalizeType(draft?.type),errors=[];
    const source=cleanId(draft?.source_account_id),destination=cleanId(draft?.destination_account_id),asset=cleanId(draft?.asset_id);
    if(!type)errors.push('tipo financeiro válido');
    if(type==='investimento'){
      if(!source)errors.push('conta de origem');
      if(!asset)errors.push('ativo de destino');
    }
    if(type==='transferencia'){
      if(!source)errors.push('conta de origem');
      if(!destination)errors.push('conta de destino');
      if(source&&destination&&source===destination)errors.push('contas de origem e destino diferentes');
    }
    if(type==='resgate'){
      if(!asset)errors.push('ativo de origem');
      if(!destination)errors.push('conta de destino');
    }
    return Object.freeze({valid:errors.length===0,type,errors:Object.freeze(errors)});
  }

  function canonicalLinks(draft){
    const validation=validateRecurring(draft);
    if(!validation.valid)throw new TypeError(validation.errors.join(', '));
    const source=cleanId(draft?.source_account_id),destination=cleanId(draft?.destination_account_id),asset=cleanId(draft?.asset_id);
    const links={source_account_id:null,destination_account_id:null,asset_id:null};
    if(validation.type==='investimento'){links.source_account_id=source;links.asset_id=asset}
    if(validation.type==='transferencia'){links.source_account_id=source;links.destination_account_id=destination}
    if(validation.type==='resgate'){links.destination_account_id=destination;links.asset_id=asset}
    return Object.freeze(links);
  }

  function legacyAccountAlias(type,links,accountId){
    const normalized=normalizeType(type);
    if(normalized==='investimento'||normalized==='transferencia')return links.source_account_id;
    if(normalized==='resgate')return links.destination_account_id;
    return cleanId(accountId);
  }

  function occurrenceKey(row){
    const series=cleanId(row?.recurring_series_id),date=String(row?.recurring_occurrence_date||'').trim();
    return series&&/^\d{4}-\d{2}-\d{2}$/.test(date)?`${series}|${date}`:null;
  }

  return Object.freeze({normalizeType,validateRecurring,canonicalLinks,legacyAccountAlias,occurrenceKey});
});
