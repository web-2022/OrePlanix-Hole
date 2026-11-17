export class Laboratory {
 constructor(config,request=(...args)=>globalThis.fetch(...args)){
  const local=config?.api==='http://127.0.0.1:54321';const hosted=config?.environment==='hosted'&&config.api==='https://pflplvqyigrxknkvfmwr.supabase.co';
  if((!local&&!hosted)||!config.anon)throw Error('Configuración de conexión autorizada requerida');
  this.config=config;this.request=request;this.token=null;
 }
 async call(path,{method='GET',body}={}){
  const response=await this.request(this.config.api+path,{method,headers:{apikey:this.config.anon,...(this.token?{Authorization:'Bearer '+this.token}:{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok){if(response.status===401)this.token=null;throw Error(`Operación rechazada (${response.status}). Revisa sesión, permisos y datos.`);}
  return response.status===204?null:response.json();
 }
 async login(email,password){this.token=null;const result=await this.call('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});if(!result.access_token)throw Error('Sesión no disponible');this.token=result.access_token;}
 async logout(){try{if(this.token)await this.call('/auth/v1/logout',{method:'POST'});}finally{this.token=null;}}
 async campaigns(){this.session();return this.call('/rest/v1/planning_campaigns?select=id,project_id,name&order=id&limit=1000');}
 session(){if(!this.token)throw Error('Inicia sesión');}
 async load(campaign){
  this.session();const id=encodeURIComponent(campaign.id);
  const versions=await this.call(`/rest/v1/planning_versions?campaign_id=eq.${id}&select=version,targets&order=version.desc&limit=1`);
  if(!versions.length)throw Error('La campaña no tiene versión aprobada');
  const targets=versions[0].targets;
  if(!Array.isArray(targets)||targets.some(t=>t.period_start!==t.period_end))throw Error('Esta vista requiere metas por día. No distribuye períodos automáticamente.');
  const plan=targets.map(t=>({ProjectID:String(campaign.project_id),CampaignID:String(campaign.id),HoleID:t.hole_id,Discipline:t.discipline,Date:t.period_start,PlannedM:String(t.meters)}));
  const daily=[];for(let offset=0;;offset+=500){const page=await this.call(`/rest/v1/operational_daily?campaign_id=eq.${id}&select=original&order=line_id&limit=500&offset=${offset}`);daily.push(...page.map(r=>r.original));if(page.length<500)break;if(daily.length>=50000)throw Error('Historial demasiado grande para esta vista');}
  return {plan,daily,version:versions[0].version};
 }
 async save(campaign,rows){this.session();if(!Array.isArray(rows)||!rows.length||rows.length>1000)throw Error('Envía entre 1 y 1000 filas');return this.call('/rest/v1/rpc/operational_save_daily',{method:'POST',body:{p_campaign:campaign.id,p_rows:rows}});}
}
