import {timingSafeEqual} from 'node:crypto';
export function validWorkerToken(secret:string|undefined,authorization:string|null):boolean{
 if(!secret||secret.length<32||!authorization)return false;
 const expected=Buffer.from(`Bearer ${secret}`),provided=Buffer.from(authorization);
 return expected.length===provided.length&&timingSafeEqual(expected,provided);
}
