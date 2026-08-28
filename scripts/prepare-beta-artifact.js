#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const runtime=require('../js/beta-runtime');

function sanitizeIndex(source){
  let replacements=0;
  const sanitized=source.replace(/const SUPABASE_URL="[^"]*";/,()=>{replacements++;return 'const SUPABASE_URL="";';})
    .replace(/const SUPABASE_ANON_KEY="[^"]*";/,()=>{replacements++;return 'const SUPABASE_ANON_KEY="";';})
    .replace('js/production-environment.js','js/beta-environment.js')
    .replace('js/production-runtime.js','js/beta-runtime.js')
    .replaceAll('MB_PRODUCTION_RUNTIME','MB_BETA_RUNTIME')
    .replaceAll('MB_PRODUCTION_FETCH','MB_BETA_FETCH')
    .replaceAll('MBProductionRuntime','MBBetaRuntime');
  if(replacements!==2)throw new Error('expected embedded legacy frontend configuration was not found exactly once');
  return sanitized;
}

function betaManifestSource(source){
  const manifest=JSON.parse(source);
  manifest.name='AVIORA — Gestão Financeira V82 BETA';
  manifest.short_name='AVIORA BETA';
  return `${JSON.stringify(manifest,null,2)}\n`;
}

function betaServiceWorkerSource(source){
  const productionCache='mentoria-black-v82-production';
  if(!source.includes(productionCache))throw new Error('expected production cache identifier was not found');
  return source.replaceAll(productionCache,'mentoria-black-v82-beta')
    .replaceAll('./js/production-environment.js','./js/beta-environment.js')
    .replaceAll('./js/production-runtime.js','./js/beta-runtime.js');
}

function localAssets(source){
  const assets=new Set();
  const assetReference=/(?:src|href|data-(?:day|night)-(?:desktop|mobile)-src)="([^"]+)"/g;
  for(const match of source.matchAll(assetReference)){
    const asset=match[1];
    if(!asset||/^(?:https?:|data:|#)/i.test(asset)||asset==='manifest.webmanifest')continue;
    if(asset.includes('..')||path.isAbsolute(asset))throw new Error(`unsafe local asset reference: ${asset}`);
    assets.add(asset.split(/[?#]/,1)[0]);
  }
  return [...assets];
}

function copyFile(rootDir,output,relativePath){
  const source=path.join(rootDir,relativePath),destination=path.join(output,relativePath);
  if(!fs.existsSync(source)||!fs.statSync(source).isFile())throw new Error(`missing frontend asset: ${relativePath}`);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.copyFileSync(source,destination);
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
  fs.mkdirSync(output,{recursive:true});
  const indexSource=sanitizeIndex(fs.readFileSync(path.join(rootDir,'index.html'),'utf8'));
  fs.writeFileSync(path.join(output,'index.html'),indexSource);
  for(const asset of localAssets(indexSource))copyFile(rootDir,output,asset);
  fs.writeFileSync(path.join(output,'js','beta-environment.js'),environmentSource({supabaseUrl,supabasePublishableKey,authRedirectUrl}));
  fs.writeFileSync(path.join(output,'manifest.webmanifest'),betaManifestSource(fs.readFileSync(path.join(rootDir,'manifest.webmanifest'),'utf8')));
  fs.writeFileSync(path.join(output,'sw.js'),betaServiceWorkerSource(fs.readFileSync(path.join(rootDir,'sw.js'),'utf8')));
  const validation=validateBetaArtifact(output);
  return Object.freeze({output,files:['index.html','manifest.webmanifest','sw.js',...localAssets(indexSource)],validation});
}

function validateBetaArtifact(pathOut){
  const output=path.resolve(pathOut);
  const required=['index.html','manifest.webmanifest','sw.js','js/beta-environment.js','js/beta-runtime.js'];
  for(const relativePath of required){
    if(!fs.existsSync(path.join(output,relativePath)))throw new Error(`incomplete Beta artifact: ${relativePath}`);
  }
  const html=fs.readFileSync(path.join(output,'index.html'),'utf8');
  const manifest=fs.readFileSync(path.join(output,'manifest.webmanifest'),'utf8');
  const sw=fs.readFileSync(path.join(output,'sw.js'),'utf8');
  const environment=fs.readFileSync(path.join(output,'js','beta-environment.js'),'utf8');
  const combined=[html,manifest,sw,environment].join('\n');
  const expectations=[
    [html.includes('js/beta-runtime.js')&&!html.includes('js/production-runtime.js'),'Beta runtime'],
    [html.includes('js/beta-environment.js')&&!html.includes('js/production-environment.js'),'Beta environment'],
    [html.includes('MBBetaRuntime.requireConfigured')&&!html.includes('MBProductionRuntime'),'fail-closed Beta bootstrap'],
    [manifest.includes('AVIORA — Gestão Financeira V82 BETA'),'Beta manifest identity'],
    [sw.includes('mentoria-black-v82-beta')&&!sw.includes('mentoria-black-v82-production'),'Beta cache identity'],
    [!combined.includes('mwjqfzbpjmwiscvtxvfc'),'production project isolation'],
    [!/(?:service[_-]?role|sb_secret_|SUPABASE_SERVICE_ROLE|DB_PASSWORD)/i.test(combined),'privileged secret exclusion']
  ];
  for(const [valid,label] of expectations)if(!valid)throw new Error(`invalid Beta artifact: ${label}`);
  for(const asset of localAssets(html))if(!fs.existsSync(path.join(output,asset)))throw new Error(`incomplete Beta artifact: ${asset}`);
  return Object.freeze({valid:true,label:'AVIORA — Gestão Financeira V82 BETA',cache:'mentoria-black-v82-beta-aviora-login-v3'});
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

module.exports=Object.freeze({sanitizeIndex,betaManifestSource,betaServiceWorkerSource,localAssets,environmentSource,prepareArtifact,validateBetaArtifact});
