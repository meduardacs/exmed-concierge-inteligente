# Arquitetura e decisões técnicas

## 1. Limites do sistema

Esta é uma **demonstração de referência** independente, sem integração com o ambiente real da Exmed, prestadores reais ou meios de pagamento. Backend FastAPI serve a API e os arquivos estáticos na mesma origem. SQLite grava catálogo, carteira e reservas.

## 2. Componentes

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Apresentação | `frontend/index.html` | Shell, navegação, ícones SVG e diálogos |
| Estilo | `frontend/assets/styles.css` | Tokens, componentes, modais, responsividade |
| UI/controller | `frontend/assets/app.js` | Estado, fluxos, requisições, feedback e rendering seguro |
| API | `app/main.py` | Contratos HTTP, validação com Pydantic, regras de reserva |
| Busca | `app/rag.py` | Normalização, intenção, BM25, LSA, RRF, restrições, resumo |
| Dados | `app/database.py` | Schema, queries parametrizadas, seeding, transações |
| Corpus | `app/data/seed_catalog.json` | Catálogo de exemplo e proveniência |

## 3. Busca de ponta a ponta

1. UI envia consulta livre + filtros opcionais para `/api/search`.
2. `parse_intent` detecta conceitos e restrições; filtros selecionados na UI têm precedência.
3. `HybridRAG` pesquisa em corpus BM25 e na projeção densa LSA.
4. `retrieve` calcula RRF dos resultados elegíveis; agrega proximidade e preferência de check-up.
5. Restrição determinística: especialidade, orçamento, distância; ordenação permitida por preço, distância ou avaliação.
6. `grounded_summary` gera conteúdo rastreável usando linhas do catálogo. Opcionalmente `maybe_generate_llm` sintetiza somente evidências recuperadas.
7. UI mostra referências e simula ações locais.

### Cálculo de preço

Preço com desconto é processado em **centavos inteiros** no enriquecimento do catálogo. Isso evita valores monetários fabricados por texto de IA. O preço descontado é referenciado por `catalog:service:<id>`.

### Abordagem semântica

LSA usa TF-IDF com unigramas e bigramas, seguido por redução SVD (`n_components <= 48`) e normalização L2. A recuperação lexical usa BM25 com parametrização padrão `k1 = 1.2`, `b = 0.75`; a fusão segue RRF com `k = 60`. Para precisão semântica além do pequeno corpus, trocar LSA por embeddings multilíngues especializados, sem perder BM25/RRF, é indicado.

## 4. Banco de dados

- `providers`: identificadores, nome, região e coordenadas de exemplo.
- `services`: referência ao prestador, taxonomia, descrição, preços e descontos.
- `wallet`: carteira única de demonstração com `balance_cents`.
- `appointments`: protocolo, prestador, serviço, usuário de teste, dia, hora, pagamento e status.

Os agendamentos usam `BEGIN IMMEDIATE` no SQLite. Há um índice único parcial para `(provider_id, date, time)` quando `status = 'confirmed'`. A regra evita sobreposição entre serviços do mesmo prestador. Deduções e estornos são feitos **na mesma transação** que a reserva ou cancelamento, mantendo consistência quando há erros.

### Política de slots

- Janela: hoje + 13 dias, fuso `America/Sao_Paulo`.
- Segunda a sexta: 09:00, 10:30, 13:00, 14:30 e 16:00.
- Sábado: 09:00, 10:30 e 13:00.
- Domingo: sem expediente.
- O início do horário deve estar ao menos 30 minutos no futuro.
- Os horários são criados dinamicamente, não dependem de seed fixo.

## 5. Interfaces HTTP e erros

Validação: Pydantic gera `422` para payloads inválidos. `404` para recursos ausentes. `409` para conflitos de reserva, saldo insuficiente ou segunda tentativa de cancelar. `201` para a criação de reserva. A API usa JSON.

## 6. Segurança e privacidade

Uso **local e sem autenticação**. Não publicar diretamente na internet. Validação no backend, parâmetros SQLite no banco, saída textual sanitizada no frontend via `esc()`, e chave LLM somente no servidor são proteções iniciais, **não** substituem medidas de produção. Evite usar nome ou e-mail real de pacientes.

## 7. Roadmap de evolução

1. Autenticação real (OIDC) e autorização por paciente, administrador e prestador.
2. PostgreSQL, migrações Alembic, transações e idempotência de pagamento.
3. APIs autenticadas de prestadores e disponibilidade em tempo real.
4. Catálogo governado com versionamento de contratos, proveniência, preços e validade.
5. Embeddings especializados, avaliações offline da busca, monitoramento de qualidade e proteção contra prompt injection.
6. Observabilidade, trilhas de auditoria, LGPD, retenção e gestão de consentimento.
7. E2E tests com navegador em pipeline de CI, acessibilidade WCAG e performance budget.
