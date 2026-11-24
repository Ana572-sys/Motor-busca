import type {SupabaseClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';

type Candidate=Record<string,unknown>;
type NoticeState='open'|'closed'|'unconfirmed';
type SourceObservation={externalId:string|null;code:string|null;title:string;officialUrl:string|null;documentUrl:string|null;sourceHash:string;status:NoticeState};
type Normalized={item:Candidate;title:string;code:string|null;program:string|null;deadline:string|null;opening:string|null;status:NoticeState;officialUrl:string|null;documentUrl:string|null;externalId:string|null;sourceHash:string;canonicalKey:string;contentHash:string;urls:string[];regions:string[];observations:SourceObservation[];existing:Record<string,any>|null};
const text=(...values:unknown[])=>values.find(value=>typeof value==='string'&&value.trim()) as string|undefined;
const date=(value:unknown)=>{if(typeof value!=='string'||!/^(\d{4}-\d{2}-\d{2})/.test(value))return null;const parsed=new Date(`${value.slice(0,10)}T00:00:00Z`);return Number.isNaN(parsed.getTime())?null:value.slice(0,10);};
const safeUrl=(value:unknown)=>{if(typeof value!=='string')return null;try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.toString():null;}catch{return null;}};
const isPdf=(value:string)=>{try{const url=new URL(value);return url.pathname.toLowerCase().endsWith('.pdf')||[url.searchParams.get('filename'),url.searchParams.get('file')].some(name=>name?.toLowerCase().endsWith('.pdf'));}catch{return false;}};
const stable=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const chunks=<T,>(items:T[],size:number)=>Array.from({length:Math.ceil(items.length/size)},(_,index)=>items.slice(index*size,(index+1)*size));
function sourceNoticeState(value:string|undefined,deadline:string|null,today:string):NoticeState{
 if(deadline&&deadline<today)return 'closed';
 if(value&&/(fech|encerr|clos)/i.test(value))return 'closed';
 if(value&&/(abert|open)/i.test(value))return 'open';
 return 'unconfirmed';
}

