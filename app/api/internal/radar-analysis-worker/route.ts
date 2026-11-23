import {after} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {validWorkerToken} from '@/lib/worker-auth';
import {currentRadarAnalysisStats,processRadarAnalysisBatch,startRadarAnalysisWorker} from '@/lib/radar-analysis-queue';
import {refreshOpenNoticesMarkdown} from '@/lib/radar-open-markdown';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

export async function POST(request:Request){
 const secret=process.env.SCAN_WORKER_SECRET||process.env.CRON_SECRET;
 if(!secret||secret.length<32)return Response.json({error:'Processador de análises não configurado.'},{status:503});
 if(!validWorkerToken(secret,request.headers.get('authorization')))return Response.json({error:'Não autorizado.'},{status:401});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
 if(!url||!key)return Response.json({error:'Base de dados não configurada.'},{status:503});
 if(!process.env.OPENAI_API_KEY)return Response.json({error:'Chave OpenAI não configurada.'},{status:503});
 const requestedRun=new URL(request.url).searchParams.get('run_id'),runId=requestedRun&&/^[0-9a-f-]{36}$/i.test(requestedRun)?requestedRun:null;
 after(async()=>{
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const batch=await processRadarAnalysisBatch(db);let stats;
  try{stats=await currentRadarAnalysisStats(db);}catch{return;}
  const queuePending=stats.pending+stats.running,stalled=batch.claimError||batch.deferred>0||batch.processed===0;
  const stallReason=batch.claimError?`claim_rpc_${batch.claimErrorCode||'error'}`:batch.deferred?'worker_deferred':batch.processed===0&&queuePending>0?'no_job_claimed':null;
  let markdown={storagePath:null as string|null,markdownError:false,markdownErrorCode:null as string|null,noticeCount:0};
  if(queuePending===0)markdown=await refreshOpenNoticesMarkdown(db);
  if(runId){
   const {data:run}=await db.from('radar_update_runs').select('id,failed_sources,summary').eq('id',runId).maybeSingle();
   if(run){const sourceFailures=Number(run.failed_sources||0),markdownError=queuePending===0&&markdown.markdownError,nextStatus=queuePending&&!stalled?'running':queuePending?'partial':sourceFailures||stats.incomplete||stats.failed||stats.missing||markdownError?'partial':'completed';await db.from('radar_update_runs').update({status:nextStatus,finished_at:nextStatus==='running'?null:new Date().toISOString(),incomplete_analyses:stats.incomplete,consolidated_storage_path:queuePending===0?markdown.storagePath:undefined,summary:{...(run.summary||{}),markdown_error:queuePending===0?markdownError:run.summary?.markdown_error,markdown_error_code:queuePending===0?markdown.markdownErrorCode:run.summary?.markdown_error_code,analysis:{...stats},analysis_worker_stalled:queuePending>0&&stalled,analysis_worker_diagnostic:{reason:stallReason,batch:{processed:batch.processed,complete:batch.complete,incomplete:batch.incomplete,failed:batch.failed,deferred:batch.deferred,claim_error:batch.claimErrorCode},pending:queuePending}}}).eq('id',runId);}
  }
  if(stalled||queuePending===0)return;
  const continued=await startRadarAnalysisWorker(runId,new URL(request.url).origin);
  if(!continued&&runId){const {data:run}=await db.from('radar_update_runs').select('summary').eq('id',runId).maybeSingle();await db.from('radar_update_runs').update({status:'partial',finished_at:new Date().toISOString(),summary:{...(run?.summary||{}),analysis:{...stats},analysis_worker_stalled:true,analysis_worker_diagnostic:{reason:'continuation_request_rejected',batch:{processed:batch.processed,complete:batch.complete,incomplete:batch.incomplete,failed:batch.failed,deferred:batch.deferred,claim_error:batch.claimErrorCode},pending:queuePending}}}).eq('id',runId);}
 });
 return Response.json({status:'accepted',run_id:runId},{status:202});
}
