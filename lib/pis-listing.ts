import {load} from 'cheerio';
import {createHash} from 'node:crypto';
import {MAX_BYTES,permittedSourceUrl} from './diagnostic.ts';
export type Candidate={external_id:string;code:string;region:string;opening_date:string;closing_date:string;document_url:string;content_hash:string};
function validDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const n=Date.parse(`${value}T00:00:00Z`);return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value;}
export function parsePisListing(html:string):Candidate[]{
 const find=load(html);const grids=find('.jet-listing-grid__items');if(grids.length!==1)throw new Error('A estrutura da listagem da fonte mudou.');
 const grid=grids.first();if(grid.attr('data-pages')!=='1')throw new Error('Não é possível confirmar que a listagem está completa.');
 const cards=grid.find('.jet-listing-grid__item');if(cards.length===0||cards.length>=999)throw new Error('Não é possível confirmar que a listagem está completa.');
 const seen=new Set<string>();return cards.toArray().map(element=>{
  const card=find(element),id=card.attr('data-post-id')||'',fields=card.find('.jet-listing-dynamic-field__content');
  if(!/^\d+$/.test(id)||seen.has(id)||fields.length!==5)throw new Error('Um registo da listagem tem estrutura inesperada.');seen.add(id);
  const region=fields.eq(1).text().trim(),code=fields.eq(2).text().trim(),opening=fields.eq(3).text().trim(),closing=fields.eq(4).text().trim();
  const href=fields.eq(2).find('a');if(href.length!==1)throw new Error('Um aviso não tem um endereço inequívoco.');const address=href.attr('href')||'';
  let documentUrl:URL;try{documentUrl=new URL(address);if(documentUrl.protocol!=='https:'||documentUrl.username||documentUrl.password)throw new Error();}catch{throw new Error('Um aviso tem um endereço inválido.');}
  if(!region||!code||!validDate(opening)||!validDate(closing))throw new Error('Um registo contém campos em falta ou datas inválidas.');
  const raw={external_id:id,code,region,opening_date:opening,closing_date:closing,document_url:documentUrl.toString()};
  return {...raw,content_hash:createHash('sha256').update(JSON.stringify(raw)).digest('hex')};
 });
}
export async function fetchPisListing(url:string,fetcher:typeof fetch=fetch):Promise<{bytes:Uint8Array;candidates:Candidate[]}>{
 if(!permittedSourceUrl(url))throw new Error('Endereço não suportado pelo conector.');
 const form=new URLSearchParams({action:'jet_engine_ajax',handler:'get_listing','page_settings[post_id]':'927','page_settings[queried_id]':'927|WP_Post','page_settings[element_id]':'a058988','page_settings[page]':'1',listing_type:'elementor',isEditMode:'false'});
 const response=await fetcher(url,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json','User-Agent':'Crowe-GI-Radar/0.1 (consulta de avisos)'},body:form,signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error(`A listagem devolveu HTTP ${response.status}.`);
 if(!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type')||''))throw new Error('A listagem não devolveu JSON.');
 if(Number(response.headers.get('content-length'))>MAX_BYTES)throw new Error('A listagem excede o tamanho permitido.');
 if(!response.body)throw new Error('A listagem devolveu uma resposta vazia.');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw new Error('A listagem excede o tamanho permitido.');}chunks.push(r.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let i=0;for(const c of chunks){bytes.set(c,i);i+=c.length;}
 let result:unknown;try{result=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('A resposta da listagem não é JSON válido.');}
 if(!result||typeof result!=='object'||!('success' in result)||result.success!==true||!('data' in result)||!result.data||typeof result.data!=='object'||!('html' in result.data)||typeof result.data.html!=='string')throw new Error('A resposta da listagem tem formato inesperado.');
 return {bytes,candidates:parsePisListing(result.data.html)};
}
