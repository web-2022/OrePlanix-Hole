import {openWorkbook,sheetRows,toCSV,LIMITS} from './xlsx.mjs';
let epoch=0,cancelDialog=null;
export function cancelActiveImport(){epoch++;if(cancelDialog){const cancel=cancelDialog;cancelDialog=null;cancel();}}
export async function uploadCSV(file,required,options={}){
 cancelActiveImport();const current=epoch;
 if(file.size>LIMITS.fileBytes)throw Error('Máximo 5 MB por archivo');
 if(/\.csv$/i.test(file.name)){const text=await file.text();if(current!==epoch)throw Error('Importación cancelada');return text;}
 if(!/\.xlsx$/i.test(file.name))throw Error('Selecciona un archivo CSV o XLSX');
 const book=await openWorkbook(await file.arrayBuffer());if(current!==epoch)throw Error('Importación cancelada');
 return new Promise((resolve,reject)=>{
  const dialog=document.createElement('dialog');dialog.style.cssText='box-sizing:border-box;width:min(90vw,760px);max-width:90vw;max-height:85vh;overflow-wrap:anywhere;overflow:auto;background:#192a3a;color:#dce6ef;border:1px solid #64819a;border-radius:12px;padding:20px';
  const title=document.createElement('h2');title.textContent='Revisar hoja de Excel';title.id='xlsx-dialog-title';dialog.setAttribute('aria-labelledby',title.id);const name=document.createElement('p');name.textContent=file.name;
  const label=document.createElement('label');label.textContent='Hoja que se importará ';const select=document.createElement('select');select.setAttribute('aria-label','Hoja de Excel');const empty=document.createElement('option');empty.value='';empty.textContent='Selecciona una hoja';select.append(empty);
  const visible=book.worksheets.filter(s=>s.state==='visible');for(const sheet of visible){const o=document.createElement('option');o.value=sheet.name;o.textContent=sheet.name;select.append(o);}label.append(select);
  const preview=document.createElement('p');preview.setAttribute('role','status');preview.style.cssText='overflow-wrap:anywhere;white-space:pre-wrap';const apply=document.createElement('button');apply.type='button';apply.textContent='Usar esta hoja';apply.disabled=true;const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancelar';cancel.style.marginLeft='12px';let parsed=null,finished=false;
  function finish(error,value){if(finished)return;finished=true;cancelDialog=null;dialog.close();dialog.remove();if(error)reject(error);else resolve(value);}
  select.onchange=()=>{try{parsed=sheetRows(book,select.value,required,options);const dropped=options.onlyRequired&&parsed.extras.length?`\nColumnas que no se copiarán: ${parsed.extras.join(', ')}`:'';preview.textContent=`${parsed.rows.length} filas.\nColumnas: ${parsed.headers.join(', ')}${dropped}${parsed.hiddenRows||parsed.hiddenColumns?`\nSe incluirán ${parsed.hiddenRows} filas ocultas y ${parsed.hiddenColumns} columnas ocultas.`:''}\nEsto solo carga el borrador; todavía no guarda ni aprueba.`;apply.disabled=false;}catch(e){parsed=null;preview.textContent=e.message;apply.disabled=true;}};
  apply.onclick=()=>{if(parsed)finish(null,toCSV(parsed.rows,parsed.headers));};cancel.onclick=()=>finish(Error('Importación cancelada'));dialog.oncancel=event=>{event.preventDefault();finish(Error('Importación cancelada'));};cancelDialog=()=>finish(Error('Importación cancelada'));
  dialog.append(title,name,label,preview,apply,cancel);document.body.append(dialog);dialog.showModal();if(visible.length===1){select.value=visible[0].name;select.onchange();}
 });
}
