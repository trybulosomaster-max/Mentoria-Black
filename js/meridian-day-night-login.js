(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.MBMeridianDayNightLogin=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const STORAGE_KEY='meridian_black_remembered_email';
  const MOBILE_BREAKPOINT=600;
  const THEMES=['day','night'];

  function validTheme(value){return THEMES.includes(value)?value:null}

  function themeForDate(value){
    const date=value instanceof Date?value:new Date(value);
    const hour=date.getHours();
    return hour>=6&&hour<18?'day':'night';
  }

  function nextBoundary(value){
    const date=value instanceof Date?new Date(value.getTime()):new Date(value);
    const next=new Date(date.getTime());
    if(date.getHours()<6){
      next.setHours(6,0,0,0);
    }else if(date.getHours()<18){
      next.setHours(18,0,0,0);
    }else{
      next.setDate(next.getDate()+1);
      next.setHours(6,0,0,0);
    }
    return next;
  }

  function millisecondsUntilNextBoundary(value){
    const date=value instanceof Date?value:new Date(value);
    return Math.max(1,nextBoundary(date).getTime()-date.getTime());
  }

  function orientationForWidth(width){return Number(width)<=MOBILE_BREAKPOINT?'mobile':'desktop'}

  function assetFor(assets,theme,orientation){
    if(!assets)return '';
    if(assets[theme]&&typeof assets[theme]==='object')return assets[theme][orientation]||'';
    const key=theme+orientation[0].toUpperCase()+orientation.slice(1);
    return assets[key]||'';
  }

  function selectAssets(assets,width){
    const orientation=orientationForWidth(width);
    return {
      orientation,
      day:assetFor(assets,'day',orientation),
      night:assetFor(assets,'night',orientation)
    };
  }

  function setImageSource(image,source){
    if(!image||!source)return;
    if(typeof image.getAttribute==='function'&&image.getAttribute('src')===source)return;
    if(typeof image.setAttribute==='function')image.setAttribute('src',source);
    else image.src=source;
  }

  function setData(element,key,value){
    if(!element)return;
    if(element.dataset)element.dataset[key]=String(value);
    else if(typeof element.setAttribute==='function')element.setAttribute('data-'+key.replace(/[A-Z]/g,char=>'-'+char.toLowerCase()),String(value));
  }

  function initializeTheme(options){
    const settings=options||{};
    const doc=settings.document||(typeof document!=='undefined'?document:null);
    const win=settings.window||(typeof window!=='undefined'?window:null);
    const rootElement=settings.root||(doc&&doc.documentElement)||null;
    const dayImage=settings.dayImage||(rootElement&&rootElement.querySelector&&rootElement.querySelector('[data-meridian-theme-image="day"]'));
    const nightImage=settings.nightImage||(rootElement&&rootElement.querySelector&&rootElement.querySelector('[data-meridian-theme-image="night"]'));
    const forcedTheme=validTheme(settings.forcedTheme);
    const getNow=typeof settings.now==='function'?settings.now:()=>new Date();
    const setTimer=settings.setTimeout||(win&&win.setTimeout?win.setTimeout.bind(win):setTimeout);
    const clearTimer=settings.clearTimeout||(win&&win.clearTimeout?win.clearTimeout.bind(win):clearTimeout);
    const logger=settings.console||(typeof console!=='undefined'?console:null);
    const failedThemes=new Set();
    let timer=null;
    let destroyed=false;
    let selectedOrientation='';

    function desiredTheme(){return forcedTheme||themeForDate(getNow())}

    function effectiveTheme(theme){
      const alternate=theme==='day'?'night':'day';
      return failedThemes.has(theme)&&!failedThemes.has(alternate)?alternate:theme;
    }

    function loadCurrentOrientation(){
      const width=settings.viewportWidth?settings.viewportWidth():(win&&Number.isFinite(win.innerWidth)?win.innerWidth:MOBILE_BREAKPOINT+1);
      const selected=selectAssets(settings.assets,width);
      if(selected.orientation===selectedOrientation)return selected;
      selectedOrientation=selected.orientation;
      setData(rootElement,'orientation',selected.orientation);
      setImageSource(dayImage,selected.day);
      setImageSource(nightImage,selected.night);
      return selected;
    }

    function apply(){
      loadCurrentOrientation();
      const intended=desiredTheme();
      const active=effectiveTheme(intended);
      setData(rootElement,'theme',active);
      setData(rootElement,'intendedTheme',intended);
      setData(rootElement,'themeFallback',active!==intended);
      return active;
    }

    function schedule(){
      if(timer!==null){clearTimer(timer);timer=null}
      if(destroyed||forcedTheme)return;
      timer=setTimer(()=>{
        timer=null;
        apply();
        schedule();
      },millisecondsUntilNextBoundary(getNow()));
    }

    function refresh(){
      if(destroyed)return null;
      const theme=apply();
      schedule();
      return theme;
    }

    function onVisibility(){
      if(!doc||doc.visibilityState!=='hidden')refresh();
    }

    function onFocus(){refresh()}
    function onResize(){
      selectedOrientation='';
      apply();
    }

    function onImageError(theme){
      return function(){
        failedThemes.add(theme);
        if(logger&&typeof logger.error==='function')logger.error('[MeridianLogin] Theme image unavailable; safe fallback activated.');
        apply();
      };
    }

    function onImageLoad(theme){
      return function(){
        if(failedThemes.delete(theme))apply();
      };
    }

    const dayError=onImageError('day'),nightError=onImageError('night');
    const dayLoad=onImageLoad('day'),nightLoad=onImageLoad('night');
    if(dayImage&&dayImage.addEventListener){dayImage.addEventListener('error',dayError);dayImage.addEventListener('load',dayLoad)}
    if(nightImage&&nightImage.addEventListener){nightImage.addEventListener('error',nightError);nightImage.addEventListener('load',nightLoad)}
    if(doc&&doc.addEventListener)doc.addEventListener('visibilitychange',onVisibility);
    if(win&&win.addEventListener){win.addEventListener('focus',onFocus);win.addEventListener('resize',onResize)}

    refresh();

    return {
      refresh,
      getTheme:()=>rootElement&&rootElement.dataset?rootElement.dataset.theme:null,
      getOrientation:()=>selectedOrientation,
      destroy(){
        destroyed=true;
        if(timer!==null){clearTimer(timer);timer=null}
        if(doc&&doc.removeEventListener)doc.removeEventListener('visibilitychange',onVisibility);
        if(win&&win.removeEventListener){win.removeEventListener('focus',onFocus);win.removeEventListener('resize',onResize)}
        if(dayImage&&dayImage.removeEventListener){dayImage.removeEventListener('error',dayError);dayImage.removeEventListener('load',dayLoad)}
        if(nightImage&&nightImage.removeEventListener){nightImage.removeEventListener('error',nightError);nightImage.removeEventListener('load',nightLoad)}
      }
    };
  }

  function normalizeEmail(value){
    const email=String(value||'').trim();
    return email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:'';
  }

  function readRememberedEmail(storage){
    if(!storage||typeof storage.getItem!=='function')return '';
    try{return normalizeEmail(storage.getItem(STORAGE_KEY))}catch(_error){return ''}
  }

  function clearRememberedEmail(storage){
    if(!storage||typeof storage.removeItem!=='function')return;
    try{storage.removeItem(STORAGE_KEY)}catch(_error){}
  }

  function persistRememberedEmail(storage,email,remember){
    if(!remember){clearRememberedEmail(storage);return false}
    const normalized=normalizeEmail(email);
    if(!normalized){clearRememberedEmail(storage);return false}
    try{storage.setItem(STORAGE_KEY,normalized);return true}catch(_error){return false}
  }

  function initializeRememberEmail(options){
    const settings=options||{};
    const input=settings.emailInput;
    const checkbox=settings.checkbox;
    let storage=settings.storage;
    if(storage===undefined){
      try{storage=typeof localStorage!=='undefined'?localStorage:null}catch(_error){storage=null}
    }
    const remembered=readRememberedEmail(storage);
    if(input&&remembered)input.value=remembered;
    if(checkbox)checkbox.checked=Boolean(remembered);

    function onChange(){if(checkbox&&!checkbox.checked)clearRememberedEmail(storage)}
    if(checkbox&&checkbox.addEventListener)checkbox.addEventListener('change',onChange);

    return {
      persist(email){return persistRememberedEmail(storage,email===undefined&&input?input.value:email,Boolean(checkbox&&checkbox.checked))},
      clear(){clearRememberedEmail(storage);if(checkbox)checkbox.checked=false},
      destroy(){if(checkbox&&checkbox.removeEventListener)checkbox.removeEventListener('change',onChange)}
    };
  }

  function initializePasswordToggle(options){
    const settings=options||{};
    const input=settings.passwordInput;
    const button=settings.button;
    if(!input||!button)return {destroy(){}};

    function render(visible){
      input.type=visible?'text':'password';
      const label=visible?'Ocultar senha':'Mostrar senha';
      if(typeof button.setAttribute==='function'){
        button.setAttribute('aria-label',label);
        button.setAttribute('aria-pressed',String(visible));
        button.setAttribute('title',label);
      }else{
        button.ariaLabel=label;
        button.ariaPressed=String(visible);
      }
    }
    function onClick(){render(input.type!=='text')}
    render(false);
    if(button.addEventListener)button.addEventListener('click',onClick);
    return {destroy(){if(button.removeEventListener)button.removeEventListener('click',onClick)}};
  }

  function initializeFieldState(input){
    const shell=input&&typeof input.closest==='function'?input.closest('.meridian-field-shell'):null;
    if(!input||!shell||!shell.classList)return {refresh(){},destroy(){}};
    function refresh(){shell.classList.toggle('has-value',Boolean(input.value))}
    if(input.addEventListener)input.addEventListener('input',refresh);
    refresh();
    return {refresh,destroy(){if(input.removeEventListener)input.removeEventListener('input',refresh)}};
  }

  function initialize(options){
    const settings=options||{};
    const doc=settings.document||(typeof document!=='undefined'?document:null);
    const win=settings.window||(typeof window!=='undefined'?window:null);
    const find=selector=>doc&&doc.querySelector?doc.querySelector(selector):null;
    let storage=settings.storage;
    if(storage===undefined){
      try{storage=win&&win.localStorage}catch(_error){storage=null}
    }
    const theme=initializeTheme(Object.assign({},settings,{document:doc,window:win}));
    const remember=initializeRememberEmail({
      emailInput:settings.emailInput||find('#loginEmail'),
      checkbox:settings.rememberCheckbox||find('#rememberEmail'),
      storage
    });
    const eye=initializePasswordToggle({
      passwordInput:settings.passwordInput||find('#loginPassword'),
      button:settings.passwordToggle||find('#togglePassword')
    });
    const emailField=initializeFieldState(settings.emailInput||find('#loginEmail'));
    const passwordField=initializeFieldState(settings.passwordInput||find('#loginPassword'));
    return {
      theme,
      remember,
      eye,
      emailField,
      passwordField,
      recordSuccessfulLogin(email){return remember.persist(email)},
      destroy(){theme.destroy();remember.destroy();eye.destroy();emailField.destroy();passwordField.destroy()}
    };
  }

  return {
    STORAGE_KEY,
    MOBILE_BREAKPOINT,
    themeForDate,
    nextBoundary,
    millisecondsUntilNextBoundary,
    orientationForWidth,
    selectAssets,
    normalizeEmail,
    readRememberedEmail,
    clearRememberedEmail,
    persistRememberedEmail,
    initializeTheme,
    initializeRememberEmail,
    initializePasswordToggle,
    initializeFieldState,
    initialize
  };
});
