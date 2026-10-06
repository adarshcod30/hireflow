#!/bin/bash
# First-boot setup for the HireFlow API instance. Runs once, as root, from EC2 user data.
# Names wrapped in double underscores (the Node version, the domain and so on) are filled in by
# lib/constructs/api-host.ts before the instance starts.
set -euxo pipefail
exec > >(tee -a /var/log/hireflow-bootstrap.log) 2>&1

# One GB of RAM is tight for Node, Caddy and the CloudWatch agent together. A swap file is cheap insurance.
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

dnf install -y amazon-cloudwatch-agent xz

# Node.js, pinned to one version and checked against the published checksum
curl -fsSL "https://nodejs.org/dist/v__NODE_VERSION__/node-v__NODE_VERSION__-linux-arm64.tar.xz" -o /tmp/node.tar.xz
echo "__NODE_SHA256__  /tmp/node.tar.xz" | sha256sum -c -
mkdir -p /usr/local/lib/nodejs
tar -xJf /tmp/node.tar.xz -C /usr/local/lib/nodejs --strip-components=1
ln -sf /usr/local/lib/nodejs/bin/node /usr/local/bin/node
rm /tmp/node.tar.xz

# Caddy: the reverse proxy that terminates TLS and renews the certificate on its own
curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v__CADDY_VERSION__/caddy___CADDY_VERSION___linux_arm64.tar.gz" -o /tmp/caddy.tar.gz
echo "__CADDY_SHA512__  /tmp/caddy.tar.gz" | sha512sum -c -
tar -xzf /tmp/caddy.tar.gz -C /usr/local/bin caddy
chmod 755 /usr/local/bin/caddy
rm /tmp/caddy.tar.gz

# Two unprivileged service users. The app cannot write to its own code.
useradd --system --home-dir /opt/hireflow --shell /sbin/nologin hireflow
useradd --system --home-dir /var/lib/caddy --shell /sbin/nologin caddy
mkdir -p /opt/hireflow/releases /etc/hireflow /var/log/hireflow /var/lib/caddy /etc/caddy
chown caddy:caddy /var/lib/caddy
chown root:hireflow /etc/hireflow
chmod 750 /etc/hireflow

cat > /etc/caddy/Caddyfile <<'CADDY'
{
	email __ACME_EMAIL__
}

__API_DOMAIN__ {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
	header -Server
}
CADDY

cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
Environment=XDG_DATA_HOME=/var/lib/caddy XDG_CONFIG_HOME=/var/lib/caddy
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=on-failure
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/hireflow-api.service <<'UNIT'
[Unit]
Description=HireFlow API
After=network-online.target
Wants=network-online.target

[Service]
User=hireflow
Group=hireflow
WorkingDirectory=/opt/hireflow/current
EnvironmentFile=/etc/hireflow/api.env
Environment=NODE_OPTIONS=--max-old-space-size=384
ExecStart=/usr/local/bin/node dist/main.js
Restart=always
RestartSec=3
MemoryMax=600M
StandardOutput=append:/var/log/hireflow/api.log
StandardError=append:/var/log/hireflow/api.log
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/logrotate.d/hireflow <<'ROTATE'
/var/log/hireflow/*.log {
    daily
    rotate 3
    compress
    missingok
    notifempty
    copytruncate
}
ROTATE

# Ship the API log and two host metrics that CloudWatch cannot see from outside: memory and disk
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<'AGENT'
{
  "agent": { "run_as_user": "root" },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          { "file_path": "/var/log/hireflow/api.log", "log_group_name": "/hireflow/api", "log_stream_name": "{instance_id}" },
          { "file_path": "/var/log/hireflow/deploy.log", "log_group_name": "/hireflow/deploy", "log_stream_name": "{instance_id}" }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "HireFlow/Host",
    "append_dimensions": { "InstanceId": "${aws:InstanceId}" },
    "metrics_collected": {
      "mem": { "measurement": ["mem_used_percent"], "metrics_collection_interval": 60 },
      "disk": { "measurement": ["used_percent"], "resources": ["/"], "metrics_collection_interval": 300 }
    }
  }
}
AGENT

systemctl daemon-reload
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
# Neither service is started here. The first deploy starts them: there is no release to run yet, and
# Caddy should not ask Let's Encrypt for a certificate before the DNS record exists, because failed
# attempts count against a limit of five an hour.
systemctl enable caddy hireflow-api
echo "bootstrap finished"
