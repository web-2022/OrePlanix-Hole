import {uploadCSV} from '../importacion/chooser.mjs';
'use strict';
const element = id => document.getElementById(id);
const formData = form => Object.fromEntries(new FormData(form));
const status = element('status');
const project = element('project');
const campaign = element('campaign');
const version = element('version');
const holesFields = 'hole_id,discipline,east,north,elevation,azimuth,dip,depth,starts,ends';
const targetFields = 'hole_id,discipline,period_start,period_end,meters';
const config = window.LOCAL_CONFIG;
if (config?.api !== 'http://127.0.0.1:54321' && !(config?.environment === 'hosted' && config.api === 'https://pflplvqyigrxknkvfmwr.supabase.co')) throw new Error('Destino no autorizado');
const client = window.supabase.createClient(config.api, config.anon, {auth: {persistSession: false}});
let versions = [];
let busy = false;

function value(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
function options(select, items, key, label, selected) {
  select.replaceChildren(...items.map(item => new Option(item[label], item[key])));
  if (items.some(item => String(item[key]) === String(selected))) select.value = selected;
}
function draft(holes = [], targets = []) {
  element('holes').value = Papa.unparse({fields: holesFields.split(','), data: holes});
  element('targets').value = Papa.unparse({fields: targetFields.split(','), data: targets});
}
function parse(id, fields) {
  const result = Papa.parse(element(id).value.trim(), {header: true, skipEmptyLines: 'greedy', transformHeader: key => key.trim()});
  if (result.errors.length || result.meta.fields?.join(',') !== fields ||
      Object.keys(result.meta.renamedHeaders ?? {}).length || !result.data.length) {
    throw new Error('Encabezados o filas incorrectos en ' + id);
  }
  return result.data.map(row => Object.fromEntries(Object.entries(row).map(([key, field]) => [key, field.trim()])));
}
function renderVersion() {
  const row = versions.find(item => String(item.version) === version.value);
  const periods = new Map();
  for (const target of row?.targets ?? []) {
    const key = target.period_start + ' / ' + target.period_end;
    periods.set(key, (periods.get(key) ?? 0) + Math.round(Number(target.meters) * 1000));
  }
  const meters = Object.fromEntries([...periods].sort().map(([key, mm]) => [key, (mm / 1000).toFixed(3)]));
  element('approved').textContent = row
    ? JSON.stringify({version: row.version, motivo: row.reason, sondajes: row.holes.length, metrosPorPeriodo: meters, metas: row.targets}, null, 2)
    : 'Campaña sin versión aprobada.';
}
async function loadVersions(resetDraft = true) {
  versions = campaign.value ? value(await client.from('planning_versions').select('*')
    .eq('campaign_id', campaign.value).order('version', {ascending: false})) : [];
  options(version, versions, 'version', 'version');
  renderVersion();
  if (resetDraft) {
    draft();
    element('approval').reset();
    draft();
  }
}
async function loadCampaigns(selected) {
  const rows = project.value ? value(await client.from('planning_campaigns').select('id,name')
    .eq('project_id', project.value).order('name')) : [];
  options(campaign, rows, 'id', 'name', selected);
  await loadVersions();
}
async function loadProjects(selected) {
  options(project, value(await client.from('projects').select('id,project_name').order('project_name')),
    'id', 'project_name', selected);
  await loadCampaigns();
}
function run(action) {
  return async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    status.textContent = 'Procesando…';
    const controls = [...document.querySelectorAll('button,input,select,textarea')];
    controls.forEach(control => control.disabled = true);
    try { status.textContent = await action(event.currentTarget) || ''; }
    catch (error) { status.textContent = error.message; }
    finally { controls.forEach(control => control.disabled = false); busy = false; }
  };
}
element('login').onsubmit = run(async form => {
  try {
    value(await client.auth.signInWithPassword({email: form.email.value, password: form.password.value}));
  } finally { form.password.value = ''; }
  await loadProjects();
  form.hidden = true;
  document.querySelector('main').hidden = false;
});
element('projectForm').onsubmit = run(async form => {
  await loadProjects(value(await client.rpc('planning_create_project', {p_name: form.p_name.value})));
});
element('campaignForm').onsubmit = run(async form => {
  await loadCampaigns(value(await client.rpc('planning_create_campaign', {
    p_project: project.value, p_name: form.p_name.value, p_timezone: form.p_timezone.value,
    p_coordinates: form.p_coordinates.value, p_azimuth: form.p_azimuth.value
  })));
});
project.onchange = run(() => loadCampaigns());
campaign.onchange = run(() => loadVersions());
version.onchange = renderVersion;
element('loadVersion').onclick = () => {
  const row = versions.find(item => String(item.version) === version.value);
  if (row) draft(row.holes, row.targets);
};
for (const id of ['holes', 'targets']) {
  element(id + 'File').onchange = run(async input => {
    if (input.files[0]) {const fields=(id==='holes'?holesFields:targetFields).split(',');const text=await uploadCSV(input.files[0],fields,{onlyRequired:true});element(id).value=text.replace(/^\uFEFF/,'');return 'Hoja cargada en el borrador. Revisa antes de aprobar.';}
  });
}
element('approval').onsubmit = run(async form => {
  if (!campaign.value) throw new Error('Selecciona una campaña');
  const approved = value(await client.rpc('planning_approve', {
    p_campaign: campaign.value, p_previous: versions[0]?.version ?? 0, p_reason: form.p_reason.value,
    p_holes: parse('holes', holesFields), p_targets: parse('targets', targetFields)
  }));
  await loadVersions(false);
  return 'Versión aprobada: ' + approved;
});
draft();



