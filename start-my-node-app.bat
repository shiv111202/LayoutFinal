@echo off
cd /d "D:\JSON WebEditor\Web\Claude"
pm2 start server.js --name my-node-app
pm2 save