import type {SupabaseClient} from '@supabase/supabase-js';
import {sendGraphMail,type GraphConfig} from './graph.ts';
export const recipients=['ana.oliveira@crowe.pt','sara.fernandes@crowe.pt','raquel.lusquinos@crowe.pt','nuno.vieira@crowe.pt'];
export async function queueSourceIssue(db:SupabaseClient,scanId:string,sourceName:string,sourceId=sourceName){
 const subject=`Radar G&I: problema na fonte ${sourceName}`;
 const body=`Não foi possível concluir a consulta da fonte ${sourceName}. Consulte a pesquisa e o detalhe do erro na aplicação. Este aviso não confirma que a fonte esteja definitivamente indisponível.`;
 const rows=recipients.map(recipient=>({scan_id:scanId,recipient,kind:'source_issue',status:'pending',idempotency_key:`${scanId}:source_issue:${sourceId}:${recipient}`,subject,body}));
 const {error}=await db.from('notifications').upsert(rows,{onConflict:'idempotency_key',ignoreDuplicates:true});
 if(error)throw new Error('Não foi possível registar os alertas.');
}
export async function queueWeeklyDigest(db:SupabaseClient,scanId:string,body:string){
 const subject='Radar G&I: resumo semanal de avisos';
 const rows=recipients.map(recipient=>({scan_id:scanId,recipient,kind:'weekly_summary',status:'pending',idempotency_key:`${scanId}:weekly_summary:${recipient}`,subject,body}));
 const {error}=await db.from('notifications').upsert(rows,{onConflict:'idempotency_key',ignoreDuplicates:true});if(error)throw new Error('Não foi possível registar o resumo semanal.');
}
/** Once a send is attempted, a timeout is treated as unknown and never silently retried. */
export async function dispatchPendingNotifications(db:SupabaseClient,config:GraphConfig,fetcher:typeof fetch=fetch){
 let accepted=0,unknown=0;
 for(let i=0;i<4;i++){
  const {data,error}=await db.rpc('claim_notification');if(error)throw new Error('Não foi possível reservar uma notificação.');const item=data?.[0];if(!item)break;
  let status='accepted',errorMessage:string|null=null;
  try{await sendGraphMail(config,[item.recipient],item.subject,item.body,fetcher);accepted++;}catch{status='unknown';unknown++;errorMessage='Resultado do envio não confirmado; verificar antes de reenviar.';}
  const {error:saveError}=await db.from('notifications').update({status,error:errorMessage,accepted_at:status==='accepted'?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq('id',item.id).eq('status','sending');
  if(saveError)throw new Error('Não foi possível guardar o resultado do envio.');
 }
 return {accepted,unknown};
}
export function graphConfigFromEnv():GraphConfig|null{
 const {GRAPH_TENANT_ID:tenantId,GRAPH_CLIENT_ID:clientId,GRAPH_CLIENT_SECRET:clientSecret,GRAPH_SENDER:sender}=process.env;
 return tenantId&&clientId&&clientSecret&&sender?{tenantId,clientId,clientSecret,sender}:null;
}
