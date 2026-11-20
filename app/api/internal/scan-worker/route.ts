import {createClient} from '@supabase/supabase-js';
import {processScanSource} from '@/lib/scan-processor';
import {validWorkerToken} from '@/lib/worker-auth';
export const maxDuration=60;
export const dynamic='force-dynamic';
export async function POST(request:Request){
 const secret=process.env.SCAN_WORKER_SECRET;
 if(!secret||secret.length<32)return Response.json({error:'Processador não configurado.'},{status:503});
 if(!validWorkerToken(secret,request.headers.get('authorization')))return Response.json({error:'Não autorizado.'},{status:401});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
 if(!url||!key)return Response.json({error:'Base de dados não configurada.'},{status:503});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 try{return Response.json(await processScanSource(db));}catch{return Response.json({error:'Não foi possível processar a fonte.'},{status:500});}
}
