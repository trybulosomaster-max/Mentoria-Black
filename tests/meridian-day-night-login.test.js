'use strict';

const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const login=require('../js/meridian-day-night-login');
const betaArtifact=require('../scripts/prepare-beta-artifact');

let assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions++;assert.strictEqual(actual,expected,message)};

class Target{
  constructor(){this.listeners={};this.attributes={};this.dataset={}}
  addEventListener(type,handler){(this.listeners[type]||(this.listeners[type]=new Set())).add(handler)}
  removeEventListener(type,handler){if(this.listeners[type])this.listeners[type].delete(handler)}
  dispatch(type){for(const handler of this.listeners[type]||[])handler({type,target:this})}
  setAttribute(name,value){this.attributes[name]=String(value);if(name==='src')this.src=String(value)}
  getAttribute(name){return this.attributes[name]||null}
}

function localDate(hour,minute){return new Date(2026,7,24,hour,minute,0,0)}

equal(login.themeForDate(localDate(5,59)),'night','05:59 is night');
equal(login.themeForDate(localDate(6,0)),'day','06:00 is day');
equal(login.themeForDate(localDate(17,59)),'day','17:59 is day');
equal(login.themeForDate(localDate(18,0)),'night','18:00 is night');
equal(login.nextBoundary(localDate(5,59)).getHours(),6,'night schedules the 06:00 boundary');
equal(login.nextBoundary(localDate(17,59)).getHours(),18,'day schedules the 18:00 boundary');
equal(login.millisecondsUntilNextBoundary(localDate(5,59)),60000,'05:59 schedules one minute, without polling');
equal(login.millisecondsUntilNextBoundary(localDate(17,59)),60000,'17:59 schedules one minute, without polling');

equal(login.orientationForWidth(390),'mobile','390px uses the approved vertical asset');
equal(login.orientationForWidth(600),'mobile','600px remains mobile at the breakpoint');
equal(login.orientationForWidth(601),'desktop','601px selects the wide asset');
const assets={day:{mobile:'day-mobile.png',desktop:'day-desktop.png'},night:{mobile:'night-mobile.png',desktop:'night-desktop.png'}};
assertions++;
assert.deepStrictEqual(login.selectAssets(assets,390),{orientation:'mobile',day:'day-mobile.png',night:'night-mobile.png'},'mobile loads only the day/night mobile pair');
assertions++;
assert.deepStrictEqual(login.selectAssets(assets,1440),{orientation:'desktop',day:'day-desktop.png',night:'night-desktop.png'},'desktop loads only the day/night desktop pair');

function themeHarness(initialNow,width){
  const dayImage=new Target(),nightImage=new Target(),root=new Target(),doc=new Target(),win=new Target();
  doc.documentElement=root;doc.visibilityState='visible';
  win.innerWidth=width;win.location={search:'?theme=night'};
  const timers=[],cleared=[];
  let now=initialNow;
  const controller=login.initializeTheme({
    root,dayImage,nightImage,document:doc,window:win,assets,
    now:()=>now,
    setTimeout:(callback,delay)=>{const timer={id:timers.length+1,callback,delay};timers.push(timer);return timer.id},
    clearTimeout:id=>cleared.push(id),
    console:{error:message=>harness.errors.push(message)}
  });
  const harness={controller,root,doc,win,dayImage,nightImage,timers,cleared,errors:[],setNow:value=>{now=value}};
  return harness;
}

const runtime=themeHarness(localDate(6,0),390);
equal(runtime.root.dataset.theme,'day','runtime uses local time and ignores a query-string theme');
equal(runtime.root.dataset.orientation,'mobile','runtime publishes the selected orientation');
equal(runtime.dayImage.src,'day-mobile.png','runtime loads the mobile day asset');
equal(runtime.nightImage.src,'night-mobile.png','runtime loads the mobile night asset for crossfade/fallback');
equal(runtime.timers.length,1,'runtime keeps one efficient boundary timer');
equal(runtime.timers[0].delay,12*60*60*1000,'06:00 schedules directly to 18:00');

runtime.setNow(localDate(18,0));
runtime.timers[0].callback();
equal(runtime.root.dataset.theme,'night','boundary timer automatically switches to night');
equal(runtime.timers.length,2,'boundary callback schedules exactly the next boundary');
equal(runtime.timers[1].delay,12*60*60*1000,'18:00 schedules directly to next 06:00');

