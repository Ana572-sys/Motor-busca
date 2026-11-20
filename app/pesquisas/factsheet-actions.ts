'use server';
import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { configured, supabase } from '@/lib/supabase';
import { FACTSHEET_MODEL, generateCandidateFactsheet, officialPdfUrl } from '@/lib/candidate-factsheet';
import { load } from 'cheerio';
import {searchWindows,regionFilters,entityFilters} from '@/lib/candidate-filters';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_FACTSHEET_DOCUMENTS = 2;
const stage = (name: string, candidateId: string) => console.info(`[factsheet] ${name} candidate=${candidateId}`);

async function boundedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const timeout = AbortSignal.timeout(20_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
}

async function fetchPdf(url: URL) {
  const response = await boundedFetch(url, { redirect: 'manual', headers: { Accept: 'application/pdf' } });
  if (!response.ok || response.status >= 300) throw new Error('documento_indisponivel');
  const contentType=(response.headers.get('content-type')||'').toLowerCase();
  if (!contentType.includes('application/pdf')&&!contentType.includes('application/octet-stream')) throw new Error('documento_invalido');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) throw new Error('documento_demasiado_grande');
  if (!response.body) throw new Error('documento_indisponivel');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > MAX_FILE_BYTES) { await reader.cancel(); throw new Error('documento_demasiado_grande'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (size < 8 || chunks[0]?.[0] !== 0x25 || chunks[0]?.[1] !== 0x50 || chunks[0]?.[2] !== 0x44 || chunks[0]?.[3] !== 0x46) throw new Error('documento_invalido');
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const disposition=response.headers.get('content-disposition')||'';
  const dispositionName=disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  const nameFromUrl=url.searchParams.get('filename')||url.searchParams.get('file')||'';
  const encodedName=dispositionName?.[1]||'';
  let rawName=dispositionName?.[2]||nameFromUrl||url.pathname.split('/').pop()||'aviso.pdf';
  if(encodedName){try{rawName=decodeURIComponent(encodedName);}catch{rawName=nameFromUrl||'aviso.pdf';}}
  const name = rawName.replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 120);
  return { name, url: url.toString(), bytes };
}

async function discoverPdfLinks(pageAddress:string,sourceAddress:string,code:string,title:string):Promise<{name:string;url:URL}[]> {
  let pageUrl:URL,sourceUrl:URL;
  try { pageUrl=new URL(pageAddress);sourceUrl=new URL(sourceAddress); } catch { return []; }
  const host=pageUrl.hostname.toLowerCase(),sourceHost=sourceUrl.hostname.toLowerCase();
  const related=host===sourceHost||host.endsWith(`.${sourceHost}`)||sourceHost.endsWith(`.${host}`);
  if(pageUrl.protocol!=='https:'||sourceUrl.protocol!=='https:'||pageUrl.username||pageUrl.password||pageUrl.port||!related||pageUrl.toString()===sourceUrl.toString()||/\/avisos?\/?$/i.test(pageUrl.pathname))return [];
  const response=await boundedFetch(pageUrl,{redirect:'manual',headers:{Accept:'text/html'}});
  if(!response.ok||response.status>=300||!(response.headers.get('content-type')||'').toLowerCase().includes('text/html'))return [];
  const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>2_000_000)return [];
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength>2_000_000)return [];
  const $=load(new TextDecoder().decode(bytes)),found:{name:string;url:URL;score:number}[]=[];
  $('a[href]').each((_,element)=>{
    const anchor=$(element),raw=anchor.attr('href');if(!raw)return;
    let absolute:string;try{absolute=new URL(raw,pageUrl).toString();}catch{return;}
    const pdf=officialPdfUrl(absolute,sourceAddress);if(!pdf)return;
    const name=anchor.attr('download')||anchor.text().replace(/\s+/g,' ').trim()||pdf.searchParams.get('filename')||pdf.pathname.split('/').pop()||'Documento oficial';
    const searchable=`${name} ${absolute}`.toLowerCase();let score=0;
    if(code&&searchable.includes(code.toLowerCase()))score+=4;
    const titleWords=title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word=>word.length>4);
    score+=titleWords.filter(word=>searchable.includes(word)).length;
    found.push({name,url:pdf,score});
  });
  return found.sort((a,b)=>b.score-a.score).slice(0,4).map(({name,url})=>({name,url}));
}

