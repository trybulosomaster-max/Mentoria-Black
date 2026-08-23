'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const knowledge=require('../knowledge/knowledge-area');

let assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions++;assert.strictEqual(actual,expected,message)};

const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const finalNavMatch=html.match(/window\.__MB_BASE_NAV60__\s*=\s*function\(\)\{([\s\S]*?)\n\s*\};/);
ok(finalNavMatch,'the active V60 navigation renderer exists');

function renderFinalNavigation(profile){
  const nav={
    innerHTML:'',
    attributes:{},
    setAttribute(name,value){this.attributes[name]=value},
    querySelectorAll(){return []}
  };
  const context={
    TAB:'dashboard',
    PROFILE:profile,
    document:{getElementById:id=>id==='nav'?nav:null}
  };
  vm.runInNewContext(`(function(){${finalNavMatch[1]}})()`,context);
  return nav;
}

const profiles=[
  ['authenticated_without_entitlement',{authenticated:true,app:false,knowledge:false,complete:false}],
  ['app_trial',{authenticated:true,app:true,trial:true,knowledge:false,complete:false}],
  ['app_paid',{authenticated:true,app:true,trial:false,knowledge:false,complete:false}],
  ['knowledge',{authenticated:true,app:false,knowledge:true,complete:false}],
  ['complete',{authenticated:true,app:true,knowledge:true,complete:true}],
  ['revoked',{authenticated:true,app:false,knowledge:false,complete:false,revoked:true}]
];

for(const [label,profile] of profiles){
  const nav=renderFinalNavigation(profile);
  ok(nav.innerHTML.includes('data-tab="knowledge"'),`${label} sees the Knowledge entry`);
  ok(nav.innerHTML.includes('>Conhecimento</button>'),`${label} receives the compact navigation label`);
  equal((nav.innerHTML.match(/data-tab="knowledge"/g)||[]).length,1,`${label} receives one Knowledge entry`);
}

const rendererSource=finalNavMatch[1];
ok(!/hasAccess|has_access|COMMERCIAL_STATE|entitlements/.test(rendererSource),'navigation visibility is independent from content entitlement');
ok(rendererSource.includes("['knowledge','Conhecimento']"),'the final runtime list owns the Knowledge entry');
ok(rendererSource.includes("aria-label','Navegação principal'"),'the navigation has an accessible name');
ok(rendererSource.includes("aria-current'"),'the active entry exposes its state to assistive technology');

const mobileCss=html.match(/\.nav\{([^}]+)\}/)?.[1]||'';
ok(mobileCss.includes('overflow-x:auto'),'mobile navigation scrolls horizontally when needed');
ok(mobileCss.includes('-webkit-overflow-scrolling:touch'),'mobile navigation keeps momentum scrolling on Safari/iPhone');
ok(mobileCss.includes('overscroll-behavior-inline:contain'),'horizontal navigation scroll stays contained');
ok(mobileCss.includes('scrollbar-width:thin'),'scrollability remains visually discoverable');

const lockedState={knowledge:{hasAccess:false}};
const fullState={knowledge:{hasAccess:true}};
const sample={access_level:'sample'};
const protectedChapter={access_level:'knowledge'};
equal(knowledge.chapterAllowed(sample,lockedState),true,'sample remains available without KNOWLEDGE');
equal(knowledge.chapterAllowed(protectedChapter,lockedState),false,'protected content remains locked without KNOWLEDGE');
equal(knowledge.chapterAllowed(protectedChapter,fullState),true,'KNOWLEDGE still unlocks protected content');
ok(knowledge.renderPaywall(protectedChapter).includes('Nenhuma cobrança foi realizada.'),'paywall retains the approved non-checkout message');

console.log(`knowledge-navigation: ${profiles.length} profiles, ${assertions} assertions passed`);
