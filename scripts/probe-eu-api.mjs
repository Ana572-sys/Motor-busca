const url='https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***';
const form=new FormData();
form.append('query',new Blob([JSON.stringify({bool:{must:[{terms:{type:['1']}},{terms:{status:['31094502']}},{terms:{language:['en']}}]}})],{type:'application/json'}),'query.json');
form.append('pageSize',process.argv[3]||'10');form.append('pageNumber',process.argv[2]||'1');
const response=await fetch(url,{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(20000)});
if(!response.ok)throw new Error(`HTTP ${response.status}`);
const raw=await response.text(),body=JSON.parse(raw);
console.log(JSON.stringify({bytes:Buffer.byteLength(raw),total:body.totalResults,page:body.pageNumber,size:body.pageSize,rows:body.results?.length,unique:new Set(body.results?.map(x=>x.reference)).size},null,2));
