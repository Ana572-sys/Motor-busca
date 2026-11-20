'use server';
import {createClient} from '@supabase/supabase-js';
import {redirect} from 'next/navigation';
import {configured,supabase} from '@/lib/supabase';
import {projectRegions,projectEntityTypes,projectCostCategories,projectApplicationModes} from '@/lib/project-model';

function clean(value:FormDataEntryValue|null,max=4000){return typeof value==='string'?value.trim().slice(0,max):'';}
function dateValue(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:null;}
function optionalBoolean(form:FormData,name:string){const value=clean(form.get(name),5);return value==='yes'?true:value==='no'?false:null;}
export async function createProjectSearch(form:FormData){
 if(!configured())redirect('/login?erro=configuracao');
 const userDb=await supabase(),{data:{user}}=await userDb.auth.getUser();if(!user)redirect('/login');
 const {data:profile}=await userDb.from('users').select('id').eq('id',user.id).maybeSingle();if(!profile)redirect('/login?erro=acesso');
 const description=clean(form.get('description'),8000),entityType=clean(form.get('entity_type'),60),region=clean(form.get('region'),50),applicationMode=clean(form.get('application_mode'),20),sector=clean(form.get('sector'),120);
 if(description.length<20||!sector||!projectEntityTypes.some(x=>x.value===entityType)||!projectRegions.some(x=>x.value===region)||!projectApplicationModes.some(x=>x.value===applicationMode))redirect('/?tab=analisar-projeto&erro=validacao');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;if(!url||!key)redirect('/?tab=analisar-projeto&erro=configuracao');
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const categories=form.getAll('cost_category').map(value=>String(value)),amounts=form.getAll('cost_amount').map(value=>String(value)),descriptions=form.getAll('cost_description').map(value=>String(value));
 const costItems=categories.flatMap((category,index)=>{if(!projectCostCategories.some(x=>x.value===category))return [];const amount=amounts[index]?.trim()?Number(amounts[index]):null;if(amount!==null&&(!Number.isFinite(amount)||amount<0))return [];return [{category,amount,description:descriptions[index]?.trim().slice(0,500)||null,position:index}];});
 const sum=costItems.reduce((total,item)=>total+(item.amount||0),0),reportedTotal=Number(clean(form.get('investment_total'),30).replace(',','.'));
 const totalInvestment=Number.isFinite(reportedTotal)&&reportedTotal>0?reportedTotal:sum||null;
 const partnerCountries=clean(form.get('partner_countries'),500).split(',').map(x=>x.trim()).filter(Boolean).slice(0,20);
 const project={owner_id:user.id,internal_name:clean(form.get('internal_name'),120)||null,description,sector,cae:clean(form.get('cae'),20)||null,technology_area:clean(form.get('technology_area'),120)||null,main_objective:clean(form.get('main_objective'),500)||null,current_stage:clean(form.get('current_stage'),120)||null,innovation_level:clean(form.get('innovation_level'),80)||null,has_prototype:optionalBoolean(form,'has_prototype'),needs_rd:optionalBoolean(form,'needs_rd'),needs_internationalization:optionalBoolean(form,'needs_internationalization'),needs_hiring:optionalBoolean(form,'needs_hiring'),has_partners:optionalBoolean(form,'has_partners'),needs_partners:optionalBoolean(form,'needs_partners'),entity_type:entityType,country:clean(form.get('country'),100)||'Portugal',region,application_mode:applicationMode,partner_countries:partnerCountries,total_investment:totalInvestment,duration_months:Number(clean(form.get('duration_months'),4))||null,planned_start:dateValue(clean(form.get('planned_start'),10)),planned_end:dateValue(clean(form.get('planned_end'),10))};
 const {data:saved,error}=await admin.from('project_profiles').insert(project).select('id').single();if(error||!saved)redirect('/?tab=analisar-projeto&erro=guardar');
 if(costItems.length){const rows=costItems.map(item=>({...item,project_id:saved.id}));const {error:costError}=await admin.from('project_cost_items').insert(rows);if(costError){await admin.from('project_profiles').delete().eq('id',saved.id);redirect('/?tab=analisar-projeto&erro=guardar');}}
 const projectSnapshot={...project,cost_items:costItems};
 const {data:version,error:versionError}=await admin.from('project_profile_versions').insert({project_id:saved.id,version_number:1,snapshot:projectSnapshot,created_by:user.id}).select('id').single();
 if(versionError||!version){await admin.from('project_profiles').delete().eq('id',saved.id);redirect('/?tab=analisar-projeto&erro=guardar');}
 await admin.from('project_activity_log').insert({project_id:saved.id,actor_id:user.id,action:'created',changes:[{field:'project',after:'Versão inicial'}]});
 const {data:session,error:sessionError}=await admin.from('project_search_sessions').insert({project_id:saved.id,owner_id:user.id,project_version_id:version.id,project_snapshot:projectSnapshot,status:'queued'}).select('id').single();
 if(sessionError||!session){await admin.from('project_profiles').delete().eq('id',saved.id);redirect('/?tab=analisar-projeto&erro=guardar');}
 redirect(`/?tab=projetos&sessao=${session.id}`);
}

