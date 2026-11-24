'use client';

import {useEffect} from 'react';

/** Advances source-only work through authenticated browser requests, avoiding Vercel self-invocation. */
export function SourceRunPoller({runId}:{runId:string}){
 useEffect(()=>{
  let stopped=false,timer:number|undefined;
  const advance=async()=>{
   try{
    const response=await fetch('/api/radar/source-worker',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({run_id:runId}),cache:'no-store'});
    const result=await response.json() as {status?:string};
    if(stopped||['source_queue_complete','completed','failed','partial'].includes(result.status||''))return;
    timer=window.setTimeout(advance,result.status==='busy'?2500:500);
   }catch{if(!stopped)timer=window.setTimeout(advance,4000);}
  };
  void advance();return()=>{stopped=true;if(timer!==undefined)window.clearTimeout(timer);};
 },[runId]);
 return null;
}
