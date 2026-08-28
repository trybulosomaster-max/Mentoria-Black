(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AVIORA_PREVIEW_ADAPTERS=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const PARITY=Object.freeze({
    dashboard:'EQUIVALENT_FIXTURE',
    transactions:'EQUIVALENT_FIXTURE',
    planning:'EQUIVALENT_FIXTURE',
    accounts:'EQUIVALENT_FIXTURE',
    cards:'EQUIVALENT_FIXTURE',
    categories:'EQUIVALENT_FIXTURE',
    goals:'EQUIVALENT_FIXTURE',
    recurring:'EQUIVALENT_FIXTURE',
    wealth:'EQUIVALENT_FIXTURE',
    reports:'EQUIVALENT_FIXTURE',
    knowledge:'SAFE_ADAPTER',
    account:'REAL_RENDERER',
    'reserve-v52':'REQUIRES_AUTHENTICATED_BETA_SMOKE',
    'health-v53':'REQUIRES_AUTHENTICATED_BETA_SMOKE',
    administration:'SAFE_ADAPTER'
  });

  const OWNER_ID='a1000000-0000-4000-8000-000000000001';
  const STAFF_ID='a2000000-0000-4000-8000-000000000002';
  const CUSTOMER_ID='a3000000-0000-4000-8000-000000000003';
  const GRANT_ID='a4000000-0000-4000-8000-000000000004';

  function createAdminModel(contract){
    if(!contract?.normalizeContext)throw new TypeError('AVIORA admin contract is required');
    const context=contract.normalizeContext({is_admin:true,user_id:OWNER_ID,role:'OWNER',status:'active'});
    const management=contract.normalizeManagementDashboard({
      period:{start:'2026-07-28T00:00:00Z',end:'2026-08-27T00:00:00Z'},
      metrics:{
        accounts:9,active_clients:6,monthly_licenses:3,annual_licenses:2,
        lifetime_licenses:1,trial_active:1,
        manual_commercial:{manual:4,commercial:2,unknown:1},
        expiring_30_days:{grants:3,users:2}
      },
      manual_by_actor:[{actor_user_id:STAFF_ID,actor_email:'e2e-staff@invalid.test',actor_role:'STAFF',actor_status:'active',grants:4,monthly:2,annual:2,lifetime:0}],
      manual_activity:[{grant_id:GRANT_ID,product_code:'KNOWLEDGE',license_kind:'monthly',current_status:'revoked',target_user_id:CUSTOMER_ID,target_email:'e2e-customer@invalid.test',granted_by_user_id:STAFF_ID,granted_by_email:'e2e-staff@invalid.test',granted_by_role:'STAFF',granted_by_status:'active',granted_at:'2026-08-26T20:00:00Z',granted_reason:'Motivo sintético de homologação'}]
    });
    return {
      contextPhase:'ready',context,section:'overview',message:'',dialog:null,managementView:'cards',
      management:{phase:'ready',error:null,data:management},
      users:{phase:'idle',query:'',items:[],error:null,filter:null,origin:null,nextCursor:null},
      staff:{phase:'idle',items:[],error:null},
      audit:{phase:'idle',items:[],error:null}
    };
  }

  function buildKnowledgeDatabase(fixture){
    const publicationId='preview-publication',publications=[{id:publicationId,...fixture.publication,publication_type:'book'}],parts=[],chapters=[],sections=[];
    fixture.parts.forEach((part,partIndex)=>{
      const partId=`preview-part-${partIndex+1}`;
      parts.push({id:partId,publication_id:publicationId,position:part.position,title:part.title});
      part.chapters.forEach((chapter,chapterIndex)=>{
        const chapterId=`preview-chapter-${partIndex+1}-${chapterIndex+1}`;
        chapters.push({id:chapterId,publication_id:publicationId,part_id:partId,active:true,...chapter});
        chapter.sections.forEach((section,sectionIndex)=>sections.push({id:`preview-section-${partIndex+1}-${chapterIndex+1}-${sectionIndex+1}`,chapter_id:chapterId,...section}));
      });
    });
    return {knowledge_publications:publications,knowledge_parts:parts,knowledge_chapters:chapters,knowledge_sections:sections,knowledge_progress:[],knowledge_bookmarks:[]};
  }

  function createKnowledgeClient(fixture,{hasAccess=true}={}){
    const database=buildKnowledgeDatabase(fixture);
    function query(table){
      const filters=[];let ascending=true;
      const chain={
        select(){return chain},
        eq(column,value){filters.push([column,value]);return chain},
        order(column,options={}){ascending=options.ascending!==false;return finish(column)},
        then(resolve,reject){return finish().then(resolve,reject)}
      };
      function finish(order){
        let data=(database[table]||[]).filter(row=>filters.every(([key,value])=>row[key]===value));
        if(table==='knowledge_sections'&&!hasAccess)data=data.filter(row=>row.access_level!=='knowledge');
        if(order)data=data.slice().sort((a,b)=>(a[order]>b[order]?1:-1)*(ascending?1:-1));
        return Promise.resolve({data,error:null});
      }
      return chain;
    }
    return Object.freeze({
      from:query,
      async rpc(name,payload){
        if(name==='search_my_knowledge_v1'){
          const value=String(payload.p_query||'').toLocaleLowerCase('pt-BR');
          return {data:database.knowledge_sections.filter(section=>(hasAccess||section.access_level!=='knowledge')&&JSON.stringify(section.content).toLocaleLowerCase('pt-BR').includes(value)).map(section=>{const chapter=database.knowledge_chapters.find(item=>item.id===section.chapter_id);return {chapter_id:chapter.id,chapter_title:chapter.title,snippet:section.content.text||section.content.prompt||''}}),error:null};
        }
        if(name==='save_my_knowledge_progress_v1'){
          const row={publication_id:payload.p_publication_id,chapter_id:payload.p_chapter_id,progress_percent:payload.p_completed?100:payload.p_progress_percent,last_section_id:payload.p_last_section_id,last_read_at:'2026-08-27T12:00:00.000Z',completed_at:payload.p_completed?'2026-08-27T12:00:00.000Z':null};
          database.knowledge_progress=database.knowledge_progress.filter(item=>item.chapter_id!==row.chapter_id).concat(row);return {data:row,error:null};
        }
        if(name==='set_my_knowledge_bookmark_v1'){
          database.knowledge_bookmarks=database.knowledge_bookmarks.filter(item=>!(item.chapter_id===payload.p_chapter_id&&String(item.section_id||'')===String(payload.p_section_id||'')));
          if(payload.p_enabled)database.knowledge_bookmarks.push({id:`bookmark-${payload.p_chapter_id}-${payload.p_section_id||'chapter'}`,publication_id:payload.p_publication_id,chapter_id:payload.p_chapter_id,section_id:payload.p_section_id||null,created_at:'2026-08-27T12:00:00.000Z'});
          return {data:Boolean(payload.p_enabled),error:null};
        }
        return {data:null,error:new Error('Unsupported synthetic knowledge RPC')};
      }
    });
  }

  async function mountKnowledge({root,fixture,renderer,hasAccess=true}){
    if(!root||!renderer?.createKnowledgeArea)throw new TypeError('AVIORA Knowledge renderer is required');
    const app=renderer.createKnowledgeArea({
      client:createKnowledgeClient(fixture,{hasAccess}),
      entitlements:{knowledge:{hasAccess}},
      checkout:()=>({status:'synthetic'}),
      notify:()=>{},preferenceScope:'e2e-preview'
    });
    await app.mount(root);
    return app;
  }

  return Object.freeze({PARITY,createAdminModel,createKnowledgeClient,mountKnowledge});
});
