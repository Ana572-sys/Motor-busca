import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePepacItem,fetchPepac} from '../lib/pepac-listing.ts';

test('PEPAC usa o estado oficial da listagem atual e extrai o prazo do excerto',()=>{
 const x=parsePepacItem({id:1,title:'Apoio & investimento',link:'https://pepacc.pt/concursos/exemplo/',excerpt:'De 1 de setembro de 2026 a 30 de novembro de 2026'});
 assert.equal(x.title,'Apoio & investimento');assert.equal(x.sourceState,'aberto');assert.equal(x.startsAt,'2026-09-01');assert.equal(x.endsAt,'2026-11-30');
 const y=parsePepacItem({id:2,title:'Outro apoio',link:'https://pepacc.pt/concursos/outro/',excerpt:'Candidaturas abertas de 22 de outubro a 22 de dezembro de 2026',final_date:'22-12-2026 17:00'});
 assert.equal(y.startsAt,'2026-10-22');assert.equal(y.endsAt,'2026-12-22');
 assert.throws(()=>parsePepacItem({id:1,title:'x',link:'https://example.com/x'}));
});

test('PEPAC consulta só as páginas de concursos atuais, sem abrir registos arquivados',async()=>{
 const calls:string[]=[];
 const fake=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);calls.push(`${init?.method}:${url}`);
  const page=Number(new URL(url).searchParams.get('page'));
  const payload=page===1?{page:1,pages:2,total:6,per_page:'5',data:[{id:10,title:'Apoio atual',link:'https://pepacc.pt/concursos/atual/',excerpt:'De 1 de setembro de 2026 a 30 de novembro de 2026'}]}:{page:2,pages:2,total:6,per_page:'5',data:[{id:11,title:{rendered:'Outro apoio'},link:'https://pepacc.pt/concursos/outro/',excerpt:''}]};
  return new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}});
 };
 const result=await fetchPepac(fake as typeof fetch);
 assert.equal(result.length,2);assert.deepEqual(result.map(x=>x.sourceState),['aberto','aberto']);
 assert.equal(calls.length,2);assert.ok(calls.every(x=>x.startsWith('POST:https://pepacc.pt/wp-json/pepac/v1/competitions?')));assert.ok(calls.every(x=>x.includes('status=current')));
});

test('PEPAC rejeita paginação inconsistente',async()=>{
 const fake=async()=>new Response(JSON.stringify({page:2,pages:1,total:5,per_page:'5',data:[]}),{headers:{'content-type':'application/json'}});
 await assert.rejects(()=>fetchPepac(fake as typeof fetch),/Paginação oficial PEPAC inesperada/);
});
