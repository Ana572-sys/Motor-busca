import type {SupabaseClient} from '@supabase/supabase-js';
import type {processScanSource} from './scan-processor.ts';
import {processRadarNoticeAnalysis} from './radar-document-analysis.ts';

type WorkerResults=PromiseSettledResult<Awaited<ReturnType<typeof processScanSource>>>[];
const missing='Não identificável no aviso';
function shown(value:unknown){if(value==null||value==='')return missing;if(Array.isArray(value)&&value.length===0)return missing;if(typeof value==='object'&&Object.keys(value as object).length===0)return missing;if(value&&typeof value==='object'&&!Array.isArray(value)&&typeof (value as Record<string,unknown>).text==='string')return String((value as Record<string,unknown>).text);return Array.isArray(value)||typeof value==='object'?JSON.stringify(value):String(value);}

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
 let analysisCompleted=0,analysisIncomplete=0,analysisFailed=0,analysisDeferred=0;
 if(process.env.OPENAI_API_KEY){
  const configuredBatch=Number.parseInt(process.env.RADAR_ANALYSIS_BATCH_SIZE||'24',10),batchLimit=Math.max(1,Math.min(100,Number.isFinite(configuredBatch)?configuredBatch:24));let reserved=0;
  const worker=async()=>{while(true){if(reserved>=batchLimit)return;reserved++;const {data,error}=await db.rpc('claim_radar_notice_analysis');if(error){analysisFailed++;return;}const job=data?.[0];if(!job)return;try{const result=await processRadarNoticeAnalysis(db,{id:job.id,version_id:job.version_id});if(result==='complete')analysisCompleted++;else if(result==='incomplete')analysisIncomplete++;else if(result==='failed')analysisFailed++;else analysisDeferred++;if(result==='deferred')return;}catch{analysisFailed++;await db.from('radar_notice_analyses').update({status:'failed',error_code:'analysis_worker_failed',lease_until:null,finished_at:new Date().toISOString()}).eq('id',job.id);}}};
  await Promise.all(Array.from({length:3},()=>worker()));
 }
 const {count:analysisPending}=await db.from('radar_notice_analyses').select('id',{count:'exact',head:true}).in('status',['pending','running']);
 const fields='official_code,title,program,status,opening_date,deadline,eligible_regions,beneficiaries,eligible_sectors,eligible_caes,investment_minimum,investment_maximum,funding_rate,eligible_expenses,ineligible_expenses,spending_conditions,partnership_required,rd_requirement,short_summary,official_url,analysis_status,extraction_confidence,last_analyzed_at,updated_at';
 const notices:Record<string,any>[]=[];let noticesError=false;
 for(let offset=0;offset<50000;offset+=500){const {data,error}=await db.from('radar_notices').select(fields).eq('status','open').order('updated_at',{ascending:false}).range(offset,offset+499);if(error){noticesError=true;break;}const batch=data||[];notices.push(...batch);if(batch.length<500)break;}
 const referencesByNotice=new Map<string,Record<string,unknown>[]>(),factsByNotice=new Map<string,Record<string,unknown>>(),documentsByNotice=new Map<string,Record<string,unknown>[]>();
 if(!noticesError)for(let offset=0;offset<notices.length;offset+=100){
  const noticeIds=notices.slice(offset,offset+100).map(notice=>String(notice.id));
  const {data:versions,error:versionError}=await db.from('radar_notice_versions').select('id,notice_id,detected_at').in('notice_id',noticeIds).order('detected_at',{ascending:false});
  if(versionError){noticesError=true;break;}
  const currentVersionByNotice=new Map<string,string>();for(const version of versions||[])if(!currentVersionByNotice.has(version.notice_id))currentVersionByNotice.set(version.notice_id,version.id);
  const currentVersions=[...currentVersionByNotice.values()];if(!currentVersions.length)continue;
  const noticeByVersion=new Map([...currentVersionByNotice.entries()].map(([noticeId,versionId])=>[versionId,noticeId]));
  const [{data:analyses,error:analysisError},{data:docs,error:documentsError}]=await Promise.all([
   db.from('radar_notice_analyses').select('version_id,source_references,facts').in('version_id',currentVersions),
   db.from('radar_notice_documents').select('version_id,name,official_url').in('version_id',currentVersions),
  ]);
  if(analysisError||documentsError){noticesError=true;break;}
  for(const analysis of analyses||[]){const noticeId=noticeByVersion.get(analysis.version_id);if(noticeId){referencesByNotice.set(noticeId,Array.isArray(analysis.source_references)?analysis.source_references as Record<string,unknown>[]:[]);factsByNotice.set(noticeId,analysis.facts&&typeof analysis.facts==='object'?analysis.facts as Record<string,unknown>:{});}}
  for(const document of docs||[]){const noticeId=noticeByVersion.get(document.version_id);if(noticeId){const current=documentsByNotice.get(noticeId)||[];current.push(document);documentsByNotice.set(noticeId,current);}}
 }
 let storagePath:string|null=null,markdownError=noticesError;
 if(!noticesError){
  const lines:string[]=['# Avisos abertos — Radar G&I','',`Atualizado em: ${new Date().toLocaleString('pt-PT',{timeZone:'Europe/Lisbon'})}`,'',`Avisos no catálogo: ${notices.length}`,''];
  for(const notice of notices){
   const analysis=notice.analysis_status==='complete'?'Completa':notice.analysis_status==='incomplete'?'Incompleta':'Pendente';
   const partnership=notice.partnership_required===null?missing:notice.partnership_required?'Necessária':'Não identificada como necessária';
   const facts=factsByNotice.get(String(notice.id))||{};
   const fieldValue=(field:string,value:unknown)=>{const pages=[...new Set((referencesByNotice.get(String(notice.id))||[]).filter(reference=>reference.field===field&&Number.isInteger(reference.page)).map(reference=>String(reference.page)))];return `${shown(value)}${pages.length?` (pág. ${pages.join(', ')})`:''}`;};
   const docs=(documentsByNotice.get(String(notice.id))||[]).filter(document=>typeof document.official_url==='string').map(document=>`[${String(document.name||'Documento oficial')}](${String(document.official_url)})`);
   lines.push(`## ${notice.title}`,`- Código: ${shown(notice.official_code)}`,`- Programa: ${shown(notice.program)}`,`- Estado: ${notice.status==='open'?'Aberto':'Fechado'}`,`- Abertura: ${fieldValue('opening_date',notice.opening_date)}`,`- Prazo: ${fieldValue('deadline',notice.deadline)}`,`- Regiões elegíveis: ${fieldValue('regions',notice.eligible_regions)}`,`- Beneficiários: ${fieldValue('beneficiaries',notice.beneficiaries)}`,`- Setores: ${fieldValue('sectors',notice.eligible_sectors)}`,`- CAE: ${fieldValue('caes',notice.eligible_caes)}`,`- Atividades apoiadas: ${fieldValue('activities_supported',facts.activities_supported)}`,`- Atividades excluídas: ${fieldValue('activities_excluded',facts.activities_excluded)}`,`- Investimento mínimo: ${fieldValue('investment_minimum',notice.investment_minimum)}`,`- Investimento máximo: ${fieldValue('investment_maximum',notice.investment_maximum)}`,`- Limite máximo de apoio: ${fieldValue('maximum_aid',facts.maximum_aid)}`,`- Taxa de apoio: ${fieldValue('funding_rate',notice.funding_rate)}`,`- Despesas elegíveis: ${fieldValue('eligible_expenses',notice.eligible_expenses)}`,`- Despesas não elegíveis: ${fieldValue('ineligible_expenses',notice.ineligible_expenses)}`,`- Condições e limites: ${fieldValue('spending_conditions',notice.spending_conditions)}`,`- Outras condições: ${fieldValue('other_conditions',facts.other_conditions)}`,`- Duração: ${fieldValue('duration',facts.duration)}`,`- Modalidade de candidatura: ${fieldValue('application_mode',facts.application_mode)}`,`- Parceria: ${fieldValue('partnership_required',partnership)}`,`- Necessidade de I&D: ${fieldValue('rd_requirement',notice.rd_requirement)}`,`- Objetivo: ${fieldValue('objective',facts.objective)}`,`- Resumo: ${fieldValue('summary',notice.short_summary)}`,`- Fonte oficial: ${shown(notice.official_url)}`,`- Documentos: ${docs.length?docs.join(' · '):missing}`,`- Confiança da extração: ${shown(notice.extraction_confidence)}`,`- Estado da análise: ${analysis}`,`- Data da última análise: ${shown(notice.last_analyzed_at)}`,`- Última atualização: ${shown(notice.updated_at)}`,'');
  }
  storagePath='avisos/abertos/avisos_abertos.md';const {error}=await db.storage.from('radar-documents').upload(storagePath,Buffer.from(lines.join('\n'),'utf8'),{contentType:'text/markdown; charset=utf-8',upsert:true});markdownError=Boolean(error);if(error)storagePath=null;
 }
 const failedSources=failed+incomplete+(markdownError?1:0),hasAnalysisBacklog=(analysisPending||0)>0||analysisFailed>0||analysisIncomplete>0,status=failedSources===0&&!hasAnalysisBacklog?'completed':completed===0&&failedSources>=tasks.length?'failed':'partial';
 await db.from('radar_update_runs').update({status,total_sources:tasks.length,completed_sources:completed,failed_sources:failedSources,new_notices:newNotices,updated_notices:updatedNotices,incomplete_analyses:incomplete+analysisIncomplete,consolidated_storage_path:storagePath,finished_at:new Date().toISOString(),summary:{scan_id:scanId,markdown_error:markdownError,analysis:{completed:analysisCompleted,incomplete:analysisIncomplete,failed:analysisFailed,deferred:analysisDeferred,pending:analysisPending||0},worker_rejections:workerResults.filter(item=>item.status==='rejected').length}}).eq('id',runId);
}
