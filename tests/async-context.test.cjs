// Ejecutar sin dependencias ni red: node --test tests/async-context.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', textContent: '', hidden: false, disabled: false, checked: false,
      style: {}, children: [], options: [], files: [],
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {}, addEventListener() {},
      replaceChildren(...items) { this.children = []; this.options = []; this.value = ''; items.forEach(x => this.appendChild(x)); },
      appendChild(item) { this.children.push(item); this.options.push(item); if (!this.value) this.value = item.value || ''; },
      add(item) { this.appendChild(item); },
      append(...items) { items.forEach(item=>this.appendChild(item)); },
      reset() {
        const prefix = id === 'costManualForm' ? 'cost' : id === 'catForm' ? 'cat' : id === 'loginForm' ? 'login' : null;
        if (prefix) for (const [key, item] of nodes) if (key.startsWith(prefix)) item.value = defaults[key] || '';
      }
    });
    return nodes.get(id);
  };
  const defaults = { costQuantity: '1', costUnit: 'm', costDiscipline: 'GEOMECANICA', costType: 'REAL', costCurrency: 'USD' };
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) node(m[1]);
  for (const [id, value] of Object.entries(defaults)) node(id).value = value;
  let query = () => Promise.resolve({ data: [], error: null });
  let auth = () => Promise.resolve({ data: { user: { id: 'A' } }, error: null });
  let rpc = () => Promise.resolve({ data: { status: 'COMPLETED', batch_id: 1 }, error: null });
  const rpcCalls = [];
  let authListener;
  const client = {
    auth: { getSession:async()=>({data:{session:null}}),getUser: () => auth(), onAuthStateChange(fn) { authListener = fn; } },
    from(table) {
      const filters = {};
      const meta = { orders: [], range: null, not: [], gte: {}, lte: {} };
      const q = { select(fields, options) { meta.fields=fields;meta.options=options;return q; },
        order(field, options={}) { meta.orders.push([field, options]);return q; },
        range(from, to) { meta.range=[from,to];return q; },
        limit() { return q; }, maybeSingle() { return q; }, in() { return q; },
        not(...args) { meta.not.push(args);return q; },
        gte(key,value) { meta.gte[key]=value;return q; }, lte(key,value) { meta.lte[key]=value;return q; },
        eq(key, value) { filters[key] = value; return q; },
        then(yes, no) { return Promise.resolve(query(table, filters, meta)).then(result=>{
          // Older scenario fixtures describe a complete small response.
          if(Array.isArray(result.data))return {...result,
            count:result.count??result.data.length,
            data:result.data.map((row,i)=>({id:i+1,...row}))};
          return result;
        }).then(yes, no); } };
      return q;
    },
    rpc(name, params) { rpcCalls.push({ name, params }); return rpc(name, params); }
  };
  const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, atob,setTimeout,clearTimeout,AbortController,DOMException,CostRealtime:{createCostRealtime:()=>({sync:async()=>{},stop:async()=>{}})},
    window: { addEventListener(){},confirm: () => true, supabase: { createClient: () => client } }, confirm: () => true,
    document: { querySelectorAll:()=>[],getElementById: node, createElement: () => node(Symbol()) },
    Option: function(text, value) { this.textContent = text; this.value = value; }
  });
  // Evaluate the actual frontend, without booting its network client.
  vm.runInContext(script.replace(/\binit\(\);\s*$/, ''), context);
  context.client = client;
  const run = code => vm.runInContext(code, context);
  run(`supabaseClient=client;usuarioIdActual='A';proyectosDisponibles=[{id:3,project_name:'P3'},{id:4,project_name:'P4'}];`);
  node('proyecto').value = '3';
  run('proyectoContexto="3";');
  return { node, run, context, rpcCalls,
    query(fn) { query = fn; }, auth(fn) { auth = fn; }, rpc(fn) { rpc = fn; },
    emit(event, session) { authListener(event, session); },
    project(id) { node('proyecto').value = String(id); run('actualizarContextoProyecto()'); },
    user(id) { context.nextUser = id; run('cargarProyectos=async()=>{};mostrarSesion(nextUser?{id:nextUser,email:"local"}:null)'); }
  };
}

