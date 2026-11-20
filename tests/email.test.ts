import {test} from 'node:test';import assert from 'node:assert/strict';import {renderWeeklyReport} from '../lib/weekly-email.ts';import {sendGraphMail} from '../lib/graph.ts';
test('resumo vazio inclui a frase pedida e não inclui fichas',()=>{
 const text=renderWeeklyReport({date:'12/11/2026',period:'semana',coverageComplete:true,newCount:0,changedCount:0,extensions:0,republications:0,ending:[],unavailable:[],items:[]},'https://radar.example');
 assert.match(text,/Não foram identificados novos avisos ou alterações relevantes no período analisado\./);assert.doesNotMatch(text,/ficha informativa/i);
});
test('uma pesquisa incompleta não declara que não existem alterações',()=>{
 const text=renderWeeklyReport({date:'12/11/2026',period:'semana',coverageComplete:false,newCount:0,changedCount:0,extensions:0,republications:0,ending:[],unavailable:['Fonte'],items:[]},'https://radar.example');
 assert.match(text,/Pesquisa incompleta/);assert.doesNotMatch(text,/Não foram identificados novos avisos/);
});
test('Graph só considera o envio aceite quando devolve 202',async()=>{
 const requests:string[]=[];const fetcher:typeof fetch=async(input)=>{requests.push(String(input));return requests.length===1?Response.json({access_token:'token-teste'}):new Response(null,{status:202});};
 assert.deepEqual(await sendGraphMail({tenantId:'tenant.example',clientId:'id',clientSecret:'secret',sender:'radar@example.org'},['a@example.org'],'Teste','Resumo',fetcher),{accepted:true});assert.equal(requests.length,2);
 const fail:typeof fetch=async()=>new Response(null,{status:403});await assert.rejects(()=>sendGraphMail({tenantId:'tenant.example',clientId:'id',clientSecret:'secret',sender:'radar@example.org'},['a@example.org'],'Teste','Resumo',fail),/HTTP 403/);
});
