import {test} from 'node:test';import assert from 'node:assert/strict';import {recipients,queueSourceIssue,dispatchPendingNotifications} from '../lib/notifications.ts';
import type {SupabaseClient} from '@supabase/supabase-js';
test('cada alerta é preparado para os quatro destinatários sem alegar entrega',async()=>{
 let rows:Record<string,unknown>[]=[];const db={from:()=>({upsert:async(input:Record<string,unknown>[])=>{rows=input;return {error:null}}})} as unknown as SupabaseClient;
 await queueSourceIssue(db,'scan-1','Fonte de teste');assert.equal(rows.length,4);assert.equal(recipients.length,4);assert.ok(rows.every(r=>r.status==='pending'));assert.equal(new Set(rows.map(r=>r.idempotency_key)).size,4);
});
test('falhas de fontes diferentes da mesma pesquisa produzem alertas distintos',async()=>{
 const keys:string[]=[];const db={from:()=>({upsert:async(input:{idempotency_key:string}[])=>{keys.push(...input.map(x=>x.idempotency_key));return {error:null}}})} as unknown as SupabaseClient;
 await queueSourceIssue(db,'scan-1','Fonte A','fonte-a');await queueSourceIssue(db,'scan-1','Fonte B','fonte-b');
 assert.equal(new Set(keys).size,8);
});
test('um resultado ambíguo fica registado sem reenvio automático',async()=>{
 let claim=0,status='';const db={rpc:async()=>({data:claim++===0?[{id:'a',recipient:'a@example.org',subject:'s',body:'b'}]:[],error:null}),from:()=>({update:(row:{status:string})=>({eq:()=>({eq:async()=>{status=row.status;return {error:null}}})})})} as unknown as SupabaseClient;
 const result=await dispatchPendingNotifications(db,{tenantId:'example.org',clientId:'id',clientSecret:'s',sender:'sender@example.org'},async()=>{throw new Error('timeout')});assert.equal(result.unknown,1);assert.equal(status,'unknown');assert.equal(claim,2);
});