export async function resumeProjectSession(form:FormData){
 const sessionId=clean(form.get('session_id'),50);if(!/^[0-9a-f-]{36}$/i.test(sessionId))redirect('/?tab=analisar-projeto&erro=validacao');
 if(!configured())redirect('/login');const userDb=await supabase(),{data:{user}}=await userDb.auth.getUser();if(!user)redirect('/login');const {data:member}=await userDb.from('users').select('role').eq('id',user.id).maybeSingle();if(!member)redirect('/login?erro=acesso');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;if(!url||!key)redirect(`/?tab=projetos&sessao=${sessionId}&erro=configuracao`);const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),{data:session}=await admin.from('project_search_sessions').select('id,owner_id').eq('id',sessionId).maybeSingle();if(!session)redirect(`/?tab=projetos&sessao=${sessionId}&erro=acesso`);
 await admin.from('project_search_sessions').update({status:'running',error_code:null,finished_at:null,updated_at:new Date().toISOString()}).eq('id',sessionId);redirect(`/?tab=projetos&sessao=${sessionId}`);
}

export async function updateProjectAnalysis(form:FormData){
 const sessionId=clean(form.get('session_id'),50);if(!/^[0-9a-f-]{36}$/i.test(sessionId))redirect('/?tab=projetos&erro=validacao');
 if(!configured())redirect('/login');const userDb=await supabase(),{data:{user}}=await userDb.auth.getUser();if(!user)redirect('/login');const {data:member}=await userDb.from('users').select('id').eq('id',user.id).maybeSingle();if(!member)redirect('/login?erro=acesso');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;if(!url||!key)redirect(`/?tab=projetos&sessao=${sessionId}&erro=configuracao`);
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),{data:previous}=await admin.from('project_search_sessions').select('project_id,project_snapshot,analysis_version').eq('id',sessionId).maybeSingle();
 if(!previous)redirect(`/?tab=projetos&sessao=${sessionId}&erro=acesso`);
 const projectId=String(previous.project_id),nextVersion=Number(previous.analysis_version||1)+1,snapshot=previous.project_snapshot;
 const {data:version,error:versionError}=await admin.from('project_profile_versions').insert({project_id:projectId,version_number:nextVersion,snapshot,created_by:user.id}).select('id').single();
 if(versionError||!version)redirect(`/?tab=projetos&sessao=${sessionId}&erro=guardar`);
 const {data:next,error:sessionError}=await admin.from('project_search_sessions').insert({project_id:projectId,owner_id:user.id,project_snapshot:snapshot,project_version_id:version.id,analysis_version:nextVersion,status:'queued'}).select('id').single();
 if(sessionError||!next){await admin.from('project_profile_versions').delete().eq('id',version.id);redirect(`/?tab=projetos&sessao=${sessionId}&erro=guardar`);}
 await admin.from('project_activity_log').insert({project_id:projectId,actor_id:user.id,action:'analysis_updated',changes:[{field:'analysis',before:`Versão ${previous.analysis_version||1}`,after:`Versão ${nextVersion}`} ]});
 redirect(`/?tab=projetos&sessao=${next.id}`);
}

