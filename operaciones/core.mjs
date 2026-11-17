// Reglas deterministas. No interpreta códigos especiales sin un contrato de laboratorio.
export const rules = {
 RQD: {unit:'%',min:0,max:100,discipline:'GEOMECANICA'},
 RECOVERY: {unit:'%',min:0,max:100,discipline:'GEOMECANICA'},
 UCS: {unit:'MPa',min:0,discipline:'GEOMECANICA'},
 PH: {unit:'pH',warningMin:0,warningMax:14,discipline:'HIDROGEOLOGIA'},
 EC: {unit:'uS/cm',min:0,discipline:'HIDROGEOLOGIA'},
 PERMEABILITY: {unit:'m/s',min:0,discipline:'HIDROGEOLOGIA'}
};
const number=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v));
const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function validateResult(row,context={}) {
 const issues=[]; const add=(code,message,severity='ERROR')=>issues.push({code,message,severity});
 for(const key of ['ResultID','ProjectID','CampaignID','HoleID','SampleID','Discipline','Parameter','Unit','Method','Laboratory'])if(!String(row[key]??'').trim())add('REQUIRED',`Falta ${key}`);
 if(!['GEOLOGIA','GEOMECANICA','HIDROGEOLOGIA'].includes(row.Discipline))add('DISCIPLINE','Disciplina desconocida');
 if(!number(row.FromM)||!number(row.ToM)||Number(row.FromM)<0||Number(row.ToM)<=Number(row.FromM))add('INTERVAL','Intervalo inválido');
 if(number(context.depth)&&Number(row.ToM)>Number(context.depth))add('DEPTH','Intervalo supera profundidad perforada');
 const raw=String(row.Value??'').trim(); const match=raw.match(/^(<|>)?\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i);
 const rule=rules[row.Parameter]||(row.Discipline==='GEOLOGIA'&&['ppm','ppb','%','g/t','mg/kg'].includes(row.Unit)?{min:0,...(row.Unit==='%'?{max:100}:{})}:null);
 if(rule?.discipline&&rule.discipline!==row.Discipline)add('PARAMETER_DISCIPLINE','Parámetro no corresponde a la disciplina');
 if(rule?.unit&&row.Unit!==rule.unit)add('UNIT',`Unidad esperada: ${rule.unit}`);
 if(!rule)add('RULE_MISSING','Parámetro/unidad pendiente de regla técnica','WARNING');
 let value=null,qualifier=null;
 if(!match)add('VALUE','Valor no numérico o código especial sin definir');
 else {
  value=Number(match[2]);qualifier=match[1]||'=';
  if(!Number.isFinite(value))add('VALUE','Valor no finito');
  if(value<0)add('NEGATIVE','Valor negativo: corregir o documentar código del laboratorio');
  if(rule?.min!==undefined&&value<rule.min)add('MIN',`Valor inferior a ${rule.min}`);
  if(rule?.max!==undefined&&(value>rule.max||(qualifier==='>'&&value>=rule.max)))add('MAX',`Valor incompatible con máximo ${rule.max}`);
  if((rule?.warningMin!==undefined&&value<rule.warningMin)||(rule?.warningMax!==undefined&&value>rule.warningMax))add('EXPECTED_RANGE','Fuera del rango habitual; revisión técnica','WARNING');
  if(qualifier!=='=')add('CENSORED','Resultado censurado; no sustituir por cero ni por el límite','INFO');
 }
 return {original:{...row},value,qualifier,issues,status:issues.some(i=>i.severity==='ERROR')?'REJECTED':issues.some(i=>i.severity==='WARNING')?'REVIEW':'VALID'};
}
export function validateDaily(rows) {
 const seen=new Set();const intervals=new Map();
 return rows.map(row=>{
  const issues=[];const add=(code)=>issues.push(code);
  for(const key of ['ReportLineID','ProjectID','CampaignID','HoleID','Discipline','RigID'])if(!String(row[key]??'').trim())add('REQUIRED_'+key);
  const id=[row.ProjectID,row.CampaignID,row.ReportLineID].join('|');if(seen.has(id))add('DUPLICATE');seen.add(id);
  if(!date(row.ReportDate))add('DATE');
  if(!['DIA','NOCHE'].includes(row.Shift))add('SHIFT');
  if(!['GEOLOGIA','GEOMECANICA','HIDROGEOLOGIA'].includes(row.Discipline))add('DISCIPLINE');
  const a=Number(row.FromM),b=Number(row.ToM);
  if(!['AVANCE','SIN_AVANCE','REPERFORACION'].includes(row.Activity))add('ACTIVITY');
  if(row.Activity==='SIN_AVANCE'){
   if(String(row.FromM??'').trim()||String(row.ToM??'').trim())add('NO_ADVANCE_INTERVAL');
   if(!row.DowntimeReason?.trim())add('REASON');
  }else if(!number(row.FromM)||!number(row.ToM)||a<0||b<=a)add('INTERVAL');
  for(const field of ['DrillingHours','DowntimeHours'])if(String(row[field]??'').trim()&&(!number(row[field])||Number(row[field])<0||Number(row[field])>24))add('HOURS');
  if(Number(row.DowntimeHours)>0&&!row.DowntimeReason?.trim())add('REASON');
  const key=[row.ProjectID,row.CampaignID,row.Discipline,row.HoleID].join('|');
  if(row.Activity==='AVANCE'&&number(row.FromM)&&number(row.ToM)&&b>a){
   const previous=intervals.get(key)||[];if(previous.some(([x,y])=>a<y&&b>x))add('OVERLAP');
   if(!issues.length){previous.push([a,b]);intervals.set(key,previous);}
  }
  return {original:{...row},issues,status:issues.length?'REJECTED':'VALID',netM:issues.length||row.Activity!=='AVANCE'?0:b-a};
 });
}
export function compareProgress(plan,daily){
 const valid=validateDaily(daily);const dates=[...new Set([...plan.map(r=>r.Date),...daily.map(r=>r.ReportDate)])].sort();
 let planned=0,executed=0;
 return dates.map(day=>{planned+=plan.filter(r=>r.Date===day).reduce((s,r)=>s+Number(r.PlannedM),0);executed+=valid.filter(r=>r.original.ReportDate===day).reduce((s,r)=>s+r.netM,0);return {date:day,plannedM:planned,executedM:executed,deviationM:executed-planned,compliance:planned?executed/planned*100:null};});
}
