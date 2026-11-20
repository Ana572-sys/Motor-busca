export type GraphConfig={tenantId:string;clientId:string;clientSecret:string;sender:string};
export type GraphResult={accepted:true};
/** 202 means Graph accepted the request; it is not confirmation of delivery. */
export async function sendGraphMail(config:GraphConfig,to:string[],subject:string,body:string,fetcher:typeof fetch=fetch):Promise<GraphResult>{
 if(!/^[a-z0-9.-]+$/i.test(config.tenantId)||!config.clientId||!config.clientSecret||!/^\S+@\S+$/.test(config.sender)||!to.length||to.some(x=>!/^\S+@\S+$/.test(x)))throw new Error('Configuração de e-mail inválida.');
 const token=await fetcher(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'}),signal:AbortSignal.timeout(15000)});
 if(!token.ok)throw new Error(`Autenticação Microsoft falhou (HTTP ${token.status}).`);
 const data:unknown=await token.json();if(!data||typeof data!=='object'||!('access_token' in data)||typeof data.access_token!=='string')throw new Error('Resposta de autenticação Microsoft inválida.');
 const result=await fetcher(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.sender)}/sendMail`,{method:'POST',headers:{Authorization:`Bearer ${data.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({message:{subject,body:{contentType:'Text',content:body},toRecipients:to.map(address=>({emailAddress:{address}}))},saveToSentItems:true}),signal:AbortSignal.timeout(15000)});
 if(result.status!==202)throw new Error(`O Microsoft Graph não aceitou a mensagem (HTTP ${result.status}).`);
 return {accepted:true};
}
