import {NextResponse} from 'next/server';import {supabase,configured} from '@/lib/supabase';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 if(!configured())return new Response('Serviço indisponível',{status:503});const db=await supabase();const {data:{user}}=await db.auth.getUser();if(!user)return new Response('Não autorizado',{status:401});
 const {id}=await params;if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return new Response('Não encontrado',{status:404});
 const {data:document}=await db.from('documents').select('storage_path').eq('id',id).maybeSingle();if(!document?.storage_path)return new Response('Não encontrado',{status:404});
 const {data,error}=await db.storage.from('radar-documents').createSignedUrl(document.storage_path,60,{download:true});if(error||!data)return new Response('Não disponível',{status:404});
 const result=NextResponse.redirect(data.signedUrl);result.headers.set('Cache-Control','private, no-store');result.headers.set('Referrer-Policy','no-referrer');return result;
}
