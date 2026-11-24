import type {SupabaseClient} from '@supabase/supabase-js';
import type {processScanSource} from './scan-processor.ts';
import {currentRadarAnalysisStats,startRadarAnalysisWorker} from './radar-analysis-queue.ts';
import {refreshOpenNoticesMarkdown} from './radar-open-markdown.ts';

type WorkerResults=PromiseSettledResult<Awaited<ReturnType<typeof processScanSource>>>[];

/** Finalizes the shared run ledger and refreshes the human-readable open-notices index. */
export async function finalizeRadarUpdateRun(db:SupabaseClient,runId:string,scanId:string,workerResults:WorkerResults,analysisDeferred=false){
 const {data:tasks,error:taskError}=await db.from('scan_sources').select('source_id,status,detail').eq('scan_id',scanId);
 if(taskError||!tasks){await db.from('radar_update_runs').update({status:'failed',failed_sources:1,finished_at:new Date().toISOString(),summary:{error:'scan_tasks_unavailable'}}).eq('id',runId);return;}
 let completed=0,failed=0,incomplete=0,newNotices=0,updatedNotices=0;
 for(const task of tasks){
  const outcome=workerResults.find(result=>result.status==='fulfilled'&&result.value.sourceId===task.source_id);
  const catalogReady=task.status==='concluída'&&outcome?.status==='fulfilled'&&'catalog'in outcome.value&&Boolean(outcome.value.catalog);
  const catalogSyncError=outcome?.status==='fulfilled'&&'catalogSyncError'in outcome.value?String(outcome.value.catalogSyncError):null;
  if(catalogReady){completed++;newNotices+=outcome.value.catalog!.inserted;updatedNotices+=outcome.value.catalog!.updated;}else if(task.status==='concluída')incomplete++;else failed++;
  const succeeded=Boolean(catalogReady);
  await db.from('radar_update_sources').update({status:succeeded?'completed':'failed',new_count:catalogReady?outcome.value.catalog!.inserted:0,updated_count:catalogReady?outcome.value.catalog!.updated:0,error_code:succeeded?null:task.status==='concluída'?'catalog_sync_failed':'source_failed',error_detail:succeeded?null:catalogSyncError?`Sincronização do catálogo: ${catalogSyncError}`:String(task.detail||'A fonte não concluiu a sincronização com o catálogo.').slice(0,300),last_successful_at:succeeded?new Date().toISOString():null,finished_at:new Date().toISOString()}).eq('run_id',runId).eq('source_id',task.source_id);
 }
 let analysisStats={total:0,complete:0,incomplete:0,failed:0,pending:0,running:0,missing:0};
 try{analysisStats=await currentRadarAnalysisStats(db);}catch{analysisStats={...analysisStats,missing:1};}
 const {storagePath,markdownError,markdownErrorCode}=await refreshOpenNoticesMarkdown(db);
 const failedSources=failed+incomplete,queuePending=analysisStats.pending+analysisStats.running;
 const workerStarted=Boolean(!analysisDeferred&&process.env.OPENAI_API_KEY&&queuePending&&await startRadarAnalysisWorker(runId));
 const analysisErrors=analysisStats.incomplete+analysisStats.failed+analysisStats.missing>0;
 const status=workerStarted?'running':completed===0&&failedSources>=tasks.length&&tasks.length>0?'failed':failedSources===0&&!markdownError&&!queuePending&&!analysisErrors?'completed':'partial';
 await db.from('radar_update_runs').update({status,total_sources:tasks.length,completed_sources:completed,failed_sources:failedSources,new_notices:newNotices,updated_notices:updatedNotices,incomplete_analyses:analysisStats.incomplete,consolidated_storage_path:storagePath,finished_at:status==='running'?null:new Date().toISOString(),summary:{scan_id:scanId,markdown_error:markdownError,markdown_error_code:markdownErrorCode,analysis:analysisStats,analysis_deferred:analysisDeferred,analysis_worker_started:workerStarted,analysis_worker_unavailable:queuePending>0&&!workerStarted&&!analysisDeferred,worker_rejections:workerResults.filter(item=>item.status==='rejected').length}}).eq('id',runId);
}

/** Finalize a source-worker run from its durable per-source ledger. */
export async function finalizeRadarSourceRun(db:SupabaseClient,runId:string,scanId:string,analysisDeferred=false){
 const {data:tasks,error:taskError}=await db.from('scan_sources').select('source_id,status,detail').eq('scan_id',scanId);
 if(taskError||!tasks){await db.from('radar_update_runs').update({status:'failed',failed_sources:1,finished_at:new Date().toISOString(),summary:{error:'scan_tasks_unavailable'}}).eq('id',runId);return;}
 const {data:ledger,error:ledgerError}=await db.from('radar_update_sources').select('status,new_count,updated_count,error_code,error_detail').eq('run_id',runId);
 if(ledgerError||!ledger){await db.from('radar_update_runs').update({status:'failed',failed_sources:1,finished_at:new Date().toISOString(),summary:{error:'source_ledger_unavailable'}}).eq('id',runId);return;}
 const completed=ledger.filter(row=>row.status==='completed').length,failed=ledger.filter(row=>row.status==='failed').length;
 const newNotices=ledger.reduce((total,row)=>total+Number(row.new_count||0),0),updatedNotices=ledger.reduce((total,row)=>total+Number(row.updated_count||0),0);
 let markdown={storagePath:null as string|null,markdownError:false,markdownErrorCode:null as string|null};
 try{markdown=await refreshOpenNoticesMarkdown(db);}catch{markdown.markdownError=true;markdown.markdownErrorCode='markdown_refresh_failed';}
 let analysisStats={total:0,complete:0,incomplete:0,failed:0,pending:0,running:0,missing:0};
 if(!analysisDeferred){try{analysisStats=await currentRadarAnalysisStats(db);}catch{analysisStats={...analysisStats,missing:1};}}
 const queuePending=analysisStats.pending+analysisStats.running;
 const workerStarted=Boolean(!analysisDeferred&&process.env.OPENAI_API_KEY&&queuePending&&await startRadarAnalysisWorker(runId));
 const analysisErrors=!analysisDeferred&&(analysisStats.incomplete+analysisStats.failed+analysisStats.missing>0);
 const status=workerStarted?'running':completed===0&&failed>=tasks.length&&tasks.length>0?'failed':failed===0&&!markdown.markdownError&&!queuePending&&!analysisErrors?'completed':'partial';
 await db.from('radar_update_runs').update({status,total_sources:tasks.length,completed_sources:completed,failed_sources:failed,new_notices:newNotices,updated_notices:updatedNotices,incomplete_analyses:analysisStats.incomplete,consolidated_storage_path:markdown.storagePath,finished_at:status==='running'?null:new Date().toISOString(),summary:{scan_id:scanId,source_queue_complete:true,markdown_error:markdown.markdownError,markdown_error_code:markdown.markdownErrorCode,analysis:analysisDeferred?undefined:analysisStats,analysis_deferred:analysisDeferred,analysis_worker_started:workerStarted,analysis_worker_unavailable:queuePending>0&&!workerStarted&&!analysisDeferred,source_errors:ledger.filter(row=>row.status==='failed').map(row=>({error_code:row.error_code,error_detail:row.error_detail}))}}).eq('id',runId);
}
