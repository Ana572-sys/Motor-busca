import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareFacts,isExtension,mayShowOnDashboard,canReuseFactsheet,type Evidence} from '../lib/domain.ts';
const evidence=(value:string):Evidence=>({value,sourceUrl:'https://example.org/aviso'});
test('só apresenta avisos abertos com participação expressa',()=>{
 assert.equal(mayShowOnDashboard('open','portugal_explicit'),true);
 assert.equal(mayShowOnDashboard('open','multiple_countries_explicit'),true);
 assert.equal(mayShowOnDashboard('open','not_explicit'),false);
 assert.equal(mayShowOnDashboard('closed','portugal_explicit'),false);
 assert.equal(mayShowOnDashboard('unconfirmed','portugal_explicit'),false);
});
test('compara valores suportados e não inventa remoção quando a extração falha',()=>{
 const changes=compareFacts({deadline:evidence('2026-11-01'),budget:evidence('100')},{deadline:evidence('2026-12-01')});
 assert.deepEqual(changes.map(c=>c.field),['deadline']);assert.equal(isExtension(changes),true);
});
test('não identifica prorrogação com data ambígua, inválida ou anterior',()=>{
 for(const date of ['01/12/2026','2026-02-30','2026-10-31']) assert.equal(isExtension(compareFacts({deadline:evidence('2026-11-01')},{deadline:evidence(date)})),false);
});
test('só reutiliza ficha da versão atual',()=>{assert.equal(canReuseFactsheet('v1','v1'),true);assert.equal(canReuseFactsheet('v1','v2'),false);assert.equal(canReuseFactsheet('',''),false);});
