#!/usr/bin/env python3
"""
Analyse LLM des prédictions énergétiques Joule.

Charge le modèle Qwen3-4B (GGUF) localement via llama-cpp-python,
analyse les fichiers CSV de prédictions, et génère un rapport JSON.

Usage :
    python scripts/analysis_llm.py
    python scripts/analysis_llm.py --dry-run    # Teste le parsing sans LLM
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = PROJECT_ROOT / "models"
DATA_DIR = PROJECT_ROOT / "data" / "predictions"
REPORTS_DIR = PROJECT_ROOT / "data" / "llm_reports"

MODEL_FILENAME = "Qwen3-4B-Q4_K_M.gguf"
MODEL_PATH = MODELS_DIR / MODEL_FILENAME
MODEL_HF_REPO = "Qwen/Qwen3-4B-GGUF"

# Patterns pour trouver les derniers CSV par modèle
MODEL_FILE_PATTERNS = {
    "Chronos2": "Joule_Chronos2_*.csv",
    "TimesFM": "Joule_TimesFM_*.csv",
    "XGBoost": "Joule_XGBoost_*.csv",
    "Average": "Joule_Average_*.csv",
    "Prophet": "Joule_Prophet_*.csv",
}

# MLflow
MLFLOW_TRACKING_URI = "http://localhost:5001"
MLFLOW_EXPERIMENT_NAME = "Joule"

# Prompt système : rôle, contexte métier et objectif de l'analyse
SYSTEM_PROMPT = """Tu es un ingénieur data spécialisé dans la prévision de consommation électrique résidentielle.

Contexte :
- Les données proviennent d'une habitation individuelle.
- La consommation est exprimée en kWh par jour.
- Les modèles ont été entraînés sur plusieurs années de données historiques.
- Les prévisions servent à anticiper les besoins énergétiques et détecter des comportements inhabituels.

Ton objectif est de produire une analyse destinée à un utilisateur non spécialiste mais intéressé par la qualité des prévisions.

Réponds en français."""

# Paramètres d'inférence
LLM_CONFIG = {
    "n_ctx": 8192,
    "n_gpu_layers": -1,  # Tout sur GPU Metal (Apple Silicon)
    "temperature": 0.7,
    "max_tokens": 4096,
    "verbose": False,
}

# ---------------------------------------------------------------------------
# Téléchargement automatique du modèle
# ---------------------------------------------------------------------------


def download_model():
    """Télécharge le modèle GGUF depuis HuggingFace si absent."""
    if MODEL_PATH.exists():
        size_gb = MODEL_PATH.stat().st_size / (1024**3)
        print(f"✅ Modèle trouvé : {MODEL_PATH.name} ({size_gb:.1f} Go)")
        return

    print(f"📥 Téléchargement du modèle {MODEL_FILENAME} depuis HuggingFace...")
    print(f"   Repo : {MODEL_HF_REPO}")
    print(f"   Destination : {MODEL_PATH}")
    print(f"   Taille estimée : ~2.6 Go — cela peut prendre quelques minutes\n")

    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        print("❌ huggingface-hub n'est pas installé.")
        print("   Installe-le avec : pip install huggingface-hub")
        print(f"\n   Ou télécharge manuellement :")
        print(
            f"   curl -L https://huggingface.co/{MODEL_HF_REPO}/resolve/main/{MODEL_FILENAME}"
            f" -o {MODEL_PATH}"
        )
        sys.exit(1)

    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    hf_hub_download(
        repo_id=MODEL_HF_REPO,
        filename=MODEL_FILENAME,
        local_dir=str(MODELS_DIR),
    )

    size_gb = MODEL_PATH.stat().st_size / (1024**3)
    print(f"\n✅ Modèle téléchargé : {MODEL_PATH.name} ({size_gb:.1f} Go)")


# ---------------------------------------------------------------------------
# Lecture des métriques depuis MLflow
# ---------------------------------------------------------------------------


def extract_run_name(filename: str) -> str:
    """Extrait le run_name MLflow depuis le nom du fichier CSV.

    Ex: Joule_Chronos2_Energy_Prediction_crawling-sheep-187.csv
    ->  crawling-sheep-187
    """
    stem = Path(filename).stem  # sans .csv
    # Le run_name est après le dernier "_Energy_Prediction_" ou "_Average_Energy_Prediction_"
    parts = stem.split("_Energy_Prediction_")
    if len(parts) == 2:
        return parts[1]
    # Fallback : tout après le dernier "_"
    return stem.rsplit("_", 1)[-1]


def fetch_mlflow_metrics(run_name: str) -> dict:
    """Récupère les métriques d'un run MLflow par son run_name."""
    try:
        import mlflow

        mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
        experiment = mlflow.get_experiment_by_name(MLFLOW_EXPERIMENT_NAME)
        if experiment is None:
            print(f"    ⚠️  Expérience MLflow '{MLFLOW_EXPERIMENT_NAME}' introuvable")
            return {}

        # Chercher le run par son nom
        runs = mlflow.search_runs(
            experiment_ids=[experiment.experiment_id],
            filter_string=f"run_name = '{run_name}'",
            max_results=1,
        )

        if runs.empty:
            print(f"    ⚠️  Run MLflow '{run_name}' introuvable")
            return {}

        run = runs.iloc[0]

        # Extraire les métriques disponibles
        metrics = {}
        for key in ["mae", "rmse", "r2", "mean_quantile_loss",
                    "quantile_loss_p10", "quantile_loss_p50", "quantile_loss_p90"]:
            col = f"metrics.{key}"
            if col in run.index and pd.notna(run[col]):
                metrics[key] = round(float(run[col]), 4)

        print(f"    📊 MLflow → {', '.join(f'{k}={v}' for k, v in metrics.items())}")
        return metrics

    except Exception as e:
        print(f"    ⚠️  Erreur MLflow : {e}")
        return {}


