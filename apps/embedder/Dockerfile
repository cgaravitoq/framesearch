FROM ubuntu:24.04

ARG LLAMA_TAG=b12032
ARG LLAMA_SHA256=9f10432ca3f66ef003a7a540aaffb9da0acadaefd05404521b9ab7a2436af304
ARG MODEL_SHA256=2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl libgomp1 \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL -o /tmp/llama.tar.gz \
  "https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/llama-${LLAMA_TAG}-bin-ubuntu-x64.tar.gz" \
  && echo "${LLAMA_SHA256}  /tmp/llama.tar.gz" | sha256sum -c - \
  && mkdir -p /opt/llama \
  && tar -xzf /tmp/llama.tar.gz -C /opt/llama --strip-components=1 \
  && rm /tmp/llama.tar.gz

RUN mkdir -p /models \
  && curl -fsSL -o /models/embeddinggemma-2-Q8_0.gguf \
  "https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/main/embeddinggemma-2-Q8_0.gguf" \
  && echo "${MODEL_SHA256}  /models/embeddinggemma-2-Q8_0.gguf" | sha256sum -c -

ENV LD_LIBRARY_PATH=/opt/llama

EXPOSE 8080

CMD ["/opt/llama/llama-server", "-m", "/models/embeddinggemma-2-Q8_0.gguf", "-t", "1", "--parallel", "1", "-c", "4096", "--embedding", "--host", "0.0.0.0", "--port", "8080"]
