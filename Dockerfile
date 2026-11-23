# Single container: API + agents + workers + dashboard. Free-tier friendly (Hugging Face Spaces, Render, Fly, Koyeb).
FROM node:22-slim
# WARM_MODELS=0 skips the local embedding/reranker models (for 512 MB free tiers such as Render)
ARG WARM_MODELS=1
ENV NODE_ENV=production HF_HOME=/app/.cache/hf PORT=7860
WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev --no-audit --no-fund && npm cache clean --force
COPY . .
RUN npm run build:web && if [ "$WARM_MODELS" = "1" ]; then npx tsx scripts/warm-models.ts; fi && npx tsx data/make-docs.ts
# Hugging Face Spaces runs as user 1000
RUN mkdir -p .data && chown -R 1000:1000 /app
USER 1000
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||7860)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "server/src/main.ts"]
