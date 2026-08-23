#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const crypto=require('crypto');
const {validateKnowledgeDocument}=require('../knowledge/import-contract');
const args=process.argv.slice(2),mode=args.includes('--dry-run')?'dry-run':'validate-only';
const target=args.find(value=>!value.startsWith('--'));
if(!target){console.error('Usage: node scripts/validate-knowledge-import.js [--validate-only|--dry-run] <document.json>');process.exit(2)}
const resolved=path.resolve(target);
if(!fs.statSync(resolved).isFile())throw new Error('Import target must be a file');
const document=validateKnowledgeDocument(JSON.parse(fs.readFileSync(resolved,'utf8')));
const chapters=document.parts.reduce((total,part)=>total+part.chapters.length,0);
const sections=document.parts.reduce((total,part)=>total+part.chapters.reduce((sum,chapter)=>sum+chapter.sections.length,0),0);
const structuredHash=crypto.createHash('sha256').update(JSON.stringify(document)).digest('hex');
if(mode==='dry-run'){
  const accessLevels={};
  document.parts.forEach(part=>part.chapters.forEach(chapter=>chapter.sections.forEach(section=>{
    accessLevels[section.access_level]=(accessLevels[section.access_level]||0)+1;
  })));
  console.log(JSON.stringify({mode,parts:document.parts.length,chapters,sections,access_levels:accessLevels,
    source_hash:document.editorial_metadata.source_hash,structured_hash:structuredHash,
    simulated:{publications:{insert:1,update:0},parts:{insert:document.parts.length,update:0},chapters:{insert:chapters,update:0},sections:{insert:sections,update:0}}},null,2));
}else console.log(`knowledge-import: valid (${document.parts.length} parts, ${chapters} chapters, ${sections} sections; no writes)`);
