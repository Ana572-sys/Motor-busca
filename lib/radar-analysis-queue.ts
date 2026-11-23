import type {SupabaseClient} from '@supabase/supabase-js';
import {processRadarNoticeAnalysis} from './radar-document-analysis.ts';

export type RadarAnalysisStats={total:number;complete:number;incomplete:number;failed:number;pending:number;running:number;missing:number};
export type RadarAnalysisBatch={processed:number;complete:number;incomplete:number;failed:number;deferred:number;claimError:boolean;claimErrorCode:string|null};

export async function currentRadarAnalysisStats(db:SupabaseClient):Promise<RadarAnalysisStats>{
 const notices:Record<string,unknown>[]=[];
 for(let offset=0;offset<50000;offset+=500){const {data,error}=await db.from('radar_notices').select('id').eq('status','open').order('id').range(offset,offset+499);if(error)throw new Error('radar_open_notices_unavailable');const batch=data||[];notices.push(...batch);if(batch.length<500)break;}
 const latestByNotice=new Map<string,{id:string;detected_at:string}>();
 for(let offset=0;offset<notices.length;offset+=100){
  const ids=notices.slice(offset,offset+100).map(row=>String(row.id));const versions:Record<string,unknown>[]=[];
  for(let page=0;page<50000;page+=500){const {data,error}=await db.from('radar_notice_versions').select('id,notice_id,detected_at').in('notice_id',ids).order('detected_at',{ascending:false}).order('id',{ascending:false}).range(page,page+499);if(error)throw new Error('radar_notice_versions_unavailable');const batch=data||[];versions.push(...batch);if(batch.length<500)break;}
  versions.sort((a,b)=>String(b.detected_at).localeCompare(String(a.detected_at))||String(b.id).localeCompare(String(a.id)));
  for(const version of versions){const noticeId=String(version.notice_id);if(!latestByNotice.has(noticeId))latestByNotice.set(noticeId,{id:String(version.id),detected_at:String(version.detected_at)});}
 }
 const latestIds=[...latestByNotice.values()].map(version=>version.id);const counts:RadarAnalysisStats={total:notices.length,complete:0,incomplete:0,failed:0,pending:0,running:0,missing:Math.max(0,notices.length-latestIds.length)};
 for(let offset=0;offset<latestIds.length;offset+=100){const {data,error}=await db.from('radar_notice_analyses').select('version_id,status').in('version_id',latestIds.slice(offset,offset+100));if(error)throw new Error('radar_notice_analysis_stats_unavailable');const found=new Set<string>();for(const analysis of data||[]){found.add(String(analysis.version_id));const status=String(analysis.status) as keyof RadarAnalysisStats;if(status==='complete'||status==='incomplete'||status==='failed'||status==='pending'||status==='running')counts[status]++;}counts.missing+=Math.max(0,latestIds.slice(offset,offset+100).length-found.size);}
 return counts;
}

export async function processRadarAnalysisBatch(db:SupabaseClient):Promise<RadarAnalysisBatch>{
 // Keep each Vercel Hobby invocation below its 60-second limit. One bounded
 // notice per worker per invocation; the next invocation continues the queue.
 const configured=Number.parseInt(process.env.RADAR_ANALYSIS_BATCH_SIZE||'3',10),limit=Math.max(1,Math.min(3,Number.isFinite(configured)?configured:3));let reserved=0;
 const result:RadarAnalysisBatch={processed:0,complete:0,incomplete:0,failed:0,deferred:0,claimError:false,claimErrorCode:null};
 const worker=async()=>{while(true){if(reserved>=limit)return;reserved++;const {data,error}=await db.rpc('claim_radar_notice_analysis');if(error){result.claimError=true;result.claimErrorCode=String(error.code||'rpc_error').slice(0,40);return;}const job=data?.[0];if(!job)return;result.processed++;try{const status=await processRadarNoticeAnalysis(db,{id:job.id,version_id:job.version_id});if(status==='complete')result.complete++;else if(status==='incomplete')result.incomplete++;else if(status==='failed')result.failed++;else{result.deferred++;return;}}catch{result.failed++;await db.from('radar_notice_analyses').update({status:'failed',error_code:'analysis_worker_failed',lease_until:null,finished_at:new Date().toISOString()}).eq('id',job.id);}}};
 await Promise.all(Array.from({length:limit},worker));return result;
}

export async function startRadarAnalysisWorker(runId:string|null,origin?:string):Promise<boolean>{
 const secret=process.env.SCAN_WORKER_SECRET||process.env.CRON_SECRET;
 const configuredSite=process.env.NEXT_PUBLIC_SITE_URL;
 const vercelHost=process.env.VERCEL_PROJECT_PRODUCTION_URL||process.env.VERCEL_URL;
 const base=origin||((configuredSite&&!/localhost|127\.0\.0\.1/i.test(configuredSite))?configuredSite:vercelHost?`https://${vercelHost}`:configuredSite);
 if(!secret||secret.length<32||!base)return false;
 try{const url=new URL('/api/internal/radar-analysis-worker',base);if(runId)url.searchParams.set('run_id',runId);const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${secret}`},cache:'no-store'});return response.ok;}catch{return false;}
}
