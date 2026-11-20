'use server';
import {createClient} from '@supabase/supabase-js';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {supabase,configured} from '@/lib/supabase';
const allowed=new Set(['ana.oliveira@crowe.pt','sara.fernandes@crowe.pt','raquel.lusquinos@crowe.pt','nuno.vieira@crowe.pt']);
export async function invite(form:FormData){
 if(!configured())redirect('/login');
 const db=await supabase();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');
 const {data:profile}=await db.from('users').select('role').eq('id',user.id).maybeSingle();
 if(profile?.role!=='admin')redirect('/?tab=utilizadores&erro=permissao');
 const email=String(form.get('email')||'').trim().toLowerCase();
 const key=process.env.SUPABASE_SECRET_KEY, url=process.env.NEXT_PUBLIC_SUPABASE_URL, site=process.env.NEXT_PUBLIC_SITE_URL;
 if(!allowed.has(email)||!key||!url||!site)redirect('/?tab=utilizadores&erro=configuracao');
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await admin.auth.admin.inviteUserByEmail(email,{redirectTo:new URL('/auth/callback?next=/repor-palavra-passe',site).toString()});
 if(error||!data.user)redirect('/?tab=utilizadores&erro=convite');
 const {error:profileError}=await admin.from('users').upsert({id:data.user.id,email,role:'member'},{onConflict:'id',ignoreDuplicates:true});
 if(profileError)redirect('/?tab=utilizadores&erro=perfil');
 await admin.from('audit_logs').insert({actor_id:user.id,action:'user.invite',entity_type:'user',entity_id:data.user.id,details:{email}});
 revalidatePath('/');redirect('/?tab=utilizadores&guardado=1');
}
