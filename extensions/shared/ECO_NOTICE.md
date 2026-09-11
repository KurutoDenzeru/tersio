# EcoLogits derivation notice

The CO2/energy model in `carbon.ts` is a port of the EcoLogits v0.8.2 LLM
impact model by GenAI Impact (genai-impact/ecologits), which is licensed
**MPL-2.0** — not MIT like the rest of this repository.

What was taken, and from where:

- The per-request impact formula and its constants (`E_ALPHA`, `E_BETA`,
  `L_ALPHA`, `L_BETA`, quantization, GPU memory, server and embodied
  figures, 5-year lifetime, PUE 1.2): EcoLogits v0.8.2 methodology
  (https://ecologits.ai/latest/methodology/llm_inference), derived from the
  ML.ENERGY Leaderboard regression data.
- Per-model active/total parameter values for the models EcoLogits'
  `model_repository` covers (Opus/Sonnet/Haiku, GPT-4o/5, Gemini 2.0
  Flash): EcoLogits' registry, verbatim.
- The served-estimate pattern (single-stream ceiling ÷ `serving_concurrency`)
  and per-provider grid intensities: same approach as honey-for-devs'
  `hooks/eco.js` port (MIT), with its researched location-based grids.

What was NOT taken: honey's benchmark-derived savings ratios and bench
stamps (we report no modelled savings), and EcoLogits' embodied water or
materials figures.
