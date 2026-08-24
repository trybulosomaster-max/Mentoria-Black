(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(root)root.MBLoginPreferences=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  const KEY="mentoria_black_remembered_email";
  const normalizeEmail=value=>{
    const email=String(value??"").trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:"";
  };
  const getStorage=storage=>storage||((typeof window!=="undefined"&&window.localStorage)||null);
  const read=storage=>{
    try{return normalizeEmail(getStorage(storage)?.getItem(KEY))}catch{return ""}
  };
  const clear=storage=>{
    try{getStorage(storage)?.removeItem(KEY)}catch{}
  };
  const write=(email,storage)=>{
    const normalized=normalizeEmail(email);
    if(!normalized){clear(storage);return ""}
    try{getStorage(storage)?.setItem(KEY,normalized)}catch{}
    return normalized;
  };
  const persist=(email,remember,storage)=>remember?write(email,storage):(clear(storage),"");
  const restore=(emailInput,checkbox,storage)=>{
    const email=read(storage);
    if(emailInput)emailInput.value=email;
    if(checkbox)checkbox.checked=Boolean(email);
    return email;
  };
  return {KEY,normalizeEmail,read,write,clear,persist,restore};
});
