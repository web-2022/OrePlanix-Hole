import {validateDaily,validateResult,compareProgress} from './core.mjs';
export const required={plan:['ProjectID','CampaignID','HoleID','Discipline','Date','PlannedM'],daily:['ReportLineID','ProjectID','CampaignID','HoleID','Discipline','RigID','ReportDate','Shift','Activity','FromM','ToM'],results:['ResultID','ProjectID','CampaignID','HoleID','SampleID','Discipline','FromM','ToM','Parameter','Value','Unit','Method','Laboratory']};
export function parseCSV(text,kind){
 if(!required[kind])throw Error('Tipo de archivo desconocido');
 return parseTable(text,required[kind]);
}
export function parseTable(text,columns){
 const grid=[];let row=[],field='',quoted=false,closed=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;}
  else if(c==='"'){if(field||closed)throw Error('Comillas mal formadas');quoted=true;}
  else if(c===','||c==='\n'||c==='\r'){row.push(field);field='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v!==''))grid.push(row);row=[];}}
  else{if(closed)throw Error('Texto después de cerrar comillas');field+=c;}
 }
 if(quoted)throw Error('Comillas sin cerrar');
 row.push(field);if(row.some(v=>v!==''))grid.push(row);
 if(!grid.length)throw Error('Archivo vacío');
 const headers=grid.shift().map(v=>v.trim());
 if(new Set(headers).size!==headers.length||headers.some(v=>!v))throw Error('Encabezados vacíos o repetidos');
 for(const name of columns)if(!headers.includes(name))throw Error(`Falta columna ${name}`);
 return grid.map((cells,i)=>{if(cells.length!==headers.length)throw Error(`Fila ${i+2}: cantidad de columnas incorrecta`);return Object.fromEntries(headers.map((h,j)=>[h,cells[j].trim()]));});
}
export const scopeKey=r=>JSON.stringify([r.ProjectID,r.CampaignID,r.Discipline]);
const holeKey=r=>JSON.stringify([r.ProjectID,r.CampaignID,r.Discipline,r.HoleID]);
export function validatePlan(rows){
 const ids=new Set();return rows.map(original=>{
 const issues=[];for(const key of required.plan)if(!String(original[key]??'').trim())issues.push(`Falta ${key}`);
 const d=original.Date;const parsed=new Date(d);if(!/^\d{4}-\d{2}-\d{2}$/.test(d||'')||!Number.isFinite(+parsed)||parsed.toISOString().slice(0,10)!==d)issues.push('Fecha inválida');
 if(!['GEOLOGIA','GEOMECANICA','HIDROGEOLOGIA'].includes(original.Discipline))issues.push('Disciplina inválida');
 if(!/^\d+(\.\d{1,3})?$/.test(String(original.PlannedM))||Number(original.PlannedM)<=0)issues.push('Meta debe ser positiva, hasta tres decimales');
 const id=holeKey(original)+'|'+d;if(ids.has(id))issues.push('Meta duplicada para sondaje y fecha');ids.add(id);
 return {original,issues,status:issues.length?'REJECTED':'VALID'};
 });
}
export function inspect(plan,daily,results,scope){
 const p=validatePlan(plan);const approved=p.filter(r=>r.status==='VALID').map(r=>r.original);
 const holes=new Set(approved.map(holeKey));
 const d=validateDaily(daily).map(r=>{if(!holes.has(holeKey(r.original)))return {...r,status:'REJECTED',netM:0,issues:[...r.issues,'NO_PLAN']};return r;});
 const seen=new Set();const r=results.map(row=>{
 const result=validateResult(row);const id=JSON.stringify([row.ProjectID,row.CampaignID,row.ResultID]);
 if(seen.has(id)){result.issues.push({code:'DUPLICATE',severity:'ERROR',message:'ResultID repetido'});result.status='REJECTED';}seen.add(id);return result;
 });
 // Validate the complete loaded lot before selecting scope. Invalid rows never contribute.
 const selected=approved.filter(x=>scopeKey(x)===scope);
 const accepted=d.filter(x=>x.status==='VALID'&&scopeKey(x.original)===scope).map(x=>x.original);
 const invalidPlan=p.some(r=>r.status!=='VALID'&&scopeKey(r.original)===scope);
 const series=invalidPlan?[]:compareProgress(selected,accepted);
 return {plan:p,daily:d,results:r,series};
}
