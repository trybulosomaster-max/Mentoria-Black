'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const visual=require('../js/aviora-visual-v1');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const css=read('assets/aviora-v82.css');
const index=read('index.html');
const source=read('js/aviora-visual-v1.js');
const agents=read('AGENTS.md');
let tests=0,assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions++;assert.strictEqual(actual,expected,message)};
const test=(name,fn)=>{fn();tests++};

test('AGENTS registra somente princípios multiplataforma duráveis',()=>{
  for(const text of ['## Multiplatform UI','Web agora; preservar portabilidade futura para iOS e Android','Não depender de interação exclusiva da Web','lógica financeira e de negócio separada','pelo menos 44 px','performance','Cores das categorias são dados do usuário'])ok(agents.includes(text),`missing ${text}`);
  ok(!/React Native|Flutter|Capacitor|Dynamic Island|32:5|32:6|PID|192\.168\./.test(agents));
});

test('accordion usa botão semântico e não duplica listeners em rerender',()=>{
  const attributes=new Map();let listeners=0,toggles=0,handler=null;
  const trigger={dataset:{},setAttribute:(key,value)=>attributes.set(key,value),getAttribute:key=>attributes.get(key),closest:()=>({classList:{toggle:()=>{toggles++}}}),addEventListener:(type,fn)=>{equal(type,'click');listeners++;handler=fn}};
  const panel={hidden:false};
  visual.wireAccordion(trigger,panel,false);
  visual.wireAccordion(trigger,panel,false);
  equal(listeners,1,'listener must be installed once per control');
  equal(attributes.get('aria-expanded'),'false');equal(panel.hidden,true);
  handler();equal(attributes.get('aria-expanded'),'true');equal(panel.hidden,false);ok(toggles>=2);
  ok(source.includes('trigger.type=\'button\'')&&source.includes('<button class="aviora-accordion-trigger" type="button"'));
  ok(!/mouseenter|mouseover|contextmenu|draggable|dragstart/.test(source),'essential visual actions must not depend on pointer-only events');
});

test('gráficos ocultos não renderizam e motion reduzido desliga animação',()=>{
  const visible={closest:()=>null};
  const hidden={closest:selector=>selector==='[hidden]'?{}:null};
  equal(visual.chartCanvasIsRenderable(visible),true);
  equal(visual.chartCanvasIsRenderable(hidden),false);
  equal(visual.chartCanvasIsRenderable(null),false);
  equal(visual.chartAnimation(true),false);
  const motion=visual.chartAnimation(false);equal(motion.duration,240);ok(Object.isFrozen(motion));
  for(const id of ['dashCat','v15RevenueYear','planChart','reportCat'])ok(index.includes(`chartCanvasIsRenderable("${id}")`),`missing render guard for ${id}`);
  ok(index.includes('Object.values(CHARTS).forEach')&&index.includes('c.destroy()'),'old charts are destroyed before replacement');
  ok(source.includes('const result=base.apply(this,arguments);apply();return result'),'presentation arranges hidden panels before the chart frame runs');
  ok(source.includes('requestAnimationFrame(()=>root.drawCharts?.())'),'tab activation renders only the newly visible chart');
  ok(!source.includes('chart?.resize?.()'),'hidden chart instances are not kept alive for resize');
  equal((index.match(/<canvas id="dashCat"/g)||[]).length,1);
  equal((index.match(/<canvas id="planChart"/g)||[]).length,1);
});

test('safe-area, viewport dinâmico, toque e teclado virtual são tratados sistemicamente',()=>{
  for(const inset of ['safe-area-inset-top','safe-area-inset-right','safe-area-inset-bottom','safe-area-inset-left'])ok(css.includes(`env(${inset})`),`missing ${inset}`);
  ok(css.includes('min-height: 100svh; min-height: 100dvh'));
  ok(css.includes('min-height: 44px'));
  ok(css.includes('input,select,textarea { font-size: 16px; }'),'mobile inputs avoid iOS focus zoom');
  ok(css.includes('.modal-foot {')&&css.includes('position: sticky')&&css.includes('env(safe-area-inset-bottom)'),'primary modal actions remain reachable with a virtual keyboard');
  ok(index.includes('width=device-width,initial-scale=1,viewport-fit=cover'));
});

test('cores de categoria permanecem dados e nunca são o único significado',()=>{
  ok(source.includes("const color=dot?.style.background||dot?.style.backgroundColor"));
  ok(source.includes("card.style.setProperty('--category-color',color)"));
  ok(css.includes('background: var(--category-color)'));
  ok(source.includes('aria-label=')&&source.includes('do planejado'));
  ok(source.includes('${escapeHtml(name)}')&&source.includes('toLocaleString(\'pt-BR\''));
});

test('camada visual permanece leve, sem fonte de verdade ou dependência nova',()=>{
  ok(!/localStorage|sessionStorage|createClient|supabase|fetch\(|XMLHttpRequest/.test(source));
  ok(!/import\s|require\(|React|Vue|Flutter|Capacitor/.test(source));
  ok(!/console\.(error|warn|log)/.test(source));
  ok(css.includes('@media (prefers-reduced-motion: reduce)'));
  ok(!/desktop-dark-box-shadow|mobile-only-token|ios-only|android-only/.test(css));
});

test('assets oficiais mantêm resolução Retina sem peso excessivo',()=>{
  const logo=fs.statSync(path.join(root,'assets/branding/aviora-official.jpg'));
  const hero=fs.statSync(path.join(root,'assets/branding/aviora-login-hero.jpg'));
  ok(logo.size<300*1024);ok(hero.size<300*1024);
  ok(css.includes('object-fit: contain')&&css.includes('object-position: center'));
});

console.log(`aviora-multiplatform-performance: ${tests} tests, ${assertions} assertions passed`);
