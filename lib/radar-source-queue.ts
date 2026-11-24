import type {SupabaseClient} from '@supabase/supabase-js';
import type {processScanSource} from './scan-processor.ts';

type SourceResult=Awaited<ReturnType<typeof processScanSource>>;

/** Persist one bounded batch into the run ledger so progress survives worker restarts. */
export async function recordRadarSourceBatch(db:SupabaseClient,runId:string,scanId:string,results:PromiseSettledResult<SourceResult>[]){
 const bySource=new Map<string,SourceResult>();
 for(const result of results)if(result.status==='fulfilled'&&result.value.sourceId)bySource.set(result.value.sourceId,result.value);
 const {data:tasks,error}=await db.from('scan_sources').select('source_id,status,detail').eq('scan_id',scanId);
 if(error||!tasks)throw new Error('scan_tasks_unavailable');
 for(const task of tasks){
  const outcome=bySource.get(task.source_id);
  if(outcome&&outcome.status==='concluída'&&'catalog'in outcome&&outcome.catalog){
   await db.from('radar_update_sources').update({status:'completed',new_count:outcome.catalog.inserted,updated_count:outcome.catalog.updated,error_code:null,error_detail:null,last_successful_at:new Date().toISOString(),finished_at:new Date().toISOString()}).eq('run_id',runId).eq('source_id',task.source_id);
  }else if(outcome&&outcome.status==='concluída'&&'catalogSyncError'in outcome){
   await db.from('radar_update_sources').update({status:'failed',error_code:'catalog_sync_failed',error_detail:`Sincronização do catálogo: ${String(outcome.catalogSyncError).slice(0,300)}`,finished_at:new Date().toISOString()}).eq('run_id',runId).eq('source_id',task.source_id);
  }else if(task.status==='erro'||task.status==='sem conector'){
   await db.from('radar_update_sources').update({status:'failed',error_code:task.status==='sem conector'?'connector_unavailable':'source_failed',error_detail:String(task.detail||'A fonte não concluiu a consulta.').slice(0,300),finished_at:new Date().toISOString()}).eq('run_id',runId).eq('source_id',task.source_id);
  }else if(task.status==='em curso'){
   await db.from('radar_update_sources').update({status:'running'}).eq('run_id',runId).eq('source_id',task.source_id);
  }
 }
 const {data:ledger,error:ledgerError}=await db.from('radar_update_sources').select('status,new_count,updated_count').eq('run_id',runId);
 if(ledgerError||!ledger)throw new Error('source_ledger_unavailable');
 const completed=ledger.filter(row=>row.status==='completed').length,failed=ledger.filter(row=>row.status==='failed').length;
 const {error:runError}=await db.from('radar_update_runs').update({total_sources:tasks.length,completed_sources:completed,failed_sources:failed,new_notices:ledger.reduce((n,row)=>n+Number(row.new_count||0),0),updated_notices:ledger.reduce((n,row)=>n+Number(row.updated_count||0),0)}).eq('id',runId);
 if(runError)throw new Error('source_run_progress_unavailable');
 return {tasks,completed,failed,remaining:tasks.some(task=>['na fila','em curso'].includes(task.status))};
}

export async function startRadarSourceWorker(runId:string,scanId:string,analysisDeferred:boolean,origin?:string):Promise<boolean>{
 const secret=process.env.SCAN_WORKER_SECRET||process.env.CRON_SECRET;
 const configuredSite=process.env.NEXT_PUBLIC_SITE_URL,vercelHost=process.env.VERCEL_PROJECT_PRODUCTION_URL||process.env.VERCEL_URL;
 const base=origin||((configuredSite&&!/localhost|127\.0\.0\.1/i.test(configuredSite))?configuredSite:vercelHost?`https://${vercelHost}`:configuredSite);
 if(!secret||secret.length<32||!base)return false;
 try{const url=new URL('/api/internal/radar-source-worker',base);const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify({run_id:runId,scan_id:scanId,analysis_deferred:analysisDeferred}),cache:'no-store'});return response.ok;}catch{return false;}
}
