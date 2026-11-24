import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAni} from '../lib/ani-listing.ts';

const isoDate=(offset:number)=>{const date=new Date();date.setDate(date.getDate()+offset);return date.toISOString().slice(0,10);};
const ptDate=(date:string)=>{const [year,month,day]=date.split('-');return `${day}/${month}/${year}`;};
const htmlWithDates=(start:string,end:string)=>`<title>Concursos nacionais e internacionais - ANI</title><div class="em-events-list"><div class="em-event em-item"><h3 class="em-item-title"><a href="https://ani.pt/concursos/teste/">Teste</a></h3><div class="em-event-date">${ptDate(start)} - ${ptDate(end)}</div></div></div>`;

test('ANI interpreta o período do concurso e valida a ligação oficial',()=>{
 const open=parseAni(htmlWithDates(isoDate(-1),isoDate(1)));
 assert.equal(open[0].endsAt,isoDate(1));
 assert.equal(open[0].sourceState,'aberto');
 assert.equal(parseAni(htmlWithDates(isoDate(-5),isoDate(-1)))[0].sourceState,'encerrado');
 assert.throws(()=>parseAni(htmlWithDates(isoDate(-1),isoDate(1)).replace('https://ani.pt/concursos/teste/','https://exemplo.pt/concursos/teste/')));
});
