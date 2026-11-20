import * as cheerio from 'cheerio';
for(const url of ['https://sustentavel2030.gov.pt/avisos/','https://mar2030.pt/avisos/']){
 const r=await fetch(url,{signal:AbortSignal.timeout(25000)}),html=await r.text(),$=cheerio.load(html);
 console.log('\n',url,r.status,'title',$('title').text());
 console.log('scripts', $('script[src]').map((i,e)=>$(e).attr('src')).get().slice(-20));
 console.log('frames', $('iframe').map((i,e)=>$(e).attr('src')).get());
 console.log('forms', $('form').map((i,e)=>({action:$(e).attr('action'),html:$.html(e).slice(0,1800)})).get().slice(0,4));
 console.log('links', $('a[href]').map((i,e)=>({text:$(e).text().trim().replace(/\s+/g,' ').slice(0,120),url:$(e).attr('href')})).get().filter(x=>/aviso|concurso|pagina|page/i.test(x.text+' '+x.url)).slice(0,35));
 console.log('text', $('body').text().replace(/\s+/g,' ').slice(0,3500));
 if(url.includes('sustentavel')){let el=$('*').filter((i,e)=>$(e).children().length===0&&$(e).text().includes('PACS-2026-29')).first().closest('.avisos-thumbnail');console.log('NOTICE', $.html(el).slice(0,10000));console.log('COUNT', $('.avisos-thumbnail').length);console.log('pagination', $('[class*=pagination]').map((i,e)=>$.html(e).slice(0,1200)).get().slice(0,5));}
 else {const js=await (await fetch('https://mar2030.pt/assets/index.6d82b0ca.js')).text();for(const term of ['backoffice.mar2030.pt','/api/avisos','avisos?','aviso']) {const pos=js.indexOf(term);console.log('JS',term,pos,js.slice(Math.max(0,pos-500),pos+1300));}}
}
