#!/bin/bash
# PFLICHT vor jedem Deployment: Live-Daten sichern
STAMP=$(date +%Y%m%d_%H%M%S)
curl -s "https://angel-challenge.up.railway.app/api/catches" > "backups/catches_$STAMP.json"
echo "Backup: backups/catches_$STAMP.json ($(wc -c < backups/catches_$STAMP.json) Bytes)"
