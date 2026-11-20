import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {safeAuthRedirect} from '@/lib/auth-redirect';
export async function GET(request:Request){const u=new URL(request.url);const code=u.searchParams.get('code');if(code){const db=await supabase();await db.auth.exchangeCodeForSession(code);} return NextResponse.redirect(new URL(safeAuthRedirect(u.searchParams.get('next')),u.origin));}
