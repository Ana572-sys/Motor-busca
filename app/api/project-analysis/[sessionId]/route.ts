import {NextResponse} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {configured,supabase} from '@/lib/supabase';
import {processProjectAnalysisStep} from '@/lib/project-analysis';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function POST(request:Request,{params}:{params:Promise<{sessionId:string}>}){
 const {sessionId}=await params; const origin=request.headers.get('origin'),referer=request.headers.get('referer'),expected=new URL(request.url).origin;if((origin&&origin!==expected)||(referer&&new URL(referer).origin!==expected))return NextResponse.json({error:'invalid_origin'},{status:403});if(!/^[0-9a-f-]{36}$/i.test(sessionId))return NextResponse.json({error:'invalid_session'},{status:400});
 if(!configured())return NextResponse.json({error:'not_configured'},{status:503});const userDb=await supabase(),{data:{user}}=await userDb.auth.getUser();if(!user)return NextResponse.json({error:'unauthorized'},{status:401});
 const {data:profile}=await userDb.from('users').select('role').eq('id',user.id).maybeSingle();if(!profile)return NextResponse.json({error:'unauthorized'},{status:401});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;if(!url||!key)return NextResponse.json({error:'not_configured'},{status:503});const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:session}=await admin.from('project_search_sessions').select('owner_id').eq('id',sessionId).maybeSingle();if(!session)return NextResponse.json({error:'forbidden'},{status:403});
 try{return NextResponse.json(await processProjectAnalysisStep(admin,sessionId,session.owner_id));}catch{return NextResponse.json({error:'analysis_failed'},{status:500});}
}
