FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852

ARG LLAMA_TAG=b12032
ARG LLAMA_SHA256=9f10432ca3f66ef003a7a540aaffb9da0acadaefd05404521b9ab7a2436af304
ARG MODEL_COMMIT=6ea3e3a309d12a4779cfda98b8c19800d2d5da71
ARG MODEL_SHA256=2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135
ARG LIBGOMP_SHA256=e8a95ec58125b4933597f30ff56c2ae10edf90f287262e366d4b6edea3019144
ARG LIBBROTLI_SHA256=70b188a86d81f30d7510aab30e25d638ed5037dded6691af1533952b71ac61de

ADD https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/llama-${LLAMA_TAG}-bin-ubuntu-x64.tar.gz /tmp/llama.tar.gz
RUN echo "${LLAMA_SHA256}  /tmp/llama.tar.gz" | sha256sum -c - \
  && mkdir -p /opt/llama \
  && tar -xzf /tmp/llama.tar.gz -C /opt/llama --strip-components=1 \
  && rm /tmp/llama.tar.gz

ADD https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/${MODEL_COMMIT}/embeddinggemma-2-Q8_0.gguf /models/embeddinggemma-2-Q8_0.gguf
RUN echo "${MODEL_SHA256}  /models/embeddinggemma-2-Q8_0.gguf" | sha256sum -c -

ADD https://snapshot.ubuntu.com/ubuntu/20261101T000000Z/pool/main/g/gcc-14/libgomp1_14.2.0-4ubuntu2~24.04.1_amd64.deb /tmp/libgomp1.deb
ADD https://snapshot.ubuntu.com/ubuntu/20261101T000000Z/pool/main/b/brotli/libbrotli1_1.1.0-2ubuntu0.1_amd64.deb /tmp/libbrotli1.deb
RUN echo "${LIBGOMP_SHA256}  /tmp/libgomp1.deb" | sha256sum -c - \
  && echo "${LIBBROTLI_SHA256}  /tmp/libbrotli1.deb" | sha256sum -c - \
  && dpkg-deb --extract /tmp/libgomp1.deb / \
  && dpkg-deb --extract /tmp/libbrotli1.deb / \
  && rm /tmp/libgomp1.deb /tmp/libbrotli1.deb

ENV LD_LIBRARY_PATH=/opt/llama

EXPOSE 8080

CMD ["/opt/llama/llama-server", "-m", "/models/embeddinggemma-2-Q8_0.gguf", "-t", "1", "--parallel", "1", "-c", "4096", "--embedding", "--host", "0.0.0.0", "--port", "8080"]
