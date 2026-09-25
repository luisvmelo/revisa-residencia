# Revisa Residência

PWA de revisões espaçadas **adaptativas** para preparação de residência médica.
Funciona no celular, tablet e computador, com os dados sincronizados na nuvem (Supabase) e cache offline.

## Arquivos

| Arquivo | Função |
|---|---|
| `index.html` | estrutura da página |
| `styles.css` | visual (tema claro e escuro automáticos) |
| `app.js` | toda a lógica: algoritmo, agenda, painel, histórico, configurações, login e sincronização |
| `config.js` | URL e chave **publicável** do Supabase (pode ficar pública; a segurança vem do login + RLS) |
| `supabase-schema.sql` | esquema do banco já aplicado no projeto "May" (guardado aqui como referência) |
| `manifest.webmanifest` | metadados do app instalável |
| `sw.js` | service worker (funciona offline) |
| `icons/` | ícones do app |

## Banco de dados (Supabase, projeto May)

| Tabela | Conteúdo |
|---|---|
| `subjects` | um assunto por linha: número, disciplina, assunto, data do estudo, estudo realizado, dias da 1ª revisão, observações, ajuste manual de data, marcador de exemplo |
| `reviews` | uma linha por revisão realizada: nº, data programada, data realizada, tipo, questões, acertos, %, intervalo anterior, próximo intervalo, próxima atividade, próxima data, sequência de ≥90 %, faixa, observações |
| `settings` | a configuração do algoritmo (faixas, limites, escada de manutenção, disciplinas) em JSON, por usuária |
| `historico` (view) | histórico já juntado com disciplina e assunto, com a coluna `no_prazo`, para análises no painel do Supabase |

Toda tabela tem `user_id` e **Row Level Security**: cada conta só lê e escreve as próprias linhas. O papel anônimo não tem acesso. Apagar um assunto apaga as revisões dele em cascata.

Chaves: só a chave publicável está no app. A chave secreta, a service role e a senha do banco **nunca** vão para o app; guarde-as no painel do Supabase.

## Conta da usuária

1. Abra o app e toque em **Criar conta** (e-mail + senha de 6+ caracteres).
2. O Supabase envia um e-mail de confirmação. Depois de confirmar, é só **Entrar**.
3. Nos outros aparelhos, basta entrar com a mesma conta: os dados aparecem.

Ajuste recomendado no painel do Supabase (*Authentication → URL Configuration*): coloque o endereço publicado do app em **Site URL** e em **Redirect URLs**, para que os links de confirmação e de recuperação de senha voltem para o app.

Alternativa sem e-mail de confirmação: em *Authentication → Users → Add user*, crie a conta dela marcando **Auto Confirm User**.

## Como publicar

Arquivos estáticos; qualquer hospedagem com **https** serve.

- **Netlify Drop:** https://app.netlify.com/drop e arraste a pasta.
- **Vercel:** `npx vercel` na pasta, ou arraste em https://vercel.com/new.
- **GitHub Pages:** repositório com os arquivos na raiz, *Settings → Pages*.

No celular: "Adicionar à tela inicial" (Safari: compartilhar; Chrome: menu ⋮ → Instalar app).

## Kanban (Agenda → Kanban)

Cinco colunas, sempre sincronizadas com a agenda: o que muda em um aparece no outro.

| Coluna | O que significa | Ao arrastar um card para ela |
|---|---|---|
| Assuntos | teoria ainda não estudada (com ou sem data no plano) | volta a "a estudar" e sai da agenda (só se não tiver revisões) |
| Estudado | teoria vista, sem revisão marcada | registra o estudo (se vier de Assuntos) ou tira a revisão da agenda |
| Para revisar | revisão marcada e pendente: 1ª revisão, de hoje, atrasada ou de teoria | escolhe a data da 1ª revisão, ou antecipa para hoje |
| Revisado | revisão feita e em dia; volta para Para revisar na próxima data | abre o registro de questões e acertos |
| Concluído | manutenção (≥ 90 % repetido) ou marcado como concluído | tira da agenda (reativa ao mover para outra coluna) |

## Plano de estudos (Agenda → Meu plano)

Data da prova, assuntos novos por dia, primeiras revisões pendentes por dia e dias da semana de estudo. O app distribui o que falta estudar e as revisões sem data, alternando as matérias, e avisa se o ritmo não termina a teoria 30 dias antes da prova. Se atrasar, a agenda oferece **Reorganizar** a partir de hoje.

A tela **Hoje** mostra o plano do dia com progresso: revisar teoria, questões (de hoje e atrasadas) e estudos novos.

## Matérias e Painel

- **Matérias**: cada matéria com teoria vista, acerto, tendência dos últimos 30 dias e evolução semanal. Tocar abre a matéria com seus assuntos por etapa e o que precisa de atenção.
- **Painel**: cobertura da teoria, acerto geral, questões, dias seguidos estudando, "Onde dar um gás" e desempenho por matéria.
- **Ficha do assunto**: próximo passo com o motivo, questões/acertos/erros, evolução, comparação com a matéria, linha do tempo e anotações.

Cada card mostra o histórico do assunto: questões feitas, acertos, erros e % geral, número de revisões e último resultado. No celular, use o botão ⋯ do card para mover.

A lista inicial de assuntos fica em `assuntos-iniciais.js` e é importada automaticamente na primeira entrada de uma conta nova (Config → "Importar lista de assuntos" importa de novo, pulando os que já existem). Os assuntos marcados como "já vi" entram em **Estudado** sem data. O botão **Agendar revisões** da coluna distribui as primeiras revisões ao longo dos dias, alternando as disciplinas.

## Como usar no dia a dia

**Estudou um assunto novo:** `+ Novo assunto` → disciplina, assunto, data do estudo. A 1ª revisão por questões entra na agenda para o dia seguinte (ou +2 dias; nunca depois de 48 h).

**Fez uma revisão:** abra a **Agenda**, toque em **Registrar**, informe questões e acertos. O app calcula %, domínio, próxima atividade e data.

**Ficou abaixo de 50 %:** o app agenda **Revisar teoria**; depois de marcar "Teoria feita", agenda questões em 24 h.

**Atrasou:** fica em vermelho como *atrasada* até ser feita. A próxima data conta a partir do dia em que a revisão foi realmente feita.

**Sem internet:** o app continua funcionando com o cache; o indicador no topo mostra "offline · N pendentes" e envia tudo ao reconectar.

## Algoritmo (editável em Config)

| Acertos | Conduta | Intervalo padrão (mín–máx) |
|---|---|---|
| < 50 % | Revisar teoria, depois questões em 24–48 h | 1 dia (0–2) |
| 50–69 % | Questões | 2 dias (2–3) |
| 70–79 % | Questões | 5 dias (5–7) |
| 80–89 % | Questões | 10 dias (10–14) |
| ≥ 90 % | Questões | 21 dias (21–30) |
| ≥ 90 % repetido | Manutenção | 30 → 45 → 60 → 90 dias |

Se a porcentagem cair, o intervalo cai imediatamente para a faixa nova.

## Desenvolvimento local

```bash
python -m http.server 8765 --directory revisa-residencia
```

Abra http://localhost:8765. Em *Config* há **Carregar exemplos** / **Remover exemplos**.
