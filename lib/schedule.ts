/** Evaluates a scheduled invocation in Lisbon local time, including daylight saving. */
export function lisbonSchedule(now:Date):{shouldStart:boolean;localDate:string}{
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Lisbon',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const get=(name:string)=>parts.find(p=>p.type===name)?.value||'';
 return {shouldStart:get('weekday')==='Mon'&&get('hour')==='08'&&get('minute')==='30',localDate:`${get('year')}-${get('month')}-${get('day')}`};
}
