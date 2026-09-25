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
    : (d.proximaAtividade === 'TEORIA' || d.prazo !== 'futura') ? 'revisar' : d.proximaAtividade === 'MANUTENCAO' ? 'concluido' : d.numRevisoes === 0 ? 'estudado' : 'revisado';
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
function ajustarData(subjectId, iso) { const s = findSubject(subjectId); s.concluido = false; const d = derive(s); s.ajuste = { ref: d.ref, data: iso }; dbUpsertSubject(s); save(); }
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

/* ===================== UI: infra ===================== */
const view = $('#view');
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2800); }
function openModal(html, onMount) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg" id="modal-bg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
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
$('#fab-novo').addEventListener('click', () => modalNovoAssunto());
$('#sync').addEventListener('click', () => { toast('Sincronizando…'); syncNow(); });

function chipTipo(t) { const T = TIPOS[t]; return `<span class="chip ${T.cls}">${T.short}</span>`; }
function chipNivel(n) { const N = NIVEIS[n.n]; const arrow = n.tend > 0 ? ' <span class="tend-up">↗</span>' : n.tend < 0 ? ' <span class="tend-down">↘</span>' : ''; return `<span class="chip lvl">${N.emoji} ${N.nome}${arrow}</span>`; }
function nivelTexto(n) { const N = NIVEIS[n.n]; return `${N.emoji} ${N.nome}${n.tend > 0 ? ' (em evolução)' : n.tend < 0 ? ' (em queda)' : ''}`; }
function statusCls(x) { const { d } = x; if (d.prazo === 'atrasada') return 's-atrasada'; if (d.proximaAtividade === 'TEORIA') return 's-teoria'; if (d.prazo === 'hoje') return 's-hoje'; return ''; }
function acaoLabel(t) { return t === 'ESTUDO' ? 'Estudo feito' : t === 'TEORIA' ? 'Teoria feita' : 'Registrar'; }

