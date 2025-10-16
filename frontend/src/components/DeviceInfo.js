import React, { useEffect, useState } from 'react';
import { getLogs } from '../services/api';

function Field({ label, value, formatter }) {
  const v = value === null || value === undefined || value === '' ? '-' : (formatter ? formatter(value) : value);
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{v}</div>
    </div>
  );
}

function DeviceInfo({ routerId }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!routerId) return;
    const load = async () => {
      setLoading(true);
      try {
        const res = await getLogs({ router_id: routerId, limit: 1 });
        const latest = Array.isArray(res.data) && res.data.length > 0 ? res.data[0] : null;
        setInfo(latest);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to load latest device info', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [routerId]);

  if (!routerId) return null;

  return (
    <div className="card">
      <h3>🧭 Device Info</h3>
      {loading && <div className="loading">Loading device info…</div>}
      {!loading && !info && <div>No recent log found for this device.</div>}
      {!loading && info && (
        <div className="grid">
          <Field label="Router ID" value={info.router_id} />
          <Field label="IMEI" value={info.imei} />
          <Field label="ICCID" value={info.iccid} />
          <Field label="IMSI" value={info.imsi} />
          <Field label="Firmware" value={info.firmware_version} />
          <Field label="WAN Type" value={info.wan_type} />
          <Field label="WAN IPv4" value={info.wan_ip} />
          <Field label="WAN IPv6" value={info.wan_ipv6} />
          <Field label="Operator" value={info.operator} />
          <Field label="Network" value={info.network_type} />
          <Field label="Conn Uptime" value={info.conn_uptime_seconds} formatter={(v) => `${(Number(v||0)/3600).toFixed(1)} hrs`} />
          <Field label="CPU Temp" value={info.cpu_temp_c} formatter={(v) => `${Number(v).toFixed(1)} °C`} />
          <Field label="Board Temp" value={info.board_temp_c} formatter={(v) => `${Number(v).toFixed(1)} °C`} />
          <Field label="Input Voltage" value={info.input_voltage_mv} formatter={(v) => `${Number(v)/1000} V`} />
          <Field label="VPN" value={info.vpn_status ? `${info.vpn_status}${info.vpn_name ? ` (${info.vpn_name})` : ''}` : '-'} />
          <Field label="Ethernet Link" value={info.eth_link_up === true ? 'Up' : (info.eth_link_up === false ? 'Down' : '-')} />
          <Field label="WiFi Clients" value={info.wifi_client_count} />
          <Field label="Total TX" value={info.total_tx_bytes} formatter={(v) => `${(Number(v||0)/1024/1024).toFixed(2)} MB`} />
          <Field label="Total RX" value={info.total_rx_bytes} formatter={(v) => `${(Number(v||0)/1024/1024).toFixed(2)} MB`} />
        </div>
      )}
      {!loading && info && Number(info.total_tx_bytes||0) === 0 && Number(info.total_rx_bytes||0) === 0 && (
        <div style={{ marginTop: 12, color: '#64748b' }}>
          Note: No usage data reported by RMS for this device in the latest sync. If the router was active, check the RMS monitoring profile and statistics permissions.
        </div>
      )}
    </div>
  );
}

export default DeviceInfo;
