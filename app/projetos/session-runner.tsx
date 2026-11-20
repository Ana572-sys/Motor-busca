'use client';
import {useEffect,useRef} from 'react';
import {useRouter} from 'next/navigation';

export function ProjectSessionRunner({sessionId,status}:{sessionId:string;status:string}){
 const router=useRouter(),running=useRef(false);
 useEffect(()=>{
  if(!['queued','running'].includes(status))return;
  let disposed=false;
  async function step(){
   if(disposed||running.current)return;
   running.current=true;
   try{await fetch(`/api/project-analysis/${sessionId}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'});if(!disposed)router.refresh();}
   catch{if(!disposed)router.refresh();}
   finally{running.current=false;}
  }
  void step();const timer=window.setInterval(()=>void step(),2500);
  return()=>{disposed=true;window.clearInterval(timer);};
 },[router,sessionId,status]);
 return <div className="project-running" role="status" aria-live="polite"><strong>{status==='queued'?'A preparar a comparação do projeto':'A comparar os avisos abertos'}</strong><div className="progress-track indeterminate"><span/></div><small>Esta etapa usa informação estruturada já guardada e não consome API.</small></div>;
}
