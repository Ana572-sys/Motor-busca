import {after} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import type {SupabaseClient} from '@supabase/supabase-js';
import {processScanSource} from '@/lib/scan-processor';
import {dispatchPendingNotifications,graphConfigFromEnv,queueWeeklyDigest} from '@/lib/notifications';
import {renderWeeklyReport,type WeeklyItem,type WeeklyReport} from '@/lib/weekly-email';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

export async function GET(request:Request){
 const secret=process.env.CRON_SECRET;if(!secret||secret.length<16||request.headers.get('authorization')!==`Bearer ${secret}`)return Response.json({error:'unauthorized'},{status:401});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;if(!url||!key)return Response.json({error:'database_not_configured'},{status:503});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),{data:scanId,error}=await db.rpc('enqueue_weekly_scan',{p_now:new Date().toISOString()});
 if(error)return Response.json({error:'weekly_scan_enqueue_failed'},{status:500});
 if(!scanId)return Response.json({status:'outside_lisbon_schedule_window'});
 after(async()=>{
  await Promise.allSettled(Array.from({length:44},()=>processScanSource(db,scanId)));
  const [{data:scan},{data:tasks}]=await Promise.all([
   db.from('scans').select('id,scheduled_for').eq('id',scanId).maybeSingle(),
   db.from('scan_sources').select('source_id,status').eq('scan_id',scanId),
  ]);
  if(!scan?.scheduled_for)return;
  try{
   const report=await buildReport(db,scanId,scan.scheduled_for,tasks||[],request.url);
   await queueWeeklyDigest(db,scanId,renderWeeklyReport(report,request.url));
   const graph=graphConfigFromEnv();if(graph)await dispatchPendingNotifications(db,graph);
  }catch(error){console.error('Não foi possível compor ou enviar o resumo semanal.',error instanceof Error?error.message:'weekly_digest_failed');}
 });
 return Response.json({status:'weekly_scan_started',scan_id:scanId});
}

async function buildReport(db:SupabaseClient<any>,_scanId:string,scheduledFor:string,tasks:{source_id:string;status:string}[],requestUrl:string):Promise<WeeklyReport>{
 const target=new URL(requestUrl);if(target.protocol!=='https:')throw new Error('site_url_must_use_https');
 const since=new Date(`${scheduledFor}T00:00:00.000Z`);since.setUTCDate(since.getUTCDate()-7);const sinceIso=since.toISOString();
 const {data:sources,error:sourceError}=await db.from('sources').select('id,name').eq('active',true);if(sourceError)throw new Error('active_sources_unavailable');
 const sourceNames=new Map((sources||[]).map(row=>[row.id,row.name]));
 const unavailable=tasks.filter(row=>row.status!=='concluída').map(row=>sourceNames.get(row.source_id)||'Fonte sem nome');
 const sourceIds=(sources||[]).map(row=>row.id),newRows:any[]=[],changeRows:any[]=[];
 for(let offset=0;offset<10000;offset+=500){const {data,error}=await db.from('source_candidates').select('id,title,code,source_id,closing_date,document_url,source_state,first_observed_at').in('source_id',sourceIds).gte('first_observed_at',sinceIso).order('first_observed_at',{ascending:false}).range(offset,offset+499);if(error)throw new Error('new_candidates_unavailable');newRows.push(...(data||[]));if((data||[]).length<500)break;}
 for(let offset=0;offset<10000;offset+=500){const {data,error}=await db.from('candidate_changes').select('id,candidate_id,source_id,previous_fields,current_fields,detected_at').in('source_id',sourceIds).gte('detected_at',sinceIso).order('detected_at',{ascending:false}).range(offset,offset+499);if(error)throw new Error('candidate_changes_unavailable');changeRows.push(...(data||[]));if((data||[]).length<500)break;}
 const distinctChanges=new Map<string,any>();for(const row of changeRows)if(!distinctChanges.has(row.candidate_id))distinctChanges.set(row.candidate_id,row);
 const changes=[...distinctChanges.values()],candidateIds=changes.map(row=>row.candidate_id),{data:currentCandidates}=candidateIds.length?await db.from('source_candidates').select('id,title,code,document_url,closing_date').in('id',candidateIds):{data:[]};
 const currentById=new Map((currentCandidates||[]).map(row=>[row.id,row]));let extensions=0;
 const items:WeeklyItem[]=[],seen=new Set<string>();
 for(const row of newRows){if(seen.has(row.id))continue;seen.add(row.id);items.push({id:row.id,title:row.title||row.code||'Aviso sem título',summary:`Novo aviso registado${row.closing_date?`; prazo indicado: ${row.closing_date}`:''}.`,url:safeHttps(row.document_url)});}
 for(const row of changes){const current=currentById.get(row.candidate_id),oldFields=row.previous_fields||{},newFields=row.current_fields||{};const oldDeadline=typeof oldFields.closing_date==='string'?oldFields.closing_date:null,newDeadline=typeof newFields.closing_date==='string'?newFields.closing_date:null;if(oldDeadline&&newDeadline&&newDeadline>oldDeadline)extensions++;if(seen.has(row.candidate_id))continue;seen.add(row.candidate_id);items.push({id:row.candidate_id,title:current?.title||newFields.title||current?.code||newFields.code||'Aviso atualizado',summary:`Alteração detetada na listagem oficial${newDeadline?`; prazo atualmente indicado: ${newDeadline}`:''}.`,url:safeHttps(current?.document_url||newFields.document_url)});}
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),end=new Date(`${today}T00:00:00.000Z`);end.setUTCDate(end.getUTCDate()+30);const endDate=end.toISOString().slice(0,10);
 const {data:endingRows,error:endingError}=await db.from('source_candidates').select('title,code,closing_date').in('source_id',sourceIds).gte('closing_date',today).lte('closing_date',endDate).order('closing_date').limit(100);if(endingError)throw new Error('deadlines_unavailable');
 return {date:scheduledFor,period:`${since.toISOString().slice(0,10)} a ${scheduledFor}`,coverageComplete:tasks.length>0&&tasks.every(row=>row.status==='concluída'),newCount:newRows.length,changedCount:changes.length,extensions,republications:null,ending:(endingRows||[]).map(row=>`${row.title||row.code||'Aviso sem título'} — ${row.closing_date}`),unavailable,items:items.slice(0,30)};
}
function safeHttps(value:unknown){if(typeof value!=='string')return null;try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.toString():null;}catch{return null;}}
