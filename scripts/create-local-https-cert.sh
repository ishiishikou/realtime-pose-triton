#!/usr/bin/env bash
set -euo pipefail

HOST_IP="${1:-}"
if [[ -z "${HOST_IP}" ]]; then
  cat >&2 <<'EOF'
Usage: bash scripts/create-local-https-cert.sh <host-lan-ip>

Example:
  bash scripts/create-local-https-cert.sh 192.168.1.23

The host LAN IP must be reachable from your smartphone on the same network.
EOF
  exit 1
fi

mkdir -p certs

cat > certs/localhost-san.cnf <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = ${HOST_IP}
O = realtime-pose-triton local dev

[v3_req]
subjectAltName = @alt_names
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ${HOST_IP}
EOF

openssl req \
  -x509 \
  -nodes \
  -days 825 \
  -newkey rsa:2048 \
  -keyout certs/server.key \
  -out certs/server.crt \
  -config certs/localhost-san.cnf

chmod 600 certs/server.key

cat <<EOF
Created local HTTPS certificate files:
  certs/server.crt
  certs/server.key

Open from your smartphone:
  https://${HOST_IP}:5173

For iPhone/Android, install and trust certs/server.crt on the device if the browser blocks camera access or shows an untrusted certificate warning.
EOF
