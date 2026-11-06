# Third-party packages

These Ubuntu 24.04 (noble) binary packages are vendored unmodified so the embedder image builds without reaching snapshot.ubuntu.com.
The Dockerfile verifies each against its pinned sha256 before unpacking it.

| File                                       | Source package                 | Licence                                                 | sha256                                                           |
| ------------------------------------------ | ------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------- |
| libgomp1_14.2.0-4ubuntu2~24.04.1_amd64.deb | gcc-14 14.2.0-4ubuntu2~24.04.1 | GPL-3.0-or-later with GCC Runtime Library Exception 3.1 | e8a95ec58125b4933597f30ff56c2ae10edf90f287262e366d4b6edea3019144 |
| libbrotli1_1.1.0-2ubuntu0.1_amd64.deb      | brotli 1.1.0-2ubuntu0.1        | MIT                                                     | 70b188a86d81f30d7510aab30e25d638ed5037dded6691af1533952b71ac61de |

Fetched from https://launchpad.net/ubuntu/+archive/primary/+files/ on 2026-11-06.
Corresponding sources: https://launchpad.net/ubuntu/+source/gcc-14 and https://launchpad.net/ubuntu/+source/brotli.
Full licence texts ship inside each package at usr/share/doc/<package>/copyright.
