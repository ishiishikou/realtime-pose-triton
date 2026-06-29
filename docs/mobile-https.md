# Mobile HTTPS local testing

Smartphone browsers require a secure context for camera access when the page is not served from `localhost`. When testing from a phone on the same LAN, serve the web UI over HTTPS and use the same origin `/api` proxy for backend calls.

## 1. Find the host LAN IP

Use the IP address that your smartphone can reach on the same Wi-Fi network.

Examples:

```bash
# WSL/Linux
ip route get 1.1.1.1 | awk '{print $7; exit}'

# macOS
ipconfig getifaddr en0
```

Assume the result is `192.168.1.23` in the examples below.

## 2. Create a local certificate

```bash
bash scripts/create-local-https-cert.sh 192.168.1.23
```

This creates:

```text
certs/server.crt
certs/server.key
```

The `certs/` directory is gitignored. Do not commit local private keys or certificates.

## 3. Start HTTPS Docker Compose

```bash
docker compose -f docker-compose.https.yml up --build
```

Open from the smartphone:

```text
https://192.168.1.23:5173
```

The HTTP port `5080` redirects to HTTPS.

## 4. Trust the certificate on the smartphone

A self-signed certificate is not automatically trusted by phones.

For iPhone:

1. Transfer `certs/server.crt` to the iPhone.
2. Install the profile.
3. Open Settings > General > About > Certificate Trust Settings.
4. Enable full trust for the certificate.
5. Reopen Safari and access `https://<host-lan-ip>:5173`.

For Android:

1. Transfer `certs/server.crt` to the device.
2. Install it as a user CA certificate from security settings.
3. Reopen Chrome and access `https://<host-lan-ip>:5173`.

Exact menu names vary by OS version and device vendor.

## Notes

- `docker-compose.https.yml` builds the frontend with `VITE_API_BASE_URL=/api`, so the phone does not try to call `http://localhost:8080`.
- Nginx proxies `/api/*` to the backend container.
- Backend and Triton are not published as LAN-facing ports by `docker-compose.https.yml`; access them through the web proxy when testing from a smartphone.
- Keep the phone and the host machine on the same network.
- If the phone cannot connect, check local firewall settings for ports `5173` and `5080`.
