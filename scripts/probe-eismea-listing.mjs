import {fetchEismea} from '../lib/eismea-listing.ts';
const rows=await fetchEismea();
console.log(JSON.stringify(rows.map(x=>({title:x.title,startsAt:x.startsAt,endsAt:x.endsAt}))));
