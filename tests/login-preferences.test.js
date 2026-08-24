'use strict';
const assert=require('assert');
const preferences=require('../js/login-preferences.js');
let assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions++;assert.strictEqual(actual,expected,message)};
const storage=()=>{
  const values=new Map();
  return {values,getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
};

equal(preferences.KEY,'mentoria_black_remembered_email','only the approved email-preference key is used');
equal(preferences.read(storage()),'','new devices have no remembered email');
equal(preferences.normalizeEmail('  pessoa@example.com  '),'pessoa@example.com','email is trimmed before storage');
equal(preferences.normalizeEmail('not-an-email'),'','invalid values are never persisted');

const saved=storage();
equal(preferences.persist('  pessoa@example.com ',true,saved),'pessoa@example.com','a successful opted-in login saves only its email');
equal(saved.values.size,1,'the preference storage contains one value only');
equal(saved.getItem(preferences.KEY),'pessoa@example.com','the stored value is the email string, not a user object');
const input={value:'old@example.com'},checkbox={checked:false};
equal(preferences.restore(input,checkbox,saved),'pessoa@example.com','opening login restores the saved email');
equal(input.value,'pessoa@example.com','restore fills only the email input');
equal(checkbox.checked,true,'restore reflects an existing remembered email');
equal(preferences.persist('pessoa@example.com',false,saved),'','opting out clears the stored email immediately');
equal(saved.getItem(preferences.KEY),null,'opting out leaves no remembered email');
preferences.restore(input,checkbox,saved);
equal(input.value,'','no saved preference leaves the email field blank');
equal(checkbox.checked,false,'no saved preference leaves the checkbox unchecked');

const failingStorage={getItem(){throw new Error('blocked')},setItem(){throw new Error('blocked')},removeItem(){throw new Error('blocked')}};
equal(preferences.read(failingStorage),'','blocked browser storage fails closed');
equal(preferences.persist('pessoa@example.com',true,failingStorage),'pessoa@example.com','storage failure does not interrupt authentication');
const source=require('fs').readFileSync(require('path').join(__dirname,'..','js','login-preferences.js'),'utf8');
ok(!/password|token|session|grant/i.test(source),'preference module does not retain credentials or entitlements');
ok(source.includes('localStorage'),'module only uses browser local storage when explicitly called');

console.log(`login-preferences: ${assertions} assertions passed`);
