const regionPatterns: Array<[string, RegExp]> = [
  ['norte', /\bnorte\b/],
  ['centro', /\bcentro\b/],
  ['lisboa', /\blisboa\b|\bvale do tejo\b/],
  ['alentejo', /\balentejo\b/],
  ['algarve', /\balgarve\b/],
  ['acores', /\bacores\b/],
  ['madeira', /\bmadeira\b/],
];

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function textOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').map(normalize);
  return typeof value === 'string' ? [normalize(value)] : [];
}

function regionsIn(value: string): string[] {
  return regionPatterns.filter(([, pattern]) => pattern.test(value)).map(([region]) => region);
}

function explicitRegionalProgramRegions(programs: unknown): string[] {
  const regions = new Set<string>();
  for (const program of textOf(programs)) {
    const isRegionalProgramme = /programa\s+(?:regional|operacional\s+regional)|\b(?:norte|centro|lisboa|alentejo|algarve|acores|madeira)\s*2030\b|\bregional\s+(?:do|de|da|dos|das)\b/.test(program);
    if (isRegionalProgramme) for (const region of regionsIn(program)) regions.add(region);
  }
  return [...regions];
}

/** Returns true only when the notice has an explicit territorial scope that excludes the project region. */
export function projectRegionMismatch(projectRegion: string, noticeRegion: unknown, programs: unknown): boolean {
  if (projectRegion === 'varias' || projectRegion === 'fora-portugal') return false;
  const programRegions = explicitRegionalProgramRegions(programs);
  const declaredRegions = programRegions.length ? programRegions : textOf(noticeRegion).flatMap(regionsIn);
  return declaredRegions.length > 0 && !declaredRegions.includes(normalize(projectRegion));
}

export function projectNoticeRegionLabel(noticeRegion: unknown, programs: unknown): string {
  const programRegions = explicitRegionalProgramRegions(programs);
  const declaredRegions = programRegions.length ? programRegions : textOf(noticeRegion).flatMap(regionsIn);
  const labels: Record<string, string> = {norte:'Norte',centro:'Centro',lisboa:'Lisboa',alentejo:'Alentejo',algarve:'Algarve',acores:'Açores',madeira:'Madeira'};
  if (declaredRegions.length) return [...new Set(declaredRegions)].map(region => labels[region] || region).join(', ');
  const raw = textOf(noticeRegion)[0];
  return raw ? raw.slice(0, 120) : 'Informação não identificada no aviso.';
}

export function projectRegionMismatchReason(): string {
  return 'O âmbito territorial explícito do aviso não inclui a região do projeto.';
}
