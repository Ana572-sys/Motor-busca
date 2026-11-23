export type PessoasDocument={id:string;name:string;type:string;url:string};
export type PessoasCandidate={externalId:string;code:string;title:string;updatedAt:string|null;publishedAt:string|null;startsAt:string|null;endsAt:string|null;programs:string[];documents:PessoasDocument[];sourceState:'aberto'|'encerrado'};
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const str=(value:unknown):string|null=>typeof value==='string'&&value.trim()?value.trim():null;
function parseCandidate(input:unknown,state:'aberto'|'encerrado',origin:string):PessoasCandidate{
 const row=record(input),notice=record(row.aviso),calendar=record(row.calendario);const id=notice.avisoGlobalId,code=str(notice.codigoAviso),title=str(notice.designacaoPT);
 if((typeof id!=='number'&&typeof id!=='string')||!/^\d+$/.test(String(id))||!code||!title||!Array.isArray(row.documentos))throw new Error('Um aviso tem estrutura inesperada.');
 const documents=row.documentos.map(value=>{const d=record(value),id=str(d.documentoId),name=str(d.documentoDesignacao),type=str(d.tipoDocumentoDesignacao),container=str(d.container),path=str(d.path);
  if(!id||!name||!type||!container||!path)throw new Error('Um documento tem dados incompletos.');const url=new URL('/wp-json/avisos/download',origin);url.search=new URLSearchParams({container,path,filename:name}).toString();return {id,name,type,url:url.toString()};});
 documents.sort((a,b)=>a.id.localeCompare(b.id));
 const programs=Array.isArray(row.estrutura)?[...new Set(row.estrutura.map(x=>str(record(x).programaOperacionalDesignacao)).filter((x):x is string=>x!==null))].sort():[];
 return {externalId:String(id),code,title,updatedAt:str(notice.dataUltimaAlteracao),publishedAt:str(calendar.dataPublicacao),startsAt:str(calendar.dataInicio),endsAt:str(calendar.dataFimAtual)||str(calendar.dataFim),programs,documents,sourceState:state};
}
async function fetchFeed(origin:string,programId:string|null,state:'aberto'|'encerrado',fetcher:typeof fetch):Promise<PessoasCandidate[]>{
 const entries:PessoasCandidate[]=[],ids=new Set<string>(),deadline=Date.now()+35000;
 const pageSize=origin==='https://pessoas2030.gov.pt'?1:3;
 const fetchPage=async(page:number):Promise<unknown[]>=>{
  const form=new URLSearchParams({estadoAvisoId:state==='aberto'?'7':'8',page:String(page)});if(programId)form.set('programaId',programId);
  let response:Response|undefined,lastError:unknown;
  for(let attempt=0;attempt<2;attempt++){
   try{
    response=await fetcher(new URL('/wp-json/avisos/query',origin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json','User-Agent':'Crowe-GI-Radar/0.1 (consulta de avisos)'},body:form});
    if(response.status<500&&response.status!==429)break;
    lastError=new Error(`HTTP ${response.status}`);
   }catch(error){lastError=error;}
   if(attempt===1||Date.now()+500>=deadline){
    const detail=lastError instanceof Error?lastError.message:'erro de ligação';
    throw new Error(`A fonte não respondeu após duas tentativas: ${detail}`);
   }
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!response)throw new Error('A fonte não respondeu após duas tentativas.');
  if(!response.ok)throw new Error(`A fonte devolveu HTTP ${response.status}.`);
  if(Number(response.headers.get('content-length'))>2_000_000||!response.body)throw new Error('A resposta da fonte é demasiado grande ou está vazia.');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>2_000_000){await reader.cancel();throw new Error('A resposta da fonte é demasiado grande.');}chunks.push(part.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let parsed:unknown;try{parsed=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('A fonte devolveu JSON inválido.');}
  const payload=record(parsed),cache=record(payload.balcao2030_cache);
  if(cache.status&&cache.status!=='fresh')throw new Error('A fonte devolveu dados em cache sem atualização confirmada.');
  if(payload.status===404)return [];
  if((payload.status!==200&&payload.status!==201)||!Array.isArray(payload.avisos))throw new Error('A resposta da fonte tem estrutura inesperada.');
  return payload.avisos;
 };
 for(let page=0;page<200;page+=pageSize){
  if(Date.now()>deadline)throw new Error('Tempo limite atingido; a listagem não foi considerada completa.');
  const batch=await Promise.allSettled(Array.from({length:Math.min(pageSize,200-page)},(_,i)=>fetchPage(page+i)));
  for(const result of batch){
   if(result.status==='rejected')throw result.reason;
   for(const raw of result.value){const item=parseCandidate(raw,state,origin);if(ids.has(item.externalId))throw new Error('A fonte devolveu avisos repetidos na paginação.');ids.add(item.externalId);entries.push(item);}
   if(result.value.length<5)return entries;
  }
 }
 throw new Error('A listagem excedeu o limite de páginas; não foi considerada completa.');
}
export async function fetchPessoas(state:'aberto'|'encerrado',fetcher:typeof fetch=fetch){return fetchFeed('https://pessoas2030.gov.pt','102',state,fetcher);}
export async function fetchPortugal2030(state:'aberto'|'encerrado',fetcher:typeof fetch=fetch){return fetchFeed('https://portugal2030.pt',null,state,fetcher);}
const regional={
 norte:{origin:'https://portugal2030.pt',id:'103',program:'Programa Regional do Norte 2021-2027'},
 centro:{origin:'https://centro2030.pt',id:'104',program:'Programa Regional do Centro 2021-2027'},
 lisboa:{origin:'https://lisboa.portugal2030.pt',id:'105',program:'Programa Regional de Lisboa 2021-2027'},
 alentejo:{origin:'https://alentejo.portugal2030.pt',id:'106',program:'Programa Regional do Alentejo 2021-2027'},
 algarve:{origin:'https://algarve.portugal2030.pt',id:'107',program:'Programa Regional do Algarve 2021-2027'},
 acores:{origin:'https://acores.portugal2030.pt',id:'108',program:'Programa Regional dos Açores 2021-2027'},
 madeira:{origin:'https://madeira.portugal2030.pt',id:'109',program:'Programa Regional da Madeira 2021-2027'},
 fami:{origin:'https://www.fami2030.gov.pt',id:'122',program:'Programa do Fundo para o Asilo, a Migração e a Integração 2021-2027'}
} as const;
export type RegionalKey=keyof typeof regional;
export async function fetchRegional(key:RegionalKey,fetcher:typeof fetch=fetch){const x=regional[key],entries=await fetchFeed(x.origin,x.id,'aberto',fetcher);if(entries.some(e=>!e.programs.includes(x.program)))throw new Error('A fonte regional devolveu um programa diferente do solicitado.');return entries;}
export function regionalOrigin(key:RegionalKey){return regional[key].origin;}
