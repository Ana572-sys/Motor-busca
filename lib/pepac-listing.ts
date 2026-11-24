import {load} from 'cheerio';

export type PepacCandidate={externalId:string;code:string;title:string;startsAt:string|null;endsAt:string|null;documentUrl:string;sourceState:'aberto';documents:never[];programs:string[]};
const obj=(x:unknown):Record<string,unknown>=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
const months:Record<string,string>={janeiro:'01',fevereiro:'02',março:'03',marco:'03',abril:'04',maio:'05',junho:'06',julho:'07',agosto:'08',setembro:'09',outubro:'10',novembro:'11',dezembro:'12'};
function iso(day:string,month:string,year:string){const value=`${year}-${months[month.toLowerCase()]||months[month.toLowerCase().replace(/ç/g,'c')]}-${day.padStart(2,'0')}`,date=new Date(`${value}T00:00:00Z`);return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===value?value:null;}
function textValue(value:unknown){if(typeof value==='string')return value;if(value&&typeof value==='object'&&!Array.isArray(value)){const x=obj(value);return typeof x.rendered==='string'?x.rendered:'';}return '';}
function candidateIdentity(id:unknown,link:string,type:'competition'|'external_competition'){
 const raw=String(id??'').trim();if(raw&&/^[a-zA-Z0-9_-]{1,100}$/.test(raw))return raw;
 const slug=new URL(link).pathname.split('/').filter(Boolean).at(-1)||'';if(!/^[a-z0-9-]{1,100}$/i.test(slug))throw new Error('Identificador de concurso PEPAC inválido.');return `${type}-${slug}`;
}
function datesFromExcerpt(value:string,finalDate:unknown){
 const match=value.match(/(?:candidaturas\s+abertas\s+)?de\s+(\d{1,2})\s+de\s+([a-zç]+)(?:\s+de\s+(20\d{2}))?\s+a\s+(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(20\d{2})/i);
 const startYear=match?.[3]||match?.[6],startsAt=match&&startYear?iso(match[1],match[2],startYear):null;
 let endsAt=match?iso(match[4],match[5],match[6]):null;
 if(typeof finalDate==='string'){const finalMatch=finalDate.match(/^(\d{1,2})-(\d{1,2})-(20\d{2})(?:\s+\d{1,2}:\d{2})?$/);if(finalMatch){const candidate=`${finalMatch[3]}-${finalMatch[2]}-${finalMatch[1]}`,date=new Date(`${candidate}T00:00:00Z`);if(Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===candidate)endsAt=candidate;}}
 return {startsAt,endsAt};
}
export function parsePepacItem(raw:unknown,type:'competition'|'external_competition'='competition'):PepacCandidate{
 const x=obj(raw),title=load(`<div>${textValue(x.title)}</div>`)('div').text().replace(/\s+/g,' ').trim(),link=x.link;
 if(!title||typeof link!=='string')throw new Error('Concurso PEPAC incompleto.');
 const u=new URL(link),prefix=type==='competition'?'/concursos/':'/concursos-externos/';if(u.origin!=='https://pepacc.pt'||!u.pathname.startsWith(prefix)||u.pathname===prefix||u.search||u.hash)throw new Error('Endereço PEPAC inesperado.');
 const id=candidateIdentity(x.id??x.ID,link,type),dates=datesFromExcerpt(textValue(x.excerpt),x.final_date);
 return {externalId:`${type}-${id}`,code:`PEPAC-${id}`,title,startsAt:dates.startsAt,endsAt:dates.endsAt,documentUrl:u.toString(),sourceState:'aberto',documents:[],programs:['PEPAC Continente']};
}
async function readJson(fetcher:typeof fetch,url:URL,page:number):Promise<unknown>{
 const r=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!r.ok||!r.body||Number(r.headers.get('content-length'))>2_000_000)throw new Error('Listagem oficial PEPAC indisponível.');
 const reader=r.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2_000_000){await reader.cancel();throw new Error('Resposta oficial PEPAC demasiado grande.');}chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let payload:unknown;try{payload=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('Resposta oficial PEPAC inválida.');}
 const result=obj(payload),rows=result.data,totalPages=Number(result.pages),currentPage=Number(result.page),total=Number(result.total),perPage=Number(result.per_page);
 if(!Array.isArray(rows)||rows.length>5||!Number.isInteger(total)||total<0||!Number.isInteger(perPage)||perPage!==5||!Number.isInteger(totalPages)||totalPages!==Math.ceil(total/perPage)||totalPages>20||!Number.isInteger(currentPage)||currentPage!==page||((totalPages===0)!==(rows.length===0)))throw new Error('Paginação oficial PEPAC inesperada.');
 return payload;
}
/** Uses the official page's own "current" endpoint: avoids crawling hundreds of archived WordPress posts. */
export async function fetchPepac(fetcher:typeof fetch=fetch):Promise<PepacCandidate[]> {
 const all:PepacCandidate[]=[],seen=new Set<string>();let pages:number|undefined;
 for(let page=1;page<=20;page++){
  const url=new URL('https://pepacc.pt/wp-json/pepac/v1/competitions');url.searchParams.set('page',String(page));url.searchParams.set('per_page','5');url.searchParams.set('status','current');
  const payload=obj(await readJson(fetcher,url,page)),rows=payload.data as unknown[],totalPages=Number(payload.pages);
  if(pages!==undefined&&pages!==totalPages)throw new Error('Paginação oficial PEPAC alterada durante a consulta.');pages=totalPages;
  for(const raw of rows){const candidate=parsePepacItem(raw);if(seen.has(candidate.externalId))throw new Error('Concurso PEPAC repetido.');seen.add(candidate.externalId);all.push(candidate);}
  if(page>=totalPages)return all;
 }
 throw new Error('Listagem oficial PEPAC excedeu o limite de páginas.');
}
