'use server';
import {createClient} from '@supabase/supabase-js';import {redirect} from 'next/navigation';import {revalidatePath} from 'next/cache';
import {configured,supabase} from '@/lib/supabase';import {generateFactsheet,type Material} from '@/lib/factsheet';
import {createHash} from 'node:crypto';
function rate(value:string|undefined){if(!value?.trim())return undefined;const n=Number(value);return Number.isFinite(n)&&n>=0?n:undefined;}
export async function requestFactsheet(form:FormData){
 const id=String(form.get('id')||'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))redirect('/');
 const back=(query:string)=>`/avisos/${id}?${query}`;
 if(!configured())redirect('/login');const db=await supabase();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');
 const {data:profile}=await db.from('users').select('id').eq('id',user.id).maybeSingle();if(!profile)redirect('/login?erro=acesso');
 const {data:version}=await db.from('opportunity_versions').select('id,materials_complete').eq('opportunity_id',id).order('detected_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();
 if(!version?.materials_complete)redirect(back('erro=documentos'));
 const regenerate=form.get('regenerate')==='1';
 if(!regenerate){const {data:existing}=await db.from('factsheets').select('id').eq('opportunity_id',id).eq('version_id',version.id).limit(1).maybeSingle();if(existing)redirect(back('ficha=existente'));}
 const supaUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY,apiUrl='https://api.openai.com/v1/chat/completions',apiKey=process.env.OPENAI_API_KEY,model=process.env.AI_MODEL||'gpt-6-luna';
 if(!supaUrl||!key||!apiUrl||!apiKey||!model)redirect(back('erro=configuracao'));
 const admin=createClient(supaUrl,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:job,error:claimError}=await admin.rpc('claim_factsheet',{p_opportunity:id,p_version:version.id,p_actor:user.id,p_regenerate:regenerate});
 if(claimError)redirect(back('erro=preparacao'));if(!job)redirect(back('ficha=existente'));
 let ok=false,usage:{inputTokens:number|null;outputTokens:number|null;estimatedCost:number|null}={inputTokens:null,outputTokens:null,estimatedCost:null};
 try{
  const {data:docs,error:docsError}=await admin.from('documents').select('id,material_kind,source_url,extracted_text').eq('version_id',version.id).eq('required_for_analysis',true);
  if(docsError||!docs?.length)throw new Error('Documentos indisponíveis.');
  const materials:Material[]=docs.map(d=>({id:d.id,name:d.material_kind,text:d.extracted_text||''}));
  const {error:trackingError}=await admin.from('factsheet_jobs').update({api_calls:1,model,updated_at:new Date().toISOString()}).eq('id',job).eq('status','running');if(trackingError)throw new Error('Não foi possível registar a chamada à IA.');
  const result=await generateFactsheet({url:apiUrl,apiKey,model,inputCostPerMillion:rate(process.env.AI_INPUT_COST_PER_MILLION),outputCostPerMillion:rate(process.env.AI_OUTPUT_COST_PER_MILLION)},materials,fetch,value=>{usage=value;});
  const content={...result.content,analyzedDocuments:docs.map(d=>({id:d.id,kind:d.material_kind,sourceUrl:d.source_url,sha256:createHash('sha256').update(d.extracted_text||'').digest('hex')}))};
  const {error}=await admin.rpc('finish_factsheet',{p_job:job,p_content:content,p_model:model,p_input:result.inputTokens,p_output:result.outputTokens,p_cost:result.estimatedCost});if(error)throw new Error('Não foi possível guardar a ficha.');ok=true;
 }catch(error){const message=error instanceof Error?error.message.slice(0,350):'Falha na geração.';await admin.from('factsheet_jobs').update({status:'failed',error:message,input_tokens:usage.inputTokens,output_tokens:usage.outputTokens,estimated_cost:usage.estimatedCost,updated_at:new Date().toISOString()}).eq('id',job).eq('status','running');}
 revalidatePath(`/avisos/${id}`);redirect(back(ok?'ficha=gerada':'erro=geracao'));
}
