import Papa from 'papaparse';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';

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
    ['Average RSRP', `${(stats.avg_rsrp != null ? Number(stats.avg_rsrp).toFixed(0) : 'N/A')} dBm`],
    ['Average RSSI', `${(stats.avg_rssi != null ? Number(stats.avg_rssi).toFixed(0) : 'N/A')} dBm`],
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
export function exportUptimeReportToPDF(uptimeData, routerId, startDate, endDate) {
  const doc = new jsPDF();
  
  // Title
  doc.setFontSize(18);
  doc.text('Router Uptime Report', 14, 22);
  
  // Metadata
  doc.setFontSize(11);
  doc.text(`Router ID: ${routerId}`, 14, 32);
  doc.text(`Period: ${format(new Date(startDate), 'yyyy-MM-dd')} to ${format(new Date(endDate), 'yyyy-MM-dd')}`, 14, 38);
  doc.text(`Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`, 14, 44);
  
  // Calculate uptime percentage
  const totalRecords = uptimeData.length;
  const onlineRecords = uptimeData.filter(d => d.status === 'online').length;
  const uptimePercent = totalRecords > 0 ? ((onlineRecords / totalRecords) * 100).toFixed(2) : 0;
  
  doc.setFontSize(14);
  doc.text('Uptime Summary', 14, 58);
  
  const summaryData = [
    ['Total Records', totalRecords],
    ['Online Records', onlineRecords],
    ['Uptime Percentage', `${uptimePercent}%`],
  ];
  
  doc.autoTable({
    startY: 62,
    head: [['Metric', 'Value']],
    body: summaryData,
    theme: 'grid',
    headStyles: { fillColor: [102, 126, 234] },
  });
  
  // Detailed log
  const logData = uptimeData.slice(0, 50).map(entry => {
    const d = new Date(entry.timestamp);
    const ts = isNaN(d.getTime()) ? '' : format(d, 'yyyy-MM-dd HH:mm');
    const up = ((Number(entry.uptime_seconds) || 0) / 3600).toFixed(2);
    return [ts, `${up} hrs`, entry.status];
  });
  
  doc.setFontSize(12);
  doc.text('Recent Uptime Logs (Last 50)', 14, doc.lastAutoTable.finalY + 15);
  
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 20,
    head: [['Timestamp', 'Uptime', 'Status']],
    body: logData,
    theme: 'striped',
    headStyles: { fillColor: [102, 126, 234] },
  });
  
  // Save
  doc.save(`router-uptime-report-${routerId}-${format(new Date(), 'yyyyMMdd')}.pdf`);
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes, decimals = 2) {
  const n = Number(bytes);
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  if (!isFinite(n) || n <= 0) return '0 Bytes';

  const k = 1024;
  const rawIndex = Math.floor(Math.log(n) / Math.log(k));
  const i = Math.max(0, Math.min(rawIndex, sizes.length - 1));
  const value = n / Math.pow(k, i);

  return parseFloat(value.toFixed(dm)) + ' ' + sizes[i];
}