/** Copies listing facts with bounded batch requests; it does not infer eligibility. */
export async function syncCandidatesToRadar(db:SupabaseClient,source:{id:string;name:string},candidates:unknown[]){
 const today=new Date().toISOString().slice(0,10),normalized:Normalized[]=[];
 for(const raw of candidates){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
  const item=raw as Candidate,title=text(item.title,item.name);if(!title)continue;
  const code=text(item.code,item.officialCode,item.externalId,item.external_id)??null;
  const programValue=item.programs??item.program;
  const program=Array.isArray(programValue)?programValue.map(x=>typeof x==='string'?x:'').filter(Boolean).join(' · ')||null:text(programValue)??null;
  const deadline=date(item.endsAt??item.closing_date??item.deadline),opening=date(item.startsAt??item.opening_date);
  const sourceState=text(item.sourceState,item.source_state,item.status)?.toLowerCase();
  const status=/suspens[aã]o de candidaturas/i.test(code||'')?'unconfirmed':sourceNoticeState(sourceState,deadline,today);
  const officialUrl=safeUrl(item.officialUrl??item.official_url??item.url??item.documentUrl??item.document_url),documentUrl=safeUrl(item.documentUrl??item.document_url);
  const observedRegion=text(item.region,item.eligibleRegion,item.eligible_region);
  const regions=observedRegion&&!/^(informação não identificada|não identificável)/i.test(observedRegion.trim())?[observedRegion]:[];
  const externalId=text(item.externalId,item.external_id)??null;
  const identityCode=code?.split(/\s*\|\s*/)[0].normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const identity=identityCode?`official-code:${identityCode}`:`source:${source.id}:${externalId??stable(title)}`;
  const canonicalKey=stable(identity),urls=new Set<string>();if(documentUrl)urls.add(documentUrl);
  const documents=Array.isArray(item.documents)?item.documents:[];
  for(const document of documents){const url=typeof document==='string'?safeUrl(document):document&&typeof document==='object'?safeUrl((document as Candidate).url??(document as Candidate).documentUrl??(document as Candidate).document_url):null;if(url)urls.add(url);}
  const sourceHash=text(item.contentHash,item.content_hash)??stable(item),urlList=[...urls].sort();
  const observation={externalId,code,title,officialUrl,documentUrl,sourceHash,status};
  normalized.push({item,title,code,program,deadline,opening,status,officialUrl,documentUrl,externalId,sourceHash,canonicalKey,contentHash:'',urls:urlList,regions,observations:[observation],existing:null});
 }
 const deduplicated=new Map<string,Normalized>();for(const row of normalized){const current=deduplicated.get(row.canonicalKey);if(!current){deduplicated.set(row.canonicalKey,row);continue;}current.observations.push(...row.observations);current.urls=[...new Set([...current.urls,...row.urls])].sort();current.regions=[...new Set([...current.regions,...row.regions])];if(current.status!=='open'&&row.status==='open')current.status='open';if(!current.officialUrl&&row.officialUrl)current.officialUrl=row.officialUrl;if(!current.documentUrl&&row.documentUrl)current.documentUrl=row.documentUrl;}normalized.splice(0,normalized.length,...deduplicated.values());
 let inserted=0,updated=0;
 for(const group of chunks(normalized,100)){
  const keys=group.map(row=>row.canonicalKey);
  const {data:existingRows,error:lookupError}=await db.from('radar_notices').select('*').in('canonical_key',keys);
  if(lookupError||!existingRows)throw new Error('radar_catalog_lookup_failed');
  const existingByKey=new Map(existingRows.map((row:any)=>[row.canonical_key,row]));
  const notices=group.map(row=>{
   const existing=existingByKey.get(row.canonicalKey) as Record<string,any>|undefined;row.existing=existing??null;
   const contentHash=stable({canonicalKey:row.canonicalKey,title:row.title,program:row.program??existing?.program??null,status:row.status,opening:row.opening??existing?.opening_date??null,deadline:row.deadline??existing?.deadline??null,observedRegion:row.regions[0]??null,officialUrl:row.officialUrl??existing?.official_url??null,documents:row.urls});row.contentHash=contentHash;
   if(existing)updated++;else inserted++;
   const now=new Date().toISOString();return {id:existing?.id,canonical_key:row.canonicalKey,official_code:row.code,title:row.title,program:row.program??existing?.program??null,status:row.status,analysis_status:existing?.analysis_status??'pending',opening_date:row.opening??existing?.opening_date??null,deadline:row.deadline??existing?.deadline??null,eligible_regions:existing?.eligible_regions??[],beneficiaries:existing?.beneficiaries??[],eligible_sectors:existing?.eligible_sectors??[],eligible_caes:existing?.eligible_caes??[],investment_minimum:existing?.investment_minimum??null,investment_maximum:existing?.investment_maximum??null,funding_rate:existing?.funding_rate??null,eligible_expenses:existing?.eligible_expenses??[],ineligible_expenses:existing?.ineligible_expenses??[],spending_conditions:existing?.spending_conditions??[],partnership_required:existing?.partnership_required??null,rd_requirement:existing?.rd_requirement??'unidentified',short_summary:existing?.short_summary??null,official_url:row.officialUrl??existing?.official_url??null,extraction_confidence:existing?.extraction_confidence??null,first_seen_at:existing?.first_seen_at??now,last_seen_at:now,last_analyzed_at:existing?.last_analyzed_at??null,updated_at:now};
  });
  const {data:written,error:noticeError}=await db.from('radar_notices').upsert(notices,{onConflict:'canonical_key'}).select('id,canonical_key');
  if(noticeError||!written)throw new Error('radar_catalog_write_failed');
  const noticeIdByKey=new Map(written.map((row:any)=>[row.canonical_key,row.id]));
  const externalIds=group.flatMap(row=>row.observations.map(observation=>observation.externalId)).filter((value):value is string=>Boolean(value));
  const {data:candidateRows,error:candidateError}=externalIds.length?await db.from('source_candidates').select('id,external_id').eq('source_id',source.id).in('external_id',externalIds):{data:[],error:null};
  if(candidateError)throw new Error('radar_source_candidate_lookup_failed');
  const candidateIdByExternal=new Map((candidateRows||[]).map((row:any)=>[row.external_id,row.id]));
  const now=new Date().toISOString();
  const links=group.flatMap(row=>row.observations.map(observation=>({notice_id:noticeIdByKey.get(row.canonicalKey),source_id:source.id,candidate_id:observation.externalId?candidateIdByExternal.get(observation.externalId)??null:null,official_url:observation.officialUrl,document_url:observation.documentUrl,source_title:observation.title,source_code:observation.code,observed_status:observation.status,last_observed_hash:observation.sourceHash,last_observed_at:now,updated_at:now}))).filter(row=>row.notice_id);
  if(links.length){const {error}=await db.from('radar_notice_sources').upsert(links,{onConflict:'source_id,candidate_id'});if(error)throw new Error('radar_catalog_source_link_failed');}
  const affectedNoticeIds=[...new Set(links.map(row=>row.notice_id as string))];
  const {data:linkedStates,error:linkedStateError}=affectedNoticeIds.length?await db.from('radar_notice_sources').select('notice_id,observed_status,source_code').in('notice_id',affectedNoticeIds):{data:[],error:null};
  if(linkedStateError)throw new Error('radar_catalog_state_lookup_failed');
  const resolvedStates=new Map<string,NoticeState>();
  const suspendedNoticeIds=new Set<string>();
  for(const link of linkedStates||[]){if(/suspens[aã]o de candidaturas/i.test(link.source_code||''))suspendedNoticeIds.add(link.notice_id);const current=resolvedStates.get(link.notice_id);if(link.observed_status==='open')resolvedStates.set(link.notice_id,'open');else if(!current)resolvedStates.set(link.notice_id,link.observed_status as NoticeState);else if(current!=='open'&&link.observed_status!=='closed')resolvedStates.set(link.notice_id,'unconfirmed');}
  const statusIds=new Map<NoticeState,string[]>([['open',[]],['closed',[]],['unconfirmed',[]]]);
  for(const notice of group){const noticeId=noticeIdByKey.get(notice.canonicalKey);if(!noticeId)continue;const resolved=resolvedStates.get(noticeId)||notice.status;const deadlineExpired=Boolean(notice.deadline&&notice.deadline<today);const status:NoticeState=suspendedNoticeIds.has(noticeId)?'unconfirmed':deadlineExpired?'closed':resolved;statusIds.get(status)!.push(noticeId);notice.status=status;}
  for(const [status,ids] of statusIds){if(!ids.length)continue;const {error}=await db.from('radar_notices').update({status,...(status==='closed'?{closed_detected_at:now}:{}),updated_at:now}).in('id',ids);if(error)throw new Error('radar_catalog_state_write_failed');}
  const versions=group.map(row=>({notice_id:noticeIdByKey.get(row.canonicalKey),content_hash:row.contentHash,snapshot:{...row.item,source_observations:row.observations,source_name:source.name,source_id:source.id,listing_only:true},status:row.status,detected_at:now})).filter(row=>row.notice_id);
  if(versions.length){const {error}=await db.from('radar_notice_versions').upsert(versions,{onConflict:'notice_id,content_hash',ignoreDuplicates:true});if(error)throw new Error('radar_catalog_version_failed');}
  const noticeIds=[...new Set(versions.map(row=>row.notice_id as string))];
  const {data:versionRows,error:versionLookupError}=noticeIds.length?await db.from('radar_notice_versions').select('id,notice_id,content_hash,detected_at,status').in('notice_id',noticeIds).order('detected_at',{ascending:false}).order('id',{ascending:false}):{data:[],error:null};
  if(versionLookupError)throw new Error('radar_catalog_version_lookup_failed');
  const versionByKey=new Map((versionRows||[]).map((row:any)=>[`${row.notice_id}:${row.content_hash}`,row]));
  const latestByNotice=new Map<string,any>();for(const version of versionRows||[])if(!latestByNotice.has(version.notice_id))latestByNotice.set(version.notice_id,version);
  const documentsToSave:{version_id:string;kind:string;name:string;official_url:string;content_hash:string;extraction_status:string}[]=[];
  const queueRows:{version_id:string;status:string;facts:Record<string,never>;source_references:never[]}[]=[];
  const closedVersionIds:string[]=[],openPendingNoticeIds:string[]=[];
  for(const row of group){const noticeId=noticeIdByKey.get(row.canonicalKey);if(!noticeId)continue;const version=versionByKey.get(`${noticeId}:${row.contentHash}`),latest=latestByNotice.get(noticeId);if(!version)throw new Error('radar_catalog_version_lookup_failed');
   for(const url of row.urls){const primary=url===row.documentUrl,pdf=isPdf(url),kind=primary?(pdf?'primary':'official_page'):'complementary';documentsToSave.push({version_id:version.id,kind,name:primary?`${row.title} — ${pdf?'PDF principal':'página oficial'}`:url.split('/').pop()||'Documento complementar',official_url:url,content_hash:stable(url),extraction_status:pdf?'pending':'unsupported'});}
   if(version.id===latest?.id&&row.status==='open')queueRows.push({version_id:version.id,status:'pending',facts:{},source_references:[]});
   if(version.id===latest?.id&&row.status==='closed')closedVersionIds.push(version.id);
  }
  if(documentsToSave.length){const {error}=await db.from('radar_notice_documents').upsert(documentsToSave,{onConflict:'version_id,content_hash',ignoreDuplicates:true});if(error)throw new Error('radar_catalog_document_write_failed');}
  if(queueRows.length){const ids=queueRows.map(row=>row.version_id);const {data:analyses,error}=await db.from('radar_notice_analyses').select('version_id,status').in('version_id',ids);if(error)throw new Error('radar_analysis_queue_lookup_failed');const existingAnalyses=new Map((analyses||[]).map((row:any)=>[row.version_id,row.status]));const missing=queueRows.filter(row=>!existingAnalyses.has(row.version_id));if(missing.length){const {error:queueError}=await db.from('radar_notice_analyses').upsert(missing,{onConflict:'version_id',ignoreDuplicates:true});if(queueError)throw new Error('radar_analysis_queue_write_failed');}
   for(const notice of group){const id=noticeIdByKey.get(notice.canonicalKey);if(!id)continue;const latest=latestByNotice.get(id);if(latest&&latest.status==='open'&&(existingAnalyses.get(latest.id)==='pending'||!existingAnalyses.has(latest.id)))openPendingNoticeIds.push(id);}
  }
  if(openPendingNoticeIds.length){const unique=[...new Set(openPendingNoticeIds)];const {error}=await db.from('radar_notices').update({analysis_status:'pending',eligible_regions:[],beneficiaries:[],eligible_sectors:[],eligible_caes:[],investment_minimum:null,investment_maximum:null,funding_rate:null,eligible_expenses:[],ineligible_expenses:[],spending_conditions:[],partnership_required:null,rd_requirement:'unidentified',short_summary:null,extraction_confidence:null,last_analyzed_at:null,updated_at:now}).in('id',unique);if(error)throw new Error('radar_notice_pending_status_failed');}
  if(closedVersionIds.length){const {error:closeQueueError}=await db.from('radar_notice_analyses').update({status:'incomplete',error_code:'notice_closed_before_analysis',finished_at:now,lease_until:null}).in('version_id',closedVersionIds).eq('status','pending');if(closeQueueError)throw new Error('radar_analysis_close_queue_failed');const ids=[...new Set(group.filter(row=>row.status==='closed').map(row=>noticeIdByKey.get(row.canonicalKey)).filter(Boolean))] as string[];if(ids.length){const {error}=await db.from('radar_notices').update({analysis_status:'incomplete',updated_at:now}).in('id',ids);if(error)throw new Error('radar_notice_close_analysis_status_failed');}}
 }
 return {inserted,updated};
}