function listedDocuments(value: unknown): {name:string;url:string}[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const url = typeof row.url === 'string' ? row.url : typeof row.documentUrl === 'string' ? row.documentUrl : '';
    if (!url) return [];
    return [{ name: typeof row.name === 'string' ? row.name : typeof row.documentDesignation === 'string' ? row.documentDesignation : 'Documento oficial', url }];
  });
}

function mainNoticeFirst(documents:{name:string;url:URL}[],code:string,title:string) {
  const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const noticeCode=normalize(code),titleWords=normalize(title).split(/[^\p{L}\p{N}]+/u).filter(word=>word.length>4);
  return documents.map((document,index)=>{
    const text=normalize(`${document.name} ${document.url.toString()}`);let score=0;
    if(noticeCode&&text.includes(noticeCode))score+=100;
    score+=titleWords.filter(word=>text.includes(word)).length*3;
    if(/\b(aviso|regulamento|convite|edital)\b/.test(text))score+=8;
    if(/\b(adenda|anexo|formulario|manual|guia|retificacao|esclarecimentos|perguntas frequentes|faq)\b/.test(text))score-=10;
    return {document,index,score};
  }).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,MAX_FACTSHEET_DOCUMENTS).map(item=>item.document);
}

export async function generateScanCandidateFactsheet(form: FormData) {
  const candidateId = String(form.get('candidate_id') || ''), scanId = String(form.get('scan_id') || '');
  const windowFilter=String(form.get('window_filter')||'todos-abertos'),regionFilter=String(form.get('region_filter')||'todas'),entityFilter=String(form.get('entity_filter')||'todas');
  const params=new URLSearchParams({tab:'pesquisas',janela:searchWindows.some(option=>option.value===windowFilter)?windowFilter:'todos-abertos',regiao:regionFilters.some(([value])=>value===regionFilter)?regionFilter:'todas',entidade:entityFilters.some(([value])=>value===entityFilter)?entityFilter:'todas'});
  const back = (state: string) => `/?${params.toString()}&ficha=${state}#candidato-${candidateId}`;
  if (!uuid.test(candidateId) || !uuid.test(scanId)) redirect('/?tab=pesquisas&ficha=erro');
  stage('pedido recebido', candidateId);
  if (!configured()) redirect('/login');
  const userDb = await supabase(); const { data: { user } } = await userDb.auth.getUser(); if (!user) redirect('/login');
  const { data: profile } = await userDb.from('users').select('id').eq('id', user.id).maybeSingle(); if (!profile) redirect('/login?erro=acesso');
  const apiKey=process.env.OPENAI_API_KEY||'';
  if (!apiKey) redirect(back('configuracao'));
  const dbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!dbUrl || !serviceKey) redirect(back('configuracao'));
  const admin = createClient(dbUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: boundedFetch } });
  const [{ data: scan }, { data: candidate }] = await Promise.all([
    admin.from('scans').select('id,started_at,status').eq('id', scanId).maybeSingle(),
    admin.from('source_candidates').select('id,source_id,current_hash,title,code,region,opening_date,closing_date,document_url,document_metadata,programs,last_observed_at').eq('id', candidateId).maybeSingle(),
  ]);
  if (!scan || !candidate || !['concluída','parcial'].includes(scan.status) || candidate.last_observed_at < scan.started_at) redirect(back('aviso-desatualizado'));
  stage('aviso validado', candidateId);
  const { data: completedSource } = await admin.from('scan_sources').select('id').eq('scan_id', scanId).eq('source_id', candidate.source_id).eq('status','concluída').maybeSingle();
  if (!completedSource) redirect(back('aviso-desatualizado'));
  const { data: source } = await admin.from('sources').select('url').eq('id', candidate.source_id).maybeSingle();
  const sourceUrl = source?.url || '';
  try { if (new URL(sourceUrl).protocol !== 'https:') redirect(back('sem-documentos')); } catch { redirect(back('sem-documentos')); }
  const possible = [
    ...(candidate.document_url ? [{ name: 'Aviso oficial', url: candidate.document_url }] : []),
    ...listedDocuments(candidate.document_metadata),
  ];
  const seen = new Set<string>();
  let safe = mainNoticeFirst(possible.flatMap(doc => {
    const url = officialPdfUrl(doc.url, sourceUrl); if (!url || seen.has(url.toString())) return [];
    seen.add(url.toString()); return [{ name: doc.name, url }];
  }),candidate.code||'',candidate.title||'');
  if(!safe.length&&candidate.document_url){
    try{safe=(await discoverPdfLinks(candidate.document_url,sourceUrl,candidate.code||'',candidate.title||'')).slice(0,MAX_FACTSHEET_DOCUMENTS);}catch{redirect(back('documento-indisponivel'));}
  }
  if (!safe.length) redirect(back('sem-documentos'));
  stage('documentos localizados', candidateId);
  let files: Awaited<ReturnType<typeof fetchPdf>>[];
  try { files = await Promise.all(safe.map(({url}) => fetchPdf(url))); }
  catch (error) { redirect(back(error instanceof Error && error.message === 'documento_demasiado_grande' ? 'documento-grande' : error instanceof Error && error.message === 'documento_invalido' ? 'documento-invalido' : 'documento-indisponivel')); }
  stage('documentos descarregados', candidateId);
  if (files.reduce((total, file) => total + file.bytes.byteLength, 0) > 24 * 1024 * 1024) redirect(back('documento-grande'));

  const { data: old } = await admin.from('candidate_factsheets').select('id,status,updated_at,error_code').eq('candidate_id', candidateId).eq('content_hash', candidate.current_hash).maybeSingle();
  if (old?.status === 'done') { revalidatePath('/'); redirect(back('existente')); }
  if (old?.status === 'failed' && old.error_code === 'documento-ilegivel') redirect(back('documento-ilegivel'));
  if (old?.status === 'running' && Date.now() - Date.parse(old.updated_at) < 10 * 60_000) redirect(back('em-curso'));
  let jobId = old?.id;
  if (old) {
    const { data: claimed, error } = await admin.from('candidate_factsheets').update({ scan_id: scanId, requested_by: user.id, status: 'running', content: null, model: null, input_tokens: null, output_tokens: null, estimated_cost_usd: null, error_code: null, updated_at: new Date().toISOString() }).eq('id', old.id).eq('status', old.status).eq('updated_at',old.updated_at).select('id').maybeSingle();
    if (error) redirect(back('erro'));
    if (!claimed) redirect(back('em-curso'));
  } else {
    const { data: job, error } = await admin.from('candidate_factsheets').insert({ candidate_id: candidateId, content_hash: candidate.current_hash, scan_id: scanId, requested_by: user.id, status: 'running' }).select('id').single();
    if (error || !job) redirect(back('em-curso')); jobId = job.id;
  }
  if (!jobId) redirect(back('erro'));
  let generationError: 'openai' | 'geracao' | 'documento-ilegivel' | null = null;
  let usage: {inputTokens:number;outputTokens:number;estimatedCostUsd:number}|null = null;
  try {
    stage('pedido enviado à OpenAI', candidateId);
    const result = await generateCandidateFactsheet(apiKey, files);
    stage('resposta recebida da OpenAI', candidateId);
    usage = {inputTokens:result.inputTokens,outputTokens:result.outputTokens,estimatedCostUsd:result.estimatedCostUsd};
    if (result.unreadable) generationError = 'documento-ilegivel';
    const { error } = await admin.from('candidate_factsheets').update({ status: generationError ? 'failed' : 'done', content: result.unreadable ? { document_issue: result.reason } : result.content, model: FACTSHEET_MODEL, input_tokens: result.inputTokens, output_tokens: result.outputTokens, estimated_cost_usd: result.estimatedCostUsd, error_code: generationError, updated_at: new Date().toISOString() }).eq('id', jobId).eq('status','running');
    if (error) throw new Error('registo_falhou');
    revalidatePath('/');
  } catch (error) {
    generationError = error instanceof Error && error.message === 'A chamada à OpenAI falhou. Confirme a chave e o acesso ao modelo.' ? 'openai' : 'geracao';
    await admin.from('candidate_factsheets').update({ status: 'failed', error_code: generationError, model:usage?FACTSHEET_MODEL:null, input_tokens:usage?.inputTokens??null, output_tokens:usage?.outputTokens??null, estimated_cost_usd:usage?.estimatedCostUsd??null, updated_at: new Date().toISOString() }).eq('id', jobId).eq('status','running');
  }
  redirect(back(generationError === 'documento-ilegivel' ? 'documento-ilegivel' : generationError ? `erro-${generationError}` : 'gerada'));
}
