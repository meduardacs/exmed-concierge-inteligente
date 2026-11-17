"""Hybrid RAG: BM25 lexical retrieval + dense LSA embeddings + reciprocal rank fusion.

Unlike a fake keyword-only search, this module builds TWO independent indices over
catalog evidence. Concept expansion handles conversational Portuguese. Responses
are grounded on the retrieved records; numerical details are never invented.
"""
from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from typing import Any

import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize as l2_normalize

CONCEPTS: dict[str, dict[str, str]] = {
    "Cardiologia": {
        "words": "coracao cardiaco cardio cardiologista cardiologia cardiovascular peito palpitacao ecocardiograma eletrocardiograma corações",
        "expand": "cardiologia coração cardiovascular cardiológico eletrocardiograma check-up cardiologista",
    },
    "Exames laboratoriais": {
        "words": "sangue hemograma laboratorio laboratorial glicemia colesterol triglicerides vitamina exames",
        "expand": "exames laboratoriais hemograma sangue laboratório check-up coleta painel",
    },
    "Dermatologia": {
        "words": "pele acne dermatologista dermatologia pintas cutanea manchas",
        "expand": "dermatologia dermatologista pele consulta manchas dermatológica",
    },
    "Ortopedia": {
        "words": "joelho coluna ortopedista ortopedia fratura osso lombar postura articulacao",
        "expand": "ortopedia ortopedista coluna joelho dor articular postura",
    },
    "Clínica geral": {
        "words": "clinico geral clinica geral medico generalista medicina geral",
        "expand": "clínica geral consulta medicina preventiva avaliação",
    },
}

LOCATIONS = {
    "paulista": (-23.5638, -46.6545, "Av. Paulista"),
    "jardins": (-23.5700, -46.6640, "Jardins"),
    "paraiso": (-23.5717, -46.6428, "Paraíso"),
    "vila mariana": (-23.5840, -46.6380, "Vila Mariana"),
    "pinheiros": (-23.5630, -46.6900, "Pinheiros"),
    "consolacao": (-23.5550, -46.6580, "Consolação"),
    "centro": (-23.5490, -46.6388, "Centro"),
}
DEFAULT_LOCATION = "Av. Paulista"
DEFAULT_COORD = LOCATIONS["paulista"][:2]
TOKEN_PATTERN = re.compile(r"[a-z0-9]+")


def fold(text: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(ch))


def tokens(text: str) -> list[str]:
    return TOKEN_PATTERN.findall(fold(text))


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl / 2)**2
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def detect_specialty(query: str) -> str | None:
    words = set(tokens(query))
    hits: list[tuple[int, str]] = []
    for specialty, values in CONCEPTS.items():
        overlaps = words.intersection(tokens(values["words"]))
        if overlaps:
            hits.append((len(overlaps), specialty))
    return max(hits)[1] if hits else None


def parse_intent(query: str, *, budget: float | None = None,
                 specialty: str | None = None, location: str | None = None,
                 radius_km: float = 8.0, use_balance: bool | None = None) -> dict:
    q = fold(query)
    # Currency, spacing and conversational forms: 'até R$ 300', 'até 300 reais'.
    match = re.search(r"(?:ate|abaixo de|no maximo|gastar|orcamento|limite de)\s*(?:r\$\s*)?(\d{2,5})(?:[,.](\d{2}))?", q)
    if not match:
        match = re.search(r"r\$\s*(\d{2,5})(?:[,.](\d{2}))?", q)
    inferred_budget = float(match[1]) + (int(match[2]) / 100 if match and match[2] else 0) if match else None
    chosen_location = location or next((v[2] for k, v in LOCATIONS.items() if k in q), DEFAULT_LOCATION)
    center = next((v[:2] for v in LOCATIONS.values() if v[2] == chosen_location), DEFAULT_COORD)
    inferred_specialty = detect_specialty(query)
    chosen_specialty = None if specialty == "Todas" else (specialty or inferred_specialty)
    # Explicit UI choices win over natural-language intent.
    chosen_budget = budget if budget is not None else inferred_budget
    chosen_wallet = use_balance if use_balance is not None else bool(re.search(r"\bsaldo\b|\bcarteira\b|\bcredito\b", q))
    return {"query": query, "budget": chosen_budget, "specialty": chosen_specialty,
            "location": chosen_location, "latitude": center[0], "longitude": center[1],
            "radius_km": radius_km, "use_balance": chosen_wallet}


def build_doc(s: dict) -> str:
    return " ".join([s["title"], s["specialty"], s["description"], s["keywords"],
                     s["kind"], s["neighborhood"], s["provider_name"]])


