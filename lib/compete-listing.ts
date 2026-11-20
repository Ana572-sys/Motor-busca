import {load} from 'cheerio';

export type CompeteCandidate={externalId:string;code:string;title:string;startsAt:string|null;endsAt:string|null;documentUrl:string;sourceState:'aberto';documents:never[];programs:string[]};
const origin='https://compete2030.gov.pt';
export function parseCompetePage(html:string,page:number){
 const $=load(html);if(!$('title').text().includes('Avisos | Compete 2030'))throw new Error('Página COMPETE 2030 inesperada.');
 const current=Number($('.pagination .active .page-link').first().clone().children().remove().end().text().trim());
 const pages=$('.pagination a.page-link').map((_,e)=>{const u=new URL($(e).attr('href')||'',origin);if(u.origin!==origin||u.pathname!=='/avisos/')throw new Error('Paginação COMPETE 2030 inesperada.');return Number(u.searchParams.get('page'));}).get();
 if(current!==page||pages.some(n=>!Number.isInteger(n)||n<1||n>100))throw new Error('Paginação COMPETE 2030 não confirmada.');
 const last=Math.max(current,...pages),articles=$('article.row');if(!articles.length)throw new Error('Listagem COMPETE 2030 vazia ou alterada.');
 const entries:CompeteCandidate[]=[];
 articles.each((_,article)=>{
  const a=$(article),badges=a.find('.date-badges .badge').map((__,e)=>$(e).text().trim()).get();
  if(!badges.includes('Aberto'))return;
  const heading=a.find('h3.card-title'),link=heading.closest('a').attr('href'),code=a.find('h4').first().text().trim(),title=heading.text().trim();
  if(!link||!code||!title)throw new Error('Um aviso COMPETE 2030 tem dados incompletos.');
  const u=new URL(link,origin);if(u.origin!==origin||!/^\/avisos\/[a-z0-9_-]+\/$/.test(u.pathname)||u.search||u.hash)throw new Error('Endereço de aviso COMPETE 2030 inesperado.');
  const button=a.find('button[data-date][data-date_end]').first(),parse=(v:string|undefined)=>v&&/^\d{4}-\d{2}-\d{2}(?: |$)/.test(v)?v.slice(0,10):null;
  entries.push({externalId:u.pathname,code,title,startsAt:parse(button.attr('data-date')),endsAt:parse(button.attr('data-date_end')),documentUrl:u.toString(),sourceState:'aberto',documents:[],programs:['COMPETE 2030']});
 });
 return {last,entries};
}
export async function fetchCompete(fetcher:typeof fetch=fetch):Promise<CompeteCandidate[]>{
 const page=async(n:number)=>{const url=new URL('/avisos/',origin);url.searchParams.set('per_page','24');url.searchParams.set('page',String(n));const r=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok||!r.body||Number(r.headers.get('content-length'))>2_000_000)throw new Error('Listagem COMPETE 2030 indisponível ou demasiado grande.');const reader=r.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{while(true){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>2_000_000){await reader.cancel();throw new Error('Listagem COMPETE 2030 demasiado grande.');}chunks.push(x.value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return parseCompetePage(new TextDecoder().decode(bytes),n);};
 const first=await page(1),last=first.last;if(last>30)throw new Error('Demasiadas páginas COMPETE 2030.');const all=[first];
 for(let n=2;n<=last;n+=3)all.push(...await Promise.all(Array.from({length:Math.min(3,last-n+1)},(_,i)=>page(n+i))));
 const seen=new Set<string>(),entries:CompeteCandidate[]=[];for(const p of all){if(p.last!==last)throw new Error('Paginação COMPETE 2030 mudou durante a consulta.');for(const item of p.entries){if(seen.has(item.externalId))throw new Error('Listagem COMPETE 2030 contém duplicados.');seen.add(item.externalId);entries.push(item);}}return entries;
}
