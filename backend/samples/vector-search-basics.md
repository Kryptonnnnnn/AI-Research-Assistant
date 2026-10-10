# Vector Search Basics

Vector search finds items whose embeddings are close to a query embedding. Embeddings are produced by neural models that map text with similar meaning to nearby points in a high-dimensional space.

## Similarity measures

Cosine similarity compares the angle between two vectors and ignores their length, which makes it the usual choice for normalised text embeddings. Euclidean distance and inner product are alternatives that behave equivalently when vectors are normalised.

## Indexes

Exact search compares the query with every stored vector, which is simple and accurate but slow for large collections. Approximate nearest neighbour indexes such as HNSW trade a small amount of recall for much faster queries. PostgreSQL with the pgvector extension supports both exact search and HNSW indexes.

## Hybrid retrieval

Keyword search is strong at exact terms such as names and identifiers, while vector search is strong at paraphrases and concepts. Combining the two scores, an approach called hybrid retrieval, usually improves ranking over either method alone.
