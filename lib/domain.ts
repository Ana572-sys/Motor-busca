/** Domain rules use only fields supported by a document or official page. */
export const trackedFields = ['deadline','opening_date','funding_rate','budget','beneficiaries','geography','minimum_investment','maximum_investment','maximum_aid','eligible_costs','duration','application_mode','phases','partnership','official_documents','other_conditions'] as const;
export type Field = typeof trackedFields[number];
export type Evidence = {value:string; sourceUrl:string; documentId?:string; excerpt?:string};
export type Facts = Partial<Record<Field,Evidence>>;
export type Change = {field:Field; previous:Evidence|null; current:Evidence|null};

export function compareFacts(previous:Facts,current:Facts):Change[]{
 return trackedFields.flatMap(field=>{
  const old=previous[field]??null, next=current[field]??null;
  // A missing extraction is not proof that the source removed a condition.
  if(!old||!next||old.value.trim()===next.value.trim())return [];
  return [{field,previous:old,current:next}];
 });
}
function day(value:string):number|null{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const time=Date.parse(`${value}T00:00:00Z`);
 if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value)return null;
 return time;
}
export function isExtension(changes:Change[]):boolean{
 const change=changes.find(c=>c.field==='deadline');
 if(!change?.previous||!change.current)return false;
 const old=day(change.previous.value), next=day(change.current.value);
 return old!==null&&next!==null&&next>old;
}
export type Admission = 'portugal_explicit'|'multiple_countries_explicit'|'not_explicit'|'excluded';
export type ApplicationStatus = 'open'|'closed'|'unconfirmed';
export function mayShowOnDashboard(status:ApplicationStatus,admission:Admission):boolean{
 return status==='open'&&(admission==='portugal_explicit'||admission==='multiple_countries_explicit');
}
export function canReuseFactsheet(sheetVersionId:string, currentVersionId:string):boolean{
 return Boolean(sheetVersionId)&&sheetVersionId===currentVersionId;
}
