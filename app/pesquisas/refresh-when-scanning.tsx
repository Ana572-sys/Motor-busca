'use client';

import {useEffect} from 'react';
import {useRouter} from 'next/navigation';

export function RefreshWhenScanning(){
 const router=useRouter();
 useEffect(()=>{const timer=window.setInterval(()=>router.refresh(),6000);return()=>window.clearInterval(timer);},[router]);
 return null;
}