test('JavaScript válido y correcciones previas conservadas', () => {
  new vm.Script(script);
  assert.match(script, /azimuth===null\|\|azimuth<0\|\|azimuth>=360/);
  assert.match(script, /holes\.get\(holeKey\(id,disc,hole\)\)/);
});

test('Cambio de proyecto durante consulta descarta respuesta y error antiguos', async () => {
  for (const failure of [false, true]) {
    const s = setup(), d = deferred(); s.query(() => d.promise);
    const pending = s.run('costCargar()'); await tick(); s.project(4);
    s.node('costManualMessage').textContent = 'P4';
    if (failure) d.reject(new Error('old')); else d.resolve({ data: [], error: null });
    await pending;
    assert.equal(s.node('costManualMessage').textContent, 'P4');
    assert.equal(s.run('costHoles.length'), 0);
  }
});

test('Cambio de usuario durante consulta y vuelta al mismo proyecto invalida respuesta', async () => {
  const s = setup(), d = deferred(); s.query(() => d.promise);
  const pending = s.run('catCargar()'); await tick();
  s.user('B'); s.project(3); s.node('catListMessage').textContent = 'B';
  d.resolve({ data: [{ project_id: 3, cost_code: 'OLD' }], error: null }); await pending;
  assert.equal(s.node('catListMessage').textContent, 'B');
  assert.equal(s.run('categoriaLista.length'), 0);
});

test('Respuestas de catálogo fuera de orden: solo gana la última', async () => {
  const s = setup(), first = deferred(), second = deferred(); let count = 0;
  s.query(() => (++count === 1 ? first : second).promise);
  const p1 = s.run('catCargar()'); await tick(); const p2 = s.run('catCargar()'); await tick();
  second.resolve({ data: [{ project_id: 3, cost_code: 'NEW', category_name: 'New', is_active: true }], error: null }); await p2;
  first.resolve({ data: [{ project_id: 3, cost_code: 'OLD' }], error: null }); await p1;
  assert.equal(s.run('categoriaLista[0].cost_code'), 'NEW');
});

test('Volver al proyecto original no revive una consulta vieja', async () => {
  const s = setup(), d = deferred(); s.query(() => d.promise);
  const pending = s.run('costCargar()'); await tick(); s.project(4); s.project(3);
  s.node('costManualMessage').textContent = 'nuevo'; d.resolve({ data: [], error: null }); await pending;
  assert.equal(s.node('costManualMessage').textContent, 'nuevo');
});

test('Listado de proyectos pendiente no restaura una sesión anterior', async () => {
  const s = setup(), d = deferred(); s.query(() => d.promise);
  const pending = s.run('cargarProyectos()'); await tick(); s.user(null);
  d.resolve({ data: [{ id: 3, project_name: 'OLD' }], error: null }); await pending;
  assert.equal(s.run('proyectosDisponibles.length'), 0);
  assert.equal(s.node('proyecto').options.length, 0);
});

test('Consulta de sondajes antigua no sobrescribe los indicadores nuevos', async () => {
  const s = setup(), d = deferred(); s.query(() => d.promise);
  const pending = s.run('mostrarDatos()'); await tick(); s.project(4);
  s.node('totalSondajes').textContent = 'nuevo';
  d.resolve({ data: [{ id: 1, hole_id: 'OLD', discipline: 'GEOLOGIA' }], error: null }); await pending;
  assert.equal(s.node('totalSondajes').textContent, 'nuevo');
  assert.equal(s.node('tablaSondajes').children.length, 0);
});

