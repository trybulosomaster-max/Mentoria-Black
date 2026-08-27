(function(root,factory){
  const contract=root?.AVAdminAccessContract||(typeof require==='function'?require('../commercial/admin-access-contract'):null);
  const presentation=root?.AVAdminPresentation||(typeof require==='function'?require('../commercial/admin-presentation'):null);
  const api=factory(contract,presentation);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AVAdminArea=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(contract,presentation){
  'use strict';
  if(!contract||!presentation)throw new Error('AVIORA administrative presentation is unavailable');

  const SECTION_LABELS=Object.freeze({overview:'Visão Geral',users:'Usuários e Licenças',staff:'Funcionários',audit:'Auditoria'});
  const DRILLDOWN_LABELS=Object.freeze({
    accounts:'Contas cadastradas',active_clients:'Clientes ativos',monthly:'Licenças mensais',annual:'Licenças anuais',
    lifetime:'Licenças vitalícias',trial_active:'Trials ativos',origin:'Licenças por origem',expiring_30_days:'Expiram em 30 dias'
  });
  const PERMISSION_LABELS=Object.freeze({
    'users.read':'Consultar usuários',
    'users.password_recovery':'Enviar recuperação de senha',
    'users.sessions_revoke':'Revogar sessões de terceiros (reservado V2)',
    'licenses.read':'Consultar licenças',
    'licenses.grant':'Conceder licenças',
    'licenses.revoke':'Revogar licenças',
    'audit.read':'Consultar auditoria',
    'staff.read':'Consultar funcionários',
    'staff.manage':'Gerenciar funcionários'
  });

  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
  function formatDate(value){
    if(!value)return '—';
    const date=new Date(value);
    return Number.isFinite(date.getTime())?date.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
  }
  function statusLabel(value){return presentation.statusLabel(value)}
  function kindLabel(value){return presentation.kindLabel(value)}
  function productLabel(value){return presentation.productLabel(value)}
  function permissionLabel(value){return PERMISSION_LABELS[value]||value}
  function actorLabel(value){
    const source=value&&typeof value==='object'?value:{};
    const name=source.actor_name||source.actorName||source.granted_by_name||source.grantedByName||'',email=source.actor_email||source.actorEmail||source.granted_by_email||source.grantedByEmail||'',id=source.actor_user_id||source.actorUserId||source.granted_by_user_id||source.grantedByUserId||'',role=source.actor_role||source.actorRole||source.granted_by_role||source.grantedByRole||'';
    const identity=email||id||'Administrador',parts=[];
    if(name&&name!==identity)parts.push(name);
    parts.push(identity);
    if(role)parts.push(presentation.roleLabel(role));
    return parts.join(' — ');
  }
  function dateInputValue(value,subtractDay=false){
    const date=new Date(value||'');if(!Number.isFinite(date.getTime()))return '';
    if(subtractDay)date.setUTCDate(date.getUTCDate()-1);
    return date.toISOString().slice(0,10);
  }
  function managementCardDestination(filter){
    const key=String(filter||'');
    if(key==='manual_activity')return Object.freeze({section:'overview',view:'manual'});
    if(contract.MANAGEMENT_FILTERS.includes(key))return Object.freeze({section:'users',filter:key,origin:key==='origin'?'manual':null});
    return null;
  }
  function pageState(kind,message){
    const label=kind==='loading'?'Carregando…':kind==='empty'?'Nenhum resultado encontrado.':message||'Não foi possível carregar a Administração.';
    const role=kind==='loading'?'status':'alert';
    return `<div class="admin-page-state admin-page-state-${escapeHtml(kind)}" role="${role}"><strong>${escapeHtml(label)}</strong>${kind==='loading'?'<span class="admin-spinner" aria-hidden="true"></span>':''}</div>`;
  }
  function errorState(error){
    const status=Number(error?.status)||500;
    if(status===401)return pageState('error','Sua sessão expirou. Faça login novamente.');
    if(status===403)return pageState('error','Você não possui permissão para esta área.');
    return pageState('error',presentation.safeErrorMessage(error));
  }
  function normalizeRows(value){
    if(Array.isArray(value))return value;
    if(Array.isArray(value?.items))return value.items;
    if(Array.isArray(value?.users))return value.users;
    if(Array.isArray(value?.staff))return value.staff;
    if(Array.isArray(value?.events))return value.events;
    return [];
  }
  function permissionCheckboxes(selected=[]){
    const current=new Set(selected);
    return contract.STAFF_ASSIGNABLE.map(key=>`<label class="admin-permission-option"><input type="checkbox" name="permissions" value="${escapeHtml(key)}" ${current.has(key)?'checked':''}><span><b>${escapeHtml(permissionLabel(key))}</b></span></label>`).join('');
  }
  function renderTrace(label,trace){
    if(!trace)return '';
    return `<div class="admin-grant-trace"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(actorLabel(trace))}</span><time>${escapeHtml(formatDate(trace.at))}</time><p>${escapeHtml(trace.reason||'Motivo não informado')}</p></div>`;
  }
  function renderAccess(access,context,user){
    const entry=contract.normalizeAccess(access),alreadyRevoked=String(entry.state||'').toLowerCase()==='revoked';
    const canRevoke=!alreadyRevoked&&entry.adminManaged&&entry.grantId&&contract.canManageCustomerLicense(context,user,'licenses.revoke');
    return `<article class="admin-access-row">
      <div><strong>${escapeHtml(productLabel(entry.productCode))}</strong><span class="tag ${entry.hasAccess?'ok':''}">${escapeHtml(statusLabel(entry.state))}</span></div>
      <dl><div><dt>Tipo</dt><dd>${escapeHtml(kindLabel(entry.licenseKind||entry.accessType))}</dd></div><div><dt>Expiração</dt><dd>${escapeHtml(formatDate(entry.expiresAt))}</dd></div><div><dt>Origem</dt><dd>${escapeHtml(kindLabel(entry.originClass||entry.source||'—'))}</dd></div></dl>
      ${entry.adminManaged?`<div class="admin-grant-history">${renderTrace('Concedido por',entry.granted)}${renderTrace('Revogado por',entry.revoked)}</div>`:''}
      ${canRevoke?`<button class="btn danger" type="button" data-admin-action="revoke" data-user-id="${escapeHtml(user.id)}" data-grant-id="${escapeHtml(entry.grantId)}" data-product="${escapeHtml(entry.productCode)}">Revogar esta licença</button>`:''}
    </article>`;
  }
  function renderUserCard(raw,context){
    const user=contract.normalizeUser(raw),canGrant=contract.canManageCustomerLicense(context,user,'licenses.grant'),canRecover=contract.canRequestPasswordRecovery(context,user),canResetPassword=contract.canDirectResetPassword(context,user);
    const canAddStaff=context.role==='OWNER'&&!user.adminRole&&user.id!==context.userId;
    const activeAccess=user.access.filter(entry=>['active','grace_period'].includes(String(entry.state||'').toLowerCase()));
    const historicalAccess=user.access.filter(entry=>!activeAccess.includes(entry));
    const activeHtml=activeAccess.length?activeAccess.map(entry=>renderAccess(entry,context,user)).join(''):'<div class="admin-empty-inline">Nenhum acesso ativo retornado.</div>';
    const historyHtml=historicalAccess.length?`<details class="admin-access-history"><summary>Mostrar histórico (${historicalAccess.length})</summary><div class="admin-access-history-list">${historicalAccess.map(entry=>renderAccess(entry,context,user)).join('')}</div></details>`:'';
    const accesses=activeHtml+historyHtml;
    const trialState=user.trial?.state||user.trial?.status||'não iniciado';
    return `<article class="admin-user-card" data-admin-user="${escapeHtml(user.id)}">
      <header><div><h3>${escapeHtml(user.name||'Usuário sem nome')}</h3><p>${escapeHtml(user.email||'E-mail indisponível')}</p></div>${user.adminRole?`<span class="tag warn">${escapeHtml(presentation.roleLabel(user.adminRole))}</span>`:''}</header>
      <div class="admin-id">ID: <code>${escapeHtml(user.id)}</code></div>
      <div class="admin-trial"><span>Trial</span><strong>${escapeHtml(statusLabel(trialState))}</strong></div>
      <div class="admin-access-list">${accesses}</div>
      <footer class="actions">
        ${canGrant?`<button class="btn primary" type="button" data-admin-action="grant" data-user-id="${escapeHtml(user.id)}">Conceder licença</button>`:''}
        ${canRecover?`<button class="btn" type="button" data-admin-action="password-recovery" data-user-id="${escapeHtml(user.id)}">Enviar recuperação de senha</button>`:''}
        ${canResetPassword?`<button class="btn danger" type="button" data-admin-action="password-reset-direct" data-user-id="${escapeHtml(user.id)}">Redefinir senha do usuário</button>`:''}
        ${canAddStaff?`<button class="btn" type="button" data-admin-action="staff-add" data-user-id="${escapeHtml(user.id)}">Adicionar como funcionário</button>`:''}
      </footer>
    </article>`;
  }
  function renderUsers(model){
    const canSearch=contract.canSearchUsers(model.context),canRead=contract.hasPermission(model.context,'licenses.read');
    if(!canSearch&&!canRead&&!contract.hasPermission(model.context,'licenses.grant')&&!contract.hasPermission(model.context,'licenses.revoke'))return pageState('error','Você não possui permissão para consultar usuários ou licenças.');
    const drilldown=model.users.filter?DRILLDOWN_LABELS[model.users.filter]||'Detalhes gerenciais':null;
    let content='<div class="admin-empty-inline">Localize um usuário por nome ou e-mail. A pesquisa exige ao menos 3 caracteres.</div>';
    if(model.users.phase==='loading')content=pageState('loading');
    else if(model.users.phase==='error')content=errorState(model.users.error);
    else if(model.users.phase==='ready')content=model.users.items.length?`<div class="admin-user-grid">${model.users.items.map(user=>renderUserCard(user,model.context)).join('')}</div>`:pageState('empty');
    const originToggle=model.users.filter==='origin'?`<div class="admin-origin-toggle" role="group" aria-label="Origem da licença"><button class="btn ${model.users.origin==='manual'?'active':''}" type="button" data-admin-origin="manual">Manual</button><button class="btn ${model.users.origin==='commercial'?'active':''}" type="button" data-admin-origin="commercial">Comercial</button></div>`:'';
    const searchForm=drilldown?'':`<form class="admin-search" data-admin-form="user-search"><label for="adminUserSearch">Nome ou e-mail</label><div><input id="adminUserSearch" name="query" type="search" minlength="3" maxlength="120" autocomplete="off" required value="${escapeHtml(model.users.query||'')}" placeholder="Digite pelo menos 3 caracteres"><button class="btn primary" ${canSearch?'':'disabled'}>Pesquisar</button></div></form>`;
    const loadMore=drilldown&&model.users.nextCursor?'<button class="btn admin-load-more" type="button" data-admin-action="drilldown-more">Carregar mais</button>':'';
    return `<section class="admin-section" aria-labelledby="admin-users-title">
      <div class="admin-section-head"><div><h2 id="admin-users-title">${escapeHtml(drilldown||'Usuários e Licenças')}</h2><p>${drilldown?'Filtro gerencial aplicado no servidor; resultados paginados e sem duplicar usuários.':'Consulte acessos e administre somente licenças criadas pela camada AVIORA.'}</p></div>${drilldown?'<button class="btn" type="button" data-admin-action="overview-back">← Voltar para Visão Geral</button>':''}</div>
      ${originToggle}${searchForm}<div class="admin-results" aria-live="polite">${content}</div>${loadMore}
    </section>`;
  }
  function normalizeStaff(raw){
    const source=raw&&typeof raw==='object'?raw:{};
    return Object.freeze({
      id:String(source.user_id||source.userId||source.id||''),name:String(source.name||source.display_name||''),email:String(source.email||''),
      role:String(source.role||'STAFF').toUpperCase(),status:String(source.status||'disabled').toLowerCase(),permissions:contract.normalizePermissions(source.permissions),
      lastAccess:source.last_admin_access_at||source.lastAccess||null,createdAt:source.created_at||source.createdAt||null
    });
  }
  function renderStaffCard(raw){
    const staff=normalizeStaff(raw),permissionTags=staff.permissions.length?staff.permissions.map(key=>`<span class="tag">${escapeHtml(permissionLabel(key))}</span>`).join(''):'<span class="muted">Sem permissões atribuídas</span>';
    return `<article class="admin-staff-card" data-admin-staff="${escapeHtml(staff.id)}">
      <header><div><h3>${escapeHtml(staff.name||'Funcionário')}</h3><p>${escapeHtml(staff.email||staff.id)}</p></div><span class="tag ${staff.status==='active'?'ok':'warn'}">${escapeHtml(statusLabel(staff.status))}</span></header>
      <dl><div><dt>Papel</dt><dd>${escapeHtml(presentation.roleLabel(staff.role))}</dd></div><div><dt>Último acesso</dt><dd>${escapeHtml(formatDate(staff.lastAccess))}</dd></div><div><dt>Criado em</dt><dd>${escapeHtml(formatDate(staff.createdAt))}</dd></div></dl>
      <div class="admin-permission-tags">${permissionTags}</div>
      <footer class="actions"><button class="btn" type="button" data-admin-action="staff-permissions" data-user-id="${escapeHtml(staff.id)}">Editar permissões</button><button class="btn ${staff.status==='active'?'danger':'primary'}" type="button" data-admin-action="staff-status" data-user-id="${escapeHtml(staff.id)}" data-status="${staff.status==='active'?'disabled':'active'}">${staff.status==='active'?'Desativar':'Ativar'}</button></footer>
    </article>`;
  }
  function renderStaff(model){
    if(model.context.role!=='OWNER')return pageState('error','Gestão de funcionários é exclusiva do Proprietário.');
    let content=model.staff.phase==='loading'?pageState('loading'):model.staff.phase==='error'?errorState(model.staff.error):model.staff.phase==='ready'?(model.staff.items.length?`<div class="admin-staff-grid">${model.staff.items.map(renderStaffCard).join('')}</div>`:pageState('empty')):'<div class="admin-empty-inline">Carregando funcionários…</div>';
    return `<section class="admin-section" aria-labelledby="admin-staff-title"><div class="admin-section-head"><div><h2 id="admin-staff-title">Funcionários</h2><p>Ative, desative e atribua permissões sem apagar usuários ou histórico.</p></div><button class="btn primary" type="button" data-admin-action="staff-add-empty">Adicionar funcionário</button></div><div aria-live="polite">${content}</div></section>`;
  }
  function normalizeAudit(raw){const value=raw&&typeof raw==='object'?raw:{},actor=actorLabel(value),targetName=value.target_name||'',targetIdentity=value.target_email||value.target_user_id||'',target=[targetName,targetIdentity].filter((item,index,list)=>item&&list.indexOf(item)===index).join(' — ')||'—';return {id:value.id||'',at:value.created_at||value.createdAt,actor:actor==='Administrador'?'Automação AVIORA':actor,target,action:value.action||'—',product:value.product_code||'—',result:value.result||'—',reason:value.reason||'—'}}
  function renderAuditCard(raw){const item=normalizeAudit(raw);return `<article class="admin-audit-card"><header><time>${escapeHtml(formatDate(item.at))}</time><span class="tag ${item.result==='succeeded'?'ok':item.result==='denied'||item.result==='failed'?'warn':''}">${escapeHtml(statusLabel(item.result))}</span></header><h3>${escapeHtml(presentation.actionLabel(item.action))}</h3><p class="admin-technical-code">Código técnico: <code>${escapeHtml(item.action)}</code></p><dl><div><dt>Ator</dt><dd>${escapeHtml(item.actor)}</dd></div><div><dt>Alvo</dt><dd>${escapeHtml(item.target)}</dd></div><div><dt>Produto</dt><dd>${escapeHtml(productLabel(item.product))}</dd></div><div><dt>Motivo</dt><dd>${escapeHtml(item.reason)}</dd></div></dl></article>`}
  function renderAudit(model){
    if(!contract.hasPermission(model.context,'audit.read'))return pageState('error','Você não possui permissão para consultar auditoria.');
    const content=model.audit.phase==='loading'?pageState('loading'):model.audit.phase==='error'?errorState(model.audit.error):model.audit.phase==='ready'?(model.audit.items.length?`<div class="admin-audit-grid">${model.audit.items.map(renderAuditCard).join('')}</div>`:pageState('empty')):'<div class="admin-empty-inline">Carregando auditoria…</div>';
    return `<section class="admin-section" aria-labelledby="admin-audit-title"><div class="admin-section-head"><div><h2 id="admin-audit-title">Auditoria</h2><p>Histórico imutável das ações administrativas e seus resultados.</p></div></div><div aria-live="polite">${content}</div></section>`;
  }
  function renderManagementMetric(title,value,caption,filter,link='Ver detalhes →'){return `<button class="admin-management-metric" type="button" data-admin-management-card="${escapeHtml(filter)}" aria-label="${escapeHtml(`${title}: ${value}. ${link}`)}"><span>${escapeHtml(title)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(caption)}</small><em>${escapeHtml(link)}</em></button>`}
  function renderManualManagement(normalized){
    const actors=normalized.manualByActor.length?normalized.manualByActor.map(item=>`<article class="admin-management-actor"><header><strong>${escapeHtml(actorLabel(item))}</strong><span class="tag ${String(item.actor_status||'').toLowerCase()==='disabled'?'warn':'ok'}">${escapeHtml(statusLabel(item.actor_status||'active'))}</span></header><p>${escapeHtml(Number(item.grants)||0)} concessões no período</p><div><span>Mensal ${escapeHtml(Number(item.monthly)||0)}</span><span>Anual ${escapeHtml(Number(item.annual)||0)}</span><span>Vitalícia ${escapeHtml(Number(item.lifetime)||0)}</span></div></article>`).join(''):'<div class="admin-empty-inline">Nenhuma concessão manual no período.</div>';
    const activity=normalized.manualActivity.length?normalized.manualActivity.map(item=>{
      const target=item.target_name||item.target_email||item.target_user_id||'Alvo indisponível',revoked=item.revoked_at?`<div class="admin-management-revoked"><b>Revogado por</b> ${escapeHtml(actorLabel({actor_name:item.revoked_by_name,actor_email:item.revoked_by_email,actor_user_id:item.revoked_by_user_id,actor_role:item.revoked_by_role}))} · ${escapeHtml(formatDate(item.revoked_at))}<p>${escapeHtml(item.revoked_reason||'Motivo não informado')}</p></div>`:'';
      return `<article class="admin-management-activity"><header><div><strong>${escapeHtml(productLabel(item.product_code))} · ${escapeHtml(kindLabel(item.license_kind))}</strong><p>${escapeHtml(target)}</p></div><span class="tag ${String(item.current_status||'').toLowerCase()==='active'?'ok':'warn'}">${escapeHtml(statusLabel(item.current_status))}</span></header><dl><div><dt>Concedido por</dt><dd>${escapeHtml(actorLabel(item))}</dd></div><div><dt>Data</dt><dd>${escapeHtml(formatDate(item.granted_at))}</dd></div><div><dt>Motivo</dt><dd>${escapeHtml(item.granted_reason||'—')}</dd></div></dl>${revoked}</article>`;
    }).join(''):'<div class="admin-empty-inline">Nenhuma atividade manual no período.</div>';
    return `<section class="admin-management-detail" aria-labelledby="admin-manual-title"><div class="admin-section-head"><div><h2 id="admin-manual-title">Concessões manuais</h2><p>Visão por Proprietário ou Funcionário, sem ranking competitivo.</p></div><button class="btn" type="button" data-admin-action="overview-back">← Voltar para Visão Geral</button></div><form class="admin-management-filter" data-admin-form="management-filter"><label>De <input type="date" name="periodStart" value="${escapeHtml(dateInputValue(normalized.period.start))}"></label><label>Até <input type="date" name="periodEnd" value="${escapeHtml(dateInputValue(normalized.period.end,true))}"></label><button class="btn" type="submit">Atualizar</button></form><div class="admin-management-actors">${actors}</div><div class="admin-management-activity-list">${activity}</div></section>`;
  }
  function renderManagement(model){
    const context=contract.normalizeContext(model.context);
    if(context.role!=='OWNER')return '';
    const management=model.management||{phase:'idle',data:null,error:null},normalized=contract.normalizeManagementDashboard(management.data),metrics=normalized.metrics;
    let body=management.phase==='loading'||management.phase==='idle'?pageState('loading'):management.phase==='error'?errorState(management.error):'';
    if(management.phase==='ready'){
      const origin=metrics.manualCommercial,expiring=metrics.expiring30Days;
      if(model.managementView==='manual')body=renderManualManagement(normalized);
      else{
      const manualCount=normalized.manualByActor.reduce((total,item)=>total+(Number(item.grants)||0),0);
      const cards=[
        renderManagementMetric('Contas cadastradas',metrics.accounts,'contas do sistema; podem incluir administrativas','accounts','Ver contas →'),
        renderManagementMetric('Clientes ativos',metrics.activeClients,'clientes únicos; Aplicativo + Conhecimento contam uma vez','active_clients','Ver clientes →'),
        renderManagementMetric('Mensal',metrics.monthlyLicenses,'licenças ativas com duração canônica','monthly','Ver licenças →'),
        renderManagementMetric('Anual',metrics.annualLicenses,'licenças ativas com duração canônica','annual','Ver licenças →'),
        renderManagementMetric('Vitalício',metrics.lifetimeLicenses,'licenças ativas sem expiração','lifetime','Ver licenças →'),
        renderManagementMetric('Trial ativo',metrics.trialActive,'clientes únicos com trial efetivo','trial_active','Ver clientes →'),
        renderManagementMetric('Manual / Comercial',`${origin.manual} / ${origin.commercial}`,`origens verificadas${origin.unknown?` · ${origin.unknown} não classificadas`:''}`,'origin','Ver por origem →'),
        renderManagementMetric('Expiram em 30 dias',expiring.grants,`${expiring.users} clientes únicos · licenças ativas`,'expiring_30_days','Ver detalhes →'),
        renderManagementMetric('Concessões manuais',manualCount,'nos últimos 30 dias','manual_activity','Ver por funcionário →')
      ].join('');
      body=`<div class="admin-management-grid">${cards}</div><div class="admin-management-origin-note">Manual exige proveniência AVIORA; Comercial exige integração reconhecida. Trial permanece separado e fontes desconhecidas não são inferidas.</div>`;
      }
    }
    return `<section class="admin-management" aria-labelledby="admin-management-title"><div class="admin-section-head"><div><h2 id="admin-management-title">Visão Geral</h2><p>Métricas globais exclusivas do Proprietário, calculadas no servidor sem duplicar usuários.</p></div></div><div aria-live="polite">${body}</div></section>`;
  }
  function dialogFrame(title,body,submitLabel='Confirmar',danger=false,pending=false){return `<div class="admin-dialog-backdrop" data-admin-dialog-backdrop><section class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title"><header><h2 id="admin-dialog-title">${escapeHtml(title)}</h2><button class="btn" type="button" data-admin-action="dialog-close" aria-label="Fechar" ${pending?'disabled':''}>Fechar</button></header>${body}<footer><button class="btn" type="button" data-admin-action="dialog-close" ${pending?'disabled':''}>Cancelar</button><button class="btn ${danger?'danger':'primary'}" type="submit" form="adminDialogForm" ${pending?'disabled aria-busy="true"':''}>${escapeHtml(pending?'Processando…':submitLabel)}</button></footer></section></div>`}
  function renderDialog(model){
    const dialog=model.dialog;if(!dialog)return '';
    if(dialog.kind==='grant'){
      const products=new Set(dialog.operation?.products||['APP']),allowedKinds=contract.grantLicenseKinds(model.context),requestedKind=dialog.operation?.licenseKind||'annual',kind=allowedKinds.includes(requestedKind)?requestedKind:(allowedKinds.includes('annual')?'annual':allowedKinds[0]),reason=dialog.operation?.reason||'';
      const kindOptions=allowedKinds.map(value=>`<option value="${escapeHtml(value)}" ${kind===value?'selected':''}>${escapeHtml(kindLabel(value))}</option>`).join('');
      return dialogFrame('Conceder licença',`<form id="adminDialogForm" data-admin-dialog-form="grant"><input type="hidden" name="targetUserId" value="${escapeHtml(dialog.user.id)}"><div class="notice"><b>${escapeHtml(dialog.user.name||dialog.user.email||dialog.user.id)}</b><br>${escapeHtml(dialog.user.email||dialog.user.id)}</div><fieldset><legend>Produtos</legend><label class="admin-check"><input type="checkbox" name="products" value="APP" ${products.has('APP')?'checked':''}> Aplicativo</label><label class="admin-check"><input type="checkbox" name="products" value="KNOWLEDGE" ${products.has('KNOWLEDGE')?'checked':''}> Conhecimento</label></fieldset><div class="field"><label for="adminLicenseKind">Tipo</label><select id="adminLicenseKind" name="licenseKind">${kindOptions}</select></div><div class="field"><label for="adminGrantReason">Motivo obrigatório</label><textarea id="adminGrantReason" name="reason" minlength="8" maxlength="500" required>${escapeHtml(reason)}</textarea></div>${model.dialog.error?`<div class="errorbox">${escapeHtml(presentation.safeErrorMessage(model.dialog.error))}</div>`:''}</form>`,'Conceder licença',false,dialog.pending===true);
    }
    if(dialog.kind==='revoke'){
      return dialogFrame('Revogar licença administrativa',`<form id="adminDialogForm" data-admin-dialog-form="revoke"><input type="hidden" name="targetUserId" value="${escapeHtml(dialog.userId)}"><input type="hidden" name="grantId" value="${escapeHtml(dialog.grantId)}"><div class="errorbox"><b>Confirma a revogação de ${escapeHtml(productLabel(dialog.product)||'esta licença')}?</b><br>Somente a licença administrativa selecionada será atingida.</div><div class="field"><label for="adminRevokeReason">Motivo obrigatório</label><textarea id="adminRevokeReason" name="reason" minlength="8" maxlength="500" required>${escapeHtml(dialog.operation?.reason||'')}</textarea></div>${dialog.error?`<div class="errorbox">${escapeHtml(presentation.safeErrorMessage(dialog.error))}</div>`:''}</form>`,'Revogar licença',true,dialog.pending===true);
    }
    if(dialog.kind==='password-recovery'){
      return dialogFrame('Enviar recuperação de senha',`<form id="adminDialogForm" data-admin-dialog-form="password-recovery"><input type="hidden" name="targetUserId" value="${escapeHtml(dialog.user.id)}"><div class="notice"><b>${escapeHtml(dialog.user.name||dialog.user.email||dialog.user.id)}</b><br>${escapeHtml(dialog.user.email||dialog.user.id)}</div><p class="muted">O AVIORA solicitará ao serviço de autenticação um link oficial. O administrador nunca verá nem definirá a nova senha.</p><div class="field"><label for="adminRecoveryReason">Motivo obrigatório</label><textarea id="adminRecoveryReason" name="reason" minlength="8" maxlength="500" required>${escapeHtml(dialog.operation?.reason||'')}</textarea></div>${dialog.error?`<div class="errorbox">${escapeHtml(presentation.safeErrorMessage(dialog.error))}</div>`:''}</form>`,'Enviar recuperação',false,dialog.pending===true);
    }
    if(dialog.kind==='password-reset-direct'){
      return dialogFrame('Redefinir senha do usuário',`<form id="adminDialogForm" data-admin-dialog-form="password-reset-direct" autocomplete="off"><input type="hidden" name="targetUserId" value="${escapeHtml(dialog.user.id)}"><div class="errorbox"><b>Use apenas em situação excepcional de suporte.</b><br>A senha atual não será exibida.</div><div class="notice"><b>${escapeHtml(dialog.user.name||dialog.user.email||dialog.user.id)}</b><br>${escapeHtml(dialog.user.email||dialog.user.id)}</div><div class="field"><label for="adminDirectNewPassword">Nova senha</label><input id="adminDirectNewPassword" name="newPassword" type="password" autocomplete="new-password" minlength="${contract.MIN_PASSWORD_LENGTH}" maxlength="${contract.MAX_PASSWORD_LENGTH}" required aria-describedby="adminDirectPasswordHelp"></div><div class="field"><label for="adminDirectConfirmPassword">Confirmar nova senha</label><input id="adminDirectConfirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="${contract.MIN_PASSWORD_LENGTH}" maxlength="${contract.MAX_PASSWORD_LENGTH}" required></div><p id="adminDirectPasswordHelp" class="small muted">Use ${contract.MIN_PASSWORD_LENGTH}+ caracteres, com maiúscula, minúscula, número e símbolo.</p><div class="field"><label for="adminDirectResetReason">Motivo obrigatório</label><textarea id="adminDirectResetReason" name="reason" minlength="8" maxlength="500" required></textarea></div><label class="admin-check"><input type="checkbox" name="confirmDirectReset" value="confirmed" required> Confirmo que esta redefinição foi autorizada e substituirá a senha atual.</label>${dialog.error?`<div class="errorbox">${escapeHtml(presentation.safeErrorMessage(dialog.error))}</div>`:''}</form>`,'Redefinir senha',true,dialog.pending===true);
    }
    if(dialog.kind==='staff-add'){
      return dialogFrame('Adicionar funcionário',`<form id="adminDialogForm" data-admin-dialog-form="staff-add"><input type="hidden" name="targetUserId" value="${escapeHtml(dialog.user.id)}"><div class="notice"><b>${escapeHtml(dialog.user.name||dialog.user.email||dialog.user.id)}</b><br>${escapeHtml(dialog.user.email||dialog.user.id)}<br><small>Usuário localizado pelo diretório de autenticação existente.</small></div><fieldset><legend>Permissões iniciais</legend><div class="admin-permission-grid">${permissionCheckboxes(dialog.operation?.permissions||[])}</div></fieldset><div class="field"><label for="adminStaffReason">Motivo obrigatório</label><textarea id="adminStaffReason" name="reason" minlength="8" maxlength="500" required>${escapeHtml(dialog.operation?.reason||'')}</textarea></div><div class="notice">O usuário não será recriado e continuará usando a autenticação existente.</div>${dialog.error?`<div class="errorbox">${escapeHtml(presentation.safeErrorMessage(dialog.error))}</div>`:''}</form>`,'Adicionar funcionário',false,dialog.pending===true);
    }
    if(dialog.kind==='staff-permissions'){
      return dialogFrame('Editar permissões',`<form id="adminDialogForm" data-admin-dialog-form="staff-permissions"><input type="hidden" name="targetUserId" value="${escapeHtml(dialog.staff.id)}"><fieldset><legend>Permissões do funcionário</legend><div class="admin-permission-grid">${permissionCheckboxes(dialog.operation?.permissions||dialog.staff.permissions)}</div></fieldset><div class="field"><label for="adminPermissionReason">Motivo obrigatório</label><textarea id="adminPermissionReason" name="reason" minlength="8" maxlength="500" required>${escapeHtml(dialog.operation?.reason||'')}</textarea></div>${dialog.error?`<div class="errorbox">${escapeHtml(presentation.safeErrorMessage(dialog.error))}</div>`:''}</form>`,'Salvar permissões',false,dialog.pending===true);
    }
    if(dialog.kind==='staff-status'){
      const disabling=dialog.status==='disabled';
      return dialogFrame(disabling?'Desativar funcionário?':'Ativar funcionário',`<form id="adminDialogForm" data-admin-dialog-form="staff-status"><input type="hidden" name="targetUserId" value="${escapeHtml(dialog.staff.id)}"><input type="hidden" name="status" value="${escapeHtml(dialog.status)}"><div class="${disabling?'errorbox':'notice'}">${disabling?'O acesso administrativo e o acesso interno serão removidos. Usuário, histórico, trial e licenças comerciais serão preservados.':'O acesso administrativo será restabelecido com as permissões existentes.'}</div><div class="field"><label for="adminStatusReason">Motivo obrigatório</label><textarea id="adminStatusReason" name="reason" minlength="8" maxlength="500" required>${escapeHtml(dialog.operation?.reason||'')}</textarea></div>${dialog.error?`<div class="errorbox">${escapeHtml(presentation.safeErrorMessage(dialog.error))}</div>`:''}</form>`,disabling?'Desativar':'Ativar',disabling,dialog.pending===true);
    }
    return '';
  }
  function renderAdminArea(model){
    if(model.contextPhase==='loading')return `<div class="admin-area">${pageState('loading')}</div>`;
    if(model.contextPhase==='error')return `<div class="admin-area">${errorState(model.contextError)}</div>`;
    const context=contract.normalizeContext(model.context);
    if(!context.active)return `<div class="admin-area">${pageState('error','Você não possui acesso à Administração.')}</div>`;
    const sections=contract.visibleSections(context),section=sections.includes(model.section)?model.section:sections[0];
    if(!section)return `<div class="admin-area">${pageState('error','Seu perfil administrativo não possui permissões de consulta.')}</div>`;
    const tabs=sections.map(key=>`<button class="btn ${section===key?'active':''}" type="button" data-admin-section="${escapeHtml(key)}" aria-current="${section===key?'page':'false'}">${escapeHtml(SECTION_LABELS[key])}</button>`).join('');
    const body=section==='overview'?renderManagement(model):section==='users'?renderUsers(model):section==='staff'?renderStaff(model):renderAudit(model);
    return `<div class="admin-area"><div class="pagehead admin-pagehead"><div><h1>Administração</h1><p>Controle de usuários, licenças, funcionários e auditoria da AVIORA.</p></div><span class="tag ok">${escapeHtml(presentation.roleLabel(context.role))}</span></div>${model.message?`<div class="notice admin-message" role="status">${escapeHtml(model.message)}</div>`:''}<nav class="admin-tabs" aria-label="Seções da Administração">${tabs}</nav>${body}${renderDialog(model)}</div>`;
  }
  function ensureDialogRequestId(dialog,client){
    if(!dialog||typeof dialog!=='object')throw new TypeError('administrative dialog is required');
    if(!dialog.requestId)dialog.requestId=client.operationId();
    return dialog.requestId;
  }

  function createAdminArea(options={}){
    const client=options.client;if(!client)throw new TypeError('administrative API client is required');
    const documentRef=options.document||globalThis.document,notify=typeof options.notify==='function'?options.notify:()=>{};
    let root=null;
    const model={contextPhase:'idle',context:contract.normalizeContext(null),contextError:null,section:'overview',message:'',dialog:null,managementView:'cards',management:{phase:'idle',data:null,error:null},users:{phase:'idle',query:'',items:[],error:null,filter:null,origin:null,nextCursor:null},staff:{phase:'idle',items:[],error:null},audit:{phase:'idle',items:[],error:null}};
    const snapshot=()=>Object.freeze({context:model.context,contextPhase:model.contextPhase,section:model.section});
    const repaint=()=>{if(root){root.innerHTML=renderAdminArea(model);bind()}};
    const setMessage=value=>{model.message=value;notify(value,false)};
    async function loadContext({silent=false}={}){
      model.contextPhase='loading';model.contextError=null;if(!silent)repaint();
      try{
        model.context=contract.normalizeContext(await client.me());model.contextPhase='ready';
        const sections=contract.visibleSections(model.context);if(!sections.includes(model.section))model.section=sections[0]||'users';
      }catch(error){model.context=contract.normalizeContext(null);model.contextPhase=silent?'ready':'error';model.contextError=error}
      repaint();
      if(model.context.role==='OWNER'&&model.management.phase==='idle')await loadManagement();
      return snapshot();
    }
    async function loadManagement(value={}){
      if(contract.normalizeContext(model.context).role!=='OWNER')return;
      model.management.phase='loading';model.management.error=null;repaint();
      try{model.management.data=contract.normalizeManagementDashboard(await client.getManagementDashboard(value));model.management.phase='ready'}
      catch(error){model.management.error=error;model.management.phase='error'}
      repaint();
    }
    async function loadDrilldown(filter,origin=null,{append=false}={}){
      if(contract.normalizeContext(model.context).role!=='OWNER')return;
      const request={filter,limit:25,...(origin?{origin}:{}),...(append&&model.users.nextCursor?{cursor:model.users.nextCursor}:{})};
      model.users={...model.users,phase:'loading',error:null,filter,origin:origin||null,...(append?{}:{items:[],nextCursor:null})};repaint();
      try{
        const result=contract.normalizeManagementDrilldown(await client.getManagementDrilldown(request));
        model.users.items=append?[...model.users.items,...result.items]:[...result.items];
        model.users.nextCursor=result.nextCursor;model.users.phase='ready';
      }catch(error){model.users.error=error;model.users.phase='error'}
      repaint();
    }
    async function loadSection(section=model.section){
      if(section==='overview'&&model.management.phase==='idle')await loadManagement();
      if(section==='staff'&&model.staff.phase==='idle'){
        model.staff.phase='loading';repaint();
        try{model.staff.items=normalizeRows(await client.listStaff());model.staff.phase='ready'}catch(error){model.staff.error=error;model.staff.phase='error'}
      }
      if(section==='audit'&&model.audit.phase==='idle'){
        model.audit.phase='loading';repaint();
        try{model.audit.items=normalizeRows(await client.listAudit());model.audit.phase='ready'}catch(error){model.audit.error=error;model.audit.phase='error'}
      }
      repaint();
    }
    async function searchUsers(query){
      model.users.query=String(query||'').trim();model.users.filter=null;model.users.origin=null;model.users.nextCursor=null;model.users.phase='loading';model.users.error=null;repaint();
      try{
        const rows=normalizeRows(await client.searchUsers({query:model.users.query}));
        model.users.items=contract.hasPermission(model.context,'licenses.read')?await Promise.all(rows.map(async row=>{
          const user=contract.normalizeUser(row);
          return user.id?client.getLicenses(user.id):row;
        })):rows;
        model.users.phase='ready';
      }catch(error){model.users.error=error;model.users.phase='error'}
      repaint();
    }
    function findUser(id){return model.users.items.map(contract.normalizeUser).find(user=>user.id===id)||{id,name:'',email:''}}
    function findStaff(id){return model.staff.items.map(normalizeStaff).find(staff=>staff.id===id)||{id,permissions:[],status:'disabled'}}
    async function submitDialog(form){
      const fd=new FormData(form),kind=form.dataset.adminDialogForm;
      if(model.dialog?.pending)return;
      let raw=null,operation=null;
      try{
        const requestId=kind==='password-reset-direct'?client.operationId():ensureDialogRequestId(model.dialog,client);
        if(kind==='password-reset-direct'&&fd.get('confirmDirectReset')!=='confirmed')throw new TypeError('Confirme a redefinição excepcional de senha.');
        raw=kind==='grant'?{requestId,targetUserId:fd.get('targetUserId'),products:fd.getAll('products'),licenseKind:fd.get('licenseKind'),reason:fd.get('reason')}:
          kind==='revoke'?{requestId,targetUserId:fd.get('targetUserId'),grantId:fd.get('grantId'),reason:fd.get('reason')}:
          kind==='password-recovery'?{requestId,targetUserId:fd.get('targetUserId'),reason:fd.get('reason')}:
          kind==='password-reset-direct'?{requestId,targetUserId:fd.get('targetUserId'),newPassword:fd.get('newPassword'),confirmPassword:fd.get('confirmPassword'),reason:fd.get('reason')}:
          kind==='staff-status'?{requestId,targetUserId:fd.get('targetUserId'),status:fd.get('status'),reason:fd.get('reason')}:
          {requestId,targetUserId:fd.get('targetUserId'),permissions:fd.getAll('permissions'),reason:fd.get('reason')};
        operation=kind==='password-reset-direct'?contract.validateDirectPasswordResetRequest(raw):model.dialog.operation||(
          kind==='grant'?contract.validateGrantRequest(raw):
          kind==='revoke'?contract.validateRevokeRequest(raw):
          kind==='password-recovery'?contract.validatePasswordRecoveryRequest(raw):
          kind==='staff-status'?contract.validateStaffStatusRequest(raw):
          kind==='staff-add'?contract.validateStaffAddRequest(raw):contract.validateStaffPermissionsRequest(raw)
        );
        if(kind!=='password-reset-direct')model.dialog.operation=operation;
        model.dialog.pending=true;model.dialog.error=null;repaint();
        if(kind==='grant')await client.grantLicense(operation);
        else if(kind==='revoke')await client.revokeLicense(operation);
        else if(kind==='password-recovery')await client.requestPasswordRecovery(operation);
        else if(kind==='password-reset-direct')await client.resetUserPassword(operation);
        else if(kind==='staff-add')await client.addStaff(operation);
        else if(kind==='staff-permissions')await client.setStaffPermissions(operation);
        else if(kind==='staff-status')await client.setStaffStatus(operation);
        model.dialog=null;setMessage('Operação administrativa concluída e enviada para auditoria.');
        if(kind.startsWith('staff')){model.staff.phase='idle';await loadSection('staff')}
        else if(model.users.query)await searchUsers(model.users.query);
      }catch(error){model.dialog={...model.dialog,pending:false,error};repaint()}
      finally{
        raw=null;operation=null;
        for(const name of ['newPassword','confirmPassword'])if(form.elements?.[name])form.elements[name].value='';
      }
    }
    function bind(){
      if(!root?.querySelectorAll)return;
      root.querySelectorAll('[data-admin-section]').forEach(button=>button.addEventListener('click',()=>{model.section=button.dataset.adminSection;if(model.section==='overview')model.managementView='cards';model.message='';repaint();loadSection(model.section)}));
      const search=root.querySelector('[data-admin-form="user-search"]');
      if(search)search.addEventListener('submit',event=>{event.preventDefault();searchUsers(new FormData(search).get('query'))});
      root.querySelectorAll('[data-admin-management-card]').forEach(card=>card.addEventListener('click',()=>{
        const destination=managementCardDestination(card.dataset.adminManagementCard);if(!destination)return;
        if(destination.view==='manual'){model.managementView='manual';repaint();return}
        model.section=destination.section;model.message='';loadDrilldown(destination.filter,destination.origin);
      }));
      root.querySelectorAll('[data-admin-origin]').forEach(button=>button.addEventListener('click',()=>loadDrilldown('origin',button.dataset.adminOrigin)));
      const managementFilter=root.querySelector('[data-admin-form="management-filter"]');
      if(managementFilter)managementFilter.addEventListener('submit',event=>{
        event.preventDefault();const fd=new FormData(managementFilter),start=String(fd.get('periodStart')||''),end=String(fd.get('periodEnd')||'');
        if(!start&&!end){loadManagement();return}
        if(!start||!end){model.management={...model.management,phase:'error',error:new TypeError('Informe as duas datas do período.')};repaint();return}
        const periodStart=new Date(`${start}T00:00:00`),periodEnd=new Date(`${end}T00:00:00`);periodEnd.setDate(periodEnd.getDate()+1);
        loadManagement({periodStart:periodStart.toISOString(),periodEnd:periodEnd.toISOString(),limit:50});
      });
      root.querySelectorAll('[data-admin-action]').forEach(button=>button.addEventListener('click',()=>{
        const action=button.dataset.adminAction,userId=button.dataset.userId;
        if(action==='dialog-close'){model.dialog=null;repaint();return}
        if(action==='overview-back'){
          model.section='overview';model.managementView='cards';model.users={phase:'idle',query:'',items:[],error:null,filter:null,origin:null,nextCursor:null};repaint();return;
        }
        if(action==='drilldown-more'){loadDrilldown(model.users.filter,model.users.origin,{append:true});return}
        if(action==='grant')model.dialog={kind:'grant',user:findUser(userId)};
        else if(action==='revoke')model.dialog={kind:'revoke',userId,grantId:button.dataset.grantId,product:button.dataset.product};
        else if(action==='password-recovery')model.dialog={kind:'password-recovery',user:findUser(userId)};
        else if(action==='password-reset-direct')model.dialog={kind:'password-reset-direct',user:findUser(userId)};
        else if(action==='staff-add')model.dialog={kind:'staff-add',user:findUser(userId)};
        else if(action==='staff-add-empty'){model.section='users';model.message='Localize o usuário existente e selecione “Adicionar como funcionário”.';}
        else if(action==='staff-permissions')model.dialog={kind:'staff-permissions',staff:findStaff(userId)};
        else if(action==='staff-status')model.dialog={kind:'staff-status',staff:findStaff(userId),status:button.dataset.status};
        repaint();
      }));
      const dialogForm=root.querySelector('[data-admin-dialog-form]');
      if(dialogForm)dialogForm.addEventListener('submit',event=>{event.preventDefault();submitDialog(dialogForm)});
    }
    function mount(target){
      root=typeof target==='string'?documentRef?.getElementById?.(target):target;
      if(!root)return;
      repaint();loadSection(model.section);
    }
    function resetContext(){
      model.context=contract.normalizeContext(null);model.contextPhase='idle';model.contextError=null;model.section='overview';model.message='';model.dialog=null;model.managementView='cards';
      model.management={phase:'idle',data:null,error:null};model.users={phase:'idle',query:'',items:[],error:null,filter:null,origin:null,nextCursor:null};model.staff={phase:'idle',items:[],error:null};model.audit={phase:'idle',items:[],error:null};
      repaint();
    }
    return Object.freeze({
      loadContext,loadManagement,loadDrilldown,resetContext,mount,render:()=>renderAdminArea(model),snapshot,
      canShowNavigation:()=>contract.canShowNavigation(model.context),
      visibleSections:()=>contract.visibleSections(model.context),
      setSection:value=>{if(contract.visibleSections(model.context).includes(value)){model.section=value;repaint();loadSection(value)}}
    });
  }

  return Object.freeze({SECTION_LABELS,PERMISSION_LABELS,DRILLDOWN_LABELS,escapeHtml,formatDate,renderAdminArea,renderManagement,createAdminArea,normalizeStaff,normalizeAudit,ensureDialogRequestId,managementCardDestination});
});
