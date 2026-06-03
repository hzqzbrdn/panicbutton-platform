#!/bin/bash
# UFW Firewall setup for Panic Button SIP Platform

ufw allow 22/tcp comment 'SSH'
ufw allow 5060/udp comment 'SIP UDP'
ufw allow 5061/tcp comment 'SIP TLS'
ufw allow 8088/tcp comment 'Asterisk HTTP'
ufw allow 8089/tcp comment 'Asterisk WSS'
ufw allow 8443/tcp comment 'Nginx LAN dashboard'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 80/tcp comment 'HTTP'
ufw allow 3000/tcp comment 'API'
ufw allow 10000:20000/udp comment 'RTP media'
ufw enable
echo "UFW configured successfully"
