# Contratos da API — Exmed Concierge de demonstração

Base local: `http://127.0.0.1:8000`  
Swagger: `GET /docs`  
OpenAPI: `GET /openapi.json`

> Todas as respostas dizem respeito a registros fictícios. O campo `demo: true` marca as operações demonstrativas mais importantes.

## Busca RAG híbrida

`POST /api/search`

```json
{
  "query": "Preciso de um check-up completo do coração até R$ 300 perto da Paulista usando meu saldo",
  "budget": null,
  "location": null,
  "radius_km": 8,
  "specialty": null,
  "use_balance": null,
  "sort": "recommended"
}
```

Parâmetros `null` permitem extrair restrições da frase. Quando fornecidos, filtros explícitos têm precedência. `specialty: "Todas"` remove o filtro de especialidade. `budget: 100000` funciona como teto efetivamente livre no catálogo demo. Ordenações permitidas: `recommended`, `price`, `distance`, `rating`.

**Resposta resumida:**

```json
{
  "results": [
    {
      "id": 101,
      "provider_name": "Laboratório Sabiá",
      "title": "Check-up Cardiológico Completo",
      "specialty": "Cardiologia",
      "original_price": 356,
      "price": 267.0,
      "saving": 89.0,
      "distance_km": 0.1,
      "source_id": "catalog:service:101",
      "retrieval": {
        "bm25": 2.34,
        "semantic_similarity": 0.71,
        "rrf": 0.0325
      }
    }
  ],
  "count": 1,
  "intent": {"budget": 300, "specialty": "Cardiologia", "location": "Av. Paulista", "use_balance": true},
  "summary": {
    "headline": "Melhor combinação: Laboratório Sabiá",
    "estimated_total": 267.0,
    "saving": 89.0,
    "citations": ["catalog:service:101"],
    "mode": "grounded_template"
  },
  "retrieval_method": "hybrid_bm25_lsa_rrf",
  "demo": true
}
```

*Os campos e a pontuação exibidos acima são exemplos didáticos de estrutura; o retorno real contém metadados adicionais e a pontuação depende do índice e da consulta.*

## Agenda

`GET /api/slots?service_id=101&day=2026-11-19`

```json
{
  "date": "2026-11-19",
  "slots": [
    {"time": "09:00", "available": true},
    {"time": "10:30", "available": true}
  ],
  "reason": null
}
```

A data deve estar na janela atual de 14 dias; valores acima são **meramente ilustrativos**.

`POST /api/appointments`

```json
{
  "service_id": 101,
  "date": "2026-11-19",
  "time": "09:00",
  "patient_name": "Pessoa de Teste",
  "patient_email": "teste@exemplo.com",
  "payment_method": "wallet"
}
```

`payment_method`: `wallet` deduz valor da carteira fictícia; `demo` registra reserva sem dedução de saldo. O status `201 Created` retorna protocolo com prefixo `EX-` e novos valores da carteira.

`GET /api/appointments` lista reservas ordenadas por data.  
`POST /api/appointments/{id}/cancel` cancela reserva e devolve saldo se pago pela carteira fictícia.

**Regras e códigos:** `404` desconhecido; `409` horário ocupado, saldo insuficiente ou reserva já cancelada; `422` data passada, horário inválido e outros erros de validação.

## Outros endpoints

| Rota | Retorno |
|---|---|
| `GET /api/health` | Estado da API e modelo de busca |
| `GET /api/bootstrap` | Filtros, sugestões, catálogo, carteira |
| `GET /api/providers` | Lista de 7 parceiros fictícios |
| `GET /api/providers/{id}/services` | Serviços do parceiro |
| `GET /api/services/{id}` | Serviço isolado e referência |
| `GET /api/wallet` | Saldo, crédito inicial, consumo e reservas ativas |

O esquema completo e os exemplos executáveis dos contratos ficam disponíveis no `/docs` gerado automaticamente pelo FastAPI.
