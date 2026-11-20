import {test} from 'node:test';import assert from 'node:assert/strict';import {lisbonSchedule} from '../lib/schedule.ts';
test('o horário acompanha a hora de verão e de inverno de Lisboa',()=>{
 assert.equal(lisbonSchedule(new Date('2026-01-05T08:30:00Z')).shouldStart,true);
 assert.equal(lisbonSchedule(new Date('2026-07-06T07:30:00Z')).shouldStart,true);
 assert.equal(lisbonSchedule(new Date('2026-07-06T08:30:00Z')).shouldStart,false);
 assert.equal(lisbonSchedule(new Date('2026-01-06T08:30:00Z')).shouldStart,false);
});
