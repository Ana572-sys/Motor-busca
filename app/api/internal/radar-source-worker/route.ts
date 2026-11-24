import {after} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {processScanSource} from '@/lib/scan-processor';
import {recordRadarSourceBatch,startRadarSourceWorker} from '@/lib/radar-source-queue';
import {finalizeRadarSourceRun} from '@/lib/radar-update-run';
import {validWorkerToken} from '@/lib/worker-auth';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

export async function POST(request:Request){
 const secret=process.env.SCAN_WORKER_SECRET||process.env.CRON_SECRET;
 if(!secret||secret.length<32)return Response.json({error:'Processador de fontes não configurado.'},{status:503});
 if(!validWorkerToken(secret,request.headers.get('authorization')))return Response.json({error:'Não autorizado.'},{status:401});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
 if(!url||!key)return Response.json({error:'Base de dados não configurada.'},{status:503});
 let payload:{run_id?:string;scan_id?:string;analysis_deferred?:boolean};try{payload=await request.json();}catch{return Response.json({error:'Pedido inválido.'},{status:400});}
 const runId=payload.run_id,scanId=payload.scan_id,analysisDeferred=payload.analysis_deferred===true;
 if(!runId||!scanId||! /^[0-9a-f-]{36}$/i.test(runId)||! /^[0-9a-f-]{36}$/i.test(scanId))return Response.json({error:'Execução inválida.'},{status:400});
 after(async()=>{
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  // Keep a single Vercel invocation bounded; the durable queue resumes in the next request.
  const outcomes=await Promise.allSettled(Array.from({length:4},()=>processScanSource(db,scanId)));
  let progress;
  try{progress=await recordRadarSourceBatch(db,runId,scanId,outcomes);}catch(error){
   const {data:run}=await db.from('radar_update_runs').select('summary').eq('id',runId).maybeSingle();
   await db.from('radar_update_runs').update({status:'partial',finished_at:new Date().toISOString(),summary:{...(run?.summary||{}),source_worker_error:error instanceof Error?error.message:'source_worker_failed'}}).eq('id',runId);return;
  }
  if(progress.remaining){
   const processed=outcomes.filter(result=>result.status==='fulfilled'&&result.value.status!=='sem tarefas').length;
   if(processed===0){
    const {data:run}=await db.from('radar_update_runs').select('summary').eq('id',runId).maybeSingle();
    await db.from('radar_update_runs').update({status:'partial',finished_at:new Date().toISOString(),summary:{...(run?.summary||{}),source_worker_stalled:true,source_worker_error:'no_source_claimed',scan_id:scanId}}).eq('id',runId);return;
   }
   if(!await startRadarSourceWorker(runId,scanId,analysisDeferred,new URL(request.url).origin)){
    const {data:run}=await db.from('radar_update_runs').select('summary').eq('id',runId).maybeSingle();
    await db.from('radar_update_runs').update({status:'partial',finished_at:new Date().toISOString(),summary:{...(run?.summary||{}),source_worker_stalled:true,source_worker_error:'continuation_request_rejected'}}).eq('id',runId);
   }
   return;
  }
  await finalizeRadarSourceRun(db,runId,scanId,analysisDeferred);
 });
 return Response.json({status:'accepted',run_id:runId},{status:202});
}
