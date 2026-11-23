import {test} from 'node:test';import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';import {processScanSource} from '../lib/scan-processor.ts';
test('o processador reserva e guarda candidatos da pesquisa pedida',async()=>{
 const calls:string[]=[],saved:{candidates?:unknown[]}={};
 const db={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push(name);if(name==='claim_scan_source_for_scan'){assert.equal(args.p_scan,'scan-1');return {data:[{id:'task-1',source_id:'source-1',scan_id:'scan-1'}],error:null};}if(name==='finish_scan_source')saved.candidates=args.p_candidates as unknown[];return {data:null,error:null};},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{id:'source-1',name:'Portugal 2030',active:true,url:'https://portugal2030.pt/avisos/',connector_key:'portugal_2030_v1'},error:null})})})}),storage:{from:()=>({upload:async()=>({error:null})})}} as unknown as SupabaseClient;
 const fetcher:typeof fetch=async()=>Response.json({status:200,avisos:[{aviso:{avisoGlobalId:1,codigoAviso:'P-1',designacaoPT:'Teste'},calendario:{dataInicio:'2026-01-01',dataFim:'2026-12-01'},documentos:[]}]});
 const result=await processScanSource(db,'scan-1',fetcher);assert.equal(result.status,'concluída');assert.equal('catalogSync'in result?result.catalogSync:undefined,'erro');assert.equal(saved.candidates?.length,1);assert.deepEqual(calls,['claim_scan_source_for_scan','finish_scan_source']);
});
test('uma fonte fora da lista suportada é registada como erro sem a consultar',async()=>{
 const calls:string[]=[];const db={rpc:async(name:string)=>{calls.push(name);return name==='claim_scan_source_for_scan'?{data:[{id:'task-1',source_id:'s',scan_id:'scan-1'}],error:null}:{error:null};},from:(name:string)=>name==='sources'?{select:()=>({eq:()=>({single:async()=>({data:{id:'s',name:'Fonte',active:true,url:'https://example.org',connector_key:'portugal_2030_v1'},error:null})})})}:{upsert:async()=>({error:null})}} as unknown as SupabaseClient;
 const fetcher:typeof fetch=async()=>{throw new Error('não deve consultar');};assert.deepEqual(await processScanSource(db,'scan-1',fetcher),{status:'erro'});assert.deepEqual(calls,['claim_scan_source_for_scan','fail_scan_source']);
});
