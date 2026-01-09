#!/bin/bash
# Router Registration Check Script
# Run this on the RADIUS server VPS

echo "=== Checking Docker Containers ==="
docker ps

echo ""
echo "=== Checking FreeRADIUS Logs (last 50 lines) ==="
docker logs freeradius --tail=50

echo ""
echo "=== Checking Registered NAS Devices ==="
docker exec -it radius-db mysql -u radius -p'dcf2f948c4a2c7a0e91233c7b9473f4a3e2d15848b154b92' radius -e "SELECT * FROM nas;"

echo ""
echo "=== Checking Router Activity (Sessions by NAS IP) ==="
docker exec -it radius-db mysql -u radius -p'dcf2f948c4a2c7a0e91233c7b9473f4a3e2d15848b154b92' radius -e "SELECT nasipaddress, COUNT(*) as sessions, MAX(acctstarttime) as last_seen FROM radacct GROUP BY nasipaddress ORDER BY last_seen DESC;"

echo ""
echo "=== Recent Authentication Attempts ==="
docker exec -it radius-db mysql -u radius -p'dcf2f948c4a2c7a0e91233c7b9473f4a3e2d15848b154b92' radius -e "SELECT * FROM radacct ORDER BY acctstarttime DESC LIMIT 5;"
