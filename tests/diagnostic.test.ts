import {test} from 'node:test';import assert from 'node:assert/strict';import {downloadPage,permittedSourceUrl,MAX_BYTES} from '../lib/diagnostic.ts';
const url='https://pis.portugal2030.pt/concursos-pagina/';
test('aceita apenas a página oficial explicitamente suportada',()=>{
 assert.equal(permittedSourceUrl(url),true);
 for(const u of ['http://pis.portugal2030.pt/concursos-pagina/','https://pis.portugal2030.pt.evil.test/concursos-pagina/','https://pis.portugal2030.pt:8443/concursos-pagina/','https://x@pis.portugal2030.pt/concursos-pagina/','https://pis.portugal2030.pt/outro/'])assert.equal(permittedSourceUrl(u),false);
});
test('calcula hash e rejeita redirecionamentos e conteúdo não HTML',async()=>{
 const options:typeof fetch=async()=>new Response('<html>teste</html>',{headers:{'content-type':'text/html; charset=utf-8'}});
 const a=await downloadPage(url,options);const b=await downloadPage(url,options);assert.equal(a.hash,b.hash);
 await assert.rejects(()=>downloadPage(url,async()=>new Response(null,{status:302,headers:{location:'https://evil.test'}})));
 await assert.rejects(()=>downloadPage(url,async()=>new Response('x',{headers:{'content-type':'application/pdf'}})));
});
test('rejeita respostas grandes mesmo sem tamanho declarado',async()=>{
 await assert.rejects(()=>downloadPage(url,async()=>new Response(new Uint8Array(MAX_BYTES+1),{headers:{'content-type':'text/html'}})));
});
