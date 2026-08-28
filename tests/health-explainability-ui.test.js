'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
let assertions=0;
const includes=value=>{assertions+=1;assert.ok(source.includes(value),`missing health explanation: ${value}`)};

includes('A nota atual usa somente valores realizados; compromissos programados e projetados não alteram esse score.');
includes('Compara as saídas realizadas com o total planejado do mês.');
includes('Compara o investimento realizado com a receita planejada.');
includes('Compara o saldo registrado da reserva com a meta configurada.');
includes('Mede o peso dos Gastos Fixos realizados em relação ao planejamento total');
includes('prazo e ritmo não fazem parte desta nota atual.');
includes("evaluable:false,score:null,label:'Dados insuficientes'");

assertions+=1;assert.ok(!source.includes("return {score:0,label:'Crítica',budgetScore:0,investScore:0,reserveScore:0,commitmentScore:0,goalScore:0"),'technical failure must not become a financial diagnosis');

console.log(`health-explainability-ui: ${assertions} assertions passed`);