function prepareWrite(s, kind) {
  s.run(`costCategories=[{cost_code:'CAT',is_active:true,discipline:null}];costHoles=[];`);
  for (const [id, value] of Object.entries({ costEntryId: 'LOCAL-01', costQuantity: '1', costUnitPrice: '2', costCategory: 'CAT', costExtra: '{}', costDate: '2026-10-22', catExtra: '{}', catName: 'Local', catCode: 'CAT' })) s.node(id).value = value;
  if (kind === 'costCsvImport') s.run(`costCsvPrepared={id:3,user:'A',serial:costCsvSerial,file:'local.csv',rows:[{}],results:[{estado:'VALID'}]};`);
  if (kind === 'importarCSVSeguro') {
    for (const [id, value] of Object.entries({ csvProyecto: '3', csvDisciplina: 'GEOLOGIA', csvTipo: 'SURVEY', csvEstado: 'EJECUTADO' })) s.node(id).value = value;
    s.run(`csvTemporal={proyecto:'3',disciplina:'GEOLOGIA',tipo:'SURVEY',estado:'EJECUTADO',archivo:'local.csv',filas:[{}],validacionSurvey:[{resultado:'VALID'}],validatedUser:'A',validatedVersion:versionCSV};`);
  }
}

for (const kind of ['catGuardar', 'costGuardar', 'costCsvImport', 'importarCSVSeguro']) {
  test(`${kind}: cambio de usuario antes de RPC no escribe`, async () => {
    const s = setup(), d = deferred(); prepareWrite(s, kind); s.auth(() => d.promise);
    const pending = s.run(`${kind}({preventDefault(){}})`); await tick(); s.user('B');
    d.resolve({ data: { user: { id: 'A' } }, error: null }); await pending;
    assert.equal(s.rpcCalls.length, 0);
  });

  test(`${kind}: doble clic durante autenticación produce una sola escritura`, async () => {
    const s = setup(), d = deferred(); prepareWrite(s, kind); s.auth(() => d.promise);
    const pending = s.run(`${kind}({preventDefault(){}})`);
    await s.run(`${kind}({preventDefault(){}})`);
    d.resolve({ data: { user: { id: 'A' } }, error: null }); await pending;
    assert.equal(s.rpcCalls.length, 1);
  });

  test(`${kind}: éxito sin cambio de contexto conserva el flujo normal`, async () => {
    const s = setup(); prepareWrite(s, kind);
    s.rpc(() => ({ data: { status: kind === 'catGuardar' || kind === 'costGuardar' ? 'CREATED' : 'COMPLETED',
      batch_id: 7, id: 8, cost_entry_id: 'LOCAL-01', currency: 'USD', total_amount: 2,
      total: 1, imported: 1, invalid: 0, duplicates: 0 }, error: null }));
    await s.run(`${kind}({preventDefault(){}})`);
    assert.equal(s.rpcCalls.length, 1);
    if (kind === 'costGuardar') {
      assert.equal(s.node('costEntryId').value, '');
      assert.match(s.node('costManualMessage').textContent, /CREATED/);
    } else if (kind === 'catGuardar') {
      assert.equal(s.node('catName').value, '');
      assert.match(s.node('catFormMessage').textContent, /CREATED/);
    } else assert.equal(s.node(kind === 'costCsvImport' ? 'costCsvOutcome' : 'csvImportResult').hidden, false);
  });

  test(`${kind}: cambio de proyecto antes de RPC no escribe`, async () => {
    const s = setup(), d = deferred(); prepareWrite(s, kind); s.auth(() => d.promise);
    const pending = s.run(`${kind}({preventDefault(){}})`); await tick(); s.project(4);
    d.resolve({ data: { user: { id: 'A' } }, error: null }); await pending;
    assert.equal(s.rpcCalls.length, 0);
  });

  test(`${kind}: respuesta tras envío no sobrescribe proyecto nuevo ni se repite`, async () => {
    const s = setup(), d = deferred(); prepareWrite(s, kind); s.rpc(() => d.promise);
    const pending = s.run(`${kind}({preventDefault(){}})`); await tick();
    assert.equal(s.rpcCalls.length, 1); s.project(4);
    s.node('costManualMessage').textContent = 'P4'; s.node('csvImportMessage').textContent = 'P4';
    s.node('costCsvMessage').textContent = 'P4'; s.node('catFormMessage').textContent = 'P4';
    await s.run(`${kind}({preventDefault(){}})`);
    d.resolve({ data: { status: 'COMPLETED', batch_id: 1 }, error: null }); await pending;
    assert.equal(s.rpcCalls.length, 1);
    for (const id of ['costManualMessage', 'csvImportMessage', 'costCsvMessage', 'catFormMessage']) assert.equal(s.node(id).textContent, 'P4');
  });
}

