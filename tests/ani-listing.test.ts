import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAni} from '../lib/ani-listing.ts';
test('ANI lê a lista de concursos, com datas e endereço oficial',()=>{let html='<title>Concursos nacionais e internacionais - ANI</title><div class="em-events-list"><div class="em-event em-item"><h3 class="em-item-title"><a href="https://ani.pt/concursos/teste/">Teste</a></h3><div class="em-event-date">01/02/2026 - 20/03/2026</div></div></div>';let rows=parseAni(html);assert.equal(rows[0].endsAt,'2026-03-20');assert.equal(rows[0].sourceState,'por validar');assert.throws(()=>parseAni(html.replace('https://ani.pt/concursos/teste/','https://exemplo.pt/concursos/teste/')));});