runtime.setNow(localDate(12,0));
runtime.doc.visibilityState='hidden';
runtime.doc.dispatch('visibilitychange');
equal(runtime.root.dataset.theme,'night','a hidden-tab event does not perform unnecessary work');
runtime.doc.visibilityState='visible';
runtime.doc.dispatch('visibilitychange');
equal(runtime.root.dataset.theme,'day','returning to a visible tab recalculates the theme');
runtime.setNow(localDate(19,0));
runtime.win.dispatch('focus');
equal(runtime.root.dataset.theme,'night','window focus recalculates the theme');

runtime.win.innerWidth=1440;
runtime.win.dispatch('resize');
equal(runtime.root.dataset.orientation,'desktop','resize changes asset orientation');
equal(runtime.dayImage.src,'day-desktop.png','resize replaces mobile day with desktop day');
equal(runtime.nightImage.src,'night-desktop.png','resize replaces mobile night with desktop night');

runtime.root.dataset.theme='day';
runtime.setNow(localDate(12,0));
runtime.dayImage.dispatch('error');
equal(runtime.root.dataset.theme,'night','failed current asset activates the alternate-theme fallback');
equal(runtime.root.dataset.themeFallback,'true','fallback state is explicit');
equal(runtime.errors[0],'[MeridianLogin] Theme image unavailable; safe fallback activated.','asset error log is fixed and contains no URL or PII');
runtime.dayImage.dispatch('load');
equal(runtime.root.dataset.theme,'day','a recovered intended asset restores the scheduled theme');

runtime.controller.destroy();
ok(runtime.cleared.length>0,'destroy clears the scheduled boundary timer');
equal(runtime.doc.listeners.visibilitychange.size,0,'destroy removes the visibility listener');
equal(runtime.win.listeners.focus.size,0,'destroy removes the focus listener');

const forced=themeHarness(localDate(12,0),1440);
forced.controller.destroy();
const forcedRoot=new Target(),forcedDoc=new Target(),forcedWin=new Target();
forcedDoc.documentElement=forcedRoot;forcedDoc.visibilityState='visible';forcedWin.innerWidth=1440;
let forcedTimers=0;
const forcedController=login.initializeTheme({root:forcedRoot,document:forcedDoc,window:forcedWin,assets,forcedTheme:'night',now:()=>localDate(12,0),setTimeout:()=>{forcedTimers++;return 1},clearTimeout:()=>{}});
equal(forcedRoot.dataset.theme,'night','preview can explicitly force night');
equal(forcedTimers,0,'forced preview theme does not schedule automatic time changes');
forcedController.destroy();

function storageHarness(initial){
  const values=new Map(initial||[]),operations=[];
  return {
    values,operations,
    getItem(key){operations.push(['get',key]);return values.has(key)?values.get(key):null},
    setItem(key,value){operations.push(['set',key,String(value)]);values.set(key,String(value))},
    removeItem(key){operations.push(['remove',key]);values.delete(key)}
  };
}

const storage=storageHarness([[login.STORAGE_KEY,'owner@example.test']]);
const email=new Target(),checkbox=new Target();email.value='';checkbox.checked=false;
const remember=login.initializeRememberEmail({emailInput:email,checkbox,storage});
equal(email.value,'owner@example.test','remembered email is restored on load');
equal(checkbox.checked,true,'checkbox reflects an existing remembered email');
checkbox.checked=false;checkbox.dispatch('change');
equal(storage.values.has(login.STORAGE_KEY),false,'unchecking removes the remembered email immediately');
email.value='next@example.test';checkbox.checked=true;
equal(remember.persist(),true,'successful login may persist the opted-in email');
equal(storage.values.get(login.STORAGE_KEY),'next@example.test','only the normalized email is stored');
ok(storage.operations.every(operation=>operation[1]===login.STORAGE_KEY),'remember feature touches only its approved storage key');
ok(!JSON.stringify(storage.operations).match(/password|access.?token|refresh.?token|session|grant/i),'remember feature never writes password, token, session, or grant data');
remember.destroy();

const password=new Target(),eye=new Target();password.type='text';
const eyeController=login.initializePasswordToggle({passwordInput:password,button:eye});
equal(password.type,'password','password is hidden when the login initializes');
equal(eye.attributes['aria-label'],'Mostrar senha','eye starts with an accessible show label');
eye.dispatch('click');
equal(password.type,'text','eye reveals the password');
equal(eye.attributes['aria-label'],'Ocultar senha','eye announces the hide action');
equal(eye.attributes['aria-pressed'],'true','eye exposes its pressed state');
eye.dispatch('click');
equal(password.type,'password','second eye activation hides the password');
eyeController.destroy();

