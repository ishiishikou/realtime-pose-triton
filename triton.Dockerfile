FROM nvcr.io/nvidia/tritonserver:24.12-py3

# Triton 24.12 already includes wget, unzip and the system CA bundle.
# Avoid apt-get here so local builds do not depend on Ubuntu archive availability.
RUN command -v wget >/dev/null \
    && command -v unzip >/dev/null \
    && test -r /etc/ssl/certs/ca-certificates.crt

COPY triton/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
