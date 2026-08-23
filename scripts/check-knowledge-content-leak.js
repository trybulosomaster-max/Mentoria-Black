#!/usr/bin/env node
'use strict';

const childProcess=require('child_process');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const source=path.resolve(process.env.MB_KNOWLEDGE_SOURCE_TEXT||path.join(root,'.local-content/mentoria-black-partes-1-a-4.txt'));
const protectedPaths=[
  path.join(root,'.local-content/mentoria-black-partes-1-a-4.pdf'),source,
  path.join(root,'.local-content/mentoria-black-partes-1-a-4.structured.json')
];
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const words=normalize(fs.readFileSync(source,'utf8')).split(/\s+/).filter(Boolean),width=12,sourceShingles=new Set();
for(let index=0;index<=words.length-width;index+=1)sourceShingles.add(words.slice(index,index+width).join(' '));

for(const target of protectedPaths){
  if(!fs.existsSync(target))throw new Error(`protected source missing: ${path.basename(target)}`);
  childProcess.execFileSync('git',['check-ignore','-q',path.relative(root,target)],{cwd:root});
}

const tracked=childProcess.execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root}).toString('utf8').split('\0').filter(Boolean);
const leaks=[];
for(const relative of tracked){
  const target=path.join(root,relative),stat=fs.statSync(target);
  if(!stat.isFile()||stat.size>2_000_000)continue;
  const buffer=fs.readFileSync(target);
  if(buffer.includes(0))continue;
  const candidateWords=normalize(buffer.toString('utf8')).split(/\s+/).filter(Boolean);
  let matches=0;
  for(let index=0;index<=candidateWords.length-width;index+=1){
    if(sourceShingles.has(candidateWords.slice(index,index+width).join(' ')))matches+=1;
  }
  if(matches)leaks.push({file:relative,matches});
}
if(leaks.length){
  leaks.forEach(leak=>console.error(`knowledge-content-leak: ${leak.file} (${leak.matches} protected 12-word matches)`));
  process.exitCode=1;
}else console.log(`knowledge-content-leak: passed (${tracked.length} tracked files; no protected 12-word match)`);
