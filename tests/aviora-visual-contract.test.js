'use strict';
const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');

let tests=0,assertions=0;
const ok=(value,message)=>{assertions+=1;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions+=1;assert.strictEqual(actual,expected,message)};
function test(name,fn){try{fn();tests+=1}catch(error){error.message=`${name}: ${error.message}`;throw error}}

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const index=read('index.html');
const css=read('assets/aviora-v82.css');
const preview=read('aviora-v82.preview.local.html');
const knowledge=read('knowledge/knowledge-area.js');
const manifest=JSON.parse(read('manifest.webmanifest'));
const sw=read('sw.js');
const logo=fs.readFileSync(path.join(root,'assets/branding/aviora-official.jpg'));
const loginHero=fs.readFileSync(path.join(root,'assets/branding/aviora-login-hero.jpg'));

test('asset oficial é preservado e usado como imagem real',()=>{
 equal(crypto.createHash('sha256').update(logo).digest('hex'),'b9182d1e0bfcc19f34196285d4f01b1d3e15bfd6a7ff0cf7606a2f6ed45147b0');
 equal(crypto.createHash('sha256').update(loginHero).digest('hex'),'3a9d0834f30e21433ecf66d70e6fdf86a7f38aa2ddf11d64a69c15a3dcd86933');
 ok(index.includes('<img class="crest aviora-brand-mark" src="assets/branding/aviora-official.jpg"'));
 ok(index.includes('class="meridian-theme-artboard aviora-login-hero"'));
 ok(index.includes('data-day-desktop-src="assets/branding/aviora-login-hero.jpg"'));
 ok(index.includes('data-night-mobile-src="assets/branding/aviora-login-hero.jpg"'));
 ok(preview.includes('assets/branding/aviora-login-hero.jpg'));
 ok(!index.includes('aviora-login-logo'),'login card must not duplicate the hero mark');
 ok(!index.includes('assets/login/meridian-'),'production login must not reference the retired hand/compass heroes');
 ok(!preview.includes('assets/login/meridian-'),'local AVIORA preview must not reference the retired hand/compass heroes');
 ok(!css.includes('filter: hue-rotate')&&!css.includes('transform: scaleX'),'logo must not be recolored or distorted');
 ok(css.includes('object-fit: contain'));
});

test('tokens AVIORA centralizam a identidade visual',()=>{
 for(const token of ['--aviora-bg','--aviora-surface','--aviora-surface-elevated','--aviora-border','--aviora-text','--aviora-text-muted','--aviora-gold','--aviora-gold-soft','--aviora-champagne','--aviora-success','--aviora-danger','--aviora-warning'])ok(css.includes(token),`missing ${token}`);
 ok(css.includes('.btn.primary')&&css.includes('.btn.gold'));
 ok(css.includes('.btn.danger')&&css.includes('.danger-action'));
 ok(css.includes('.nav .btn.active'));
 ok(css.includes('@media (max-width: 720px)'));
});

test('marca visível migra sem renomear contratos técnicos',()=>{
 ok(index.includes('<div class="meridian-brand-name">AVIORA</div>'));
 ok(index.includes('<span class="meridian-brand-subtitle">GESTÃO FINANCEIRA</span>'));
 ok(index.includes('AVIORA — Gestão Financeira • dados protegidos por usuário'));
 equal(manifest.short_name,'AVIORA');
 ok(manifest.name.includes('AVIORA'));
 ok(index.includes('meridian_black_remembered_email')||read('js/meridian-day-night-login.js').includes('meridian_black_remembered_email'),'technical storage key remains stable');
});

test('Knowledge adota o sistema AVIORA sem alterar o conteúdo canônico',()=>{
 ok(knowledge.includes('Biblioteca AVIORA'));
 ok(knowledge.includes('<h1>Conhecimento</h1>'));
 ok(knowledge.includes('assets/branding/aviora-official.jpg'));
 ok(knowledge.includes('${safe(publication.title)}'),'publication title remains data-driven');
 ok(css.includes('.knowledge-library'));
});

test('cache frontend referencia a nova camada visual e o asset oficial',()=>{
 ok(sw.includes('mentoria-black-v82-production-aviora-login-v3'));
 ok(sw.includes('./assets/aviora-v82.css'));
 ok(sw.includes('./assets/branding/aviora-official.jpg'));
 ok(sw.includes('./assets/branding/aviora-login-hero.jpg'));
 ok(index.includes('<link rel="stylesheet" href="assets/aviora-v82.css?v=aviora-login-v3">'));
 ok(index.includes('const MB_SW_VERSION="26"'));
});

test('preview é local e não inicializa Supabase',()=>{
 ok(preview.includes("view=params.get('view')||'app'"));
 ok(preview.includes("theme=params.get('theme')||'auto'"));
 ok(!preview.includes('createClient('));
 ok(!preview.includes('SUPABASE_'));
});

console.log(`aviora-visual-contract: ${tests} tests, ${assertions} assertions passed`);
