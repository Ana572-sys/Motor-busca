'use server';
import {createClient} from '@supabase/supabase-js';import {after} from 'next/server';import {redirect} from 'next/navigation';import {revalidatePath} from 'next/cache';
import {configured,supabase} from '@/lib/supabase';import {downloadPage,permittedSourceUrl} from '@/lib/diagnostic';
import {fetchPisListing,type Candidate} from '@/lib/pis-listing';import {createHash} from 'node:crypto';
import {fetchPessoas,fetchPortugal2030} from '@/lib/pessoas-listing';
import {queueSourceIssue,dispatchPendingNotifications,graphConfigFromEnv} from '@/lib/notifications';
import {processScanSource} from '@/lib/scan-processor';
import {searchWindows,regionFilters,entityFilters} from '@/lib/candidate-filters';
export async function requestManualScan(form:FormData){
 if(process.env.SCAN_WORKER_READY!=='true')redirect('/?tab=pesquisas&erro=configuracao');
 if(!configured())redirect('/login');
 const period=form.get('period');
 if(typeof period!=='string'||!searchWindows.some(option=>option.value===period))redirect('/?tab=pesquisas&erro=periodo');
 const region=String(form.get('region_filter')||'todas'),entity=String(form.get('entity_filter')||'todas');
 if(!regionFilters.some(([value])=>value===region)||!entityFilters.some(([value])=>value===entity))redirect('/?tab=pesquisas&erro=filtros');
 const db=await supabase();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;if(!url||!key)redirect('/?tab=pesquisas&erro=configuracao');
 const {data:scanId,error}=await db.rpc('request_manual_scan',{p_period:period});
 if(error||!scanId)redirect('/?tab=pesquisas&erro=execucao');
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 after(async()=>{await Promise.allSettled(Array.from({length:44},()=>processScanSource(admin,scanId)));revalidatePath('/');});
 revalidatePath('/');const params=new URLSearchParams({tab:'pesquisas',pesquisa:'executada',janela:period,regiao:region,entidade:entity});redirect(`/?${params.toString()}`);
}
/** Restricted pilot: listings are candidates and never become eligible opportunities automatically. */
export async function checkSource(){
 if(!configured())redirect('/login');
 const userClient=await supabase();const {data:{user}}=await userClient.auth.getUser();if(!user)redirect('/login');
 const {data:profile}=await userClient.from('users').select('id').eq('id',user.id).maybeSingle();if(!profile)redirect('/login?erro=acesso');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;if(!url||!key)redirect('/?tab=pesquisas&erro=configuracao');
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:source, error:sourceError}=await admin.from('sources').select('id,name,url,active').eq('connector_key','pis_listing_v1').maybeSingle();
 if(sourceError||!source?.active||!source.url||!permittedSourceUrl(source.url))redirect('/?tab=pesquisas&erro=fonte');
 // A killed invocation must not permanently prevent a later diagnostic.
 const stale=new Date(Date.now()-10*60_000).toISOString();
 await admin.from('scans').update({status:'interrompida',finished_at:new Date().toISOString()}).eq('kind','manual').eq('period','diagnóstico').eq('status','em curso').lt('started_at',stale);
 const {data:scan,error:scanError}=await admin.from('scans').insert({kind:'manual',period:'diagnóstico',status:'em curso',requested_by:user.id}).select('id').single();
 if(scanError||!scan)redirect('/?tab=pesquisas&erro=execucao');
 let status='concluída', detail='Página consultada e guardada.', snapshotId:string|null=null;
 let listing:{hash:string;path:string;size:number;candidates:Candidate[]}|null=null;
 try{
  const result=await downloadPage(source.url);const path=`source-snapshots/${source.id}/${result.hash}.txt`;
  const {data:existing,error:lookupError}=await admin.from('source_snapshots').select('id').eq('source_id',source.id).eq('content_hash',result.hash).maybeSingle();
  if(lookupError)throw new Error('Não foi possível consultar o histórico da fonte.');
  if(existing){snapshotId=existing.id;detail='Página consultada; conteúdo igual ao já guardado.';}
  else {
   const {error:uploadError}=await admin.storage.from('radar-documents').upload(path,result.bytes,{contentType:'text/plain',upsert:true});
   if(uploadError)throw new Error('Não foi possível guardar a página da fonte.');
   const {data:snapshot,error:insertError}=await admin.from('source_snapshots').insert({source_id:source.id,content_hash:result.hash,storage_path:path,content_type:result.contentType,size_bytes:result.bytes.byteLength}).select('id').single();
   if(insertError||!snapshot)throw new Error('Não foi possível registar a página guardada.');snapshotId=snapshot.id;
  }
  const resultListing=await fetchPisListing(source.url),hash=createHash('sha256').update(resultListing.bytes).digest('hex');
  const listingPath=`source-snapshots/${source.id}/${hash}.txt`;
  const {error:listingError}=await admin.storage.from('radar-documents').upload(listingPath,resultListing.bytes,{contentType:'text/plain',upsert:true});
  if(listingError)throw new Error('Não foi possível guardar a listagem devolvida pela fonte.');
  listing={hash,path:listingPath,size:resultListing.bytes.byteLength,candidates:resultListing.candidates};
 }catch(error){status='erro';detail=error instanceof Error?error.message:'Não foi possível consultar a fonte.';if(detail.length>400)detail='Não foi possível consultar a fonte.';}
 const {error:finishError}=listing&&status==='concluída'
  ?await admin.rpc('finish_pis_diagnostic',{p_scan:scan.id,p_source:source.id,p_page_snapshot:snapshotId,p_listing_hash:listing.hash,p_listing_path:listing.path,p_listing_size:listing.size,p_candidates:listing.candidates})
  :await admin.rpc('finish_source_diagnostic',{p_scan:scan.id,p_source:source.id,p_status:'erro',p_detail:detail,p_snapshot:snapshotId});
 if(finishError)redirect('/?tab=pesquisas&erro=registo');
 if(status==='erro'){try{await queueSourceIssue(admin,scan.id,source.name);const config=graphConfigFromEnv();if(config)await dispatchPendingNotifications(admin,config);}catch{redirect('/?tab=pesquisas&erro=alertas');}}
 revalidatePath('/');redirect(`/?tab=pesquisas&${status==='erro'?'erro=diagnostico':'guardado=1'}`);
}
export async function checkPessoas(){
 if(!configured())redirect('/login');const db=await supabase();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');
 const {data:profile}=await db.from('users').select('id').eq('id',user.id).maybeSingle();if(!profile)redirect('/login?erro=acesso');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;if(!url||!key)redirect('/?tab=pesquisas&erro=configuracao');
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:source,error:sourceError}=await admin.from('sources').select('id,name,url,active').eq('connector_key','pessoas_2030_v1').maybeSingle();
 if(sourceError||!source?.active||source.url!=='https://pessoas2030.gov.pt/avisos/')redirect('/?tab=pesquisas&erro=fonte');
 await admin.from('scans').update({status:'interrompida',finished_at:new Date().toISOString()}).eq('kind','manual').eq('period','diagnóstico').eq('status','em curso').lt('started_at',new Date(Date.now()-600000).toISOString());
 const {data:scan,error}=await admin.from('scans').insert({kind:'manual',period:'diagnóstico',status:'em curso',requested_by:user.id}).select('id').single();if(error||!scan)redirect('/?tab=pesquisas&erro=execucao');
 let success=false,detail='Não foi possível consultar a fonte.';
 try{
  const candidates=(await fetchPessoas('aberto')).map(item=>({...item,contentHash:createHash('sha256').update(JSON.stringify(item)).digest('hex')}));
  const bytes=Buffer.from(JSON.stringify(candidates),'utf8'),hash=createHash('sha256').update(bytes).digest('hex'),path=`source-snapshots/${source.id}/${hash}.txt`;
  const {error:uploadError}=await admin.storage.from('radar-documents').upload(path,bytes,{contentType:'text/plain',upsert:true});if(uploadError)throw new Error('Não foi possível guardar a listagem.');
  const {error:finishError}=await admin.rpc('finish_pessoas_diagnostic',{p_scan:scan.id,p_source:source.id,p_listing_hash:hash,p_listing_path:path,p_listing_size:bytes.byteLength,p_candidates:candidates});if(finishError)throw new Error('Não foi possível registar a listagem.');success=true;
 }catch(e){detail=e instanceof Error?e.message.slice(0,350):detail;}
 if(!success){const {error:finishError}=await admin.rpc('finish_source_diagnostic',{p_scan:scan.id,p_source:source.id,p_status:'erro',p_detail:detail,p_snapshot:null});if(finishError)redirect('/?tab=pesquisas&erro=registo');try{await queueSourceIssue(admin,scan.id,source.name);const config=graphConfigFromEnv();if(config)await dispatchPendingNotifications(admin,config);}catch{redirect('/?tab=pesquisas&erro=alertas');}}
 revalidatePath('/');redirect(`/?tab=pesquisas&${success?'guardado=1':'erro=diagnostico'}`);
}
export async function sendPendingAlerts(){
 if(!configured())redirect('/login');const db=await supabase();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');
 const {data:profile}=await db.from('users').select('role').eq('id',user.id).maybeSingle();if(profile?.role!=='admin')redirect('/?tab=pesquisas&erro=permissao');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY,config=graphConfigFromEnv();if(!url||!key||!config)redirect('/?tab=pesquisas&erro=alertas');
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});let result:{accepted:number;unknown:number};
 try{result=await dispatchPendingNotifications(admin,config);}catch{redirect('/?tab=pesquisas&erro=alertas');}
 revalidatePath('/');redirect(`/?tab=pesquisas&alertas=${result.accepted}&incertos=${result.unknown}`);
}
export async function checkPortugal2030(){
 if(!configured())redirect('/login');const db=await supabase();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');
 const {data:profile}=await db.from('users').select('id').eq('id',user.id).maybeSingle();if(!profile)redirect('/login?erro=acesso');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;if(!url||!key)redirect('/?tab=pesquisas&erro=configuracao');
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:source,error:sourceError}=await admin.from('sources').select('id,name,url,active').eq('connector_key','portugal_2030_v1').maybeSingle();
 if(sourceError||!source?.active||source.url!=='https://portugal2030.pt/avisos/')redirect('/?tab=pesquisas&erro=fonte');
 const {data:scan,error}=await admin.from('scans').insert({kind:'manual',period:'diagnóstico',status:'em curso',requested_by:user.id}).select('id').single();if(error||!scan)redirect('/?tab=pesquisas&erro=execucao');
 let success=false,detail='Não foi possível consultar a fonte.';
 try{
  const candidates=(await fetchPortugal2030('aberto')).map(item=>({...item,contentHash:createHash('sha256').update(JSON.stringify(item)).digest('hex')}));
  const bytes=Buffer.from(JSON.stringify(candidates),'utf8'),hash=createHash('sha256').update(bytes).digest('hex'),path=`source-snapshots/${source.id}/${hash}.txt`;
  const {error:uploadError}=await admin.storage.from('radar-documents').upload(path,bytes,{contentType:'text/plain',upsert:true});if(uploadError)throw new Error('Não foi possível guardar a listagem.');
  const {error:finishError}=await admin.rpc('finish_portugal_diagnostic',{p_scan:scan.id,p_source:source.id,p_listing_hash:hash,p_listing_path:path,p_listing_size:bytes.length,p_candidates:candidates});if(finishError)throw new Error('Não foi possível registar a listagem.');success=true;
 }catch(e){detail=e instanceof Error?e.message.slice(0,350):detail;}
 if(!success){const {error:finishError}=await admin.rpc('finish_source_diagnostic',{p_scan:scan.id,p_source:source.id,p_status:'erro',p_detail:detail,p_snapshot:null});if(finishError)redirect('/?tab=pesquisas&erro=registo');try{await queueSourceIssue(admin,scan.id,source.name,source.id);}catch{redirect('/?tab=pesquisas&erro=alertas');}}
 revalidatePath('/');redirect(`/?tab=pesquisas&${success?'guardado=1':'erro=diagnostico'}`);
}
