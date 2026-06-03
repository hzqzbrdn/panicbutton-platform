#!/bin/bash
# Panic Button SIP Platform - Full Installation Script
# Ubuntu 22.04 LTS
# Author: Haziq Zabridin - Loranet Technologies

set -e

echo "======================================"
echo " Panic Button SIP Platform Installer"
echo "======================================"

# 1. Update system
echo "[1/8] Updating system..."
apt update && apt upgrade -y

# 2. Install dependencies
echo "[2/8] Installing dependencies..."
apt install -y git curl wget build-essential libssl-dev \
  libncurses5-dev libnewt-dev libxml2-dev linux-headers-$(uname -r) \
  libsqlite3-dev uuid-dev libjansson-dev libedit-dev \
  libmysqlclient-dev mysql-server nginx nodejs npm fail2ban ufw

# 3. Configure UFW
echo "[3/8] Configuring firewall..."
bash scripts/setup-ufw.sh

# 4. Configure Docker iptables (if Docker installed)
if command -v docker &> /dev/null; then
  echo '{"iptables": false}' > /etc/docker/daemon.json
  systemctl restart docker
fi

# 5. Download Asterisk
echo "[4/8] Downloading Asterisk 20..."
cd /usr/src
wget https://downloads.asterisk.org/pub/telephony/asterisk/asterisk-20-current.tar.gz
tar -xzf asterisk-20-current.tar.gz
cd asterisk-20*/

# 6. Compile Asterisk
echo "[5/8] Compiling Asterisk (this takes 10-20 minutes)..."
./configure --with-jansson-bundled --with-pjproject-bundled
menuselect/menuselect --enable res_config_mysql menuselect.makeopts
menuselect/menuselect --enable codec_opus menuselect.makeopts
menuselect/menuselect --enable res_srtp menuselect.makeopts
make -j$(nproc)
make install

# 7. Create asterisk user
useradd -r -d /var/lib/asterisk -s /sbin/nologin asterisk 2>/dev/null || true
chown -R asterisk:asterisk /etc/asterisk /var/lib/asterisk /var/log/asterisk /var/spool/asterisk

# 8. Set up Node.js API
echo "[6/8] Setting up API..."
mkdir -p /opt/panicbutton-api
cp server.js /opt/panicbutton-api/
cp package.json /opt/panicbutton-api/
cd /opt/panicbutton-api
npm install

# 9. Copy configs
echo "[7/8] Copying configuration files..."
cp asterisk-config/* /etc/asterisk/
cp nginx-config/panicbutton /etc/nginx/sites-available/panicbutton
ln -sf /etc/nginx/sites-available/panicbutton /etc/nginx/sites-enabled/panicbutton
cp systemd-config/*.service /etc/systemd/system/

# 10. Set up dashboard
mkdir -p /var/www/panicbutton
cp index.html /var/www/panicbutton/

# 11. Enable services
echo "[8/8] Enabling services..."
systemctl daemon-reload
systemctl enable asterisk panicbutton-api nginx mysql
systemctl start mysql

echo ""
echo "======================================"
echo " Installation complete!"
echo " Next steps:"
echo " 1. Edit /opt/panicbutton-api/.env"
echo " 2. Set up MySQL database (see database-schema/schema.sql)"
echo " 3. Edit /etc/asterisk/pjsip.conf - set YOUR_PUBLIC_IP"
echo " 4. Edit /etc/nginx/sites-available/panicbutton - set your domain"
echo " 5. Get TLS certificate: certbot --nginx"
echo " 6. Restart services: systemctl restart asterisk nginx panicbutton-api"
echo "======================================"
