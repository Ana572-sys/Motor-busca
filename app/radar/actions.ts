'use server';
import {after} from 'next/server';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {createClient} from '@supabase/supabase-js';
import {configured,supabase} from '@/lib/supabase';
import {processScanSource} from '@/lib/scan-processor';
import {finalizeRadarUpdateRun} from '@/lib/radar-update-run';
import {startRadarAnalysisWorker} from '@/lib/radar-analysis-queue';

async function runRadarUpdate(analysisDeferred:boolean){
 if(!configured())redirect('/login');
 const db=await supabase();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');
 const {data:profile}=await db.from('users').select('id').eq('id',user.id).maybeSingle();if(!profile)redirect('/login?erro=acesso');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;if(!url||!key)redirect('/?tab=radar&erro=configuracao');
 const {data:scanId,error:scanError}=await db.rpc('request_manual_scan',{p_period:'última semana'});if(scanError||!scanId)redirect('/?tab=radar&erro=atualizacao');
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:run,error:runError}=await admin.from('radar_update_runs').insert({kind:'manual',status:'running',requested_by:user.id,started_at:new Date().toISOString(),summary:analysisDeferred?{analysis_deferred:true}:undefined}).select('id').single();
 if(runError||!run){await admin.from('scans').update({status:'erro',finished_at:new Date().toISOString()}).eq('id',scanId);redirect('/?tab=radar&erro=atualizacao');}
 const {data:tasks}=await admin.from('scan_sources').select('source_id,status').eq('scan_id',scanId);
 const taskRows=tasks||[];
 if(!taskRows.length){await admin.from('radar_update_runs').update({status:'failed',failed_sources:1,finished_at:new Date().toISOString(),summary:{error:'no_source_tasks'}}).eq('id',run.id);redirect(`/?tab=radar&execucao=${run.id}&erro=atualizacao`);}
 if(taskRows.length){
  const {error:sourceInsertError}=await admin.from('radar_update_sources').insert(taskRows.map(task=>({run_id:run.id,source_id:task.source_id,status:task.status==='na fila'?'queued':'failed',error_code:task.status==='na fila'?null:'connector_unavailable'})));
  if(sourceInsertError){await admin.from('radar_update_runs').update({status:'failed',failed_sources:taskRows.length,finished_at:new Date().toISOString(),summary:{error:'source_run_records_failed'}}).eq('id',run.id);redirect(`/?tab=radar&execucao=${run.id}&erro=registo`);}
 }
 const executionId=run.id as string;
 after(async()=>{
  const outcomes=await Promise.allSettled(Array.from({length:Math.max(taskRows.filter(task=>task.status==='na fila').length,1)},()=>processScanSource(admin,scanId)));
  await finalizeRadarUpdateRun(admin,executionId,scanId,outcomes,analysisDeferred);
  revalidatePath('/');
 });
 revalidatePath('/');redirect(`/?tab=radar&execucao=${executionId}`);
}

export async function requestRadarUpdate(){return runRadarUpdate(false);}
export async function requestRadarSourcesOnly(){return runRadarUpdate(true);}

export async function resumeRadarAnalysisQueue(){
 if(!configured())redirect('/login');
 const db=await supabase();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');
 const {data:profile}=await db.from('users').select('id').eq('id',user.id).maybeSingle();if(!profile)redirect('/login?erro=acesso');
 const {data:run}=await db.from('radar_update_runs').select('id').in('status',['running','partial']).order('started_at',{ascending:false}).limit(1).maybeSingle();
 const started=await startRadarAnalysisWorker(run?.id||null);
 if(!started)redirect(`/?tab=radar${run?.id?`&execucao=${run.id}`:''}&erro=fila`);
 redirect(`/?tab=radar${run?.id?`&execucao=${run.id}`:''}`);
}
