# Introduction to Retrieval-Augmented Generation

Retrieval-Augmented Generation (RAG) combines a retrieval system with a language model. Instead of relying only on what the model memorised during training, the system first looks up passages from a document collection and gives them to the model as context.

## Why RAG is useful

RAG reduces hallucination because the model can ground its answer in retrieved text. It also makes knowledge easy to update: adding a new document to the index makes it available immediately, without retraining. Finally, RAG enables citations, because every answer can point back to the passages that supported it.

## The pipeline

A typical pipeline has five steps. Documents are parsed and split into overlapping chunks. Each chunk is converted into an embedding vector. At question time the query is embedded and the nearest chunks are retrieved by cosine similarity. The retrieved chunks are placed in the prompt together with the question. The model then writes an answer that cites the chunks it used.

## Limitations

Retrieval quality bounds answer quality: if the right passage is not retrieved, the model cannot use it. Chunk size matters, since chunks that are too small lose context and chunks that are too large dilute relevance. Scanned documents need optical character recognition before they can be indexed.
