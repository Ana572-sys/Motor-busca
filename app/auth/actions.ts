'use server';
import { redirect } from 'next/navigation';
import { configured, supabase } from '@/lib/supabase';
export async function login(form: FormData) {
 if (!configured()) redirect('/login?erro=configuracao');
 const db=await supabase(); const {error}=await db.auth.signInWithPassword({email:String(form.get('email')||''),password:String(form.get('password')||'')});
 if(error) redirect('/login?erro=credenciais'); redirect('/');
}
export async function logout() { if(configured()) {const db=await supabase(); await db.auth.signOut();} redirect('/login'); }
export async function recover(form:FormData) {
 if(!configured()) redirect('/login?erro=configuracao');
 const db=await supabase(); const site=process.env.NEXT_PUBLIC_SITE_URL;
 if(!site) redirect('/login?erro=configuracao');
 await db.auth.resetPasswordForEmail(String(form.get('email')||''),{redirectTo:new URL('/auth/callback?next=/repor-palavra-passe',site).toString()});
 redirect('/login?recuperacao=1');
}
export async function updatePassword(form:FormData) {
 const password=String(form.get('password')||''); if(password.length<12) redirect('/repor-palavra-passe?erro=1');
 const db=await supabase(); const {error}=await db.auth.updateUser({password}); if(error) redirect('/repor-palavra-passe?erro=1'); redirect('/');
}
