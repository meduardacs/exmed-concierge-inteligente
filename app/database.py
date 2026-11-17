"""SQLite persistence. Database mutations are transactional and demo-only."""
from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

ROOT = Path(__file__).resolve().parent.parent
SEED_FILE = Path(__file__).resolve().parent / "data" / "seed_catalog.json"


class Database:
    def __init__(self, path: str | Path | None = None) -> None:
        configured = path or os.getenv("EXMED_DB_PATH", str(ROOT / "data" / "exmed_demo.sqlite3"))
        self.path = Path(configured).expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(str(self.path), timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        db.execute("PRAGMA busy_timeout = 15000")
        try:
            yield db
        finally:
            db.close()

    def initialize(self) -> None:
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS providers (
                  id INTEGER PRIMARY KEY,
                  name TEXT NOT NULL, initials TEXT NOT NULL, color TEXT NOT NULL,
                  kind TEXT NOT NULL, address TEXT NOT NULL, neighborhood TEXT NOT NULL,
                  latitude REAL NOT NULL, longitude REAL NOT NULL,
                  rating REAL NOT NULL, reviews INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS services (
                  id INTEGER PRIMARY KEY, provider_id INTEGER NOT NULL REFERENCES providers(id),
                  title TEXT NOT NULL, specialty TEXT NOT NULL, description TEXT NOT NULL,
                  keywords TEXT NOT NULL, original_price REAL NOT NULL,
                  discount_percent INTEGER NOT NULL, duration_minutes INTEGER NOT NULL,
                  featured INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS wallet (
                  id INTEGER PRIMARY KEY CHECK(id = 1), balance_cents INTEGER NOT NULL DEFAULT 42000
                );
                CREATE TABLE IF NOT EXISTS appointments (
                  id TEXT PRIMARY KEY, service_id INTEGER NOT NULL REFERENCES services(id),
                  provider_id INTEGER NOT NULL REFERENCES providers(id),
                  patient_name TEXT NOT NULL, patient_email TEXT NOT NULL DEFAULT '',
                  date TEXT NOT NULL, time TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('confirmed','cancelled')),
                  payment_method TEXT NOT NULL CHECK(payment_method IN ('wallet','demo')),
                  amount_cents INTEGER NOT NULL, created_at TEXT NOT NULL,
                  cancelled_at TEXT
                );
                CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_provider_slot
                  ON appointments(provider_id, date, time) WHERE status = 'confirmed';
                CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date, time);
            """)
            if not db.execute("SELECT 1 FROM providers LIMIT 1").fetchone():
                seed = json.loads(SEED_FILE.read_text(encoding="utf-8"))
                # A half-loaded seed should never survive an interrupted startup.
                db.execute("BEGIN IMMEDIATE")
                try:
                    for p in seed["providers"]:
                        db.execute("""INSERT INTO providers
                          (id,name,initials,color,kind,address,neighborhood,latitude,longitude,rating,reviews)
                          VALUES (:id,:name,:initials,:color,:kind,:address,:neighborhood,:latitude,:longitude,:rating,:reviews)""", p)
                    for s in seed["services"]:
                        db.execute("""INSERT INTO services
                          (id,provider_id,title,specialty,description,keywords,original_price,discount_percent,duration_minutes,featured)
                          VALUES (:id,:provider_id,:title,:specialty,:description,:keywords,:original_price,:discount_percent,:duration_minutes,:featured)""", s)
                    db.execute("INSERT OR IGNORE INTO wallet (id,balance_cents) VALUES (1,42000)")
                    db.execute("COMMIT")
                except Exception:
                    db.execute("ROLLBACK")
                    raise
            else:
                db.execute("INSERT OR IGNORE INTO wallet (id,balance_cents) VALUES (1,42000)")

    def list_services(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute("""
              SELECT s.*, p.name AS provider_name, p.initials, p.color, p.kind, p.address,
                     p.neighborhood, p.latitude, p.longitude, p.rating, p.reviews
              FROM services s JOIN providers p ON s.provider_id=p.id ORDER BY s.id
            """).fetchall()
        return [enrich_service(dict(row)) for row in rows]

    def get_service(self, service_id: int) -> dict | None:
        return next((s for s in self.list_services() if s["id"] == service_id), None)

    def list_providers(self) -> list[dict]:
        with self.connect() as db:
            return [dict(x) for x in db.execute("SELECT * FROM providers ORDER BY name")]

    def wallet(self) -> dict:
        with self.connect() as db:
            row = db.execute("SELECT balance_cents FROM wallet WHERE id=1").fetchone()
            count = db.execute("SELECT COUNT(*) FROM appointments WHERE status='confirmed'").fetchone()[0]
            spent = db.execute("SELECT COALESCE(SUM(amount_cents),0) FROM appointments WHERE status='confirmed' AND payment_method='wallet'").fetchone()[0]
        return {"balance": row["balance_cents"] / 100, "initial_balance": 420.0,
                "spent": spent / 100, "active_appointments": count, "currency": "BRL"}

    def list_appointments(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute("""
              SELECT a.*, s.title AS service_title, p.name AS provider_name, p.initials, p.color
              FROM appointments a JOIN services s ON s.id=a.service_id
              JOIN providers p ON p.id=a.provider_id
              ORDER BY a.date DESC, a.time DESC
            """).fetchall()
        return [{**dict(r), "amount": r["amount_cents"] / 100} for r in rows]

    def booked_times(self, provider_id: int, date: str) -> set[str]:
        with self.connect() as db:
            return {r[0] for r in db.execute("SELECT time FROM appointments WHERE provider_id=? AND date=? AND status='confirmed'", (provider_id, date))}


def enrich_service(record: dict) -> dict:
    """All prices come from the local catalog, never from an LLM."""
    # All catalog prices are integer BRL values; rounding is exact in cents.
    cents = round(record["original_price"] * 100)
    discounted_cents = (cents * (100 - record["discount_percent"]) + 50) // 100
    record["price"] = discounted_cents / 100
    record["saving"] = (cents - discounted_cents) / 100
    record["source_id"] = f"catalog:service:{record['id']}"
    return record
