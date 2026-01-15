import Papa from 'papaparse';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';
import { getRouterGeo, uploadReportToClickUp, getRouterLocationHistory } from '../services/api';

/**
 * Generate a static map image as base64 using OpenStreetMap tiles
 * Uses a canvas to combine tiles into a single image with a marker
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {number} zoom - Zoom level (lower = more zoomed out, 10-12 is good for wider area)
 * @param {number} width - Image width in pixels
 * @param {number} height - Image height in pixels
 * @returns {Promise<string>} Base64 data URL of the map image
 */
async function generateStaticMapImage(lat, lon, zoom = 10, width = 400, height = 200) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    // Calculate tile coordinates
    const n = Math.pow(2, zoom);
    const xTile = Math.floor((lon + 180) / 360 * n);
    const yTile = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
    
    // Calculate pixel offset within tile
    const xOffset = ((lon + 180) / 360 * n - xTile) * 256;
    const yOffset = ((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n - yTile) * 256;
    
    // Calculate how many tiles we need
    const tilesX = Math.ceil(width / 256) + 1;
    const tilesY = Math.ceil(height / 256) + 1;
    const startTileX = xTile - Math.floor(tilesX / 2);
    const startTileY = yTile - Math.floor(tilesY / 2);
    
    // Track loaded tiles
    const totalTiles = tilesX * tilesY;
    let loadedTiles = 0;
    let hasError = false;
    
    // Center offset to place the coordinate in the middle
    const centerOffsetX = width / 2 - (xTile - startTileX) * 256 - xOffset;
    const centerOffsetY = height / 2 - (yTile - startTileY) * 256 - yOffset;
    
    // Fill with a light background color first
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, 0, width, height);
    
    for (let dy = 0; dy < tilesY; dy++) {
      for (let dx = 0; dx < tilesX; dx++) {
        const tileX = startTileX + dx;
        const tileY = startTileY + dy;
        
        // Skip invalid tiles
        if (tileX < 0 || tileY < 0 || tileX >= n || tileY >= n) {
          loadedTiles++;
          continue;
        }
        
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        // Use OpenStreetMap tile server with random subdomain for load balancing
        const subdomain = ['a', 'b', 'c'][Math.floor(Math.random() * 3)];
        img.src = `https://${subdomain}.tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`;
        
        const drawX = dx * 256 + centerOffsetX;
        const drawY = dy * 256 + centerOffsetY;
        
        img.onload = () => {
          if (hasError) return;
          ctx.drawImage(img, drawX, drawY);
          loadedTiles++;
          
          if (loadedTiles === totalTiles) {
            // Draw marker at center
            const markerX = width / 2;
            const markerY = height / 2;
            
            // Draw marker shadow
            ctx.beginPath();
            ctx.ellipse(markerX, markerY + 15, 8, 4, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.fill();
            
            // Draw marker pin
            ctx.beginPath();
            ctx.moveTo(markerX, markerY + 12);
            ctx.bezierCurveTo(markerX - 12, markerY - 5, markerX - 12, markerY - 20, markerX, markerY - 20);
            ctx.bezierCurveTo(markerX + 12, markerY - 20, markerX + 12, markerY - 5, markerX, markerY + 12);
            ctx.fillStyle = '#dc2626';
            ctx.fill();
            ctx.strokeStyle = '#991b1b';
            ctx.lineWidth = 1;
            ctx.stroke();
            
            // Draw inner circle
            ctx.beginPath();
            ctx.arc(markerX, markerY - 8, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            
            // Add attribution (required by OSM)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fillRect(width - 120, height - 14, 120, 14);
            ctx.fillStyle = '#333';
            ctx.font = '9px sans-serif';
            ctx.fillText('© OpenStreetMap', width - 115, height - 4);
            
            resolve(canvas.toDataURL('image/png'));
          }
        };
        
        img.onerror = () => {
          loadedTiles++;
          // Continue even if some tiles fail
          if (loadedTiles === totalTiles && !hasError) {
            // Still return what we have
            resolve(canvas.toDataURL('image/png'));
          }
        };
      }
    }
    
    // Timeout fallback
    setTimeout(() => {
      if (loadedTiles < totalTiles && !hasError) {
        hasError = true;
        reject(new Error('Map tile loading timeout'));
      }
    }, 10000);
  });
}

/**
 * Export logs to CSV
 */
