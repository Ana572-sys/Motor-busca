export const projectEntityTypes=[
 {value:'microempresa',label:'Microempresa'},{value:'pequena-empresa',label:'Pequena empresa'},{value:'media-empresa',label:'Média empresa'},{value:'grande-empresa',label:'Grande empresa'},{value:'startup',label:'Startup'},{value:'universidade',label:'Universidade'},{value:'centro-investigacao',label:'Centro de investigação'},{value:'associacao',label:'Associação'},{value:'municipio',label:'Município'},{value:'outra',label:'Outra'},
] as const;
export const projectRegions=[
 {value:'norte',label:'Norte'},{value:'centro',label:'Centro'},{value:'lisboa',label:'Lisboa'},{value:'alentejo',label:'Alentejo'},{value:'algarve',label:'Algarve'},{value:'acores',label:'Açores'},{value:'madeira',label:'Madeira'},{value:'varias',label:'Várias regiões'},{value:'fora-portugal',label:'Fora de Portugal'},
] as const;
export const projectApplicationModes=[{value:'individual',label:'Candidatura individual'},{value:'partnership',label:'Em parceria'},{value:'either',label:'Individual ou parceria'}] as const;
export const projectCostCategories=[
 {value:'resources-humanos',label:'Recursos humanos'},{value:'equipamentos',label:'Equipamentos'},{value:'software',label:'Software e licenças'},{value:'servicos-id',label:'Serviços de I&D'},{value:'consultoria',label:'Consultoria especializada'},{value:'construcao',label:'Construção ou adaptação de instalações'},{value:'formacao',label:'Formação'},{value:'marketing',label:'Marketing e internacionalização'},{value:'energia',label:'Eficiência energética'},{value:'propriedade-intelectual',label:'Patentes e propriedade intelectual'},{value:'ensaios-certificacao',label:'Ensaios, certificação e validação'},{value:'outros',label:'Outros custos'},
] as const;
export type ProjectCostCategory=typeof projectCostCategories[number]['value'];
