# Modèles LLM (GGUF)

Ce répertoire contient les fichiers de modèles GGUF pour l'analyse LLM locale.

## Modèle utilisé

**Qwen3-4B-Q4_K_M** — Modèle de langage quantifié en 4 bits (~2.6 Go)

## Téléchargement

Le modèle est téléchargé automatiquement au premier lancement du script `scripts/analysis_llm.py`.

Source : [Qwen/Qwen3-4B-GGUF sur HuggingFace](https://huggingface.co/Qwen/Qwen3-4B-GGUF)

### Téléchargement manuel (optionnel)

```bash
# Via huggingface-hub CLI
pip install huggingface-hub
huggingface-cli download Qwen/Qwen3-4B-GGUF Qwen3-4B-Q4_K_M.gguf --local-dir models/

# Ou via curl
curl -L "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf" -o models/Qwen3-4B-Q4_K_M.gguf
```

## Notes

- Les fichiers `.gguf` sont exclus de Git (`.gitignore`)
- Optimisé pour Apple Silicon M3 avec accélération Metal
- RAM nécessaire : ~3-4 Go
