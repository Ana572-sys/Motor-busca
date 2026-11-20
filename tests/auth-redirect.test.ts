import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeAuthRedirect} from '../lib/auth-redirect.ts';
test('o regresso da autenticação não permite encaminhamento externo',()=>{
 assert.equal(safeAuthRedirect('/repor-palavra-passe'),'/repor-palavra-passe');
 for(const value of ['//example.org','/\\example.org','https://example.org','/other',null])assert.equal(safeAuthRedirect(value),'/');
});