# ---------------------------------------------------------------------------
# Lecture des CSV de prédictions
# ---------------------------------------------------------------------------


def load_prediction_data() -> dict:
    """
    Charge les derniers CSV de prédictions pour chaque modèle.
    Récupère les métriques depuis MLflow via le run_name.
    """
    models_data = {}

    for model_name, pattern in MODEL_FILE_PATTERNS.items():
        files = sorted(DATA_DIR.glob(pattern), key=lambda p: p.stat().st_mtime)
        if not files:
            print(f"  ⚠️  Aucun fichier trouvé pour {model_name} ({pattern})")
            continue

        latest_file = files[-1]
        df = pd.read_csv(latest_file)
        df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")

        # Récupérer les métriques depuis MLflow
        run_name = extract_run_name(latest_file.name)
        print(f"  ✅ {model_name} : {latest_file.name} ({len(df)} points, run={run_name})")
        metrics = fetch_mlflow_metrics(run_name)

        models_data[model_name] = {
            "file": latest_file.name,
            "run_name": run_name,
            "n_points": len(df),
            "date_range": f"{df['date'].iloc[0]} → {df['date'].iloc[-1]}",
            "metrics": metrics,
            "sample_predictions": [
                {
                    "date": row["date"],
                    "predicted": round(float(row["predicted_ene_conso"]), 1) if pd.notna(row.get("predicted_ene_conso")) else None,
                    "actual": round(float(row["actual_ene_conso"]), 1) if pd.notna(row.get("actual_ene_conso")) else None,
                }
                for _, row in df.head(30).iterrows()
            ],
        }

    return models_data


# ---------------------------------------------------------------------------
# Construction du prompt
# ---------------------------------------------------------------------------


def build_prompt(models_data: dict) -> str:
    """Construit le prompt enrichi avec les données pour le LLM."""
    sections = []

    # En-tête : rappel du rôle et du contexte (identique au prompt système)
    sections.append(SYSTEM_PROMPT + "\n")
    sections.append(
        "Analyse ci-dessous les prévisions de consommation d'énergie (en kWh/jour) "
        "produites par différents modèles de machine learning.\n"
    )

    # Métriques par modèle (depuis MLflow)
    sections.append("## Métriques de performance des modèles (MLflow)\n")
    for model_name, data in models_data.items():
        m = data.get("metrics", {})
        sections.append(
            f"### {model_name}\n"
            f"- Fichier : {data['file']}\n"
            f"- Run MLflow : {data.get('run_name', 'N/A')}\n"
            f"- Période : {data['date_range']}\n"
            f"- Points : {data['n_points']}\n"
            f"- MAE : {m.get('mae', 'N/A')} kWh\n"
            f"- RMSE : {m.get('rmse', 'N/A')} kWh\n"
            f"- R² : {m.get('r2', 'N/A')}\n"
            f"- Mean Quantile Loss : {m.get('mean_quantile_loss', 'N/A')}\n"
        )

    # Grille de lecture des métriques
    sections.append(
        "### Comment interpréter ces métriques\n"
        "- Un MAE faible est meilleur.\n"
        "- Un RMSE faible indique moins de grosses erreurs.\n"
        "- Un R² proche de 1 signifie que le modèle explique bien les données.\n"
        "- Une Mean Quantile Loss faible est préférable.\n"
    )

    # Exemples de prédictions
    sections.append("## Exemples de prédictions vs réalité (10 premiers jours)\n")
    for model_name, data in models_data.items():
        sections.append(f"### {model_name}")
        sections.append("| Date | Prédit (kWh) | Réel (kWh) | Erreur |")
        sections.append("|------|-------------|------------|--------|")
        for s in data.get("sample_predictions", []):
            pred = s.get("predicted")
            act = s.get("actual")
            if pred is not None and act is not None:
                error = round(pred - act, 1)
                sections.append(f"| {s['date']} | {pred} | {act} | {error:+.1f} |")
            else:
                sections.append(f"| {s['date']} | {pred or 'N/A'} | {act or 'N/A'} | — |")
        sections.append("")

    # Instructions d'analyse
    sections.append(
        "## Consignes d'analyse STRICTES\n\n"
        "1. Rédige UNIQUEMENT des paragraphes de texte pour tes analyses. NE GÉNÈRE AUCUN TABLEAU.\n"
        "2. Ne mets PAS de titre principal au début de ta réponse.\n"
        "3. Rédige ta réponse ENTIÈREMENT et EXCLUSIVEMENT en français. N'utilise JAMAIS de caractères chinois.\n"
        "4. Assure-toi de terminer complètement tes phrases et ta conclusion.\n\n"
        "Analyse les prévisions :\n"
        "- Compare les modèles (lequel est le plus précis ? le plus biaisé ?)\n"
        "- Détecte les anomalies (jours avec erreurs importantes, patterns inhabituels)\n"
        "- Explique les erreurs et donne une conclusion complète.\n\n"
        "Essaie d'identifier :\n"
        "- des jours de forte consommation\n"
        "- des jours de faible consommation\n"
        "- une éventuelle saisonnalité\n"
        "- des pics qui pourraient correspondre à :\n"
        "    - chauffage\n"
        "    - climatisation\n"
        "    - recharge de véhicule électrique\n"
        "    - vacances\n\n"
        "Tu peux proposer des hypothèses mais indique toujours qu'il s'agit d'une "
        "interprétation lorsqu'aucune preuve n'est disponible.\n\n"
        "Structure ton texte avec des sous-titres (##)."
    )

    return "\n".join(sections)


