import {request as httpsRequest} from 'node:https';
import {rootCertificates} from 'node:tls';
import {sectigoIntermediate} from './sectigo-prr.ts';
type Obj=Record<string,unknown>;
const obj=(x:unknown):Obj=>x&&typeof x==='object'&&!Array.isArray(x)?x as Obj:{};
export type PrrCandidate={externalId:string;code:string;title:string;startsAt:null;endsAt:null;documentUrl:string;sourceState:'aberto';documents:never[];programs:string[]};
export function parsePrrListing(data:unknown):PrrCandidate[]{
 if(!Array.isArray(data)||data.length>1000)throw new Error('Resposta PRR inesperada.');const seen=new Set<string>();return data.map(raw=>{const x=obj(raw),content=obj(x.content),tipo=obj(x.tipo),comp=obj(x.componente),id=String(x.id??'');
  if(!/^\d+$/.test(id)||typeof x.url!=='string'||typeof content.title!=='string'||!content.title.trim()||x.avisos!=='aberto'||tipo.value!=='aviso_abr_cand'||typeof comp.value!=='string'||!/^C(?:[1-9]|1\d|2[01])$/.test(comp.value)||seen.has(id))throw new Error('Um aviso PRR tem dados inesperados.');
  const url=new URL(x.url);if(url.origin!=='https://recuperarportugal.gov.pt'||!/^\/candidatura\/[^/]+\/$/.test(url.pathname)||url.search||url.hash)throw new Error('Endereço PRR inesperado.');seen.add(id);
  return {externalId:id,code:`PRR-${id}`,title:content.title.trim(),startsAt:null,endsAt:null,documentUrl:url.toString(),sourceState:'aberto',documents:[],programs:['PRR',comp.value]};});
}
async function prrRequest(form:FormData):Promise<Response>{
 const body=new URLSearchParams();for(const [k,v] of form){if(typeof v!=='string')throw new Error('Pedido PRR inválido.');body.append(k,v);}
 return new Promise((resolve,reject)=>{const req=httpsRequest('https://recuperarportugal.gov.pt/wp-admin/admin-ajax.php',{method:'POST',ca:[...rootCertificates,sectigoIntermediate],headers:{'content-type':'application/x-www-form-urlencoded'},signal:AbortSignal.timeout(18000)},res=>{
  const chunks:Buffer[]=[];let size=0;res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>4_000_000){res.destroy(new Error('Resposta PRR demasiado grande.'));return;}chunks.push(chunk);});res.on('error',reject);res.on('end',()=>{if(res.statusCode!==200){reject(new Error(`A fonte PRR devolveu HTTP ${res.statusCode}.`));return;}resolve(new Response(Buffer.concat(chunks),{status:200}));});});req.on('error',reject);req.end(body.toString());});
}
export async function fetchPrr(fetcher?:typeof fetch):Promise<PrrCandidate[]>{const form=new FormData();form.append('action','getCandidaturas');for(let i=1;i<=21;i++)form.append('params[componente][]',`C${i}`);form.append('params[avisos][]','aberto');form.append('params[tipo][]','aviso_abr_cand');
 const response=fetcher?await fetcher('https://recuperarportugal.gov.pt/wp-admin/admin-ajax.php',{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(18000)}):await prrRequest(form);if(!response.ok||!response.body||Number(response.headers.get('content-length'))>4_000_000)throw new Error('Resposta PRR indisponível ou demasiado grande.');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4_000_000){await reader.cancel();throw new Error('Resposta PRR demasiado grande.');}chunks.push(part.value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}let data:unknown;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('Resposta PRR inválida.');}return parsePrrListing(data);
}
