import jsPDF from 'jspdf';
import { uploadReportToClickUp } from '../services/api';

export async function generateInstallationReport({ router, stats, logs, gpsLocation, technician }) {
  const doc = new jsPDF();
  
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 25;
  let y = margin;

  // Professional color palette
  const colors = {
    primary: [37, 99, 235],      // Blue-600
    primaryDark: [29, 78, 216],  // Blue-700
    success: [22, 163, 74],       // Green-600
    successLight: [220, 252, 231], // Green-100
    warning: [234, 88, 12],       // Orange-600
    warningLight: [254, 243, 199], // Orange-100
    error: [220, 38, 38],         // Red-600
    errorLight: [254, 226, 226],  // Red-100
    neutral: [107, 114, 128],     // Gray-500
    neutralLight: [243, 244, 246], // Gray-100
    text: [17, 24, 39],           // Gray-900
    textLight: [75, 85, 99]       // Gray-600
  };

  // Helper functions
  const addHeading = (text, size = 14) => {
    y += 8;
    doc.setFontSize(size);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...colors.primary);
    doc.text(text, margin, y);
    y += size * 0.5 + 4;
    // Add subtle underline
    doc.setDrawColor(...colors.neutralLight);
    doc.setLineWidth(1);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;
  };

  const addSpacer = (space = 8) => {
    y += space;
  };

  const checkPageOverflow = (neededSpace = 20) => {
    // Keep 40mm from bottom for footer
    if (y + neededSpace > pageHeight - 40) {
      doc.addPage();
      y = margin;
      return true;
    }
    return false;
  };

  const addInfoRow = (label, value, isBold = false) => {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...colors.textLight);
    doc.text(label, margin, y);
    
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.setTextColor(...colors.text);
    doc.text(String(value), margin + 65, y);
    y += 6;
  };

  const addCheckItem = (label, passed) => {
    const iconSize = 4;
    const iconY = y - 3;
    
    if (passed) {
      // Green checkmark background
      doc.setFillColor(...colors.successLight);
      doc.circle(margin + 2, iconY, iconSize, 'F');
      // Checkmark text
      doc.setTextColor(...colors.success);
      doc.setFontSize(10);
      doc.text('✓', margin + 0.5, iconY + 1.5);
    } else {
      // Red X background
      doc.setFillColor(...colors.errorLight);
      doc.circle(margin + 2, iconY, iconSize, 'F');
      // X text
      doc.setTextColor(...colors.error);
      doc.setFontSize(10);
      doc.text('✗', margin + 0.5, iconY + 1.5);
    }
    
    // Label
    doc.setTextColor(...colors.text);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(label, margin + 10, y);
    y += 7;
  };

  const formatBytes = (bytes) => {
    const n = Number(bytes) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + ' KB';
    return n.toFixed(0) + ' B';
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

  // ============================================================================
  // HEADER - Modern gradient with white text
  // ============================================================================
  
  // Gradient background (simulated with multiple rectangles)
  for (let i = 0; i < 45; i++) {
    const shade = 37 + i * 0.3;
    doc.setFillColor(Math.floor(shade), Math.floor(99 + i * 0.8), Math.floor(235 - i * 0.5));
    doc.rect(0, i, pageWidth, 1, 'F');
  }
  
  // Company name
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('VacatAd', margin, 18);
  
  // Report title
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text('Router Installation Report', margin, 28);
  
  // Date badge (top right)
  const dateText = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  const dateWidth = doc.getTextWidth(dateText);
  doc.setFillColor(255, 255, 255, 0.2);
  doc.roundedRect(pageWidth - margin - dateWidth - 12, 14, dateWidth + 10, 8, 2, 2, 'F');
  doc.text(dateText, pageWidth - margin - dateWidth - 7, 19);
  
  // Reset
  doc.setTextColor(...colors.text);
  y = 55;

  // ============================================================================
  // INSTALLATION DETAILS
  // ============================================================================
  
  checkPageOverflow(60);
  addHeading('Installation Details', 14);
  
  // Router info in a light box
  doc.setFillColor(...colors.neutralLight);
  doc.roundedRect(margin, y, pageWidth - 2 * margin, 50, 3, 3, 'F');
  y += 8;
  
  addInfoRow('Router Name:', router.name || `Router #${router.router_id}`);
  addInfoRow('Router ID:', router.router_id, true);
  
  if (router.imei) {
    addInfoRow('IMEI:', router.imei);
  }
  
  if (router.firmware_version) {
    addInfoRow('Firmware Version:', router.firmware_version);
  }
  
  y += 4;
  
  // Installation metadata
  const installDate = technician?.timestamp ? new Date(technician.timestamp) : new Date();
  addInfoRow('Installation Date:', installDate.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }));
  
  if (router.clickup_location_task_name) {
    addInfoRow('Location:', router.clickup_location_task_name);
  }
  
  y += 8;

  // ============================================================================
  // GPS LOCATION
  // ============================================================================
  
  checkPageOverflow(55);
  addHeading('GPS Location', 14);
  
  // GPS coordinates in a box with map icon
  doc.setFillColor(...colors.neutralLight);
  doc.roundedRect(margin, y, pageWidth - 2 * margin, 42, 3, 3, 'F');
  y += 8;
  
  addInfoRow('Latitude:', `${gpsLocation.latitude.toFixed(6)}°`);
  addInfoRow('Longitude:', `${gpsLocation.longitude.toFixed(6)}°`);
  addInfoRow('Accuracy:', `${gpsLocation.accuracy.toFixed(1)} meters`);
  addInfoRow('Captured:', (() => {
    const d = new Date(gpsLocation.timestamp);
    return isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  })());
  
  y += 6;
  
  // Add clickable Google Maps link
  const mapsUrl = `https://www.google.com/maps?q=${gpsLocation.latitude},${gpsLocation.longitude}`;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...colors.primary);
  const linkText = '📍 View on Google Maps';
  doc.textWithLink(linkText, margin, y, { url: mapsUrl });
  y += 8;

  // ============================================================================
  // CONNECTION STATUS
  // ============================================================================
  
  checkPageOverflow(35);
  addHeading('Connection Status', 14);

  // Status badge - prominent and clear
  if (isOnline) {
    doc.setFillColor(...colors.success);
    doc.roundedRect(margin, y, 50, 12, 3, 3, 'F');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('✓ ONLINE', margin + 10, y + 8);
    y += 18;
  } else {
    doc.setFillColor(...colors.error);
    doc.roundedRect(margin, y, 55, 12, 3, 3, 'F');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('✗ OFFLINE', margin + 10, y + 8);
    y += 18;
  }
  
  // Last seen
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...colors.textLight);
  const lastSeenText = router.last_seen
    ? (() => {
        const d = new Date(router.last_seen);
        return isNaN(d.getTime()) ? 'Never' : d.toLocaleString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      })()
    : 'Never';
  doc.text(`Last Seen: ${lastSeenText}`, margin, y);
  y += 8;

  // ============================================================================
  // 24-HOUR PERFORMANCE METRICS
  // ============================================================================
  
  checkPageOverflow(40);
  addHeading('24-Hour Performance', 14);

  const uptimePercentage = getUptimePercentage();
  const latestLog = logs && logs.length > 0 ? logs[0] : null;
  
  // Uptime metric box
  doc.setFillColor(...colors.neutralLight);
  doc.roundedRect(margin, y, (pageWidth - 2 * margin - 8) / 2, 22, 3, 3, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...colors.textLight);
  doc.text('Uptime', margin + 6, y + 7);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...colors.success);
  doc.text(`${uptimePercentage}%`, margin + 6, y + 16);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...colors.textLight);
  doc.text(`${logs.length} samples`, margin + 6, y + 20);
  
  // Data usage metric box
  const totalData = (stats?.period_tx_bytes || stats?.total_tx_bytes || 0) + 
                    (stats?.period_rx_bytes || stats?.total_rx_bytes || 0);
  doc.setFillColor(...colors.neutralLight);
  doc.roundedRect(margin + (pageWidth - 2 * margin - 8) / 2 + 8, y, 
                  (pageWidth - 2 * margin - 8) / 2, 22, 3, 3, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...colors.textLight);
  doc.text('Total Data', margin + (pageWidth - 2 * margin - 8) / 2 + 14, y + 7);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...colors.primary);
  doc.text(formatBytes(totalData), margin + (pageWidth - 2 * margin - 8) / 2 + 14, y + 16);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...colors.textLight);
  const uploadText = `↑ ${formatBytes(stats?.period_tx_bytes || stats?.total_tx_bytes || 0)}`;
  const downloadText = `↓ ${formatBytes(stats?.period_rx_bytes || stats?.total_rx_bytes || 0)}`;
  doc.text(`${uploadText}  ${downloadText}`, 
           margin + (pageWidth - 2 * margin - 8) / 2 + 14, y + 20);
  
  y += 28;
  
  // Network information in table format
  if (latestLog && (latestLog.operator || latestLog.network_type || latestLog.wan_ip)) {
    checkPageOverflow(45);
    addSpacer(4);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...colors.text);
    doc.text('Network Information', margin, y);
    y += 8;
    
    doc.setFillColor(...colors.neutralLight);
    doc.roundedRect(margin, y, pageWidth - 2 * margin, 28, 3, 3, 'F');
    y += 7;
    
    if (latestLog.operator) {
      addInfoRow('Operator:', latestLog.operator);
    }
    
    if (latestLog.network_type) {
      addInfoRow('Network Type:', latestLog.network_type);
    }
    
    if (latestLog.wan_ip) {
      addInfoRow('WAN IP:', latestLog.wan_ip);
    }
    
    y += 4;
  }
  
  // Signal strength metrics
  if (latestLog && (latestLog.rsrp || latestLog.rssi)) {
    checkPageOverflow(35);
    addSpacer(4);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...colors.text);
    doc.text('Signal Strength', margin, y);
    y += 8;
    
    // Signal strength boxes (4 metrics in a row)
    const boxWidth = (pageWidth - 2 * margin - 24) / 4;
    let xOffset = margin;
    
    const signalMetrics = [
      { label: 'RSRP', value: latestLog.rsrp, unit: 'dBm' },
      { label: 'RSSI', value: latestLog.rssi, unit: 'dBm' },
      { label: 'RSRQ', value: latestLog.rsrq, unit: 'dB' },
      { label: 'SINR', value: latestLog.sinr, unit: 'dB' }
    ];
    
    signalMetrics.forEach((metric, idx) => {
      if (metric.value) {
        doc.setFillColor(...colors.neutralLight);
        doc.roundedRect(xOffset, y, boxWidth, 18, 2, 2, 'F');
        
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...colors.textLight);
        doc.text(metric.label, xOffset + 4, y + 6);
        
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.text);
        doc.text(`${metric.value} ${metric.unit}`, xOffset + 4, y + 13);
        
        xOffset += boxWidth + 8;
      }
    });
    
    y += 24;
  }

  // ============================================================================
  // INSTALLATION VERIFICATION CHECKLIST
  // ============================================================================
  
  checkPageOverflow(60);
  addHeading('Installation Verification', 14);

  const checks = [
    { label: 'Router powered on and connected', passed: isOnline },
    { label: 'Network connectivity established', passed: isOnline && latestLog && latestLog.wan_ip },
    { label: 'Data transmission active', passed: stats && ((stats.period_tx_bytes || stats.total_tx_bytes || 0) > 0 || (stats.period_rx_bytes || stats.total_rx_bytes || 0) > 0) },
    { label: 'Signal strength adequate (RSRP > -110 dBm)', passed: latestLog && (latestLog.rsrp > -110 || latestLog.rssi > -90) },
    { label: 'Location verified with GPS (< 50m accuracy)', passed: gpsLocation && gpsLocation.accuracy < 50 }
  ];

  // Checklist in a box
  doc.setFillColor(...colors.neutralLight);
  doc.roundedRect(margin, y, pageWidth - 2 * margin, 42, 3, 3, 'F');
  y += 8;
  
  checks.forEach(check => {
    addCheckItem(check.label, check.passed);
  });
  
  y += 6;

  // ============================================================================
  // FINAL VERDICT
  // ============================================================================
  
  checkPageOverflow(40);
  addSpacer(6);
  
  const allChecksPassed = checks.every(check => check.passed);
  const passedCount = checks.filter(c => c.passed).length;
  
  if (allChecksPassed) {
    // Success banner
    doc.setFillColor(...colors.success);
    doc.roundedRect(margin, y, pageWidth - 2 * margin, 28, 4, 4, 'F');
    
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('✓ INSTALLATION SUCCESSFUL', margin + 10, y + 12);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Router is fully operational. All verification checks passed.', margin + 10, y + 21);
    
    y += 34;
  } else {
    // Warning banner
    doc.setFillColor(...colors.warning);
    doc.roundedRect(margin, y, pageWidth - 2 * margin, 28, 4, 4, 'F');
    
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('⚠ INSTALLATION INCOMPLETE', margin + 10, y + 12);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`${passedCount} of ${checks.length} checks passed. Please review and address failed items.`, margin + 10, y + 21);
    
    y += 34;
  }

  // ============================================================================
  // FOOTER - Add to all pages
  // ============================================================================
  
  const pageCount = doc.internal.getNumberOfPages();
  
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const footerY = pageHeight - 18;
    
    // Divider line
    doc.setDrawColor(...colors.neutralLight);
    doc.setLineWidth(0.5);
    doc.line(margin, footerY - 3, pageWidth - margin, footerY - 3);
    
    // Footer text
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...colors.neutral);
    doc.text('Generated by VacatAd Router Management System', pageWidth / 2, footerY + 3, { align: 'center' });
    
    const timestamp = new Date().toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    doc.text(`Report generated: ${timestamp}`, pageWidth / 2, footerY + 8, { align: 'center' });
    
    // Document ID and page number in bottom right
    doc.setFontSize(7);
    doc.setTextColor(...colors.neutralLight);
    doc.text(`Doc ID: ${router.router_id}-${Date.now()} | Page ${i} of ${pageCount}`, pageWidth - margin, footerY + 8, { align: 'right' });
  }

  // ============================================================================
  // SAVE PDF
  // ============================================================================
  
  const fileName = `Installation_Report_${router.router_id}_${new Date().toISOString().split('T')[0]}.pdf`;
  
  // Save locally
  doc.save(fileName);
  
  // Upload to ClickUp if router has a ClickUp task
  if (router?.clickup_task_id) {
    try {
      // Get PDF as base64
      const pdfBase64 = doc.output('datauristring').split(',')[1];
      
      await uploadReportToClickUp(router.router_id, pdfBase64, 'installation-report', null);
    } catch (error) {
      console.error('Failed to upload installation report to ClickUp:', error);
      // Don't throw - the PDF was still saved locally
    }
  }
}
