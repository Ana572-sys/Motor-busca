import {createClient} from '@supabase/supabase-js';
import {revalidatePath} from 'next/cache';
import {configured,supabase} from '@/lib/supabase';
import {processScanSource} from '@/lib/scan-processor';
import {recordRadarSourceBatch} from '@/lib/radar-source-queue';
import {finalizeRadarSourceRun} from '@/lib/radar-update-run';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

export async function POST(request:Request){
 if(!configured())return Response.json({error:'not_authenticated'},{status:401});
 const session=await supabase(),{data:{user}}=await session.auth.getUser();if(!user)return Response.json({error:'not_authenticated'},{status:401});
 const {data:profile,error:profileError}=await session.from('users').select('id').eq('id',user.id).maybeSingle();if(profileError||!profile)return Response.json({error:'not_authorized'},{status:403});
 let body:{run_id?:string};try{body=await request.json();}catch{return Response.json({error:'invalid_request'},{status:400});}
 const runId=body.run_id;if(!runId||! /^[0-9a-f-]{36}$/i.test(runId))return Response.json({error:'invalid_run_id'},{status:400});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;if(!url||!key)return Response.json({error:'database_not_configured'},{status:503});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:run,error:runError}=await db.from('radar_update_runs').select('id,status,summary').eq('id',runId).maybeSingle();
 if(runError||!run)return Response.json({error:'run_not_found'},{status:404});
 const summary=(run.summary||{}) as Record<string,unknown>,scanId=summary.scan_id;
 if(typeof scanId!=='string'||! /^[0-9a-f-]{36}$/i.test(scanId))return Response.json({error:'scan_id_missing'},{status:409});
 if(summary.source_queue_complete===true)return Response.json({status:'source_queue_complete',run_id:runId});
 if(!['running','partial'].includes(run.status))return Response.json({status:run.status,run_id:runId});
 const {data:before,error:beforeError}=await db.from('scan_sources').select('status,lease_until').eq('scan_id',scanId);
 if(beforeError||!before)return Response.json({error:'scan_tasks_unavailable'},{status:503});
 const now=Date.now();if(before.some(task=>task.status==='em curso'&&task.lease_until&&new Date(task.lease_until).getTime()>now))return Response.json({status:'busy',run_id:runId},{status:202});
 const outcomes=await Promise.allSettled(Array.from({length:2},()=>processScanSource(db,scanId)));
 let progress;
 try{progress=await recordRadarSourceBatch(db,runId,scanId,outcomes);}catch(error){
  const detail=error instanceof Error?error.message:'source_batch_failed';
  await db.from('radar_update_runs').update({status:'partial',finished_at:new Date().toISOString(),summary:{...summary,source_worker_error:detail}}).eq('id',runId);
  return Response.json({status:'partial',run_id:runId,error:detail},{status:202});
 }
 const processed=outcomes.filter(result=>result.status==='fulfilled'&&result.value.status!=='sem tarefas').length;
 if(progress.remaining&&processed===0){
  const scanTasks=progress.tasks;
  if(scanTasks.some(task=>task.status==='em curso'))return Response.json({status:'busy',run_id:runId},{status:202});
  await db.from('radar_update_runs').update({status:'partial',finished_at:new Date().toISOString(),summary:{...summary,source_worker_error:'no_source_claimed'}}).eq('id',runId);
  return Response.json({status:'partial',run_id:runId,error:'no_source_claimed'},{status:202});
 }
 if(!progress.remaining){await finalizeRadarSourceRun(db,runId,scanId,summary.analysis_deferred===true);revalidatePath('/');}
 return Response.json({status:progress.remaining?'running':'source_queue_complete',run_id:runId,completed:progress.completed,failed:progress.failed,total:progress.tasks.length});
}
