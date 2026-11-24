import type {SupabaseClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
import {fetchPisListing} from './pis-listing.ts';
import {fetchPessoas,fetchPortugal2030,fetchRegional,regionalOrigin,type RegionalKey} from './pessoas-listing.ts';
import {fetchCompete} from './compete-listing.ts';
import {fetchEuListing,fetchEuProgramListing,type EuProgramKey} from './eu-listing.ts';
import {fetchPrr} from './prr-listing.ts';
import {fetchFct} from './fct-listing.ts';
import {fetchFundo} from './fundo-listing.ts';
import {fetchInterreg} from './interreg-listing.ts';
import {fetchEit} from './eit-listing.ts';
import {fetchDg} from './dgartes-listing.ts';
import {fetchPepac} from './pepac-listing.ts';
import {fetchIefp} from './iefp-listing.ts';
import {fetchTurismo} from './turismo-listing.ts';
import {fetchBpf} from './bpf-listing.ts';
import {fetchMar} from './mar-listing.ts';
import {fetchSustentavel} from './sustentavel-listing.ts';
import {fetchAni} from './ani-listing.ts';
import {queueSourceIssue} from './notifications.ts';
import {fetchEismea} from './eismea-listing.ts';
import {fetchEureka,fetchEurostars} from './eureka-listing.ts';
import {fetchClusterCalls} from './cluster-calls-listing.ts';
import {fetchEui} from './eui-listing.ts';
import {syncCandidatesToRadar} from './radar-catalog-sync.ts';

/** Process one claimed source; a failure stays recorded instead of implying a complete search. */
export async function processScanSource(db:SupabaseClient,scanId?:string,fetcher?:typeof fetch){
 const {data,error}=scanId?await db.rpc('claim_scan_source_for_scan',{p_scan:scanId}):await db.rpc('claim_scan_source');
 if(error)throw new Error('Não foi possível reservar uma fonte.');
 const task=data?.[0];if(!task)return {status:'sem tarefas' as const,sourceId:null};
 const {data:source,error:sourceError}=await db.from('sources').select('id,name,url,connector_key,active').eq('id',task.source_id).single();
 try{
  if(sourceError||!source||!source.active)throw new Error('Fonte desativada ou indisponível.');
  let candidates:unknown[];
  if(source.connector_key==='pis_listing_v1'){
   const result=await fetchPisListing(source.url,fetcher);
   candidates=result.candidates.map(x=>({externalId:x.external_id,code:x.code,region:x.region,startsAt:x.opening_date,endsAt:x.closing_date,documentUrl:x.document_url,contentHash:x.content_hash,documents:[],programs:[]}));
  }else if((source.connector_key==='pessoas_2030_v1'&&source.url==='https://pessoas2030.gov.pt/avisos/')||(source.connector_key==='portugal_2030_v1'&&source.url==='https://portugal2030.pt/avisos/')){
   const listing=source.connector_key==='pessoas_2030_v1'?await fetchPessoas('aberto',fetcher):await fetchPortugal2030('aberto',fetcher);
   candidates=listing.map(x=>({...x,documentUrl:source.url,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='compete_2030_v1'&&source.url==='https://compete2030.gov.pt/avisos/'){
   candidates=(await fetchCompete(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='eu_grants_v1'&&source.url==='https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities'){
   candidates=(await fetchEuListing(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key.startsWith('eu_program_')&&source.url==='https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities'){
   const key=source.connector_key.slice('eu_program_'.length,-3) as EuProgramKey;
   candidates=(await fetchEuProgramListing(key,fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='eismea_v1'&&source.url==='https://eismea.ec.europa.eu/funding-opportunities/calls-proposals_en'){
   candidates=(await fetchEismea(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='eureka_v1'&&source.url==='https://www.eureka.dlr.de/en/calls/eureka-network-projects/'){
   candidates=(await fetchEureka(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='eurostars_v1'&&source.url==='https://www.eureka.dlr.de/en/calls/eurostars-calls/'){
   candidates=(await fetchEurostars(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='cluster_calls_v1'&&source.url==='https://www.clustercollaboration.eu/funding-and-tenders'){
   candidates=(await fetchClusterCalls(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='eui_calls_v1'&&source.url?.replace(/\/+$/,'')==='https://www.urban-initiative.eu'){
   candidates=(await fetchEui(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='prr_v1'&&source.url==='https://recuperarportugal.gov.pt/candidaturas-prr/'){
   candidates=(await fetchPrr(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='fct_v1'&&source.url==='https://www.fct.pt/concursos'){
   candidates=(await fetchFct(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='fundo_v1'&&source.url==='https://www.fundoambiental.pt/candidaturas/formularios.aspx'){
   candidates=(await fetchFundo(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='interreg_v1'&&source.url==='https://interreg.eu/calls-for-projects/'){
   candidates=(await fetchInterreg(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='eit_v1'&&source.url==='https://www.eit.europa.eu/our-activities/opportunities'){
   candidates=(await fetchEit(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='dgartes_v1'&&source.url==='https://www.dgartes.gov.pt/pt/vnode/1'){
   candidates=(await fetchDg(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='pepac_v1'&&source.url==='https://pepacc.pt/concursos/'){
   candidates=(await fetchPepac(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='iefp_v1'&&source.url==='https://iefponline.iefp.pt/IEFP/apoioIncentivos.do?menu=ai_emprego'){
   candidates=(await fetchIefp(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='turismo_v1'&&source.url==='https://business.turismodeportugal.pt/pt/Investir/Financiamento/avisos-concursos/Paginas/default.aspx'){
   candidates=(await fetchTurismo(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='bpf_v1'&&source.url==='https://www.bpfomento.pt/pt/catalogo/produtos-de-garantia/'){
   candidates=(await fetchBpf(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='mar_v1'&&source.url==='https://mar2030.pt/avisos/'){
   candidates=(await fetchMar(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='sustentavel_v1'&&source.url==='https://sustentavel2030.gov.pt/avisos/'){
   candidates=(await fetchSustentavel(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(source.connector_key==='ani_v1'&&source.url==='https://ani.pt/concursos-nacionais-e-internacionais/'){
   candidates=(await fetchAni(fetcher)).map(x=>({...x,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else if(['regional_norte_v1','regional_centro_v1','regional_lisboa_v1','regional_alentejo_v1','regional_algarve_v1','regional_acores_v1','regional_madeira_v1','regional_fami_v1'].includes(source.connector_key)){
   const key=source.connector_key.slice(9,-3) as RegionalKey;if(source.url!==`${regionalOrigin(key)}/avisos/`)throw new Error('Endereço regional inesperado.');
   candidates=(await fetchRegional(key,fetcher)).map(x=>({...x,documentUrl:source.url,contentHash:createHash('sha256').update(JSON.stringify(x)).digest('hex')}));
  }else throw new Error('Conector ou endereço não suportado.');
  const bytes=Buffer.from(JSON.stringify(candidates)),hash=createHash('sha256').update(bytes).digest('hex'),path=`source-snapshots/${source.id}/${hash}.json`;
  const {error:uploadError}=await db.storage.from('radar-documents').upload(path,bytes,{contentType:'application/json',upsert:true});
  if(uploadError)throw new Error('Não foi possível guardar a listagem.');
  const {error:finishError}=await db.rpc('finish_scan_source',{p_task:task.id,p_hash:hash,p_path:path,p_size:bytes.length,p_candidates:candidates});
  if(finishError)throw new Error('Não foi possível registar os candidatos.');
  try{
   const catalog=await syncCandidatesToRadar(db,{id:source.id,name:source.name},candidates as Record<string,unknown>[]);
   return {status:'concluída' as const,sourceId:source.id,count:candidates.length,catalog};
  }catch(error){
   const detail=error instanceof Error?error.message:'Erro desconhecido na sincronização do catálogo.';
   return {status:'concluída' as const,sourceId:source.id,count:candidates.length,catalogSync:'erro' as const,catalogSyncError:detail.slice(0,300)};
  }
 }catch(error){
  const detail=error instanceof Error?error.message:'Erro de processamento.';
  const {error:saveError}=await db.rpc('fail_scan_source',{p_task:task.id,p_detail:detail});
  if(saveError)throw new Error('Não foi possível registar a falha da fonte.');
  if(source){try{await queueSourceIssue(db,task.scan_id,source.name,source.id);}catch{throw new Error('Não foi possível registar o alerta da fonte.');}}
  return {status:'erro' as const};
 }
}
