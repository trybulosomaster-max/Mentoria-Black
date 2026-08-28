'use strict';
(async()=>{
  const requestedCover=String(new URLSearchParams(location.search).get('cover')||'premium').toLowerCase(),cover=['minimal','premium','book'].includes(requestedCover)?requestedCover:'premium';
  document.getElementById('coverName').textContent=cover;
  const fixture=await fetch('fixtures/mentoria-black.mock.json').then(response=>response.json());
  const ids={publication:'preview-publication'},publications=[{id:ids.publication,...fixture.publication,publication_type:'book'}],parts=[],chapters=[],sections=[];
  fixture.parts.forEach((part,partIndex)=>{
    const partId=`preview-part-${partIndex+1}`;parts.push({id:partId,publication_id:ids.publication,position:part.position,title:part.title});
    part.chapters.forEach((chapter,chapterIndex)=>{
      const chapterId=`preview-chapter-${partIndex+1}-${chapterIndex+1}`;
      chapters.push({id:chapterId,publication_id:ids.publication,part_id:partId,active:true,...chapter});
      chapter.sections.forEach((section,sectionIndex)=>sections.push({id:`preview-section-${partIndex+1}-${chapterIndex+1}-${sectionIndex+1}`,chapter_id:chapterId,...section}));
    });
  });
  const database={knowledge_publications:publications,knowledge_parts:parts,knowledge_chapters:chapters,knowledge_sections:sections,knowledge_progress:[],knowledge_bookmarks:[]};
  function query(table){
    const filters=[];let ascending=true;
    const chain={select(){return chain},eq(column,value){filters.push([column,value]);return chain},order(column,options={}){ascending=options.ascending!==false;return finish(column)},then(resolve,reject){return finish().then(resolve,reject)}};
    function finish(order){let data=(database[table]||[]).filter(row=>filters.every(([key,value])=>row[key]===value));if(table==='knowledge_sections'&&!window.previewKnowledgeAccess)data=data.filter(row=>row.access_level!=='knowledge');if(order)data=data.slice().sort((a,b)=>(a[order]>b[order]?1:-1)*(ascending?1:-1));return Promise.resolve({data,error:null})}
    return chain;
  }
  const client={
    from:query,
    async rpc(name,payload){
      if(name==='search_my_knowledge_v1'){
        const query=String(payload.p_query||'').toLowerCase(),allowed=window.previewKnowledgeAccess;
        return {data:sections.filter(section=>(section.access_level!=='knowledge'||allowed)&&JSON.stringify(section.content).toLowerCase().includes(query)).map(section=>{const chapter=chapters.find(item=>item.id===section.chapter_id);return {chapter_id:chapter.id,chapter_title:chapter.title,snippet:section.content.text||section.content.prompt||''}}),error:null};
      }
      if(name==='save_my_knowledge_progress_v1'){
        const row={publication_id:payload.p_publication_id,chapter_id:payload.p_chapter_id,progress_percent:payload.p_completed?100:payload.p_progress_percent,last_section_id:payload.p_last_section_id,last_read_at:new Date().toISOString(),completed_at:payload.p_completed?new Date().toISOString():null};
        database.knowledge_progress=database.knowledge_progress.filter(item=>item.chapter_id!==row.chapter_id).concat(row);return {data:row,error:null};
      }
      if(name==='set_my_knowledge_bookmark_v1'){
        database.knowledge_bookmarks=database.knowledge_bookmarks.filter(item=>item.chapter_id!==payload.p_chapter_id);
        if(payload.p_enabled)database.knowledge_bookmarks.push({id:`bookmark-${payload.p_chapter_id}`,publication_id:payload.p_publication_id,chapter_id:payload.p_chapter_id,section_id:payload.p_section_id,created_at:new Date().toISOString()});
        return {data:payload.p_enabled,error:null};
      }
      return {data:null,error:new Error('RPC mock desconhecida')};
    }
  };
  const previewRoot=document.getElementById('knowledgePreview');
  function syncPreviewCover(){
    previewRoot.querySelectorAll('.knowledge-cover-official').forEach(coverElement=>{
      coverElement.dataset.cover=cover;
      const image=coverElement.querySelector('img');if(image)image.src='../assets/branding/mentoria-black-icon-512.png';
    });
  }
  new MutationObserver(syncPreviewCover).observe(previewRoot,{childList:true,subtree:true});
  async function mount(access){
    window.previewKnowledgeAccess=access;
    document.getElementById('withAccess').classList.toggle('gold',access);document.getElementById('withoutAccess').classList.toggle('gold',!access);
    await window.MBKnowledgeArea.createKnowledgeArea({client,entitlements:{knowledge:{hasAccess:access}},checkout:offer=>alert(`Checkout mock: ${offer}`),notify:message=>console.info(message),preferenceScope:'knowledge-local-preview'}).mount(previewRoot);syncPreviewCover();
  }
  document.getElementById('withAccess').onclick=()=>mount(true);document.getElementById('withoutAccess').onclick=()=>mount(false);
  await mount(true);
})().catch(error=>{document.getElementById('knowledgePreview').textContent=`Preview indisponível: ${error.message}`;console.error(error)});
