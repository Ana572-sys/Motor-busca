const s=await(await fetch('https://recuperarportugal.gov.pt/wp-content/themes/astra/assets/js/app.js?v2.1')).text();for(const m of s.matchAll(/action\s*[:=]\s*["'`]([^"'`]+)["'`]/g))console.log(m[1],s.slice(Math.max(0,m.index-250),m.index+500).replace(/\s+/g,' '));
for(const m of s.matchAll(/(?:fetch\(|\.ajax\(|XMLHttpRequest|FormData\(|\.append\(["']action|action=)/g))console.log('MATCH',s.slice(Math.max(0,m.index-220),m.index+600).replace(/\s+/g,' '));
for(const m of s.matchAll(/searchRequest\(/g))console.log('CALL',s.slice(Math.max(0,m.index-1800),m.index+800));
const k=s.indexOf('getSearchParams:');console.log('PARAMS',s.slice(k,k+5000));
for(const term of ['id="prr-concurso-avisos"','id="prr-concurso"','id="beneficiario"','class="options"']){const i=s.indexOf(term);console.log('WIDGET',term,s.slice(i,i+3500));}
