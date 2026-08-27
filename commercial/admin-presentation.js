(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AVAdminPresentation=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const ROLE_LABELS=Object.freeze({OWNER:'Proprietário',STAFF:'Funcionário',CUSTOMER:'Cliente'});
  const STATUS_LABELS=Object.freeze({
    active:'Ativo',disabled:'Desativado',revoked:'Revogado',expired:'Expirado',
    grace_period:'Período de tolerância',eligible:'Disponível',none:'Sem acesso',
    succeeded:'Concluído',denied:'Negado',failed:'Falhou',noop:'Sem alteração',
    processing:'Em processamento',prepared:'Preparado'
  });
  const KIND_LABELS=Object.freeze({
    monthly:'Mensal',annual:'Anual',lifetime:'Vitalício',manual:'Manual',
    trial:'Trial',paid:'Comercial',commercial:'Comercial',unknown:'Não classificada'
  });
  const PRODUCT_LABELS=Object.freeze({APP:'Aplicativo',KNOWLEDGE:'Conhecimento'});
  const ACTION_LABELS=Object.freeze({
    'users.password.reset_direct':'Senha redefinida pelo administrador',
    'user.password_recovery.requested':'Recuperação de senha enviada',
    'users.password_recovery':'Recuperação de senha enviada',
    'licenses.grant':'Licença concedida',
    'licenses.revoke':'Licença revogada',
    'staff.add':'Funcionário adicionado',
    'staff.disabled':'Funcionário desativado',
    'staff.activated':'Funcionário reativado',
    'staff.status.set':'Status do funcionário atualizado',
    'staff.permission.added':'Permissão concedida',
    'staff.permission.removed':'Permissão removida',
    'staff.permissions.set':'Permissões atualizadas',
    'rate_limit.denied':'Operação temporariamente limitada'
  });
  const ERROR_CODE_LABELS=Object.freeze({
    authentication_required:'Faça login novamente para continuar.',
    invalid_session:'Sua sessão expirou. Faça login novamente.',
    missing_session:'Faça login novamente para acessar a Administração.',
    forbidden:'Você não possui permissão para concluir esta operação.',
    permission_denied:'Você não possui permissão para concluir esta operação.',
    rate_limited:'Muitas tentativas em pouco tempo. Aguarde e tente novamente.',
    operation_conflict:'Esta solicitação conflita com uma operação anterior. Atualize a tela e tente novamente.',
    invalid_operation:'Revise os dados informados e tente novamente.',
    password_recovery_unavailable:'Não foi possível enviar a recuperação de senha agora. Tente novamente.',
    password_reset_unavailable:'Não foi possível redefinir a senha agora. Tente novamente.',
    internal_error:'Não foi possível concluir a operação. Tente novamente.',
    admin_request_failed:'Não foi possível concluir a operação. Tente novamente.'
  });

  function mapped(value,map,fallback='—'){
    const key=String(value??'').trim();
    return map[key]||map[key.toUpperCase()]||map[key.toLowerCase()]||key||fallback;
  }
  function roleLabel(value){return mapped(value,ROLE_LABELS)}
  function statusLabel(value){return mapped(value,STATUS_LABELS)}
  function kindLabel(value){return mapped(value,KIND_LABELS)}
  function productLabel(value){return mapped(value,PRODUCT_LABELS,'Produto')}
  function actionLabel(value){return mapped(value,ACTION_LABELS,'Ação administrativa')}
  function errorCode(value){return String(value?.code||value?.error?.code||'').trim()}
  function safeErrorMessage(error,{scope='admin'}={}){
    const code=errorCode(error),message=String(error?.message||error?.error_description||'').trim(),normalized=message.toLowerCase();
    if(ERROR_CODE_LABELS[code])return ERROR_CODE_LABELS[code];
    if(/invalid login credentials|invalid credentials/.test(normalized))return 'E-mail ou senha incorretos.';
    if(/email not confirmed|email address not confirmed/.test(normalized))return 'Confirme seu e-mail antes de entrar.';
    if(/failed to fetch|network|load failed|connection|timeout|timed out/.test(normalized))return 'Não foi possível conectar agora. Verifique sua conexão e tente novamente.';
    if(/password.*weak|weak password|password should|password must/.test(normalized))return 'A senha não atende aos requisitos de segurança.';
    if(scope==='auth')return 'Não foi possível entrar agora. Tente novamente.';
    return 'Não foi possível concluir a operação. Tente novamente.';
  }

  return Object.freeze({
    ROLE_LABELS,STATUS_LABELS,KIND_LABELS,PRODUCT_LABELS,ACTION_LABELS,ERROR_CODE_LABELS,
    roleLabel,statusLabel,kindLabel,productLabel,actionLabel,safeErrorMessage,errorCode
  });
});
