#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');

function eligibleMigrations(rootDir,manifestPath='supabase/production-migrations.manifest'){
  const manifest=fs.readFileSync(path.join(rootDir,manifestPath),'utf8');
  const entries=manifest.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
  if(!entries.length)throw new Error('production migration manifest is empty');
  for(const entry of entries){
    if(/local|baseline/i.test(entry))throw new Error(`local/baseline migration is forbidden: ${entry}`);
    const absolute=path.resolve(rootDir,entry);
    if(!absolute.startsWith(path.resolve(rootDir)+path.sep)||!fs.existsSync(absolute))throw new Error(`invalid migration entry: ${entry}`);
    if(/^\s*create\s+table\b/im.test(fs.readFileSync(absolute,'utf8')))throw new Error(`table-creating migration requires separate approval: ${entry}`);
  }
  const expected=[
    'supabase/migrations/20260820161846_add_v82_structured_financial_operations.sql',
    'supabase/migrations/20260820195658_structure_recurring_financial_operations_v82.sql'
  ];
  if(entries.length!==expected.length||entries.some((entry,index)=>entry!==expected[index])){
    throw new Error('production migration manifest does not match the reviewed V82 order');
  }
  for(const entry of entries){
    const sql=fs.readFileSync(path.resolve(rootDir,entry),'utf8');
    if(!/^\s*begin\s*;/im.test(sql)||!/^\s*commit\s*;/im.test(sql))throw new Error(`migration is not explicitly transactional: ${entry}`);
    if(!sql.includes('pg_advisory_xact_lock')||!sql.includes('V82 schema drift'))throw new Error(`migration lacks recovery/drift guards: ${entry}`);
  }
  return entries;
}

function prepareMigrationChain({rootDir,pathOut}){
  const entries=eligibleMigrations(rootDir),output=path.resolve(pathOut);
  if(output===path.resolve(rootDir)||path.dirname(output)===output)throw new Error('unsafe migration output path');
  if(fs.existsSync(output)&&fs.readdirSync(output).length)throw new Error('migration output directory must be empty');
  fs.mkdirSync(output,{recursive:true});
  for(const entry of entries)fs.copyFileSync(path.resolve(rootDir,entry),path.join(output,path.basename(entry)));
  return Object.freeze({output,entries:entries.slice()});
}

if(require.main===module){
  const rootDir=path.resolve(__dirname,'..'),pathOut=process.argv[2]||path.join(rootDir,'dist-beta','supabase','migrations');
  const result=prepareMigrationChain({rootDir,pathOut});
  console.log(`Prepared ${result.entries.length} reviewed production migration(s).`);
}

module.exports=Object.freeze({eligibleMigrations,prepareMigrationChain});
