import {createHash} from 'node:crypto';
export const SOURCE_HOST='pis.portugal2030.pt';
export const MAX_BYTES=2_000_000;
/** A single allowlisted public host; no redirects, credentials or non-default port. */
export function permittedSourceUrl(raw:string):boolean{
 try {const u=new URL(raw);return u.protocol==='https:'&&u.hostname===SOURCE_HOST&&!u.port&&!u.username&&!u.password&&u.pathname==='/concursos-pagina/'&&!u.search&&!u.hash;}catch{return false;}
}
export async function downloadPage(url:string,fetcher:typeof fetch=fetch):Promise<{bytes:Uint8Array;hash:string;contentType:string}>{
 if(!permittedSourceUrl(url))throw new Error('Endereço não suportado pelo conector de diagnóstico.');
 const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'Accept':'text/html','User-Agent':'Crowe-GI-Radar/0.1 (diagnóstico de fonte)'}});
 if(!response.ok)throw new Error(`A fonte devolveu HTTP ${response.status}.`);
 const type=response.headers.get('content-type')||'';if(!/^text\/html(?:\s*;|\s*$)/i.test(type))throw new Error('A resposta não é uma página HTML.');
 const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>MAX_BYTES)throw new Error('A página excede o tamanho permitido.');
 if(!response.body)throw new Error('A fonte devolveu uma resposta vazia.');
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw new Error('A página excede o tamanho permitido.');}chunks.push(value);}}finally{reader.releaseLock();}
 if(!size)throw new Error('A fonte devolveu uma resposta vazia.');
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return {bytes,hash:createHash('sha256').update(bytes).digest('hex'),contentType:type};
}
