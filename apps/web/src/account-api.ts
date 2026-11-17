export interface User {id:string;email:string;role:string;tier:string;}
export async function accountRequest(path:string,body?:object):Promise<User|null>{
 const response=await fetch(`/api/auth/${path}`,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json','X-PharmaFlow-Request':'1'}:{},body:body?JSON.stringify(body):undefined});
 if(path==='me'&&response.status===401)return null;
 if(response.status===204)return null;
 const data=await response.json();
 if(!response.ok)throw Error(typeof data.message==='string'?data.message:'Перевірте email і пароль. Пароль має містити щонайменше 12 символів.');
 return data as User;
}
