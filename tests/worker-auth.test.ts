import {test} from 'node:test';import assert from 'node:assert/strict';
import {validWorkerToken} from '../lib/worker-auth.ts';
test('o processador só aceita a chave completa de servidor',()=>{
 const secret='a'.repeat(32);
 assert.equal(validWorkerToken(secret,`Bearer ${secret}`),true);
 for(const value of [null,'',secret,`Bearer ${'b'.repeat(32)}`,`Bearer ${secret}x`])assert.equal(validWorkerToken(secret,value),false);
 assert.equal(validWorkerToken('curta','Bearer curta'),false);
 assert.equal(validWorkerToken(undefined,'Bearer test'),false);
});
