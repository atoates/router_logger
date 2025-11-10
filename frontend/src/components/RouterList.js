import React, { useState, useEffect } from 'react';
import { getRouters } from '../services/api';
import { format } from 'date-fns';

function RouterList({ onSelectRouter }) {
  const [routers, setRouters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    fetchRouters();
    const interval = setInterval(fetchRouters, 30000); // Refresh every 30 seconds (was 5 minutes)
    return () => clearInterval(interval);
  }, []);

  const fetchRouters = async () => {
    try {
      const response = await getRouters();
      setRouters(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching routers:', error);
      setLoading(false);
    }
  };

  const handleSelectRouter = (router) => {
    setSelectedId(router.router_id);
    onSelectRouter(router);
  };

  if (loading) {
    return <div className="loading">Loading routers...</div>;
  }

  return (
    <div className="card">
      <h2>📡 Routers ({routers.length})</h2>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Router ID</th>
              <th>Name</th>
              <th>Location</th>
              <th>Site ID</th>
              <th>Status</th>
              <th>Last Seen</th>
              <th>Logs</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {routers.map((router) => (
              <tr 
                key={router.id}
                className={selectedId === router.router_id ? 'selected' : ''}
              >
                <td><strong>{router.router_id}</strong></td>
                <td>{router.name || '-'}</td>
                <td>{router.location || '-'}</td>
                <td>{router.site_id || '-'}</td>
                <td>
                  <span className={`status ${router.current_status === 'online' ? 'status-online' : 'status-offline'}`}>
                    {router.current_status || 'unknown'}
                  </span>
                </td>
                <td>{router.last_seen ? format(new Date(router.last_seen), 'MMM dd, HH:mm') : '-'}</td>
                <td>{router.log_count || 0}</td>
                <td>
                  <button 
                    className="btn btn-primary"
                    onClick={() => handleSelectRouter(router)}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default RouterList;
