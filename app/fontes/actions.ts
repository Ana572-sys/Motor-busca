'use server';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {configured,supabase} from '@/lib/supabase';
export async function updateSource(form:FormData){
 if(!configured())redirect('/login');
 const db=await supabase();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');
 const name=String(form.get('name')||'').trim(), raw=String(form.get('url')||'').trim(), id=String(form.get('id')||'');
 try { if(raw){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)throw new Error();} } catch {redirect('/?tab=fontes&erro=url');}
 if(!name||name.length>150||raw.length>2048)redirect('/?tab=fontes&erro=dados');
 const {error}=await db.rpc('update_source',{p_id:id,p_name:name,p_url:raw||null,p_active:form.get('active')==='on'});
 if(error)redirect('/?tab=fontes&erro=guardar');
 revalidatePath('/');redirect('/?tab=fontes&guardado=1');
}
