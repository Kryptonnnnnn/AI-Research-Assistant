# The Transformer Architecture

The Transformer is a neural network design for processing sequences such as sentences. It was introduced as an alternative to recurrent networks and relies entirely on a mechanism called self-attention. Because every position can look at every other position in a single step, the computation can be parallelised across the whole sequence, which makes training on modern accelerators much faster than with recurrence.

## Self-attention

In self-attention each token is projected into three vectors: a query, a key and a value. The similarity between a token's query and every key is computed with a dot product, scaled, and passed through a softmax to produce weights. The output for the token is the weighted sum of the value vectors. Multi-head attention runs several of these attention operations in parallel with different learned projections so that the model can attend to information from different representation subspaces at once.

## Position information

Attention by itself has no notion of word order. The original design therefore adds positional encodings, built from sine and cosine functions of different frequencies, to the token embeddings. Later models learn the positions or use relative schemes such as rotary embeddings.

## Training and cost

A standard Transformer stacks an encoder and a decoder, each made of attention layers and position-wise feed-forward layers with residual connections and layer normalisation. Training uses the Adam optimiser with a warm-up learning rate schedule and regularisation by dropout. The main drawback is cost: the memory and time required by self-attention grow quadratically with sequence length, which motivates efficient variants for very long documents.
