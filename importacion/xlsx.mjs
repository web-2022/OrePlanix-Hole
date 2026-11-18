export const LIMITS={fileBytes:5*1024*1024,inflatedBytes:40*1024*1024,entries:2048,sheets:20,rows:10000,columns:200,cells:200000};
const utf8=new TextDecoder('utf-8',{fatal:true});
const columnNumber=letters=>[...letters.toUpperCase()].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
function checkXML(text,name){let cells=0;
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('El archivo contiene XML no admitido');
 if(/^xl\/worksheets\/[^/]+\.xml$/i.test(name)){
  for(const m of text.matchAll(/<(?:(?:[\w.-]+):)?row\b[^>]*\br=["'](\d+)["']/g))if(Number(m[1])>LIMITS.rows)throw Error(`La hoja supera ${LIMITS.rows} filas`);
  for(const ignored of text.matchAll(/<(?:(?:[\w.-]+):)?c\b/g))if(++cells>LIMITS.cells)throw Error('El libro supera 200000 celdas');
  for(const m of text.matchAll(/<(?:(?:[\w.-]+):)?c\b[^>]*\br=["']([A-Z]+)(\d+)["']/gi))if(Number(m[2])>LIMITS.rows||columnNumber(m[1])>LIMITS.columns)throw Error('La hoja supera el límite de filas o columnas');
 }return cells;
}
export async function preflight(buffer){
 const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);if(bytes.byteLength>LIMITS.fileBytes)throw Error('Máximo 5 MB por archivo');if(bytes.length<22)throw Error('No es un XLSX válido');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}
 if(end<0)throw Error('XLSX dañado, cifrado o formato no compatible');
 const count=view.getUint16(end+10,true),start=view.getUint32(end+16,true),size=view.getUint32(end+12,true);
 if(view.getUint16(end+4,true)||view.getUint16(end+6,true)||view.getUint16(end+8,true)!==count||count===65535||count>LIMITS.entries||start+size!==end)throw Error('Libro ZIP64 o multipartes no admitido');
 const names=new Set();let at=start,total=0,totalCells=0;
 for(let i=0;i<count;i++){
  if(at+46>end||view.getUint32(at,true)!==0x02014b50)throw Error('Directorio XLSX dañado');
  const flags=view.getUint16(at+8,true),method=view.getUint16(at+10,true),packed=view.getUint32(at+20,true),unpacked=view.getUint32(at+24,true),nameSize=view.getUint16(at+28,true),extra=view.getUint16(at+30,true),comment=view.getUint16(at+32,true),offset=view.getUint32(at+42,true);
  if(at+46+nameSize+extra+comment>end)throw Error('Entrada XLSX truncada');
  const name=utf8.decode(bytes.subarray(at+46,at+46+nameSize));at+=46+nameSize+extra+comment;
  if(names.has(name.toLowerCase())||name.startsWith('/')||name.includes('..')||name.includes('\\'))throw Error('Estructura XLSX ambigua');names.add(name.toLowerCase());
  if(flags&1||![0,8].includes(method)||[packed,unpacked,offset].includes(0xffffffff))throw Error('Libro cifrado o compresión no compatible');
  if(/vbaProject|activeX|externalLinks/i.test(name))throw Error('No se admiten macros ni vínculos externos de libros');
  total+=unpacked;if(total>LIMITS.inflatedBytes)throw Error('El libro descomprimido supera 40 MB');
  if(offset+30>start||view.getUint32(offset,true)!==0x04034b50)throw Error('Entrada XLSX inválida');
  const data=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true);
  if(data+packed>start)throw Error('Contenido XLSX truncado');
  const payload=bytes.subarray(data,data+packed);let chunks=[],actual=0;
  if(method===0){actual=payload.length;if(/\.xml$/i.test(name))chunks=[payload];}
  else{
   let decoder;try{decoder=new DecompressionStream('deflate-raw');}catch{throw Error('Este navegador no admite lectura segura de XLSX; usa CSV');}
   const reader=new Blob([payload]).stream().pipeThrough(decoder).getReader();
   try{for(;;){const {done,value}=await reader.read();if(done)break;actual+=value.byteLength;if(actual>unpacked||actual>LIMITS.inflatedBytes){await reader.cancel();throw Error('Tamaño XLSX descomprimido inconsistente');}if(/\.xml$/i.test(name))chunks.push(value);}}finally{reader.releaseLock();}
  }
  if(actual!==unpacked)throw Error('Tamaño de entrada XLSX inconsistente');
  if(chunks.length){const xml=new Uint8Array(actual);let p=0;for(const c of chunks){xml.set(c,p);p+=c.length;}totalCells+=checkXML(utf8.decode(xml),name);if(totalCells>LIMITS.cells)throw Error('El libro supera 200000 celdas');}
 }
 if(at!==end||!names.has('[content_types].xml')||!names.has('xl/workbook.xml'))throw Error('No es un libro XLSX de Excel');
 return bytes;
}
export async function openWorkbook(buffer,ExcelJS=globalThis.ExcelJS){
 if(!ExcelJS?.Workbook)throw Error('No se pudo cargar el lector Excel; usa CSV o reintenta');
 const bytes=await preflight(buffer);const book=new ExcelJS.Workbook();
 try{await book.xlsx.load(bytes,{ignoreNodes:['drawing','picture']});}catch{throw Error('No se pudo leer el libro; revisa que sea XLSX sin contraseña');}
 if(!book.worksheets.length||book.worksheets.length>LIMITS.sheets)throw Error('El libro requiere entre 1 y 20 hojas');
 return book;
}
const dateFields=new Set(['date','reportdate','starts','ends','period_start','period_end']);
const identifiers=new Set(['resultid','projectid','campaignid','holeid','hole_id','sampleid','reportlineid','rigid','certificateid','duplicateofresultid']);
function cellText(cell,field){
 const value=cell.value;if(value===null||value===undefined)return '';
 if(typeof value==='object'&&('formula'in value||'sharedFormula'in value))throw Error(`Celda ${cell.address}: reemplaza la fórmula por su valor confirmado`);
 if(value instanceof Date){if(!dateFields.has(field.toLowerCase()))throw Error(`Celda ${cell.address}: usa texto con zona horaria o identificador explícito`);if(!Number.isFinite(+value)||value.getUTCHours()||value.getUTCMinutes()||value.getUTCSeconds()||value.getUTCMilliseconds())throw Error(`Celda ${cell.address}: la fecha diaria no debe incluir hora`);return value.toISOString().slice(0,10);}
 if(typeof value==='number'){
  if(!Number.isFinite(value))throw Error(`Celda ${cell.address}: número inválido`);
  if(identifiers.has(field.toLowerCase())&&(!Number.isSafeInteger(value)||Math.abs(value)>=1e15||/0{2,}/.test(cell.numFmt||'')))throw Error(`Celda ${cell.address}: guarda el identificador como texto para conservar su precisión y ceros`);
  return String(value);
 }
 if(typeof value==='string')return value.trim();
 if(typeof value==='object'&&Array.isArray(value.richText))return value.richText.map(r=>r.text).join('').trim();
 if(typeof value==='object'&&typeof value.text==='string')return value.text.trim();
 throw Error(`Celda ${cell.address}: tipo o error de Excel no admitido`);
}
export const OPTIONAL_HEADERS=['BatchID','LabCertificateID','Kind','Affects','CRM','BLANK','DUPLICATE','REPEAT','RepeatMaxAbsDiff','RepeatMaxMinutes','SampleType','MeasurementType','DepthM','ObservedAt','Reference','CertificateID','DuplicateOfResultID','CertifiedValue','CertifiedSD','DrillingHours','DowntimeHours','DowntimeReason','Comments','CoreSize'];
export function sheetRows(book,name,required,{onlyRequired=false}={}){
 const sheet=book.getWorksheet(name);if(!sheet)throw Error('Selecciona una hoja del libro');if(sheet.state!=='visible')throw Error('No se importan hojas ocultas');
 if(sheet.rowCount>LIMITS.rows||sheet.columnCount>LIMITS.columns)throw Error('Hoja fuera de límites');
 const expected=new Map([...required,...OPTIONAL_HEADERS].map(k=>[k.toLowerCase(),k]));const headers=[];const seen=new Set();
 const head=sheet.getRow(1);for(let c=1;c<=sheet.columnCount;c++){
  const cell=head.getCell(c);const raw=cellText(cell,'HEADER');const key=raw.toLowerCase();
  if(!raw){if(sheet.getColumn(c).values.some((v,i)=>i>1&&v!==null&&v!==undefined))throw Error(`Columna ${c} sin encabezado`);continue;}
  if(seen.has(key))throw Error('Encabezados repetidos después de normalizar');seen.add(key);headers.push({column:c,name:expected.get(key)||raw,key});
 }
 for(const k of required)if(!seen.has(k.toLowerCase()))throw Error(`Falta columna ${k}`);
 const rows=[];let cells=0,hiddenRows=0;for(let i=2;i<=sheet.rowCount;i++){
  const values={};let nonempty=false;for(const h of headers){const cell=sheet.getRow(i).getCell(h.column);const text=cellText(cell,h.name);if(++cells>LIMITS.cells)throw Error('Hoja supera 200000 celdas');if(text)nonempty=true;values[h.name]=text;}
  if(nonempty){if(sheet.getRow(i).hidden)hiddenRows++;rows.push(onlyRequired?Object.fromEntries(required.map(k=>[k,values[k]])):values);}
 }
 if(!rows.length)throw Error('La hoja no contiene filas de datos');
 return {rows,hiddenRows,hiddenColumns:headers.filter(h=>sheet.getColumn(h.column).hidden&&(!onlyRequired||required.some(k=>k.toLowerCase()===h.key))).length,headers:onlyRequired?required:headers.map(h=>h.name),extras:headers.filter(h=>!required.some(k=>k.toLowerCase()===h.key)).map(h=>h.name)};
}
export function toCSV(rows,headers){const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';return [headers.map(quote).join(','),...rows.map(r=>headers.map(k=>quote(r[k])).join(','))].join('\n');}