for (const kind of ['costCsvImport', 'importarCSVSeguro']) test(`${kind}: logout durante importación no muestra datos antiguos`, async () => {
  const s = setup(), d = deferred(); prepareWrite(s, kind); s.rpc(() => d.promise);
  const pending = s.run(`${kind}()`); await tick(); assert.equal(s.rpcCalls.length, 1);
  s.user(null); d.resolve({ data: { status: 'COMPLETED', batch_id: 9 }, error: null }); await pending;
  assert.equal(s.node('privateContent').hidden, true);
  assert.equal(s.node('csvImportSummary').textContent, '');
  assert.equal(s.node('costCsvSummary').textContent, '');
  assert.equal(s.run('csvTemporal'), null); assert.equal(s.run('costCsvPrepared'), null);
  assert.equal(s.rpcCalls.length, 1);
});

test('Cambio de usuario limpia formulario, archivos, selecciones y cachés', () => {
  const s = setup(); prepareWrite(s, 'costGuardar');
  s.node('costComments').value = 'privado'; s.node('costContractor').value = 'privado';
  s.run(`costHoles=[{hole_id:'OLD'}];categoriaLista=[{}];`); s.user('B');
  for (const id of ['costEntryId', 'costComments', 'costContractor', 'costUnitPrice', 'costCategory', 'costHole', 'costCsvFile', 'csvArchivo']) assert.equal(s.node(id).value, '', id);
  assert.equal(s.node('costExtra').value, '{}');
  assert.equal(s.run('costHoles.length+costCategories.length+categoriaLista.length'), 0);
});

test('Mismo usuario/proyecto conserva borradores incluso al refrescar catálogos', async () => {
  const s = setup(); prepareWrite(s, 'costGuardar');
  s.node('catName').value = 'Borrador'; s.node('costComments').value = 'conservar';
  s.run(`mostrarSesion({id:'A',email:'local'});actualizarContextoProyecto();`);
  s.query(table => ({ data: table === 'cost_categories' ? [{ cost_code: 'CAT', is_active: true, discipline: null }] : [], error: null }));
  await s.run('catCargar()'); await s.run('costCargar()');
  assert.equal(s.node('catName').value, 'Borrador'); assert.equal(s.node('costComments').value, 'conservar');
  assert.equal(s.node('costCategory').value, 'CAT');
});

test('Reporte fuera de orden no bloquea la última consulta', async () => {
  const s = setup(), first = deferred(), second = deferred(); let count = 0;
  s.node('repCurrency').value = 'USD'; s.query(() => (++count === 1 ? first : second).promise);
  const p1 = s.run('repLoad()'); await tick(); s.node('repCurrency').value='PEN'; const p2 = s.run('repLoad()'); await tick();
  second.resolve({ data: [], error: null }); await p2;
  assert.equal(s.node('repResults').hidden, false, s.node('repMessage').textContent);
  first.resolve({ data: [], error: new Error('old') }); await p1;
  assert.equal(s.node('repMessage').textContent, 'Consulta terminada. No se modificó ningún registro.');
  assert.equal(s.node('repRefresh').disabled, false);
});

const session = id => ({ user: { id: 'A', email: 'local' }, access_token:
  'local.' + Buffer.from(JSON.stringify({ session_id: id })).toString('base64url') + '.local' });

test('Nueva sesión del mismo usuario invalida operación; renovar la misma conserva borrador', async () => {
  const s = setup(); s.run('cargarProyectos=async()=>{}'); s.run('init()');
  s.emit('SIGNED_IN', session('one')); const version = s.run('contextoVersion');
  s.node('costComments').value = 'borrador';
  s.emit('TOKEN_REFRESHED', session('one'));
  assert.equal(s.run('contextoVersion'), version);
  assert.equal(s.node('costComments').value, 'borrador');
  const d = deferred(); prepareWrite(s, 'costGuardar'); s.auth(() => d.promise);
  const pending = s.run('costGuardar({preventDefault(){}})'); await tick();
  s.emit('SIGNED_IN', session('two'));
  d.resolve({ data: { user: { id: 'A' } }, error: null }); await pending;
  assert.equal(s.rpcCalls.length, 0);
});

