import test from 'node:test';
import assert from 'node:assert/strict';
import {addGroundingErrors,relatedOfficialPage,validateResult} from '../lib/radar-document-analysis.ts';

const pages=[
 {page:1,document_id:'doc-a',text:'O aviso apoia micro e pequenas empresas na Região Norte. São elegíveis equipamentos produtivos. A candidatura deve ser apresentada em parceria.'},
 {page:2,document_id:'doc-b',text:'Investimento mínimo de 150.000 euros. A candidatura decorre até 31/12/2026.'},
];

test('aceita apenas valores apoiados por citações literais da página e do documento',()=>{
 const result=validateResult({
  fields:{summary:'Apoio à aquisição de equipamentos produtivos.',beneficiaries:['micro e pequenas empresas'],regions:['Região Norte'],deadline:'2026-12-31',opening_date:'2026-01-01',investment_minimum:50_000},
  citations:[
   {field:'summary',page:1,document_id:'doc-a',quote:'São elegíveis equipamentos produtivos.'},
   {field:'beneficiaries',page:1,document_id:'doc-a',quote:'micro e pequenas empresas'},
   {field:'regions',page:1,document_id:'doc-a',quote:'Região Norte'},
   {field:'deadline',page:2,document_id:'doc-b',quote:'até 31/12/2026'},
   {field:'opening_date',page:2,document_id:'doc-b',quote:'A candidatura decorre até 31/12/2026.'},
   {field:'investment_minimum',page:2,document_id:'doc-b',quote:'Investimento mínimo de 150.000 euros.'},
  ],confidence:0.9,
 },pages);
 assert.deepEqual(result.facts.regions,['Região Norte']);
 assert.equal(result.facts.deadline,'2026-12-31');
 assert.equal(result.facts.investment_minimum,null);
 assert.equal(result.facts.opening_date,null);
 assert.ok(result.errors.includes('investment_minimum'));
 assert.ok(result.errors.includes('opening_date'));
 assert.ok(!result.errors.includes('regions'));
});

test('recusa citação inventada, página errada e documento não fornecido',()=>{
 const result=validateResult({
  fields:{summary:'Apoio de 80%.',beneficiaries:['grandes empresas'],regions:['Algarve']},
  citations:[
   {field:'summary',page:1,document_id:'doc-a',quote:'Apoio de 80%.'},
   {field:'beneficiaries',page:1,document_id:'doc-b',quote:'micro e pequenas empresas'},
   {field:'regions',page:9,document_id:'doc-a',quote:'Região Norte'},
  ],confidence:0.9,
 },pages);
 assert.equal(result.facts.summary,'Não identificável no aviso');
 assert.deepEqual(result.facts.beneficiaries,[]);
 assert.deepEqual(result.facts.regions,[]);
 assert.deepEqual([...result.errors].sort(),['beneficiaries','regions','summary']);
});

test('marca como insuficiente a extração sem factos fundamentados',()=>{
 const result=validateResult({fields:{summary:null,beneficiaries:[],regions:[]},citations:[],confidence:0.2},pages);
 assert.ok(addGroundingErrors(result).includes('insufficient_grounded_facts'));
 assert.equal(result.sourceReferences.length,0);
 assert.equal(result.facts.summary,'Não identificável no aviso');
});

test('limita a descoberta de documentos ao domínio oficial relacionado',()=>{
 assert.equal(relatedOfficialPage('https://programa.portugal2030.pt/aviso','https://portugal2030.pt')?.hostname,'programa.portugal2030.pt');
 assert.equal(relatedOfficialPage('https://portugal2030.pt.evil.example/aviso','https://portugal2030.pt'),null);
 assert.equal(relatedOfficialPage('https://127.0.0.1/aviso','https://portugal2030.pt'),null);
 assert.equal(relatedOfficialPage('http://portugal2030.pt/aviso','https://portugal2030.pt'),null);
});

test('não determina a obrigatoriedade de parceria por uma citação sem relação',()=>{
 const supported=validateResult({fields:{summary:'Apoio empresarial.',partnership_required:true},citations:[
  {field:'summary',page:1,document_id:'doc-a',quote:'O aviso apoia micro e pequenas empresas.'},
  {field:'partnership_required',page:1,document_id:'doc-a',quote:'A candidatura deve ser apresentada em parceria.'},
 ],confidence:0.8},pages);
 assert.equal(supported.facts.partnership_required,true);
 const unsupported=validateResult({fields:{partnership_required:true},citations:[
  {field:'partnership_required',page:1,document_id:'doc-a',quote:'O aviso apoia micro e pequenas empresas.'},
 ],confidence:0.8},pages);
 assert.equal(unsupported.facts.partnership_required,null);
 assert.ok(unsupported.errors.includes('partnership_required'));
});
