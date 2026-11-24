import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalogNoticeId,sourceNoticeState} from '../lib/radar-catalog-sync.ts';

test('estado oficial claro prevalece sobre a data de fecho',()=>{
 assert.equal(sourceNoticeState('aberto','2026-01-01','2026-11-24'),'open');
 assert.equal(sourceNoticeState('encerrado','2027-01-01','2026-11-24'),'closed');
 assert.equal(sourceNoticeState(undefined,'2026-11-23','2026-11-24'),'closed');
 assert.equal(sourceNoticeState(undefined,null,'2026-11-24'),'unconfirmed');
});

test('novos registos recebem UUID e os existentes mantêm o identificador',()=>{
 assert.equal(catalogNoticeId('existing-id'),'existing-id');
 assert.match(catalogNoticeId(null),/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});
