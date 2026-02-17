import React, { useState, useEffect } from 'react';
import { X, Download, Search, Filter, RefreshCw } from 'lucide-react';
import { logger } from './logger';

const LEVEL_COLORS = {
  debug: '#999999',
  info: '#0066cc',
  warn: '#ff9900',
  error: '#cc0000'
};

const LEVEL_LABELS = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR'
};

function LogEntry({ log, index }) {
  const [expanded, setExpanded] = useState(false);

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  };

  return (
    <div
      className="border-b border-gray-200 hover:bg-gray-50 transition-colors"
      style={{ fontSize: '11px', fontFamily: 'monospace' }}
    >
      <div
        className="px-3 py-2 cursor-pointer flex items-start gap-2"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-gray-500 flex-shrink-0" style={{ minWidth: '140px' }}>
          {formatTime(log.timestamp)}
        </span>
        <span
          className="font-bold flex-shrink-0"
          style={{ color: LEVEL_COLORS[log.level], minWidth: '50px' }}
        >
          {LEVEL_LABELS[log.level]}
        </span>
        <span className="text-blue-700 flex-shrink-0" style={{ minWidth: '100px' }}>
          [{log.category}]
        </span>
        <span className="flex-1 text-gray-800">{log.message}</span>
      </div>
      {expanded && (
        <div className="px-3 pb-2 bg-gray-100">
          <pre className="text-xs overflow-x-auto p-2 bg-white rounded border border-gray-300 whitespace-pre-wrap">
            {JSON.stringify(log.data, null, 2)}
          </pre>
          {log.sessionId && (
            <div className="text-xs text-gray-500 mt-1">
              Session: {log.sessionId}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminLogViewer({ userId, onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterLevel, setFilterLevel] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState('7'); // days

  useEffect(() => {
    loadLogs();
  }, [userId, dateRange]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const days = parseInt(dateRange);
      const startDate = Date.now() - (days * 24 * 60 * 60 * 1000);
      const allLogs = await logger.getFirebaseLogs(userId, startDate);
      setLogs(allLogs);
    } catch (error) {
      console.error('Failed to load logs:', error);
    }
    setLoading(false);
  };

  const categories = ['all', ...new Set(logs.map(log => log.category))];

  const filteredLogs = logs.filter(log => {
    if (filterLevel !== 'all' && log.level !== filterLevel) return false;
    if (filterCategory !== 'all' && log.category !== filterCategory) return false;
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        log.message.toLowerCase().includes(search) ||
        log.category.toLowerCase().includes(search) ||
        JSON.stringify(log.data).toLowerCase().includes(search)
      );
    }
    return true;
  });

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(filteredLogs, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${userId}-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[9999]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Production Logs</h2>
            <p className="text-xs text-gray-600 mt-1">
              User: {userId} | {filteredLogs.length} logs
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadLogs}
              disabled={loading}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
              title="Refresh logs"
            >
              <RefreshCw size={20} className={`text-gray-600 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleExport}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
              title="Export logs as JSON"
            >
              <Download size={20} className="text-gray-600" />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <X size={20} className="text-gray-600" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-gray-200 flex flex-wrap gap-3 bg-gray-50">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-700 font-medium">Date Range:</label>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-gray-400"
            >
              <option value="1">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-500" />
            <select
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-gray-400"
            >
              <option value="all">All Levels</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-gray-400"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'All Categories' : cat}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 flex items-center gap-2">
            <Search size={16} className="text-gray-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search logs..."
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-gray-400"
            />
          </div>
        </div>

        {/* Logs */}
        <div className="flex-1 overflow-y-auto bg-white">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              Loading logs...
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              No logs found
            </div>
          ) : (
            <>
              {filteredLogs.map((log, index) => (
                <LogEntry key={`${log.sessionId}-${log.logId}-${index}`} log={log} index={index} />
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-600">
          <div className="flex items-center justify-between">
            <div>
              Logs are automatically retained for 30 days and cleaned up daily
            </div>
            <div>
              Session ID: {logger.getSessionId()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
