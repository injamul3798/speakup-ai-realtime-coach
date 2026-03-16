#!/bin/bash

set -e

echo "Updating system..."
sudo apt update && sudo apt upgrade -y

echo "Installing dependencies..."
sudo apt install python3 python3-pip python3-venv nodejs npm nginx mariadb-server -y

echo "Setting up backend..."
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

echo "Building frontend..."
cd ..
npm install
npm run build

echo "Restarting services..."
sudo systemctl restart speakup-backend
sudo systemctl restart nginx

echo "Deployment completed successfully!"
