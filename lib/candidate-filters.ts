import type { CandidateFactsheet } from './candidate-factsheet';

export const searchWindows = [
  { value: 'todos-abertos', label: 'Todos os avisos abertos' },
  { value: 'abertos-7-dias', label: 'Abertos nos últimos 7 dias' },
  { value: 'abertos-14-dias', label: 'Abertos nos últimos 14 dias' },
  { value: 'abertos-4-dias', label: 'Abertos nos últimos 4 dias' },
] as const;

export const regionFilters = [
  ['todas', 'Todas as regiões'], ['norte', 'Norte'], ['centro', 'Centro'], ['lisboa', 'Lisboa'],
  ['alentejo', 'Alentejo'], ['algarve', 'Algarve'], ['acores', 'Açores'], ['madeira', 'Madeira'],
  ['portugal', 'Portugal — âmbito nacional'], ['europa', 'União Europeia / multirregião'], ['indeterminada', 'Região não identificada'],
] as const;

export const entityFilters = [
  ['todas', 'Todos os tipos'], ['empresas', 'Empresas'], ['entidades-publicas', 'Entidades públicas'],
  ['associacoes', 'Associações e entidades sem fins lucrativos'], ['ensino-investigacao', 'Ensino e investigação'],
  ['pessoas-singulares', 'Pessoas singulares'], ['outras-entidades', 'Outras entidades'], ['por-identificar', 'Ainda não identificado'],
] as const;

export type EntityType = (typeof entityFilters)[number][0];
export type RegionType = (typeof regionFilters)[number][0];

export function entityTypeLabel(value: string): string {
  return entityFilters.find(([key]) => key === value)?.[1] || value;
}

export function lisbonDateOffset(daysBack: number, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const year = Number(parts.find(part => part.type === 'year')?.value), month = Number(parts.find(part => part.type === 'month')?.value), day = Number(parts.find(part => part.type === 'day')?.value);
  const date = new Date(Date.UTC(year, month - 1, day - daysBack));
  return date.toISOString().slice(0, 10);
}

export function openingDateCutoff(window: string, now = new Date()): string | null {
  if (window === 'abertos-7-dias') return lisbonDateOffset(6, now);
  if (window === 'abertos-14-dias') return lisbonDateOffset(13, now);
  if (window === 'abertos-4-dias') return lisbonDateOffset(3, now);
  return null;
}

export function candidateRegion(region: string | null, programs: unknown, sourceName: string): RegionType {
  const programNames = Array.isArray(programs) ? programs.filter((value): value is string => typeof value === 'string') : [];
  const text = [region || '', ...programNames, sourceName].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  for (const name of ['norte', 'centro', 'lisboa', 'alentejo', 'algarve', 'acores', 'madeira'] as const) if (text.includes(name)) return name;
  if (/europa|europe|interreg|horizonte|digital europe|life|erasmus|cerv|innovation fund|eic|fundo europeu|multipa[ií]s/.test(text)) return 'europa';
  if (/portugal|continente|nacional/.test(text)) return 'portugal';
  return 'indeterminada';
}

export function beneficiaryTypes(factsheet: unknown): EntityType[] {
  if (!factsheet || typeof factsheet !== 'object') return [];
  const content = factsheet as CandidateFactsheet & { beneficiary_types?: unknown };
  if (Array.isArray(content.beneficiary_types)) {
    return [...new Set(content.beneficiary_types.filter((value): value is EntityType => typeof value === 'string' && entityFilters.some(([key]) => key === value) && value !== 'todas' && value !== 'por-identificar'))];
  }
  const text = content.sections?.beneficiaries?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() || '';
  if (!text || /informacao nao identificada|ainda nao analisado/.test(text)) return [];
  const types: EntityType[] = [];
  if (/\b(empresas?|pme|microempresas?|startups?)\b/.test(text)) types.push('empresas');
  if (/\b(entidades? publicas?|municipios?|camaras municipais|organismos? publicos?|administracao publica)\b/.test(text)) types.push('entidades-publicas');
  if (/\b(associacoes?|fundacoes?|sem fins lucrativos|ong|cooperativas?)\b/.test(text)) types.push('associacoes');
  if (/\b(enesii|universidades?|instituicoes? de ensino|centros? de investigacao|entidades? do sistema cientifico)\b/.test(text)) types.push('ensino-investigacao');
  if (/\b(pessoas? singulares|trabalhadores?|desempregados?|jovens|pescadores?)\b/.test(text)) types.push('pessoas-singulares');
  if (!types.length && text.length > 25) types.push('outras-entidades');
  return types;
}

export function matchesEntityFilter(factsheet: unknown, filter: string): boolean {
  if (filter === 'todas') return true;
  const types = beneficiaryTypes(factsheet);
  if (filter === 'por-identificar') return types.length === 0;
  return types.includes(filter as EntityType);
}