function render() {
  if (!user) return;
  const tab = state.ui.tab || 'agenda';
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('.content').classList.toggle('wide', tab === 'agenda' && state.ui.agendaMode === 'kanban');
  const m = metrics(); const badge = m.atrasadas + m.hoje;
  const tabA = $('#tab-agenda'); let bd = $('.badge', tabA); if (badge > 0) { if (!bd) { bd = document.createElement('span'); bd.className = 'badge'; tabA.appendChild(bd); } bd.textContent = badge; } else if (bd) bd.remove();
  $('#topbar-date').textContent = fmtDiaLongo(todayISO());
  const titles = { agenda: 'Agenda', painel: 'Painel', assuntos: 'Banco de assuntos', historico: 'Histórico', config: 'Configurações' };
  $('#page-title').textContent = titles[tab];
  if (!state.loaded && !state.cached) { view.innerHTML = `<div class="empty">Carregando seus dados…</div>`; return; }
  ({ agenda: renderAgenda, painel: renderPainel, assuntos: renderAssuntos, historico: renderHistorico, config: renderConfig })[tab](m);
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
  const t = todayISO();
  const all = m.ag.slice().sort((a, b) => a.d.proximaData.localeCompare(b.d.proximaData) || a.s.disciplina.localeCompare(b.s.disciplina));
  const atras = all.filter(x => x.d.prazo === 'atrasada'); const hoje = all.filter(x => x.d.prazo === 'hoje'); const prox = all.filter(x => x.d.proximaData > t && x.d.proximaData <= addDays(t, 7));
  let h = `<div class="summary"><span class="pill s-atrasada">${atras.length} atrasada${atras.length === 1 ? '' : 's'}</span><span class="pill s-hoje">${hoje.length} hoje</span><span class="pill">${prox.length} nos próximos 7 dias</span>${m.teoria ? `<span class="pill s-teoria">${m.teoria} p/ revisar teoria</span>` : ''}</div>`;
  if (!state.subjects.length) { h += `<div class="empty"><p><strong>Nenhum assunto cadastrado ainda.</strong></p><p style="margin-top:6px">Cadastre o primeiro assunto estudado e a primeira revisão será programada automaticamente.</p><div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap"><button class="primary" id="empty-novo">+ Novo assunto</button><button id="empty-exemplo">Carregar exemplos</button></div></div>`; return h; }
  const semAgenda = m.all.filter(x => x.d.coluna === 'estudado' && !x.d.proximaData).length;
  if (semAgenda) h += `<div class="hint"><span><strong>${semAgenda}</strong> ${semAgenda === 1 ? 'assunto estudado ainda está' : 'assuntos estudados ainda estão'} sem revisão agendada.</span><button class="sm" id="go-kanban">Abrir Kanban</button></div>`;
  if (atras.length) h += `<section class="section"><div class="section-head"><h2>Atrasadas</h2><span class="count">${atras.length}</span></div><div class="stack">${atras.map(x => itemHTML(x)).join('')}</div></section>`;
  h += `<section class="section"><div class="section-head"><h2>Hoje · ${fmtDia(t)}</h2><span class="count">${hoje.length}</span></div>${hoje.length ? `<div class="stack">${hoje.map(x => itemHTML(x)).join('')}</div>` : `<div class="empty">Nada programado para hoje${atras.length ? ' — aproveite para colocar as atrasadas em dia' : ''}.</div>`}</section>`;
  h += `<section class="section"><div class="section-head"><h2>Próximos 7 dias</h2><span class="count">${prox.length}</span></div>`;
  if (!prox.length) h += `<div class="empty">Nenhuma revisão nos próximos 7 dias.</div>`;
  else { let cur = null; prox.forEach(x => { if (x.d.proximaData !== cur) { if (cur) h += `</div>`; cur = x.d.proximaData; const n = prox.filter(y => y.d.proximaData === cur).length; h += `<div class="day-head">${fmtDia(cur)} <span class="n">${n} ${n === 1 ? 'atividade' : 'atividades'}</span></div><div class="stack">`; } h += itemHTML(x); }); h += `</div>`; }
  return h + `</section>`;
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
    h += `<div class="tablewrap"><table><thead><tr><th>Data</th><th>Dia</th><th>Disciplina</th><th>Assunto</th><th>Atividade</th><th>Situação</th></tr></thead><tbody>`;
    items.forEach(i => { const dd = parseISO(i.date); const sit = i.kind === 'feita' ? '<span class="chip s-feita">REALIZADA</span>' : i.x.d.prazo === 'atrasada' ? '<span class="chip s-atrasada">ATRASADA</span>' : i.x.d.prazo === 'hoje' ? '<span class="chip s-hoje">HOJE</span>' : '<span class="chip">PROGRAMADA</span>'; h += `<tr class="row-click ${i.cls}" data-open="${i.kind === 'pend' ? i.x.s.id : i.h.subjectId}"><td class="num">${fmtBR(i.date)}</td><td>${DIAS[dd.getDay()]}</td><td>${esc(i.kind === 'pend' ? i.x.s.disciplina : i.h.disciplina)}</td><td class="wrap">${esc(i.kind === 'pend' ? i.x.s.assunto : i.h.assunto)}</td><td>${i.kind === 'pend' ? chipTipo(i.x.d.proximaAtividade) : chipTipo(i.h.tipo) + (i.h.pct != null ? ` <span class="num">${pctFmt(i.h.pct)}</span>` : '')}</td><td>${sit}</td></tr>`; });
    h += `</tbody></table></div>`;
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
  const gk = $('#go-kanban', root); if (gk) gk.addEventListener('click', () => { state.ui.agendaMode = 'kanban'; save(); render(); window.scrollTo({ top: 0 }); });
}

