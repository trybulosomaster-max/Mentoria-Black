'use strict';
(function(){
  const adapter=globalThis.MBCommercialAdminServerAdapter;
  if(!adapter)return;
  const controller=globalThis.MBCommercialAdmin.createAdminPanelController(adapter);
  const find=document.getElementById('find'),grant=document.getElementById('grant'),status=document.getElementById('status'),grants=document.querySelector('.grants');
  document.querySelectorAll('button[disabled]').forEach(button=>button.disabled=false);
  const show=message=>{status.textContent=message};
  async function renderGrants(userId){
    const rows=await controller.listGrants(userId);grants.textContent='';
    if(!rows?.length){grants.textContent='Nenhum grant encontrado.';return}
    for(const row of rows){const item=document.createElement('div'),label=document.createElement('span'),button=document.createElement('button');label.textContent=`${row.productCode} • ${row.accessType} • ${row.status}`;button.type='button';button.textContent='Revogar';button.onclick=async()=>{const reason=prompt('Motivo da revogação:')?.trim();if(!reason)return;await controller.revokeAccess(row.grantId,reason);await renderGrants(userId)};item.append(label,button);grants.append(item)}
  }
  find.onsubmit=async event=>{event.preventDefault();try{const user=await controller.findUser(new FormData(find).get('identifier'));if(!user?.id)throw new Error('Usuário não encontrado');grant.elements.target.value=user.id;await renderGrants(user.id);show('Usuário localizado pelo backend autorizado.')}catch(error){show(error.message)}};
  grant.onsubmit=async event=>{event.preventDefault();try{const data=new FormData(grant),product=data.get('product'),products=product==='BOTH'?['APP','KNOWLEDGE']:[product];await controller.grantAccess({targetUserId:data.get('target'),products,accessType:data.get('type'),expiresAt:data.get('expires')||null,reason:data.get('reason')});await renderGrants(data.get('target'));show('Grant registrado pelo backend autorizado.')}catch(error){show(error.message)}};
})();
