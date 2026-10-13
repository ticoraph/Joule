"""Router pour servir les rapports d'analyse LLM pré-générés."""

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.core.security import get_current_user_email

router = APIRouter(
    prefix="/llm", tags=["llm"], dependencies=[Depends(get_current_user_email)]
)

REPORTS_DIR = Path(__file__).resolve().parents[2] / "data" / "llm_reports"


def _load_report(path: Path) -> dict:
    """Charge un rapport JSON depuis le disque."""
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@router.get("/reports")
def list_reports():
    """Liste tous les rapports LLM disponibles (du plus récent au plus ancien)."""
    if not REPORTS_DIR.exists():
        return []

    reports = []
    for fp in sorted(REPORTS_DIR.glob("llm_report_*.json"), reverse=True):
        try:
            data = _load_report(fp)
            reports.append(
                {
                    "filename": fp.name,
                    "timestamp": data.get("timestamp"),
                    "model_llm": data.get("model_llm"),
                    "inference_time_seconds": data.get("inference_time_seconds"),
                    "data_sources": data.get("data_sources", []),
                }
            )
        except (json.JSONDecodeError, OSError):
            continue

    return reports


@router.get("/reports/latest")
def get_latest_report():
    """Retourne le dernier rapport LLM complet."""
    if not REPORTS_DIR.exists():
        raise HTTPException(status_code=404, detail="Aucun rapport disponible")

    files = sorted(REPORTS_DIR.glob("llm_report_*.json"), reverse=True)
    if not files:
        raise HTTPException(status_code=404, detail="Aucun rapport disponible")

    try:
        return _load_report(files[0])
    except (json.JSONDecodeError, OSError) as e:
        raise HTTPException(status_code=500, detail=f"Erreur de lecture du rapport : {e}")
