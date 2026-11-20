import {test} from 'node:test';import assert from 'node:assert/strict';import {fetchEuListing,parseEuRecord} from '../lib/eu-listing.ts';
const item=(code:string,type='1')=>({reference:`ref-${code}`,language:'en',metadata:{type:[type],status:['31094502'],identifier:[code],title:[`Title ${code}`]}});
test('aceita apenas tópicos europeus de subvenção',()=>{assert.equal(parseEuRecord(item('CALL-ONE')).code,'CALL-ONE');assert.throws(()=>parseEuRecord(item('TENDER-ONE','0')),/inesperados/);});
test('deduplica repetição idêntica na página e rejeita repetições entre páginas',async()=>{
 const one=async()=>new Response(JSON.stringify({pageNumber:1,pageSize:100,totalResults:2,results:[item('CALL-ONE'),item('CALL-ONE')]}));assert.equal((await fetchEuListing(one as typeof fetch)).length,1);
 const multiple=async(_url:string|URL|Request,init?:RequestInit)=>{const n=Number((init?.body as FormData).get('pageNumber'));const rows=n===1?Array.from({length:100},(_,i)=>item(`CALL-${i}`)):[item('CALL-0')];return new Response(JSON.stringify({pageNumber:n,pageSize:100,totalResults:101,results:rows}));};await assert.rejects(()=>fetchEuListing(multiple as typeof fetch),/duplicados inconsistentes/);
});
