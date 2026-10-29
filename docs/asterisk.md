---
title: Asterisk
nav_order: 4
---

# Asterisk

[Asterisk](https://www.asterisk.org) is the phone exchange: the ATA registers with it over SIP, and the daemon drives calls through its REST interface (ARI). Run it in one of two ways:

| | Local Docker | Public on Kubernetes |
| --- | --- | --- |
| Runs on | your Mac | a cluster with a public IP |
| Phone works | while it's plugged into the Mac | from any network the Mac is on |
| Needs | Docker Desktop | DNS name, router port forwards, ingress with TLS |

You can also run both. The ATA then uses the public one and fails over to the local one, and the daemon tries them in the order listed in `DESKPHONE_ARI_URL`.

The daemon makes every connection outward, to Asterisk: the ARI event stream, the REST calls, and one media WebSocket per call. Asterisk never connects back to the Mac, so the Mac can sit behind NAT, a VPN or an office firewall.

Both setups use the same files in `asterisk/config/`. `asterisk/render.sh` fills in the `${…}` placeholders from the environment at startup.

## Option A: Docker on the Mac

1. Start Docker Desktop.
2. Start Asterisk:
   ```sh
   cd asterisk
   docker compose up -d
   ```
3. In `.env`:
   ```sh
   DESKPHONE_ARI_URL=http://127.0.0.1:8088/ari
   ```
4. Check it:
   ```sh
   curl -u deskphone:<ARI_PASSWORD> http://127.0.0.1:8088/ari/asterisk/info
   ```

SIP listens on `5060/udp` and RTP on `10000–10019/udp`. ARI is bound to `127.0.0.1:8088` only. Asterisk advertises `192.168.2.1`, the Mac's address on the Internet Sharing link. Change it with `EXTERNAL_IP` if your link differs.

## Option B: public on Kubernetes

The manifests in `asterisk/kubernetes/` assume [ingress-nginx](https://kubernetes.github.io/ingress-nginx/), [cert-manager](https://cert-manager.io) and a LoadBalancer implementation such as MetalLB. Adjust them to your cluster.

### 1. Pick a hostname and point DNS at your public IP

Create an A record, for example `asterisk.example.com`, pointing to your home or server's public IP. **Do this before deploying.** Asterisk resolves the name once, at startup. If the lookup fails, it silently falls back to the pod IP, and calls connect with no audio.

### 2. Set the hostname in the manifests

```sh
grep -rl asterisk.example.com asterisk/kubernetes | xargs sed -i '' 's/asterisk\.example\.com/your.host.name/g'
```

Also check `asterisk/kubernetes/ingress.yaml`: the cert-manager issuer is named `letsencrypt` there. Change that to your issuer's name.

### 3. Deploy

```sh
kubectl apply -k asterisk/
```

This creates the `deskphone` namespace. The ConfigMap is built from `asterisk/config/`, and the Secret from `asterisk/.env`. Kustomize hashes both names, so a config change rolls the pod.

| Object | Purpose |
| --- | --- |
| Service `asterisk` (LoadBalancer) | SIP on `15060/udp` (off 5060 to dodge most scanners) and RTP on `10000–10019/udp`. `externalTrafficPolicy: Local` keeps the phone's real address. |
| Service `asterisk-http` + Ingress | Publishes only `/ari` (password protected) and `/media` (ephemeral per-call ids) over TLS. |

With MetalLB, pin the Service's IP with the `metallb.io/loadBalancerIPs` annotation so the port forward stays valid.

### 4. Forward ports on your router

Forward **UDP** `15060` and `10000-10019` to the `asterisk` Service's external IP. HTTPS goes through your existing ingress on 443.

### 5. Point the daemon at it

In `.env`, list the public URL first and, optionally, the local Docker Asterisk as a fallback:

```sh
DESKPHONE_ARI_URL=https://your.host.name/ari,http://127.0.0.1:8088/ari
```

Check it:

```sh
curl -u deskphone:<ARI_PASSWORD> https://your.host.name/ari/asterisk/info
```

### Security notes

- The only SIP account is `phone`, protected by `PHONE_PASSWORD`. There are no trunks, so a leaked password lets someone ring your desk phone but not make paid calls.
- ARI is full control over this Asterisk. Keep `ARI_PASSWORD` long and random, and expose it only over TLS. The daemon authenticates the event WebSocket with an `api_key` query parameter, so the password can end up in ingress access logs.
- Calls with no audio for 30 seconds are hung up (`rtp_timeout`).

Next: [connect the phone](phone).
