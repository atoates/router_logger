import React, { useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { subDays, startOfDay, endOfDay } from 'date-fns';

function DateRangeFilter({ onFilterChange }) {
  const [startDate, setStartDate] = useState(startOfDay(subDays(new Date(), 7)));
  const [endDate, setEndDate] = useState(endOfDay(new Date()));

  const handleApply = () => {
    onFilterChange({
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });
  };

  const handlePreset = (days) => {
    const end = endOfDay(new Date());
    const start = startOfDay(subDays(end, days));
    setStartDate(start);
    setEndDate(end);
    onFilterChange({
      startDate: start.toISOString(),
      endDate: end.toISOString()
    });
  };

  return (
    <div className="card">
      <h3>📅 Date Range Filter</h3>
      <div className="filter-bar">
        <div className="form-group">
          <label>Start Date</label>
          <DatePicker
            selected={startDate}
            onChange={date => setStartDate(startOfDay(date))}
            selectsStart
            startDate={startDate}
            endDate={endDate}
            dateFormat="yyyy-MM-dd"
          />
        </div>
        
        <div className="form-group">
          <label>End Date</label>
          <DatePicker
            selected={endDate}
            onChange={date => setEndDate(endOfDay(date))}
            selectsEnd
            startDate={startDate}
            endDate={endDate}
            minDate={startDate}
            dateFormat="yyyy-MM-dd"
          />
        </div>
        
        <div className="form-group">
          <label>&nbsp;</label>
          <button className="btn btn-primary" onClick={handleApply}>
            Apply Filter
          </button>
        </div>
      </div>
      
      <div style={{ marginTop: '15px' }}>
        <strong>Quick Presets:</strong>
        <button className="btn btn-secondary" onClick={() => handlePreset(1)} style={{ marginLeft: '10px' }}>
          Last 24 Hours
        </button>
        <button className="btn btn-secondary" onClick={() => handlePreset(7)}>
          Last 7 Days
        </button>
        <button className="btn btn-secondary" onClick={() => handlePreset(30)}>
          Last 30 Days
        </button>
        <button className="btn btn-secondary" onClick={() => handlePreset(90)}>
          Last 90 Days
        </button>
      </div>
    </div>
  );
}

export default DateRangeFilter;
