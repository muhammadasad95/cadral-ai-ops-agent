// Downloads the embedding model and the reranker at Docker build time so the first request is fast.
const t: any = await import('@huggingface/transformers');
await t.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
await t.AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2');
await t.AutoModelForSequenceClassification.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', { dtype: 'q8' });
console.log('models cached');
