export const RULE_VERSION='2026-11-18.1';
export const rules={
 RQD:{discipline:'GEOMECANICA',unit:'%',min:0,max:100},
 RECOVERY:{discipline:'GEOMECANICA',unit:'%',min:0,max:100},
 UCS:{discipline:'GEOMECANICA',unit:'MPa',min:0},
 PH:{discipline:'HIDROGEOLOGIA',unit:'pH',warningMin:0,warningMax:14},
 EC:{discipline:'HIDROGEOLOGIA',unit:'uS/cm',min:0},
 PERMEABILITY:{discipline:'HIDROGEOLOGIA',unit:'m/s',min:0},
 WATER_LEVEL:{discipline:'HIDROGEOLOGIA',unit:'m',reference:true}
};
const numeric=v=>typeof v!=='boolean'&&v!==null&&v!==undefined&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(v).trim())&&Number.isFinite(Number(v));
const key=r=>JSON.stringify([r.ProjectID,r.CampaignID,r.HoleID,r.Discipline]);
function status(result){result.status=result.issues.some(i=>i.severity==='ERROR')?'REJECTED':result.issues.some(i=>i.severity==='WARNING')?'REVIEW':'VALID';return result;}
export function evaluate(row,context={}){
 const result={original:structuredClone(row),ruleVersion:RULE_VERSION,issues:[],value:null,qualifier:null,status:'VALID'};
 const add=(code,message,severity='ERROR')=>result.issues.push({code,message,severity});
 for(const field of ['ResultID','ProjectID','CampaignID','HoleID','SampleID','Discipline','Parameter','Unit','Method','Laboratory'])if(!String(row[field]??'').trim())add('REQUIRED',`Falta ${field}`);
 if(!['GEOLOGIA','GEOMECANICA','HIDROGEOLOGIA'].includes(row.Discipline))add('DISCIPLINE','Disciplina inválida');
 const type=row.MeasurementType||'INTERVAL';
 if(type==='INTERVAL'){
  if(!numeric(row.FromM)||!numeric(row.ToM)||Number(row.FromM)<0||Number(row.ToM)<=Number(row.FromM))add('INTERVAL','Intervalo inválido');
  if(numeric(context.drilledDepth)&&Number(row.ToM)>Number(context.drilledDepth))add('DEPTH','Intervalo supera profundidad perforada');
 }else if(type==='POINT'){
  if(row.Discipline!=='HIDROGEOLOGIA')add('POINT_DISCIPLINE','Medición puntual requiere Hidrogeología');
  if(!numeric(row.DepthM)||Number(row.DepthM)<0)add('POINT_DEPTH','Profundidad de observación inválida');
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(row.ObservedAt||'')||!Number.isFinite(Date.parse(row.ObservedAt)))add('TIME','Fecha/hora con zona requerida');
  else if(new Date(row.ObservedAt.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==row.ObservedAt.slice(0,10))add('TIME','Fecha imposible');
  if(numeric(context.drilledDepth)&&Number(row.DepthM)>Number(context.drilledDepth))add('DEPTH','Observación supera profundidad perforada');
  if(String(row.FromM??'').trim()||String(row.ToM??'').trim())add('POINT_INTERVAL','Una observación puntual no lleva intervalo');
 }else add('MEASUREMENT_TYPE','Tipo de medición desconocido');
 const rule=rules[row.Parameter]||(row.Discipline==='GEOLOGIA'&&['ppm','ppb','%','g/t','mg/kg'].includes(row.Unit)?{min:0,max:({'%':100,ppm:1e6,ppb:1e9,'g/t':1e6,'mg/kg':1e6})[row.Unit]}:null);
 if(!rule)add('RULE_MISSING','Parámetro/unidad sin regla técnica','WARNING');
 if(rule?.discipline&&rule.discipline!==row.Discipline)add('PARAMETER_DISCIPLINE','Parámetro fuera de disciplina');
 if(rule?.unit&&rule.unit!==row.Unit)add('UNIT','Unidad incompatible');
 if(rule?.reference&&!String(row.Reference??'').trim())add('REFERENCE','Declarar referencia y convención del nivel de agua');
 const match=String(row.Value??'').trim().match(/^(<|>)?\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i);
 if(!match||!Number.isFinite(Number(match[2])))add('VALUE','Valor o código de laboratorio no interpretado');
 else{
  const value=Number(match[2]),q=match[1]||'=';result.value=value;result.qualifier=q;
  if(rule?.min!==undefined&&(value<rule.min||(q==='<'&&value<=rule.min)))add('MIN','Resultado incompatible con límite inferior');
  if(rule?.max!==undefined&&(value>rule.max||(q==='>'&&value>=rule.max)))add('MAX','Resultado incompatible con límite superior');
  if((rule?.warningMin!==undefined&&value<rule.warningMin)||(rule?.warningMax!==undefined&&value>rule.warningMax))add('EXPECTED_RANGE','Fuera del rango habitual: revisión técnica','WARNING');
  if(q!=='=')add('CENSORED','Conservar calificador; no sustituir por cero','INFO');
  const sampleType=row.SampleType||'NORMAL';
  if(!['NORMAL','CRM','BLANK','DUPLICATE'].includes(sampleType))add('SAMPLE_TYPE','Tipo de muestra desconocido');
  if(sampleType==='CRM'){
   if(!numeric(row.CertifiedValue)||!numeric(row.CertifiedSD)||Number(row.CertifiedSD)<=0||!numeric(context.crmMaxZ)||Number(context.crmMaxZ)<=0)add('CRM_PROTOCOL','Falta certificado, desviación o límite Z aprobado','WARNING');
   else if(q!=='=')add('CRM_CENSORED','No calcular Z con un resultado censurado','WARNING');
   else{result.zScore=(value-Number(row.CertifiedValue))/Number(row.CertifiedSD);if(Math.abs(result.zScore)>Number(context.crmMaxZ))add('CRM_Z','Estándar fuera del límite Z del protocolo');}
  }
  if(sampleType==='BLANK'){
   if(!numeric(context.blankLimit)||Number(context.blankLimit)<0)add('BLANK_PROTOCOL','Falta límite de blanco aprobado en esta unidad','WARNING');
   else if(q==='>'||q==='<'&&value>Number(context.blankLimit))add('BLANK_CENSORED','No es posible decidir con este límite analítico','WARNING');
   else if(q==='='&&value>Number(context.blankLimit))add('BLANK_LIMIT','Blanco supera límite del protocolo');
  }
  if(sampleType==='DUPLICATE'){
   if(!numeric(context.duplicateValue)||!numeric(context.duplicateRpdLimit)||Number(context.duplicateRpdLimit)<0||!context.sameMethodUnit||!context.duplicateUncensored)add('DUPLICATE_PROTOCOL','Falta pareja comparable y límite RPD aprobado','WARNING');
   else if(q!=='='||value<0||Number(context.duplicateValue)<0||value+Number(context.duplicateValue)===0)add('DUPLICATE_UNDEFINED','RPD no evaluable con estos valores','WARNING');
   else{result.rpd=200*Math.abs(value-Number(context.duplicateValue))/(value+Number(context.duplicateValue));if(result.rpd>Number(context.duplicateRpdLimit))add('DUPLICATE_RPD','Diferencia supera RPD permitido');}
  }
 }
 return status(result);
}
export function evaluateBatch(rows,contexts={}){
 const ids=new Map();const sampleIntervals=new Map();
 const checked=rows.map(row=>evaluate(row,contexts[row.ResultID]||{}));
 for(const [i,r]of checked.entries()){
  const row=r.original;const id=JSON.stringify([row.ProjectID,row.CampaignID,row.ResultID]);
  if(ids.has(id)){for(const j of [ids.get(id),i]){checked[j].issues.push({code:'DUPLICATE_ID',severity:'ERROR',message:'ResultID duplicado en el lote'});status(checked[j]);}}else ids.set(id,i);
  if((row.MeasurementType||'INTERVAL')==='INTERVAL'){
   const sample=key(row)+'|'+JSON.stringify(row.SampleID),interval=JSON.stringify([Number(row.FromM),Number(row.ToM)]);
   if(sampleIntervals.has(sample)&&sampleIntervals.get(sample).interval!==interval){for(const j of [sampleIntervals.get(sample).i,i]){checked[j].issues.push({code:'SAMPLE_INTERVAL',severity:'ERROR',message:'La misma muestra tiene intervalos incompatibles'});status(checked[j]);}}else sampleIntervals.set(sample,{i,interval});
  }
 }
 // Cross-check only exact, matching intervals and methods of core logging.
 for(const r of checked){const row=r.original;if(row.Parameter!=='RQD'||r.qualifier!=='=')continue;
 const recoveries=checked.filter(x=>x.original.Parameter==='RECOVERY'&&x.qualifier==='='&&key(x.original)===key(row)&&x.original.SampleID===row.SampleID&&Number(x.original.FromM)===Number(row.FromM)&&Number(x.original.ToM)===Number(row.ToM)&&x.original.Method===row.Method&&x.original.Unit==='%');
 if(recoveries.length===1&&r.value>recoveries[0].value){r.issues.push({code:'RQD_RECOVERY',severity:'ERROR',message:'RQD supera recuperación comparable'});status(r);}
 }
 return checked;
}
