"""HTTP API and single-port static frontend for the Exmed Concierge demonstrator."""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import urllib.error
import urllib.request
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from .database import Database
from .rag import HybridRAG, grounded_summary, parse_intent

LOGGER = logging.getLogger("exmed.concierge")
ROOT = Path(__file__).resolve().parent.parent
TIMEZONE = ZoneInfo("America/Sao_Paulo")
AVAILABLE_TIMES = ["09:00", "10:30", "13:00", "14:30", "16:00"]


class SearchRequest(BaseModel):
    query: str = Field(default="", max_length=500)
    budget: float | None = Field(default=None, ge=0, le=100000)
    specialty: str | None = Field(default=None, max_length=70)
    location: str | None = Field(default=None, max_length=80)
    radius_km: float = Field(default=8, ge=0.5, le=40)
    use_balance: bool | None = None
    sort: str = "recommended"

    @field_validator("sort")
    @classmethod
    def validate_sort(cls, value: str) -> str:
        if value not in {"recommended", "price", "distance", "rating"}:
            raise ValueError("Ordenação não reconhecida.")
        return value


class AppointmentRequest(BaseModel):
    service_id: int
    patient_name: str = Field(min_length=3, max_length=100)
    patient_email: str = Field(default="", max_length=150)
    date: date
    time: str
    payment_method: str = "wallet"

    @field_validator("patient_name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if len(v.strip()) < 3:
            raise ValueError("Informe um nome com pelo menos três caracteres.")
        return v.strip()

    @field_validator("patient_email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        if v and ("@" not in v or "." not in v.split("@")[-1]):
            raise ValueError("E-mail inválido.")
        return v.strip()

    @field_validator("payment_method")
    @classmethod
    def validate_method(cls, v: str) -> str:
        if v not in {"wallet", "demo"}:
            raise ValueError("Escolha saldo Exmed ou pagamento simulado.")
        return v


def today_local() -> date:
    return datetime.now(TIMEZONE).date()


def validate_slot(day: date, slot: str) -> None:
    delta = (day - today_local()).days
    if delta < 0 or delta > 13:
        raise HTTPException(422, "Escolha um dia entre hoje e os próximos 13 dias.")
    if day.weekday() == 6:
        raise HTTPException(422, "Não há atendimentos aos domingos na demonstração.")
    times = AVAILABLE_TIMES[:3] if day.weekday() == 5 else AVAILABLE_TIMES
    if slot not in times:
        raise HTTPException(422, "Horário indisponível para esta data.")
    selected = datetime.combine(day, datetime.strptime(slot, "%H:%M").time(), tzinfo=TIMEZONE)
    if selected <= datetime.now(TIMEZONE) + timedelta(minutes=30):
        raise HTTPException(422, "Escolha um horário futuro com 30 minutos de antecedência.")


def maybe_generate_llm(intent: dict, results: list[dict], summary: dict) -> dict:
    """Optional grounded LLM answer. No credentials are required for core functionality."""
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if not key or not results:
        return summary
    evidence = [{k: s[k] for k in ("source_id", "provider_name", "title", "specialty", "price", "saving", "distance_km")}
                for s in results[:3]]
    payload = {
        "model": os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        "temperature": 0.0,
        "max_tokens": 180,
        "messages": [
            {"role": "system", "content": "Você é um concierge de DEMONSTRAÇÃO. Responda em português, em até 60 palavras. Use EXCLUSIVAMENTE as evidências JSON fornecidas. Não invente dados, diagnósticos, horários, procedimentos nem preços. Deixe claro que tudo é fictício. Não recomende condutas médicas."},
            {"role": "user", "content": json.dumps({"pedido": intent["query"], "evidencias": evidence}, ensure_ascii=False)},
        ],
    }
    try:
        request = urllib.request.Request("https://api.openai.com/v1/chat/completions",
                                         data=json.dumps(payload).encode("utf-8"),
                                         headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=8) as response:  # noqa: S310 -- fixed trusted URL
            data = json.loads(response.read())
        generated = data["choices"][0]["message"]["content"].strip()
        if generated:
            summary = {**summary, "body": generated, "mode": "llm_grounded"}
    except (urllib.error.URLError, KeyError, ValueError, TimeoutError, OSError) as exc:
        LOGGER.warning("LLM indisponível, usando síntese fundamentada local: %s", type(exc).__name__)
    return summary


def create_app(db_path: str | Path | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(db_path)
        db.initialize()
        app.state.db = db
        app.state.rag = HybridRAG(db.list_services())
        LOGGER.info("Catálogo demonstrativo indexado: %d serviços", len(app.state.rag.services))
        yield

    app = FastAPI(title="Exmed Concierge Inteligente | Demo", version="1.0.0",
                  description="API de demonstração com RAG híbrido e agendamento fictício.", lifespan=lifespan)

    @app.get("/api/health")
    def health(request: Request):
        return {"status": "ok", "catalog_items": len(request.app.state.rag.services),
                "retrieval": "BM25 + dense LSA + RRF", "demo": True}

    @app.get("/api/bootstrap")
    def bootstrap(request: Request):
        db = request.app.state.db
        return {"wallet": db.wallet(), "providers": db.list_providers(),
                "specialties": sorted({s["specialty"] for s in request.app.state.rag.services}),
                "locations": ["Av. Paulista", "Jardins", "Paraíso", "Vila Mariana", "Pinheiros", "Consolação", "Centro"],
                "catalog_count": len(request.app.state.rag.services),
                "suggestions": ["Check-up completo do coração perto da Paulista até R$ 300 usando meu saldo",
                                "Quero um hemograma por até R$ 100",
                                "Dermatologista perto dos Jardins",
                                "Consulta de ortopedia para dor na coluna"],
                "demo": True}

    @app.post("/api/search")
    def search(payload: SearchRequest, request: Request):
        db = request.app.state.db
        intent = parse_intent(payload.query, budget=payload.budget,
                              specialty=payload.specialty, location=payload.location,
                              radius_km=payload.radius_km, use_balance=payload.use_balance)
        results = request.app.state.rag.retrieve(intent, sort=payload.sort)
        summary = grounded_summary(intent, results, db.wallet()["balance"])
        summary = maybe_generate_llm(intent, results, summary)
        # Details for source inspection; the frontend shows the references.
        return {"results": results, "count": len(results), "intent": intent,
                "summary": summary, "retrieval_method": "hybrid_bm25_lsa_rrf", "demo": True}

    @app.get("/api/services/{service_id}")
    def service(service_id: int, request: Request):
        item = request.app.state.db.get_service(service_id)
        if not item:
            raise HTTPException(404, "Serviço não encontrado no catálogo demonstrativo.")
        return {"service": item}

    @app.get("/api/slots")
    def slots(request: Request, service_id: int = Query(ge=1), day: date = Query()):
        item = request.app.state.db.get_service(service_id)
        if not item:
            raise HTTPException(404, "Serviço não encontrado.")
        delta = (day - today_local()).days
        if not 0 <= delta <= 13:
            raise HTTPException(422, "Data fora da janela de 14 dias.")
        if day.weekday() == 6:
            return {"date": day, "slots": [], "reason": "Sem expediente aos domingos"}
        booked = request.app.state.db.booked_times(item["provider_id"], day.isoformat())
        times = AVAILABLE_TIMES[:3] if day.weekday() == 5 else AVAILABLE_TIMES
        now = datetime.now(TIMEZONE) + timedelta(minutes=30)
        options = [{"time": t, "available": t not in booked and datetime.combine(day, datetime.strptime(t, "%H:%M").time(), tzinfo=TIMEZONE) > now}
                   for t in times]
        return {"date": day, "slots": options, "reason": None}

    @app.get("/api/appointments")
    def appointments(request: Request):
        return {"items": request.app.state.db.list_appointments()}

    @app.get("/api/wallet")
    def wallet(request: Request):
        return request.app.state.db.wallet()

    @app.post("/api/appointments", status_code=201)
    def create_appointment(payload: AppointmentRequest, request: Request):
        db = request.app.state.db
        service = db.get_service(payload.service_id)
        if not service:
            raise HTTPException(404, "Serviço não encontrado.")
        validate_slot(payload.date, payload.time)
        amount = round(service["price"] * 100)
        confirmation = "EX-" + uuid.uuid4().hex[:8].upper()
        try:
            with db.connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                if payload.payment_method == "wallet":
                    current = connection.execute("SELECT balance_cents FROM wallet WHERE id=1").fetchone()[0]
                    if current < amount:
                        connection.execute("ROLLBACK")
                        raise HTTPException(409, "Saldo demonstrativo insuficiente. Selecione pagamento simulado.")
                occupied = connection.execute("SELECT 1 FROM appointments WHERE provider_id=? AND date=? AND time=? AND status='confirmed'",
                                              (service["provider_id"], payload.date.isoformat(), payload.time)).fetchone()
                if occupied:
                    connection.execute("ROLLBACK")
                    raise HTTPException(409, "Este horário foi reservado. Escolha outro disponível.")
                connection.execute("""INSERT INTO appointments
                    (id, service_id, provider_id, patient_name, patient_email, date, time, status, payment_method, amount_cents, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)""",
                    (confirmation, payload.service_id, service["provider_id"], payload.patient_name,
                     payload.patient_email, payload.date.isoformat(), payload.time, payload.payment_method,
                     amount, datetime.now(TIMEZONE).isoformat()))
                if payload.payment_method == "wallet":
                    connection.execute("UPDATE wallet SET balance_cents=balance_cents-? WHERE id=1", (amount,))
                connection.execute("COMMIT")
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Este horário não está mais disponível.") from None
        return {"id": confirmation, "status": "confirmed", "demo": True,
                "date": payload.date, "time": payload.time, "service": service["title"],
                "provider": service["provider_name"], "amount": amount/100,
                "payment_method": payload.payment_method, "wallet": db.wallet()}

    @app.post("/api/appointments/{appointment_id}/cancel")
    def cancel_appointment(appointment_id: str, request: Request):
        db = request.app.state.db
        with db.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            record = connection.execute("SELECT status, payment_method, amount_cents FROM appointments WHERE id=?", (appointment_id,)).fetchone()
            if not record:
                connection.execute("ROLLBACK")
                raise HTTPException(404, "Agendamento não encontrado.")
            if record["status"] != "confirmed":
                connection.execute("ROLLBACK")
                raise HTTPException(409, "O agendamento já foi cancelado.")
            connection.execute("UPDATE appointments SET status='cancelled', cancelled_at=? WHERE id=?",
                               (datetime.now(TIMEZONE).isoformat(), appointment_id))
            if record["payment_method"] == "wallet":
                connection.execute("UPDATE wallet SET balance_cents=balance_cents+? WHERE id=1", (record["amount_cents"],))
            connection.execute("COMMIT")
        return {"id": appointment_id, "status": "cancelled", "refunded": record["payment_method"] == "wallet",
                "wallet": db.wallet()}

    @app.get("/api/providers")
    def providers(request: Request):
        return {"items": request.app.state.db.list_providers()}

    @app.get("/api/providers/{provider_id}/services")
    def provider_services(provider_id: int, request: Request):
        provider = next((p for p in request.app.state.db.list_providers() if p["id"] == provider_id), None)
        if provider is None:
            raise HTTPException(404, "Parceiro fictício não encontrado.")
        return {"provider": provider, "services": [s for s in request.app.state.db.list_services() if s["provider_id"] == provider_id]}

    @app.get("/")
    def index():
        return FileResponse(ROOT / "frontend" / "index.html")

    app.mount("/assets", StaticFiles(directory=str(ROOT / "frontend" / "assets")), name="assets")
    return app


app = create_app()