/* ===================== KANBAN ===================== */
const COLS = [
  { id: 'assuntos', nome: 'Assuntos', desc: 'a estudar' },
  { id: 'estudado', nome: 'Estudado', desc: 'teoria vista' },
  { id: 'revisar', nome: 'Para revisar', desc: 'hoje, atrasadas e teoria' },
  { id: 'revisado', nome: 'Revisado', desc: 'próxima revisão agendada' },
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
    ? `<div class="kstats num"><span><b>${d.totQuestoes}</b> questões</span><span class="ok"><b>${d.totAcertos}</b> acertos</span><span class="err"><b>${d.totErros}</b> erros</span><span><b>${d.pctGeral}%</b></span></div><div class="kmeta">${revs} · última ${pctFmt(d.ultimoPct)}${d.nivel.n ? ' · ' + NIVEIS[d.nivel.n].emoji : ''}${d.nivel.tend > 0 ? ' ↗' : d.nivel.tend < 0 ? ' ↘' : ''}</div>`
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
  h += `<p class="small muted" style="margin-bottom:10px">Arraste os cards entre as colunas, ou toque em ⋯ para mover. O que muda aqui muda também na agenda.</p><div class="kanban">`;
  COLS.forEach(c => {
    const items = list.filter(x => x.d.coluna === c.id).sort(c.id === 'assuntos' || c.id === 'concluido' ? porDisc : porData);
    const semData = c.id === 'estudado' ? items.filter(x => !x.d.proximaData && x.d.numRevisoes === 0).length : 0;
    h += `<section class="kcol" data-col="${c.id}"><header class="kcol-head"><div><h3>${c.nome}</h3><span class="small muted">${c.desc}</span></div><span class="kcount num">${items.length}</span></header>`;
    if (semData) h += `<div class="kcol-tools"><button class="sm primary" id="k-lote">Agendar ${semData} ${semData === 1 ? 'revisão' : 'revisões'}</button></div>`;
    h += `<div class="kcol-body" data-drop="${c.id}">${items.length ? items.map(kanbanCard).join('') : '<div class="kempty">Arraste um card para cá</div>'}</div></section>`;
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
  if (col === 'revisar') { s.concluido = false; const d2 = derive(s); s.ajuste = { ref: d2.ref, data: t }; return done(`${TIPOS[d2.proximaAtividade].label} agendada para hoje`); }
  if (col === 'revisado') return modalRegistrar(id);
}
function modalMover(id) {
  const s = findSubject(id); if (!s) return; const d = derive(s);
  const acao = { assuntos: 'volta a estudar e sai da agenda', estudado: s.estudoRealizado ? 'tira a revisão da agenda' : 'registra o estudo da teoria', revisar: s.estudoRealizado ? 'agenda a revisão para hoje' : 'registra o estudo da teoria', revisado: s.estudoRealizado ? 'registra questões e acertos' : 'registra o estudo da teoria', concluido: 'sai da agenda' };
  openModal(`<div class="stack" style="gap:12px"><div><span class="eyebrow">${esc(s.disciplina)}</span><h2>${esc(s.assunto)}</h2><p class="small muted">Está em <strong>${colNome(d.coluna)}</strong>. Mover para:</p></div><div class="move-list">${COLS.map(c => `<button data-col="${c.id}" ${c.id === d.coluna ? 'disabled' : ''}>${c.nome}<small>${c.id === d.coluna ? 'coluna atual' : acao[c.id]}</small></button>`).join('')}</div><div class="actions"><button data-close>Cancelar</button></div></div>`, bg => {
    $$('[data-col]', bg).forEach(b => b.addEventListener('click', () => { closeModal(); moveTo(id, b.dataset.col); }));
  });
}
function distribuirLote(subs, porDia, inicio) {
  const grupos = {}; subs.forEach(s => (grupos[s.disciplina] = grupos[s.disciplina] || []).push(s));
  const filas = Object.values(grupos); const ordem = [];
  while (filas.some(f => f.length)) filas.forEach(f => { if (f.length) ordem.push(f.shift()); });
  return ordem.map((s, i) => ({ s, data: addDays(inicio, Math.floor(i / porDia)) }));
}
function modalAgendarLote(subs) {
  if (!subs.length) return toast('Nenhum assunto estudado sem revisão.'); const t = todayISO();
  openModal(`<form id="f-lote" class="stack" style="gap:12px"><h2>Agendar revisões</h2><p class="small muted">${subs.length} ${subs.length === 1 ? 'assunto estudado está' : 'assuntos estudados estão'} sem revisão agendada. O app distribui as primeiras revisões por questões ao longo dos dias, alternando as disciplinas.</p>
    <div class="row2"><label>Revisões por dia<input type="number" name="porDia" min="1" max="50" value="5" inputmode="numeric" required></label><label>A partir de<input type="date" name="inicio" value="${t}" required></label></div>
    <div class="preview" id="lote-prev"></div><div class="actions"><button type="button" data-close>Cancelar</button><button class="primary" type="submit">Agendar</button></div></form>`, () => {
    const f = $('#f-lote');
    const prev = () => { const n = Math.max(1, Number(f.porDia.value) || 1); const ini = f.inicio.value || t; const dias = Math.ceil(subs.length / n); $('#lote-prev').innerHTML = `<span>${subs.length} ${subs.length === 1 ? 'revisão' : 'revisões'}, ${n} por dia: de <strong class="num">${fmtBRFull(ini)}</strong> a <strong class="num">${fmtBRFull(addDays(ini, dias - 1))}</strong> (${dias} ${dias === 1 ? 'dia' : 'dias'}).</span>`; };
    f.porDia.addEventListener('input', prev); f.inicio.addEventListener('input', prev); prev();
    f.addEventListener('submit', e => {
      e.preventDefault(); const n = Math.max(1, Number(f.porDia.value) || 1);
      const plano = distribuirLote(subs, n, f.inicio.value || t);
      plano.forEach(({ s, data }) => { s.ajuste = { ref: 'inicio', data }; s.concluido = false; });
      dbUpsertSubjects(plano.map(p => p.s)); save(true); closeModal(); render(); toast(`${plano.length} revisões agendadas`);
    });
  });
}

/* ===================== PAINEL ===================== */
function renderPainel(m) {
  const tiles = [
    { v: m.hoje, l: 'Revisões para hoje', cls: 'today' }, { v: m.atrasadas, l: 'Revisões atrasadas', cls: m.atrasadas ? 'alert' : '' }, { v: m.prox7, l: 'Próximos 7 dias', cls: '' },
    { v: m.total, l: 'Assuntos cadastrados', cls: '' }, { v: m.dominioAlto, l: 'Assuntos com domínio alto (🟢🔵)', cls: 'good' }, { v: m.teoria, l: 'Precisam de revisão teórica', cls: m.teoria ? 'theory' : '' },
    { v: pctFmt(m.media), l: 'Média geral de acertos', cls: '' }, { v: m.noMes, l: `Revisões em ${MESES[Number(todayISO().slice(5, 7)) - 1]}`, cls: '' }, { v: m.noPrazo == null ? '—' : m.noPrazo + '%', l: 'Revisões feitas no prazo', cls: '' },
  ];
  let h = `<div class="grid metrics section">${tiles.map(t => `<div class="metric ${t.cls}"><span class="v">${t.v}</span><span class="l">${t.l}</span></div>`).join('')}</div><div class="charts section">`;
  h += `<div class="card chart-card"><h3>Evolução da porcentagem de acertos</h3><p class="small muted" style="margin-bottom:8px">Cada ponto é uma revisão por questões, em ordem cronológica.</p>${chartEvolucao()}<div class="tip" id="tip-evo"></div></div>`;
  h += `<div class="card chart-card"><h3>Revisões realizadas por semana</h3><p class="small muted" style="margin-bottom:8px">Últimas 10 semanas (semana começa na segunda).</p>${chartSemanas()}<div class="tip" id="tip-sem"></div></div>`;
  h += `<div class="card"><h3>Distribuição por nível de domínio</h3><p class="small muted" style="margin-bottom:8px">Baseado no desempenho mais recente de cada assunto.</p>${chartDominio(m)}</div>`;
  const teor = m.ag.filter(x => x.d.proximaAtividade === 'TEORIA').sort((a, b) => a.d.proximaData.localeCompare(b.d.proximaData));
  h += `<div class="card"><h3>Precisam de revisão teórica</h3><p class="small muted" style="margin-bottom:8px">Acertos abaixo de ${cfg().limiteTeoria}% na última bateria.</p>${teor.length ? `<div class="stack">${teor.map(x => itemHTML(x, { showDate: true })).join('')}</div>` : '<div class="empty">Nenhum assunto precisa de revisão teórica agora.</div>'}</div></div>`;
  view.innerHTML = h; bindItems(view); bindChartTips();
}
function chartEvolucao() {
  const qh = state.history.filter(h => isQuestoes(h.tipo) && h.pct != null).sort((a, b) => a.dataRealizada.localeCompare(b.dataRealizada) || a.seq - b.seq).slice(-30);
  if (!qh.length) return `<div class="chart-empty">Ainda sem revisões por questões registradas.</div>`;
  const W = 600, H = 220, pl = 36, pr = 16, pt = 14, pb = 30, iw = W - pl - pr, ih = H - pt - pb; const n = qh.length;
  const x = i => pl + (n === 1 ? iw / 2 : (i / (n - 1)) * iw); const y = v => pt + ih - (v / 100) * ih; const lim = cfg().limiteTeoria;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução da porcentagem de acertos">`;
  [0, 25, 50, 75, 100].forEach(v => { s += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)" stroke-width="1"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">${v}%</text>`; });
  s += `<line x1="${pl}" x2="${W - pr}" y1="${y(lim)}" y2="${y(lim)}" stroke="var(--orange)" stroke-width="1" stroke-dasharray="4 4"/><text x="${W - pr}" y="${y(lim) - 4}" text-anchor="end" font-size="10" fill="var(--orange)">limite teoria ${lim}%</text>`;
  const pts = qh.map((h, i) => [x(i), y(h.pct)]);
  if (n > 1) { s += `<path d="M${pts.map(p => p.join(',')).join(' L')} L${pts[n - 1][0]},${y(0)} L${pts[0][0]},${y(0)} Z" fill="var(--accent)" opacity=".10"/><path d="M${pts.map(p => p.join(',')).join(' L')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`; }
  qh.forEach((h, i) => { s += `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="${i === n - 1 ? 5 : 3.5}" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/><circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="12" fill="transparent" data-tip="${esc(h.assunto)} · ${fmtBR(h.dataRealizada)} · ${pctFmt(h.pct)}" data-tipfor="tip-evo"/>`; });
  s += `<text x="${pts[n - 1][0]}" y="${pts[n - 1][1] - 10}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--ink)">${pctFmt(qh[n - 1].pct)}</text>`;
  (n <= 6 ? qh.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1]).forEach(i => { s += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${fmtBR(qh[i].dataRealizada)}</text>`; });
  return s + `</svg>`;
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
function bindChartTips() {
  $$('[data-tip]', view).forEach(el => { const tip = document.getElementById(el.dataset.tipfor); const card = el.closest('.chart-card'); const show = ev => { const r = card.getBoundingClientRect(); const p = ev.touches ? ev.touches[0] : ev; tip.textContent = el.dataset.tip; tip.style.display = 'block'; tip.style.left = (p.clientX - r.left) + 'px'; tip.style.top = (p.clientY - r.top) + 'px'; }; el.addEventListener('mousemove', show); el.addEventListener('mouseleave', () => tip.style.display = 'none'); el.addEventListener('touchstart', show, { passive: true }); el.addEventListener('touchend', () => setTimeout(() => tip.style.display = 'none', 1200)); });
}

/* ===================== ASSUNTOS ===================== */
function renderAssuntos(m) {
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
  view.innerHTML = h; bindItems(view);
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
    h += `<div class="tablewrap"><table><thead><tr><th>ID</th><th>Disciplina</th><th>Assunto</th><th>Nº</th><th>Programada</th><th>Realizada</th><th>Tipo</th><th>Questões</th><th>Acertos</th><th>%</th><th>Int. anterior</th><th>Próx. intervalo</th><th>Próxima atividade</th><th>Próxima data</th><th>Obs.</th><th></th></tr></thead><tbody>`;
    list.forEach(e => { const hist = subjectHistory(e.subjectId); const isLast = hist.length && hist[hist.length - 1].id === e.id; const atraso = diffDays(e.dataProgramada, e.dataRealizada); h += `<tr class="s-feita"><td class="num">#${sm[e.subjectId] ? sm[e.subjectId].numero : '?'}</td><td>${esc(e.disciplina)}</td><td class="wrap row-click" data-open="${e.subjectId}"><strong>${esc(e.assunto)}</strong></td><td class="num">${e.numero}</td><td class="num">${fmtBRFull(e.dataProgramada)}</td><td class="num">${fmtBRFull(e.dataRealizada)}${atraso > 0 ? ` <span class="chip s-atrasada">+${atraso}d</span>` : ''}</td><td>${chipTipo(e.tipo)}</td><td class="num">${e.questoes ?? '—'}</td><td class="num">${e.acertos ?? '—'}</td><td class="num"><strong>${pctFmt(e.pct)}</strong></td><td class="num">${e.intervaloAnterior != null ? e.intervaloAnterior + ' d' : '—'}</td><td class="num">${e.proximoIntervalo} d</td><td>${chipTipo(e.proximaAtividade)}</td><td class="num">${fmtBRFull(e.proximaData)}</td><td class="wrap small muted">${esc(e.obs || '')}</td><td>${isLast ? `<button class="sm ghost danger" data-undo="${e.subjectId}" title="Desfazer esta revisão">Desfazer</button>` : ''}</td></tr>`; });
    h += `</tbody></table></div>`;
  }
  view.innerHTML = h;
  const upd = () => { state.ui.hfiltros = { q: $('#h-q').value, disc: $('#h-disc').value }; save(); render(); if (state.ui._focusH) { const i = $('#h-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } };
  $('#h-q').addEventListener('input', () => { state.ui._focusH = true; upd(); }); $('#h-disc').addEventListener('change', () => { state.ui._focusH = false; upd(); });
  $('#h-csv').addEventListener('click', exportCSV);
  $$('[data-open]', view).forEach(el => el.addEventListener('click', () => modalAssunto(el.dataset.open)));
  $$('[data-undo]', view).forEach(b => b.addEventListener('click', () => { if (confirm('Desfazer a última revisão deste assunto? A próxima atividade volta ao estado anterior.')) { desfazerUltima(b.dataset.undo); toast('Revisão desfeita'); render(); } }));
}

/* ===================== CONFIGURAÇÕES ===================== */
function renderConfig() {
  const c = cfg();
  const faixaRows = c.faixas.map((f, i) => { const next = c.faixas[i + 1]; const lbl = i === 0 ? `&lt;${c.limiteTeoria}%` : `${f.min}–${next ? next.min - 1 : 100}%`; return `<tr><td><strong>${lbl}</strong></td><td><input name="nome" value="${esc(f.nome)}" style="min-width:110px"></td><td>${i === 0 ? '<span class="muted">0</span>' : `<input type="number" name="min" min="1" max="100" value="${f.min}">`}</td><td><input type="number" name="intMin" min="0" value="${f.intMin}"></td><td><input type="number" name="intMax" min="0" value="${f.intMax}"></td><td><input type="number" name="padrao" min="0" value="${f.padrao}"></td><td><select name="conduta"><option value="QUESTOES" ${f.conduta === 'QUESTOES' ? 'selected' : ''}>Questões</option><option value="TEORIA" ${f.conduta === 'TEORIA' ? 'selected' : ''}>Revisar teoria</option></select></td></tr>`; }).join('');
  const h = `<div class="card stack" style="margin-bottom:16px"><h2>Conta</h2><p class="small">Conectada como <strong>${esc(user.email || '')}</strong>. Os dados ficam no Supabase e aparecem em qualquer aparelho em que você entrar.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="sm" id="acc-sync">Sincronizar agora</button><button class="sm" id="acc-pass">Trocar senha</button><button class="sm" id="acc-out">Sair</button></div></div>
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
    <details><summary>Instalar como app</summary><p class="small">No celular: abra no navegador e use "Adicionar à tela inicial" (Safari: botão compartilhar; Chrome: menu ⋮). No computador: ícone de instalar na barra de endereço.</p></details></div>`;
  view.innerHTML = h;
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
  const s = findSubject(id); if (!s) return; const d = derive(s); const c = cfg(); const hist = d.hist.slice().reverse();
  const f = d.last && isQuestoes(d.last.tipo) ? faixaFor(d.last.pct) : null;
  const faixaTxt = f ? ` · faixa ${f.intMin}–${f.intMax} d` : d.ref === 'inicio' && s.estudoRealizado ? ` · até ${c.primeiraRevisao.max} d` : d.proximaAtividade === 'QUESTOES_POS_TEORIA' ? ` · até ${c.posTeoria.max} d` : '';
  const html = `<div class="stack" style="gap:12px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><span class="eyebrow">${esc(s.disciplina)} · #${s.numero}${s.exemplo ? ' · exemplo' : ''}</span><h2 style="font-size:1.2rem">${esc(s.assunto)}</h2></div>${chipNivel(d.nivel)}</div>
    <div class="preview"><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${chipTipo(d.proximaAtividade)}${d.prazo === 'atrasada' ? `<span class="chip s-atrasada">ATRASADA · ${d.diasAtraso}d</span>` : d.prazo === 'hoje' ? '<span class="chip s-hoje">HOJE</span>' : ''}</div><b class="num">${d.proximaData ? fmtDiaLongo(d.proximaData) : s.concluido ? 'Concluído, fora da agenda' : 'Sem data na agenda'}</b><span class="small muted">Intervalo calculado: ${d.intervalo} ${d.intervalo === 1 ? 'dia' : 'dias'}${faixaTxt}${d.ajustada ? ' · data ajustada manualmente' : ''}</span><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px"><input type="date" id="a-data" value="${d.proximaData || todayISO()}" style="width:auto;min-height:36px;padding:4px 8px"><button class="sm" id="a-ajustar">${d.proximaData ? 'Ajustar data' : 'Agendar'}</button>${d.proximaData ? '<button class="sm" id="a-adiar">Adiar +1 dia</button>' : ''}</div></div>
    <div class="kv small" style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px"><b class="muted">Status</b><span>${d.status}</span><b class="muted">Estudo inicial</b><span class="num">${fmtBRFull(s.dataEstudo)}${s.estudoRealizado ? '' : ' (ainda não realizado)'}</span><b class="muted">Última revisão</b><span class="num">${d.ultimaRevisao ? `${fmtBRFull(d.ultimaRevisao)} · ${TIPOS[d.ultimoTipo].label}` : '—'}</span><b class="muted">Último resultado</b><span class="num">${d.ultimoPct != null ? `${d.ultimosAcertos}/${d.ultimasQuestoes} · ${pctFmt(d.ultimoPct)}` : '—'}</span><b class="muted">Domínio</b><span>${nivelTexto(d.nivel)}</span>${s.obs ? `<b class="muted">Obs.</b><span>${esc(s.obs)}</span>` : ''}</div>
    <div><span class="eyebrow">Histórico (${hist.length})</span>${hist.length ? `<div class="hist-list" style="margin-top:6px">${hist.map(h => `<div class="hist-row"><span class="num">${fmtBR(h.dataRealizada)}</span><span>${TIPOS[h.tipo].short}${h.pct != null ? ` · <strong class="num">${pctFmt(h.pct)}</strong> (${h.acertos}/${h.questoes})` : ''}${h.obs ? `<br><span class="muted">${esc(h.obs)}</span>` : ''}</span><span class="muted num">→ ${h.proximoIntervalo}d</span></div>`).join('')}</div>` : '<p class="small muted" style="margin-top:4px">Nenhuma revisão registrada.</p>'}</div>
    <div class="actions"><div class="left"><button class="sm" id="a-editar">Editar</button>${hist.length ? '<button class="sm ghost danger" id="a-undo">Desfazer última</button>' : ''}</div><button data-close>Fechar</button><button class="primary" id="a-reg">${acaoLabel(d.proximaAtividade)}</button></div></div>`;
  openModal(html, bg => {
    $('#a-reg').addEventListener('click', () => modalRegistrar(id));
    $('#a-editar').addEventListener('click', () => modalNovoAssunto(s));
    const undo = $('#a-undo', bg); if (undo) undo.addEventListener('click', () => { if (confirm('Desfazer a última revisão deste assunto?')) { desfazerUltima(id); toast('Revisão desfeita'); modalAssunto(id); render(); } });
    const aplicar = iso => { if (!iso) return; ajustarData(id, iso); const dd = derive(s); let warn = ''; if (dd.ref === 'inicio' && s.estudoRealizado && s.dataEstudo && diffDays(s.dataEstudo, iso) > c.primeiraRevisao.max) warn = ` · atenção: passou de ${c.primeiraRevisao.max * 24}h do estudo`; else if (f && diffDays(d.last.dataRealizada, iso) > f.intMax) warn = ` · atenção: acima do máximo da faixa (${f.intMax}d)`; toast(`Próxima data: ${fmtBR(iso)}${warn}`); modalAssunto(id); render(); };
    $('#a-ajustar').addEventListener('click', () => aplicar($('#a-data').value));
    const adiar = $('#a-adiar', bg); if (adiar) adiar.addEventListener('click', () => aplicar(addDays(d.proximaData, 1)));
  });
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