test('Respuesta inicial de Auth antigua no restaura usuario tras logout', async () => {
  const s = setup(), d = deferred(); s.auth(() => d.promise); s.run('init()');
  s.emit('SIGNED_OUT', null);
  d.resolve({ data: { user: { id: 'A' } }, error: null }); await tick();
  assert.equal(s.run('usuarioIdActual'), null);
  assert.equal(s.node('privateContent').hidden, true);
});

function datasetQuery(records, calls, hook=()=>{}) {
  return async (table, filters, meta) => {
    calls.push({table,filters,meta}); await hook(calls.length, table, meta);
    let rows=records.filter(row=>Object.entries(filters).every(([key,value])=>String(row[key])===String(value)));
    for(const [key,value] of Object.entries(meta.gte))rows=rows.filter(row=>row[key]>=value);
    for(const [key,value] of Object.entries(meta.lte))rows=rows.filter(row=>row[key]<=value);
    if(meta.not.length)rows=rows.filter(row=>!row.cost_entry_id.toUpperCase().startsWith('TEST-'));
    rows.sort((a,b)=>{
      for(const [key,options] of meta.orders){
        const cmp=a[key]<b[key]?-1:a[key]>b[key]?1:0;
        if(cmp)return options.ascending===false?-cmp:cmp;
      }
      return 0;
    });
    const count=rows.length;
    if(meta.range)rows=rows.slice(meta.range[0],meta.range[1]+1);
    return {data:rows,count,error:null};
  };
}

for(const count of [0,999,1000,1001,2500])test(`Paginación de catálogo con ${count} registros`,async()=>{
  const s=setup(),calls=[];
  const rows=Array.from({length:count},(_,i)=>({id:i+1,project_id:3,cost_code:'CAT-'+String(i%10),category_name:'Local',is_active:true})).reverse();
  s.query(datasetQuery(rows,calls));await s.run('catCargar()');
  assert.equal(s.run('categoriaLista.length'),count);
  assert.equal(s.node('catTable').children.length,count);
  assert.equal(calls.length,Math.max(1,Math.ceil(count/500)));
  const ids=s.run('categoriaLista.map(x=>x.id)');assert.equal(new Set(ids).size,count);
  for(const call of calls){
    assert.equal(call.filters.project_id,3);assert.equal(call.meta.options.count,'exact');
    assert.deepEqual(call.meta.orders.map(x=>x[0]),['cost_code','id']);
    assert.ok(call.meta.range[1]-call.meta.range[0]<1000);
  }
  for(let i=1;i<ids.length;i++){
    const a=rows.find(x=>x.id===ids[i-1]),b=rows.find(x=>x.id===ids[i]);
    assert.ok(a.cost_code<b.cost_code||(a.cost_code===b.cost_code&&a.id<b.id));
  }
});

for(const change of ['project','user'])test(`Cambio de ${change} entre páginas descarta catálogo`,async()=>{
  const s=setup(),calls=[];const rows=Array.from({length:1001},(_,i)=>({id:i+1,project_id:3,cost_code:'CAT'}));
  s.query(datasetQuery(rows,calls,n=>{if(n===2){if(change==='project')s.project(4);else s.user('B');}}));
  await s.run('catCargar()');assert.equal(s.run('categoriaLista.length'),0);
  assert.equal(s.node('catTable').children.length,0);assert.equal(calls.length,2);
});

