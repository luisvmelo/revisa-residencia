/* Revisa Residência — app de revisões espaçadas adaptativas (Supabase + cache offline) */
(() => {
'use strict';

/* ===================== utilitários ===================== */
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => toISO(new Date());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const diffDays = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIAS_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const fmtBR = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—';
const fmtBRFull = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—';
const fmtDia = iso => { const d = parseISO(iso); return `${DIAS[d.getDay()]}, ${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`; };
const fmtDiaLongo = iso => { const d = parseISO(iso); return `${DIAS_LONG[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pctFmt = p => (p == null || isNaN(p)) ? '—' : `${Math.round(p)}%`;
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const TIPOS = {
  ESTUDO: { label: 'Estudo inicial (teoria)', short: 'ESTUDAR TEORIA', cls: 't-estudo' },
  QUESTOES: { label: 'Questões', short: 'QUESTÕES', cls: 't-questoes' },
  TEORIA: { label: 'Revisão teórica', short: 'REVISAR TEORIA', cls: 't-teoria' },
  QUESTOES_POS_TEORIA: { label: 'Questões após revisão teórica', short: 'QUESTÕES · pós-teoria', cls: 't-questoes' },
  MANUTENCAO: { label: 'Manutenção (questões)', short: 'QUESTÕES · manutenção', cls: 't-manutencao' },
};
const isQuestoes = t => t === 'QUESTOES' || t === 'QUESTOES_POS_TEORIA' || t === 'MANUTENCAO';
const NIVEIS = [
  { emoji: '⚪', nome: 'Sem avaliação', var: '--ink-3' },
  { emoji: '🔴', nome: 'Muito baixo', var: '--red' },
  { emoji: '🟠', nome: 'Baixo', var: '--orange' },
  { emoji: '🟡', nome: 'Intermediário', var: '--amber' },
  { emoji: '🟢', nome: 'Bom', var: '--green' },
  { emoji: '🔵', nome: 'Excelente', var: '--blue' },
];

/* ===================== configuração padrão ===================== */
function defaultConfig() {
  return {
    limiteTeoria: 50,
    primeiraRevisao: { padrao: 1, max: 2 },
    posTeoria: { padrao: 1, max: 2 },
    faixas: [
      { nome: 'Muito baixo', min: 0, intMin: 0, intMax: 2, padrao: 1, conduta: 'TEORIA' },
      { nome: 'Baixo', min: 50, intMin: 2, intMax: 3, padrao: 2, conduta: 'QUESTOES' },
      { nome: 'Intermediário', min: 70, intMin: 5, intMax: 7, padrao: 5, conduta: 'QUESTOES' },
      { nome: 'Bom', min: 80, intMin: 10, intMax: 14, padrao: 10, conduta: 'QUESTOES' },
      { nome: 'Excelente', min: 90, intMin: 21, intMax: 30, padrao: 21, conduta: 'QUESTOES' },
    ],
    manutencao: [30, 45, 60, 90],
    questoesRecomendadas: 20,
    disciplinas: ['Clínica Médica', 'Cirurgia', 'Pediatria', 'Ginecologia e Obstetrícia', 'Medicina Preventiva'],
  };
}

/* ===================== Supabase ===================== */
const SB_CFG = window.REVISA_CONFIG || {};
const sb = (window.supabase && SB_CFG.url && SB_CFG.key) ? window.supabase.createClient(SB_CFG.url, SB_CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
let user = null;

/* ===================== estado ===================== */
const UI_KEY = 'revisa-ui';
const cacheKey = () => `revisa-cache-${user ? user.id : 'anon'}`;
const outboxKey = () => `revisa-outbox-${user ? user.id : 'anon'}`;
function blankData() { return { config: defaultConfig(), subjects: [], history: [], nextNumero: 1, nextSeq: 1 }; }
function loadUI() { try { return Object.assign({ tab: 'agenda', agendaMode: 'lista', mes: todayISO().slice(0, 7), subjView: 'cards' }, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch (e) { return { tab: 'agenda', agendaMode: 'lista', mes: todayISO().slice(0, 7), subjView: 'cards' }; } }
function loadCache() {
  const b = blankData();
  try { const raw = localStorage.getItem(cacheKey()); if (raw) { const s = JSON.parse(raw); b.config = Object.assign(defaultConfig(), s.config || {}); b.subjects = s.subjects || []; b.history = s.history || []; b.nextNumero = s.nextNumero || 1; b.nextSeq = s.nextSeq || 1; b.cached = true; } } catch (e) { console.warn('cache', e); }
  return b;
}
let state = Object.assign(blankData(), { ui: loadUI() });
let saveTimer = null;
function save(now) {
  const doSave = () => {
    try { localStorage.setItem(UI_KEY, JSON.stringify(state.ui)); } catch (e) { /* ignore */ }
    if (!user) return;
    try { localStorage.setItem(cacheKey(), JSON.stringify({ config: state.config, subjects: state.subjects, history: state.history, nextNumero: state.nextNumero, nextSeq: state.nextSeq })); } catch (e) { toast('Não foi possível salvar o cache local.'); }
  };
  if (now) { clearTimeout(saveTimer); doSave(); return; }
  clearTimeout(saveTimer); saveTimer = setTimeout(doSave, 80);
}
const cfg = () => state.config;

/* ---------- mapeamento app <-> banco ---------- */
const subjectToRow = s => ({ id: s.id, user_id: user.id, numero: s.numero, disciplina: s.disciplina, assunto: s.assunto, data_estudo: s.dataEstudo || null, estudo_realizado: !!s.estudoRealizado, primeira_revisao_dias: s.primeiraRevisaoDias ?? 1, obs: s.obs || '', ajuste: s.ajuste || null, exemplo: !!s.exemplo, concluido: !!s.concluido, criado_em: s.criadoEm || todayISO() });
const rowToSubject = r => ({ id: r.id, numero: r.numero, disciplina: r.disciplina, assunto: r.assunto, dataEstudo: r.data_estudo, estudoRealizado: r.estudo_realizado, primeiraRevisaoDias: r.primeira_revisao_dias, obs: r.obs || '', ajuste: r.ajuste || null, exemplo: !!r.exemplo, concluido: !!r.concluido, criadoEm: r.criado_em });
const reviewToRow = h => ({ id: h.id, user_id: user.id, subject_id: h.subjectId, seq: h.seq, numero: h.numero, data_programada: h.dataProgramada, data_realizada: h.dataRealizada, tipo: h.tipo, questoes: h.questoes ?? null, acertos: h.acertos ?? null, pct: h.pct ?? null, intervalo_anterior: h.intervaloAnterior ?? null, proximo_intervalo: h.proximoIntervalo, proxima_atividade: h.proximaAtividade, proxima_data: h.proximaData, streak: h.streak || 0, faixa: h.faixa || null, obs: h.obs || '', exemplo: !!h.exemplo });
const rowToReview = (r, sm) => { const s = sm[r.subject_id]; return { id: r.id, subjectId: r.subject_id, disciplina: s ? s.disciplina : '', assunto: s ? s.assunto : '', seq: r.seq, numero: r.numero, dataProgramada: r.data_programada, dataRealizada: r.data_realizada, tipo: r.tipo, questoes: r.questoes, acertos: r.acertos, pct: r.pct == null ? null : Number(r.pct), intervaloAnterior: r.intervalo_anterior, proximoIntervalo: r.proximo_intervalo, proximaAtividade: r.proxima_atividade, proximaData: r.proxima_data, streak: r.streak || 0, faixa: r.faixa, obs: r.obs || '', exemplo: !!r.exemplo }; };

/* ---------- fila de sincronização (funciona offline) ---------- */
let outbox = [];
function loadOutbox() { try { outbox = JSON.parse(localStorage.getItem(outboxKey()) || '[]'); } catch (e) { outbox = []; } }
function saveOutbox() { try { localStorage.setItem(outboxKey(), JSON.stringify(outbox)); } catch (e) { /* ignore */ } }
function enqueue(op) { outbox.push(op); saveOutbox(); setSync(); flushOutbox(); }
const dbUpsertSubject = s => enqueue({ table: 'subjects', op: 'upsert', row: subjectToRow(s) });
const dbUpsertSubjects = list => { for (let i = 0; i < list.length; i += 200) enqueue({ table: 'subjects', op: 'upsert', row: list.slice(i, i + 200).map(subjectToRow) }); };
const dbUpsertReview = h => enqueue({ table: 'reviews', op: 'upsert', row: reviewToRow(h) });
const dbDelete = (table, match) => enqueue({ table, op: 'delete', match });
const dbSaveConfig = () => enqueue({ table: 'settings', op: 'upsert', row: { user_id: user.id, config: state.config } });
const isNetErr = e => !e.code || /fetch|network|failed|load/i.test(e.message || '');
async function runOp(op) {
  const q = sb.from(op.table);
  if (op.op === 'upsert') return q.upsert(op.row);
  if (op.op === 'delete') return q.delete().match(op.match).eq('user_id', user.id);
  if (op.op === 'deleteAll') return q.delete().eq('user_id', user.id);
  return { error: null };
}
let flushing = false;
async function flushOutbox() {
  if (flushing || !user || !sb) return false;
  flushing = true; setSync('sync');
  try {
    while (outbox.length) {
      const op = outbox[0];
      let res; try { res = await runOp(op); } catch (e) { res = { error: { message: String(e) } }; }
      if (res.error) {
        if (isNetErr(res.error)) { setSync('offline'); return false; }
        console.error('Sync rejeitado', op, res.error); toast('O servidor rejeitou uma alteração: ' + res.error.message);
        outbox.shift(); saveOutbox(); continue;
      }
      outbox.shift(); saveOutbox();
    }
    setSync('ok'); return true;
  } finally { flushing = false; }
}
function setSync(mode) {
  const el = $('#sync'); if (!el) return;
  if (!user) { el.hidden = true; return; }
  el.hidden = false;
  if (mode === 'sync') { el.textContent = 'sincronizando…'; el.className = 'sync'; return; }
  if (mode === 'offline' || (!mode && outbox.length)) { el.textContent = `offline · ${outbox.length} pendente${outbox.length === 1 ? '' : 's'}`; el.className = 'sync off'; return; }
  el.textContent = 'sincronizado'; el.className = 'sync ok';
}
async function pullAll() {
  if (!user || !sb) return;
  const [rs, rr, rc] = await Promise.all([
    sb.from('subjects').select('*').order('numero'),
    sb.from('reviews').select('*').order('seq'),
    sb.from('settings').select('config').eq('user_id', user.id).maybeSingle(),
  ]);
  if (rs.error || rr.error || rc.error) { const e = rs.error || rr.error || rc.error; if (isNetErr(e)) setSync('offline'); else toast('Erro ao carregar dados: ' + e.message); return; }
  const subjects = rs.data.map(rowToSubject); const sm = {}; subjects.forEach(s => sm[s.id] = s);
  state.subjects = subjects;
  state.history = rr.data.map(r => rowToReview(r, sm)).filter(h => sm[h.subjectId]);
  state.nextNumero = subjects.reduce((m, s) => Math.max(m, s.numero), 0) + 1;
  state.nextSeq = state.history.reduce((m, h) => Math.max(m, h.seq), 0) + 1;
  if (rc.data && rc.data.config) state.config = Object.assign(defaultConfig(), rc.data.config);
  else dbSaveConfig();
  state.loaded = true;
  if (!state.config.listaImportada && (window.REVISA_ASSUNTOS || []).length) { const n = importarLista(); if (n) toast(`${n} assuntos da sua lista foram adicionados ao Kanban`); }
  save(true); setSync('ok'); render();
}
async function syncNow() { const ok = await flushOutbox(); if (ok) await pullAll(); }

/* ===================== lógica adaptativa ===================== */
function faixaFor(pct, c = cfg()) {
  if (pct < c.limiteTeoria) return c.faixas[0];
  for (let i = c.faixas.length - 1; i >= 1; i--) if (pct >= c.faixas[i].min) return c.faixas[i];
  return c.faixas[1] || c.faixas[0];
}
function faixaIndex(pct, c = cfg()) { return c.faixas.indexOf(faixaFor(pct, c)); }
function isTopFaixa(f, c = cfg()) { return f === c.faixas[c.faixas.length - 1]; }
function planAfter({ tipo, pct, streakAnterior }, c = cfg()) {
  if (tipo === 'TEORIA') return { proximaAtividade: 'QUESTOES_POS_TEORIA', intervalo: c.posTeoria.padrao, streak: 0, faixa: null };
  const f = faixaFor(pct, c);
  if (f.conduta === 'TEORIA') return { proximaAtividade: 'TEORIA', intervalo: f.padrao, streak: 0, faixa: f };
  if (isTopFaixa(f, c)) {
    const streak = (streakAnterior || 0) + 1;
    if (streak >= 2) { const idx = Math.min(streak - 2, c.manutencao.length - 1); return { proximaAtividade: 'MANUTENCAO', intervalo: c.manutencao[idx], streak, faixa: f }; }
    return { proximaAtividade: 'QUESTOES', intervalo: f.padrao, streak, faixa: f };
  }
  return { proximaAtividade: 'QUESTOES', intervalo: f.padrao, streak: 0, faixa: f };
}
function subjectHistory(id) { return state.history.filter(h => h.subjectId === id).sort((a, b) => a.seq - b.seq); }
function nivelDominio(qh, c = cfg()) {
  if (!qh.length) return { n: 0, tend: 0 };
  const last = qh[qh.length - 1].pct; const n = Math.min(5, faixaIndex(last, c) + 1); let tend = 0;
  if (qh.length >= 2) { const win = qh.slice(-3).map(h => h.pct); const delta = win[win.length - 1] - win[0]; let up = true, down = true; for (let i = 1; i < win.length; i++) { if (win[i] < win[i - 1]) up = false; if (win[i] > win[i - 1]) down = false; } if (delta >= 5 && up) tend = 1; else if (delta <= -5 && down) tend = -1; }
  return { n, tend };
}
function prazo(iso) { const t = todayISO(); if (iso < t) return 'atrasada'; if (iso === t) return 'hoje'; return 'futura'; }
function derive(s) {
  const c = cfg(); const hist = subjectHistory(s.id); const last = hist[hist.length - 1]; const qh = hist.filter(h => isQuestoes(h.tipo));
  const d = { hist, last, numRevisoes: hist.length, numQuestoes: qh.length };
  if (!last) {
    if (!s.estudoRealizado) { d.proximaAtividade = 'ESTUDO'; d.proximaData = s.dataEstudo || null; d.intervalo = 0; }
    else { d.intervalo = s.primeiraRevisaoDias ?? c.primeiraRevisao.padrao; d.proximaAtividade = 'QUESTOES'; d.proximaData = s.dataEstudo ? addDays(s.dataEstudo, d.intervalo) : null; }
    d.streak = 0; d.ref = 'inicio'; d.ultimaRevisao = null; d.ultimoTipo = null;
  } else { d.proximaAtividade = last.proximaAtividade; d.proximaData = last.proximaData; d.intervalo = last.proximoIntervalo; d.streak = last.streak || 0; d.ref = last.id; d.ultimaRevisao = last.dataRealizada; d.ultimoTipo = last.tipo; }
  if (s.ajuste && s.ajuste.ref === d.ref) { if (s.ajuste.semAgenda) d.proximaData = null; else if (s.ajuste.data) { d.proximaData = s.ajuste.data; d.ajustada = true; } }
  if (s.concluido) { d.proximaData = null; d.ajustada = false; }
  const lastQ = qh[qh.length - 1];
  d.ultimoPct = lastQ ? lastQ.pct : null; d.ultimasQuestoes = lastQ ? lastQ.questoes : null; d.ultimosAcertos = lastQ ? lastQ.acertos : null;
  d.totQuestoes = qh.reduce((a, h) => a + (Number(h.questoes) || 0), 0); d.totAcertos = qh.reduce((a, h) => a + (Number(h.acertos) || 0), 0);
  d.totErros = d.totQuestoes - d.totAcertos; d.pctGeral = d.totQuestoes ? Math.round(d.totAcertos / d.totQuestoes * 100) : null;
  d.nivel = nivelDominio(qh, c);
  d.status = s.concluido ? 'Concluído' : !s.estudoRealizado ? 'A estudar' : !d.proximaData ? 'Estudado' : d.proximaAtividade === 'TEORIA' ? 'Revisar teoria' : d.proximaAtividade === 'MANUTENCAO' ? 'Manutenção' : 'Em revisão';
  d.prazo = d.proximaData ? prazo(d.proximaData) : 'sem'; d.diasAtraso = d.prazo === 'atrasada' ? diffDays(d.proximaData, todayISO()) : 0;
  d.coluna = s.concluido ? 'concluido' : !s.estudoRealizado ? 'assuntos' : !d.proximaData ? 'estudado'
    : (d.numRevisoes === 0 || d.proximaAtividade === 'TEORIA' || d.proximaAtividade === 'QUESTOES_POS_TEORIA' || d.prazo !== 'futura') ? 'revisar'
    : d.proximaAtividade === 'MANUTENCAO' ? 'concluido' : 'revisado';
  return d;
}
const allDerived = () => state.subjects.map(s => ({ s, d: derive(s) }));
const agendados = all => all.filter(x => x.d.proximaData);
const findSubject = id => state.subjects.find(s => s.id === id);

/* ===================== ações (memória + banco) ===================== */
function addSubject({ disciplina, assunto, dataEstudo, estudoRealizado, primeiraRevisaoDias, obs, exemplo }) {
  const s = { id: uuid(), numero: state.nextNumero++, disciplina: disciplina.trim(), assunto: assunto.trim(), dataEstudo: dataEstudo || null, estudoRealizado: !!estudoRealizado, primeiraRevisaoDias, obs: (obs || '').trim(), criadoEm: todayISO(), ajuste: null, exemplo: !!exemplo };
  state.subjects.push(s); dbUpsertSubject(s);
  if (s.disciplina && !cfg().disciplinas.includes(s.disciplina)) { cfg().disciplinas.push(s.disciplina); dbSaveConfig(); }
  save(); return s;
}
function updateSubject(s, patch) { Object.assign(s, patch); state.history.forEach(h => { if (h.subjectId === s.id) { h.disciplina = s.disciplina; h.assunto = s.assunto; } }); dbUpsertSubject(s); save(); }
function registrar(subjectId, { dataRealizada, questoes, acertos, obs }) {
  const s = findSubject(subjectId); if (!s) return null;
  const d = derive(s); const tipo = d.proximaAtividade;
  if (tipo === 'ESTUDO') { s.estudoRealizado = true; s.dataEstudo = dataRealizada; s.ajuste = null; s.concluido = false; dbUpsertSubject(s); save(); return { estudo: true }; }
  let pct = null;
  if (isQuestoes(tipo)) { questoes = Number(questoes); acertos = Number(acertos); pct = questoes > 0 ? Math.round((acertos / questoes) * 1000) / 10 : 0; }
  const plan = planAfter({ tipo, pct, streakAnterior: d.streak });
  const entry = { id: uuid(), seq: state.nextSeq++, subjectId, disciplina: s.disciplina, assunto: s.assunto, numero: d.numRevisoes + 1, dataProgramada: d.proximaData || dataRealizada, dataRealizada, tipo, questoes: isQuestoes(tipo) ? questoes : null, acertos: isQuestoes(tipo) ? acertos : null, pct, intervaloAnterior: d.intervalo, proximoIntervalo: plan.intervalo, proximaAtividade: plan.proximaAtividade, proximaData: addDays(dataRealizada, plan.intervalo), streak: plan.streak, faixa: plan.faixa ? plan.faixa.nome : null, obs: (obs || '').trim(), exemplo: !!s.exemplo };
  state.history.push(entry); dbUpsertReview(entry);
  if (s.ajuste || s.concluido) { s.ajuste = null; s.concluido = false; dbUpsertSubject(s); }
  save(); return entry;
}
function desfazerUltima(subjectId) {
  const hist = subjectHistory(subjectId); const last = hist[hist.length - 1]; if (!last) return false;
  state.history = state.history.filter(h => h.id !== last.id); dbDelete('reviews', { id: last.id });
  const s = findSubject(subjectId); if (s && s.ajuste) { s.ajuste = null; dbUpsertSubject(s); }
  save(); return true;
}
function ajustarData(subjectId, iso) { const s = findSubject(subjectId); s.concluido = false; if (!s.estudoRealizado) { s.dataEstudo = iso; s.ajuste = null; dbUpsertSubject(s); save(); return; } const d = derive(s); s.ajuste = { ref: d.ref, data: iso }; dbUpsertSubject(s); save(); }
const normNome = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
function importarLista() {
  const L = window.REVISA_ASSUNTOS || []; const existentes = new Set(state.subjects.map(s => normNome(s.assunto))); const novos = [];
  L.forEach(it => { if (existentes.has(normNome(it.a))) return; const s = { id: uuid(), numero: state.nextNumero++, disciplina: it.d, assunto: it.a, dataEstudo: null, estudoRealizado: !!it.v, primeiraRevisaoDias: cfg().primeiraRevisao.padrao, obs: '', criadoEm: todayISO(), ajuste: null, exemplo: false, concluido: false }; state.subjects.push(s); novos.push(s); });
  L.forEach(it => { if (!cfg().disciplinas.includes(it.d)) cfg().disciplinas.push(it.d); });
  cfg().listaImportada = true; dbSaveConfig(); dbUpsertSubjects(novos); save(true); return novos.length;
}
function removeSubject(id) { state.subjects = state.subjects.filter(s => s.id !== id); state.history = state.history.filter(h => h.subjectId !== id); dbDelete('subjects', { id }); save(); }
function replaceAll(data) {
  // substitui tudo (importação de backup)
  state.config = Object.assign(defaultConfig(), data.config || {}); state.subjects = data.subjects; state.history = data.history;
  state.nextNumero = state.subjects.reduce((m, s) => Math.max(m, s.numero), 0) + 1; state.nextSeq = state.history.reduce((m, h) => Math.max(m, h.seq), 0) + 1;
  enqueue({ table: 'reviews', op: 'deleteAll' }); enqueue({ table: 'subjects', op: 'deleteAll' });
  state.subjects.forEach(s => dbUpsertSubject(s)); state.history.forEach(h => dbUpsertReview(h)); dbSaveConfig(); save(true);
}
function normalizeImport(raw) {
  // aceita backups antigos (ids numéricos) e novos (uuid)
  const idMap = {}; const subjects = (raw.subjects || []).map((s, i) => { const nid = typeof s.id === 'string' && s.id.includes('-') ? s.id : uuid(); idMap[s.id] = nid; return { id: nid, numero: s.numero || (typeof s.id === 'number' ? s.id : i + 1), disciplina: s.disciplina, assunto: s.assunto, dataEstudo: s.dataEstudo || null, estudoRealizado: s.estudoRealizado !== false, primeiraRevisaoDias: s.primeiraRevisaoDias ?? 1, obs: s.obs || '', ajuste: s.ajuste || null, exemplo: !!s.exemplo, concluido: !!s.concluido, criadoEm: s.criadoEm || todayISO() }; });
  const seen = new Set(); subjects.forEach(s => { while (seen.has(s.numero)) s.numero++; seen.add(s.numero); });
  const history = (raw.history || []).filter(h => idMap[h.subjectId]).map((h, i) => ({ ...h, id: typeof h.id === 'string' && h.id.includes('-') ? h.id : uuid(), subjectId: idMap[h.subjectId], seq: h.seq || i + 1, pct: h.pct == null ? null : Number(h.pct) }));
  return { config: raw.config, subjects, history };
}

/* ===================== métricas ===================== */
function metrics() {
  const t = todayISO(); const t7 = addDays(t, 7); const mes = t.slice(0, 7); const all = allDerived(); const ag = agendados(all);
  const hoje = ag.filter(x => x.d.prazo === 'hoje').length; const atrasadas = ag.filter(x => x.d.prazo === 'atrasada').length;
  const prox7 = ag.filter(x => x.d.proximaData > t && x.d.proximaData <= t7).length; const teoria = ag.filter(x => x.d.proximaAtividade === 'TEORIA').length;
  const dominioAlto = all.filter(x => x.d.nivel.n >= 4).length;
  const qh = state.history.filter(h => isQuestoes(h.tipo) && h.pct != null); const media = qh.length ? qh.reduce((a, h) => a + h.pct, 0) / qh.length : null;
  const noMes = state.history.filter(h => h.dataRealizada.slice(0, 7) === mes).length;
  const noPrazo = state.history.length ? Math.round(state.history.filter(h => h.dataRealizada <= h.dataProgramada).length / state.history.length * 100) : null;
  return { hoje, atrasadas, prox7, teoria, dominioAlto, media, noMes, noPrazo, total: state.subjects.length, all, ag };
}

/* ===================== ANÁLISE E PLANO ===================== */
const qReviews = () => state.history.filter(h => isQuestoes(h.tipo) && Number(h.questoes) > 0);
function agg(list) {
  const q = list.reduce((a, h) => a + (Number(h.questoes) || 0), 0); const a = list.reduce((x, h) => x + (Number(h.acertos) || 0), 0);
  return { q, a, e: q - a, n: list.length, pct: q ? Math.round(a / q * 100) : null };
}
// compara os últimos 30 dias com os 30 anteriores (precisa de pelo menos 5 questões em cada janela)
function tendencia(list) {
  const t = todayISO(), a30 = addDays(t, -30), a60 = addDays(t, -60);
  const rec = agg(list.filter(h => h.dataRealizada > a30)), ant = agg(list.filter(h => h.dataRealizada > a60 && h.dataRealizada <= a30));
  if (rec.q < 5 || ant.q < 5) return { tend: 0, diff: null };
  const diff = rec.pct - ant.pct; return { tend: diff >= 5 ? 1 : diff <= -5 ? -1 : 0, diff };
}
const tendTxt = t => t.diff == null ? '<span class="muted">sem comparação ainda</span>' : t.tend > 0 ? `<span class="tend-up">↗ +${t.diff} pts</span>` : t.tend < 0 ? `<span class="tend-down">↘ ${t.diff} pts</span>` : '<span class="muted">→ estável</span>';
const nivelDePct = pct => pct == null ? 0 : Math.min(5, faixaIndex(pct) + 1);
function semanas(n) { const ws = weekStart(todayISO()); const out = []; for (let i = n - 1; i >= 0; i--) out.push(addDays(ws, -7 * i)); return out; }
const serieSemanal = (list, n = 12) => semanas(n).map(w => Object.assign({ w }, agg(list.filter(h => weekStart(h.dataRealizada) === w))));
function statsDisciplinas(all) {
  const map = {}; const qh = qReviews();
  all.forEach(x => {
    const k = x.s.disciplina; const m = map[k] || (map[k] = { nome: k, itens: [], total: 0, estudados: 0, atrasadas: 0, teoria: 0 });
    m.itens.push(x); m.total++; if (x.s.estudoRealizado) m.estudados++; if (x.d.prazo === 'atrasada') m.atrasadas++; if (x.d.proximaData && x.d.proximaAtividade === 'TEORIA') m.teoria++;
  });
  return Object.values(map).map(m => {
    const ids = new Set(m.itens.map(x => x.s.id)); m.hist = qh.filter(h => ids.has(h.subjectId)); m.g = agg(m.hist); m.t = tendencia(m.hist);
    m.cob = m.total ? Math.round(m.estudados / m.total * 100) : 0; m.fracos = m.itens.filter(x => x.d.ultimoPct != null && x.d.ultimoPct < 70).length; return m;
  });
}
function situacao(g) { if (g.q < 10) return { txt: 'Poucos dados', cls: '' }; const n = nivelDePct(g.pct); return n >= 4 ? { txt: 'Forte', cls: 's-feita' } : n === 3 ? { txt: 'Regular', cls: 's-hoje' } : { txt: 'Precisa de gás', cls: 's-atrasada' }; }
const chipSit = g => { const s = situacao(g); return `<span class="chip ${s.cls}">${s.txt}</span>`; };
const gasDisc = m => (m.g.q >= 10 ? 100 - m.g.pct : 25) + m.atrasadas * 4 + m.fracos * 4 + m.teoria * 6 + (m.t.tend < 0 ? 10 : 0);
// assuntos que pedem atenção, com os motivos
function prioridades(all) {
  const out = [];
  all.forEach(x => {
    const { s, d } = x; if (s.concluido || !s.estudoRealizado) return; const motivos = []; let score = 0;
    const qs = d.hist.filter(h => isQuestoes(h.tipo));
    if (d.proximaData && d.proximaAtividade === 'TEORIA') { motivos.push('revisar a teoria'); score += 40; }
    if (d.ultimoPct != null && d.ultimoPct < 70) { motivos.push(`${pctFmt(d.ultimoPct)} na última bateria`); score += 80 - d.ultimoPct; }
    if (d.nivel.tend < 0 && qs.length >= 2) { motivos.push(`caiu de ${pctFmt(qs[Math.max(0, qs.length - 3)].pct)} para ${pctFmt(d.ultimoPct)}`); score += 20; }
    if (d.prazo === 'atrasada') { motivos.push(`${d.numRevisoes ? 'revisão' : '1ª revisão'} atrasada ${d.diasAtraso} ${d.diasAtraso === 1 ? 'dia' : 'dias'}`); score += Math.min(30, 5 + d.diasAtraso * 3); }
    if (motivos.length) out.push({ x, score, motivos });
  });
  return out.sort((a, b) => b.score - a.score);
}
function diasSeguidos() {
  const dias = new Set(state.history.map(h => h.dataRealizada)); state.subjects.forEach(s => { if (s.estudoRealizado && s.dataEstudo) dias.add(s.dataEstudo); });
  let d = todayISO(); if (!dias.has(d)) d = addDays(d, -1); let n = 0; while (dias.has(d)) { n++; d = addDays(d, -1); } return n;
}
// ---------- plano de estudos
const plano = () => Object.assign({ dataProva: null, novosPorDia: 2, revisoesPorDia: 5, dias: [1, 2, 3, 4, 5, 6] }, cfg().plano || {});
function proximoDiaEstudo(iso, dias) { let d = iso; for (let i = 0; i < 7; i++) { if (dias.includes(parseISO(d).getDay())) return d; d = addDays(d, 1); } return iso; }
function slots(inicio, porDia, n, dias) { const out = []; let d = proximoDiaEstudo(inicio, dias), c = 0; for (let i = 0; i < n; i++) { if (c >= porDia) { d = proximoDiaEstudo(addDays(d, 1), dias); c = 0; } out.push(d); c++; } return out; }
function diasEstudoEntre(a, b, dias) { let n = 0, d = a; while (d <= b) { if (dias.includes(parseISO(d).getDay())) n++; d = addDays(d, 1); } return n; }
// espalha cada matéria ao longo da fila, para não estudar uma matéria inteira de uma vez
function intercalar(subs) {
  const cnt = {}, pos = {}; subs.forEach(s => { cnt[s.disciplina] = (cnt[s.disciplina] || 0) + 1; });
  return subs.map(s => { pos[s.disciplina] = (pos[s.disciplina] ?? -1) + 1; return { s, k: (pos[s.disciplina] + 0.5) / cnt[s.disciplina] }; })
    .sort((a, b) => a.k - b.k || a.s.disciplina.localeCompare(b.s.disciplina, 'pt')).map(o => o.s);
}
function filaNovos(all) {
  const pend = all.filter(x => !x.s.estudoRealizado && !x.s.concluido);
  const marcados = pend.filter(x => x.s.dataEstudo).sort((a, b) => a.s.dataEstudo.localeCompare(b.s.dataEstudo) || a.s.numero - b.s.numero).map(x => x.s);
  return marcados.concat(intercalar(pend.filter(x => !x.s.dataEstudo).sort((a, b) => a.s.numero - b.s.numero).map(x => x.s)));
}
const filaPrimeiras = all => intercalar(all.filter(x => x.s.estudoRealizado && !x.s.concluido && x.d.numRevisoes === 0 && !x.d.proximaData).map(x => x.s).sort((a, b) => a.numero - b.numero));
function planejar(p, inicio) {
  const all = allDerived(); const mudou = new Set(); const res = {};
  if (p.novosPorDia > 0) {
    const fila = filaNovos(all); const datas = slots(inicio, p.novosPorDia, fila.length, p.dias);
    fila.forEach((s, i) => { if (s.dataEstudo !== datas[i] || s.ajuste) { s.dataEstudo = datas[i]; s.ajuste = null; mudou.add(s); } });
    if (fila.length) res.novos = { n: fila.length, fim: datas[datas.length - 1] };
  }
  if (p.revisoesPorDia > 0) {
    const fila = filaPrimeiras(all); const datas = slots(inicio, p.revisoesPorDia, fila.length, p.dias);
    fila.forEach((s, i) => { s.ajuste = { ref: 'inicio', data: datas[i] }; mudou.add(s); });
    if (fila.length) res.rev = { n: fila.length, fim: datas[datas.length - 1] };
  }
  if (mudou.size) dbUpsertSubjects(Array.from(mudou)); save(true); return res;
}
const resumoPlano = r => [r.novos ? `${r.novos.n} estudos até ${fmtBR(r.novos.fim)}` : '', r.rev ? `${r.rev.n} revisões até ${fmtBR(r.rev.fim)}` : ''].filter(Boolean).join(' · ') || 'Plano salvo';
const haDias = n => n <= 0 ? 'hoje' : n === 1 ? 'ontem' : `há ${n} dias`;
const quandoTxt = d => d.prazo === 'atrasada' ? `atrasada ${d.diasAtraso} ${d.diasAtraso === 1 ? 'dia' : 'dias'} (era ${fmtBR(d.proximaData)})` : d.prazo === 'hoje' ? 'hoje' : d.proximaData === addDays(todayISO(), 1) ? `amanhã, ${fmtDia(d.proximaData)}` : `${fmtDia(d.proximaData)}, em ${diffDays(todayISO(), d.proximaData)} dias`;
function proximoPasso(s, d) {
  const c = cfg(); const cls = statusCls({ s, d });
  if (s.concluido) return { titulo: 'Concluído', quando: 'fora da agenda', porque: 'Você marcou este assunto como concluído. Reative para ele voltar a gerar revisões.', cls: 's-feita' };
  if (!s.estudoRealizado) return { titulo: 'Estudar a teoria', quando: d.proximaData ? quandoTxt(d) : 'ainda sem data no plano', porque: 'Depois do estudo, a 1ª revisão por questões entra na agenda em 24 a 48 horas.', cls };
  if (!d.proximaData) return { titulo: 'Marcar a 1ª revisão', quando: 'sem data', porque: 'A teoria já foi vista, mas a revisão por questões ainda não tem data. Escolha uma abaixo ou use Meu plano para distribuir.', cls: '' };
  let porque;
  if (!d.numRevisoes) porque = s.dataEstudo ? `1ª revisão por questões depois do estudo de ${fmtBR(s.dataEstudo)}.` : '1ª revisão por questões do conteúdo já estudado.';
  else if (d.last.tipo === 'TEORIA') porque = 'Teoria revisada. Agora confirme com uma nova bateria de questões.';
  else {
    const f = faixaFor(d.last.pct);
    porque = d.proximaAtividade === 'TEORIA' ? `Você fez ${pctFmt(d.last.pct)} na última bateria, abaixo de ${c.limiteTeoria}%. Releia a teoria antes de novas questões.`
      : d.proximaAtividade === 'MANUTENCAO' ? `Acima de ${c.faixas[c.faixas.length - 1].min}% em sequência: revisão de manutenção a cada ${d.intervalo} dias.`
      : `Último resultado ${pctFmt(d.last.pct)} (${f.nome.toLowerCase()}): próxima em ${d.intervalo} dias, faixa de ${f.intMin} a ${f.intMax}.`;
  }
  if (d.ajustada) porque += ' Data ajustada manualmente.';
  return { titulo: TIPOS[d.proximaAtividade].label, quando: quandoTxt(d), porque, cls };
}

/* ===================== UI: infra ===================== */
const view = $('#view');
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2800); }
function openModal(html, onMount, opts = {}) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg" id="modal-bg"><div class="modal${opts.size === 'lg' ? ' modal-lg' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  const bg = $('#modal-bg'); bg.addEventListener('click', e => { if (e.target === bg) closeModal(); });
  $$('[data-close]', bg).forEach(b => b.addEventListener('click', closeModal));
  document.body.style.overflow = 'hidden'; if (onMount) onMount(bg);
  const first = $('input:not([type=hidden]),select,textarea,button.primary', bg); if (first && window.innerWidth >= 640) first.focus();
}
function closeModal() { $('#modal-root').innerHTML = ''; document.body.style.overflow = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
function setTab(tab) { state.ui.tab = tab; save(); render(); window.scrollTo({ top: 0 }); }
$$('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('#btn-novo').addEventListener('click', () => modalNovoAssunto());
function aplicarMenu() {
  let min = false; try { min = localStorage.getItem('revisa-nav-min') === '1'; } catch (e) { /* sem armazenamento */ }
  $('.app').classList.toggle('nav-min', min); const b = $('#nav-toggle'); const txt = min ? 'Expandir menu' : 'Recolher menu';
  b.setAttribute('aria-label', txt); b.title = txt; b.querySelector('span').textContent = txt; b.setAttribute('aria-expanded', String(!min));
}
$('#nav-toggle').addEventListener('click', () => { const min = !$('.app').classList.contains('nav-min'); try { localStorage.setItem('revisa-nav-min', min ? '1' : '0'); } catch (e) { /* sem armazenamento */ } aplicarMenu(); setTimeout(render, 220); });
aplicarMenu();
window.addEventListener('resize', () => { const nav = $('#k-nav'); if (nav) { const b = $('.kanban'); nav.hidden = !(b && b.scrollWidth > b.clientWidth + 2); } });
$('#fab-novo').addEventListener('click', () => modalNovoAssunto());
$('#sync').addEventListener('click', () => { toast('Sincronizando…'); syncNow(); });

function chipTipo(t) { const T = TIPOS[t]; return `<span class="chip ${T.cls}">${T.short}</span>`; }
function chipNivel(n) { const N = NIVEIS[n.n]; const arrow = n.tend > 0 ? ' <span class="tend-up">↗</span>' : n.tend < 0 ? ' <span class="tend-down">↘</span>' : ''; return `<span class="chip lvl">${N.emoji} ${N.nome}${arrow}</span>`; }
function nivelTexto(n) { const N = NIVEIS[n.n]; return `${N.emoji} ${N.nome}${n.tend > 0 ? ' (em evolução)' : n.tend < 0 ? ' (em queda)' : ''}`; }
function statusCls(x) { const { d } = x; if (d.prazo === 'atrasada') return 's-atrasada'; if (d.proximaAtividade === 'TEORIA') return 's-teoria'; if (d.prazo === 'hoje') return 's-hoje'; return ''; }
function acaoLabel(t) { return t === 'ESTUDO' ? 'Estudo feito' : t === 'TEORIA' ? 'Teoria feita' : 'Registrar'; }

function render() {
  if (!user) return;
  if (state.ui.tab === 'assuntos') state.ui.tab = 'materias';
  const tab = state.ui.tab || 'agenda';
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('.content').classList.toggle('wide', tab === 'agenda' && state.ui.agendaMode === 'kanban');
  const m = metrics(); const badge = m.atrasadas + m.hoje;
  const tabA = $('#tab-agenda'); let bd = $('.badge', tabA); if (badge > 0) { if (!bd) { bd = document.createElement('span'); bd.className = 'badge'; tabA.appendChild(bd); } bd.textContent = badge; } else if (bd) bd.remove();
  $('#topbar-date').textContent = fmtDiaLongo(todayISO());
  const titles = { agenda: 'Agenda', painel: 'Painel', materias: 'Matérias', historico: 'Histórico', config: 'Configurações' };
  $('#page-title').textContent = titles[tab];
  if (!state.loaded && !state.cached) { view.innerHTML = `<div class="empty">Carregando seus dados…</div>`; return; }
  ({ agenda: renderAgenda, painel: renderPainel, materias: renderMaterias, historico: renderHistorico, config: renderConfig })[tab](m);
}

/* ===================== AGENDA ===================== */
function itemHTML(x, opts = {}) {
  const { s, d } = x; const cls = statusCls(x); const meta = [];
  if (d.prazo === 'atrasada') meta.push(`<span class="chip s-atrasada">ATRASADA · ${d.diasAtraso} ${d.diasAtraso === 1 ? 'dia' : 'dias'}</span>`);
  else if (d.prazo === 'hoje') meta.push(`<span class="chip s-hoje">HOJE</span>`);
  else if (opts.showDate) meta.push(`<span class="muted">${fmtDia(d.proximaData)}</span>`);
  if (d.numRevisoes) meta.push(`<span>rev. ${d.numRevisoes + 1}</span>`); else meta.push(`<span>${d.proximaAtividade === 'ESTUDO' ? 'estudo inicial' : '1ª revisão'}</span>`);
  if (d.ultimoPct != null) meta.push(`<span class="num">último: ${pctFmt(d.ultimoPct)}</span>`);
  if (d.nivel.n) meta.push(`<span>${NIVEIS[d.nivel.n].emoji}</span>`);
  if (d.ajustada) meta.push(`<span class="muted">data ajustada</span>`);
  return `<div class="item ${cls}" data-open="${s.id}"><div class="body"><div class="title"><span class="disc">${esc(s.disciplina)}</span><span>${esc(s.assunto)}</span>${chipTipo(d.proximaAtividade)}</div><div class="meta">${meta.join('')}</div></div><div class="act"><button class="primary sm" data-registrar="${s.id}">${acaoLabel(d.proximaAtividade)}</button></div></div>`;
}
function renderAgenda(m) {
  const mode = state.ui.agendaMode || 'lista';
  let html = `<div class="toolbar"><div class="segment"><button data-mode="lista" class="${mode === 'lista' ? 'active' : ''}">Hoje e próximos</button><button data-mode="mes" class="${mode === 'mes' ? 'active' : ''}">Mês</button><button data-mode="kanban" class="${mode === 'kanban' ? 'active' : ''}">Kanban</button></div></div>`;
  html += mode === 'lista' ? agendaLista(m) : mode === 'mes' ? agendaMes(m) : agendaKanban(m);
  view.innerHTML = html;
  $$('[data-mode]', view).forEach(b => b.addEventListener('click', () => { state.ui.agendaMode = b.dataset.mode; save(); render(); }));
  bindItems(view); if (mode === 'mes') bindMes(); if (mode === 'kanban') bindKanban();
}
function agendaLista(m) {
  const t = todayISO(); const p = plano();
  if (!state.subjects.length) return `<div class="empty"><p><strong>Nenhum assunto cadastrado ainda.</strong></p><p style="margin-top:6px">Cadastre o primeiro assunto estudado e a primeira revisão será programada automaticamente.</p><div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap"><button class="primary" id="empty-novo">+ Novo assunto</button><button id="empty-exemplo">Carregar exemplos</button></div></div>`;
  const ag = m.ag.slice().sort((a, b) => a.d.proximaData.localeCompare(b.d.proximaData) || a.s.disciplina.localeCompare(b.s.disciplina, 'pt'));
  const pend = ag.filter(x => x.d.prazo !== 'futura');
  const teoria = pend.filter(x => x.d.proximaAtividade === 'TEORIA');
  const questoes = pend.filter(x => isQuestoes(x.d.proximaAtividade));
  const estudar = pend.filter(x => x.d.proximaAtividade === 'ESTUDO');
  const histHoje = state.history.filter(h => h.dataRealizada === t);
  const feitos = histHoje.length + state.subjects.filter(s => s.estudoRealizado && s.dataEstudo === t).length;
  const total = feitos + pend.length; const pct = total ? Math.round(feitos / total * 100) : 0;
  const metaQ = questoes.length * cfg().questoesRecomendadas; const qHoje = histHoje.reduce((a, h) => a + (Number(h.questoes) || 0), 0);
  const falta = p.dataProva ? diffDays(t, p.dataProva) : null;
  const sub = [feitos ? `${feitos} ${feitos === 1 ? 'feita' : 'feitas'}` : '', questoes.length ? `meta de ~${metaQ} questões` : '', qHoje ? `${qHoje} questões feitas hoje` : '', falta != null && falta >= 0 ? `faltam ${falta} dias para a prova` : ''].filter(Boolean).join(' · ');
  let h = `<section class="plan-card"><div class="plan-top"><div><span class="eyebrow">Plano de hoje · ${fmtDia(t)}</span><h2>${pend.length ? `${pend.length} ${pend.length === 1 ? 'atividade' : 'atividades'} para fazer` : feitos ? 'Tudo feito por hoje' : 'Nada marcado para hoje'}</h2><p class="small muted">${sub || 'Use Meu plano para o app organizar seus dias de estudo.'}</p></div><button class="sm" id="btn-plano">Meu plano</button></div>${total ? `<div class="progress" role="progressbar" aria-label="Progresso de hoje" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>` : ''}</section>`;
  const semData = m.all.filter(x => !x.s.estudoRealizado && !x.s.concluido && !x.s.dataEstudo).length;
  const semRev = m.all.filter(x => x.d.coluna === 'estudado').length;
  const estAtras = m.all.filter(x => !x.s.estudoRealizado && !x.s.concluido && x.s.dataEstudo && x.s.dataEstudo < t).length;
  const hint = (txt, btn, id) => `<div class="hint"><span>${txt}</span><button class="sm primary" id="${id}">${btn}</button></div>`;
  const faltaTxt = [semData ? `${semData} ${semData === 1 ? 'assunto novo' : 'assuntos novos'} sem data para estudar` : '', semRev ? `${semRev} ${semRev === 1 ? 'estudado' : 'estudados'} sem revisão marcada` : ''].filter(Boolean).join(' e ');
  if (!cfg().plano && faltaTxt) h += hint(`<strong>Deixe o app organizar seus estudos.</strong> Há ${faltaTxt}.`, 'Montar meu plano', 'hint-plano');
  else if (estAtras >= 3) h += hint(`<strong>${estAtras} estudos ficaram para trás.</strong> Reorganize o plano a partir de hoje, mantendo a ordem.`, 'Reorganizar', 'hint-replan');
  else if (faltaTxt) h += hint(`Há ${faltaTxt}.`, 'Encaixar no plano', 'hint-replan');
  const sec = (titulo, desc, itens) => itens.length ? `<section class="section"><div class="section-head"><div><h2>${titulo}</h2><p class="small muted">${desc}</p></div><span class="count">${itens.length}</span></div><div class="stack">${itens.map(x => itemHTML(x)).join('')}</div></section>` : '';
  if (!pend.length) h += `<div class="empty section">${feitos ? 'Você fez tudo o que estava marcado para hoje.' : 'Nada marcado para hoje.'}</div>`;
  h += sec('Revisar teoria', `Acerto abaixo de ${cfg().limiteTeoria}% na última bateria: releia antes de novas questões.`, teoria);
  h += sec('Questões', 'Revisões por questões de hoje e atrasadas, das mais antigas para as mais novas.', questoes);
  h += sec('Estudar teoria nova', 'Assuntos novos do seu plano para hoje.', estudar);
  const prox = ag.filter(x => x.d.proximaData > t && x.d.proximaData <= addDays(t, 7));
  h += `<section class="section"><div class="section-head"><h2>Próximos 7 dias</h2><span class="count">${prox.length}</span></div>`;
  if (!prox.length) h += `<div class="empty">Nada marcado para os próximos 7 dias.</div>`;
  else {
    let cur = null;
    prox.forEach(x => {
      if (x.d.proximaData !== cur) {
        if (cur) h += `</div>`; cur = x.d.proximaData; const dia = prox.filter(y => y.d.proximaData === cur);
        const nE = dia.filter(y => y.d.proximaAtividade === 'ESTUDO').length, nR = dia.length - nE;
        h += `<div class="day-head">${fmtDia(cur)} <span class="n">${[nR ? `${nR} ${nR === 1 ? 'revisão' : 'revisões'}` : '', nE ? `${nE} ${nE === 1 ? 'estudo novo' : 'estudos novos'}` : ''].filter(Boolean).join(' · ')}</span></div><div class="stack">`;
      }
      h += itemHTML(x);
    });
    h += `</div>`;
  }
  return h + `</section>`;
}
function modalPlano() {
  const p = plano(); const t = todayISO(); const all = allDerived();
  const nNovos = filaNovos(all).length, nRev = filaPrimeiras(all).length;
  const DN = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  openModal(`<form id="f-plano" class="stack" style="gap:12px"><h2>Meu plano de estudos</h2>
    <p class="small muted">O app distribui pelos seus dias de estudo os assuntos que faltam estudar e as primeiras revisões ainda sem data. As revisões seguintes continuam automáticas, pelo seu desempenho.</p>
    <div class="row2"><label>Data da prova<input type="date" name="prova" value="${p.dataProva || ''}"></label><label>Começar em<input type="date" name="inicio" value="${t}" min="${t}" required></label></div>
    <div class="row2"><label>Assuntos novos por dia<input type="number" name="novos" min="0" max="20" value="${p.novosPorDia}" inputmode="numeric" required></label><label>1ªs revisões pendentes por dia<input type="number" name="rev" min="0" max="50" value="${p.revisoesPorDia}" inputmode="numeric" required></label></div>
    <div><span class="eyebrow">Dias de estudo</span><div class="dias-sel">${DN.map((n, i) => `<label class="dia"><input type="checkbox" name="dia" value="${i}" ${p.dias.includes(i) ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div></div>
    <div class="preview" id="plano-prev"></div>
    <div class="actions"><button type="button" data-close>Cancelar</button><button class="primary" type="submit">Organizar minha agenda</button></div></form>`, () => {
    const f = $('#f-plano');
    const ler = () => ({ dataProva: f.prova.value || null, novosPorDia: Math.max(0, Number(f.novos.value) || 0), revisoesPorDia: Math.max(0, Number(f.rev.value) || 0), dias: $$('input[name=dia]:checked', f).map(i => Number(i.value)) });
    const prev = () => {
      const q = ler(); const ini = f.inicio.value || t; const el = $('#plano-prev');
      if (!q.dias.length) { el.innerHTML = '<span class="txt-red">Escolha pelo menos um dia de estudo.</span>'; return; }
      const linhas = [];
      if (nNovos && q.novosPorDia) {
        const fim = slots(ini, q.novosPorDia, nNovos, q.dias).pop();
        linhas.push(`<span><b>${nNovos}</b> assuntos novos, ${q.novosPorDia} por dia: de ${fmtBRFull(proximoDiaEstudo(ini, q.dias))} a <strong>${fmtBRFull(fim)}</strong>.</span>`);
        if (q.dataProva) {
          const limite = addDays(q.dataProva, -30);
          if (fim > limite) { const disp = diasEstudoEntre(ini, limite, q.dias); const need = disp > 0 ? Math.ceil(nNovos / disp) : null; linhas.push(`<span class="txt-red">Passa de ${fmtBRFull(limite)}, 30 dias antes da prova.${need ? ` Para chegar a tempo, estude <button type="button" class="linkbtn" id="usar-ritmo" data-n="${need}">${need} por dia</button>.` : ''}</span>`); }
          else linhas.push(`<span class="txt-green">A teoria termina ${diffDays(fim, q.dataProva)} dias antes da prova, com tempo para revisar.</span>`);
        }
      } else if (nNovos) linhas.push('<span>Assuntos novos não serão agendados (0 por dia).</span>');
      if (nRev && q.revisoesPorDia) linhas.push(`<span><b>${nRev}</b> primeiras revisões pendentes, ${q.revisoesPorDia} por dia: até <strong>${fmtBRFull(slots(ini, q.revisoesPorDia, nRev, q.dias).pop())}</strong>.</span>`);
      if (!nNovos && !nRev) linhas.push('<span>Tudo já tem data. Salve para guardar a data da prova e o ritmo.</span>');
      el.innerHTML = linhas.join('');
      const u = $('#usar-ritmo'); if (u) u.addEventListener('click', () => { f.novos.value = u.dataset.n; prev(); });
    };
    f.addEventListener('input', prev); f.addEventListener('change', prev); prev();
    f.addEventListener('submit', e => {
      e.preventDefault(); const q = ler(); if (!q.dias.length) return toast('Escolha pelo menos um dia de estudo.');
      cfg().plano = q; dbSaveConfig(); const r = planejar(q, f.inicio.value || t); closeModal(); render(); toast(resumoPlano(r));
    });
  });
}
function modalAgendarRevisao(id) {
  const s = findSubject(id); if (!s) return; const t = todayISO();
  openModal(`<form id="f-ag" class="stack" style="gap:12px"><h2>Quando fazer a 1ª revisão?</h2><p class="muted"><span class="eyebrow">${esc(s.disciplina)}</span><br><strong style="color:var(--ink)">${esc(s.assunto)}</strong></p>
    <div class="quick-dates"><button type="button" data-q="0">Hoje</button><button type="button" data-q="1">Amanhã</button><button type="button" data-q="2">Em 2 dias</button></div>
    <label>Ou escolha a data<input type="date" name="data" value="${t}" min="${t}" required></label>
    <div class="actions"><button type="button" data-close>Cancelar</button><button class="primary" type="submit">Marcar revisão</button></div></form>`, bg => {
    const f = $('#f-ag'); const ok = iso => { ajustarData(id, iso); closeModal(); render(); toast(`Revisão marcada para ${iso === t ? 'hoje' : fmtBR(iso)}`); };
    $$('[data-q]', bg).forEach(b => b.addEventListener('click', () => ok(addDays(t, Number(b.dataset.q)))));
    f.addEventListener('submit', e => { e.preventDefault(); if (f.data.value) ok(f.data.value); });
  });
}
function monthItems(mes) {
  const items = [];
  allDerived().forEach(x => { if (x.d.proximaData && x.d.proximaData.slice(0, 7) === mes) items.push({ date: x.d.proximaData, kind: 'pend', x, cls: statusCls(x), label: `${x.s.disciplina} — ${x.s.assunto}`, ativ: TIPOS[x.d.proximaAtividade].short }); });
  state.history.forEach(h => { if (h.dataRealizada.slice(0, 7) === mes) items.push({ date: h.dataRealizada, kind: 'feita', h, cls: 's-feita', label: `${h.disciplina} — ${h.assunto}`, ativ: `${TIPOS[h.tipo].short}${h.pct != null ? ' · ' + pctFmt(h.pct) : ''}` }); });
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'pend' ? -1 : 1)); return items;
}
function agendaMes() {
  const mes = state.ui.mes || todayISO().slice(0, 7); const [y, mo] = mes.split('-').map(Number); const items = monthItems(mes);
  const startDow = new Date(y, mo - 1, 1).getDay(); const daysIn = new Date(y, mo, 0).getDate(); const t = todayISO();
  const sel = state.ui.diaSel && state.ui.diaSel.slice(0, 7) === mes ? state.ui.diaSel : null; const subMode = state.ui.mesView || 'cal';
  const opts = new Set(); const base = new Date(); for (let i = -3; i <= 12; i++) opts.add(toISO(new Date(base.getFullYear(), base.getMonth() + i, 1)).slice(0, 7));
  state.history.forEach(h => opts.add(h.dataRealizada.slice(0, 7))); allDerived().forEach(x => { if (x.d.proximaData) opts.add(x.d.proximaData.slice(0, 7)); }); opts.add(mes);
  let h = `<div class="cal-nav"><button class="sm" id="mes-prev" aria-label="Mês anterior">‹</button><h2>${MESES[mo - 1]} ${y}</h2><button class="sm" id="mes-next" aria-label="Próximo mês">›</button></div>`;
  h += `<div class="toolbar"><select id="mes-sel" aria-label="Mês selecionado">${Array.from(opts).sort().map(k => `<option value="${k}" ${k === mes ? 'selected' : ''}>${MESES[Number(k.slice(5, 7)) - 1]}/${k.slice(0, 4)}</option>`).join('')}</select><div class="segment view-toggle"><button data-mesview="cal" class="${subMode === 'cal' ? 'active' : ''}">Calendário</button><button data-mesview="lista" class="${subMode === 'lista' ? 'active' : ''}">Lista</button></div></div>`;
  if (subMode === 'cal') {
    h += `<div class="cal">${DIAS.map(d => `<div class="dow">${d}</div>`).join('')}`;
    for (let i = 0; i < startDow; i++) h += `<div class="cell other" aria-hidden="true"></div>`;
    for (let d = 1; d <= daysIn; d++) { const iso = `${mes}-${pad(d)}`; const its = items.filter(i => i.date === iso); h += `<div class="cell ${iso === t ? 'today' : ''} ${iso === sel ? 'sel' : ''}" data-dia="${iso}"><span class="d">${d}</span><div class="dots">${its.slice(0, 6).map(i => `<span class="dot ${i.cls}"></span>`).join('')}</div>${its.slice(0, 3).map(i => `<span class="mini ${i.cls}" title="${esc(i.label)} · ${esc(i.ativ)}">${esc(i.label)}</span>`).join('')}${its.length > 3 ? `<span class="more">+${its.length - 3}</span>` : ''}</div>`; }
    h += `</div><div class="legend"><span style="--c:var(--red)">Atrasada</span><span style="--c:var(--amber)">Hoje</span><span style="--c:var(--orange)">Revisão teórica</span><span style="--c:var(--blue)">Programada</span><span style="--c:var(--green)">Realizada</span></div>`;
    const showDay = sel || (mes === t.slice(0, 7) ? t : null);
    if (showDay) { const its = items.filter(i => i.date === showDay); h += `<section class="section" style="margin-top:16px"><div class="section-head"><h2>${fmtDiaLongo(showDay)}</h2><span class="count">${its.length}</span></div>${its.length ? `<div class="stack">${its.map(i => i.kind === 'pend' ? itemHTML(i.x) : feitaHTML(i.h)).join('')}</div>` : `<div class="empty">Nada neste dia.</div>`}</section>`; }
  } else if (!items.length) h += `<div class="empty">Nenhuma atividade em ${MESES[mo - 1]} de ${y}.</div>`;
  else {
    h += `<div class="tablewrap desktop-only"><table><thead><tr><th>Data</th><th>Dia</th><th>Disciplina</th><th>Assunto</th><th>Atividade</th><th>Situação</th></tr></thead><tbody>`;
    items.forEach(i => { const dd = parseISO(i.date); const sit = i.kind === 'feita' ? '<span class="chip s-feita">REALIZADA</span>' : i.x.d.prazo === 'atrasada' ? '<span class="chip s-atrasada">ATRASADA</span>' : i.x.d.prazo === 'hoje' ? '<span class="chip s-hoje">HOJE</span>' : '<span class="chip">PROGRAMADA</span>'; h += `<tr class="row-click ${i.cls}" data-open="${i.kind === 'pend' ? i.x.s.id : i.h.subjectId}"><td class="num">${fmtBR(i.date)}</td><td>${DIAS[dd.getDay()]}</td><td>${esc(i.kind === 'pend' ? i.x.s.disciplina : i.h.disciplina)}</td><td class="wrap">${esc(i.kind === 'pend' ? i.x.s.assunto : i.h.assunto)}</td><td>${i.kind === 'pend' ? chipTipo(i.x.d.proximaAtividade) : chipTipo(i.h.tipo) + (i.h.pct != null ? ` <span class="num">${pctFmt(i.h.pct)}</span>` : '')}</td><td>${sit}</td></tr>`; });
    h += `</tbody></table></div>`;
    let dia = null; h += '<div class="mobile-only">'; items.forEach(it => { if (it.date !== dia) { if (dia) h += '</div>'; dia = it.date; h += `<div class="day-head">${fmtDia(dia)}</div><div class="stack">`; } h += it.kind === 'pend' ? itemHTML(it.x) : feitaHTML(it.h); }); h += '</div></div>';
  }
  return h;
}
function feitaHTML(h) { return `<div class="item s-feita" data-open="${h.subjectId}"><div class="body"><div class="title"><span class="disc">${esc(h.disciplina)}</span><span>${esc(h.assunto)}</span>${chipTipo(h.tipo)}</div><div class="meta"><span class="chip s-feita">REALIZADA</span>${h.pct != null ? `<span class="num">${h.acertos}/${h.questoes} · ${pctFmt(h.pct)}</span>` : ''}<span>próxima: ${TIPOS[h.proximaAtividade].short.toLowerCase()} em ${fmtBR(h.proximaData)}</span></div></div></div>`; }
function bindMes() {
  const mes = state.ui.mes || todayISO().slice(0, 7);
  const shift = n => { const [y, m] = mes.split('-').map(Number); state.ui.mes = toISO(new Date(y, m - 1 + n, 1)).slice(0, 7); state.ui.diaSel = null; save(); render(); };
  $('#mes-prev').addEventListener('click', () => shift(-1)); $('#mes-next').addEventListener('click', () => shift(1));
  $('#mes-sel').addEventListener('change', e => { state.ui.mes = e.target.value; state.ui.diaSel = null; save(); render(); });
  $$('[data-mesview]', view).forEach(b => b.addEventListener('click', () => { state.ui.mesView = b.dataset.mesview; save(); render(); }));
  $$('[data-dia]', view).forEach(c => c.addEventListener('click', () => { state.ui.diaSel = c.dataset.dia; save(); render(); }));
}
function bindItems(root) {
  $$('[data-registrar]', root).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); modalRegistrar(b.dataset.registrar); }));
  $$('[data-open]', root).forEach(el => el.addEventListener('click', () => modalAssunto(el.dataset.open)));
  const en = $('#empty-novo', root); if (en) en.addEventListener('click', () => modalNovoAssunto());
  const ex = $('#empty-exemplo', root); if (ex) ex.addEventListener('click', carregarExemplos);
  const bp = $('#btn-plano', root); if (bp) bp.addEventListener('click', modalPlano);
  const hp = $('#hint-plano', root); if (hp) hp.addEventListener('click', modalPlano);
  const hr = $('#hint-replan', root); if (hr) hr.addEventListener('click', () => { const r = planejar(plano(), todayISO()); render(); toast(resumoPlano(r)); });
  const gk = $('#go-kanban', root); if (gk) gk.addEventListener('click', () => { state.ui.agendaMode = 'kanban'; save(); render(); window.scrollTo({ top: 0 }); });
}

/* ===================== KANBAN ===================== */
const COLS = [
  { id: 'assuntos', nome: 'Assuntos', desc: 'teoria ainda não estudada' },
  { id: 'estudado', nome: 'Estudado', desc: 'teoria vista, sem revisão marcada' },
  { id: 'revisar', nome: 'Para revisar', desc: 'revisão marcada e pendente' },
  { id: 'revisado', nome: 'Revisado', desc: 'em dia, volta na próxima data' },
  { id: 'concluido', nome: 'Concluído', desc: 'domínio consolidado' },
];
const colNome = id => (COLS.find(c => c.id === id) || {}).nome || id;
function kanbanCard(x) {
  const { s, d } = x; const chips = [];
  const prazoChip = txt => `<span class="chip ${d.prazo === 'atrasada' ? 's-atrasada' : d.prazo === 'hoje' ? 's-hoje' : ''}">${txt}</span>`;
  if (d.coluna === 'assuntos') { if (d.proximaData) chips.push(prazoChip(`estudar ${d.prazo === 'hoje' ? 'hoje' : fmtBR(d.proximaData)}`)); }
  else if (s.concluido) chips.push('<span class="chip s-feita">CONCLUÍDO</span>');
  else if (!d.proximaData) chips.push('<span class="chip">sem revisão agendada</span>');
  else { chips.push(chipTipo(d.proximaAtividade)); chips.push(prazoChip(d.prazo === 'atrasada' ? `atrasada ${d.diasAtraso}d` : d.prazo === 'hoje' ? 'hoje' : fmtBR(d.proximaData))); }
  const revs = `${d.numRevisoes} ${d.numRevisoes === 1 ? 'revisão' : 'revisões'}`;
  const stats = d.totQuestoes
    ? `<div class="kstats num"><span class="ks ok"><b>${d.totAcertos}</b>acertos</span><span class="ks err"><b>${d.totErros}</b>erros</span><span class="ks"><b>${d.pctGeral}%</b>de acerto</span></div><div class="kmeta">${d.totQuestoes} questões · ${revs} · última ${pctFmt(d.ultimoPct)}${d.nivel.n ? ' · ' + NIVEIS[d.nivel.n].emoji : ''}${d.nivel.tend > 0 ? ' ↗' : d.nivel.tend < 0 ? ' ↘' : ''}</div>`
    : `<div class="kmeta">${d.numRevisoes ? revs + ' · ' : ''}sem questões registradas</div>`;
  return `<div class="kcard ${statusCls(x)}" draggable="true" data-kid="${s.id}" data-open="${s.id}"><div class="khead"><span class="eyebrow kdisc">${esc(s.disciplina)}</span><button class="ghost sm kmove" data-mover="${s.id}" aria-label="Mover ${esc(s.assunto)}" title="Mover para outra coluna">⋯</button></div><strong class="ktitle">${esc(s.assunto)}</strong>${chips.length ? `<div class="kchips">${chips.join('')}</div>` : ''}${stats}</div>`;
}
function kanbanLista() {
  const f = state.ui.kfiltro || {}; const q = normNome(f.q);
  return allDerived().filter(x => (!q || normNome(x.s.assunto + ' ' + x.s.disciplina).includes(q)) && (!f.disc || x.s.disciplina === f.disc));
}
function agendaKanban() {
  const f = state.ui.kfiltro || {};
  const discs = Array.from(new Set(state.subjects.map(s => s.disciplina))).sort((a, b) => a.localeCompare(b, 'pt'));
  const list = kanbanLista();
  const porDisc = (a, b) => a.s.disciplina.localeCompare(b.s.disciplina, 'pt') || a.s.numero - b.s.numero;
  const porData = (a, b) => (a.d.proximaData || '9999').localeCompare(b.d.proximaData || '9999') || porDisc(a, b);
  let h = `<div class="toolbar"><input class="search" id="k-q" placeholder="Buscar assunto…" value="${esc(f.q || '')}"><select id="k-disc" aria-label="Disciplina"><option value="">Todas as disciplinas</option>${discs.map(d => `<option ${f.disc === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></div>`;
  if (!state.subjects.length) return h + `<div class="empty"><p><strong>Nenhum assunto ainda.</strong></p><div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap"><button class="primary" id="k-importar">Importar lista de assuntos</button></div></div>`;
  h += `<div class="kanban-bar"><details class="kinfo"><summary>Como as colunas funcionam</summary><ul><li><b>Assuntos</b>: ainda não estudou a teoria. Com o plano, cada um ganha uma data para estudar.</li><li><b>Estudado</b>: teoria vista, mas sem revisão marcada. Use Marcar revisões ou o plano.</li><li><b>Para revisar</b>: tem revisão marcada e ainda não feita, seja a 1ª revisão, uma revisão de hoje, uma atrasada ou uma revisão de teoria.</li><li><b>Revisado</b>: revisão feita e em dia. Volta para Para revisar quando chega a próxima data.</li><li><b>Concluído</b>: acerto alto em sequência (manutenção) ou marcado por você.</li></ul><p>Arraste os cards ou toque em ⋯ para mover. O que muda aqui muda também na agenda.</p></details><div class="kanban-nav" id="k-nav" hidden><button class="sm" id="k-prev" aria-label="Ver colunas anteriores">‹</button><button class="sm" id="k-next" aria-label="Ver próximas colunas">›</button></div></div><div class="kanban">`;
  COLS.forEach(c => {
    const items = list.filter(x => x.d.coluna === c.id).sort(c.id === 'concluido' ? porDisc : porData);
    const semData = c.id === 'estudado' ? items.filter(x => !x.d.proximaData && x.d.numRevisoes === 0).length : 0;
    h += `<section class="kcol" data-col="${c.id}"><header class="kcol-head"><div><h3>${c.nome}</h3><span class="small muted">${c.desc}</span></div><span class="kcount num">${items.length}</span></header>`;
    if (semData) h += `<div class="kcol-tools"><button class="sm primary" id="k-lote">Marcar ${semData} ${semData === 1 ? 'revisão' : 'revisões'}</button></div>`;
    const lim = (state.ui.kLim || {})[c.id] || 20; const resto = items.length - lim;
    h += `<div class="kcol-body" data-drop="${c.id}">${items.length ? items.slice(0, lim).map(kanbanCard).join('') + (resto > 0 ? `<button class="kmore" data-kmore="${c.id}">Mostrar mais ${Math.min(20, resto)} · ${resto} ${resto === 1 ? 'restante' : 'restantes'}</button>` : '') : '<div class="kempty">Arraste um card para cá</div>'}</div></section>`;
  });
  return h + `</div>`;
}
function bindKanban() {
  const upd = () => { state.ui.kfiltro = { q: $('#k-q').value, disc: $('#k-disc').value }; save(); render(); if (state.ui._focusK) { const i = $('#k-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } };
  $('#k-q').addEventListener('input', () => { state.ui._focusK = true; upd(); });
  $('#k-disc').addEventListener('change', () => { state.ui._focusK = false; upd(); });
  const imp = $('#k-importar'); if (imp) imp.addEventListener('click', () => { const n = importarLista(); render(); toast(`${n} assuntos importados`); });
  const lote = $('#k-lote'); if (lote) lote.addEventListener('click', () => modalAgendarLote(kanbanLista().filter(x => x.d.coluna === 'estudado' && !x.d.proximaData && x.d.numRevisoes === 0).map(x => x.s)));
  $$('[data-mover]', view).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); modalMover(b.dataset.mover); }));
  $$('[data-kmore]', view).forEach(b => b.addEventListener('click', () => { const k = state.ui.kLim || (state.ui.kLim = {}); k[b.dataset.kmore] = (k[b.dataset.kmore] || 20) + 20; save(); render(); }));
  const board = $('.kanban', view), nav = $('#k-nav'), prev = $('#k-prev'), next = $('#k-next');
  if (board && nav) {
    const passo = () => { const col = $('.kcol', board); return col ? col.getBoundingClientRect().width + 12 : 230; };
    const upd = () => { const over = board.scrollWidth > board.clientWidth + 2; nav.hidden = !over; prev.disabled = board.scrollLeft <= 2; next.disabled = board.scrollLeft + board.clientWidth >= board.scrollWidth - 2; };
    prev.addEventListener('click', () => board.scrollBy({ left: -passo() })); next.addEventListener('click', () => board.scrollBy({ left: passo() }));
    board.addEventListener('scroll', upd, { passive: true }); upd(); requestAnimationFrame(upd);
  }
  $$('.kcard', view).forEach(c => {
    c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', c.dataset.kid); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
    c.addEventListener('dragend', () => { c.classList.remove('dragging'); $$('.kcol-body.over', view).forEach(z => z.classList.remove('over')); });
  });
  $$('[data-drop]', view).forEach(z => {
    z.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; z.classList.add('over'); });
    z.addEventListener('dragleave', e => { if (!z.contains(e.relatedTarget)) z.classList.remove('over'); });
    z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('over'); const id = e.dataTransfer.getData('text/plain'); if (id) moveTo(id, z.dataset.drop); });
  });
}
// Move um assunto de coluna e aplica a ação equivalente na agenda.
function moveTo(id, col) {
  const s = findSubject(id); if (!s) return; const d = derive(s); const t = todayISO();
  if (d.coluna === col) return;
  const done = msg => { dbUpsertSubject(s); save(); render(); toast(msg); };
  if (col === 'concluido') {
    if (!confirm(`Marcar "${s.assunto}" como concluído?\n\nEle sai da agenda e não gera novas revisões. Para reativar, mova o card para outra coluna.`)) return;
    s.concluido = true; s.ajuste = null; return done('Assunto concluído e retirado da agenda');
  }
  if (col === 'assuntos') {
    if (d.numRevisoes) return toast('Este assunto já tem revisões. Para voltar, desfaça as revisões no Histórico.');
    Object.assign(s, { estudoRealizado: false, dataEstudo: null, ajuste: null, concluido: false }); return done('Voltou para Assuntos, fora da agenda');
  }
  if (!s.estudoRealizado) { s.concluido = false; return modalRegistrar(id, 'Registre o estudo da teoria. A 1ª revisão por questões entra na agenda automaticamente.'); }
  if (col === 'estudado') {
    if (d.numRevisoes) return toast('Este assunto já foi revisado. Ele só volta para Estudado se as revisões forem desfeitas no Histórico.');
    s.concluido = false; s.ajuste = { ref: 'inicio', semAgenda: true }; return done('Revisão retirada da agenda');
  }
  if (col === 'revisar') { if (!d.numRevisoes) return modalAgendarRevisao(id); s.concluido = false; const d2 = derive(s); s.ajuste = { ref: d2.ref, data: t }; return done(`${TIPOS[d2.proximaAtividade].label} antecipada para hoje`); }
  if (col === 'revisado') return modalRegistrar(id);
}
function modalMover(id) {
  const s = findSubject(id); if (!s) return; const d = derive(s);
  const acao = { assuntos: 'volta a estudar e sai da agenda', estudado: s.estudoRealizado ? 'tira a revisão da agenda' : 'registra o estudo da teoria', revisar: s.estudoRealizado ? (d.numRevisoes ? 'antecipa a revisão para hoje' : 'escolhe a data da 1ª revisão') : 'registra o estudo da teoria', revisado: s.estudoRealizado ? 'registra questões e acertos' : 'registra o estudo da teoria', concluido: 'sai da agenda' };
  openModal(`<div class="stack" style="gap:12px"><div><span class="eyebrow">${esc(s.disciplina)}</span><h2>${esc(s.assunto)}</h2><p class="small muted">Está em <strong>${colNome(d.coluna)}</strong>. Mover para:</p></div><div class="move-list">${COLS.map(c => `<button data-col="${c.id}" ${c.id === d.coluna ? 'disabled' : ''}>${c.nome}<small>${c.id === d.coluna ? 'coluna atual' : acao[c.id]}</small></button>`).join('')}</div><div class="actions"><button data-close>Cancelar</button></div></div>`, bg => {
    $$('[data-col]', bg).forEach(b => b.addEventListener('click', () => { closeModal(); moveTo(id, b.dataset.col); }));
  });
}
function modalAgendarLote(subs) {
  if (!subs.length) return toast('Nenhum assunto estudado sem revisão.'); const t = todayISO(); const p = plano();
  openModal(`<form id="f-lote" class="stack" style="gap:12px"><h2>Marcar revisões</h2><p class="small muted">${subs.length} ${subs.length === 1 ? 'assunto estudado está' : 'assuntos estudados estão'} sem revisão marcada. O app distribui as primeiras revisões por questões nos seus dias de estudo, alternando as matérias. Os cards vão para Para revisar.</p>
    <div class="row2"><label>Revisões por dia<input type="number" name="porDia" min="1" max="50" value="${p.revisoesPorDia || 5}" inputmode="numeric" required></label><label>A partir de<input type="date" name="inicio" value="${t}" min="${t}" required></label></div>
    <div class="preview" id="lote-prev"></div><div class="actions"><button type="button" data-close>Cancelar</button><button class="primary" type="submit">Marcar revisões</button></div></form>`, () => {
    const f = $('#f-lote');
    const prev = () => { const n = Math.max(1, Number(f.porDia.value) || 1); const ini = f.inicio.value || t; const ds = slots(ini, n, subs.length, p.dias); $('#lote-prev').innerHTML = `<span>${subs.length} ${subs.length === 1 ? 'revisão' : 'revisões'}, ${n} por dia de estudo: de <strong class="num">${fmtBRFull(ds[0])}</strong> a <strong class="num">${fmtBRFull(ds[ds.length - 1])}</strong>.</span>`; };
    f.porDia.addEventListener('input', prev); f.inicio.addEventListener('input', prev); prev();
    f.addEventListener('submit', e => {
      e.preventDefault(); const n = Math.max(1, Number(f.porDia.value) || 1);
      const fila = intercalar(subs.slice().sort((a, b) => a.numero - b.numero)); const datas = slots(f.inicio.value || t, n, fila.length, p.dias);
      fila.forEach((s, i) => { s.ajuste = { ref: 'inicio', data: datas[i] }; s.concluido = false; });
      dbUpsertSubjects(fila); save(true); closeModal(); render(); toast(`${fila.length} revisões marcadas até ${fmtBR(datas[datas.length - 1])}`);
    });
  });
}

/* ===================== PAINEL ===================== */
function renderPainel(m) {
  const t = todayISO(); const p = plano(); const qh = qReviews(); const G = agg(qh); const tr = tendencia(qh);
  const est = m.all.filter(x => x.s.estudoRealizado).length; const cob = m.total ? Math.round(est / m.total * 100) : 0; const seq = diasSeguidos();
  const ds = statsDisciplinas(m.all); const pri = prioridades(m.all);
  let h = '';
  if (p.dataProva) {
    const falta = diffDays(t, p.dataProva); const fimNovos = m.all.filter(x => !x.s.estudoRealizado && !x.s.concluido && x.s.dataEstudo).map(x => x.s.dataEstudo).sort().pop();
    h += `<section class="prova-card"><div><span class="eyebrow">Prova · ${fmtBRFull(p.dataProva)}</span><strong>${falta > 0 ? `Faltam ${falta} dias` : falta === 0 ? 'É hoje' : 'Prova realizada'}</strong></div><div class="small">${fimNovos ? `No ritmo do plano, a teoria termina em <strong>${fmtBRFull(fimNovos)}</strong>.` : est === m.total ? 'Toda a teoria já foi vista.' : 'Monte o plano para ver quando a teoria termina.'}</div></section>`;
  }
  const hero = [
    { v: `${cob}%`, l: `da teoria vista · ${est} de ${m.total} assuntos`, bar: cob },
    { v: pctFmt(G.pct), l: `acerto geral · ${tendTxt(tr)}` },
    { v: G.q, l: `questões feitas · ${G.a} acertos · ${G.e} erros` },
    { v: seq, l: seq === 1 ? 'dia seguido estudando' : 'dias seguidos estudando' },
  ];
  h += `<div class="grid hero section">${hero.map(x => `<div class="metric"><span class="v num">${x.v}</span><span class="l">${x.l}</span>${x.bar != null ? `<div class="progress sm"><i style="width:${x.bar}%"></i></div>` : ''}</div>`).join('')}</div>`;
  const strip = [[m.hoje, 'para hoje', m.hoje ? 'today' : ''], [m.atrasadas, 'atrasadas', m.atrasadas ? 'alert' : ''], [m.prox7, 'nos próximos 7 dias', ''], [m.teoria, 'para revisar teoria', m.teoria ? 'theory' : ''], [m.noMes, `revisões em ${MESES[Number(t.slice(5, 7)) - 1]}`, ''], [m.noPrazo == null ? '—' : m.noPrazo + '%', 'revisões feitas no prazo', ''], [m.dominioAlto, 'assuntos com domínio alto', 'good'], [m.total, 'assuntos cadastrados', '']];
  h += `<div class="stat-strip section">${strip.map(([v, l, c]) => `<div class="stat ${c}"><b class="num">${v}</b><span>${l}</span></div>`).join('')}</div>`;
  const fracasD = ds.filter(d => d.g.q >= 10 && nivelDePct(d.g.pct) <= 2).sort((a, b) => a.g.pct - b.g.pct);
  h += `<section class="card section"><div class="section-head"><div><h2>Onde dar um gás</h2><p class="small muted">Assuntos com acerto baixo, em queda ou com revisão atrasada, em ordem de prioridade.</p></div><span class="count">${pri.length}</span></div>`;
  h += pri.length ? `<div class="stack">${pri.slice(0, 8).map(prioRow).join('')}</div>` : `<div class="empty">Nenhum ponto de atenção agora. Continue registrando suas questões.</div>`;
  if (fracasD.length) h += `<p class="small" style="margin-top:12px">Matérias abaixo de 70%: ${fracasD.map(d => `<button class="linkbtn" data-disc="${esc(d.nome)}">${esc(d.nome)} (${d.g.pct}%)</button>`).join(', ')}.</p>`;
  h += `</section>`;
  const ord = ds.slice().sort((a, b) => gasDisc(b) - gasDisc(a));
  h += `<section class="section"><div class="section-head"><div><h2>Desempenho por matéria</h2><p class="small muted">Da que mais precisa de atenção para a mais forte. Toque para ver os detalhes.</p></div></div><div class="tablewrap desktop-only"><table class="tbl-mat"><thead><tr><th>Matéria</th><th>Teoria vista</th><th>Questões</th><th>Acerto</th><th>Últimos 30 dias</th><th>Situação</th></tr></thead><tbody>${ord.map(d => `<tr class="row-click" data-disc="${esc(d.nome)}"><td><strong>${esc(d.nome)}</strong></td><td><div class="cov"><div class="bar"><i style="width:${d.cob}%"></i></div><span class="num small">${d.estudados}/${d.total}</span></div></td><td class="num">${d.g.q}</td><td class="num"><strong>${pctFmt(d.g.pct)}</strong></td><td class="small">${tendTxt(d.t)}</td><td>${chipSit(d.g)}</td></tr>`).join('')}</tbody></table></div><div class="stack mobile-only">${ord.map(d => `<button class="mrow" data-disc="${esc(d.nome)}"><div class="mrow-top"><strong>${esc(d.nome)}</strong>${chipSit(d.g)}</div><div class="cov"><div class="bar"><i style="width:${d.cob}%"></i></div><span class="num small">${d.estudados}/${d.total} vistos</span></div><div class="small muted num">${d.g.q ? `${d.g.q} questões · <b>${pctFmt(d.g.pct)}</b> de acerto${d.t.diff != null ? ' · ' + tendTxt(d.t) : ''}` : 'sem questões ainda'}</div></button>`).join('')}</div></section>`;
  const sem = serieSemanal(qh, 12);
  h += `<div class="charts section"><div class="card chart-card"><h3>Evolução do acerto por semana</h3><p class="small muted" style="margin-bottom:8px">Acertos sobre questões de cada semana, nas últimas 12 semanas.</p>${lineChart(sem.map(w => ({ label: fmtBR(w.w), y: w.pct, tip: `semana de ${fmtBR(w.w)} · ${w.a}/${w.q} · ${pctFmt(w.pct)}` })), { id: 'tip-evo', empty: 'Ainda sem questões registradas.' })}<div class="tip" id="tip-evo"></div></div>`;
  h += `<div class="card chart-card"><h3>Revisões realizadas por semana</h3><p class="small muted" style="margin-bottom:8px">Últimas 10 semanas (semana começa na segunda).</p>${chartSemanas()}<div class="tip" id="tip-sem"></div></div>`;
  h += `<div class="card"><h3>Distribuição por nível de domínio</h3><p class="small muted" style="margin-bottom:8px">Pelo resultado mais recente de cada assunto.</p>${chartDominio(m)}</div></div>`;
  view.innerHTML = h; bindItems(view); bindChartTips();
  $$('[data-disc]', view).forEach(el => el.addEventListener('click', () => abrirMateria(el.dataset.disc)));
}
function prioRow(o) {
  const { s, d } = o.x;
  return `<div class="item ${statusCls(o.x)}" data-open="${s.id}"><div class="body"><div class="title"><span class="disc">${esc(s.disciplina)}</span><span>${esc(s.assunto)}</span></div><div class="meta">${o.motivos.map(t => `<span class="chip">${t}</span>`).join('')}${d.totQuestoes ? `<span class="num">${d.totAcertos}/${d.totQuestoes} no total</span>` : ''}</div></div><div class="act"><button class="primary sm" data-registrar="${s.id}">${acaoLabel(d.proximaAtividade)}</button></div></div>`;
}
function abrirMateria(nome) { state.ui.tab = 'materias'; state.ui.matView = 'materias'; state.ui.discSel = nome; state.ui.discCol = 'todos'; save(); render(); window.scrollTo({ top: 0 }); }
// gráfico de linha 0–100% com linha do limite de teoria
function lineChart(pts, { h = 200, id, empty = 'Sem dados ainda.' } = {}) {
  const val = pts.map((p, i) => Object.assign({}, p, { i })).filter(p => p.y != null);
  if (!val.length) return `<div class="chart-empty">${empty}</div>`;
  const W = 600, H = h, pl = 38, pr = 16, pt = 18, pb = 28, iw = W - pl - pr, ih = H - pt - pb, n = pts.length, lim = cfg().limiteTeoria;
  const x = i => pl + (n === 1 ? iw / 2 : (i / (n - 1)) * iw), y = v => pt + ih - (v / 100) * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução do acerto">`;
  [0, 25, 50, 75, 100].forEach(v => { s += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">${v}%</text>`; });
  s += `<line x1="${pl}" x2="${W - pr}" y1="${y(lim)}" y2="${y(lim)}" stroke="var(--orange)" stroke-dasharray="4 4"/><text x="${W - pr}" y="${y(lim) - 4}" text-anchor="end" font-size="10" fill="var(--orange)">limite teoria ${lim}%</text>`;
  const P = val.map(p => [x(p.i), y(p.y)]);
  if (P.length > 1) s += `<path d="M${P.map(q => q.join(',')).join(' L')} L${P[P.length - 1][0]},${y(0)} L${P[0][0]},${y(0)} Z" fill="var(--accent)" opacity=".10"/><path d="M${P.map(q => q.join(',')).join(' L')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`;
  val.forEach((p, k) => { s += `<circle cx="${P[k][0]}" cy="${P[k][1]}" r="${k === val.length - 1 ? 5 : 3.5}" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>${id ? `<circle cx="${P[k][0]}" cy="${P[k][1]}" r="13" fill="transparent" data-tip="${esc(p.tip || '')}" data-tipfor="${id}"/>` : ''}`; });
  const LP = P[P.length - 1]; s += `<text x="${Math.min(Math.max(LP[0], pl + 14), W - pr - 14)}" y="${Math.max(LP[1] - 10, 12)}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--ink)">${pctFmt(val[val.length - 1].y)}</text>`;
  (n <= 7 ? pts.map((_, i) => i) : [0, Math.round((n - 1) / 3), Math.round(2 * (n - 1) / 3), n - 1]).forEach(i => { s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${esc(pts[i].label)}</text>`; });
  return s + `</svg>`;
}
function sparkline(serie) {
  const v = serie.map((p, i) => ({ p, i })).filter(o => o.p != null); if (v.length < 2) return '<span class="spark"></span>';
  const W = 100, H = 30, x = i => (i / (serie.length - 1)) * W, y = p => H - 3 - (p / 100) * (H - 6);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="M${v.map(o => `${x(o.i).toFixed(1)},${y(o.p).toFixed(1)}`).join(' L')}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}
function weekStart(iso) { const d = parseISO(iso); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return toISO(d); }
function chartSemanas() {
  if (!state.history.length) return `<div class="chart-empty">Ainda sem revisões registradas.</div>`;
  const weeks = []; const ws = weekStart(todayISO()); for (let i = 9; i >= 0; i--) weeks.push(addDays(ws, -7 * i));
  const counts = weeks.map(w => state.history.filter(h => weekStart(h.dataRealizada) === w).length); const max = Math.max(4, ...counts);
  const W = 600, H = 200, pl = 28, pr = 10, pt = 16, pb = 30, iw = W - pl - pr, ih = H - pt - pb, bw = iw / weeks.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revisões por semana">`;
  const ticks = max <= 8 ? [...Array(max + 1).keys()].filter(v => v % 2 === 0 || max <= 4) : [0, Math.round(max / 2), max];
  ticks.forEach(v => { const yy = pt + ih - (v / max) * ih; s += `<line x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}" stroke="var(--border)"/><text x="${pl - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">${v}</text>`; });
  weeks.forEach((w, i) => { const c = counts[i]; const bh = (c / max) * ih; const xx = pl + i * bw + bw * 0.2; const yy = pt + ih - bh; s += `<rect x="${xx}" y="${yy}" width="${bw * 0.6}" height="${bh}" rx="3" fill="var(--accent)" opacity="${i === weeks.length - 1 ? 1 : .75}"/><rect x="${pl + i * bw}" y="${pt}" width="${bw}" height="${ih}" fill="transparent" data-tip="semana de ${fmtBR(w)} · ${c} ${c === 1 ? 'revisão' : 'revisões'}" data-tipfor="tip-sem"/>`; if (c) s += `<text x="${xx + bw * 0.3}" y="${yy - 4}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--ink-2)">${c}</text>`; if (i % 2 === 1) s += `<text x="${pl + i * bw + bw / 2}" y="${H - 10}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${fmtBR(w)}</text>`; });
  return s + `</svg>`;
}
function chartDominio(m) {
  const counts = [0, 0, 0, 0, 0, 0]; m.all.forEach(x => counts[x.d.nivel.n]++); const max = Math.max(1, ...counts);
  return [5, 4, 3, 2, 1, 0].map(i => `<div class="hbar-row"><span>${NIVEIS[i].emoji} ${NIVEIS[i].nome}</span><div class="bar"><i style="width:${(counts[i] / max) * 100}%;background:var(${NIVEIS[i].var})"></i></div><span class="num" style="text-align:right;font-weight:700">${counts[i]}</span></div>`).join('');
}
function bindChartTips(root = view) {
  $$('[data-tip]', root).forEach(el => { const tip = document.getElementById(el.dataset.tipfor); const card = el.closest('.chart-card'); const show = ev => { const r = card.getBoundingClientRect(); const p = ev.touches ? ev.touches[0] : ev; tip.textContent = el.dataset.tip; tip.style.display = 'block'; tip.style.left = (p.clientX - r.left) + 'px'; tip.style.top = (p.clientY - r.top) + 'px'; }; el.addEventListener('mousemove', show); el.addEventListener('mouseleave', () => tip.style.display = 'none'); el.addEventListener('touchstart', show, { passive: true }); el.addEventListener('touchend', () => setTimeout(() => tip.style.display = 'none', 1200)); });
}

/* ===================== MATÉRIAS ===================== */
const segMaterias = modo => `<div class="toolbar"><div class="segment"><button data-mv="materias" class="${modo === 'materias' ? 'active' : ''}">Por matéria</button><button data-mv="assuntos" class="${modo === 'assuntos' ? 'active' : ''}">Todos os assuntos</button></div></div>`;
function bindMatSeg() { $$('[data-mv]', view).forEach(b => b.addEventListener('click', () => { state.ui.matView = b.dataset.mv; state.ui.discSel = null; save(); render(); })); }
function renderMaterias(m) {
  const modo = state.ui.matView || 'materias';
  if (modo === 'assuntos') return renderAssuntos(m, segMaterias(modo));
  if (state.ui.discSel) return renderDisciplina(m, state.ui.discSel);
  const ds = statsDisciplinas(m.all); const qh = qReviews(); const G = agg(qh);
  const est = m.all.filter(x => x.s.estudoRealizado).length; const cob = m.total ? Math.round(est / m.total * 100) : 0;
  const ord = state.ui.matOrd || 'gas';
  const sorters = { gas: (a, b) => gasDisc(b) - gasDisc(a), az: (a, b) => a.nome.localeCompare(b.nome, 'pt'), cob: (a, b) => a.cob - b.cob || a.nome.localeCompare(b.nome, 'pt'), acerto: (a, b) => (b.g.pct ?? -1) - (a.g.pct ?? -1) };
  ds.sort(sorters[ord] || sorters.gas);
  let h = segMaterias(modo);
  h += `<section class="card section mat-resumo"><div><span class="eyebrow">Teoria vista</span><strong class="num">${est} de ${m.total}</strong><div class="progress sm"><i style="width:${cob}%"></i></div><span class="small muted">${cob}% do conteúdo · ${m.total - est} assuntos por estudar</span></div><div><span class="eyebrow">Questões</span><strong class="num">${G.q}</strong><span class="small muted">${G.a} acertos · ${G.e} erros</span></div><div><span class="eyebrow">Acerto geral</span><strong class="num">${pctFmt(G.pct)}</strong><span class="small">${tendTxt(tendencia(qh))}</span></div></section>`;
  h += `<div class="toolbar"><label class="inline small" for="mat-ord">Ordenar por</label><select id="mat-ord" style="max-width:260px"><option value="gas" ${ord === 'gas' ? 'selected' : ''}>Precisa de mais atenção</option><option value="cob" ${ord === 'cob' ? 'selected' : ''}>Menos teoria vista</option><option value="acerto" ${ord === 'acerto' ? 'selected' : ''}>Maior acerto</option><option value="az" ${ord === 'az' ? 'selected' : ''}>A a Z</option></select></div>`;
  h += `<div class="disc-grid">${ds.map(d => `<button class="disc-card" data-disc="${esc(d.nome)}"><div class="dc-head"><strong>${esc(d.nome)}</strong>${chipSit(d.g)}</div><div class="cov"><div class="bar"><i style="width:${d.cob}%"></i></div><span class="num small">${d.estudados}/${d.total} vistos</span></div><div class="dc-row">${d.g.q ? `<div><span class="dc-pct num">${pctFmt(d.g.pct)}</span> <span class="small muted">de acerto</span>${d.t.diff != null ? `<div class="small">${tendTxt(d.t)}</div>` : ''}</div>${sparkline(serieSemanal(d.hist, 8).map(w => w.pct))}` : '<span class="small muted">Nenhuma questão registrada ainda</span>'}</div><div class="small muted num">${d.g.q ? `${d.g.q} questões · ${d.g.e} erros` : `${d.total - d.estudados} por estudar`}${d.atrasadas ? ` · <span class="txt-red">${d.atrasadas} ${d.atrasadas === 1 ? 'atrasada' : 'atrasadas'}</span>` : ''}${d.fracos ? ` · ${d.fracos} ${d.fracos === 1 ? 'assunto fraco' : 'assuntos fracos'}` : ''}</div></button>`).join('')}</div>`;
  view.innerHTML = h; bindMatSeg();
  $('#mat-ord').addEventListener('change', e => { state.ui.matOrd = e.target.value; save(); render(); });
  $$('[data-disc]', view).forEach(el => el.addEventListener('click', () => abrirMateria(el.dataset.disc)));
}
function renderDisciplina(m, nome) {
  const D = statsDisciplinas(m.all).find(x => x.nome === nome); if (!D) { state.ui.discSel = null; save(); return renderMaterias(m); }
  const filtro = state.ui.discCol || 'todos';
  const pri = prioridades(D.itens).slice(0, 5);
  const sem = serieSemanal(D.hist, 12);
  const gas = x => (x.d.ultimoPct != null ? 100 - x.d.ultimoPct : 0) + (x.d.prazo === 'atrasada' ? 30 : 0) + (x.d.proximaData && x.d.proximaAtividade === 'TEORIA' ? 40 : 0);
  const lista = D.itens.filter(x => filtro === 'todos' || x.d.coluna === filtro).sort((a, b) => (b.s.estudoRealizado - a.s.estudoRealizado) || gas(b) - gas(a) || (a.d.proximaData || '9999').localeCompare(b.d.proximaData || '9999') || a.s.numero - b.s.numero);
  const kp = (v, l, c = '') => `<div class="kpi ${c}"><span class="v num">${v}</span><span class="l">${l}</span></div>`;
  let h = segMaterias('materias');
  h += `<div class="disc-top"><button class="ghost sm" id="disc-back">← Todas as matérias</button></div><div class="disc-title"><h2>${esc(nome)}</h2>${chipSit(D.g)}</div>`;
  h += `<div class="kpis section">${kp(`${D.estudados}/${D.total}`, `teoria vista · ${D.cob}%`)}${kp(D.g.q, 'questões')}${kp(D.g.a, 'acertos', 'ok')}${kp(D.g.e, 'erros', 'err')}${kp(pctFmt(D.g.pct), 'acerto geral')}${kp(tendTxt(D.t), 'últimos 30 dias', 'kpi-txt')}</div>`;
  h += `<div class="charts section"><div class="card chart-card"><h3>Evolução semanal</h3><p class="small muted" style="margin-bottom:8px">Acerto de cada semana nesta matéria.</p>${lineChart(sem.map(w => ({ label: fmtBR(w.w), y: w.pct, tip: `semana de ${fmtBR(w.w)} · ${w.a}/${w.q} · ${pctFmt(w.pct)}` })), { id: 'tip-disc', empty: 'O gráfico aparece quando você registrar questões desta matéria.' })}<div class="tip" id="tip-disc"></div></div>`;
  h += `<div class="card"><h3>Onde dar um gás</h3>${pri.length ? `<div class="stack" style="margin-top:8px">${pri.map(prioRow).join('')}</div>` : '<p class="small muted" style="margin-top:6px">Nenhum assunto desta matéria precisa de atenção agora.</p>'}</div></div>`;
  h += `<div class="toolbar"><div class="segment segment-scroll"><button data-dcol="todos" class="${filtro === 'todos' ? 'active' : ''}">Todos ${D.total}</button>${COLS.map(c => `<button data-dcol="${c.id}" class="${filtro === c.id ? 'active' : ''}">${c.nome} ${D.itens.filter(x => x.d.coluna === c.id).length}</button>`).join('')}</div></div>`;
  h += lista.length ? `<div class="stack">${lista.map(srow).join('')}</div>` : '<div class="empty">Nenhum assunto nesta etapa.</div>';
  view.innerHTML = h; bindMatSeg(); bindItems(view); bindChartTips();
  $('#disc-back').addEventListener('click', () => { state.ui.discSel = null; save(); render(); window.scrollTo({ top: 0 }); });
  $$('[data-dcol]', view).forEach(b => b.addEventListener('click', () => { state.ui.discCol = b.dataset.dcol; save(); render(); }));
}
function srow(x) {
  const { s, d } = x; const chips = [`<span class="chip">${colNome(d.coluna)}</span>`];
  if (d.proximaData && !s.concluido) chips.push(`<span class="chip ${d.prazo === 'atrasada' ? 's-atrasada' : d.prazo === 'hoje' ? 's-hoje' : ''}">${d.proximaAtividade === 'ESTUDO' ? 'estudar' : TIPOS[d.proximaAtividade].short.toLowerCase()} ${d.prazo === 'atrasada' ? `atrasada ${d.diasAtraso}d` : d.prazo === 'hoje' ? 'hoje' : fmtBR(d.proximaData)}</span>`);
  return `<div class="srow ${statusCls(x)}" data-open="${s.id}"><div class="srow-main"><strong>${esc(s.assunto)}</strong><div class="kchips">${chips.join('')}</div></div><div class="srow-stats num">${d.totQuestoes ? `<b>${d.pctGeral}%</b><span class="small muted">${d.totAcertos}/${d.totQuestoes} · ${d.totErros} erros</span>` : '<span class="small muted">sem questões</span>'}${d.nivel.n ? `<span class="small">${NIVEIS[d.nivel.n].emoji}${d.nivel.tend > 0 ? ' ↗' : d.nivel.tend < 0 ? ' ↘' : ''}</span>` : ''}</div></div>`;
}

/* ===================== ASSUNTOS ===================== */
function renderAssuntos(m, pre = '') {
  const f = state.ui.filtros || {}; const q = (f.q || '').toLowerCase();
  const discs = Array.from(new Set(cfg().disciplinas.concat(state.subjects.map(s => s.disciplina)))).sort();
  const list = m.all.filter(x => (!q || (x.s.assunto + ' ' + x.s.disciplina + ' ' + (x.s.obs || '')).toLowerCase().includes(q)) && (!f.disc || x.s.disciplina === f.disc) && (!f.status || x.d.status === f.status || (f.status === 'atrasada' && x.d.prazo === 'atrasada')));
  const sort = f.sort || 'proxima';
  list.sort((a, b) => sort === 'proxima' ? (a.d.proximaData || '9999').localeCompare(b.d.proximaData || '9999') : sort === 'nivel' ? a.d.nivel.n - b.d.nivel.n : sort === 'disc' ? (a.s.disciplina + a.s.assunto).localeCompare(b.s.disciplina + b.s.assunto) : b.s.numero - a.s.numero);
  const sv = state.ui.subjView || 'cards';
  let h = `<div class="toolbar"><input class="search" id="f-q" placeholder="Buscar assunto…" value="${esc(f.q || '')}"><select id="f-disc"><option value="">Todas disciplinas</option>${discs.map(d => `<option ${f.disc === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select><select id="f-status"><option value="">Todos os status</option>${['A estudar', 'Estudado', 'Em revisão', 'Revisar teoria', 'Manutenção', 'Concluído'].map(s => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}<option value="atrasada" ${f.status === 'atrasada' ? 'selected' : ''}>Atrasadas</option></select><select id="f-sort"><option value="proxima" ${sort === 'proxima' ? 'selected' : ''}>Por próxima data</option><option value="disc" ${sort === 'disc' ? 'selected' : ''}>Por disciplina</option><option value="nivel" ${sort === 'nivel' ? 'selected' : ''}>Por domínio (menor primeiro)</option><option value="id" ${sort === 'id' ? 'selected' : ''}>Mais recentes</option></select><div class="segment"><button data-sv="cards" class="${sv === 'cards' ? 'active' : ''}">Cards</button><button data-sv="tabela" class="${sv === 'tabela' ? 'active' : ''}">Tabela</button></div></div><p class="small muted" style="margin-bottom:10px">${list.length} de ${m.total} assuntos</p>`;
  if (!list.length) h += `<div class="empty">Nenhum assunto encontrado.</div>`;
  else if (sv === 'cards') h += `<div class="subj-cards">${list.map(x => { const { s, d } = x; return `<div class="subj-card ${statusCls(x)}" data-open="${s.id}"><div class="title" style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><div class="eyebrow">${esc(s.disciplina)} · #${s.numero}</div><strong>${esc(s.assunto)}</strong></div>${chipNivel(d.nivel)}</div><div style="display:flex;gap:6px;flex-wrap:wrap">${chipTipo(d.proximaAtividade)}${d.prazo === 'atrasada' ? '<span class="chip s-atrasada">ATRASADA</span>' : d.prazo === 'hoje' ? '<span class="chip s-hoje">HOJE</span>' : ''}</div><div class="kv"><b>Próxima</b><span class="num">${fmtBRFull(d.proximaData)}${d.intervalo ? ` (+${d.intervalo}d)` : ''}</span><b>Estudo inicial</b><span class="num">${fmtBRFull(s.dataEstudo)}</span><b>Última revisão</b><span class="num">${d.ultimaRevisao ? fmtBRFull(d.ultimaRevisao) + ' · ' + TIPOS[d.ultimoTipo].label : '—'}</span><b>Último resultado</b><span class="num">${d.ultimoPct != null ? `${d.ultimosAcertos}/${d.ultimasQuestoes} · ${pctFmt(d.ultimoPct)}` : '—'}</span><b>Revisões</b><span class="num">${d.numRevisoes}</span><b>Status</b><span>${d.status}</span></div>${s.obs ? `<p class="small muted">${esc(s.obs)}</p>` : ''}<div style="display:flex;justify-content:flex-end"><button class="primary sm" data-registrar="${s.id}">${acaoLabel(d.proximaAtividade)}</button></div></div>`; }).join('')}</div>`;
  else {
    h += `<div class="tablewrap"><table><thead><tr><th>ID</th><th>Disciplina</th><th>Assunto</th><th>Estudo inicial</th><th>Status</th><th>Última revisão</th><th>Tipo última</th><th>Nº rev.</th><th>Questões</th><th>Acertos</th><th>%</th><th>Próxima atividade</th><th>Data próxima</th><th>Intervalo</th><th>Domínio</th><th>Obs.</th></tr></thead><tbody>`;
    list.forEach(x => { const { s, d } = x; h += `<tr class="row-click ${statusCls(x)}" data-open="${s.id}"><td class="num">#${s.numero}</td><td>${esc(s.disciplina)}</td><td class="wrap"><strong>${esc(s.assunto)}</strong></td><td class="num">${fmtBRFull(s.dataEstudo)}</td><td>${d.status}</td><td class="num">${d.ultimaRevisao ? fmtBRFull(d.ultimaRevisao) : '—'}</td><td>${d.ultimoTipo ? TIPOS[d.ultimoTipo].label : '—'}</td><td class="num">${d.numRevisoes}</td><td class="num">${d.ultimasQuestoes ?? '—'}</td><td class="num">${d.ultimosAcertos ?? '—'}</td><td class="num">${pctFmt(d.ultimoPct)}</td><td>${chipTipo(d.proximaAtividade)}</td><td class="num">${fmtBRFull(d.proximaData)} ${d.prazo === 'atrasada' ? '<span class="chip s-atrasada">ATRASADA</span>' : d.prazo === 'hoje' ? '<span class="chip s-hoje">HOJE</span>' : ''}</td><td class="num">${d.intervalo ? d.intervalo + ' d' : '—'}</td><td>${NIVEIS[d.nivel.n].emoji} ${NIVEIS[d.nivel.n].nome}${d.nivel.tend > 0 ? ' ↗' : d.nivel.tend < 0 ? ' ↘' : ''}</td><td class="wrap small muted">${esc(s.obs || '')}</td></tr>`; });
    h += `</tbody></table></div>`;
  }
  view.innerHTML = pre + h; bindItems(view); bindMatSeg();
  const upd = () => { state.ui.filtros = { q: $('#f-q').value, disc: $('#f-disc').value, status: $('#f-status').value, sort: $('#f-sort').value }; save(); render(); if (state.ui._focusQ) { const i = $('#f-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } };
  $('#f-q').addEventListener('input', () => { state.ui._focusQ = true; upd(); });
  ['#f-disc', '#f-status', '#f-sort'].forEach(id => $(id).addEventListener('change', () => { state.ui._focusQ = false; upd(); }));
  $$('[data-sv]', view).forEach(b => b.addEventListener('click', () => { state.ui.subjView = b.dataset.sv; save(); render(); }));
}

/* ===================== HISTÓRICO ===================== */
function renderHistorico() {
  const f = state.ui.hfiltros || {}; const q = (f.q || '').toLowerCase();
  const discs = Array.from(new Set(state.history.map(h => h.disciplina))).sort();
  const list = state.history.filter(h => (!q || (h.assunto + ' ' + h.disciplina).toLowerCase().includes(q)) && (!f.disc || h.disciplina === f.disc)).sort((a, b) => b.dataRealizada.localeCompare(a.dataRealizada) || b.seq - a.seq);
  const sm = {}; state.subjects.forEach(s => sm[s.id] = s);
  let h = `<div class="toolbar"><input class="search" id="h-q" placeholder="Buscar assunto…" value="${esc(f.q || '')}"><select id="h-disc"><option value="">Todas disciplinas</option>${discs.map(d => `<option ${f.disc === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select><button class="sm" id="h-csv">Exportar CSV</button></div><p class="small muted" style="margin-bottom:10px">${list.length} ${list.length === 1 ? 'registro' : 'registros'} · cada revisão realizada é uma linha; nada é sobrescrito.</p>`;
  if (!list.length) h += `<div class="empty">Nenhuma revisão registrada ainda.</div>`;
  else {
    h += `<div class="tablewrap desktop-only"><table><thead><tr><th>ID</th><th>Disciplina</th><th>Assunto</th><th>Nº</th><th>Programada</th><th>Realizada</th><th>Tipo</th><th>Questões</th><th>Acertos</th><th>%</th><th>Int. anterior</th><th>Próx. intervalo</th><th>Próxima atividade</th><th>Próxima data</th><th>Obs.</th><th></th></tr></thead><tbody>`;
    list.forEach(e => { const hist = subjectHistory(e.subjectId); const isLast = hist.length && hist[hist.length - 1].id === e.id; const atraso = diffDays(e.dataProgramada, e.dataRealizada); h += `<tr class="s-feita"><td class="num">#${sm[e.subjectId] ? sm[e.subjectId].numero : '?'}</td><td>${esc(e.disciplina)}</td><td class="wrap row-click" data-open="${e.subjectId}"><strong>${esc(e.assunto)}</strong></td><td class="num">${e.numero}</td><td class="num">${fmtBRFull(e.dataProgramada)}</td><td class="num">${fmtBRFull(e.dataRealizada)}${atraso > 0 ? ` <span class="chip s-atrasada">+${atraso}d</span>` : ''}</td><td>${chipTipo(e.tipo)}</td><td class="num">${e.questoes ?? '—'}</td><td class="num">${e.acertos ?? '—'}</td><td class="num"><strong>${pctFmt(e.pct)}</strong></td><td class="num">${e.intervaloAnterior != null ? e.intervaloAnterior + ' d' : '—'}</td><td class="num">${e.proximoIntervalo} d</td><td>${chipTipo(e.proximaAtividade)}</td><td class="num">${fmtBRFull(e.proximaData)}</td><td class="wrap small muted">${esc(e.obs || '')}</td><td>${isLast ? `<button class="sm ghost danger" data-undo="${e.subjectId}" title="Desfazer esta revisão">Desfazer</button>` : ''}</td></tr>`; });
    h += `</tbody></table></div>`;
    h += `<div class="stack mobile-only">${list.map(e => { const hist = subjectHistory(e.subjectId); const isLast = hist.length && hist[hist.length - 1].id === e.id; const atraso = diffDays(e.dataProgramada, e.dataRealizada); return `<div class="hcard" data-open="${e.subjectId}"><div class="hcard-top"><span class="eyebrow kdisc">${esc(e.disciplina)}</span><span class="small muted num">${fmtBR(e.dataRealizada)}${atraso > 0 ? ` · <span class="txt-red">+${atraso}d</span>` : ''}</span></div><strong>${esc(e.assunto)}</strong><div class="kchips">${chipTipo(e.tipo)}${e.pct != null ? `<span class="chip"><b class="num">${pctFmt(e.pct)}</b>&nbsp;· ${e.acertos}/${e.questoes}</span>` : ''}</div><div class="small muted">Revisão nº ${e.numero} · depois: ${TIPOS[e.proximaAtividade].short.toLowerCase()} em ${fmtBR(e.proximaData)} (${e.proximoIntervalo} ${e.proximoIntervalo === 1 ? 'dia' : 'dias'})</div>${e.obs ? `<div class="tl-obs">${esc(e.obs)}</div>` : ''}${isLast ? `<div><button class="sm ghost danger" data-undo="${e.subjectId}">Desfazer esta revisão</button></div>` : ''}</div>`; }).join('')}</div>`;
  }
  view.innerHTML = h;
  const upd = () => { state.ui.hfiltros = { q: $('#h-q').value, disc: $('#h-disc').value }; save(); render(); if (state.ui._focusH) { const i = $('#h-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } };
  $('#h-q').addEventListener('input', () => { state.ui._focusH = true; upd(); }); $('#h-disc').addEventListener('change', () => { state.ui._focusH = false; upd(); });
  $('#h-csv').addEventListener('click', exportCSV);
  $$('[data-open]', view).forEach(el => el.addEventListener('click', () => modalAssunto(el.dataset.open)));
  $$('[data-undo]', view).forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); if (confirm('Desfazer a última revisão deste assunto? A próxima atividade volta ao estado anterior.')) { desfazerUltima(b.dataset.undo); toast('Revisão desfeita'); render(); } }));
}

/* ===================== CONFIGURAÇÕES ===================== */
function renderConfig() {
  const c = cfg();
  const faixaRows = c.faixas.map((f, i) => { const next = c.faixas[i + 1]; const lbl = i === 0 ? `&lt;${c.limiteTeoria}%` : `${f.min}–${next ? next.min - 1 : 100}%`; return `<tr><td data-label="Desempenho"><strong>${lbl}</strong></td><td data-label="Nome"><input name="nome" value="${esc(f.nome)}" style="min-width:110px"></td><td data-label="A partir de %">${i === 0 ? '<span class="muted">0</span>' : `<input type="number" name="min" min="1" max="100" value="${f.min}">`}</td><td data-label="Mín. (dias)"><input type="number" name="intMin" min="0" value="${f.intMin}"></td><td data-label="Máx. (dias)"><input type="number" name="intMax" min="0" value="${f.intMax}"></td><td data-label="Padrão (dias)"><input type="number" name="padrao" min="0" value="${f.padrao}"></td><td data-label="Conduta"><select name="conduta"><option value="QUESTOES" ${f.conduta === 'QUESTOES' ? 'selected' : ''}>Questões</option><option value="TEORIA" ${f.conduta === 'TEORIA' ? 'selected' : ''}>Revisar teoria</option></select></td></tr>`; }).join('');
  const h = `<div class="card stack" style="margin-bottom:16px"><h2>Conta</h2><p class="small">Conectada como <strong>${esc(user.email || '')}</strong>. Os dados ficam no Supabase e aparecem em qualquer aparelho em que você entrar.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="sm primary" id="acc-plano">Meu plano de estudos</button><button class="sm" id="acc-sync">Sincronizar agora</button><button class="sm" id="acc-pass">Trocar senha</button><button class="sm" id="acc-out">Sair</button></div></div>
  <form id="f-cfg" class="stack" style="gap:16px"><div class="card stack"><h2>Regras de revisão</h2><p class="small muted">O intervalo <strong>padrão</strong> é o usado automaticamente; mínimo e máximo servem de referência ao ajustar datas manualmente.</p><div class="tablewrap" style="border:0"><table class="cfg-table"><thead><tr><th>Desempenho</th><th>Nome</th><th>A partir de %</th><th>Int. mín (d)</th><th>Int. máx (d)</th><th>Padrão (d)</th><th>Conduta</th></tr></thead><tbody id="faixas">${faixaRows}</tbody></table></div>
    <div class="row3"><label>Limite p/ revisar teoria (%)<input type="number" id="c-limite" min="1" max="100" value="${c.limiteTeoria}"></label><label>1ª revisão: padrão (dias)<input type="number" id="c-pr-padrao" min="0" value="${c.primeiraRevisao.padrao}"></label><label>1ª revisão: máximo (dias)<input type="number" id="c-pr-max" min="0" value="${c.primeiraRevisao.max}"></label></div>
    <div class="row3"><label>Questões após teoria: padrão<input type="number" id="c-pt-padrao" min="0" value="${c.posTeoria.padrao}"></label><label>Questões após teoria: máximo<input type="number" id="c-pt-max" min="0" value="${c.posTeoria.max}"></label><label>Questões recomendadas<input type="number" id="c-quest" min="1" value="${c.questoesRecomendadas}"></label></div>
    <label>Escada de manutenção (dias, separados por vírgula) — usada quando o desempenho se mantém ≥ ${c.faixas[c.faixas.length - 1].min}% em revisões seguidas<input id="c-manut" value="${c.manutencao.join(', ')}"></label>
    <label>Disciplinas (separadas por vírgula)<input id="c-disc" value="${esc(c.disciplinas.join(', '))}"></label>
    <div class="actions" style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button type="button" id="c-reset">Restaurar padrões</button><button class="primary" type="submit">Salvar configurações</button></div></div></form>
  <div class="card stack"><h2>Dados e backup</h2><p class="small muted">Tudo é salvo na nuvem automaticamente (e em cache neste aparelho para funcionar offline). O backup em arquivo é opcional.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button id="d-export">Exportar backup (JSON)</button><button id="d-import">Importar backup</button><input type="file" id="d-file" accept="application/json,.json" hidden><button id="d-csv">Histórico em CSV</button></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button id="d-lista">Importar lista de assuntos</button><button id="d-exemplos">Carregar exemplos</button><button id="d-rm-exemplos">Remover exemplos</button><button class="danger" id="d-wipe">Apagar tudo</button></div><p class="small muted">Assuntos: ${state.subjects.length} · Revisões: ${state.history.length}</p></div>
  <div class="card stack help"><h2>Como usar no dia a dia</h2>
    <details open><summary>Quando estudar um conteúdo novo</summary><ol><li>Toque em <strong>+ Novo assunto</strong>.</li><li>Preencha disciplina, assunto e a data em que estudou a teoria.</li><li>Pronto: a 1ª revisão por questões entra na agenda em ${c.primeiraRevisao.padrao} dia (ou 2, se você escolher).</li></ol></details>
    <details><summary>Quando fizer uma revisão</summary><ol><li>Abra a <strong>Agenda</strong>: o que é de hoje e o que está atrasado aparece no topo.</li><li>Toque em <strong>Registrar</strong> e informe questões feitas e acertos.</li><li>O app calcula a %, o nível de domínio, a próxima atividade e a data. Se ficou abaixo de ${c.limiteTeoria}%, ele agenda <strong>Revisar teoria</strong>; depois de marcar a teoria como feita, agenda questões em ${c.posTeoria.padrao} dia.</li></ol></details>
    <details><summary>Regras do algoritmo</summary><ul><li>&lt;${c.limiteTeoria}% → revisar teoria (mesmo dia a 48h), depois questões em 24–48h.</li><li>${c.faixas[1].min}–${c.faixas[2].min - 1}% → questões em ${c.faixas[1].intMin}–${c.faixas[1].intMax} dias.</li><li>${c.faixas[2].min}–${c.faixas[3].min - 1}% → ${c.faixas[2].intMin}–${c.faixas[2].intMax} dias.</li><li>${c.faixas[3].min}–${c.faixas[4].min - 1}% → ${c.faixas[3].intMin}–${c.faixas[3].intMax} dias.</li><li>≥${c.faixas[4].min}% → ${c.faixas[4].intMin}–${c.faixas[4].intMax} dias; mantendo ≥${c.faixas[4].min}% em sequência: ${c.manutencao.join(' → ')} dias.</li><li>Se a % cair, o intervalo cai junto na hora (ex.: 95% e depois 58% → 2 dias).</li><li>Atrasou? A revisão fica marcada como <strong>atrasada</strong> e continua na agenda até ser feita. A próxima data conta a partir do dia em que você realmente fez.</li></ul></details>
    <details><summary>Plano de estudos e Kanban</summary><ul><li>Em <strong>Meu plano</strong> você informa a data da prova, quantos assuntos novos por dia e os dias de estudo. O app distribui o que falta estudar e as primeiras revisões pendentes, alternando as matérias.</li><li>Se atrasar, a agenda oferece <strong>Reorganizar</strong> a partir de hoje.</li><li>No <strong>Kanban</strong>, toda revisão marcada fica em Para revisar. Depois de feita e em dia, vai para Revisado, e volta quando chega a próxima data.</li><li>Em <strong>Matérias</strong> você vê cobertura, acerto e evolução de cada matéria, e onde precisa dar um gás.</li></ul></details>
    <details><summary>Instalar como app</summary><p class="small">No celular: abra no navegador e use "Adicionar à tela inicial" (Safari: botão compartilhar; Chrome: menu ⋮). No computador: ícone de instalar na barra de endereço.</p></details></div>`;
  view.innerHTML = h;
  $('#acc-plano').addEventListener('click', modalPlano);
  $('#acc-sync').addEventListener('click', () => { toast('Sincronizando…'); syncNow(); });
  $('#acc-out').addEventListener('click', async () => { if (outbox.length && !confirm(`Há ${outbox.length} alterações ainda não enviadas. Sair mesmo assim?`)) return; await sb.auth.signOut(); });
  $('#acc-pass').addEventListener('click', () => modalSenha());
  $('#f-cfg').addEventListener('submit', e => {
    e.preventDefault();
    const faixas = $$('#faixas tr').map((r, i) => ({ nome: $('[name=nome]', r).value.trim() || c.faixas[i].nome, min: i === 0 ? 0 : Number($('[name=min]', r).value), intMin: Number($('[name=intMin]', r).value), intMax: Number($('[name=intMax]', r).value), padrao: Number($('[name=padrao]', r).value), conduta: $('[name=conduta]', r).value }));
    for (let i = 1; i < faixas.length; i++) if (faixas[i].min <= faixas[i - 1].min) return toast('As faixas precisam estar em ordem crescente de %.');
    for (const f of faixas) if (f.padrao < f.intMin || f.padrao > f.intMax) return toast(`Na faixa "${f.nome}", o padrão deve ficar entre o mínimo e o máximo.`);
    const lim = Number($('#c-limite').value); if (!(lim > 0 && lim <= faixas[1].min)) return toast('O limite de teoria deve ser maior que 0 e no máximo igual ao início da 2ª faixa.');
    const manut = $('#c-manut').value.split(',').map(s => Number(s.trim())).filter(n => n > 0); if (!manut.length) return toast('Informe ao menos um intervalo de manutenção.');
    Object.assign(c, { faixas, limiteTeoria: lim, primeiraRevisao: { padrao: Number($('#c-pr-padrao').value), max: Number($('#c-pr-max').value) }, posTeoria: { padrao: Number($('#c-pt-padrao').value), max: Number($('#c-pt-max').value) }, questoesRecomendadas: Number($('#c-quest').value) || 20, manutencao: manut, disciplinas: $('#c-disc').value.split(',').map(s => s.trim()).filter(Boolean) });
    dbSaveConfig(); save(true); toast('Configurações salvas'); render();
  });
  $('#c-reset').addEventListener('click', () => { if (confirm('Restaurar as configurações padrão?')) { state.config = defaultConfig(); dbSaveConfig(); save(true); render(); toast('Padrões restaurados'); } });
  $('#d-export').addEventListener('click', exportJSON);
  $('#d-import').addEventListener('click', () => $('#d-file').click());
  $('#d-file').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { const raw = JSON.parse(r.result); if (!raw.subjects || !raw.history) throw 0; const data = normalizeImport(raw); if (!confirm(`Importar ${data.subjects.length} assuntos e ${data.history.length} revisões? Isso substitui os dados atuais (também na nuvem).`)) return; replaceAll(data); render(); toast('Backup importado'); } catch (err) { toast('Arquivo inválido.'); } }; r.readAsText(f); e.target.value = ''; });
  $('#d-csv').addEventListener('click', exportCSV);
  $('#d-exemplos').addEventListener('click', carregarExemplos);
  $('#d-lista').addEventListener('click', () => { const n = importarLista(); render(); toast(n ? `${n} assuntos importados` : 'Todos os assuntos da lista já estão cadastrados'); });
  $('#d-rm-exemplos').addEventListener('click', () => { const n = state.subjects.filter(s => s.exemplo).length; if (!n) return toast('Não há exemplos carregados.'); state.subjects = state.subjects.filter(s => !s.exemplo); state.history = state.history.filter(h => !h.exemplo); dbDelete('subjects', { exemplo: true }); save(true); render(); toast(`${n} exemplos removidos`); });
  $('#d-wipe').addEventListener('click', () => { if (confirm('Apagar TODOS os assuntos, revisões e configurações (neste aparelho e na nuvem)? Esta ação não pode ser desfeita.') && confirm('Tem certeza? Exporte um backup antes se quiser guardar os dados.')) { Object.assign(state, blankData()); state.config.listaImportada = true; enqueue({ table: 'reviews', op: 'deleteAll' }); enqueue({ table: 'subjects', op: 'deleteAll' }); dbSaveConfig(); save(true); render(); toast('Tudo apagado'); } });
}
function download(name, content, type) {
  try { const blob = new Blob([content], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  catch (e) { toast('Não foi possível baixar o arquivo neste navegador.'); }
}
function exportJSON() { download(`revisa-backup-${todayISO()}.json`, JSON.stringify({ version: 2, exportadoEm: todayISO(), config: state.config, subjects: state.subjects, history: state.history }, null, 2), 'application/json'); toast('Backup gerado'); }
function exportCSV() {
  const cols = ['ID do assunto', 'Disciplina', 'Assunto', 'Número da revisão', 'Data programada', 'Data realizada', 'Tipo de revisão', 'Questões', 'Acertos', '% acertos', 'Intervalo anterior', 'Próximo intervalo', 'Próxima atividade', 'Próxima data', 'Observações'];
  const sm = {}; state.subjects.forEach(s => sm[s.id] = s); const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = state.history.slice().sort((a, b) => a.seq - b.seq).map(e => [sm[e.subjectId] ? sm[e.subjectId].numero : '', e.disciplina, e.assunto, e.numero, fmtBRFull(e.dataProgramada), fmtBRFull(e.dataRealizada), TIPOS[e.tipo].label, e.questoes, e.acertos, e.pct, e.intervaloAnterior, e.proximoIntervalo, TIPOS[e.proximaAtividade].label, fmtBRFull(e.proximaData), e.obs].map(q).join(';'));
  download(`revisa-historico-${todayISO()}.csv`, '﻿' + cols.map(q).join(';') + '\n' + rows.join('\n'), 'text/csv;charset=utf-8');
}

/* ===================== MODAIS ===================== */
function discOptions() { const discs = Array.from(new Set(cfg().disciplinas.concat(state.subjects.map(s => s.disciplina)))).sort(); return `<datalist id="dl-disc">${discs.map(d => `<option value="${esc(d)}"></option>`).join('')}</datalist>`; }
function modalNovoAssunto(existing) {
  const c = cfg(); const s = existing || null; const t = todayISO();
  const html = `<form id="f-novo" class="stack" style="gap:12px"><h2>${s ? 'Editar assunto' : 'Novo assunto estudado'}</h2>${discOptions()}
    <label>Disciplina<input name="disciplina" list="dl-disc" required placeholder="Ex.: Pediatria" value="${esc(s ? s.disciplina : '')}" autocomplete="off"></label>
    <label>Assunto<input name="assunto" required placeholder="Ex.: Bronquiolite" value="${esc(s ? s.assunto : '')}"></label>
    <div class="row2"><label>Data do estudo (ou planejada)<input type="date" name="dataEstudo" value="${s ? (s.dataEstudo || '') : t}"></label><label>&nbsp;<span class="inline" style="display:flex;align-items:center;gap:8px;min-height:40px"><input type="checkbox" name="estudoRealizado" id="n-real" ${!s || s.estudoRealizado ? 'checked' : ''}> <span style="font-weight:500;color:var(--ink)">Estudo inicial realizado</span></span></label></div>
    <div id="n-first" ${(s && subjectHistory(s.id).length) ? 'hidden' : ''}><span class="eyebrow">1ª revisão por questões</span><div class="radio-group" style="margin-top:6px">${[...Array(c.primeiraRevisao.max + 1).keys()].filter(n => n >= 1 || c.primeiraRevisao.padrao === 0).map(n => `<label class="inline"><input type="radio" name="prd" value="${n}" ${(s ? (s.primeiraRevisaoDias ?? c.primeiraRevisao.padrao) : c.primeiraRevisao.padrao) === n ? 'checked' : ''}> +${n} ${n === 1 ? 'dia' : 'dias'}</label>`).join('')}</div><p class="small muted" style="margin-top:4px">Nunca depois de ${c.primeiraRevisao.max * 24}h do estudo. Se não marcou "estudo realizado", o estudo entra na agenda na data acima.</p></div>
    <label>Observações<textarea name="obs" placeholder="Opcional">${esc(s ? s.obs : '')}</textarea></label>
    <div class="actions">${s ? `<div class="left"><button type="button" class="danger" id="n-del">Excluir assunto</button></div>` : ''}<button type="button" data-close>Cancelar</button><button class="primary" type="submit">${s ? 'Salvar' : 'Cadastrar'}</button></div></form>`;
  openModal(html, bg => {
    $('#f-novo').addEventListener('submit', e => {
      e.preventDefault(); const fd = new FormData(e.target);
      const data = { disciplina: fd.get('disciplina'), assunto: fd.get('assunto'), dataEstudo: fd.get('dataEstudo'), estudoRealizado: fd.get('estudoRealizado') === 'on', primeiraRevisaoDias: Number(fd.get('prd') ?? c.primeiraRevisao.padrao), obs: fd.get('obs') };
      if (!data.disciplina.trim() || !data.assunto.trim()) return toast('Informe disciplina e assunto.');
      data.dataEstudo = data.dataEstudo || null; if (data.estudoRealizado && !data.dataEstudo) return toast('Informe a data em que estudou a teoria.');
      if (s) { updateSubject(s, { disciplina: data.disciplina.trim(), assunto: data.assunto.trim(), dataEstudo: data.dataEstudo, estudoRealizado: data.estudoRealizado, primeiraRevisaoDias: data.primeiraRevisaoDias, obs: (data.obs || '').trim() }); if (s.disciplina && !c.disciplinas.includes(s.disciplina)) { c.disciplinas.push(s.disciplina); dbSaveConfig(); } closeModal(); toast('Assunto atualizado'); render(); return; }
      const ns = addSubject(data); const d = derive(ns); closeModal(); render();
      toast(d.proximaAtividade === 'ESTUDO' ? (d.proximaData ? `Estudo agendado para ${fmtBR(d.proximaData)}` : 'Assunto adicionado à coluna Assuntos') : `1ª revisão por questões em ${fmtBR(d.proximaData)}`);
    });
    const del = $('#n-del', bg); if (del) del.addEventListener('click', () => { if (confirm(`Excluir "${s.assunto}" e todo o seu histórico?`)) { removeSubject(s.id); closeModal(); render(); toast('Assunto excluído'); } });
  });
}
function modalRegistrar(id, aviso) {
  const s = findSubject(id); if (!s) return; const d = derive(s); const tipo = d.proximaAtividade; const c = cfg(); const t = todayISO();
  const head = `<h2>${tipo === 'ESTUDO' ? 'Marcar estudo inicial' : tipo === 'TEORIA' ? 'Marcar revisão teórica' : 'Registrar revisão por questões'}</h2><p class="muted"><span class="eyebrow">${esc(s.disciplina)}</span><br><strong style="color:var(--ink);font-size:1.05rem">${esc(s.assunto)}</strong></p><div style="display:flex;gap:6px;flex-wrap:wrap">${chipTipo(tipo)}<span class="chip">${tipo === 'ESTUDO' ? 'estudo inicial' : 'revisão nº ' + (d.numRevisoes + 1)}</span>${d.proximaData ? `<span class="chip ${d.prazo === 'atrasada' ? 's-atrasada' : d.prazo === 'hoje' ? 's-hoje' : ''}">programada ${fmtBR(d.proximaData)}${d.prazo === 'atrasada' ? ` · ${d.diasAtraso}d de atraso` : ''}</span>` : '<span class="chip">sem data na agenda</span>'}</div>${aviso ? `<p class="small muted">${aviso}</p>` : ''}`;
  let body = '';
  if (isQuestoes(tipo)) body = `<div class="row2"><label>Questões feitas<input type="number" name="questoes" min="1" inputmode="numeric" placeholder="${c.questoesRecomendadas}" required></label><label>Acertos<input type="number" name="acertos" min="0" inputmode="numeric" required></label></div><div class="preview" id="reg-preview"><span class="muted">Informe questões e acertos para ver a próxima etapa.</span></div>`;
  else if (tipo === 'TEORIA') body = `<div class="preview"><span>Ao marcar como feita, o app programa <b>questões após a teoria</b> em ${c.posTeoria.padrao} ${c.posTeoria.padrao === 1 ? 'dia' : 'dias'} (máx. ${c.posTeoria.max * 24}h).</span></div>`;
  else body = `<div><span class="eyebrow">1ª revisão por questões</span><div class="radio-group" style="margin-top:6px">${[...Array(c.primeiraRevisao.max + 1).keys()].filter(n => n >= 1).map(n => `<label class="inline"><input type="radio" name="prd" value="${n}" ${(s.primeiraRevisaoDias ?? c.primeiraRevisao.padrao) === n ? 'checked' : ''}> +${n} ${n === 1 ? 'dia' : 'dias'}</label>`).join('')}</div></div>`;
  const html = `<form id="f-reg" class="stack" style="gap:12px">${head}<label>Data realizada<input type="date" name="data" value="${t}" max="${t}" required></label>${body}<label>Observações<textarea name="obs" placeholder="Opcional: o que errou, o que precisa rever…"></textarea></label><div class="actions"><button type="button" data-close>Cancelar</button><button class="primary" type="submit">${tipo === 'ESTUDO' ? 'Confirmar estudo' : tipo === 'TEORIA' ? 'Teoria revisada' : 'Salvar revisão'}</button></div></form>`;
  openModal(html, () => {
    const form = $('#f-reg'); const prev = $('#reg-preview');
    const updatePreview = () => {
      if (!prev) return; const q = Number(form.questoes.value), a = Number(form.acertos.value); const dt = form.data.value || t;
      if (!(q > 0) || form.acertos.value === '') { prev.innerHTML = '<span class="muted">Informe questões e acertos para ver a próxima etapa.</span>'; return; }
      if (a > q) { prev.innerHTML = '<span style="color:var(--red)">Acertos não podem ser maiores que o número de questões.</span>'; return; }
      const pct = Math.round(a / q * 1000) / 10; const plan = planAfter({ tipo, pct, streakAnterior: d.streak }); const f = faixaFor(pct); const N = NIVEIS[Math.min(5, cfg().faixas.indexOf(f) + 1)];
      prev.innerHTML = `<b class="num">${pctFmt(pct)} · ${N.emoji} ${N.nome}</b><span>Próxima: <strong>${TIPOS[plan.proximaAtividade].label}</strong> em ${plan.intervalo} ${plan.intervalo === 1 ? 'dia' : 'dias'} → <strong class="num">${fmtBRFull(addDays(dt, plan.intervalo))}</strong>${plan.proximaAtividade === 'TEORIA' ? '<br><span class="muted">Desempenho muito baixo: revise a teoria antes de novas questões.</span>' : plan.proximaAtividade === 'MANUTENCAO' ? `<br><span class="muted">Desempenho excelente ${plan.streak}× seguidas: intervalo de manutenção.</span>` : d.ultimoPct != null && pct < d.ultimoPct - 5 ? '<br><span class="muted">Queda em relação à última revisão: intervalo reduzido.</span>' : ''}</span>`;
    };
    if (prev) ['questoes', 'acertos', 'data'].forEach(n => form[n].addEventListener('input', updatePreview));
    form.addEventListener('submit', e => {
      e.preventDefault(); const fd = new FormData(form); const dt = fd.get('data');
      if (!dt) return toast('Informe a data.'); if (dt > t) return toast('A data realizada não pode ser no futuro.');
      if (isQuestoes(tipo)) { const q = Number(fd.get('questoes')), a = Number(fd.get('acertos')); if (!(q > 0)) return toast('Informe o número de questões.'); if (a < 0 || a > q) return toast('Acertos devem ficar entre 0 e o número de questões.'); const en = registrar(id, { dataRealizada: dt, questoes: q, acertos: a, obs: fd.get('obs') }); closeModal(); render(); toast(`${pctFmt(en.pct)} · ${TIPOS[en.proximaAtividade].label} em ${fmtBR(en.proximaData)}`); return; }
      if (tipo === 'TEORIA') { const en = registrar(id, { dataRealizada: dt, obs: fd.get('obs') }); closeModal(); render(); toast(`Teoria revisada · questões em ${fmtBR(en.proximaData)}`); return; }
      s.primeiraRevisaoDias = Number(fd.get('prd') || c.primeiraRevisao.padrao); if (fd.get('obs')) s.obs = [s.obs, fd.get('obs')].filter(Boolean).join(' · '); registrar(id, { dataRealizada: dt }); closeModal(); render(); toast(`Estudo registrado · 1ª revisão em ${fmtBR(derive(s).proximaData)}`);
    });
  });
}
function modalAssunto(id) {
  const s = findSubject(id); if (!s) return; const d = derive(s); const t = todayISO();
  const qh = d.hist.filter(h => isQuestoes(h.tipo)); const melhor = qh.length ? Math.max(...qh.map(h => h.pct)) : null;
  const D = statsDisciplinas(allDerived().filter(x => x.s.disciplina === s.disciplina))[0];
  const pp = proximoPasso(s, d);
  const kp = (v, l, c = '') => `<div class="kpi ${c}"><span class="v num">${v}</span><span class="l">${l}</span></div>`;
  const eventos = d.hist.map(h => ({ data: h.dataRealizada, ord: h.seq, h }));
  if (s.estudoRealizado && s.dataEstudo) eventos.push({ data: s.dataEstudo, ord: -1, estudo: true });
  eventos.sort((a, b) => b.data.localeCompare(a.data) || b.ord - a.ord);
  const tl = eventos.map(ev => {
    if (ev.estudo) return `<li class="tl-item"><span class="tl-date num">${fmtBR(ev.data)}</span><div class="tl-body"><div class="tl-head"><span class="chip t-estudo">ESTUDO DA TEORIA</span></div></div></li>`;
    const h = ev.h; const atraso = diffDays(h.dataProgramada, h.dataRealizada);
    return `<li class="tl-item"><span class="tl-date num">${fmtBR(h.dataRealizada)}</span><div class="tl-body"><div class="tl-head">${chipTipo(h.tipo)}${h.pct != null ? `<strong class="num">${pctFmt(h.pct)}</strong><span class="num small muted">${h.acertos}/${h.questoes} · ${h.questoes - h.acertos} erros</span>` : ''}</div><div class="small muted">${atraso > 0 ? `feita com ${atraso} ${atraso === 1 ? 'dia' : 'dias'} de atraso · ` : ''}depois: ${TIPOS[h.proximaAtividade].short.toLowerCase()} em ${h.proximoIntervalo} ${h.proximoIntervalo === 1 ? 'dia' : 'dias'}</div>${h.obs ? `<div class="tl-obs">${esc(h.obs)}</div>` : ''}</div></li>`;
  }).join('');
  const estudoTxt = s.estudoRealizado && s.dataEstudo ? `estudado ${haDias(diffDays(s.dataEstudo, t))}` : s.estudoRealizado ? 'estudado (data não registrada)' : 'teoria ainda não estudada';
  const html = `<div class="sd">
    <header class="sd-head"><div><span class="eyebrow kdisc">${esc(s.disciplina)} · #${s.numero}${s.exemplo ? ' · exemplo' : ''}</span><h2>${esc(s.assunto)}</h2><div class="kchips"><span class="chip">${colNome(d.coluna)}</span>${chipNivel(d.nivel)}</div></div><button class="ghost sm sd-close" data-close aria-label="Fechar">✕</button></header>
    <section class="next ${pp.cls}"><span class="eyebrow">Próximo passo</span><div class="next-title"><strong>${pp.titulo}</strong><span class="num">${pp.quando}</span></div><p class="small">${pp.porque}</p>
      <div class="next-actions"><button class="primary" id="a-reg">${s.concluido ? 'Reativar' : acaoLabel(d.proximaAtividade)}</button>${s.concluido ? '' : `<div class="resched"><input type="date" id="a-data" value="${d.proximaData || t}" aria-label="Nova data"><button class="sm" id="a-ajustar">${d.proximaData ? 'Reagendar' : 'Agendar'}</button>${d.proximaData ? '<button class="sm" id="a-adiar">+1 dia</button>' : ''}</div>`}</div></section>
    <section><h3>Desempenho</h3><div class="kpis">${kp(d.totQuestoes, 'questões')}${kp(d.totAcertos, 'acertos', 'ok')}${kp(d.totErros, 'erros', 'err')}${kp(d.pctGeral == null ? '—' : d.pctGeral + '%', 'acerto geral')}</div>
      <p class="small muted sd-line">${d.numRevisoes} ${d.numRevisoes === 1 ? 'revisão' : 'revisões'} · última ${pctFmt(d.ultimoPct)} · melhor ${pctFmt(melhor)} · ${estudoTxt}${d.ultimaRevisao ? ` · última revisão ${haDias(diffDays(d.ultimaRevisao, t))}` : ''}</p></section>
    <section class="chart-card"><h3>Evolução</h3>${lineChart(qh.map(h => ({ label: fmtBR(h.dataRealizada), y: h.pct, tip: `${fmtBR(h.dataRealizada)} · ${h.acertos}/${h.questoes} · ${pctFmt(h.pct)}` })), { h: 170, id: 'tip-subj', empty: 'O gráfico aparece depois da 1ª revisão por questões.' })}<div class="tip" id="tip-subj"></div></section>
    ${D && D.g.q && d.pctGeral != null ? `<section><h3>Comparado com a matéria</h3><div class="cmp"><div class="cmp-row"><span>Este assunto</span><div class="bar"><i style="width:${d.pctGeral}%"></i></div><b class="num">${d.pctGeral}%</b></div><div class="cmp-row"><span>${esc(s.disciplina)}</span><div class="bar"><i class="alt" style="width:${D.g.pct}%"></i></div><b class="num">${D.g.pct}%</b></div></div></section>` : ''}
    <section><h3>Linha do tempo</h3>${eventos.length ? `<ul class="timeline">${tl}</ul>` : '<p class="small muted">Nada registrado ainda.</p>'}</section>
    <section><h3>Anotações</h3><textarea id="a-obs" placeholder="Pontos fracos, pegadinhas, o que errou, referências…">${esc(s.obs || '')}</textarea><span class="small muted" id="a-obs-st">Salvo automaticamente.</span></section>
    <footer class="actions"><div class="left"><button class="sm" id="a-editar">Editar</button>${d.hist.length ? '<button class="sm ghost danger" id="a-undo">Desfazer última revisão</button>' : ''}</div>${s.concluido ? '' : '<button class="sm" id="a-concluir">Marcar como concluído</button>'}</footer></div>`;
  openModal(html, bg => {
    bindChartTips(bg);
    $('#a-reg').addEventListener('click', () => { if (s.concluido) { s.concluido = false; dbUpsertSubject(s); save(); render(); toast('Assunto reativado'); return modalAssunto(id); } modalRegistrar(id); });
    $('#a-editar').addEventListener('click', () => modalNovoAssunto(s));
    const undo = $('#a-undo', bg); if (undo) undo.addEventListener('click', () => { if (confirm('Desfazer a última revisão deste assunto?')) { desfazerUltima(id); toast('Revisão desfeita'); render(); modalAssunto(id); } });
    const conc = $('#a-concluir', bg); if (conc) conc.addEventListener('click', () => { moveTo(id, 'concluido'); if (findSubject(id) && findSubject(id).concluido) modalAssunto(id); });
    const aplicar = iso => { if (!iso) return; ajustarData(id, iso); render(); toast(`Próxima data: ${iso === t ? 'hoje' : fmtBR(iso)}`); modalAssunto(id); };
    const aj = $('#a-ajustar', bg); if (aj) aj.addEventListener('click', () => aplicar($('#a-data').value));
    const ad = $('#a-adiar', bg); if (ad) ad.addEventListener('click', () => aplicar(addDays(d.proximaData, 1)));
    const obs = $('#a-obs'); let tm;
    obs.addEventListener('input', () => { $('#a-obs-st').textContent = 'Salvando…'; clearTimeout(tm); tm = setTimeout(() => { s.obs = obs.value.trim(); dbUpsertSubject(s); save(); $('#a-obs-st').textContent = 'Salvo.'; }, 700); });
  }, { size: 'lg' });
}
function modalSenha() {
  openModal(`<form id="f-senha" class="stack" style="gap:12px"><h2>Trocar senha</h2><label>Nova senha<input type="password" name="p1" minlength="6" required autocomplete="new-password"></label><label>Repita a nova senha<input type="password" name="p2" minlength="6" required autocomplete="new-password"></label><div class="actions"><button type="button" data-close>Cancelar</button><button class="primary" type="submit">Salvar senha</button></div></form>`, () => {
    $('#f-senha').addEventListener('submit', async e => { e.preventDefault(); const fd = new FormData(e.target); if (fd.get('p1') !== fd.get('p2')) return toast('As senhas não conferem.'); const { error } = await sb.auth.updateUser({ password: fd.get('p1') }); if (error) return toast('Erro: ' + error.message); closeModal(); toast('Senha alterada'); });
  });
}

/* ===================== exemplos ===================== */
function carregarExemplos() {
  if (state.subjects.some(s => s.exemplo)) return toast('Os exemplos já estão carregados.');
  const t = todayISO();
  const mk = (disc, ass, diasAtras, obs) => addSubject({ disciplina: disc, assunto: ass, dataEstudo: addDays(t, -diasAtras), estudoRealizado: true, primeiraRevisaoDias: 1, obs: obs || '', exemplo: true });
  const reg = (s, diasAtras, q, a) => { const d = derive(s); const dt = addDays(t, -diasAtras); const tipo = d.proximaAtividade; const pct = isQuestoes(tipo) ? Math.round(a / q * 1000) / 10 : null; const p = planAfter({ tipo, pct, streakAnterior: d.streak }); const e = { id: uuid(), seq: state.nextSeq++, subjectId: s.id, disciplina: s.disciplina, assunto: s.assunto, numero: d.numRevisoes + 1, dataProgramada: d.proximaData, dataRealizada: dt, tipo, questoes: isQuestoes(tipo) ? q : null, acertos: isQuestoes(tipo) ? a : null, pct, intervaloAnterior: d.intervalo, proximoIntervalo: p.intervalo, proximaAtividade: p.proximaAtividade, proximaData: addDays(dt, p.intervalo), streak: p.streak, faixa: p.faixa ? p.faixa.nome : null, obs: '', exemplo: true }; state.history.push(e); dbUpsertReview(e); };
  let s;
  s = mk('Pediatria', 'Bronquiolite', 24); reg(s, 23, 20, 12); reg(s, 21, 20, 15); reg(s, 16, 25, 21); reg(s, 6, 20, 19);
  s = mk('Ginecologia e Obstetrícia', 'Pré-eclâmpsia', 12); reg(s, 11, 20, 9); reg(s, 10); reg(s, 9, 20, 15);
  s = mk('Clínica Médica', 'Hiponatremia', 3); reg(s, 2, 20, 8);
  s = mk('Cirurgia', 'Trauma abdominal', 8); reg(s, 7, 20, 17);
  s = mk('Medicina Preventiva', 'Testes diagnósticos', 1);
  s = mk('Clínica Médica', 'Insuficiência cardíaca', 40); reg(s, 39, 30, 28); reg(s, 18, 30, 29);
  s = mk('Pediatria', 'Desidratação e TRO', 6); reg(s, 5, 20, 19); reg(s, 0, 20, 12);
  s = mk('Cirurgia', 'Apendicite aguda', 0, 'Rever escore de Alvarado');
  save(true); render(); toast('Exemplos carregados (remova em Config quando quiser)');
}

/* ===================== AUTENTICAÇÃO ===================== */
const authEl = $('#auth');
let authMode = 'login';
function showAuth(mode, msg) {
  authMode = mode || 'login';
  $('.app').hidden = true; $('#fab-novo').hidden = true; authEl.hidden = false; setSync();
  const titles = { login: 'Entrar', signup: 'Criar conta', reset: 'Recuperar senha', newpass: 'Definir nova senha' };
  const isNew = authMode === 'signup', isReset = authMode === 'reset', isNP = authMode === 'newpass';
  authEl.innerHTML = `<div class="auth-card"><div class="brandrow"><div class="logo">R</div><div><strong>Revisa</strong><span class="small">Residência médica</span></div></div>
    <h1>${titles[authMode]}</h1><p class="small muted">${isNP ? 'Escolha a nova senha da sua conta.' : isReset ? 'Enviaremos um link para o seu e-mail.' : 'Seus assuntos e revisões ficam sincronizados no celular, no tablet e no computador.'}</p>
    ${msg ? `<div class="auth-msg">${msg}</div>` : ''}
    <form id="f-auth" class="stack" style="gap:10px">
      ${isNP ? '' : `<label>E-mail<input type="email" name="email" required autocomplete="email" inputmode="email" value="${esc(localStorage.getItem('revisa-email') || '')}"></label>`}
      ${isReset ? '' : `<label>${isNP ? 'Nova senha' : 'Senha'}<input type="password" name="password" required minlength="6" autocomplete="${isNew || isNP ? 'new-password' : 'current-password'}"></label>`}
      ${!sb ? '<div class="auth-msg">Configuração do Supabase ausente (config.js).</div>' : ''}
      <button class="primary" type="submit" ${!sb ? 'disabled' : ''}>${isNew ? 'Criar conta' : isReset ? 'Enviar link' : isNP ? 'Salvar senha' : 'Entrar'}</button>
    </form>
    <div class="auth-links">${authMode === 'login' ? '<a href="#" data-auth="signup">Criar conta</a><a href="#" data-auth="reset">Esqueci a senha</a>' : '<a href="#" data-auth="login">Voltar para entrar</a>'}</div></div>`;
  $$('[data-auth]', authEl).forEach(a => a.addEventListener('click', e => { e.preventDefault(); showAuth(a.dataset.auth); }));
  $('#f-auth').addEventListener('submit', onAuthSubmit);
  const first = $('input', authEl); if (first && !first.value) first.focus();
}
const authErr = m => /invalid login/i.test(m) ? 'E-mail ou senha incorretos.' : /not confirmed/i.test(m) ? 'E-mail ainda não confirmado. Abra o link que enviamos para o seu e-mail.' : /already registered|already exists/i.test(m) ? 'Este e-mail já tem conta. Use "Entrar".' : /rate limit|too many/i.test(m) ? 'Muitas tentativas. Aguarde alguns minutos.' : /password should be/i.test(m) ? 'A senha precisa ter pelo menos 6 caracteres.' : /fetch|network/i.test(m) ? 'Sem conexão com a internet.' : m;
async function onAuthSubmit(e) {
  e.preventDefault(); const form = e.target; const btn = $('button[type=submit]', form); const fd = new FormData(form);
  const email = (fd.get('email') || '').trim().toLowerCase(); const password = fd.get('password') || '';
  btn.disabled = true; btn.textContent = 'Aguarde…';
  try {
    if (email) { try { localStorage.setItem('revisa-email', email); } catch (_) { } }
    if (authMode === 'login') { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) return showAuth('login', authErr(error.message)); }
    else if (authMode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) return showAuth('signup', authErr(error.message));
      if (!data.session) return showAuth('login', `Conta criada. Enviamos um e-mail de confirmação para <strong>${esc(email)}</strong>: abra o link e depois entre aqui.`);
    }
    else if (authMode === 'reset') { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) return showAuth('reset', authErr(error.message)); return showAuth('login', `Se existir conta para <strong>${esc(email)}</strong>, enviamos um link de recuperação.`); }
    else if (authMode === 'newpass') { const { error } = await sb.auth.updateUser({ password }); if (error) return showAuth('newpass', authErr(error.message)); const { data } = await sb.auth.getSession(); if (data.session) enter(data.session.user); toast('Senha definida'); }
  } catch (err) { showAuth(authMode, 'Sem conexão com a internet.'); }
  finally { btn.disabled = false; }
}
async function enter(u) {
  user = u; loadOutbox();
  state = Object.assign(blankData(), loadCache(), { ui: loadUI() });
  authEl.hidden = true; $('.app').hidden = false; $('#fab-novo').hidden = false; setSync();
  render(); await syncNow(); if (!state.loaded && !state.cached) { state.loaded = true; render(); }
}
function leave() { user = null; state = Object.assign(blankData(), { ui: loadUI() }); outbox = []; showAuth('login'); }
async function boot() {
  if (!sb) { showAuth('login'); return; }
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { showAuth('newpass'); return; }
    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session && !user) enter(session.user);
    if (event === 'SIGNED_OUT') leave();
  });
  const { data } = await sb.auth.getSession();
  if (data.session) { if (!user) enter(data.session.user); } else if (!authEl.innerHTML.trim()) showAuth('login');
}

/* ===================== PWA e ciclo de vida ===================== */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; $('#btn-install').hidden = false; });
$('#btn-install').addEventListener('click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('#btn-install').hidden = true; });
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !/claude\.ai|claudeusercontent/.test(location.hostname)) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
let lastDay = todayISO();
setInterval(() => { if (todayISO() !== lastDay) { lastDay = todayISO(); render(); } }, 60000);
document.addEventListener('visibilitychange', () => { if (document.hidden) return; if (todayISO() !== lastDay) { lastDay = todayISO(); render(); } if (user) syncNow(); });
window.addEventListener('online', () => { if (user) syncNow(); });
window.addEventListener('offline', () => setSync('offline'));

boot();
})();
