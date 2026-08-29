'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('legal pages are static, accessible AVIORA documents with the approved provisional copy',()=>{
  const terms=read('legal/termos-de-uso.html');
  const privacy=read('legal/politica-de-privacidade.html');
  const css=read('legal/aviora-legal.css');
  for(const [name,source,title] of [
    ['terms',terms,'Termos de Uso — AVIORA'],
    ['privacy',privacy,'Política de Privacidade — AVIORA']
  ]){
    assert.match(source,/<html lang="pt-BR">/,`${name} declares its language`);
    assert.match(source,/<meta name="viewport" content="width=device-width, initial-scale=1">/,`${name} is responsive`);
    assert.match(source,new RegExp(`<title>${title}</title>`),`${name} has its title`);
    assert.match(source,/<a class="legal-back" href="\.\.\/index\.html">← Voltar ao AVIORA<\/a>/,`${name} links back to AVIORA`);
    assert.match(source,/Última atualização: 29 de agosto de 2026/,`${name} carries the approved update date`);
    assert.doesNotMatch(source,/<script\b/i,`${name} adds no tracking or executable code`);
  }
  assert.match(terms,/O AVIORA não substitui aconselhamento financeiro, contábil, jurídico, tributário ou de investimentos realizado por profissional habilitado\./);
  assert.match(privacy,/O AVIORA não comercializa dados pessoais de seus usuários\./);
  assert.match(privacy,/Senhas não são armazenadas pelo AVIORA em formato legível\./);
  assert.match(css,/min-width: 320px/);
  assert.match(css,/min-height: 44px/);
});

test('signup terms links use safe new-tab navigation without changing the mandatory checkbox contract',()=>{
  const index=read('index.html');
  assert.match(index,/id="signupTerms" type="checkbox" disabled aria-labelledby="signupTermsText"/);
  assert.match(index,/href="legal\/termos-de-uso\.html" target="_blank" rel="noopener noreferrer">Termos de Uso<\/a>/);
  assert.match(index,/href="legal\/politica-de-privacidade\.html" target="_blank" rel="noopener noreferrer">Política de Privacidade<\/a>/);
  assert.doesNotMatch(index,/<label[^>]*signupTermsField/, 'links are outside a label, so opening them cannot toggle the checkbox');
  assert.match(index,/termsAccepted:signupTerms\.checked===true/);
});

test('service worker precaches the static legal documents and their local stylesheet',()=>{
  const sw=read('sw.js');
  for(const asset of ['./legal/termos-de-uso.html','./legal/politica-de-privacidade.html','./legal/aviora-legal.css']){
    assert.ok(sw.includes(`'${asset}'`),`${asset} is part of the app shell`);
  }
});
