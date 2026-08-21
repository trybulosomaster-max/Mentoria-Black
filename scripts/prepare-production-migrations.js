#!/usr/bin/env node
'use strict';

const path=require('path');
const {prepareMigrationChain}=require('./prepare-beta-migrations');

const rootDir=path.resolve(__dirname,'..');
const pathOut=process.argv[2];
if(!pathOut)throw new Error('usage: node scripts/prepare-production-migrations.js <empty-migrations-directory>');
const result=prepareMigrationChain({rootDir,pathOut});
console.log(`Prepared reviewed V82 production chain at ${result.output}`);
