'use strict';
(function(root,factory){
  const reader=typeof module!=='undefined'&&module.exports?require('./reader-experience'):root.MBKnowledgeReader;
  const api=factory(reader);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.MBKnowledgeArea=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(reader){
  const SECTION_TYPES=new Set([
    'paragraph','heading','subheading','quote','highlight','list','table',
    'exercise','exercise_black','checklist','chapter_checklist','rule_black',
    'impact_phrase','separator','transition','callout','example','warning','image'
  ]);
  const safe=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const hasKnowledge=entitlements=>Boolean(entitlements&&entitlements.knowledge&&entitlements.knowledge.hasAccess);
  const chapterAllowed=(chapter,entitlements)=>chapter.access_level!=='knowledge'||hasKnowledge(entitlements);
  const byPosition=(a,b)=>Number(a.position)-Number(b.position);
  const readerDefaults=reader?.DEFAULT_PREFERENCES||{theme:'dark',fontSize:'medium',lineHeight:'comfortable',width:'comfortable'};

  function safeAssetPath(value){
    const path=String(value||'');
    return /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(path)&&!/(^|\/)\.\.(\/|$)/.test(path)&&!/^[A-Za-z]+:/.test(path)?path:'';
  }
  function renderOfficialCover(publication){
    const mark='assets/branding/aviora-official.jpg';
    return `<figure class="knowledge-cover knowledge-cover-official" data-cover="premium"><img src="${safe(mark)}" alt="Símbolo oficial da AVIORA"></figure>`;
  }
  function renderSection(section){
    if(!SECTION_TYPES.has(section?.section_type))return '';
    const content=section.content&&typeof section.content==='object'?section.content:{};
    switch(section.section_type){
      case 'paragraph':return `<p class="knowledge-paragraph">${safe(content.text)}</p>`;
      case 'heading':return `<h2 class="knowledge-section-heading">${safe(content.text)}</h2>`;
      case 'subheading':return `<h3 class="knowledge-section-subheading">${safe(content.text)}</h3>`;
      case 'quote':return `<blockquote>${safe(content.text)}</blockquote>`;
      case 'highlight':return `<aside class="knowledge-highlight">${safe(content.text)}</aside>`;
      case 'rule_black':return `<aside class="knowledge-rule-black"><strong>Regra Black</strong><p>${safe(content.text)}</p></aside>`;
      case 'impact_phrase':return `<blockquote class="knowledge-impact-phrase">${safe(content.text)}</blockquote>`;
      case 'transition':return `<aside class="knowledge-transition">${safe(content.text)}</aside>`;
      case 'callout':return `<aside class="knowledge-callout">${safe(content.text)}</aside>`;
      case 'warning':return `<aside class="knowledge-warning"><strong>Atenção</strong><p>${safe(content.text)}</p></aside>`;
      case 'list':
      case 'checklist':
      case 'chapter_checklist':return `<section class="knowledge-list ${safe(section.section_type)}">${section.section_type==='chapter_checklist'?'<strong>Checklist do capítulo</strong>':''}<ul>${(Array.isArray(content.items)?content.items:[]).map(item=>`<li>${safe(item)}</li>`).join('')}</ul></section>`;
      case 'table':{
        const columns=Array.isArray(content.columns)?content.columns:[],rows=Array.isArray(content.rows)?content.rows:[];
        return `<div class="knowledge-table-wrap"><table><thead><tr>${columns.map(item=>`<th>${safe(item)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${(Array.isArray(row)?row:[]).map(item=>`<td>${safe(item)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      }
      case 'exercise':
      case 'exercise_black':
      case 'example':return `<section class="knowledge-exercise ${safe(section.section_type)}"><strong>${section.section_type==='exercise_black'?'Exercício Black':section.section_type==='example'?'Exemplo prático':'Exercício'}</strong><p>${safe(content.prompt)}</p>${Array.isArray(content.steps)?`<ol>${content.steps.map(item=>`<li>${safe(item)}</li>`).join('')}</ol>`:''}</section>`;
      case 'image':{
        const path=safeAssetPath(content.asset_path);
        return path?`<figure><img src="${safe(path)}" alt="${safe(content.alt)}" loading="lazy">${content.caption?`<figcaption>${safe(content.caption)}</figcaption>`:''}</figure>`:'';
      }
      case 'separator':return '<hr class="knowledge-separator">';
      default:return '';
    }
  }

  function progressFor(chapterId,progress){return progress.find(item=>item.chapter_id===chapterId)||null}
  function progressLabel(item){
    if(!item)return 'Não iniciado';
    if(item.completed_at||Number(item.progress_percent)===100)return 'Concluído';
    return 'Em andamento';
  }
  function publicationProgress(publicationId,chapters,progress){
    const ids=chapters.filter(item=>item.publication_id===publicationId).map(item=>item.id);
    if(!ids.length)return 0;
    return Math.round(ids.reduce((sum,id)=>sum+Number(progressFor(id,progress)?.progress_percent||0),0)/ids.length);
  }

  function renderLibrary(state){
    const publications=state.publications||[],chapters=state.chapters||[],progress=state.progress||[];
    if(!publications.length)return `<section class="knowledge-empty"><h2>Biblioteca em preparação</h2><p>Nenhuma publicação está disponível no momento.</p></section>`;
    return `<header class="knowledge-title"><span class="knowledge-kicker">Biblioteca AVIORA</span><h1>Conhecimento</h1><p>Educação financeira para decisões mais claras, organizadas e conscientes.</p></header><div class="knowledge-library">${publications.map(publication=>{
      const percent=publicationProgress(publication.id,chapters,progress),started=percent>0;
      return `<article class="knowledge-publication-card">${publication.cover_path?`<img class="knowledge-cover" src="${safe(safeAssetPath(publication.cover_path))}" alt="Capa de ${safe(publication.title)}">`:renderOfficialCover(publication)}<div class="knowledge-publication-copy"><h2>${safe(publication.title)}</h2>${publication.subtitle?`<p class="knowledge-subtitle">${safe(publication.subtitle)}</p>`:''}<p>${safe(publication.description||'')}</p><div class="knowledge-progress" aria-label="${percent}% concluído"><span style="width:${percent}%"></span></div><small>${percent}% concluído</small><div class="knowledge-actions"><button class="btn gold" data-knowledge-action="open-publication" data-id="${safe(publication.id)}">${started?'Continuar leitura':'Começar leitura'}</button></div></div></article>`;
    }).join('')}</div>`;
  }

  function renderToc(state,publicationId){
    const publication=state.publications.find(item=>item.id===publicationId);
    if(!publication)return renderLibrary(state);
    const parts=state.parts.filter(item=>item.publication_id===publicationId).sort(byPosition);
    const chapters=state.chapters.filter(item=>item.publication_id===publicationId),entitled=hasKnowledge(state.entitlements);
    return `<div class="knowledge-toolbar"><button class="btn" data-knowledge-action="library">← Biblioteca</button><button class="btn" data-knowledge-action="bookmarks">Meus favoritos</button></div><header class="knowledge-title compact"><span class="knowledge-kicker">Sumário</span><h1>${safe(publication.title)}</h1><p>${safe(publication.subtitle||publication.description||'')}</p></header><form class="knowledge-search" data-knowledge-search><label class="sr-only" for="knowledgeSearch">Buscar conteúdo autorizado</label><input id="knowledgeSearch" name="query" minlength="2" maxlength="160" placeholder="Buscar na biblioteca"><button class="btn" type="submit">Buscar</button></form><div class="knowledge-toc">${parts.map(part=>`<section><h2>Parte ${safe(part.position)} · ${safe(part.title)}</h2>${chapters.filter(chapter=>chapter.part_id===part.id).sort(byPosition).map(chapter=>{
      const allowed=chapterAllowed(chapter,state.entitlements),item=progressFor(chapter.id,state.progress),status=progressLabel(item),accessLabel=chapter.access_level==='sample'?'Amostra':allowed?'Conteúdo completo':'Conteúdo completo · bloqueado';
      return `<article class="knowledge-chapter-row ${allowed?'':'locked'}"><div><div class="knowledge-chapter-labels"><span class="knowledge-status ${chapter.access_level==='sample'?'sample':''}">${accessLabel}</span>${allowed&&item?`<span class="knowledge-progress-status">${status}</span>`:''}</div><h3>${safe(chapter.title)}</h3>${chapter.subtitle?`<p>${safe(chapter.subtitle)}</p>`:''}<small>${safe(chapter.estimated_read_minutes)} min de leitura</small></div><button class="btn ${allowed?'gold':''}" data-knowledge-action="open-chapter" data-id="${safe(chapter.id)}">${allowed?(item?'Continuar':'Ler'):'Ver acesso'}</button></article>`;
    }).join('')}</section>`).join('')}</div>${!entitled?renderPaywall():''}`;
  }

  function renderReaderPreferences(state){
    const prefs=state.readerPreferences||readerDefaults;
    const option=(value,label,selected)=>`<option value="${value}" ${selected===value?'selected':''}>${label}</option>`;
    return `<details class="knowledge-reader-preferences"><summary>Preferências de leitura</summary><div class="knowledge-reader-preference-grid">
      <label>Tema<select data-knowledge-preference="theme">${option('dark','Escuro',prefs.theme)}${option('light','Claro',prefs.theme)}${option('sepia','Confortável',prefs.theme)}</select></label>
      <label>Tamanho<select data-knowledge-preference="fontSize">${option('small','Menor',prefs.fontSize)}${option('medium','Padrão',prefs.fontSize)}${option('large','Maior',prefs.fontSize)}${option('x-large','Muito maior',prefs.fontSize)}</select></label>
      <label>Entrelinhas<select data-knowledge-preference="lineHeight">${option('compact','Compacta',prefs.lineHeight)}${option('comfortable','Confortável',prefs.lineHeight)}${option('airy','Ampla',prefs.lineHeight)}</select></label>
      <label>Largura<select data-knowledge-preference="width">${option('narrow','Estreita',prefs.width)}${option('comfortable','Confortável',prefs.width)}${option('wide','Ampla',prefs.width)}</select></label>
    </div></details>`;
  }

  function renderAnnotationTools(state,chapter){
    const count=(state.readerAnnotations||[]).filter(item=>item.chapterId===chapter.id).length;
    return `<section class="knowledge-annotation-tools" aria-label="Ferramentas de anotação"><p>Selecione um trecho contínuo para grifar, sublinhar ou anotar.</p><div class="knowledge-annotation-actions">
      <button class="btn" type="button" data-knowledge-action="annotate" data-kind="highlight" disabled>Grifar</button>
      <button class="btn" type="button" data-knowledge-action="annotate" data-kind="underline" disabled>Sublinhar</button>
      <button class="btn" type="button" data-knowledge-action="compose-note" disabled>Adicionar nota</button>
      <button class="btn" type="button" data-knowledge-action="annotations" data-id="${safe(chapter.id)}">Anotações (${count})</button>
    </div><form class="knowledge-note-composer hidden" data-knowledge-note-compose><label for="knowledgeNoteText">Nota sobre o trecho selecionado</label><textarea id="knowledgeNoteText" name="note" maxlength="4000" required></textarea><div class="knowledge-actions"><button class="btn gold" type="submit">Salvar nota</button><button class="btn" type="button" data-knowledge-action="cancel-note">Cancelar</button></div></form></section>`;
  }

  function renderReader(state,chapterId){
    const chapter=state.chapters.find(item=>item.id===chapterId);
    if(!chapter)return renderLibrary(state);
    const allowed=chapterAllowed(chapter,state.entitlements);
    const visibleSections=state.sections.filter(item=>item.chapter_id===chapter.id).sort(byPosition);
    if(!allowed&&!visibleSections.length)return renderPaywall(chapter);
    const partPosition=id=>Number(state.parts.find(item=>item.id===id)?.position||0);
    const chapterList=state.chapters.filter(item=>item.publication_id===chapter.publication_id).sort((a,b)=>partPosition(a.part_id)-partPosition(b.part_id)||byPosition(a,b)),index=chapterList.findIndex(item=>item.id===chapter.id),progress=progressFor(chapter.id,state.progress),bookmarked=state.bookmarks.some(item=>item.chapter_id===chapter.id&&item.section_id===null);
    const actions=allowed?`<button class="btn" data-knowledge-action="toggle-bookmark" data-id="${safe(chapter.id)}" data-enabled="${bookmarked?'false':'true'}">${bookmarked?'★ Favorito':'☆ Favoritar'}</button>`:'';
    const footer=allowed?`<footer class="knowledge-reader-footer"><button class="btn" ${index<=0?'disabled':''} data-knowledge-action="open-chapter" data-id="${safe(chapterList[index-1]?.id||'')}">← Anterior</button><button class="btn gold" data-knowledge-action="complete" data-id="${safe(chapter.id)}">${progress?.completed_at?'Concluído':'Marcar como concluído'}</button><button class="btn" ${index<0||index>=chapterList.length-1?'disabled':''} data-knowledge-action="open-chapter" data-id="${safe(chapterList[index+1]?.id||'')}">Próximo →</button></footer>`:renderPaywall(chapter);
    const prefs=state.readerPreferences||readerDefaults;
    const sections=visibleSections.map(section=>{
      const saved=state.bookmarks.some(item=>item.chapter_id===chapter.id&&item.section_id===section.id);
      return `<section class="knowledge-section" id="knowledge-section-${safe(section.id)}" data-knowledge-section-id="${safe(section.id)}">${renderSection(section)}${allowed?`<button class="knowledge-section-bookmark" type="button" data-knowledge-action="toggle-section-bookmark" data-id="${safe(chapter.id)}" data-section-id="${safe(section.id)}" data-enabled="${saved?'false':'true'}">${saved?'★ Ponto salvo':'☆ Salvar este ponto'}</button>`:''}</section>`;
    }).join('');
    return `<div class="knowledge-reader" data-reader-theme="${safe(prefs.theme)}" data-reader-font-size="${safe(prefs.fontSize)}" data-reader-line-height="${safe(prefs.lineHeight)}" data-reader-width="${safe(prefs.width)}"><nav class="knowledge-toolbar"><button class="btn" data-knowledge-action="open-publication" data-id="${safe(chapter.publication_id)}">← Sumário</button>${actions}</nav>${allowed?renderReaderPreferences(state):''}<header><span class="knowledge-kicker">${allowed&&chapter.access_level!=='sample'?'Leitura':'Amostra'}</span><h1>${safe(chapter.title)}</h1>${chapter.subtitle?`<p>${safe(chapter.subtitle)}</p>`:''}${allowed?`<div class="knowledge-progress" aria-label="${Number(progress?.progress_percent||0)}% concluído"><span style="width:${Number(progress?.progress_percent||0)}%"></span></div>`:''}</header>${allowed?renderAnnotationTools(state,chapter):''}<article class="knowledge-reading-body">${sections}</article>${footer}</div>`;
  }

  function renderPaywall(chapter){
    return `<section class="knowledge-paywall"><svg class="knowledge-lock" aria-hidden="true" viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 10 0v3M6 10h12v10H6zM12 14v2"/></svg><span class="knowledge-kicker">Conteúdo completo</span><h2>Continue sua leitura na biblioteca AVIORA.</h2>${chapter?`<p>${safe(chapter.excerpt||'O corpo completo deste capítulo é protegido.')}</p>`:'<p>Leia a amostra disponível ou conheça as opções de acesso à biblioteca.</p>'}<div class="knowledge-actions"><button class="btn gold" data-knowledge-action="checkout" data-offer="knowledge">Conhecer acesso completo</button><button class="btn" data-knowledge-action="checkout" data-offer="complete">Conhecer AVIORA Completo</button></div><small class="knowledge-paywall-note">Contratação online ainda não disponível. Nenhuma cobrança foi realizada.</small></section>`;
  }

  function renderBookmarks(state){
    return `<div class="knowledge-toolbar"><button class="btn" data-knowledge-action="library">← Biblioteca</button></div><header class="knowledge-title compact"><h1>Meus favoritos</h1><p>Capítulos e pontos salvos para continuar depois.</p></header><div class="knowledge-toc">${state.bookmarks.length?state.bookmarks.map(bookmark=>{
      const chapter=state.chapters.find(item=>item.id===bookmark.chapter_id);
      return chapter?`<article class="knowledge-chapter-row"><div><h3>${safe(chapter.title)}</h3><small>${bookmark.section_id?'Ponto específico salvo':`${safe(chapter.estimated_read_minutes)} min`}</small></div><button class="btn" data-knowledge-action="open-chapter" data-id="${safe(chapter.id)}" data-section-id="${safe(bookmark.section_id||'')}">Abrir</button></article>`:'';
    }).join(''):'<section class="knowledge-empty"><p>Você ainda não adicionou favoritos.</p></section>'}</div>`;
  }

  function renderAnnotations(state,chapterId){
    const chapter=state.chapters.find(item=>item.id===chapterId),items=(state.readerAnnotations||[]).filter(item=>item.chapterId===chapterId);
    if(!chapter)return renderLibrary(state);
    return `<div class="knowledge-toolbar"><button class="btn" data-knowledge-action="open-chapter" data-id="${safe(chapter.id)}">← Voltar à leitura</button></div><header class="knowledge-title compact"><h1>Anotações</h1><p>${safe(chapter.title)}</p></header><div class="knowledge-annotations-list">${items.length?items.map(item=>{const fieldId=`knowledge-annotation-note-${safe(item.id)}`;return `<article class="knowledge-annotation-card ${safe(item.kind)}"><blockquote>${safe(item.quote)}</blockquote>${item.note?`<p>${safe(item.note)}</p>`:''}<div class="knowledge-actions"><button class="btn" data-knowledge-action="open-chapter" data-id="${safe(chapter.id)}" data-section-id="${safe(item.sectionId)}">Ir ao trecho</button><button class="btn" data-knowledge-action="edit-annotation" data-id="${safe(item.id)}">Editar</button><button class="btn danger" data-knowledge-action="delete-annotation" data-id="${safe(item.id)}">Excluir</button></div><form class="knowledge-annotation-edit hidden" data-knowledge-annotation-edit="${safe(item.id)}"><label for="${fieldId}">Nota</label><textarea id="${fieldId}" name="note" maxlength="4000">${safe(item.note)}</textarea><button class="btn gold" type="submit">Salvar alteração</button></form></article>`}).join(''):'<section class="knowledge-empty"><p>Você ainda não criou destaques ou notas neste capítulo.</p></section>'}</div>`;
  }

  function renderSearch(state,results,query){
    return `<div class="knowledge-toolbar"><button class="btn" data-knowledge-action="open-publication" data-id="${safe(state.currentPublication)}">← Sumário</button></div><header class="knowledge-title compact"><h1>Resultados</h1><p>Busca por “${safe(query)}” somente no conteúdo autorizado da biblioteca.</p></header><div class="knowledge-search-results">${results.length?results.map(item=>`<button class="knowledge-search-result" data-knowledge-action="open-chapter" data-id="${safe(item.chapter_id)}"><strong>${safe(item.chapter_title)}</strong><span>${safe(item.snippet)}</span></button>`).join(''):'<section class="knowledge-empty"><p>Nenhum resultado autorizado encontrado.</p></section>'}</div>`;
  }

  async function rows(query){const result=await query;if(result.error)throw result.error;return result.data||[]}
  function createRepository(client){
    if(!client||typeof client.from!=='function'||typeof client.rpc!=='function')throw new TypeError('Supabase client is required');
    return Object.freeze({
      async catalog(){
        const [publications,parts,chapters,progress,bookmarks]=await Promise.all([
          rows(client.from('knowledge_publications').select('id,slug,title,subtitle,description,author,cover_path,publication_type,version,required_product_code').order('title')),
          rows(client.from('knowledge_parts').select('id,publication_id,position,title').order('position')),
          rows(client.from('knowledge_chapters').select('id,publication_id,part_id,slug,position,title,subtitle,excerpt,access_level,estimated_read_minutes').eq('active',true).order('position')),
          rows(client.from('knowledge_progress').select('publication_id,chapter_id,progress_percent,last_section_id,last_read_at,completed_at')),
          rows(client.from('knowledge_bookmarks').select('id,publication_id,chapter_id,section_id,created_at').order('created_at',{ascending:false}))
        ]);
        return {publications,parts,chapters,progress,bookmarks};
      },
      sections(chapterId){return rows(client.from('knowledge_sections').select('id,chapter_id,position,section_type,content,metadata,access_level').eq('chapter_id',chapterId).order('position'))},
      async search(query){const result=await client.rpc('search_my_knowledge_v1',{p_query:query,p_limit:30});if(result.error)throw result.error;return result.data||[]},
      async progress(publicationId,chapterId,percent,lastSectionId,completed){const result=await client.rpc('save_my_knowledge_progress_v1',{p_publication_id:publicationId,p_chapter_id:chapterId,p_progress_percent:percent,p_last_section_id:lastSectionId,p_completed:completed});if(result.error)throw result.error;return result.data},
      async bookmark(publicationId,chapterId,sectionId,enabled){const result=await client.rpc('set_my_knowledge_bookmark_v1',{p_publication_id:publicationId,p_chapter_id:chapterId,p_section_id:sectionId,p_enabled:enabled});if(result.error)throw result.error;return result.data}
    });
  }

  function createKnowledgeArea({client,entitlements,checkout,notify,preferenceScope='device',storage}={}){
    const repository=createRepository(client),message=typeof notify==='function'?notify:()=>{};
    let browserStorage=storage;
    if(browserStorage===undefined){try{browserStorage=globalThis.localStorage}catch(_error){browserStorage=null}}
    const readerStore=reader?.createReaderStore?.({storage:browserStorage,scope:preferenceScope})||null;
    const state={publications:[],parts:[],chapters:[],sections:[],progress:[],bookmarks:[],entitlements:entitlements||{knowledge:{hasAccess:false}},currentPublication:null,currentChapter:null,readerPreferences:readerStore?.preferences()||readerDefaults,readerAnnotations:readerStore?.annotations()||[]};
    let rootElement=null,readerAbort=null,progressTimer=null,pendingSelection=null,pendingNoteSelection=null;
    function syncReaderState(){state.readerPreferences=readerStore?.preferences()||readerDefaults;state.readerAnnotations=readerStore?.annotations()||[]}
    function show(html){readerAbort?.abort();readerAbort=null;clearTimeout(progressTimer);pendingSelection=null;pendingNoteSelection=null;if(rootElement)rootElement.innerHTML=html}
    async function refresh(){Object.assign(state,await repository.catalog());syncReaderState();show(renderLibrary(state))}
    async function openPublication(id){state.currentPublication=id;show(renderToc(state,id))}
    function bindReader(chapter,targetSectionId){
      const body=rootElement?.querySelector('.knowledge-reading-body');if(!body||!readerStore||!reader)return;
      reader.applyAnnotations(body,state.readerAnnotations.filter(item=>item.chapterId===chapter.id));
      const doc=rootElement.ownerDocument,win=doc.defaultView,Abort=win?.AbortController||globalThis.AbortController;
      readerAbort=Abort?new Abort():null;const signal=readerAbort?.signal;
      const sections=[...body.querySelectorAll('[data-knowledge-section-id]')];
      const saved=readerStore.position(chapter.id),server=progressFor(chapter.id,state.progress),resumeSection=targetSectionId||saved?.sectionId||server?.last_section_id;
      if(resumeSection){
        const target=sections.find(item=>item.dataset.knowledgeSectionId===resumeSection);
        (win?.requestAnimationFrame||globalThis.requestAnimationFrame||setTimeout)(()=>target?.scrollIntoView({block:'start'}));
      }
      const updateSelection=()=>{
        pendingSelection=reader.captureSelection(win?.getSelection?.(),body);
        rootElement.querySelectorAll('[data-knowledge-action="annotate"],[data-knowledge-action="compose-note"]').forEach(button=>{button.disabled=!pendingSelection});
      };
      doc.addEventListener('selectionchange',updateSelection,signal?{signal}:undefined);
      const savePosition=()=>{
        if(!sections.length)return;
        const viewport=Math.max(0,Number(win?.innerHeight||0)*.34);
        let current=sections[0],index=0;
        sections.forEach((section,sectionIndex)=>{if(section.getBoundingClientRect().top<=viewport){current=section;index=sectionIndex}});
        const ratio=sections.length?(index+1)/sections.length:0;
        readerStore.position(chapter.id,{sectionId:current.dataset.knowledgeSectionId,offsetRatio:ratio});
        clearTimeout(progressTimer);progressTimer=setTimeout(()=>{
          const completed=Boolean(progressFor(chapter.id,state.progress)?.completed_at),percent=completed?100:Math.max(1,Math.min(99,Math.round(ratio*100)));
          repository.progress(chapter.publication_id,chapter.id,percent,current.dataset.knowledgeSectionId,completed).then(row=>{
            const at=state.progress.findIndex(item=>item.chapter_id===chapter.id);if(at>=0)state.progress[at]=row;else state.progress.push(row);
          }).catch(error=>message(error.message,true));
        },650);
      };
      win?.addEventListener('scroll',savePosition,signal?{passive:true,signal}:{passive:true});
    }
    async function openChapter(id,{sectionId}={}){
      const chapter=state.chapters.find(item=>item.id===id);
      if(!chapter)return;
      state.currentPublication=chapter.publication_id;state.currentChapter=id;
      state.sections=await repository.sections(id);syncReaderState();show(renderReader(state,id));bindReader(chapter,sectionId);
      if(chapterAllowed(chapter,state.entitlements)&&state.sections.length&&!progressFor(id,state.progress)){
        const first=state.sections[0],row=await repository.progress(chapter.publication_id,id,1,first.id,false);state.progress.push(row);
      }
    }
    async function act(button){
      const action=button.dataset.knowledgeAction,id=button.dataset.id;
      if(action==='library')return show(renderLibrary(state));
      if(action==='open-publication')return openPublication(id);
      if(action==='open-chapter'&&id)return openChapter(id,{sectionId:button.dataset.sectionId||null});
      if(action==='bookmarks')return show(renderBookmarks(state));
      if(action==='annotations')return show(renderAnnotations(state,id));
      if(action==='checkout'&&typeof checkout==='function')return checkout(button.dataset.offer);
      if(action==='toggle-bookmark'){
        const chapter=state.chapters.find(item=>item.id===id);if(!chapter)return;
        await repository.bookmark(chapter.publication_id,id,null,button.dataset.enabled==='true');
        Object.assign(state,await repository.catalog());message('Favoritos atualizados.');return openChapter(id);
      }
      if(action==='toggle-section-bookmark'){
        const chapter=state.chapters.find(item=>item.id===id),sectionId=button.dataset.sectionId;if(!chapter||!sectionId)return;
        await repository.bookmark(chapter.publication_id,id,sectionId,button.dataset.enabled==='true');
        Object.assign(state,await repository.catalog());message('Ponto de leitura atualizado.');return openChapter(id,{sectionId});
      }
      if(action==='annotate'&&pendingSelection){
        readerStore.addAnnotation({...pendingSelection,publicationId:state.currentPublication,chapterId:state.currentChapter,kind:button.dataset.kind||'highlight'});
        const sectionId=pendingSelection.sectionId;syncReaderState();message('Trecho salvo neste dispositivo.');return openChapter(state.currentChapter,{sectionId});
      }
      if(action==='compose-note'&&pendingSelection){pendingNoteSelection=pendingSelection;rootElement.querySelector('[data-knowledge-note-compose]')?.classList.remove('hidden');rootElement.querySelector('[data-knowledge-note-compose] textarea')?.focus();return}
      if(action==='cancel-note'){pendingNoteSelection=null;rootElement.querySelector('[data-knowledge-note-compose]')?.classList.add('hidden');return}
      if(action==='edit-annotation'){rootElement.querySelector(`[data-knowledge-annotation-edit="${id}"]`)?.classList.toggle('hidden');return}
      if(action==='delete-annotation'){
        readerStore.removeAnnotation(id);syncReaderState();message('Anotação excluída deste dispositivo.');return show(renderAnnotations(state,state.currentChapter));
      }
      if(action==='complete'){
        const chapter=state.chapters.find(item=>item.id===id);if(!chapter)return;
        const sections=state.sections.filter(item=>item.chapter_id===id).sort(byPosition);
        await repository.progress(chapter.publication_id,id,100,sections.at(-1)?.id||null,true);
        Object.assign(state,await repository.catalog());message('Capítulo concluído.');return openChapter(id);
      }
    }
    async function mount(element){
      rootElement=element;if(!rootElement)throw new TypeError('Knowledge root is required');
      rootElement.innerHTML='<section class="knowledge-empty"><p>Carregando biblioteca…</p></section>';
      rootElement.onclick=event=>{const button=event.target.closest('[data-knowledge-action]');if(button&&!button.disabled)act(button).catch(error=>message(error.message,true))};
      rootElement.onchange=event=>{
        const key=event.target.dataset.knowledgePreference;if(!key||!readerStore)return;
        state.readerPreferences=readerStore.preferences({[key]:event.target.value});
        const sectionId=readerStore.position(state.currentChapter)?.sectionId;openChapter(state.currentChapter,{sectionId}).catch(error=>message(error.message,true));
      };
      rootElement.onsubmit=event=>{
        event.preventDefault();
        if(event.target.matches('[data-knowledge-search]')){
          const query=new FormData(event.target).get('query');
          repository.search(String(query||'')).then(results=>{
            const allowedChapters=new Set(state.chapters.filter(item=>item.publication_id===state.currentPublication).map(item=>item.id));
            show(renderSearch(state,results.filter(item=>allowedChapters.has(item.chapter_id)),query));
          }).catch(error=>message(error.message,true));return;
        }
        if(event.target.matches('[data-knowledge-note-compose]')&&pendingNoteSelection){
          const note=new FormData(event.target).get('note');readerStore.addAnnotation({...pendingNoteSelection,publicationId:state.currentPublication,chapterId:state.currentChapter,kind:'note',note});
          const sectionId=pendingNoteSelection.sectionId;pendingNoteSelection=null;syncReaderState();message('Nota salva neste dispositivo.');openChapter(state.currentChapter,{sectionId}).catch(error=>message(error.message,true));return;
        }
        const editId=event.target.dataset.knowledgeAnnotationEdit;if(editId){readerStore.updateAnnotation(editId,{note:new FormData(event.target).get('note')});syncReaderState();show(renderAnnotations(state,state.currentChapter));message('Nota atualizada neste dispositivo.');}
      };
      await refresh();return state;
    }
    return Object.freeze({mount,refresh,state,openPublication,openChapter});
  }

  return {safe,safeAssetPath,renderSection,renderLibrary,renderToc,renderReader,renderPaywall,renderBookmarks,renderAnnotations,renderSearch,createRepository,createKnowledgeArea,chapterAllowed,publicationProgress};
});
