#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const runtime=require('../js/beta-runtime');

function sanitizeIndex(source){
  let replacements=0;
  const sanitized=source.replace(/const SUPABASE_URL="[^"]*";/,()=>{replacements++;return 'const SUPABASE_URL="";';})
    .replace(/const SUPABASE_ANON_KEY="[^"]*";/,()=>{replacements++;return 'const SUPABASE_ANON_KEY="";';});
  if(replacements!==2)throw new Error('expected embedded legacy frontend configuration was not found exactly once');
  return sanitized;
}

function environmentSource(config){
  const state=runtime.resolve({...config,environment:'beta',configured:true});
  if(!state.configured)throw new Error('valid Beta URL and sb_publishable_ key are required');
  return `globalThis.MB_BETA_CONFIG = Object.freeze(${JSON.stringify({environment:'beta',supabaseUrl:state.supabaseUrl,supabasePublishableKey:state.supabasePublishableKey,authRedirectUrl:state.authRedirectUrl,configured:true},null,2)});\n`;
}

function prepareArtifact({rootDir,pathOut,supabaseUrl,supabasePublishableKey,authRedirectUrl}){
  const output=path.resolve(pathOut);
  if(output===path.resolve(rootDir)||path.dirname(output)===output)throw new Error('unsafe Beta artifact output path');
  if(fs.existsSync(output)&&fs.readdirSync(output).length)throw new Error('Beta artifact output directory must be empty');
  fs.mkdirSync(path.join(output,'js'),{recursive:true});
  fs.writeFileSync(path.join(output,'index.html'),sanitizeIndex(fs.readFileSync(path.join(rootDir,'index.html'),'utf8')));
  for(const file of fs.readdirSync(path.join(rootDir,'js'))){
    if(file==='beta-environment.js')continue;
    fs.copyFileSync(path.join(rootDir,'js',file),path.join(output,'js',file));
  }
  fs.writeFileSync(path.join(output,'js','beta-environment.js'),environmentSource({supabaseUrl,supabasePublishableKey,authRedirectUrl}));
  for(const file of ['manifest.webmanifest','sw.js'])fs.copyFileSync(path.join(rootDir,file),path.join(output,file));
  return Object.freeze({output,files:['index.html','manifest.webmanifest','sw.js','js/']});
}

if(require.main===module){
  const rootDir=path.resolve(__dirname,'..');
  const pathOut=process.argv[2]||path.join(rootDir,'dist-beta');
  prepareArtifact({
    rootDir,pathOut,
    supabaseUrl:process.env.MB_BETA_SUPABASE_URL,
    supabasePublishableKey:process.env.MB_BETA_SUPABASE_PUBLISHABLE_KEY,
    authRedirectUrl:process.env.MB_BETA_AUTH_REDIRECT_URL
  });
  console.log('Beta artifact prepared without printing environment values.');
}

module.exports=Object.freeze({sanitizeIndex,environmentSource,prepareArtifact});
