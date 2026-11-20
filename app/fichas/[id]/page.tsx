import {notFound,redirect} from 'next/navigation';
import {configured,supabase} from '@/lib/supabase';
import {candidateSections,type CandidateFactsheet,FACTSHEET_MODEL_LABEL} from '@/lib/candidate-factsheet';
import {ArrowLeft,ArrowUpRight,FileText} from 'lucide-react';

export default async function FactsheetArchiveDetail({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))notFound();
 if(!configured())redirect('/login?erro=configuracao');
 const db=await supabase(),{data:{user}}=await db.auth.getUser();if(!user)redirect('/login');
 const {data:profile}=await db.from('users').select('id').eq('id',user.id).maybeSingle();if(!profile)redirect('/login?erro=acesso');
 const {data:row,error}=await db.from('candidate_factsheets').select('id,candidate_id,content_hash,scan_id,status,content,model,input_tokens,output_tokens,estimated_cost_usd,created_at').eq('id',id).eq('status','done').maybeSingle();
 if(error)notFound();
 if(!row){const {data:legacy}=await db.from('factsheets').select('opportunity_id').eq('id',id).maybeSingle();if(legacy)redirect(`/avisos/${legacy.opportunity_id}#fichas`);notFound();}
 const {data:candidate}=await db.from('source_candidates').select('id,source_id,code,title,region,programs,document_url').eq('id',row.candidate_id).maybeSingle();
 const sourceResult=candidate?.source_id?await db.from('sources').select('id,name,url').eq('id',candidate.source_id).maybeSingle():null;
 const content=row.content&&typeof row.content==='object'?row.content as CandidateFactsheet:null;
 if(!content||typeof content.introduction!=='string'||!content.sections)notFound();
 const documents=Array.isArray(content.analyzedDocuments)?content.analyzedDocuments.filter(item=>item&&typeof item.name==='string'&&typeof item.url==='string'&&/^https:\/\//i.test(item.url)):[];
 const programs=Array.isArray(candidate?.programs)?candidate.programs.filter((value):value is string=>typeof value==='string'):[];
 const sourceName=sourceResult?.data?.name||'Fonte oficial';
 return <main className="detail archive-detail"><a className="back" href="/?tab=historico"><ArrowLeft size={15}/> Voltar ao histórico</a><div className="detail-title"><div><span className="eyebrow">FICHA TÉCNICA · {sourceName.toUpperCase()}</span><h1>{candidate?.title||candidate?.code||'Aviso sem título'}</h1><p>{programs.join(' · ')}{candidate?.region?` · ${candidate.region}`:''}</p></div><span className="pill">Gerada</span></div><section className="panel archive-sheet"><div className="panel-head"><div><span className="eyebrow">ANÁLISE DO AVISO</span><h2>Ficha completa</h2><p>Gerada em {new Date(row.created_at).toLocaleString('pt-PT')} · {row.model||FACTSHEET_MODEL_LABEL}</p></div></div><div className="archive-sheet-content"><p className="factsheet-introduction">{content.introduction}</p>{content.beneficiary_types?.length? <p className="factsheet-types"><strong>Tipos de entidade:</strong> {content.beneficiary_types.join(', ')}</p>:null}<div className="factsheet-sections">{candidateSections.map(([key,label])=><div className="factsheet-section" key={key}><strong>{label}</strong><p>{content.sections[key]||'Informação não identificada no aviso.'}</p></div>)}</div><div className="factsheet-usage">Entrada: {row.input_tokens?.toLocaleString('pt-PT')||'—'} tokens · Saída: {row.output_tokens?.toLocaleString('pt-PT')||'—'} tokens · Custo estimado: {formatUsd(Number(row.estimated_cost_usd||0))}</div></div></section><section className="panel archive-documents"><div className="panel-head"><div><span className="eyebrow">FONTES</span><h2>Aviso e documentos analisados</h2></div></div><div className="archive-document-links">{candidate?.document_url&&/^https:\/\//i.test(candidate.document_url)&&<a href={candidate.document_url} target="_blank" rel="noreferrer"><ArrowUpRight size={16}/> Abrir aviso oficial</a>}{documents.map((document,index)=><a href={document.url} target="_blank" rel="noreferrer" key={`${document.url}-${index}`}><FileText size={16}/> {document.name}</a>)}{!documents.length&&!candidate?.document_url&&<p>O aviso não tem ligações de documentos disponíveis.</p>}</div></section><footer>Radar G&I <span>•</span> Crowe Portugal <span>·</span> Área reservada</footer></main>;
}
function formatUsd(value:number){return new Intl.NumberFormat('pt-PT',{style:'currency',currency:'USD',minimumFractionDigits:4,maximumFractionDigits:4}).format(value);}
