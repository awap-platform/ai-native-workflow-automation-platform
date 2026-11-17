# Knowledge retrieval: embeddings, hybrid search and evaluation (issue #293)

Knowledge Search stores tenant-scoped chunks in `awap-knowledge*`. Lexical `multi_match` and kNN
vector results are fused with Reciprocal Rank Fusion (RRF); every query and every source document is
tenant-checked.

## Index template

`backend/common/src/main/resources/opensearch/awap-knowledge-index-template.json` is applied by
`KnowledgeIndexProvisioner` at application start (idempotent, best effort, counted).

| Element | Value |
|---|---|
| Patterns / priority | `awap-knowledge*`, 200 |
| Shards / replicas | `awap.knowledge.index.shards` (1) / `.replicas` (1) |
| Analyzer | `knowledge_text` (standard + lowercase + asciifolding + English stop words) |
| Search analyzer | `knowledge_search` (no stop words, so short queries still match) |
| Vector | `knn_vector`, dimension `awap.knowledge.embedding.dimensions` (256), HNSW/cosine, Lucene engine |
| Versioning fields | `embeddingModel`, `embeddingVersion` |
| Mapping mode | `dynamic: strict` |

`awap-knowledge-ism-policy.json` deletes indices after 365 days and is applied to the same pattern.

## Embeddings

`EmbeddingProvider` is the SPI: `id`, `version`, `dimensions`, `embed(text)`.

`LocalHashEmbeddingProvider` (`local-hash`, `v1`) is a deterministic signed hashing projection of
tokens, L2-normalized. It is free, private and stable, so the mapping, hybrid pipeline and evaluation
gates run without an external embedding vendor. The interface allows swapping in a semantic provider
without touching the search service.

The provider id and version are stored with every vector. A model change therefore creates a new
`embeddingVersion`, and a reindex is required; the old vectors remain identifiable during the
migration.

## Hybrid search and fusion

1. Lexical: `bool.filter(term tenantId) + multi_match(title^2, content)`.
2. Vector: `knn(embedding, k=<limit>, filter(term tenantId))` when the query vector has signal.
3. Fusion: RRF with `k=60`; results are keyed by `fileId:chunkIndex`, so the same chunk from both
   branches accumulates both rank contributions.

Fallbacks:

- Embedding provider throws → lexical results only (`vector_fallback{reason="embedding-error"}`).
- Wrong vector length or non-finite values → lexical only (`reason="invalid-vector"`).
- Zero vector (no tokens) → lexical only (`reason="empty-vector"`).
- kNN request non-2xx → lexical only (`reason="status"`).
- OpenSearch unavailable → empty result, as before.

## PII redaction

`KnowledgePiiRedactor` masks emails (`[email]`) and phone numbers (`[phone]`) before chunking,
embedding and indexing. The vector and the stored text therefore never contain the raw value.

## Evaluation

`ai-layer/eval/retrieval_metrics.py` evaluates a graded fixture:
`ai-layer/eval/knowledge_retrieval_graded.v1.json` (grades: 3 exact, 2 useful, 1 supporting).

Metrics:

- Recall@k — relevant documents found / all relevant documents.
- Precision@k — relevant documents in the top k / k.
- MRR — reciprocal rank of the first relevant document.
- nDCG@k — graded gain `(2^grade - 1) / log2(rank + 1)`, normalized by the ideal ranking.

Gates: Recall ≥ 0.90, Precision ≥ 0.60, MRR ≥ 0.90, nDCG ≥ 0.85. CI runs:

```bash
cd ai-layer
uv run python -m eval.retrieval_metrics --fixture eval/knowledge_retrieval_graded.v1.json --k 2 --gate
```

Unit tests assert hand-computed values, fixture validity and gate failures.

## Reindex and rollback

`scripts/knowledge-reindex.mjs` implements blue/green reindexing:

1. `PUT /<new-index>` (matches `awap-knowledge*`, so the template applies).
2. `POST /_reindex?wait_for_completion=true&refresh=true` from the live alias.
3. Only after a zero-failure response, `POST /_aliases` removes the alias from the old index and
   adds it to the new one in one atomic action.

If creation or reindex fails, the old alias is untouched. Run:

```bash
node scripts/knowledge-reindex.mjs \
  --endpoint http://localhost:9200 \
  --source awap-knowledge-2026-01 \
  --target awap-knowledge-2026-02
```

Rollback is the same alias switch in reverse (or re-run with the previous index as `--target`).
Unit tests in `scripts/test/knowledge-reindex.test.mjs` assert the request order, payloads and that
a failed reindex never calls the alias switch.

## End-to-end coverage (issue #308)

`KnowledgeAnalyticsE2ETest` runs the seeded-document journey on every pull request with a
deterministic in-memory OpenSearch transport: chunk counts, redacted index content, tenant-scoped
search, the analytics daily aggregate, percentiles and bottleneck for the search step, the
empty-index no-answer, the OpenSearch outage fallback and the analytics-sink outage isolation.

`KnowledgeAnalyticsOpenSearchIntegrationTest` repeats the indexing, search and analytics path
against a real OpenSearch container (Testcontainers, skipped when Docker is absent). It polls the
index with a bounded timeout instead of racing `refresh_interval`, asserts the real `tenantId`
filter, and proves the kNN branch is active. The index template sets `index.knn=true`; without that
setting OpenSearch rejects the `knn_vector` mapping and hybrid search silently degrades to lexical.

## Configuration

| Property | Default | Purpose |
|---|---|---|
| `awap.knowledge.index` | `awap-knowledge` | Alias/index searched and written. |
| `awap.knowledge.index.shards` | `1` | Template shard count. |
| `awap.knowledge.index.replicas` | `1` | Template replica count. |
| `awap.knowledge.embedding.dimensions` | `256` | Vector dimension; must match the template. |
| `awap.knowledge.opensearch.endpoint` | `http://localhost:9200` | OpenSearch endpoint. |

A dimension change requires a new template and a reindex; the mismatch is visible as a kNN rejection
and is covered by the invalid-vector test path.