export function exportLogsToCSV(logs, filename = 'router-logs.csv') {
  const csvData = logs.map(log => ({
    'Timestamp': (() => { const d = new Date(log.timestamp); return isNaN(d.getTime()) ? '' : format(d, 'yyyy-MM-dd HH:mm:ss'); })(),
    'Router ID': log.router_id,
    'IMEI': log.imei || '',
    'Operator': log.operator || '',
    'WAN IP': log.wan_ip || '',
    'Data Sent (MB)': (((Number(log.total_tx_bytes) || 0) / 1024 / 1024).toFixed(2)),
    'Data Received (MB)': (((Number(log.total_rx_bytes) || 0) / 1024 / 1024).toFixed(2)),
    'Uptime (hours)': (((Number(log.uptime_seconds) || 0) / 3600).toFixed(2)),
    'Status': log.status || '',
    'WiFi Clients': log.wifi_client_count || 0
  }));

  const csv = Papa.unparse(csvData);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Export usage statistics to PDF
 */
export function exportUsageStatsToPDF(stats, routerId, startDate, endDate) {
  const doc = new jsPDF();
  
  // Title
  doc.setFontSize(18);
  doc.text('Router Usage Report', 14, 22);
  
  // Metadata
  doc.setFontSize(11);
  doc.text(`Router ID: ${routerId}`, 14, 32);
  doc.text(`Period: ${format(new Date(startDate), 'yyyy-MM-dd')} to ${format(new Date(endDate), 'yyyy-MM-dd')}`, 14, 38);
  doc.text(`Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`, 14, 44);
  
  // Stats Summary
  doc.setFontSize(14);
  doc.text('Usage Summary', 14, 58);
  
  const summaryData = [
    ['Total Logs', Number(stats.total_logs) || 0],
    ['Total Data Sent', `${(((Number(stats.period_tx_bytes) || 0) / 1024 / 1024 / 1024).toFixed(2))} GB`],
    ['Total Data Received', `${(((Number(stats.period_rx_bytes) || 0) / 1024 / 1024 / 1024).toFixed(2))} GB`],
    ['Total Data Usage', `${(((Number(stats.total_data_usage) || 0) / 1024 / 1024 / 1024).toFixed(2))} GB`],
    ['Average Uptime', `${(((Number(stats.avg_uptime) || 0) / 3600).toFixed(1))} hours`],
    ['Average WiFi Clients', (Number(stats.avg_clients) ? Number(stats.avg_clients).toFixed(1) : '0')],
  ];
  
  doc.autoTable({
    startY: 62,
    head: [['Metric', 'Value']],
    body: summaryData,
    theme: 'grid',
    headStyles: { fillColor: [102, 126, 234] },
  });
  
  // Save
  doc.save(`router-usage-report-${routerId}-${format(new Date(), 'yyyyMMdd')}.pdf`);
}

/**
 * Export uptime report to PDF
 */
export async function exportUptimeReportToPDF(uptimeData, routerId, startDate, endDate, options = {}) {
  const { logoDataUrl, router, stats } = options;
  const doc = new jsPDF();

  // Optional logo - Increased size
  let y = 14;
  if (logoDataUrl) {
    try {
      // Increased from 20x20 to 30x30
      doc.addImage(logoDataUrl, 'PNG', 14, y, 30, 30);
      y += 10; // Shift title down to accommodate larger logo
    } catch (e) {
      // If image fails, continue without blocking
    }
  }

  // Title - "Router #XX: Uptime & Coverage Report"
  doc.setFontSize(18);
  // Clean up router name if it already contains "Router"
  let displayName = router?.name || `#${routerId}`;
  if (displayName.toLowerCase().startsWith('router')) {
    // If name is "Router 7", keep it. If "Router #7", keep it.
    // Just ensure we don't double up "Router Router 7"
  } else {
    // If name is just "7" or "#7", prepend "Router "
    displayName = `Router ${displayName}`;
  }
  
  doc.text(`${displayName}: Uptime & Coverage Report`, 50, y + 8);

  // Assigned Location (Subtitle)
  let dateY = y + 15;
  if (router?.clickup_location_task_name) {
    doc.setFontSize(9);
    doc.setTextColor(60);
    doc.text(router.clickup_location_task_name, 50, dateY);
    dateY += 5;
  }

  // Subtitle with full date range
  doc.setFontSize(11);
  doc.setTextColor(80); // Dark grey
  const dateRange = `${format(new Date(startDate), 'MMMM do, yyyy')} - ${format(new Date(endDate), 'MMMM do, yyyy')}`;
  doc.text(dateRange, 50, dateY);
  doc.setTextColor(0); // Reset to black

  // Metadata
  doc.setFontSize(11);
  let currentY = y + 30; // Start lower to clear logo
  
  // Cell Tower Location Box (Right side) - Render first so it doesn't overlap if metadata is long
  // Always show the box if we have a router object, as requested
  if (router) {
    const cellTowerData = [
      ['Cell ID', router.cell_id || '-'],
      ['TAC', router.tac || '-'],
      ['Mobile country code', router.mcc || '-'],
      ['Mobile network code', router.mnc || '-']
    ];

    doc.autoTable({
      startY: currentY - 5, // Align with top of metadata
      margin: { left: 145 }, // Position on the right
      head: [['Cell Tower Location', 'Value']],
      body: cellTowerData,
      theme: 'grid',
      headStyles: { fillColor: [91, 127, 92], halign: 'left' },
      styles: { fontSize: 8, cellPadding: 1 },
      columnStyles: { 0: { fontStyle: 'bold', width: 32 }, 1: { width: 22 } },
      tableWidth: 54
    });
  }

  doc.text(`Router ID: ${routerId}`, 14, currentY);

  if (router?.imei) {
    currentY += 6;
    doc.text(`IMEI: ${router.imei}`, 14, currentY);
  }

  if (router?.operator) {
    currentY += 6;
    doc.text(`Network Provider: ${router.operator}`, 14, currentY);
  }

  if (router?.wan_ip) {
    currentY += 6;
    doc.text(`IP Address: ${router.wan_ip}`, 14, currentY);
  }

  // Location: Prefer lat/long, fallback to IP geolocation
  let locationText = null;
  if (router?.latitude && router?.longitude) {
    locationText = `${router.latitude}, ${router.longitude} (Cell Tower)`;
  } else if (router?.wan_ip) {
    try {
      const geoRes = await getRouterGeo(router.wan_ip);
      if (geoRes.data) {
        const { city, region, country, org } = geoRes.data;
        const parts = [city, region, country].filter(Boolean);
        if (parts.length > 0) {
          locationText = `${parts.join(', ')} (IP: ${org || 'Unknown ISP'})`;
        }
      }
    } catch (e) {
      // Ignore geo lookup errors
    }
  }

  if (locationText) {
    currentY += 6;
    doc.text(`Location: ${locationText}`, 14, currentY);
  }

  currentY += 6;
  doc.text(`Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`, 14, currentY);
  
  // Update y for subsequent sections
  y = currentY;

  // Sort uptime records ascending by timestamp for analysis
  const sorted = (uptimeData || []).slice().sort((a,b)=> new Date(a.timestamp) - new Date(b.timestamp));
  const totalRecords = sorted.length;
  const onlineRecords = sorted.filter(d => d.status === 'online' || d.status === 1 || d.status === '1' || d.status === true).length;
  const uptimePercent = totalRecords > 0 ? ((onlineRecords / totalRecords) * 100) : 0;

  // Daily breakdown between date range
  const dailyMap = new Map();
  for (const entry of sorted) {
    const d = new Date(entry.timestamp);
    const key = format(d, 'yyyy-MM-dd');
    const rec = dailyMap.get(key) || { date: key, total: 0, online: 0 };
    rec.total += 1;
    const isOn = (entry.status === 'online' || entry.status === 1 || entry.status === '1' || entry.status === true);
    if (isOn) rec.online += 1;
    dailyMap.set(key, rec);
  }
  const byDay = Array.from(dailyMap.values()).sort((a,b)=> a.date.localeCompare(b.date)).map(d => ({
    ...d,
    pct: d.total ? Math.round((d.online / d.total) * 10000)/100 : 0
  }));

  // Longest offline streak and total offline duration (approximate via gaps)
  let longestOfflineSec = 0, currentStart = null, totalOfflineSec = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i+1];
    const curOn = (cur.status === 'online' || cur.status === 1 || cur.status === '1' || cur.status === true);
    const dt = (new Date(next.timestamp) - new Date(cur.timestamp)) / 1000; // seconds between samples
    if (!curOn) {
      if (currentStart == null) currentStart = new Date(cur.timestamp);
      totalOfflineSec += Math.max(0, dt);
    } else if (currentStart != null) {
      const run = (new Date(cur.timestamp) - currentStart) / 1000;
      if (run > longestOfflineSec) longestOfflineSec = run;
      currentStart = null;
    }
  }
  if (currentStart != null && sorted.length > 0) {
    const last = sorted[sorted.length-1];
    const run = (new Date(last.timestamp) - currentStart) / 1000;
    if (run > longestOfflineSec) longestOfflineSec = run;
  }

  // Calculate Total Uptime (Total Duration - Total Offline)
  let totalDurationSec = 0;
  if (sorted.length > 1) {
    totalDurationSec = (new Date(sorted[sorted.length-1].timestamp) - new Date(sorted[0].timestamp)) / 1000;
  }
  const totalUptimeSec = Math.max(0, totalDurationSec - totalOfflineSec);

  const fmtHMS = (sec) => {
    const s = Math.max(0, Math.floor(sec));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    
    if (d > 0) {
      return `${d}d ${h}h ${m}m ${ss}s`;
    }
    return `${h}h ${m}m ${ss}s`;
  };

  // Summary table
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0); // Ensure black text
  const summaryStartY = y + 10;
  doc.text('Uptime Summary', 14, summaryStartY);
  
  const offlineRecords = totalRecords - onlineRecords;
  const summaryData = [
    ['Total Records', totalRecords],
    ['Online Records', onlineRecords],
    ['Offline Records', offlineRecords],
    ['Overall Uptime', `${uptimePercent.toFixed(2)}%`],
    ['Total Uptime', fmtHMS(totalUptimeSec)],
    ['Total Offline', fmtHMS(totalOfflineSec)]
  ];
  doc.autoTable({
    startY: summaryStartY + 4,
    head: [['Metric', 'Value']],
    body: summaryData,
    theme: 'grid',
    headStyles: { fillColor: [91, 127, 92], textColor: [255, 255, 255] }, // Brand Green with white text
    styles: { textColor: [0, 0, 0] }, // Black text for body
    didParseCell: function(data) {
      // Make offline-related rows red
      if (data.section === 'body') {
        const label = data.row.raw[0];
        if (label === 'Offline Records' || label === 'Total Offline') {
          data.cell.styles.textColor = [220, 38, 38]; // Red color
          data.cell.styles.fontStyle = 'bold';
        }
      }
    }
  });

  // Data Usage section (if stats available)
  if (stats) {
    const dataStartY = (doc.lastAutoTable?.finalY || (summaryStartY + 30)) + 10;
    doc.setFontSize(14);
    doc.text('Data Usage', 14, dataStartY);
    
    const totalTxBytes = Number(stats.period_tx_bytes) || 0;
    const totalRxBytes = Number(stats.period_rx_bytes) || 0;
    const totalDataBytes = totalTxBytes + totalRxBytes;
    
    const dataUsageData = [
      ['Total Data Sent', `${(totalTxBytes / 1024 / 1024 / 1024).toFixed(2)} GB`],
      ['Total Data Received', `${(totalRxBytes / 1024 / 1024 / 1024).toFixed(2)} GB`],
      ['Total Data Usage', `${(totalDataBytes / 1024 / 1024 / 1024).toFixed(2)} GB`]
    ];
    
    doc.autoTable({
      startY: dataStartY + 4,
      head: [['Metric', 'Value']],
      body: dataUsageData,
      theme: 'grid',
      headStyles: { fillColor: [91, 127, 92] }, // Brand Green #5b7f5c
    });
  }

  // Location Map section - fetch from location history API if not on router object
  let locationLat = router?.latitude;
  let locationLon = router?.longitude;
  let locationAccuracy = router?.location_accuracy;
  
  // Try to fetch current location from API if not present on router
  if ((!locationLat || !locationLon) && routerId) {
    try {
      const locRes = await getRouterLocationHistory(routerId, { limit: 1 });
      if (locRes.data?.current) {
        locationLat = locRes.data.current.latitude;
        locationLon = locRes.data.current.longitude;
        locationAccuracy = locRes.data.current.accuracy;
      }
    } catch {
      // Ignore - location just won't be shown
    }
  }
  
  if (locationLat && locationLon) {
    const mapStartY = (doc.lastAutoTable?.finalY || (summaryStartY + 30)) + 10;
    
    // Check if we need a new page for the map
    if (mapStartY + 70 > 280) {
      doc.addPage();
      doc.setFontSize(14);
      doc.text('Router Location', 14, 20);
      
      try {
        // Generate static map - zoom level 10 for wider area view
        const mapDataUrl = await generateStaticMapImage(
          parseFloat(locationLat),
          parseFloat(locationLon),
          10, // Zoomed out to show wider area
          400,
          180
        );
        
        // Add map image to PDF (scaled to fit page width)
        doc.addImage(mapDataUrl, 'PNG', 14, 24, 180, 81);
        
        // Add coordinates text below map
        doc.setFontSize(9);
        doc.setTextColor(80);
        doc.text(`Coordinates: ${locationLat}, ${locationLon}`, 14, 110);
        if (locationAccuracy) {
          doc.text(`Accuracy: ±${Math.round(locationAccuracy)}m`, 100, 110);
        }
        doc.setTextColor(0);
      } catch (mapError) {
        console.error('Failed to generate map for PDF:', mapError);
        doc.setFontSize(10);
        doc.text(`Location: ${locationLat}, ${locationLon}`, 14, 28);
      }
    } else {
      doc.setFontSize(14);
      doc.text('Router Location', 14, mapStartY);
      
      try {
        // Generate static map - zoom level 10 for wider area view
        const mapDataUrl = await generateStaticMapImage(
          parseFloat(locationLat),
          parseFloat(locationLon),
          10, // Zoomed out to show wider area
          400,
          180
        );
        
        // Add map image to PDF (scaled to fit page width)
        doc.addImage(mapDataUrl, 'PNG', 14, mapStartY + 4, 180, 81);
        
        // Add coordinates text below map
        doc.setFontSize(9);
        doc.setTextColor(80);
        doc.text(`Coordinates: ${locationLat}, ${locationLon}`, 14, mapStartY + 90);
        if (locationAccuracy) {
          doc.text(`Accuracy: ±${Math.round(locationAccuracy)}m`, 100, mapStartY + 90);
        }
        doc.setTextColor(0);
        
        // Update the lastAutoTable position for following sections
        doc.lastAutoTable = { finalY: mapStartY + 95 };
      } catch (mapError) {
        console.error('Failed to generate map for PDF:', mapError);
        doc.setFontSize(10);
        doc.text(`Location: ${locationLat}, ${locationLon}`, 14, mapStartY + 8);
      }
    }
  }

  // Daily breakdown table
  const dailyStartY = (doc.lastAutoTable?.finalY || (summaryStartY + 30)) + 10;
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0); // Ensure black text
  doc.text('Daily Activity within Range', 14, dailyStartY);
  
  // Add offline count to daily data
  const dailyBody = byDay.map(d => {
    const offline = d.total - d.online;
    return [d.date, d.total, d.online, offline, `${d.pct.toFixed(2)}%`];
  });
  
  doc.autoTable({
    startY: dailyStartY + 4,
    head: [['Date', 'Samples', 'Online', 'Offline', 'Uptime %']],
    body: dailyBody,
    theme: 'striped',
    headStyles: { fillColor: [91, 127, 92], textColor: [255, 255, 255] }, // Brand Green with white text
    styles: { cellPadding: 2, textColor: [0, 0, 0] }, // Black text for body
    columnStyles: { 
      3: { textColor: [220, 38, 38] } // Offline column in red
    },
    didParseCell: function(data) {
      // Color code uptime percentage based on value
      if (data.section === 'body' && data.column.index === 4) {
        const pctText = data.cell.raw;
        const pct = parseFloat(pctText);
        if (pct < 50) {
          data.cell.styles.textColor = [220, 38, 38]; // Red for poor uptime
        } else if (pct < 90) {
          data.cell.styles.textColor = [234, 179, 8]; // Yellow/orange for mediocre
        } else {
          data.cell.styles.textColor = [22, 163, 74]; // Green for good uptime
        }
      }
    }
  });

  // Generate filename
  const filename = `router-uptime-report-${routerId}-${format(new Date(), 'yyyyMMdd')}.pdf`;
  
  // Save locally
  doc.save(filename);
  
  // Upload to ClickUp if router has a ClickUp task
  if (router?.clickup_task_id) {
    try {
      // Get PDF as base64
      const pdfBase64 = doc.output('datauristring').split(',')[1];
      const dateRange = `${format(new Date(startDate), 'MMM d, yyyy')} - ${format(new Date(endDate), 'MMM d, yyyy')}`;
      
      await uploadReportToClickUp(routerId, pdfBase64, 'uptime-report', dateRange);
    } catch (error) {
      console.error('Failed to upload report to ClickUp:', error);
      // Don't throw - the PDF was still saved locally
    }
  }
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes, decimals = 2) {
  const n = Number(bytes);
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB'];

  if (!isFinite(n) || n <= 0) return '0 Bytes';

  const k = 1024;
  const rawIndex = Math.floor(Math.log(n) / Math.log(k));
  const i = Math.max(0, Math.min(rawIndex, sizes.length - 1));
  const value = n / Math.pow(k, i);

  return parseFloat(value.toFixed(dm)) + ' ' + sizes[i];
}
