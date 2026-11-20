/** Authentication callbacks may only redirect to known application pages. */
export function safeAuthRedirect(value:string|null):string{
 return value==='/repor-palavra-passe'?value:'/';
}
