import {Laboratory} from './persistence.mjs';
export function connectLaboratory({getDaily,replace}){
 const $=id=>document.getElementById(id);let lab,campaigns=[];const say=text=>$('connection-message').textContent=text;
 try{lab=new Laboratory(window.LOCAL_CONFIG);}catch{say('Conexión no configurada. Las cargas en memoria siguen disponibles.');$('login').disabled=true;return;}
 $('login').onclick=()=>run(async()=>{try{campaigns=[];$('campaign').replaceChildren();replace({plan:[],daily:[]});await lab.login($('email').value,$('password').value);campaigns=await lab.campaigns();$('campaign').replaceChildren();for(const c of campaigns){const o=document.createElement('option');o.value=String(c.id);o.textContent=`${c.project_id} / ${c.name}`;$('campaign').append(o);}say('Sesión activa. Selecciona y recupera una campaña.');}catch(e){say(e.message);}finally{$('password').value='';}});
 const selected=()=>{const c=campaigns.find(c=>String(c.id)===$('campaign').value);if(!c)throw Error('Selecciona una campaña');return c;};
 let busy=false;const run=async fn=>{if(busy)return;busy=true;say('Procesando…');try{await fn();}catch(e){say(e.message);}finally{busy=false;}};
 $('recover').onclick=()=>run(async()=>{const r=await lab.load(selected());replace(r);say(`Campaña recuperada: versión ${r.version}, ${r.daily.length} partes. Datos técnicos anteriores retirados de la vista.`);});
 $('persist').onclick=()=>run(async()=>{const c=selected();const rows=getDaily();const r=await lab.save(c,rows);say(`Guardado: ${r.saved} nuevos, ${r.reused} reenvíos sin cambios. Recupera la campaña para comprobar el historial.`);});
 $('logout').onclick=()=>run(async()=>{try{await lab.logout();}finally{campaigns=[];$('campaign').replaceChildren();replace({plan:[],daily:[]});say('Sesión cerrada y vista vaciada.');}});
}
