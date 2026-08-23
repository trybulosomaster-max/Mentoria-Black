#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const {validateKnowledgeDocument}=require('../knowledge/import-contract');
const target=process.argv[2];
if(!target){console.error('Usage: node scripts/validate-knowledge-import.js <document.json>');process.exit(2)}
const resolved=path.resolve(target);
if(!fs.statSync(resolved).isFile())throw new Error('Import target must be a file');
const document=validateKnowledgeDocument(JSON.parse(fs.readFileSync(resolved,'utf8')));
const chapters=document.parts.reduce((total,part)=>total+part.chapters.length,0);
const sections=document.parts.reduce((total,part)=>total+part.chapters.reduce((sum,chapter)=>sum+chapter.sections.length,0),0);
console.log(`knowledge-import: valid (${document.parts.length} parts, ${chapters} chapters, ${sections} sections)`);
