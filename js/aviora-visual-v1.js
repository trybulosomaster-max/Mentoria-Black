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
    const nav=doc.getElementById('nav');
    if(!nav)return;
    const destinations=[...nav.querySelectorAll(':scope > [data-tab]')];
    destinations.forEach(button=>{
      if(button.querySelector('.aviora-nav-icon'))return;
      const tab=button.dataset.tab,path=ICONS[tab]||ICONS.dashboard;
      button.insertAdjacentHTML('afterbegin',`<svg class="aviora-nav-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${path}"/></svg>`);
    });
    const existingTrigger=nav.querySelector('[data-aviora-mobile-nav-trigger]');
    if(existingTrigger){
      nav.classList.add('aviora-mobile-nav-ready');
      const current=destinations.find(button=>button.classList.contains('active'))||destinations[0];
      const currentLabel=current?.textContent.trim()||'Dashboard';
      const label=existingTrigger.querySelector('strong');
      if(label)label.textContent=currentLabel;
      nav.querySelectorAll('.aviora-mobile-nav-item').forEach(item=>item.classList.toggle('active',item.dataset.tab===current?.dataset.tab));
      return;
    }
    if(!destinations.length)return;

    const active=destinations.find(button=>button.classList.contains('active'))||destinations[0];
    const activeLabel=active.textContent.trim();
    const trigger=doc.createElement('button');
    const backdrop=doc.createElement('button');
    const sheet=doc.createElement('section');
    const panelId='aviora-mobile-navigation';
    trigger.type='button';trigger.className='aviora-mobile-nav-trigger';trigger.dataset.avioraMobileNavTrigger='true';
    trigger.setAttribute('aria-controls',panelId);trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-haspopup','dialog');
    trigger.innerHTML=`<span><small>Área atual</small><strong>${escapeHtml(activeLabel)}</strong></span><span class="aviora-mobile-menu-label">Menu</span>`;
    backdrop.type='button';backdrop.className='aviora-mobile-nav-backdrop';backdrop.hidden=true;backdrop.setAttribute('aria-label','Fechar menu de navegação');
    sheet.id=panelId;sheet.className='aviora-mobile-nav-sheet';sheet.hidden=true;sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');sheet.setAttribute('aria-label','Áreas do AVIORA');
    sheet.innerHTML='<header><strong>Navegação</strong><button type="button" class="aviora-mobile-nav-close" aria-label="Fechar menu">Fechar</button></header><div class="aviora-mobile-nav-list"></div>';
    const list=sheet.querySelector('.aviora-mobile-nav-list');
    destinations.forEach(button=>{
      const item=button.cloneNode(true);item.classList.add('aviora-mobile-nav-item');
      item.classList.toggle('active',button===active);item.removeAttribute('id');
      item.addEventListener('click',()=>{close(false);button.click()});
      list.append(item);
    });
    function open(){
      trigger.setAttribute('aria-expanded','true');sheet.hidden=false;backdrop.hidden=false;
      (sheet.querySelector('.aviora-mobile-nav-item.active')||sheet.querySelector('.aviora-mobile-nav-item'))?.focus();
    }
    function close(restore=true){
      trigger.setAttribute('aria-expanded','false');sheet.hidden=true;backdrop.hidden=true;
      if(restore)trigger.focus();
    }
    trigger.addEventListener('click',()=>trigger.getAttribute('aria-expanded')==='true'?close():open());
    backdrop.addEventListener('click',()=>close());
    sheet.querySelector('.aviora-mobile-nav-close').addEventListener('click',()=>close());
    sheet.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();close();return}
      if(event.key!=='Tab')return;
      const focusable=[...sheet.querySelectorAll('button:not([disabled])')].filter(control=>!control.hidden);
      const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus()}
    });
    nav.append(trigger,backdrop,sheet);nav.classList.add('aviora-mobile-nav-ready');
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

    const filterDisclosure=document.createElement('section');
    const filterPanel=document.createElement('div');
    const filterPanelId='aviora-transaction-filters-panel';
    filterDisclosure.className='aviora-accordion aviora-transaction-filters';
    filterDisclosure.innerHTML=`<button class="aviora-accordion-trigger" type="button" aria-controls="${filterPanelId}"><span><strong>Filtros</strong><small>Busca, tipo, categoria e período</small></span><span class="aviora-chevron" aria-hidden="true"></span></button>`;
    filterPanel.className='aviora-accordion-panel';filterPanel.id=filterPanelId;
    filters.before(filterDisclosure);filterPanel.append(filters);filterDisclosure.append(filterPanel);
    const compact=root.matchMedia?.('(max-width: 720px)')?.matches===true;
    wireAccordion(filterDisclosure.querySelector('button'),filterPanel,!compact);

    const tracking=document.createElement('section');
    tracking.className='aviora-accordion aviora-month-tracking';
    tracking.innerHTML=`<button class="aviora-accordion-trigger" type="button" aria-controls="aviora-month-tracking-panel"><span><strong>Acompanhamento do mês</strong><small>Planejado ${escapeHtml(format(summary.planned))} · Realizado ${escapeHtml(format(summary.realized))} · Projetado ${escapeHtml(format(summary.projected))}</small></span><span class="aviora-chevron" aria-hidden="true"></span></button><div class="aviora-accordion-panel" id="aviora-month-tracking-panel"><div class="aviora-month-values">${renderMetric('Planejado',format(summary.planned),'Orçamento do mês')}${renderMetric('Realizado',format(summary.realized),'Movimentações efetivadas')}${renderMetric('Previsão',format(summary.forecast),'Programado + projetado')}</div></div>`;
    filterDisclosure.after(tracking);
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

    view.querySelectorAll('.tx-results-card td[data-label="Categoria"]').forEach(cell=>{
      if(cell.querySelector('.aviora-category-dot'))return;
      const category=cell.textContent.split('/')[0].trim();
      const color=typeof categoryColor==='function'?categoryColor(category):'var(--aviora-gold)';
      const dot=document.createElement('span');dot.className='aviora-category-dot';dot.setAttribute('aria-hidden','true');dot.style.background=color;
      cell.prepend(dot);
    });
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
    const labels=[...wrap.querySelectorAll('thead th')].map(cell=>cell.textContent.trim());
    const column=label=>labels.indexOf(label);
    const cards=document.createElement('div');cards.className='aviora-planning-bars';
    rows.slice(0,-1).forEach(row=>{
      const cells=[...row.children];if(cells.length<7)return;
      const name=cells[0].textContent.trim();if(name==='Receitas')return;
      const planned=parsePtBrCurrency(cells[column('Planejado')]?.textContent);
      const realized=parsePtBrCurrency(cells[column('Realizado')]?.textContent);
      const forecast=parsePtBrCurrency(cells[column('Previsão')]?.textContent);
      const expected=parsePtBrCurrency(cells[column('Esperado')]?.textContent);
      const realizedRatio=planned>0?Math.max(0,Math.min(100,realized/planned*100)):realized>0?100:0;
      const expectedRatio=planned>0?Math.max(0,Math.min(100,expected/planned*100)):expected>0?100:0;
      const dot=cells[0].querySelector('.dot');
      const color=dot?.style.background||dot?.style.backgroundColor||'var(--aviora-gold)';
      const card=document.createElement('article');card.className='aviora-planning-row';
      card.style.setProperty('--category-color',color);
      const difference=planned-expected;
      card.innerHTML=`<header><strong><span class="aviora-category-dot" aria-hidden="true"></span>${escapeHtml(name)}</strong><b>${expectedRatio.toLocaleString('pt-BR',{maximumFractionDigits:1})}% esperado</b></header><div class="aviora-category-progress" role="img" aria-label="${escapeHtml(`${name}: realizado ${realizedRatio.toLocaleString('pt-BR',{maximumFractionDigits:1})}% e esperado ${expectedRatio.toLocaleString('pt-BR',{maximumFractionDigits:1})}% do planejado`)}"><i class="expected" style="width:${expectedRatio}%"></i><b class="realized" style="width:${realizedRatio}%"></b></div><p><b>Realizado</b> ${escapeHtml((typeof money==='function'?money:moneyFallback)(realized))} · <b>Compromissos</b> ${escapeHtml((typeof money==='function'?money:moneyFallback)(forecast))} · <b>Esperado</b> ${escapeHtml((typeof money==='function'?money:moneyFallback)(expected))}</p><p>Planejado ${escapeHtml((typeof money==='function'?money:moneyFallback)(planned))}${difference>=0?` · restam ${escapeHtml((typeof money==='function'?money:moneyFallback)(difference))}`:` · excedido em ${escapeHtml((typeof money==='function'?money:moneyFallback)(Math.abs(difference)))}`}</p><button class="aviora-text-action" type="button" data-aviora-category="${escapeHtml(name)}">Ver detalhes e lançamentos →</button>`;
      cards.append(card);
    });
    section.insertBefore(cards,wrap);
    const heading=section.querySelector(':scope > h2');
    const description=section.querySelector(':scope > .desc');
    const totalRow=rows.at(-1),totalCells=totalRow?[...totalRow.children]:[];
    const plannedTotal=totalCells[column('Planejado')]?.textContent.trim()||'R$ 0,00';
    const realizedTotal=totalCells[column('Realizado')]?.textContent.trim()||'R$ 0,00';
    const expectedTotal=totalCells[column('Esperado')]?.textContent.trim()||'R$ 0,00';
    const panel=document.createElement('div');panel.className='aviora-accordion-panel';panel.id='aviora-planning-categories-panel';
    if(description)panel.append(description);panel.append(cards,wrap);
    const trigger=document.createElement('button');trigger.className='aviora-accordion-trigger';trigger.type='button';trigger.setAttribute('aria-controls',panel.id);
    trigger.innerHTML=`<span><strong>Planejamento por categoria · ${cards.children.length} categorias</strong><small>Planejado ${escapeHtml(plannedTotal)} · Realizado ${escapeHtml(realizedTotal)} · Esperado ${escapeHtml(expectedTotal)}</small></span><span class="aviora-chevron" aria-hidden="true"></span>`;
    heading?.remove();section.classList.add('aviora-accordion','aviora-planning-categories');section.prepend(trigger,panel);
    wireAccordion(trigger,panel,false);
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
    kpis.forEach((item,index)=>{
      item.classList.add(index<4?'is-primary':'is-secondary');
      const label=item.querySelector('.lab')?.textContent.trim()||'';
      if(/Receitas/i.test(label))item.classList.add('aviora-kpi-income');
      else if(/Despesas/i.test(label))item.classList.add('aviora-kpi-expense');
      else if(/Investimentos/i.test(label))item.classList.add('aviora-kpi-investment');
      else if(/Reserva|Patrimônio/i.test(label))item.classList.add('aviora-kpi-wealth');
    });
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

    const latest=view.querySelector('[data-dashboard-latest]');
    if(latest){
      const heading=latest.querySelector(':scope > h2');
      const count=latest.querySelectorAll('tbody tr').length;
      const panel=document.createElement('div');panel.className='aviora-accordion-panel';panel.id='aviora-dashboard-latest-panel';
      [...latest.children].filter(child=>child!==heading).forEach(child=>panel.append(child));
      const trigger=document.createElement('button');trigger.className='aviora-accordion-trigger';trigger.type='button';trigger.setAttribute('aria-controls',panel.id);
      trigger.innerHTML=`<span><strong>Últimos lançamentos do período · ${count} ${count===1?'lançamento':'lançamentos'}</strong><small>Abra para ver datas, categorias, status e ações</small></span><span class="aviora-chevron" aria-hidden="true"></span>`;
      heading?.remove();latest.classList.add('aviora-accordion');latest.prepend(trigger,panel);wireAccordion(trigger,panel,false);
    }

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
