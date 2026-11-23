import type {SupabaseClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';

type Candidate=Record<string,unknown>;
const text=(...values:unknown[])=>values.find(value=>typeof value==='string'&&value.trim()) as string|undefined;
const date=(value:unknown)=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}/.test(value))return null;const parsed=new Date(`${value.slice(0,10)}T00:00:00Z`);return Number.isNaN(parsed.getTime())?null:value.slice(0,10);};
const safeUrl=(value:unknown)=>{if(typeof value!=='string')return null;try{const url=new URL(value);return url.protocol==='https:'?url.toString():null;}catch{return null;}};
const isPdf=(value:string)=>{try{const url=new URL(value);return url.pathname.toLowerCase().endsWith('.pdf')||[url.searchParams.get('filename'),url.searchParams.get('file')].some(name=>name?.toLowerCase().endsWith('.pdf'));}catch{return false;}};
const stable=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Copies only facts present in a source listing. This does not mark notices as eligibility-analyzed. */
export async function syncCandidatesToRadar(db:SupabaseClient,source:{id:string;name:string},candidates:unknown[]){
 let inserted=0,updated=0;
 for(const raw of candidates){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
  const item=raw as Candidate,title=text(item.title,item.name);if(!title)continue;
  const code=text(item.code,item.officialCode,item.externalId,item.external_id);
  const programValue=item.programs??item.program;
  const program=Array.isArray(programValue)?programValue.map(x=>typeof x==='string'?x:'').filter(Boolean).join(' · '):text(programValue);
  const deadline=date(item.endsAt??item.closing_date??item.deadline),opening=date(item.startsAt??item.opening_date);
  const sourceState=text(item.sourceState,item.source_state,item.status)?.toLowerCase();
  const status=sourceState?.includes('fech')||sourceState?.includes('clos')||Boolean(deadline&&deadline<new Date().toISOString().slice(0,10))?'closed':'open';
  const officialUrl=safeUrl(item.officialUrl??item.official_url??item.url??item.documentUrl??item.document_url);
  const candidateRegion=text(item.region,item.eligibleRegion,item.eligible_region);
  const region=candidateRegion&&!/^(informação não identificada|não identificável)/i.test(candidateRegion.trim())?candidateRegion:null;
  // Prefer the official code. Without it, scope identity to this source and its stable external ID.
  const identity=code?`official-code:${code.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()}`:`source:${source.id}:${text(item.externalId,item.external_id)??stable(title)}`;
  const canonicalKey=stable(identity);
  const {data:existing,error:lookupError}=await db.from('radar_notices').select('id,program,opening_date,deadline,eligible_regions,official_url').eq('canonical_key',canonicalKey).maybeSingle();
  if(lookupError)throw new Error('radar_catalog_lookup_failed');
  const regions=region?Array.from(new Set([...(existing?.eligible_regions||[]),region])):existing?.eligible_regions||[];
  const payload={canonical_key:canonicalKey,official_code:code??null,title,program:program??existing?.program??null,status,opening_date:opening??existing?.opening_date??null,deadline:deadline??existing?.deadline??null,eligible_regions:regions,official_url:officialUrl??existing?.official_url??null,last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const {data:notice,error:noticeError}=await db.from('radar_notices').upsert(payload,{onConflict:'canonical_key'}).select('id').single();
  if(noticeError||!notice)throw new Error('radar_catalog_write_failed');
  if(existing)updated++;else inserted++;
  const sourceHash=text(item.contentHash,item.content_hash)??stable(item);
  const {data:candidate}=await db.from('source_candidates').select('id').eq('source_id',source.id).eq('external_id',text(item.externalId,item.external_id)??'').maybeSingle();
  const sourceLink={notice_id:notice.id,source_id:source.id,candidate_id:candidate?.id??null,official_url:officialUrl,document_url:safeUrl(item.documentUrl??item.document_url),source_title:title,source_code:code??null,last_observed_hash:sourceHash,last_observed_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const {error:linkError}=await db.from('radar_notice_sources').upsert(sourceLink,{onConflict:'source_id,candidate_id'});
  if(linkError)throw new Error('radar_catalog_source_link_failed');
  const snapshot={...item,source_name:source.name,source_id:source.id,listing_only:true};
  const contentHash=text(item.contentHash,item.content_hash)??stable(snapshot);
  const {data:version,error:versionError}=await db.from('radar_notice_versions').upsert({notice_id:notice.id,content_hash:contentHash,snapshot,status,detected_at:new Date().toISOString()},{onConflict:'notice_id,content_hash',ignoreDuplicates:true}).select('id').maybeSingle();
  if(versionError)throw new Error('radar_catalog_version_failed');
  let versionId=version?.id as string|undefined;
  if(!versionId){const {data:found,error}=await db.from('radar_notice_versions').select('id').eq('notice_id',notice.id).eq('content_hash',contentHash).single();if(error||!found)throw new Error('radar_catalog_version_lookup_failed');versionId=found.id;}
  const urls=new Set<string>();const primary=safeUrl(item.documentUrl??item.document_url);if(primary)urls.add(primary);
  const documents=Array.isArray(item.documents)?item.documents:[];
  for(const document of documents){const url=typeof document==='string'?safeUrl(document):document&&typeof document==='object'?safeUrl((document as Candidate).url??(document as Candidate).documentUrl??(document as Candidate).document_url):null;if(url)urls.add(url);}
  for(const url of urls){const isPrimary=url===primary;const pdf=isPdf(url);const kind=isPrimary?(pdf?'primary':'official_page'):'complementary';const docHash=stable(url);const name=isPrimary?(pdf?`${title} — PDF principal`:`${title} — página oficial`):url.split('/').pop()||'Documento complementar';const {error}=await db.from('radar_notice_documents').upsert({version_id:versionId,kind,name,official_url:url,content_hash:docHash,extraction_status:pdf?'pending':'unsupported'},{onConflict:'version_id,content_hash',ignoreDuplicates:true});if(error)throw new Error('radar_catalog_document_write_failed');}
  // A source listing is not evidence for beneficiaries, expenses, funding rate, or eligibility.
 }
 return {inserted,updated};
}