const fieldInput=new Target(),fieldShell={classList:{values:new Set(),toggle(name,enabled){enabled?this.values.add(name):this.values.delete(name)}}};
fieldInput.value='';fieldInput.closest=selector=>selector==='.meridian-field-shell'?fieldShell:null;
const fieldState=login.initializeFieldState(fieldInput);
equal(fieldShell.classList.values.has('has-value'),false,'empty functional field leaves the baked placeholder visible');
fieldInput.value='typed@example.test';fieldInput.dispatch('input');
equal(fieldShell.classList.values.has('has-value'),true,'typed value masks only the baked placeholder area');
fieldInput.value='';fieldInput.dispatch('input');
equal(fieldShell.classList.values.has('has-value'),false,'clearing a field restores the approved baked placeholder');
fieldState.destroy();

const restrictedWindow=new Target(),restrictedDocument=new Target(),restrictedRoot=new Target();
restrictedWindow.innerWidth=1440;
Object.defineProperty(restrictedWindow,'localStorage',{get(){throw new Error('SecurityError')}});
restrictedDocument.documentElement=restrictedRoot;restrictedDocument.visibilityState='visible';restrictedDocument.querySelector=()=>null;
const restrictedController=login.initialize({
  root:restrictedRoot,document:restrictedDocument,window:restrictedWindow,assets,
  now:()=>localDate(12,0),setTimeout:()=>1,clearTimeout:()=>{}
});
equal(restrictedController.theme.getTheme(),'day','restricted localStorage cannot abort visual or authentication initialization');
restrictedController.destroy();

