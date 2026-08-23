'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.MBKnowledgeArea=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const SECTION_TYPES=new Set([
    'paragraph','heading','subheading','quote','highlight','list','table',
    'exercise','exercise_black','checklist','chapter_checklist','rule_black',
    'impact_phrase','separator','transition','callout','example','warning','image'
  ]);
  const safe=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const hasKnowledge=entitlements=>Boolean(entitlements&&entitlements.knowledge&&entitlements.knowledge.hasAccess);
  const chapterAllowed=(chapter,entitlements)=>chapter.access_level!=='knowledge'||hasKnowledge(entitlements);
  const byPosition=(a,b)=>Number(a.position)-Number(b.position);

  function safeAssetPath(value){
    const path=String(value||'');
    return /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(path)&&!/(^|\/)\.\.(\/|$)/.test(path)&&!/^[A-Za-z]+:/.test(path)?path:'';
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
    return `<header class="knowledge-title"><span class="knowledge-kicker">Biblioteca</span><h1>Área de Conhecimento</h1><p>Conhecimento para transformar organização em direção.</p></header><div class="knowledge-library">${publications.map(publication=>{
      const percent=publicationProgress(publication.id,chapters,progress),started=percent>0;
      return `<article class="knowledge-publication-card">${publication.cover_path?`<img class="knowledge-cover" src="${safe(safeAssetPath(publication.cover_path))}" alt="Capa de ${safe(publication.title)}">`:`<div class="knowledge-cover knowledge-cover-placeholder" aria-hidden="true">MB</div>`}<div><span class="knowledge-kicker">${safe(publication.publication_type||'Publicação')}</span><h2>${safe(publication.title)}</h2>${publication.subtitle?`<p class="knowledge-subtitle">${safe(publication.subtitle)}</p>`:''}<p>${safe(publication.description||'')}</p><div class="knowledge-progress" aria-label="${percent}% concluído"><span style="width:${percent}%"></span></div><small>${percent}% concluído</small><div class="knowledge-actions"><button class="btn gold" data-knowledge-action="open-publication" data-id="${safe(publication.id)}">${started?'Continuar leitura':'Começar leitura'}</button></div></div></article>`;
    }).join('')}</div>`;
  }

  function renderToc(state,publicationId){
    const publication=state.publications.find(item=>item.id===publicationId);
    if(!publication)return renderLibrary(state);
    const parts=state.parts.filter(item=>item.publication_id===publicationId).sort(byPosition);
    const chapters=state.chapters.filter(item=>item.publication_id===publicationId),entitled=hasKnowledge(state.entitlements);
    return `<div class="knowledge-toolbar"><button class="btn" data-knowledge-action="library">← Biblioteca</button><button class="btn" data-knowledge-action="bookmarks">Meus favoritos</button></div><header class="knowledge-title compact"><span class="knowledge-kicker">Sumário</span><h1>${safe(publication.title)}</h1><p>${safe(publication.subtitle||publication.description||'')}</p></header><form class="knowledge-search" data-knowledge-search><label class="sr-only" for="knowledgeSearch">Buscar conteúdo autorizado</label><input id="knowledgeSearch" name="query" minlength="2" maxlength="160" placeholder="Buscar na biblioteca"><button class="btn" type="submit">Buscar</button></form><div class="knowledge-toc">${parts.map(part=>`<section><h2>Parte ${safe(part.position)} · ${safe(part.title)}</h2>${chapters.filter(chapter=>chapter.part_id===part.id).sort(byPosition).map(chapter=>{
      const allowed=chapterAllowed(chapter,state.entitlements),item=progressFor(chapter.id,state.progress),status=progressLabel(item);
      return `<article class="knowledge-chapter-row ${allowed?'':'locked'}"><div><span class="knowledge-status">${chapter.access_level==='sample'?'Amostra':allowed?status:'Bloqueado'}</span><h3>${safe(chapter.title)}</h3>${chapter.subtitle?`<p>${safe(chapter.subtitle)}</p>`:''}<small>${safe(chapter.estimated_read_minutes)} min de leitura</small></div><button class="btn ${allowed?'gold':''}" data-knowledge-action="open-chapter" data-id="${safe(chapter.id)}">${allowed?(item?'Continuar':'Ler'):'🔒 Ver acesso'}</button></article>`;
    }).join('')}</section>`).join('')}</div>${!entitled?renderPaywall():''}`;
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
    return `<div class="knowledge-reader"><nav class="knowledge-toolbar"><button class="btn" data-knowledge-action="open-publication" data-id="${safe(chapter.publication_id)}">← Sumário</button>${actions}</nav><header><span class="knowledge-kicker">${allowed&&chapter.access_level!=='sample'?'Leitura':'Amostra'}</span><h1>${safe(chapter.title)}</h1>${chapter.subtitle?`<p>${safe(chapter.subtitle)}</p>`:''}${allowed?`<div class="knowledge-progress"><span style="width:${Number(progress?.progress_percent||0)}%"></span></div>`:''}</header><article class="knowledge-reading-body">${visibleSections.map(renderSection).join('')}</article>${footer}</div>`;
  }

  function renderPaywall(chapter){
    return `<section class="knowledge-paywall"><span class="knowledge-lock" aria-hidden="true">◆</span><h2>Este conteúdo faz parte da Área de Conhecimento Mentoria Black.</h2>${chapter?`<p>${safe(chapter.excerpt||'O corpo completo deste capítulo é protegido.')}</p>`:'<p>Leia a amostra gratuita ou libere a biblioteca completa.</p>'}<div class="knowledge-actions"><button class="btn gold" data-knowledge-action="checkout" data-offer="knowledge">Adquirir Livro Digital</button><button class="btn" data-knowledge-action="checkout" data-offer="complete">Conhecer Mentoria Black Completa</button></div></section>`;
  }

  function renderBookmarks(state){
    return `<div class="knowledge-toolbar"><button class="btn" data-knowledge-action="library">← Biblioteca</button></div><header class="knowledge-title compact"><h1>Meus favoritos</h1><p>Capítulos salvos para continuar depois.</p></header><div class="knowledge-toc">${state.bookmarks.length?state.bookmarks.map(bookmark=>{
      const chapter=state.chapters.find(item=>item.id===bookmark.chapter_id);
      return chapter?`<article class="knowledge-chapter-row"><div><h3>${safe(chapter.title)}</h3><small>${safe(chapter.estimated_read_minutes)} min</small></div><button class="btn" data-knowledge-action="open-chapter" data-id="${safe(chapter.id)}">Abrir</button></article>`:'';
    }).join(''):'<section class="knowledge-empty"><p>Você ainda não adicionou favoritos.</p></section>'}</div>`;
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

  function createKnowledgeArea({client,entitlements,checkout,notify}={}){
    const repository=createRepository(client),state={publications:[],parts:[],chapters:[],sections:[],progress:[],bookmarks:[],entitlements:entitlements||{knowledge:{hasAccess:false}},currentPublication:null,currentChapter:null},message=typeof notify==='function'?notify:()=>{};
    let rootElement=null;
    function show(html){if(rootElement)rootElement.innerHTML=html}
    async function refresh(){Object.assign(state,await repository.catalog());show(renderLibrary(state))}
    async function openPublication(id){state.currentPublication=id;show(renderToc(state,id))}
    async function openChapter(id){
      const chapter=state.chapters.find(item=>item.id===id);
      if(!chapter)return;
      state.currentPublication=chapter.publication_id;state.currentChapter=id;
      state.sections=await repository.sections(id);
      show(renderReader(state,id));
      if(chapterAllowed(chapter,state.entitlements)&&state.sections.length){
        const last=state.sections[0];
        await repository.progress(chapter.publication_id,id,Math.max(1,Number(progressFor(id,state.progress)?.progress_percent||0)),last.id,false);
      }
    }
    async function act(button){
      const action=button.dataset.knowledgeAction,id=button.dataset.id;
      if(action==='library')return show(renderLibrary(state));
      if(action==='open-publication')return openPublication(id);
      if(action==='open-chapter'&&id)return openChapter(id);
      if(action==='bookmarks')return show(renderBookmarks(state));
      if(action==='checkout'&&typeof checkout==='function')return checkout(button.dataset.offer);
      if(action==='toggle-bookmark'){
        const chapter=state.chapters.find(item=>item.id===id);if(!chapter)return;
        await repository.bookmark(chapter.publication_id,id,null,button.dataset.enabled==='true');
        Object.assign(state,await repository.catalog());message('Favoritos atualizados.');return openChapter(id);
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
      rootElement.onsubmit=event=>{
        if(!event.target.matches('[data-knowledge-search]'))return;
        event.preventDefault();const query=new FormData(event.target).get('query');
        repository.search(String(query||'')).then(results=>show(renderSearch(state,results,query))).catch(error=>message(error.message,true));
      };
      await refresh();return state;
    }
    return Object.freeze({mount,refresh,state,openPublication,openChapter});
  }

  return {safe,safeAssetPath,renderSection,renderLibrary,renderToc,renderReader,renderPaywall,renderBookmarks,renderSearch,createRepository,createKnowledgeArea,chapterAllowed,publicationProgress};
});
