import {load} from 'cheerio';

const source='https://www.clustercollaboration.eu/funding-and-tenders';
type Candidate={externalId:string;code:string;title:string;startsAt:null;endsAt:string|null;documentUrl:string;sourceState:'aberto';documents:never[];programs:string[]};
function deadline(text:string):string|null{
 const m=text.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);if(!m)return null;
 const months:Record<string,string>={january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12'};
 const value=`${m[3]}-${months[m[2].toLowerCase()]}-${m[1].padStart(2,'0')}`,date=new Date(`${value}T00:00:00Z`);if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==value)throw new Error('Prazo da oportunidade de cluster inválido.');return value;
}
export function parseClusterCalls(html:string):Candidate[]{
 const $=load(html);if(!$('title').text().includes('Funding and tenders | European Cluster Collaboration Platform'))throw new Error('Página de financiamento de clusters inesperada.');
 const cards=$('.card--open-calls');if(!cards.length)throw new Error('Listagem de oportunidades de clusters sem estrutura reconhecida.');
 const out:Candidate[]=[],seen=new Set<string>();cards.each((_,el)=>{const card=$(el),title=card.find('.card-title').text().replace(/\s+/g,' ').trim();if(!title)return;const more=card.find('a').toArray().map(a=>$(a).attr('href')).find(h=>h&&!/^\/tags\//.test(h)),u=more?new URL(more,source):new URL(source);if(u.origin!=='https://www.clustercollaboration.eu'||u.pathname==='/funding-and-tenders'||u.search||u.hash)throw new Error('Ligação da oportunidade de cluster inesperada.');if(seen.has(title))return;seen.add(title);const text=card.text().replace(/\s+/g,' ');out.push({externalId:more?u.pathname:`${u.pathname}#${encodeURIComponent(title.toLowerCase().replace(/[^a-z0-9]+/g,'-'))}`,code:`CLUSTER-${title.toUpperCase().replace(/[^A-Z0-9]+/g,'-').slice(0,100)}`,title,startsAt:null,endsAt:deadline(text),documentUrl:u.toString(),sourceState:'aberto',documents:[],programs:['European Cluster Collaboration Platform']});});
 if(!out.length)throw new Error('Não foram encontradas oportunidades na página de clusters.');return out;
}
export async function fetchClusterCalls(fetcher:typeof fetch=fetch){const r=await fetcher(source,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok||!r.body||Number(r.headers.get('content-length'))>3_000_000)throw new Error('Listagem de oportunidades de clusters indisponível.');const reader=r.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{while(true){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>3_000_000){await reader.cancel();throw new Error('Listagem de oportunidades de clusters demasiado grande.');}chunks.push(v.value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return parseClusterCalls(new TextDecoder().decode(bytes));}
