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
  const { logoDataUrl } = options;
  const doc = new jsPDF();

  // Optional logo
  let y = 14;
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', 14, y, 20, 20);
      y += 4; // slight shift for title
    } catch (e) {
      // If image fails, continue without blocking
    }
  }

  // Title
  doc.setFontSize(18);
  doc.text('Router Uptime Report', 40, y + 8);

  // Metadata
  doc.setFontSize(11);
  doc.text(`Router ID: ${routerId}`, 14, y + 24);
  doc.text(`Period: ${format(new Date(startDate), 'yyyy-MM-dd HH:mm')} to ${format(new Date(endDate), 'yyyy-MM-dd HH:mm')}`, 14, y + 30);
  doc.text(`Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`, 14, y + 36);

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

  const fmtHMS = (sec) => {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), ss = s%60;
    return `${h}h ${m}m ${ss}s`;
  };

  // Summary table
  doc.setFontSize(14);
  const summaryStartY = y + 46;
  doc.text('Uptime Summary', 14, summaryStartY);
  const summaryData = [
    ['Total Records', totalRecords],
    ['Online Records', onlineRecords],
    ['Overall Uptime', `${uptimePercent.toFixed(2)}%`],
    ['Total Offline', fmtHMS(totalOfflineSec)],
    ['Longest Offline Streak', fmtHMS(longestOfflineSec)]
  ];
  doc.autoTable({
    startY: summaryStartY + 4,
    head: [['Metric', 'Value']],
    body: summaryData,
    theme: 'grid',
    headStyles: { fillColor: [102, 126, 234] },
  });

  // Daily breakdown table
  const dailyStartY = (doc.lastAutoTable?.finalY || (summaryStartY + 30)) + 10;
  doc.setFontSize(12);
  doc.text('Daily Activity within Range', 14, dailyStartY);
  const dailyBody = byDay.map(d => [d.date, d.total, d.online, `${d.pct.toFixed(2)}%`]);
  doc.autoTable({
    startY: dailyStartY + 4,
    head: [['Date', 'Samples', 'Online', 'Uptime %']],
    body: dailyBody,
    theme: 'striped',
    headStyles: { fillColor: [102, 126, 234] },
    styles: { cellPadding: 2 }
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
