/** Public Commission grant-topic listing. It does not establish Portugal eligibility. */
export type EuCandidate={externalId:string;code:string;title:string;startsAt:string|null;endsAt:string|null;documentUrl:string;sourceState:'aberto';documents:never[];programs:string[]};
const object=(x:unknown):Record<string,unknown>=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
const first=(x:unknown):string|null=>Array.isArray(x)&&typeof x[0]==='string'&&x[0].trim()?x[0].trim():null;
function date(value:unknown):string|null{
 if(!Array.isArray(value)||value.length!==1||typeof value[0]!=='string')return null;
 const v=value[0],n=Date.parse(v);return Number.isFinite(n)?new Date(n).toISOString().slice(0,10):null;
}
export function parseEuRecord(raw:unknown):EuCandidate{
 const item=object(raw),m=object(item.metadata),type=first(m.type),status=first(m.status),code=first(m.identifier),title=first(m.title);
 if(type!=='1'||status!=='31094502'||item.language!=='en'||!code||!title||!/^[A-Za-z0-9][A-Za-z0-9._-]{1,180}$/.test(code))throw new Error('Um registo europeu tem dados inesperados.');
 const link=new URL(`https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${encodeURIComponent(code)}`);
 return {externalId:code,code,title,startsAt:date(m.startDate),endsAt:date(m.deadlineDate),documentUrl:link.toString(),sourceState:'aberto',documents:[],programs:[]};
}
async function fetchEuListingUncached(fetcher:typeof fetch):Promise<EuCandidate[]>{
 const deadline=Date.now()+35000,entries:EuCandidate[]=[],seen=new Map<string,{page:number;reference:string;value:string}>();let expected:number|null=null,rows=0;
 const fetchPage=async(page:number)=>{
  const form=new FormData();form.append('query',new Blob([JSON.stringify({bool:{must:[{terms:{type:['1']}},{terms:{status:['31094502']}},{terms:{language:['en']}}]}})],{type:'application/json'}),'query.json');
  form.append('sort',new Blob([JSON.stringify({field:'identifier',order:'ASC'})],{type:'application/json'}),'sort.json');
  form.append('pageSize','100');form.append('pageNumber',String(page));
  const response=await fetcher('https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***',{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!response.ok||!response.body||Number(response.headers.get('content-length'))>8_000_000)throw new Error('Resposta europeia indisponível ou demasiado grande.');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>8_000_000){await reader.cancel();throw new Error('Resposta europeia demasiado grande.');}chunks.push(part.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let payload:Record<string,unknown>;try{payload=object(JSON.parse(new TextDecoder().decode(bytes)));}catch{throw new Error('Resposta europeia inválida.');}
  if(payload.pageNumber!==page||payload.pageSize!==100||!Number.isInteger(payload.totalResults)||typeof payload.totalResults!=='number'||payload.totalResults<0||payload.totalResults>1000||!Array.isArray(payload.results))throw new Error('Não foi possível confirmar a paginação europeia.');
  return {total:payload.totalResults,results:payload.results};
 };
 for(let start=1;start<=100;){
  if(Date.now()>deadline)throw new Error('Tempo limite europeu atingido; consulta incompleta.');
  const count:number=expected===null?1:Math.min(3,Math.ceil(expected/100)-start+1);if(count<=0)break;
  const batch:{total:number;results:unknown[]}[]=await Promise.all(Array.from({length:count},(_,i)=>fetchPage(start+i)));
  for(const [index,page] of batch.entries()){if(expected!==null&&expected!==page.total)throw new Error('A listagem europeia mudou durante a consulta.');expected=page.total;rows+=page.results.length;
   for(const raw of page.results){const item=parseEuRecord(raw),reference=object(raw).reference;if(typeof reference!=='string'||!reference)throw new Error('Referência europeia em falta.');const previous=seen.get(item.externalId),value=JSON.stringify(item);if(previous){if(previous.page!==start+index||previous.reference!==reference||previous.value!==value)throw new Error('A listagem europeia contém duplicados inconsistentes.');continue;}seen.set(item.externalId,{page:start+index,reference,value});entries.push(item);}}
  if(rows===expected)return entries;
  if(expected!==null&&rows>expected)throw new Error('A listagem europeia tem contagem inesperada.');
  start+=count;
 }
 throw new Error('A listagem europeia não foi recolhida integralmente.');
}
let officialListingCache:Promise<EuCandidate[]>|undefined;let officialListingCacheAt=0;
export async function fetchEuListing(fetcher:typeof fetch=fetch):Promise<EuCandidate[]>{
 if(fetcher!==fetch)return fetchEuListingUncached(fetcher);
 if(!officialListingCache||Date.now()-officialListingCacheAt>90_000){officialListingCacheAt=Date.now();officialListingCache=fetchEuListingUncached(fetcher).catch(error=>{officialListingCache=undefined;officialListingCacheAt=0;throw error;});}
 return officialListingCache;
}
const programs={
 horizonte:{prefix:'HORIZON',exclude:['HORIZON-EIC']},
 eic:{prefix:'HORIZON-EIC'},cef:{prefix:'CEF'},cerv:{prefix:'CERV'},creative:{prefix:'CREA'},digital:{prefix:'DIGITAL'},
 eu4health:{prefix:'EU4H'},edf:{prefix:'EDF'},life:{prefix:'LIFE'},erasmus:{prefix:'ERASMUS'},smp:{prefix:'SMP'},
 innovation_fund:{prefix:'INNOVFUND'},prima:{prefix:'PRIMA'}
} as const;
export type EuProgramKey=keyof typeof programs;
export async function fetchEuProgramListing(key:EuProgramKey,fetcher:typeof fetch=fetch){const p=programs[key],rows=await fetchEuListing(fetcher);return rows.filter(x=>x.code.startsWith(p.prefix)&&!('exclude'in p&&p.exclude.some(prefix=>x.code.startsWith(prefix)))).map(x=>({...x,programs:[key]}));}