@dataclass
class HybridRAG:
    """In-memory evidence index rebuilt at startup from SQLite catalog rows."""
    services: list[dict]

    def __post_init__(self) -> None:
        self.documents = [build_doc(s) for s in self.services]
        self.lexical_docs = [tokens(doc) for doc in self.documents]
        self.term_freq = [Counter(doc) for doc in self.lexical_docs]
        self.avgdl = sum(map(len, self.lexical_docs)) / max(1, len(self.lexical_docs))
        counts = Counter(word for doc in self.lexical_docs for word in set(doc))
        self.idf = {word: math.log(1 + (len(self.services) - n + 0.5) / (n + 0.5)) for word, n in counts.items()}
        # Dense latent semantic vectors; no remote model download or API key necessary.
        self.vectorizer = TfidfVectorizer(strip_accents="unicode", lowercase=True,
                                          ngram_range=(1, 2), sublinear_tf=True)
        matrix = self.vectorizer.fit_transform(self.documents)
        dims = min(48, matrix.shape[0] - 1, matrix.shape[1] - 1)
        self.lsa = TruncatedSVD(n_components=dims, random_state=42) if dims >= 2 else None
        self.embeddings = l2_normalize(self.lsa.fit_transform(matrix)) if self.lsa else l2_normalize(matrix.toarray())

    def _bm25(self, query_tokens: list[str]) -> list[float]:
        scores: list[float] = []
        for doc, counter in zip(self.lexical_docs, self.term_freq):
            score = 0.0
            for word in query_tokens:
                freq = counter.get(word, 0)
                if freq:
                    score += self.idf.get(word, 0) * (freq * 2.2) / (freq + 1.2 * (0.25 + 0.75 * len(doc)/max(self.avgdl, 1)))
            scores.append(score)
        return scores

    def _semantic(self, query: str) -> list[float]:
        v = self.vectorizer.transform([query])
        dense = self.lsa.transform(v) if self.lsa else v.toarray()
        dense = l2_normalize(dense)
        return (self.embeddings @ dense[0]).tolist()

    def retrieve(self, intent: dict, *, limit: int = 9, sort: str = "recommended") -> list[dict]:
        expanded = intent["query"]
        if intent["specialty"] in CONCEPTS:
            expanded += " " + CONCEPTS[intent["specialty"]]["expand"]
        lexical = self._bm25(tokens(expanded))
        dense = self._semantic(expanded)
        valid: list[int] = []
        distances: dict[int, float] = {}
        for i, service in enumerate(self.services):
            if intent["specialty"] and service["specialty"] != intent["specialty"]:
                continue
            if intent["budget"] is not None and service["price"] > intent["budget"] + 0.001:
                continue
            distance = haversine_km(intent["latitude"], intent["longitude"], service["latitude"], service["longitude"])
            if distance > intent["radius_km"]:
                continue
            valid.append(i)
            distances[i] = distance
        if not valid:
            return []
        lex_order = sorted(valid, key=lambda i: lexical[i], reverse=True)
        sem_order = sorted(valid, key=lambda i: dense[i], reverse=True)
        lex_rank = {i: rank for rank, i in enumerate(lex_order, 1)}
        sem_rank = {i: rank for rank, i in enumerate(sem_order, 1)}
        results: list[dict] = []
        for i in valid:
            s = self.services[i]
            # Reciprocal Rank Fusion of independent retrieval methods.
            rrf = 1/(60 + lex_rank[i]) + 1/(60 + sem_rank[i])
            closeness = max(0, 1 - distances[i] / max(intent["radius_km"], .1))
            value = s["discount_percent"] / 100
            match_bonus = 0.016 if intent["specialty"] == s["specialty"] else 0
            if "check" in fold(intent["query"]) and "check" in fold(s["title"]):
                match_bonus += .005
            total = rrf + .015 * closeness + .006 * value + match_bonus
            results.append({**s, "distance_km": round(distances[i], 1),
                            "retrieval": {"bm25": round(lexical[i], 4),
                                          "semantic_similarity": round(float(dense[i]), 4),
                                          "rrf": round(rrf, 6)},
                            "rank_score": total})
        if sort == "price":
            results.sort(key=lambda s: (s["price"], -s["rank_score"]))
        elif sort == "distance":
            results.sort(key=lambda s: (s["distance_km"], -s["rank_score"]))
        elif sort == "rating":
            results.sort(key=lambda s: (-s["rating"], -s["rank_score"]))
        else:
            results.sort(key=lambda s: s["rank_score"], reverse=True)
        return results[:limit]


def grounded_summary(intent: dict, results: list[dict], wallet_balance: float) -> dict[str, Any]:
    if not results:
        return {"headline": "Nenhuma opção atende a todos os filtros.",
                "body": "Amplie a distância, remova o limite de valor ou escolha outra especialidade para explorar o catálogo demonstrativo.",
                "estimated_total": None, "saving": None, "wallet_covers": False, "citations": [], "mode": "grounded_template"}
    best = results[0]
    balance_status = wallet_balance >= best["price"]
    body = (f"{best['provider_name']} oferece {best['title']} a {best['distance_km']:.1f} km "
            f"da região escolhida, por R$ {best['price']:.2f}. "
            f"Você economiza R$ {best['saving']:.2f} em relação ao preço demonstrativo de referência.")
    if intent["use_balance"]:
        body += " Seu saldo demonstrativo cobre essa opção." if balance_status else " Seu saldo demonstrativo não cobre o valor integral."
    return {"headline": f"Melhor combinação: {best['provider_name']}", "body": body,
            "estimated_total": best["price"], "saving": best["saving"],
            "wallet_covers": balance_status,
            "citations": [s["source_id"] for s in results[:3]], "mode": "grounded_template"}