const source=fs.readFileSync(path.join(__dirname,'../js/meridian-day-night-login.js'),'utf8');
ok(!source.includes('URLSearchParams')&&!source.includes('location.search'),'production module never reads preview query parameters');
equal((source.match(/\.setItem\(/g)||[]).length,1,'module has one narrowly scoped storage write site');
ok(source.includes("setData(rootElement,'theme',active)"),'crossfade contract is driven by data-theme');

const root=path.resolve(__dirname,'..');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const preview=fs.readFileSync(path.join(root,'aviora-v82.preview.local.html'),'utf8');
const css=fs.readFileSync(path.join(root,'assets/meridian-black-day-night-login.css'),'utf8')+'\n'+fs.readFileSync(path.join(root,'assets/aviora-v82.css'),'utf8');
const assetHashes={'assets/branding/aviora-login-hero.jpg':'3a9d0834f30e21433ecf66d70e6fdf86a7f38aa2ddf11d64a69c15a3dcd86933'};
for(const [asset,expectedHash] of Object.entries(assetHashes)){
  const bytes=fs.readFileSync(path.join(root,asset));
  equal(crypto.createHash('sha256').update(bytes).digest('hex'),expectedHash,`${asset} remains byte-identical to the approved official mark`);
  ok(index.includes(`${asset}\"`),`${asset} is explicitly reachable from production HTML`);
}
const collected=betaArtifact.localAssets(index);
for(const asset of Object.keys(assetHashes))ok(collected.includes(asset),`Beta artifact collector includes ${asset}`);
const syncopateFont='assets/fonts/syncopate/Syncopate-Regular.ttf';
equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,syncopateFont))).digest('hex'),'fcbb10798b80c981afabaa1055bde2ee29b283069b44cdfc68457e903a056ac1','Syncopate Regular remains the reviewed local source asset');
ok(fs.readFileSync(path.join(root,'assets/fonts/syncopate/LICENSE.txt'),'utf8').includes('Apache License'),'local Syncopate distribution retains its Apache-2.0 license');
ok(index.includes(`href="${syncopateFont}"`),'production HTML preloads the local wordmark font without a network dependency');
ok(collected.includes(syncopateFont),'Beta artifact collector includes the local wordmark font');
ok(index.includes('id="loginEmail" type="email" autocomplete="email"'),'production email keeps semantic autocomplete');
ok(index.includes('id="loginPassword" type="password" autocomplete="current-password"'),'production password is initially hidden and keeps native autocomplete');
ok(index.includes('id="togglePassword" type="button" aria-label="Mostrar senha"'),'eye is a non-submit accessible control');
ok(index.includes('id="rememberEmail" type="checkbox"'),'remember-email remains opt-in');
ok(index.includes('window.MBMeridianLoginController?.recordSuccessfulLogin(email);'),'successful production authentication records only the opted-in email');
const activeLoginStart=index.lastIndexOf('$("loginForm").onsubmit=async e=>'),activeLoginEnd=index.indexOf('$("logout").onclick',activeLoginStart),activeLogin=index.slice(activeLoginStart,activeLoginEnd);
ok(activeLogin.includes('MBCommercialAccess.authErrorMessage(error)'),'active production login translates the Auth error before rendering it');
ok(!activeLogin.includes('error.message'),'active production login never renders the raw Supabase Auth message');
ok(activeLogin.indexOf('if(error)')<activeLogin.indexOf('window.MBMeridianLoginController?.recordSuccessfulLogin(email);'),'failed authentication exits before remember-email persistence');
ok(index.indexOf('window.MBMeridianLoginController?.recordSuccessfulLogin(email);')<index.indexOf('USER=data.user;\n    await window.start();'),'remember-email does not alter the existing server_now startup chain');
ok(!index.includes('URLSearchParams')&&!index.includes('?theme='),'production HTML has no preview theme override');
ok(preview.includes("new URLSearchParams(location.search)")&&preview.includes("params.get('theme')||'auto'"),'only the local preview recognizes a forced theme');
ok(preview.includes("theme==='day'||theme==='night'"),'preview rejects unsupported forced-theme values');
ok(!/supabase|service[_-]?role|access[_-]?token|refresh[_-]?token/i.test(preview),'preview performs no real authentication and embeds no privileged credential');
ok(css.includes('@media (max-width: 600px)'),'mobile layout has a dedicated responsive contract');
ok(css.includes('.aviora-login-hero .meridian-theme-image')&&css.includes('object-fit: contain'),'official mark scales proportionally without cropping or distortion');
ok(css.includes('rgba(8,10,8,.56)')&&css.includes('backdrop-filter: blur(15px)'),'login remains a real translucent glass surface');
ok(css.includes('scroll-padding-bottom: calc(40px + env(safe-area-inset-bottom))'),'mobile preserves natural Safari scroll clearance');
ok(css.includes('height: clamp(310px, 44dvh, 400px)'),'mobile reserves a larger proportional hero stage above the card');
ok(index.includes('AVIORA')&&index.includes('GESTÃO FINANCEIRA'),'real semantic AVIORA branding is layered over the existing hero');
ok(index.includes('assets/branding/aviora-login-hero.jpg')&&index.includes('Águia dourada da AVIORA'),'approved circle-free AVIORA hero is used without a recreated mark');
ok(!index.includes('assets/login/meridian-')&&!preview.includes('assets/login/meridian-'),'active login and preview no longer use hand/physical-compass artwork');
ok(!index.includes('aviora-login-logo')&&!preview.includes('aviora-login-logo'),'card does not duplicate the large hero mark');
ok(index.includes('Bem-vindo de volta')&&index.includes('Acesse sua conta para continuar'),'real welcome copy is available to assistive technology');
ok(index.includes('class="meridian-login-options"'),'remember-email and recovery controls share the secondary row');
ok(css.includes('@font-face')&&css.includes('font-family: "Meridian Syncopate"'),'official wordmark uses the bundled local geometric typeface');
ok(css.includes('font-family: "Meridian Syncopate"')&&css.includes('font-weight: 400')&&css.includes('letter-spacing: .135em'),'official desktop wordmark retains the approved Syncopate treatment');
ok(css.includes('letter-spacing: .125em')&&css.includes('text-indent: .125em'),'official mobile wordmark retains the approved tracking');
ok(css.includes('font-weight: 400')&&css.includes('letter-spacing: .27em')&&css.includes('letter-spacing: .24em'),'Financial Management remains visually subordinate on desktop and mobile');
ok(!index.includes('data-brand-font')&&!preview.includes('brandfont'),'temporary current/reference typography switching is fully removed');
ok(css.includes('padding-bottom: calc(72px + env(safe-area-inset-bottom))'),'mobile layout reserves explicit Safari safe-area clearance below Create account');
ok(css.includes('overflow-x: hidden')&&css.includes('overflow-y: auto'),'mobile allows natural vertical scrolling while preventing horizontal overflow');
ok(css.includes('.aviora-login-hero {')&&css.includes('width: min(62vw, 1080px)'),'desktop keeps the AVIORA mark as a large independent hero');
ok(css.includes('@media (prefers-reduced-motion: reduce)'),'reduced-motion disables the crossfade');
ok(css.includes('min-width: 44px')&&css.includes('min-height: 44px'),'password eye has a 44px minimum touch target');
ok(!css.includes('.aviora-login-hero .meridian-theme-image {\n  filter:')&&!/rotate\s*\(|parallax|canvas|webgl/i.test(css),'login hero receives no destructive filter, rotation, parallax, canvas, or WebGL treatment');

console.log(`meridian-day-night-login: ${assertions} assertions passed`);
