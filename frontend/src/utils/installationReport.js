import jsPDF from 'jspdf';

export async function generateInstallationReport({ router, stats, logs, gpsLocation, technician }) {
  const doc = new jsPDF();
  
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  let y = margin;

  // Helper functions
  const addText = (text, x, size = 12, style = 'normal') => {
    doc.setFontSize(size);
    doc.setFont('helvetica', style);
    doc.text(text, x, y);
    y += size * 0.5;
  };

  const addLine = () => {
    y += 5;
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;
  };

  const addSpacer = (space = 10) => {
    y += space;
  };

  const formatBytes = (bytes) => {
    const n = Number(bytes) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + ' KB';
    return n + ' B';
  };

  const getUptimePercentage = () => {
    if (!logs || logs.length === 0) return 0;
    const onlineLogs = logs.filter(log => 
      log.status === 'online' || log.status === 1 || log.status === '1'
    );
    return ((onlineLogs.length / logs.length) * 100).toFixed(1);
  };

  const isOnline = router.current_status === 'online' || 
                   router.current_status === 1 || 
                   router.current_status === '1';

  // Header
  doc.setFillColor(124, 58, 237);
  doc.rect(0, 0, pageWidth, 40, 'F');
  
  doc.setTextColor(255, 255, 255);
  addText('VacatAd Router Installation Report', margin, 20, 'bold');
  doc.setTextColor(0, 0, 0);
  y = 50;

  // Installation Details
  addText('Installation Details', margin, 16, 'bold');
  addSpacer(5);
  
  addText(`Router Name: ${router.name || `Router #${router.router_id}`}`, margin, 11);
  addText(`Router ID: ${router.router_id}`, margin, 11);
  
  if (router.imei) {
    addText(`IMEI: ${router.imei}`, margin, 11);
  }
  
  if (router.firmware_version) {
    addText(`Firmware: ${router.firmware_version}`, margin, 11);
  }

  addSpacer(5);
  addText(`Installation Date: ${new Date(technician.timestamp).toLocaleString()}`, margin, 11);
  
  if (router.clickup_location_task_name) {
    addText(`Location: ${router.clickup_location_task_name}`, margin, 11);
  }

  addLine();

  // GPS Location
  addText('GPS Location', margin, 16, 'bold');
  addSpacer(5);
  
  addText(`Latitude: ${gpsLocation.latitude.toFixed(6)}°`, margin, 11);
  addText(`Longitude: ${gpsLocation.longitude.toFixed(6)}°`, margin, 11);
  addText(`Accuracy: ${gpsLocation.accuracy.toFixed(1)} meters`, margin, 11);
  addText(`Captured: ${new Date(gpsLocation.timestamp).toLocaleString()}`, margin, 11);
  
  // Add Google Maps link
  const mapsUrl = `https://www.google.com/maps?q=${gpsLocation.latitude},${gpsLocation.longitude}`;
  doc.setTextColor(124, 58, 237);
  addText('View on Google Maps', margin, 10);
  doc.link(margin, y - 5, 60, 5, { url: mapsUrl });
  doc.setTextColor(0, 0, 0);

  addLine();

  // Status Verification
  addText('Status Verification', margin, 16, 'bold');
  addSpacer(5);

  // Connection Status
  if (isOnline) {
    doc.setFillColor(209, 250, 229);
    doc.rect(margin - 5, y - 5, 15, 8, 'F');
    doc.setTextColor(6, 95, 70);
    addText('✓ ONLINE', margin, 12, 'bold');
    doc.setTextColor(0, 0, 0);
  } else {
    doc.setFillColor(254, 226, 226);
    doc.rect(margin - 5, y - 5, 15, 8, 'F');
    doc.setTextColor(153, 27, 27);
    addText('✗ OFFLINE', margin, 12, 'bold');
    doc.setTextColor(0, 0, 0);
  }

  addSpacer(5);
  addText(`Last Seen: ${router.last_seen ? new Date(router.last_seen).toLocaleString() : 'Never'}`, margin, 11);

  addSpacer(10);

  // 24-Hour Performance Metrics
  addText('24-Hour Performance Metrics', margin, 16, 'bold');
  addSpacer(5);

  const uptimePercentage = getUptimePercentage();
  addText(`Uptime: ${uptimePercentage}% (${logs.length} data points)`, margin, 11);
  
  if (stats) {
    addText(`Data Upload: ${formatBytes(stats.period_tx_bytes || stats.total_tx_bytes || 0)}`, margin, 11);
    addText(`Data Download: ${formatBytes(stats.period_rx_bytes || stats.total_rx_bytes || 0)}`, margin, 11);
    addText(`Total Data: ${formatBytes((stats.period_tx_bytes || stats.total_tx_bytes || 0) + (stats.period_rx_bytes || stats.total_rx_bytes || 0))}`, margin, 11, 'bold');
  }

  // Latest network info
  const latestLog = logs && logs.length > 0 ? logs[0] : null;
  if (latestLog) {
    addSpacer(5);
    
    if (latestLog.operator) {
      addText(`Network Operator: ${latestLog.operator}`, margin, 11);
    }
    
    if (latestLog.network_type) {
      addText(`Network Type: ${latestLog.network_type}`, margin, 11);
    }
    
    if (latestLog.wan_ip) {
      addText(`WAN IP: ${latestLog.wan_ip}`, margin, 11);
    }
    
    if (latestLog.rsrp || latestLog.rssi) {
      addSpacer(5);
      addText('Signal Strength:', margin, 11, 'bold');
      
      if (latestLog.rsrp) {
        addText(`  RSRP: ${latestLog.rsrp} dBm`, margin, 10);
      }
      
      if (latestLog.rssi) {
        addText(`  RSSI: ${latestLog.rssi} dBm`, margin, 10);
      }
      
      if (latestLog.rsrq) {
        addText(`  RSRQ: ${latestLog.rsrq} dB`, margin, 10);
      }
      
      if (latestLog.sinr) {
        addText(`  SINR: ${latestLog.sinr} dB`, margin, 10);
      }
    }
  }

  addLine();

  // Installation Verification
  addText('Installation Verification', margin, 16, 'bold');
  addSpacer(5);

  const checks = [
    { label: 'Router powered on and connected', passed: isOnline },
    { label: 'Network connectivity established', passed: isOnline && latestLog && latestLog.wan_ip },
    { label: 'Data transmission active', passed: stats && ((stats.period_tx_bytes || stats.total_tx_bytes || 0) > 0 || (stats.period_rx_bytes || stats.total_rx_bytes || 0) > 0) },
    { label: 'Signal strength adequate', passed: latestLog && (latestLog.rsrp > -110 || latestLog.rssi > -90) },
    { label: 'Location verified with GPS', passed: gpsLocation && gpsLocation.accuracy < 50 }
  ];

  checks.forEach(check => {
    if (check.passed) {
      doc.setFillColor(209, 250, 229);
      doc.rect(margin - 5, y - 5, 5, 5, 'F');
      doc.setTextColor(6, 95, 70);
      addText(`✓ ${check.label}`, margin, 10);
    } else {
      doc.setFillColor(254, 226, 226);
      doc.rect(margin - 5, y - 5, 5, 5, 'F');
      doc.setTextColor(153, 27, 27);
      addText(`✗ ${check.label}`, margin, 10);
    }
    doc.setTextColor(0, 0, 0);
  });

  addLine();

  // Conclusion
  const allChecksPassed = checks.every(check => check.passed);
  
  if (allChecksPassed) {
    doc.setFillColor(209, 250, 229);
    doc.rect(margin - 5, y - 5, pageWidth - 2 * margin + 10, 25, 'F');
    doc.setTextColor(6, 95, 70);
    addText('✓ INSTALLATION SUCCESSFUL', margin, 14, 'bold');
    addText('Router is operational and all checks passed.', margin, 11);
    doc.setTextColor(0, 0, 0);
  } else {
    doc.setFillColor(254, 226, 226);
    doc.rect(margin - 5, y - 5, pageWidth - 2 * margin + 10, 25, 'F');
    doc.setTextColor(153, 27, 27);
    addText('⚠ INSTALLATION INCOMPLETE', margin, 14, 'bold');
    addText('Some checks failed. Please review and address issues.', margin, 11);
    doc.setTextColor(0, 0, 0);
  }

  // Footer
  y = pageHeight - 20;
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text('Generated by VacatAd Router Management System', pageWidth / 2, y, { align: 'center' });
  doc.text(new Date().toLocaleString(), pageWidth / 2, y + 5, { align: 'center' });

  // Save the PDF
  const fileName = `Installation_Report_${router.router_id}_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(fileName);
}