# ---------------------------------------------------------------------------
# Inférence LLM
# ---------------------------------------------------------------------------


def run_inference(prompt: str) -> tuple[str, float]:
    """
    Charge le modèle Qwen3 4B et exécute l'inférence.
    Retourne (réponse, temps_en_secondes).
    """
    from llama_cpp import Llama

    print("\n🧠 Chargement du modèle...")
    start_load = time.time()

    llm = Llama(
        model_path=str(MODEL_PATH),
        n_ctx=LLM_CONFIG["n_ctx"],
        n_gpu_layers=LLM_CONFIG["n_gpu_layers"],
        verbose=LLM_CONFIG["verbose"],
    )

    load_time = time.time() - start_load
    print(f"   Modèle chargé en {load_time:.1f}s")

    print("🔄 Génération de l'analyse...")
    start_infer = time.time()

    response = llm.create_chat_completion(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=LLM_CONFIG["temperature"],
        max_tokens=LLM_CONFIG["max_tokens"],
    )

    inference_time = time.time() - start_infer
    total_time = time.time() - start_load

    analysis_text = response["choices"][0]["message"]["content"]

    # Supprimer les balises <think>...</think> de Qwen3
    analysis_text = re.sub(r"<think>.*?</think>", "", analysis_text, flags=re.DOTALL).strip()

    usage = response.get("usage", {})
    print(f"   Génération terminée en {inference_time:.1f}s")
    print(f"   Tokens : {usage.get('prompt_tokens', '?')} prompt + {usage.get('completion_tokens', '?')} completion")

    return analysis_text, total_time


# ---------------------------------------------------------------------------
# Sauvegarde du rapport
# ---------------------------------------------------------------------------


def save_report(
    analysis: str,
    models_data: dict,
    inference_time: float,
    data_sources: list[str],
) -> Path:
    """Sauvegarde le rapport JSON dans data/llm_reports/."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now()
    filename = f"llm_report_{timestamp.strftime('%Y%m%d_%H%M%S')}.json"

    # Résumé des métriques pour le frontend
    metrics_summary = {}
    for model_name, data in models_data.items():
        metrics_summary[model_name] = data.get("metrics", {})

    report = {
        "timestamp": timestamp.isoformat(),
        "model_llm": MODEL_FILENAME.replace(".gguf", ""),
        "inference_time_seconds": round(inference_time, 1),
        "analysis": analysis,
        "data_sources": data_sources,
        "metrics_summary": metrics_summary,
    }

    report_path = REPORTS_DIR / filename
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    return report_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description="Analyse LLM des prédictions Joule")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Teste le parsing des CSV sans lancer le LLM",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("🧠 Joule — Analyse LLM")
    print("=" * 60)

    # 1. Charger les données
    print("\n📊 Chargement des données de prédiction...")
    models_data = load_prediction_data()

    if not models_data:
        print("❌ Aucune donnée de prédiction trouvée dans", DATA_DIR)
        sys.exit(1)

    # 2. Construire le prompt
    prompt = build_prompt(models_data)
    print(f"\n📝 Prompt construit ({len(prompt)} caractères)")

    # Dry run : afficher le prompt et sortir
    if args.dry_run:
        print("\n--- DRY RUN — Prompt généré ---\n")
        print(prompt)
        print("\n--- Fin du prompt ---")
        print("\n✅ Dry run terminé. Parsing OK.")
        return

    # 3. Télécharger le modèle si nécessaire
    download_model()

    # 4. Inférence LLM
    analysis, inference_time = run_inference(prompt)

    # 5. Sauvegarder le rapport
    data_sources = [d["file"] for d in models_data.values()]
    report_path = save_report(
        analysis=analysis,
        models_data=models_data,
        inference_time=inference_time,
        data_sources=data_sources,
    )

    print(f"\n{'=' * 60}")
    print(f"✅ Rapport généré → {report_path.relative_to(PROJECT_ROOT)} ({inference_time:.1f}s)")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
