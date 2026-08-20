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
  console.log(`Prepared ${result.entries.length} reviewed Beta migration(s).`);
}

module.exports=Object.freeze({eligibleMigrations,prepareMigrationChain});
