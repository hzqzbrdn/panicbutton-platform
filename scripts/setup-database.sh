#!/bin/bash
# MySQL Database Setup for Panic Button Platform

DB_NAME="asterisk_realtime"
DB_USER="asterisk"
DB_PASS="change_this_password"

echo "Setting up MySQL database..."

mysql -u root << SQLEOF
CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQLEOF

echo "Importing schema..."
mysql -u ${DB_USER} -p${DB_PASS} ${DB_NAME} < database-schema/schema.sql

echo "Database setup complete!"
