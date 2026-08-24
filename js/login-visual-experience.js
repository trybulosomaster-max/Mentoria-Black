(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(root)root.MBLoginVisualExperience=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  const STYLES=new Set(["static","motion"]);
  const requestedStyle=search=>{
    const value=new URLSearchParams(search||"").get("loginStyle");
    return STYLES.has(value)?value:"static";
  };
  const resolvedStyle=(search,reducedMotion)=>reducedMotion?"static":requestedStyle(search);
  const initialize=({document:doc=globalThis.document,window:win=globalThis.window}={})=>{
    if(!doc?.body||!win)return "static";
    const reduced=Boolean(win.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    const style=resolvedStyle(win.location?.search,reduced);
    doc.body.classList.remove("login-style-static","login-style-motion");
    doc.body.classList.add(`login-style-${style}`);
    if(style!=="motion"||!win.matchMedia?.("(pointer: fine)").matches)return style;
    let frame=0,lastEvent;
    const update=()=>{
      frame=0;
      const x=Math.max(-1,Math.min(1,(lastEvent.clientX/win.innerWidth-.5)*2));
      const y=Math.max(-1,Math.min(1,(lastEvent.clientY/win.innerHeight-.5)*2));
      doc.body.style.setProperty("--login-parallax-x",`${(x*7).toFixed(2)}px`);
      doc.body.style.setProperty("--login-parallax-y",`${(y*7).toFixed(2)}px`);
    };
    win.addEventListener("pointermove",event=>{
      lastEvent=event;
      if(!frame)frame=win.requestAnimationFrame(update);
    },{passive:true});
    return style;
  };
  const boot=()=>initialize();
  if(typeof document!=="undefined"){
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
    else boot();
  }
  return {requestedStyle,resolvedStyle,initialize};
});
