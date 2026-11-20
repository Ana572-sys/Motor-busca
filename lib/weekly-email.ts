export type WeeklyItem={title:string;id:string;summary:string;url?:string|null};
export type WeeklyReport={date:string;period:string;coverageComplete:boolean;newCount:number;changedCount:number;extensions:number;republications:number|null;ending:string[];unavailable:string[];items:WeeklyItem[]};
export function renderWeeklyReport(report:WeeklyReport,baseUrl:string):string{
 const base=new URL(baseUrl);if(base.protocol!=='https:'||base.username||base.password)throw new Error('O endereço da aplicação deve usar HTTPS.');
 const lines=['Radar G&I — resumo semanal',`Data da pesquisa: ${report.date}`,`Período analisado: ${report.period}`,'',`Novos avisos: ${report.newCount}`,`Alterações identificadas: ${report.changedCount}`,`Prorrogações identificadas: ${report.extensions}`,`Republicações: ${report.republications===null?'Não identificável de forma consistente nas fontes atuais.':report.republications}`,'',`Avisos a terminar: ${report.ending.length?report.ending.join('; '):'Nenhum identificado.'}`,`Fontes indisponíveis ou sem conector: ${report.unavailable.length?report.unavailable.join('; '):'Nenhuma identificada.'}`,''];
 if(!report.coverageComplete)lines.push('Pesquisa incompleta: os resultados não representam a totalidade das fontes ativas.','');
 else if(report.newCount===0&&report.changedCount===0&&report.extensions===0)lines.push('Não foram identificados novos avisos ou alterações relevantes no período analisado.','');
 for(const item of report.items){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id))throw new Error('Identificador de aviso inválido.');const target=item.url?new URL(item.url,base):new URL('/',base);if(target.protocol!=='https:'||target.username||target.password)throw new Error('Ligação de aviso inválida.');lines.push(item.title,item.summary,target.toString(),'');}
 return lines.join('\n');
}