for(const failure of ['network','short','duplicate','count'])test(`Página intermedia ${failure}: no muestra resultados parciales`,async()=>{
  const s=setup();let calls=0;
  s.query((table,filters,meta)=>{
    calls++;if(calls===2&&failure==='network')throw Error('offline');
    const len=calls===2&&failure==='short'?10:500;
    return {data:Array.from({length:len},(_,i)=>({id:(calls===2&&failure==='duplicate'?0:meta.range[0])+i+1,cost_code:'CAT'})),count:calls===2&&failure==='count'?1200:1500,error:null};
  });
  await s.run('catCargar()');assert.equal(s.run('categoriaLista.length'),0);
  assert.equal(s.node('catTable').children.length,0);assert.match(s.node('catListMessage').textContent,/Error/);
  assert.equal(calls,2);
});

test('Filtros de proyecto se conservan en todas las páginas',async()=>{
  const s=setup(),calls=[];
  const rows=Array.from({length:2500},(_,i)=>({id:i+1,project_id:i%2?4:3,cost_code:'CAT',is_active:true}));
  s.query(datasetQuery(rows,calls));await s.run('catCargar()');
  assert.equal(s.run('categoriaLista.length'),1250);
  assert.equal(s.run('categoriaLista.every(x=>x.project_id===3)'),true);
  assert.ok(calls.every(x=>x.filters.project_id===3));
});

test('Tamaño de página configurable y limitado a 1000',async()=>{
  const s=setup(),calls=[];s.run('PAGINACION.tamano=2000');
  s.query(datasetQuery([],calls));await s.run('catCargar()');
  assert.deepEqual(calls[0].meta.range,[0,999]);
});

test('Reporte filtra en servidor, agrega 2500 filas y conserva solo 100 movimientos',async()=>{
  const s=setup(),calls=[];
  for(const [id,value] of Object.entries({repCurrency:'USD',repDisc:'GEOLOGIA',repType:'REAL',repFrom:'2026-01-01',repTo:'2026-12-31'}))s.node(id).value=value;
  const rows=Array.from({length:2500},(_,i)=>({id:i+1,project_id:3,cost_entry_id:'C-'+i,cost_date:'2026-10-22',cost_type:'REAL',discipline:'GEOLOGIA',currency:'USD',total_amount:2}));
  const query=datasetQuery(rows,calls);
  s.query((table,filters,meta)=>table==='cost_entries'?query(table,filters,meta):{data:[],count:0,error:null});
  await s.run('repLoad()');
  assert.equal(s.node('repResults').hidden,false,s.node('repMessage').textContent);
  assert.equal(s.node('repTable').children.length,100);
  assert.match(s.node('repCount').textContent,/2500/);
  assert.match(s.node('repActual').textContent,/5[,. ]000/);
  assert.equal(s.node('repTable').children[0].children[0].textContent,'C-2499');
  assert.equal(calls.length,5);
  for(const {filters,meta} of calls){
    assert.deepEqual(filters,{project_id:3,currency:'USD',discipline:'GEOLOGIA',cost_type:'REAL'});
    assert.deepEqual(meta.orders.map(x=>x[0]),['cost_date','id']);
    assert.equal(meta.gte.cost_date,'2026-01-01');assert.equal(meta.lte.cost_date,'2026-12-31');
    assert.deepEqual(meta.not,[['cost_entry_id','ilike','TEST-%']]);
  }
});

test('Error durante reporte paginado mantiene ocultos los indicadores parciales',async()=>{
  const s=setup();s.node('repCurrency').value='USD';let calls=0;
  s.query(()=>{if(++calls===2)throw Error('offline');return {data:Array.from({length:500},(_,i)=>({id:i+1,cost_type:'REAL',discipline:'GEOLOGIA',total_amount:1})),count:1001,error:null};});
  await s.run('repLoad()');assert.equal(s.node('repResults').hidden,true);
  assert.match(s.node('repMessage').textContent,/offline/);assert.equal(calls,2);
});

