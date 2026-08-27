(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.AVIORA_VISUAL_V1=api;api.install(root)}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const ICONS=Object.freeze({
    dashboard:'M3 13h7V3H3v10Zm11 8h7V11h-7v10ZM3 21h7v-4H3v4Zm11-14h7V3h-7v4Z',
    transactions:'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
    planning:'M4 19V9m5 10V5m5 14v-7m5 7V3',
    accounts:'M3 7h18v12H3zM3 10h18M7 15h4',
    cards:'M3 6h18v12H3zM3 10h18',
    categories:'M4 5h6l2 2h8v12H4z',
    goals:'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12l7-7',
    recurring:'M20 12a8 8 0 1 1-2.3-5.7M20 4v6h-6',
    wealth:'M4 19h16M6 16V9m4 7V5m4 11v-4m4 4V7',
    reports:'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5',
    knowledge:'M4 5.5A3.5 3.5 0 0 1 7.5 2H20v17H7.5A3.5 3.5 0 0 0 4 22V5.5Zm0 0A3.5 3.5 0 0 1 7.5 9H20',
    account:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
    administration:'M12 3 4 6v5c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6l-8-3Zm0 5v5m0 3h.01',
    'reserve-v52':'M12 3v18M7 7.5C7 5.6 9.2 4 12 4s5 1.6 5 3.5-2.2 3.3-5 3.3-5 1.5-5 3.4S9.2 18 12 18s5-1.6 5-3.5',
    'health-v53':'M3 12h4l2-5 4 10 2-5h6'
  });

  const moneyFallback=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

  function transactionSummary(data,filters,deps){
    const rows=Array.isArray(data?.transactions)?data.transactions:[];
    const rules=Array.isArray(data?.recurring)?data.recurring:[];
    const now=deps.now||new Date().toISOString().slice(0,10);
    const year=Number(filters?.txYear||filters?.year||new Date().getFullYear());
    const month=Number(filters?.txMonth||filters?.month||new Date().getMonth()+1);
    const financial=deps.dashboard.projectDashboardPeriod(rows,rules,{year,month,now});
    const plan=deps.planning.projectPlanningPeriod(
      typeof deps.monthlyPlan==='function'?deps.monthlyPlan():null,rows,rules,{year,month,now}
    );
    const total=bucket=>Number(bucket?.consumptionExpense||0)+Number(bucket?.investment||0);
    return Object.freeze({
      year,month,
      realized:total(financial.realized),
      scheduled:total(financial.scheduled),
      projected:total(financial.projected),
      planned:Number(plan?.planned?.totalOut||0),
      forecast:Number(plan?.forecast?.totalOut||0)
    });
  }

  function setExpanded(trigger,panel,expanded){
    trigger.setAttribute('aria-expanded',String(expanded));
    panel.hidden=!expanded;
    trigger.closest('.aviora-accordion,.goal-card')?.classList.toggle('is-open',expanded);
  }

  function wireAccordion(trigger,panel,expanded=false){
    if(!trigger||!panel||trigger.dataset.avioraAccordionReady==='true')return;
    trigger.dataset.avioraAccordionReady='true';
    setExpanded(trigger,panel,expanded);
    trigger.addEventListener('click',()=>setExpanded(trigger,panel,trigger.getAttribute('aria-expanded')!=='true'));
  }

  function chartCanvasIsRenderable(canvas){
    return Boolean(canvas&&!canvas.closest?.('[hidden]'));
  }

  function chartAnimation(reducedMotion=false){
    return reducedMotion?false:Object.freeze({duration:240});
  }

  function decorateNavigation(doc){
    doc.querySelectorAll('#nav [data-tab]').forEach(button=>{
      if(button.querySelector('.aviora-nav-icon'))return;
      const tab=button.dataset.tab,path=ICONS[tab]||ICONS.dashboard;
      button.insertAdjacentHTML('afterbegin',`<svg class="aviora-nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${path}"/></svg>`);
    });
  }

  function decorateTables(scope){
    scope.querySelectorAll('table').forEach(table=>{
      const labels=[...table.querySelectorAll('thead th')].map(cell=>cell.textContent.trim());
      table.querySelectorAll('tbody tr').forEach(row=>{
        [...row.children].forEach((cell,index)=>cell.dataset.label=labels[index]||'');
      });
    });
  }

  function renderMetric(label,value,caption,tone=''){
    return `<article class="aviora-metric ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(caption)}</small></article>`;
  }

  function currentTransactionSummary(root){
    if(typeof root.MBDashboardFinancialV82?.projectDashboardPeriod!=='function'||typeof root.MBPlanningV82?.projectPlanningPeriod!=='function')return null;
    if(typeof DATA==='undefined'||typeof FILTERS==='undefined')return null;
    return transactionSummary(DATA,FILTERS,{
      dashboard:root.MBDashboardFinancialV82,
      planning:root.MBPlanningV82,
      monthlyPlan:typeof monthlyPlan==='function'?monthlyPlan:null,
      now:new Date().toISOString().slice(0,10)
    });
  }

  function enhanceTransactions(root,view){
    const filters=view.querySelector('.v22-tx-filters'),results=view.querySelector('.tx-results-card');
    if(!filters||!results||view.querySelector('.aviora-tx-summary'))return;
    const summary=currentTransactionSummary(root);
    if(!summary)return;
    const format=typeof money==='function'?money:moneyFallback;
    const metrics=document.createElement('section');
    metrics.className='aviora-tx-summary';
    metrics.setAttribute('aria-label','Resumo financeiro dos lançamentos');
    metrics.innerHTML=[
      renderMetric('Realizado',format(summary.realized),'Movimentações efetivadas'),
      renderMetric('Programado',format(summary.scheduled),'Compromissos já previstos','attention'),
      renderMetric('Projetado',format(summary.projected),'Estimativa adicional do mês')
    ].join('');
    filters.before(metrics);

    const tracking=document.createElement('section');
    tracking.className='aviora-accordion aviora-month-tracking';
    tracking.innerHTML=`<button class="aviora-accordion-trigger" type="button" aria-controls="aviora-month-tracking-panel"><span><strong>Acompanhamento do mês</strong><small>Planejado ${escapeHtml(format(summary.planned))} · Realizado ${escapeHtml(format(summary.realized))} · Projetado ${escapeHtml(format(summary.projected))}</small></span><span class="aviora-chevron" aria-hidden="true"></span></button><div class="aviora-accordion-panel" id="aviora-month-tracking-panel"><div class="aviora-month-values">${renderMetric('Planejado',format(summary.planned),'Orçamento do mês')}${renderMetric('Realizado',format(summary.realized),'Movimentações efetivadas')}${renderMetric('Previsão',format(summary.forecast),'Programado + projetado')}</div></div>`;
    filters.after(tracking);
    wireAccordion(tracking.querySelector('button'),tracking.querySelector('.aviora-accordion-panel'),false);

    const head=view.querySelector('.v22-results-head');
    const panelId='aviora-all-transactions-panel';
    const wrapper=document.createElement('section');
    wrapper.className='aviora-accordion aviora-transactions-list';
    wrapper.innerHTML=`<button class="aviora-accordion-trigger" type="button" aria-controls="${panelId}"><span><strong>Todos os lançamentos</strong><small>${escapeHtml(head?.innerText.replace(/\s+/g,' ').trim()||'Lista completa')}</small></span><span class="aviora-chevron" aria-hidden="true"></span></button><div class="aviora-accordion-panel" id="${panelId}"></div>`;
    results.before(wrapper);
    wrapper.querySelector('.aviora-accordion-panel').append(results);
    if(head)head.remove();
    wireAccordion(wrapper.querySelector('button'),wrapper.querySelector('.aviora-accordion-panel'),false);
  }

  function enhanceGoals(view){
    view.querySelectorAll('.goal-card').forEach((card,index)=>{
      if(card.dataset.avioraGoalReady==='true')return;
      card.dataset.avioraGoalReady='true';
      const top=card.querySelector('.goal-card-top');
      const progress=top?.nextElementSibling;
      const bar=progress?.nextElementSibling;
      if(!top||!progress||!bar)return;
      const trigger=document.createElement('button');
      const panel=document.createElement('div');
      const id=`aviora-goal-panel-${index}`;
      trigger.className='aviora-goal-trigger';
      trigger.type='button';
      trigger.setAttribute('aria-controls',id);
      trigger.setAttribute('aria-label',`Mostrar detalhes de ${top.querySelector('h2')?.textContent||'meta'}`);
      panel.className='aviora-goal-panel';panel.id=id;
      trigger.append(top,progress,bar);
      while(card.firstChild)panel.append(card.firstChild);
      card.append(trigger,panel);
      wireAccordion(trigger,panel,index===0);
    });
  }

  function parsePtBrCurrency(value){
    const normalized=String(value||'').replace(/[^0-9,.-]/g,'').replace(/\./g,'').replace(',','.');
    const number=Number(normalized);return Number.isFinite(number)?number:0;
  }

  function enhancePlanning(root,view){
    const section=view.querySelector('.planning-canonical');
    const wrap=section?.querySelector('.tablewrap');
    const rows=wrap?[...wrap.querySelectorAll('tbody tr')]:[];
    if(!section||!wrap||!rows.length||section.querySelector('.aviora-planning-bars'))return;
    const cards=document.createElement('div');cards.className='aviora-planning-bars';
    rows.slice(0,-1).forEach((row,index)=>{
      const cells=[...row.children];if(cells.length<3)return;
      const name=cells[0].textContent.trim(),planned=parsePtBrCurrency(cells[1].textContent),realized=parsePtBrCurrency(cells[2].textContent);
      const ratio=planned>0?Math.max(0,Math.min(100,realized/planned*100)):realized>0?100:0;
      const dot=cells[0].querySelector('.dot');
      const color=dot?.style.background||dot?.style.backgroundColor||'var(--aviora-gold)';
      const card=document.createElement('article');card.className='aviora-planning-row';
      card.style.setProperty('--category-color',color);
      card.innerHTML=`<header><strong>${escapeHtml(name)}</strong><b>${ratio.toLocaleString('pt-BR',{maximumFractionDigits:1})}%</b></header><div class="aviora-category-progress" role="img" aria-label="${escapeHtml(`${name}: ${ratio.toLocaleString('pt-BR',{maximumFractionDigits:1})}% do planejado realizado`)}"><i style="width:${ratio}%"></i></div><p>${escapeHtml(cells[2].textContent.trim())} de ${escapeHtml(cells[1].textContent.trim())}${planned-realized>=0?` · restam ${escapeHtml((typeof money==='function'?money:moneyFallback)(planned-realized))}`:` · excedido em ${escapeHtml((typeof money==='function'?money:moneyFallback)(Math.abs(planned-realized)))}`}</p>${index?`<button class="aviora-text-action" type="button" data-aviora-category="${escapeHtml(name)}">Ver detalhes e lançamentos →</button>`:''}`;
      cards.append(card);
    });
    section.insertBefore(cards,wrap);
    const details=document.createElement('details');details.className='aviora-planning-table';
    details.innerHTML='<summary>Ver comparação completa</summary>';
    wrap.before(details);details.append(wrap);
    cards.querySelectorAll('[data-aviora-category]').forEach(button=>button.addEventListener('click',()=>{
      if(typeof FILTERS!=='undefined')FILTERS.txCategory=button.dataset.avioraCategory;
      if(typeof TAB!=='undefined')TAB='transactions';
      if(typeof root.render==='function')root.render();
    }));
  }

  function enhanceCategories(view){
    view.querySelectorAll('.card').forEach(card=>{
      const heading=card.querySelector(':scope > h2');
      if(heading&&/Categorias de (despesas|receitas)/.test(heading.textContent))card.classList.add('aviora-category-list');
    });
  }

  function enhanceDashboard(root,view){
    const kpis=[...view.querySelectorAll(':scope > .kpis .kpi')];
    kpis.forEach((item,index)=>item.classList.add(index<4?'is-primary':'is-secondary'));
    const grid=view.querySelector(':scope > .grid');
    if(!grid||view.querySelector('.aviora-dashboard-alerts'))return;
    const alerts=[];
    if(view.querySelector('.goal-status-behind'))alerts.push(['Uma meta pede revisão','goals']);
    if(view.querySelector('.dashboard-planning-v82 .notice'))alerts.push(['Planejamento precisa de atenção','planning']);
    const alert=document.createElement('section');alert.className='aviora-dashboard-alerts';
    alert.innerHTML=`<header><div><span class="aviora-eyebrow">Próximos passos</span><h2>${alerts.length?'O que exige sua atenção':'Seu mês está organizado'}</h2></div><p>${alerts.length?'Abra apenas o detalhe que muda sua decisão agora.':'Nenhum alerta financeiro prioritário foi identificado nesta leitura.'}</p></header><div>${(alerts.length?alerts:[['Revisar lançamentos do mês','transactions']]).map(([label,tab])=>`<button type="button" data-aviora-go="${tab}">${escapeHtml(label)}<span aria-hidden="true">→</span></button>`).join('')}</div>`;
    grid.before(alert);
    alert.querySelectorAll('[data-aviora-go]').forEach(button=>button.addEventListener('click',()=>{
      if(typeof TAB!=='undefined')TAB=button.dataset.avioraGo;
      root.render?.();
    }));

    const chartCards=[...grid.querySelectorAll('.card')].filter(card=>card.querySelector('canvas'));
    if(chartCards.length<2)return;
    const stage=document.createElement('section');stage.className='card s12 aviora-chart-stage';
    const tabs=document.createElement('div');tabs.className='aviora-chart-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Análises financeiras');
    const panels=document.createElement('div');panels.className='aviora-chart-panels';
    chartCards.forEach((card,index)=>{
      const raw=card.querySelector('h2')?.textContent||`Análise ${index+1}`;
      const label=/categoria/i.test(raw)?'Distribuição':/evolu/i.test(raw)?'Evolução':'Comparação';
      const button=document.createElement('button');button.type='button';button.role='tab';button.textContent=label;button.setAttribute('aria-selected',String(index===0));
      const id=`aviora-chart-panel-${index}`;button.setAttribute('aria-controls',id);
      card.id=id;card.setAttribute('role','tabpanel');card.hidden=index!==0;card.classList.remove('s4','s6','s8','s12');
      button.addEventListener('click',()=>{
        [...tabs.children].forEach((tab,i)=>tab.setAttribute('aria-selected',String(i===index)));
        [...panels.children].forEach((panel,i)=>panel.hidden=i!==index);
        requestAnimationFrame(()=>root.drawCharts?.());
      });
      tabs.append(button);panels.append(card);
    });
    stage.append(tabs,panels);grid.prepend(stage);
  }

  function enhanceKnowledge(view){
    const kicker=view.querySelector('.knowledge-kicker');
    if(kicker&&/AVIORA/i.test(kicker.textContent))kicker.textContent='Biblioteca';
  }

  function enhanceCurrentView(root){
    const doc=root.document,view=doc.getElementById('view');
    decorateNavigation(doc);
    if(!view)return;
    const active=doc.querySelector('#nav [data-tab].active')?.dataset.tab||'';
    view.dataset.avioraView=active;
    decorateTables(view);
    if(active==='dashboard')enhanceDashboard(root,view);
    if(active==='transactions')enhanceTransactions(root,view);
    if(active==='goals')enhanceGoals(view);
    if(active==='planning')enhancePlanning(root,view);
    if(active==='categories')enhanceCategories(view);
    if(active==='knowledge')enhanceKnowledge(view);
  }

  function install(root){
    if(!root?.document||root.__AVIORA_VISUAL_V1_INSTALLED__)return;
    root.__AVIORA_VISUAL_V1_INSTALLED__=true;
    const apply=()=>enhanceCurrentView(root);
    if(typeof root.render==='function'){
      const base=root.render;
      root.render=function(){const result=base.apply(this,arguments);apply();return result};
    }
    if(root.document.readyState==='loading'){
      apply();
      root.document.addEventListener('DOMContentLoaded',apply,{once:true});
    }else apply();
  }

  return Object.freeze({transactionSummary,parsePtBrCurrency,setExpanded,wireAccordion,chartCanvasIsRenderable,chartAnimation,install});
});
