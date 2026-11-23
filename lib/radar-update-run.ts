import type {SupabaseClient} from '@supabase/supabase-js';
import type {processScanSource} from './scan-processor.ts';

type WorkerResults=PromiseSettledResult<Awaited<ReturnType<typeof processScanSource>>>[];
const missing='Não identificável no aviso';
function shown(value:unknown){if(value==null||value==='')return missing;if(Array.isArray(value)&&value.length===0)return missing;if(typeof value==='object'&&Object.keys(value as object).length===0)return missing;return Array.isArray(value)||typeof value==='object'?JSON.stringify(value):String(value);}

/** Finalizes the shared run ledger and refreshes the human-readable open-notices index. */
export async function finalizeRadarUpdateRun(db:SupabaseClient,runId:string,scanId:string,workerResults:WorkerResults){
 const {data:tasks,error:taskError}=await db.from('scan_sources').select('source_id,status,detail').eq('scan_id',scanId);
 if(taskError||!tasks){await db.from('radar_update_runs').update({status:'failed',failed_sources:1,finished_at:new Date().toISOString(),summary:{error:'scan_tasks_unavailable'}}).eq('id',runId);return;}
 let completed=0,failed=0,incomplete=0,newNotices=0,updatedNotices=0;
 for(const task of tasks){
  const outcome=workerResults.find(result=>result.status==='fulfilled'&&result.value.sourceId===task.source_id);
  const catalogReady=task.status==='concluída'&&outcome?.status==='fulfilled'&&'catalog'in outcome.value&&Boolean(outcome.value.catalog);
  if(catalogReady){completed++;newNotices+=outcome.value.catalog!.inserted;updatedNotices+=outcome.value.catalog!.updated;}else if(task.status==='concluída')incomplete++;else failed++;
  const succeeded=Boolean(catalogReady);
  await db.from('radar_update_sources').update({status:succeeded?'completed':'failed',new_count:catalogReady?outcome.value.catalog!.inserted:0,updated_count:catalogReady?outcome.value.catalog!.updated:0,error_code:succeeded?null:task.status==='concluída'?'catalog_sync_failed':'source_failed',error_detail:succeeded?null:String(task.detail||'A fonte não concluiu a sincronização com o catálogo.').slice(0,300),last_successful_at:succeeded?new Date().toISOString():null,finished_at:new Date().toISOString()}).eq('run_id',runId).eq('source_id',task.source_id);
 }
 const fields='official_code,title,program,status,opening_date,deadline,eligible_regions,beneficiaries,eligible_sectors,eligible_caes,investment_minimum,investment_maximum,funding_rate,eligible_expenses,ineligible_expenses,spending_conditions,partnership_required,rd_requirement,short_summary,official_url,analysis_status,extraction_confidence,last_analyzed_at,updated_at';
 const notices:Record<string,any>[]=[];let noticesError=false;
 for(let offset=0;offset<50000;offset+=500){const {data,error}=await db.from('radar_notices').select(fields).eq('status','open').order('updated_at',{ascending:false}).range(offset,offset+499);if(error){noticesError=true;break;}const batch=data||[];notices.push(...batch);if(batch.length<500)break;}
 let storagePath:string|null=null,markdownError=noticesError;
 if(!noticesError){
  const lines:string[]=['# Avisos abertos — Radar G&I','',`Atualizado em: ${new Date().toLocaleString('pt-PT',{timeZone:'Europe/Lisbon'})}`,'',`Avisos no catálogo: ${notices.length}`,''];
  for(const notice of notices){
   const analysis=notice.analysis_status==='complete'?'Completa':notice.analysis_status==='incomplete'?'Incompleta':'Pendente';
   const partnership=notice.partnership_required===null?missing:notice.partnership_required?'Necessária':'Não identificada como necessária';
   lines.push(`## ${notice.title}`,`- Código: ${shown(notice.official_code)}`,`- Programa: ${shown(notice.program)}`,`- Estado: ${notice.status==='open'?'Aberto':'Fechado'}`,`- Abertura: ${shown(notice.opening_date)}`,`- Prazo: ${shown(notice.deadline)}`,`- Regiões elegíveis: ${shown(notice.eligible_regions)}`,`- Beneficiários: ${shown(notice.beneficiaries)}`,`- Setores: ${shown(notice.eligible_sectors)}`,`- CAE: ${shown(notice.eligible_caes)}`,`- Investimento mínimo: ${shown(notice.investment_minimum)}`,`- Investimento máximo: ${shown(notice.investment_maximum)}`,`- Taxa de apoio: ${shown(notice.funding_rate)}`,`- Despesas elegíveis: ${shown(notice.eligible_expenses)}`,`- Despesas não elegíveis: ${shown(notice.ineligible_expenses)}`,`- Condições e limites: ${shown(notice.spending_conditions)}`,`- Parceria: ${partnership}`,`- Necessidade de I&D: ${shown(notice.rd_requirement)}`,`- Resumo: ${shown(notice.short_summary)}`,`- Fonte oficial: ${shown(notice.official_url)}`,`- Confiança da extração: ${shown(notice.extraction_confidence)}`,`- Estado da análise: ${analysis}`,`- Data da última análise: ${shown(notice.last_analyzed_at)}`,`- Última atualização: ${shown(notice.updated_at)}`,'');
  }
  storagePath='avisos/abertos/avisos_abertos.md';const {error}=await db.storage.from('radar-documents').upload(storagePath,Buffer.from(lines.join('\n'),'utf8'),{contentType:'text/markdown; charset=utf-8',upsert:true});markdownError=Boolean(error);if(error)storagePath=null;
 }
 const failedSources=failed+incomplete+(markdownError?1:0),status=failedSources===0?'completed':completed===0?'failed':'partial';
 await db.from('radar_update_runs').update({status,total_sources:tasks.length,completed_sources:completed,failed_sources:failedSources,new_notices:newNotices,updated_notices:updatedNotices,incomplete_analyses:incomplete,consolidated_storage_path:storagePath,finished_at:new Date().toISOString(),summary:{scan_id:scanId,markdown_error:markdownError,worker_rejections:workerResults.filter(item=>item.status==='rejected').length}}).eq('id',runId);
}