test('Reportes simultáneos idénticos reutilizan promesa sin invalidar ni duplicar consultas',async()=>{
  const s=setup(),d=deferred();let calls=0;
  s.query(table=>{if(table==='cost_entries'){calls++;return d.promise;}return {data:[],count:0,error:null};});
  const first=s.run('repLoad()');await tick();const sequence=s.run('repSequence');
  const second=s.run('repLoad()');assert.equal(first,second);assert.equal(s.run('repSequence'),sequence);
  assert.equal(s.node('repRefresh').disabled,true);
  d.resolve({data:[],count:0,error:null});await Promise.all([first,second]);await tick();
  assert.equal(calls,1);assert.equal(s.node('repResults').hidden,false);
  assert.equal(s.node('repRefresh').disabled,false);assert.equal(s.run('repBusy'),false);
});

test('Ráfaga de cambios de filtros reemplaza pendientes sin bucles ni respuestas obsoletas',async()=>{
  const s=setup(),old=deferred(),calls=[];
  s.query((table,filters)=>{if(table!=='cost_entries')return {data:[],count:0,error:null};
    calls.push(filters.currency);return filters.currency==='USD'?old.promise:{data:[],count:0,error:null};});
  s.node('repCurrency').value='USD';const p1=s.run('repLoad()');await tick();
  s.node('repCurrency').value='PEN';const p2=s.run('repLoad()');
  s.node('repCurrency').value='EUR';const p3=s.run('repLoad()');
  await Promise.all([p2,p3]);old.resolve({data:[],count:0,error:Error('obsoleto')});await p1;
  await tick();await tick();assert.deepEqual(calls,['USD','EUR']);
  assert.equal(s.node('repMessage').textContent,'Consulta terminada. No se modificó ningún registro.');
  assert.equal(s.node('repRefresh').disabled,false);
});

for(const change of ['project','logout'])test(`Reporte: ${change} entre páginas descarta resultados y libera controles`,async()=>{
  const s=setup(),d=deferred();let pages=0;
  s.query(table=>{if(table!=='cost_entries')return {data:[],count:0,error:null};
    if(++pages===2)return d.promise;
    return {data:Array.from({length:500},(_,i)=>({id:i+1,cost_type:'REAL',discipline:'GEOLOGIA',total_amount:1})),count:1001,error:null};});
  const pending=s.run('repLoad()');await tick();assert.equal(pages,2);
  if(change==='project')s.project(4);else s.user(null);
  d.resolve({data:[],count:1001,error:null});await pending;await tick();
  assert.equal(pages,2);assert.equal(s.node('repResults').hidden,true);
  assert.equal(s.node('repRefresh').disabled,false);assert.equal(s.run('repBusy'),false);
});

test('Error de reporte seguido de reintento manual restaura estado sin reintento automático',async()=>{
  const s=setup();let calls=0;
  s.query(table=>{if(table!=='cost_entries')return {data:[],count:0,error:null};
    if(++calls===1)throw Error('offline');return {data:[],count:0,error:null};});
  await s.run('repLoad()');await tick();assert.equal(calls,1);
  assert.match(s.node('repMessage').textContent,/offline/);assert.equal(s.node('repRefresh').disabled,false);
  await s.run('repLoad()');await tick();assert.equal(calls,2);
  assert.equal(s.node('repResults').hidden,false);assert.equal(s.run('repActiva'),null);
});

test('Filtros modificados sin nueva llamada impiden publicar respuesta y dejan botón disponible',async()=>{
  const s=setup(),d=deferred();s.query(()=>d.promise);
  const pending=s.run('repLoad()');await tick();s.node('repDisc').value='GENERAL';
  d.resolve({data:[],count:0,error:null});await pending;
  assert.equal(s.node('repResults').hidden,true);assert.equal(s.node('repRefresh').disabled,false);
  assert.match(s.node('repMessage').textContent,/filtros cambiaron/);
});

test('Actualizar mientras carga reutiliza lectura; tras terminar permite una actualización nueva',async()=>{
  const s=setup(),d=deferred();let calls=0;
  s.query(table=>{if(table!=='cost_entries')return {data:[],count:0,error:null};
    return ++calls===1?d.promise:{data:[],count:0,error:null};});
  const pending=s.run('repLoad()');await tick();const same=s.run('repLoad()');
  d.resolve({data:[],count:0,error:null});await Promise.all([pending,same]);
  await s.run('repLoad()');await tick();assert.equal(calls,2);
});
