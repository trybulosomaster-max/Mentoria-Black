(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MBKnowledgeReader=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const THEMES=new Set(['dark','light','sepia']);
  const FONT_SIZES=new Set(['small','medium','large','x-large']);
  const LINE_HEIGHTS=new Set(['compact','comfortable','airy']);
  const WIDTHS=new Set(['narrow','comfortable','wide']);
  const DEFAULT_PREFERENCES=Object.freeze({theme:'dark',fontSize:'medium',lineHeight:'comfortable',width:'comfortable'});
  const clone=value=>JSON.parse(JSON.stringify(value));
  const safeScope=value=>String(value||'device').replace(/[^a-z0-9_-]/gi,'-').slice(0,80)||'device';

  function normalizePreferences(value={}){
    return Object.freeze({
      theme:THEMES.has(value.theme)?value.theme:DEFAULT_PREFERENCES.theme,
      fontSize:FONT_SIZES.has(value.fontSize)?value.fontSize:DEFAULT_PREFERENCES.fontSize,
      lineHeight:LINE_HEIGHTS.has(value.lineHeight)?value.lineHeight:DEFAULT_PREFERENCES.lineHeight,
      width:WIDTHS.has(value.width)?value.width:DEFAULT_PREFERENCES.width
    });
  }

  function normalizeAnnotation(value){
    if(!value||typeof value!=='object')return null;
    const kind=['highlight','underline','note'].includes(value.kind)?value.kind:'highlight';
    const start=Number(value.start),end=Number(value.end),quote=String(value.quote||'').trim();
    if(!value.id||!value.chapterId||!value.sectionId||!quote||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start)return null;
    return Object.freeze({
      id:String(value.id),publicationId:String(value.publicationId||''),chapterId:String(value.chapterId),sectionId:String(value.sectionId),
      quote:quote.slice(0,1200),start,end,kind,note:String(value.note||'').slice(0,4000),createdAt:String(value.createdAt||''),updatedAt:String(value.updatedAt||'')
    });
  }

  function createReaderStore({storage,scope='device',now=()=>new Date().toISOString(),idFactory}={}){
    const target=storage&&typeof storage.getItem==='function'&&typeof storage.setItem==='function'?storage:null;
    const key=`aviora_knowledge_reader_v1:${safeScope(scope)}`;
    const makeId=idFactory||(()=>globalThis.crypto?.randomUUID?.()||`annotation-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    function read(){
      if(!target)return {preferences:clone(DEFAULT_PREFERENCES),positions:{},annotations:[]};
      try{
        const value=JSON.parse(target.getItem(key)||'{}');
        return {
          preferences:clone(normalizePreferences(value.preferences)),positions:value.positions&&typeof value.positions==='object'?value.positions:{},
          annotations:Array.isArray(value.annotations)?value.annotations.map(normalizeAnnotation).filter(Boolean):[]
        };
      }catch(_error){return {preferences:clone(DEFAULT_PREFERENCES),positions:{},annotations:[]}}
    }
    function write(value){if(target)target.setItem(key,JSON.stringify(value));return value}
    function preferences(next){const state=read();if(next===undefined)return normalizePreferences(state.preferences);state.preferences=clone(normalizePreferences({...state.preferences,...next}));write(state);return normalizePreferences(state.preferences)}
    function position(chapterId,next){
      const state=read(),id=String(chapterId||'');if(!id)return null;
      if(next===undefined)return state.positions[id]||null;
      const value={sectionId:String(next.sectionId||''),offsetRatio:Math.max(0,Math.min(1,Number(next.offsetRatio)||0)),updatedAt:now()};
      state.positions[id]=value;write(state);return Object.freeze({...value});
    }
    function annotations(chapterId){return Object.freeze(read().annotations.filter(item=>!chapterId||item.chapterId===String(chapterId)))}
    function addAnnotation(input){
      const state=read(),timestamp=now(),item=normalizeAnnotation({...input,id:makeId(),createdAt:timestamp,updatedAt:timestamp});
      if(!item)throw new TypeError('A valid reader selection is required');
      state.annotations.push(item);write(state);return item;
    }
    function updateAnnotation(id,patch={}){
      const state=read(),index=state.annotations.findIndex(item=>item.id===String(id));if(index<0)return null;
      const item=normalizeAnnotation({...state.annotations[index],note:patch.note??state.annotations[index].note,kind:patch.kind??state.annotations[index].kind,updatedAt:now()});
      state.annotations[index]=item;write(state);return item;
    }
    function removeAnnotation(id){const state=read(),before=state.annotations.length;state.annotations=state.annotations.filter(item=>item.id!==String(id));write(state);return state.annotations.length<before}
    return Object.freeze({key,preferences,position,annotations,addAnnotation,updateAnnotation,removeAnnotation});
  }

  function textOffsetWithin(root,node,offset){
    const doc=root?.ownerDocument;if(!doc||!node)return -1;
    const range=doc.createRange();range.selectNodeContents(root);range.setEnd(node,offset);return range.toString().length;
  }

  function captureSelection(selection,readingRoot){
    if(!selection||selection.rangeCount!==1||selection.isCollapsed||!readingRoot)return null;
    const range=selection.getRangeAt(0),section=range.commonAncestorContainer.nodeType===1
      ?range.commonAncestorContainer.closest?.('[data-knowledge-section-id]')
      :range.commonAncestorContainer.parentElement?.closest?.('[data-knowledge-section-id]');
    if(!section||!readingRoot.contains(section)||range.startContainer!==range.endContainer||range.startContainer.nodeType!==3)return null;
    const quote=selection.toString().trim();if(!quote)return null;
    const start=textOffsetWithin(section,range.startContainer,range.startOffset),end=textOffsetWithin(section,range.endContainer,range.endOffset);
    if(start<0||end<=start)return null;
    return Object.freeze({sectionId:section.dataset.knowledgeSectionId,quote,start,end});
  }

  function applyAnnotations(readingRoot,items){
    if(!readingRoot?.querySelectorAll)return 0;
    let applied=0;
    const grouped=new Map();
    for(const item of Array.isArray(items)?items:[]){const list=grouped.get(item.sectionId)||[];list.push(item);grouped.set(item.sectionId,list)}
    for(const [sectionId,annotations] of grouped){
      const section=[...readingRoot.querySelectorAll('[data-knowledge-section-id]')].find(node=>node.dataset.knowledgeSectionId===sectionId);if(!section)continue;
      for(const item of annotations.slice().sort((a,b)=>b.start-a.start)){
        const filter=section.ownerDocument.defaultView?.NodeFilter||globalThis.NodeFilter;
        if(!filter)continue;
        const walker=section.ownerDocument.createTreeWalker(section,filter.SHOW_TEXT,{acceptNode:node=>node.parentElement?.closest('.knowledge-annotation-tools')?filter.FILTER_REJECT:filter.FILTER_ACCEPT});
        let cursor=0,node,startNode=null,endNode=null,startOffset=0,endOffset=0;
        while((node=walker.nextNode())){
          const next=cursor+node.data.length;
          if(!startNode&&item.start>=cursor&&item.start<=next){startNode=node;startOffset=item.start-cursor}
          if(item.end>=cursor&&item.end<=next){endNode=node;endOffset=item.end-cursor;break}
          cursor=next;
        }
        if(!startNode||startNode!==endNode)continue;
        const selected=startNode.splitText(startOffset),tail=selected.splitText(Math.max(0,endOffset-startOffset));
        const mark=section.ownerDocument.createElement(item.kind==='underline'?'span':'mark');
        mark.className=`knowledge-user-annotation ${item.kind}`;mark.dataset.annotationId=item.id;
        mark.title=item.note||({highlight:'Trecho grifado',underline:'Trecho sublinhado',note:'Trecho com nota'})[item.kind];
        selected.parentNode.insertBefore(mark,selected);mark.appendChild(selected);void tail;applied+=1;
      }
    }
    return applied;
  }

  return Object.freeze({DEFAULT_PREFERENCES,normalizePreferences,normalizeAnnotation,createReaderStore,captureSelection,applyAnnotations});
});
