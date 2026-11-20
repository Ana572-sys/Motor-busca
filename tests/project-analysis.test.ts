import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateProjectNotice} from '../lib/project-analysis.ts';

const project={
 description:'Implementação de software de gestão para uma empresa industrial.',
 entity_type:'pequena-empresa',country:'Portugal',region:'norte',sector:'Indústria transformadora',
 application_mode:'individual',total_investment:200000,cost_items:[],needs_rd:false,
};

test('exclui avisos regionais de outra região antes de calcular compatibilidade',()=>{
 const notice={title:'Apoio regional',program:'Programa Regional do Algarve 2030',eligible_regions:['Algarve'],beneficiaries:['PME'],eligible_sectors:['Indústria transformadora'],eligible_caes:[],eligible_expenses:[],ineligible_expenses:[],investment_minimum:null,investment_maximum:null,partnership_required:false,rd_requirement:'not_supported'};
 const result=evaluateProjectNotice(project,notice);
 assert.equal(result.assessment,'excluded');
 assert.equal(result.gates.region.status,'not_met');
});

test('não exclui projeto do Norte num aviso com âmbito nacional',()=>{
 const notice={title:'Apoio nacional',program:'Portugal 2030',eligible_regions:['Todo o território nacional'],beneficiaries:['PME'],eligible_sectors:['Indústria transformadora'],eligible_caes:[],eligible_expenses:[],ineligible_expenses:[],investment_minimum:null,investment_maximum:null,partnership_required:false,rd_requirement:'not_supported'};
 const result=evaluateProjectNotice(project,notice);
 assert.equal(result.gates.region.status,'met');
 assert.notEqual(result.assessment,'excluded');
});
