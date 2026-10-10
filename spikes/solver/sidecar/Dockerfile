# ST-M01-13 CP-SAT sidecar image (candidate per D-ST-05(b), D-ST-22).
# Small, pinned, throwaway. Built with a DEDICATED buildx builder and removed
# afterwards (see scripts/docker-cpsat-build.sh). This is NOT a production image;
# D-ST-22 says a chosen non-Node solver gets its own Dockerfile/Helm/CI job — this
# is the spike precursor of that pattern.
#
# Pinned base + pinned ortools so the CVE scan and the timings are reproducible.
# python:3.12-slim-bookworm matches the repo's bookworm base family.
FROM python:3.12-slim-bookworm

# ortools pinned. Apache-2.0.
RUN pip install --no-cache-dir "ortools==9.11.4210"

WORKDIR /sidecar
COPY solver.py ./solver.py

# Reads a SidecarRequest on stdin, writes a SidecarResponse on stdout.
ENTRYPOINT ["python3", "/sidecar/solver.py"]
